// @ts-check
// The reads behind the nightly team-strength run, and its record (migration 032).
// The model itself is utils/teamStrength.js; controllers/teamStrengthController.js joins
// the two.

const { sql } = require('kysely')
const { kysely } = require('../db')
const seasonModel = require('./season')

// The runs kept: enough to compare a bad night with the ones before.
const KEEP_RUNS = 14

/** @typedef {import('kysely').RawBuilder<Date>} When */
const NOW = /** @type {When} */ (sql`NOW()`)
// UK local midnight, as fixture.date holds it (see Fixture.getUpcomingWeek).
const UK_TODAY = /** @type {When} */ (sql`date_trunc('day', NOW() AT TIME ZONE 'Europe/London')`)
const UK_WEEK_END = /** @type {When} */ (sql`date_trunc('day', NOW() AT TIME ZONE 'Europe/London') + INTERVAL '7 days'`)

// Every game with a score and four players named, with its fixture's teams and the season it
// was played in (the teams say who has been turning out for whom: the predicted lineups).
// What counts as a real game (four different players, a 21, no 21-0 walkover) is the
// model's decision, made in utils/teamStrength.js usableGame.
exports.games = async function() {
  return kysely.selectFrom('game as g')
    .innerJoin('fixture as f', 'f.id', 'g.fixture')
    .innerJoin('season as s', join => join.onRef('f.date', '>', 's.startDate').onRef('f.date', '<', 's.endDate'))
    .select(['g.id', 'g.fixture', 'g.gameType', 'g.homePlayer1', 'g.homePlayer2', 'g.awayPlayer1', 'g.awayPlayer2',
      'g.homeScore', 'g.awayScore', 'f.date', 'f.homeTeam', 'f.awayTeam', 's.name as season'])
    .where('g.homeScore', 'is not', null).where('g.awayScore', 'is not', null)
    .where('g.homePlayer1', 'is not', null).where('g.homePlayer2', 'is not', null)
    .where('g.awayPlayer1', 'is not', null).where('g.awayPlayer2', 'is not', null)
    .where('f.date', '<=', NOW)
    .orderBy('f.date').orderBy('g.id')
    .execute()
}

// Which division each player was registered in, season by season: the rank of the
// division of the team they were on, and their name then (for linking other leagues' games) (player_at / team_at / division_at, so the current
// season comes from the live tables). LEFT JOINs: a player on no team still has a gender.
exports.registrations = async function() {
  return kysely.selectFrom('player_at as p')
    .leftJoin('team_at as t', join => join.onRef('t.id', '=', 'p.team').onRef('t.season', '=', 'p.season'))
    .leftJoin('division_at as d', join => join.onRef('d.id', '=', 't.division').onRef('d.season', '=', 'p.season'))
    .select(['p.season', 'p.id', 'p.gender', 'p.first_name', 'p.family_name', 'd.rank as divRank'])
    .execute()
}

// This season's teams that are playing (in a division of this league, not withdrawn),
// with their club, and every player registered to them.
exports.squads = async function() {
  const teams = await kysely.selectFrom('team')
    .innerJoin('division', 'division.id', 'team.division')
    .leftJoin('club', 'club.id', 'team.club')
    .select(['team.id', 'team.name', 'team.rank', 'team.divRank', 'team.club as clubId', 'club.name as clubName',
      'division.id as divisionId', 'division.name as divisionName', 'division.rank as divisionRank'])
    .where('division.league', '=', 1)
    .where('team.withdrawn', 'is', null)
    .orderBy('club.name').orderBy('team.rank')
    .execute()
  const players = await kysely.selectFrom('player')
    .select(['id', 'first_name', 'family_name', 'gender', 'team', 'rank'])
    .where('team', 'in', teams.length ? teams.map(t => t.id) : [-1])
    .orderBy('rank')
    .execute()
  return { teams, players }
}

// This season's fixtures still to play, as League.getRunIn counts them (no score; void
// and rearranged left out). `thisWeek`: due by the end of the coming seven UK days, which
// takes in one whose date has passed with no result yet (`overdue`) — played and not
// entered, or not played and not yet rearranged.
exports.remainingFixtures = async function() {
  return kysely.selectFrom('fixture as f')
    .innerJoin('season as s', join => join.onRef('f.date', '>', 's.startDate').onRef('f.date', '<', 's.endDate'))
    .select(eb => ['f.id', 'f.homeTeam', 'f.awayTeam', 'f.date',
      eb.fn('to_char', ['f.date', sql.lit('Dy FMDD Mon')]).as('dayLabel'),
      /** @type {import('kysely').RawBuilder<boolean>} */ (sql`(f.date < ${UK_WEEK_END})`).as('thisWeek'),
      /** @type {import('kysely').RawBuilder<boolean>} */ (sql`(f.date < ${UK_TODAY})`).as('overdue')])
    .where('s.name', '=', seasonModel.current())
    .where('f.homeScore', 'is', null)
    .where(eb => eb.or([eb('f.status', 'in', ['conceded', 'complete', '', 'outstanding']), eb('f.status', 'is', null)]))
    .orderBy('f.date').orderBy('f.id')
    .execute()
}

// Stores a run and drops all but the latest KEEP_RUNS. `payload` goes in as a JSON string:
// pg would send an array or object as a Postgres literal rather than JSON.
/** @param {{ season: string, caller: string, games: number, tookMs: number, payload: unknown }} run */
exports.save = async function({ season, caller, games, tookMs, payload }) {
  return kysely.transaction().execute(async trx => {
    const row = await trx.insertInto('strength_run')
      .values({ season, caller, games, took_ms: tookMs, payload: JSON.stringify(payload) })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx.deleteFrom('strength_run')
      .where('id', 'not in', trx.selectFrom('strength_run').select('id').orderBy('id', 'desc').limit(KEEP_RUNS))
      .execute()
    return row.id
  })
}

// The newest run, or null before the first.
exports.latest = async function() {
  const row = await kysely.selectFrom('strength_run')
    .select(['id', 'ran_at', 'season', 'caller', 'games', 'took_ms', 'payload'])
    .orderBy('id', 'desc').limit(1)
    .executeTakeFirst()
  return row || null
}

exports.KEEP_RUNS = KEEP_RUNS
