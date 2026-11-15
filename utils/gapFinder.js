// Builds the gap-finder page's data: both leagues' teams and fixtures in one calendar,
// with clubs reconciled by name. The rules that judge a date live in
// static/beta/js/gap-finder-core.js, which the page runs.
const GapFinder = require('../models/gapFinder')
const season = require('../models/season')
const core = require('../static/beta/js/gap-finder-core')
const log = require('./log')

const LEAGUES = [
  { key: 'stockport', tag: 'S', label: 'Stockport' },
  { key: 'tameside', tag: 'T', label: 'Tameside' },
]

// Club ids differ between the two Supabase projects; names agree once case and
// punctuation are dropped ("G.H.A.P" / "GHAP").
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Today in the UK, as YYYY-MM-DD. */
function ukToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
}

/**
 * @param {{ stockport: {teams: any[], fixtures: any[]}, tameside: {teams: any[], fixtures: any[]} | null }} reads
 * @param {{ today: string, window: { start: string, end: string } }} opts
 */
function assemble(reads, opts) {
  const teams = [], fixtures = [], clubsByKey = {}
  for (const league of LEAGUES) {
    const r = reads[league.key]
    if (!r) continue
    const teamKeyOf = id => `${league.tag}:${id}`
    for (const t of r.teams) {
      const clubName = t.club || 'No Club'
      const ck = norm(clubName)
      teams.push({ key: teamKeyOf(t.id), league: league.key, leagueLabel: league.label, name: t.name,
        club: clubName, clubKey: ck, division: t.division || null, homeNight: null })
      const c = (clubsByKey[ck] = clubsByKey[ck] || { key: ck, name: clubName, leagues: [], teamKeys: [] })
      if (!c.leagues.includes(league.key)) c.leagues.push(league.key)
      c.teamKeys.push(teamKeyOf(t.id))
    }
    for (const f of r.fixtures) {
      fixtures.push({ uid: `${league.tag}-${f.id}`, id: f.id, league: league.key, date: f.day, dow: core.dowOf(f.day),
        homeKey: teamKeyOf(f.homeTeam), awayKey: teamKeyOf(f.awayTeam), status: f.status })
    }
  }
  const teamByKey = new Map(teams.map(t => [t.key, t]))
  // A fixture against a team the read did not return is dropped rather than half-shown.
  const kept = fixtures.filter(f => teamByKey.has(f.homeKey) && teamByKey.has(f.awayKey))
  kept.forEach(f => {
    f.homeClubKey = teamByKey.get(f.homeKey).clubKey
    f.awayClubKey = teamByKey.get(f.awayKey).clubKey
  })

  // A team's usual night is the commonest weekday of its home fixtures. Stockport's
  // `matchDay` is free text and unreliable, so the fixtures are the evidence.
  const homeDow = {}
  kept.filter(f => core.holdsNight(f.status)).forEach(f => {
    const m = (homeDow[f.homeKey] = homeDow[f.homeKey] || {})
    m[f.dow] = (m[f.dow] || 0) + 1
  })
  teams.forEach(t => {
    const m = homeDow[t.key]
    if (m) t.homeNight = Object.entries(m).sort((a, b) => b[1] - a[1] || core.DOW.indexOf(a[0]) - core.DOW.indexOf(b[0]))[0][0]
  })

  const clubs = Object.values(clubsByKey)
    .filter(c => c.key !== 'noclub')
    .sort((a, b) => a.name.localeCompare(b.name))
  const dates = kept.map(f => f.date).sort()
  return {
    today: opts.today,
    window: opts.window,
    playWindow: { start: dates[0] || opts.window.start, end: dates[dates.length - 1] || opts.window.end },
    clubs, teams, fixtures: kept,
  }
}

/**
 * Reads both leagues and assembles them. Tameside is optional: without it (unset, or the
 * read failed) the page shows Stockport alone and says so, rather than failing.
 */
async function load(now = new Date()) {
  const name = season.current()
  const window = await GapFinder.seasonWindow(name)
  if (!window) throw new Error(`No season row for ${name}`)
  const stockport = await GapFinder.stockport(window)
  let tameside = null, tamesideStatus = 'unset'
  try {
    tameside = await GapFinder.tameside(window)
    if (tameside) tamesideStatus = 'ok'
  } catch (err) {
    log.error({ err }, '[gap-finder] Tameside read failed; showing Stockport only')
    tamesideStatus = 'failed'
  }
  return { ...assemble({ stockport, tameside }, { today: ukToday(now), window }), season: name, tamesideStatus }
}

module.exports = { assemble, load, ukToday, norm }
