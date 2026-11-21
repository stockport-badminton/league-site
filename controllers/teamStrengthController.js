// Team strength (/admin/team-strength): the nightly run and the page that shows it.
//
// The run fits utils/teamStrength.js's rating to every game on record, then works out the
// coming week's fixtures, plays out the rest of the season and checks every club's team
// order, and stores the lot as one row (models/teamStrength.js). The page only reads the
// latest row, so it costs nothing to open. Nightly rather than on each publish: nothing
// here needs to be fresher than a day, and the publish path is already against Firebase's
// 60 seconds (gotcha 1bc).
//
// Games from the Tameside and Manchester leagues (models/externalGame.js) are fitted too,
// for the players who play there as well: a name counts as one of ours only on a one-to-one
// exact match (utils/externalLeagues.js linker). Admin only; never published.
//
// Predictions field each team's usual players: the three men and three ladies who have
// played most for it this season (utils/teamStrength.js usualThree), then its nominated
// players by rank, then its reserves, then an unnamed player at the division's average.

const League = require('../models/league')
const TeamStrength = require('../models/teamStrength')
const ExternalGame = require('../models/externalGame')
const externalLeagues = require('../utils/externalLeagues')
const seasonModel = require('../models/season')
const requireCronCaller = require('../middleware/requireCronCaller')
const model = require('../utils/teamStrength')
const playerCase = require('../utils/playerCase')
const { MOVING } = require('../utils/leagueRunIn')
const { canonicalFor } = require('../utils/canonical')
const log = require('../utils/log')

const DAY = 86400000

// The audit's secret: both are the league office's own overnight data jobs, and a second
// secret would be a second thing to rotate for no separation anyone needs.
const requireStrengthCaller = requireCronCaller({
  envVar: 'AUDIT_CRON_TOKEN',
  header: 'x-audit-token',
  describe: 'the team strength run',
  callerProp: 'strengthCaller',
})

const fullName = (/** @type {{ first_name: string, family_name: string }} */ p) =>
  `${(p.first_name || '').trim()} ${(p.family_name || '').trim()}`

// A real game: four different players and a finished score. 21-0 is how a walkover is
// entered, and says nothing about anyone's play.
/** @param {any} g */
function usableGame(g) {
  const ps = [g.homePlayer1, g.homePlayer2, g.awayPlayer1, g.awayPlayer2]
  if (ps.some(p => !p) || new Set(ps).size < 4) return false
  return Math.max(g.homeScore, g.awayScore) >= 21 && Math.min(g.homeScore, g.awayScore) > 0
}

// Every usable game the rating is fitted to, ours and the other leagues', oldest first.
// Each of ours carries the division rank each player was registered in that season (`divs`),
// so a fit at any date can give a player their starting point as it was then.
/** @param {any[]} rows TeamStrength.games() @param {any[]} regs TeamStrength.registrations() @param {any[]} external ExternalGame.all() */
function collectGames(rows, regs, external) {
  /** @type {Map<string, number | null>} */ const regDiv = new Map()
  /** @type {Map<number, string>} */ const gender = new Map()
  for (const r of regs) { regDiv.set(`${r.season}:${r.id}`, r.divRank); if (r.gender) gender.set(r.id, r.gender) }

  /** @type {any[]} */ const games = []
  for (const g of rows) {
    if (!usableGame(g)) continue
    const ps = [g.homePlayer1, g.homePlayer2, g.awayPlayer1, g.awayPlayer2].map(Number)
    games.push({ t: new Date(g.date).getTime(), mixed: /Mixed/.test(g.gameType || ''), h1: ps[0], h2: ps[1], a1: ps[2], a2: ps[3],
      hs: Number(g.homeScore), as: Number(g.awayScore), divs: ps.map(p => regDiv.get(`${g.season}:${p}`)) })
  }
  const stockportGames = games.length

  // Other leagues' games. Their own players are `${league}:${name}`, with the gender the card
  // gives; ours keep their Stockport division as the starting point.
  const link = externalLeagues.linker(regs.map(r => ({ id: r.id, name: fullName(r), gender: r.gender })))
  /** @type {Map<string, Map<number, number>>} */ const linked = new Map() // league → our id → games
  /** @type {Map<string, number>} */ const fromLeague = new Map()
  /** @type {Map<any, string>} */ const extGender = new Map()
  for (const e of external) {
    const slots = [[e.home1, e.home1_gender], [e.home2, e.home2_gender], [e.away1, e.away1_gender], [e.away2, e.away2_gender]]
    const ps = slots.map(([n, g]) => link(e.league, /** @type {string} */ (n), g))
    if (new Set(ps).size < 4 || Math.max(e.home_score, e.away_score) < 21 || Math.min(e.home_score, e.away_score) === 0) continue
    ps.forEach((p, i) => {
      const g = slots[i][1]
      if (typeof p === 'string') { if (g) extGender.set(p, g); return }
      const byLeague = linked.get(e.league) || new Map()
      byLeague.set(p, (byLeague.get(p) || 0) + 1)
      linked.set(e.league, byLeague)
    })
    fromLeague.set(e.league, (fromLeague.get(e.league) || 0) + 1)
    games.push({ t: Date.parse(`${e.played_on}T19:00:00Z`), // the evening of the match
      mixed: e.mixed, h1: ps[0], h2: ps[1], a1: ps[2], a2: ps[3], hs: e.home_score, as: e.away_score })
  }
  games.sort((a, b) => a.t - b.t)
  const genderOf = (/** @type {any} */ p) => (typeof p === 'number' ? gender.get(p) : extGender.get(p)) || ''
  return { games, genderOf, stockportGames, linked, fromLeague }
}

// The rating as it stood at `at`: fitted to the games before it, each player starting from
// the division they were registered in when they last played for us before it.
/** @param {ReturnType<typeof collectGames>} input @param {number} at ms */
function fitAt(input, at) {
  const games = input.games.filter(g => g.t < at)
  /** @type {Map<number, number | null | undefined>} */ const lastDiv = new Map()
  for (const g of games) if (g.divs) [g.h1, g.h2, g.a1, g.a2].forEach((p, i) => { if (g.divs[i] != null) lastDiv.set(p, g.divs[i]) })
  const fit = model.fit(games, at, input.genderOf, p => (typeof p === 'number' ? lastDiv.get(p) : undefined))
  return { fit, games }
}

/** Builds everything the page shows. @param {number} now ms */
async function build(now) {
  const [rows, regs, { teams, players }, remaining, standings, external] = await Promise.all([
    TeamStrength.games(), TeamStrength.registrations(), TeamStrength.squads(),
    TeamStrength.remainingFixtures(), League.getRunIn(), ExternalGame.all(),
  ])
  const input = collectGames(rows, regs, external)
  const { stockportGames, linked, fromLeague } = input
  const { fit, games } = fitAt(input, now)

  // How many games each player has (all leagues), how many in the last year, and the last.
  /** @type {Map<number, { games: number, recent: number, last: number }>} */ const seen = new Map()
  for (const g of games) for (const p of [g.h1, g.h2, g.a1, g.a2]) {
    if (typeof p !== 'number') continue
    const st = seen.get(p) || { games: 0, recent: 0, last: 0 }
    st.games++; if (now - g.t < 365 * DAY) st.recent++; st.last = Math.max(st.last, g.t)
    seen.set(p, st)
  }

  // This season's fixtures each player has played for each team: `${team}:${player}` → fixtures.
  /** @type {Map<string, Set<number>>} */ const turnedOut = new Map()
  const season = seasonModel.current()
  // Where each player has stood on the card this season, fixture by fixture, in the level
  // games they played for their own team (playing up, or for another club, is left out): the
  // order their club actually plays them in, to set against the order it nominated.
  const ownTeam = new Map(players.map(p => [p.id, p.team]))
  /** @type {Map<number, Map<number, number>>} */ const cardPos = new Map()
  for (const g of rows) {
    if (g.season !== season) continue
    const at = model.levelPositions(g.gameType)
    if (at) [[g.homePlayer1, g.homeTeam, at[0]], [g.homePlayer2, g.homeTeam, at[1]],
      [g.awayPlayer1, g.awayTeam, at[0]], [g.awayPlayer2, g.awayTeam, at[1]]].forEach(([p, team, pos]) => {
      p = Number(p)
      if (!p || ownTeam.get(p) !== team) return
      const byFixture = cardPos.get(p) || new Map()
      byFixture.set(g.fixture, pos)
      cardPos.set(p, byFixture)
    })
    if (!usableGame(g)) continue
    const ps = [g.homePlayer1, g.homePlayer2, g.awayPlayer1, g.awayPlayer2].map(Number)
    ps.forEach((p, i) => {
      const k = `${i < 2 ? g.homeTeam : g.awayTeam}:${p}`
      const fixtures = turnedOut.get(k) || new Set()
      fixtures.add(g.fixture)
      turnedOut.set(k, fixtures)
    })
  }

  const teamById = new Map(teams.map(t => [t.id, t]))
  const rate = (/** @type {any} */ p) => {
    const s = fit.s.get(p.id), st = seen.get(p.id), at = [...(cardPos.get(p.id)?.values() || [])]
    return {
      // Average card position this season for their own team, and over how many fixtures.
      pos: at.length ? Math.round(10 * at.reduce((a, b) => a + b, 0) / at.length) / 10 : null, posN: at.length,
      id: p.id, name: fullName(p), gender: p.gender, team: p.team, rank: p.rank,
      s: s ?? null, se: s == null ? null : fit.se.get(p.id) ?? null,
      r: s == null ? null : model.display(s), mixed: Math.round(1000 * (fit.mixed.get(p.id) || 0)),
      games: st ? st.games : 0, recent: st ? st.recent : 0,
      last: st ? new Date(st.last).toISOString().slice(0, 10) : null,
    }
  }
  const rated = players.map(rate)

  // Each team's usual three of each gender, as the predictions field them. Only players still
  // registered at the club count as regulars: one who has left keeps their history, not a place.
  /** @type {Map<number, any>} */ const lineups = new Map()
  for (const t of teams) {
    /** @param {string} g */
    const three = g => {
      const slot = (/** @type {any} */ p) => ({ id: p.id, name: p.name,
        s: p.s ?? fit.mean(g, t.divisionRank), se: p.se ?? model.SETTINGS.tau, mx: (fit.mixed.get(p.id) || 0) })
      const squad = rated.filter(p => p.team === t.id && p.gender === g)
      const nominated = squad.filter(p => p.rank != null && p.rank < model.RESERVE_BASE)
      const reserves = squad.filter(p => !(p.rank != null && p.rank < model.RESERVE_BASE))
      const played = rated
        .filter(p => p.gender === g && teamById.get(p.team)?.clubId === t.clubId && turnedOut.has(`${t.id}:${p.id}`))
        .map(p => ({ slot: slot(p), fixtures: /** @type {Set<number>} */ (turnedOut.get(`${t.id}:${p.id}`)).size }))
      const picked = model.usualThree(nominated.map(slot), reserves.map(slot), played)
      while (picked.length < 3) picked.push({ id: null, name: `(no ${g === 'Male' ? 'man' : 'lady'} ${picked.length + 1})`, s: fit.mean(g, t.divisionRank), se: model.SETTINGS.tau, mx: 0 })
      return picked
    }
    lineups.set(t.id, { men: three('Male'), ladies: three('Female') })
  }

  const week = remaining.filter(f => f.thisWeek && lineups.has(f.homeTeam) && lineups.has(f.awayTeam)).map(f => {
    const home = /** @type {any} */ (teamById.get(f.homeTeam)), away = /** @type {any} */ (teamById.get(f.awayTeam))
    const pr = model.predictFixture(lineups.get(f.homeTeam), lineups.get(f.awayTeam), fit.home)
    return { id: f.id, dayLabel: f.dayLabel, overdue: f.overdue, division: home.divisionName, divisionRank: home.divisionRank,
      home: home.name, away: away.name, ...pr }
  }).sort((a, b) => a.divisionRank - b.divisionRank) // stable: by date within a division, as remainingFixtures orders them

  // Divisions as League.getRunIn orders them; the top one promotes nobody, the bottom one
  // relegates nobody, as on the run-in page.
  /** @type {Map<number, any>} */ const divs = new Map()
  for (const r of standings) {
    if (!divs.has(r.division)) divs.set(r.division, { id: r.division, name: r.divisionName, rank: r.divisionRank, teams: [] })
    divs.get(r.division).teams.push({ id: r.id, name: r.name, divRank: r.divRank, gamesWon: r.gamesWon, played: r.played, remaining: r.remaining })
  }
  const divList = [...divs.values()]
  const ranks = divList.map(d => d.rank)
  for (const d of divList) { d.promotes = d.rank !== Math.min(...ranks); d.relegates = d.rank !== Math.max(...ranks) }
  const projection = model.projectSeason(divList,
    remaining.map(f => ({ home: f.homeTeam, away: f.awayTeam })), lineups, fit.home, { moving: MOVING })

  // Team order, club by club, teams in club order.
  /** @type {Map<number, any>} */ const clubs = new Map()
  for (const t of teams) {
    if (!clubs.has(t.clubId)) clubs.set(t.clubId, { name: t.clubName, teams: [] })
    /** @param {string} g */
    const squad = g => {
      const list = rated.filter(p => p.team === t.id && p.gender === g)
      const nominated = list.filter(p => p.rank != null && p.rank < model.RESERVE_BASE)
      return { nominated, reserves: list.filter(p => !nominated.includes(p)), unset: nominated.length > model.MAX_NOMINATED }
    }
    clubs.get(t.clubId).teams.push({ id: t.id, name: t.name, division: t.divisionName, men: squad('Male'), ladies: squad('Female') })
  }
  const checks = [...clubs.values()].map(c => ({ ...c, flags: model.orderFlags(c.teams) }))

  const slim = (/** @type {any} */ p) => ({ id: p.id, name: p.name, rank: p.rank, r: p.r, pos: p.pos, posN: p.posN,
    se: p.se == null ? null : Math.round(1000 * p.se), mixed: p.mixed, recent: p.recent })
  const nameOf = new Map(regs.map(r => [r.id, fullName(r)]))
  const teamName = (/** @type {number} */ id) => {
    const p = players.find(x => x.id === id), t = p && teamById.get(p.team)
    return t ? t.name : null
  }
  return {
    games: games.length,
    input,
    payload: {
      settings: model.SETTINGS, home: fit.home,
      sources: { stockport: stockportGames, tameside: fromLeague.get('tameside') || 0, mcrbl: fromLeague.get('mcrbl') || 0 },
      // Who was linked across leagues, most games first, so a wrong match can be spotted.
      linked: Object.fromEntries([...linked].map(([league, ids]) => [league,
        [...ids].map(([id, n]) => ({ name: nameOf.get(id) || String(id), team: teamName(id), games: n }))
          .sort((a, b) => b.games - a.games)])),
      week,
      projection,
      checks: checks.map(c => ({
        name: c.name,
        flags: c.flags.map(f => ({ kind: f.kind, gender: f.gender, team: f.team, text: f.text, p: f.p,
          stronger: f.stronger.r, weaker: f.weaker.r, strongerId: f.stronger.id, weakerId: f.weaker.id })),
        teams: c.teams.map((/** @type {any} */ t) => ({ name: t.name, division: t.division,
          men: { nominated: t.men.nominated.map(slim), reserves: t.men.reserves.map(slim), unset: t.men.unset },
          ladies: { nominated: t.ladies.nominated.map(slim), reserves: t.ladies.reserves.map(slim), unset: t.ladies.unset } })),
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// Weekly snapshots (migration 038): the rating each Monday, for charting beside the ELO.

// The nightly run looks this many Mondays back: the newest week, plus late results and
// Manchester's weekly import landing in the weeks before it.
const LOOKBACK_WEEKS = 4

// Everything a fit needs, read fresh.
async function loadInput() {
  const [rows, regs, external] = await Promise.all([TeamStrength.games(), TeamStrength.registrations(), ExternalGame.all()])
  return collectGames(rows, regs, external)
}

// Snapshots each of `mondays` (local midnights) that is missing, or whose fit would now see a
// different number of games from the one held (`force`: every one). `dryRun` fits nothing.
/**
 * @param {ReturnType<typeof collectGames>} input
 * @param {number[]} mondays
 * @param {{ caller: string, force?: boolean, dryRun?: boolean, onWeek?: (w: any) => void }} opts
 */
async function snapshotWeeks(input, mondays, { caller, force = false, dryRun = false, onWeek = () => {} }) {
  const held = new Map((await TeamStrength.weeks()).map(w => [w.asOf, w.games]))
  const done = []
  for (const m of mondays) {
    const asOf = model.isoDay(m)
    let games = 0
    while (games < input.games.length && input.games[games].t < m) games++ // sorted by time
    const was = held.get(asOf)
    if (!force && was === games) continue
    const week = { asOf, games, was: was ?? null, players: /** @type {number | null} */ (null), ms: 0 }
    if (!dryRun) {
      const started = Date.now()
      const { fit, games: seen } = fitAt(input, m)
      const rows = model.snapshotRows(fit, seen, m)
      await TeamStrength.saveWeek({ asOf, games, caller, rows })
      week.players = rows.length
      week.ms = Date.now() - started
    }
    done.push(week)
    onWeek(week)
  }
  return done
}

// The Mondays with Stockport games in the week before, from `from` to `to`.
/** @param {ReturnType<typeof collectGames>} input @param {number} from @param {number} to */
function weeksBetween(input, from, to) {
  return model.snapshotMondays(input.games.filter(g => g.divs).map(g => g.t), from, to)
}

// The nightly part: the last LOOKBACK_WEEKS Mondays up to `now`.
/** @param {ReturnType<typeof collectGames>} input @param {number} now @param {string} caller */
async function refreshWeeks(input, now, caller) {
  let from = model.mondayOf(now)
  for (let i = 1; i < LOOKBACK_WEEKS; i++) from = new Date(from).setDate(new Date(from).getDate() - 7)
  return snapshotWeeks(input, weeksBetween(input, from, now), { caller })
}

// Fetches the other leagues' games and adds any not already held. Each league on its own:
// one failing (Manchester's page changed, Tameside's database unreachable) still lets the
// other import, and the nightly run carries on with what it already has.
// `seasons` are Manchester's ('2026-27'); the default is the current one. `dryRun` fetches
// and parses but adds nothing, so the history tool can say what it would do.
/** @param {{ seasons?: string[], dryRun?: boolean }} [opts] */
async function importExternal({ seasons, dryRun = false } = {}) {
  const add = (/** @type {any[]} */ rows) => (dryRun ? Promise.resolve(0) : ExternalGame.add(rows))
  /** @type {{ tameside: any, mcrbl: any[] }} */
  const out = { tameside: null, mcrbl: [] }
  try {
    const rows = await externalLeagues.tamesideGames()
    out.tameside = rows == null ? { skipped: 'TAMESIDE_DATABASE_URL is not set' } : { games: rows.length, added: await add(rows) }
  } catch (err) {
    log.error({ err }, '[team-strength] Tameside import failed')
    out.tameside = { error: /** @type {Error} */ (err).message }
  }
  const list = seasons || [externalLeagues.mcrblSeason()]
  for (const [i, season] of list.entries()) {
    if (i) await new Promise(r => setTimeout(r, 3000)) // one request every few seconds, to be polite
    try {
      const { rows, cards, dropped } = externalLeagues.parseMcrblSeason(await externalLeagues.fetchMcrblSeason(season))
      out.mcrbl.push({ season, cards, games: rows.length, dropped, added: await add(rows) })
    } catch (err) {
      log.error({ err, season }, '[team-strength] Manchester import failed')
      out.mcrbl.push({ season, error: /** @type {Error} */ (err).message })
    }
  }
  log.info({ ...out, dryRun }, '[team-strength] other leagues imported')
  return out
}

// POST /admin/team-strength/import — Cloud Scheduler weekly: this season's Manchester page
// and Tameside's games. One page a week is all Manchester's site is asked for.
exports.importRun = async function(req, res, next) {
  try {
    const result = await importExternal()
    const failed = result.mcrbl.some(m => m.error) || (result.tameside && result.tameside.error)
    res.status(failed ? 502 : 200).json({ ok: !failed, ...result, held: await ExternalGame.summary() })
  } catch (err) {
    next(err)
  }
}

// POST /admin/team-strength/run — Cloud Scheduler nightly, or the page's button.
exports.run = async function(req, res, next) {
  const started = Date.now()
  try {
    const caller = req.strengthCaller || 'unknown'
    const { games, input, payload } = await build(started)
    const tookMs = Date.now() - started
    const id = await TeamStrength.save({ season: seasonModel.current(), caller, games, tookMs, payload })
    log.info({ runId: id, games, tookMs, caller }, '[team-strength] run stored')
    // The weekly snapshots after the run is safe: a failure here is logged, not the run's.
    /** @type {any} */ let weeks
    try {
      weeks = (await refreshWeeks(input, started, caller)).map(w => w.asOf)
      if (weeks.length) log.info({ weeks }, '[team-strength] weekly snapshots stored')
    } catch (err) {
      log.error({ err }, '[team-strength] weekly snapshot failed')
      weeks = { error: /** @type {Error} */ (err).message }
    }
    if (caller === 'superadmin') return res.redirect(303, '/admin/team-strength')
    res.json({ ok: true, runId: id, games, tookMs, week: payload.week.length, weeks })
  } catch (err) {
    next(err)
  }
}

// GET /admin/team-strength — the latest run.
exports.page = async function(req, res, next) {
  try {
    const run = await TeamStrength.latest()
    res.render('admin/team-strength', {
      static_path: '/static',
      pageTitle: 'Team Strength',
      pageDescription: 'Points-based ratings: this week\'s predictions, the projected tables and team order checks.',
      run,
      data: run ? run.payload : null,
      season: seasonModel.current(),
      canonical: canonicalFor(req),
    })
  } catch (err) {
    next(err)
  }
}

// The evidence windows the compare page offers: this season, this and last, or everything.
const WINDOWS = { 1: 'this season', 2: 'this season and last', all: 'every season' }

// "tameside:jo bloggs" → "Jo Bloggs (Tameside)": another league's player, as the page names them.
const otherName = (/** @type {string} */ key) => {
  const [league, name] = key.split(':')
  return `${name.replace(/\b\w/g, ch => ch.toUpperCase())} (${league === 'mcrbl' ? 'Manchester' : 'Tameside'})`
}

// GET /admin/team-strength/compare?a=&b=&seasons= — the case for putting player a above
// player b (utils/playerCase.js): their ratings from the latest run, then the results.
exports.compare = async function(req, res, next) {
  try {
    const window = Object.hasOwn(WINDOWS, String(req.query.seasons)) ? String(req.query.seasons) : '2'
    const ids = [req.query.a, req.query.b].map(v => Number.parseInt(String(v), 10))
    const { teams, players } = await TeamStrength.squads()
    const teamById = new Map(teams.map(t => [t.id, t]))
    const picker = teams.map(t => ({ team: t.name, players: players.filter(p => p.team === t.id)
      .map(p => ({ id: p.id, name: fullName(p), gender: p.gender })) }))
    const view = { static_path: '/static', pageTitle: 'Make the case', canonical: canonicalFor(req),
      pageDescription: 'The results behind a team-order flag: the case for swapping two players.',
      picker, window, windows: WINDOWS, ids, minGames: playerCase.MIN_GAMES, margin: playerCase.MARGIN, error: /** @type {string | null} */ (null), result: /** @type {any} */ (null) }

    const [a, b] = ids.map(id => players.find(p => p.id === id))
    if (!a || !b || a.id === b.id) {
      if (req.query.a || req.query.b) view.error = 'Pick two different players registered to a team this season.'
      return res.render('admin/team-strength-compare', view)
    }
    if (a.gender !== b.gender) {
      view.error = 'Pick two men or two ladies: the order is set for each separately.'
      return res.render('admin/team-strength-compare', view)
    }

    const seasons = window === 'all' ? null : [seasonModel.current(), seasonModel.previous()].slice(0, Number(window))
    // Other leagues' seasons run September to May too: the window opens the July before.
    const from = seasons ? `${seasons[seasons.length - 1].slice(0, 4)}-07-01` : ''
    const [rows, regs, external, run] = await Promise.all([
      TeamStrength.pairGames([a.id, b.id], seasons), TeamStrength.registrations(), ExternalGame.all(), TeamStrength.latest(),
    ])
    /** @type {Map<number, string>} */ const nameOf = new Map()
    for (const r of regs) if (!nameOf.has(r.id) || r.season === seasonModel.current()) nameOf.set(r.id, fullName(r))
    const link = externalLeagues.linker(regs.map(r => ({ id: r.id, name: fullName(r), gender: r.gender })))

    /** @type {import('../utils/playerCase').CaseGame[]} */
    const games = rows.map(g => ({ league: 'stockport', fixture: g.fixture, date: new Date(g.date).toISOString().slice(0, 10),
      season: g.season, mixed: /Mixed/.test(g.gameType || ''), hs: Number(g.homeScore), as: Number(g.awayScore),
      home: { name: g.homeTeamName, division: g.homeDivision, players: [Number(g.homePlayer1), Number(g.homePlayer2)] },
      away: { name: g.awayTeamName, division: g.awayDivision, players: [Number(g.awayPlayer1), Number(g.awayPlayer2)] } }))
    for (const e of external) {
      if (e.played_on < from) continue
      const ps = [[e.home1, e.home1_gender], [e.home2, e.home2_gender], [e.away1, e.away1_gender], [e.away2, e.away2_gender]]
        .map(([n, g]) => link(e.league, /** @type {string} */ (n), g))
      if (!ps.includes(a.id) && !ps.includes(b.id)) continue
      games.push({ league: e.league, fixture: null, date: e.played_on, season: null, mixed: e.mixed, hs: e.home_score, as: e.away_score,
        home: { name: null, division: null, players: ps.slice(0, 2) }, away: { name: null, division: null, players: ps.slice(2) } })
    }

    const who = (/** @type {any} */ p) => ({ id: p.id, name: fullName(p) })
    const c = playerCase.build(who(a), who(b), games,
      id => (typeof id === 'string' ? otherName(id) : nameOf.get(id) || `#${id}`))

    // Their ratings, from the latest run's order checks (a run before ids were stored has none).
    /** @type {Map<number, any>} */ const rated = new Map()
    for (const club of run?.payload?.checks || []) for (const t of club.teams) for (const g of ['men', 'ladies']) {
      for (const p of [...t[g].nominated, ...t[g].reserves]) if (p.id) rated.set(p.id, p)
    }
    const ra = rated.get(a.id), rb = rated.get(b.id)
    const asRated = (/** @type {any} */ p) => ({ s: (p.r - 1500) / 1000, se: p.se / 1000 })
    const rating = ra && rb && ra.r != null && rb.r != null
      ? { a: ra.r, b: rb.r, p: model.pStronger(/** @type {any} */ (asRated(ra)), /** @type {any} */ (asRated(rb))), ra, rb }
      : null

    view.result = { case: c, rating, ranAt: run?.ran_at || null,
      teams: { a: teamById.get(a.team)?.name, b: teamById.get(b.team)?.name },
      ranks: { a: a.rank, b: b.rank },
      text: playerCase.caseText(c, { window: WINDOWS[/** @type {keyof typeof WINDOWS} */ (window)], rating: rating || undefined }) }
    res.render('admin/team-strength-compare', view)
  } catch (err) {
    next(err)
  }
}

// The weekly ratings as chart series, one per player: { id, data: [{ x: day, y, se }] }.
/** @param {{ player: number, asOf: string, rating: number, se: number }[]} rows */
function weeklySeries(rows) {
  /** @type {Map<number, { id: number, data: { x: string, y: number, se: number }[] }>} */ const by = new Map()
  for (const r of rows) {
    const series = by.get(r.player) || { id: r.player, data: [] }
    series.data.push({ x: r.asOf, y: r.rating, se: r.se })
    by.set(r.player, series)
  }
  return [...by.values()]
}

// GET /api/player-strength?players=1,2,3 — the weekly points ratings for /elo-chart, beside
// the ELO series /api/player-elo gives. Superadmin only, as the rating is.
const CHART_MAX_PLAYERS = 20
exports.playerWeeksApi = async function(req, res, next) {
  try {
    const ids = String(req.query.players || '').split(',').map(x => parseInt(x, 10)).filter(n => !isNaN(n)).slice(0, CHART_MAX_PLAYERS)
    res.set('Cache-Control', 'private, no-store')
    res.json(weeklySeries(await TeamStrength.playerWeeks(ids)))
  } catch (err) {
    next(err)
  }
}

exports.requireStrengthCaller = requireStrengthCaller
exports.build = build
exports.loadInput = loadInput
exports.snapshotWeeks = snapshotWeeks
exports.weeksBetween = weeksBetween
exports.refreshWeeks = refreshWeeks
exports.weeklySeries = weeklySeries
exports.importExternal = importExternal
exports.usableGame = usableGame
