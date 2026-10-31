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

/** Builds everything the page shows. @param {number} now ms */
async function build(now) {
  const [rows, regs, { teams, players }, remaining, standings, external] = await Promise.all([
    TeamStrength.games(), TeamStrength.registrations(), TeamStrength.squads(),
    TeamStrength.remainingFixtures(), League.getRunIn(), ExternalGame.all(),
  ])

  /** @type {Map<string, number | null>} */ const regDiv = new Map()
  /** @type {Map<number, string>} */ const gender = new Map()
  for (const r of regs) { regDiv.set(`${r.season}:${r.id}`, r.divRank); if (r.gender) gender.set(r.id, r.gender) }

  // The division a player was registered in when they last played: their starting point.
  /** @type {Map<number, number | null | undefined>} */ const lastDiv = new Map()
  /** @type {Map<number, { games: number, recent: number, last: number }>} */ const seen = new Map()
  // This season's fixtures each player has played for each team: `${team}:${player}` → fixtures.
  /** @type {Map<string, Set<number>>} */ const turnedOut = new Map()
  const season = seasonModel.current()
  const games = []
  for (const g of rows) {
    if (!usableGame(g)) continue
    const t = new Date(g.date).getTime()
    const ps = [g.homePlayer1, g.homePlayer2, g.awayPlayer1, g.awayPlayer2].map(Number)
    if (g.season === season) ps.forEach((p, i) => {
      const k = `${i < 2 ? g.homeTeam : g.awayTeam}:${p}`
      const fixtures = turnedOut.get(k) || new Set()
      fixtures.add(g.fixture)
      turnedOut.set(k, fixtures)
    })
    for (const p of ps) {
      const d = regDiv.get(`${g.season}:${p}`)
      if (d != null) lastDiv.set(p, d)
      const s = seen.get(p) || { games: 0, recent: 0, last: 0 }
      s.games++; if (now - t < 365 * DAY) s.recent++; s.last = t
      seen.set(p, s)
    }
    games.push({ t, mixed: /Mixed/.test(g.gameType || ''), h1: ps[0], h2: ps[1], a1: ps[2], a2: ps[3],
      hs: Number(g.homeScore), as: Number(g.awayScore) })
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
    const t = Date.parse(`${e.played_on}T19:00:00Z`) // the evening of the match
    ps.forEach((p, i) => {
      const g = slots[i][1]
      if (typeof p === 'string') { if (g) extGender.set(p, g); return }
      const byLeague = linked.get(e.league) || new Map()
      byLeague.set(p, (byLeague.get(p) || 0) + 1)
      linked.set(e.league, byLeague)
      const st = seen.get(p) || { games: 0, recent: 0, last: 0 }
      st.games++; if (now - t < 365 * DAY) st.recent++; st.last = Math.max(st.last, t)
      seen.set(p, st)
    })
    fromLeague.set(e.league, (fromLeague.get(e.league) || 0) + 1)
    games.push({ t, mixed: e.mixed, h1: ps[0], h2: ps[1], a1: ps[2], a2: ps[3], hs: e.home_score, as: e.away_score })
  }
  games.sort((a, b) => a.t - b.t)
  const genderOf = (/** @type {any} */ p) => (typeof p === 'number' ? gender.get(p) : extGender.get(p)) || ''
  const fit = model.fit(/** @type {any} */ (games), now, genderOf, p => (typeof p === 'number' ? lastDiv.get(p) : undefined))

  const teamById = new Map(teams.map(t => [t.id, t]))
  const rate = (/** @type {any} */ p) => {
    const s = fit.s.get(p.id), st = seen.get(p.id)
    return {
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

  const slim = (/** @type {any} */ p) => ({ name: p.name, rank: p.rank, r: p.r,
    se: p.se == null ? null : Math.round(1000 * p.se), mixed: p.mixed, recent: p.recent })
  const nameOf = new Map(regs.map(r => [r.id, fullName(r)]))
  const teamName = (/** @type {number} */ id) => {
    const p = players.find(x => x.id === id), t = p && teamById.get(p.team)
    return t ? t.name : null
  }
  return {
    games: games.length,
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
          stronger: f.stronger.r, weaker: f.weaker.r })),
        teams: c.teams.map((/** @type {any} */ t) => ({ name: t.name, division: t.division,
          men: { nominated: t.men.nominated.map(slim), reserves: t.men.reserves.map(slim), unset: t.men.unset },
          ladies: { nominated: t.ladies.nominated.map(slim), reserves: t.ladies.reserves.map(slim), unset: t.ladies.unset } })),
      })),
    },
  }
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
    const { games, payload } = await build(started)
    const tookMs = Date.now() - started
    const id = await TeamStrength.save({ season: seasonModel.current(), caller: req.strengthCaller || 'unknown', games, tookMs, payload })
    log.info({ runId: id, games, tookMs, caller: req.strengthCaller }, '[team-strength] run stored')
    if (req.strengthCaller === 'superadmin') return res.redirect(303, '/admin/team-strength')
    res.json({ ok: true, runId: id, games, tookMs, week: payload.week.length })
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

exports.requireStrengthCaller = requireStrengthCaller
exports.build = build
exports.importExternal = importExternal
exports.usableGame = usableGame
