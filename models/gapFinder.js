// @ts-check
// The calendar gap-finder's reads: every team and every fixture that occupies a night,
// in this league and in Tameside's.
//
// Tameside's app is a fork of ours with its own Supabase project, and its `team`, `club`,
// `division` and `fixture` tables have the same shape, so one query function serves both:
// it is handed our Kysely, or one over a READ ONLY transaction on TAMESIDE_DATABASE_URL.
// Clubs and teams are reconciled by name afterwards (utils/gapFinder.js) because their ids
// differ between the two projects.
//
// This replaces tools/gap-finder/dump.js's snapshot for the in-app page; the tool still
// works for an offline artifact.
const config = require('../config')
const log = require('../utils/log')
const { sql } = require('kysely')
const { kysely } = require('../db')
const { overClient } = require('../db/kysely')

/** @typedef {import('../db/kysely').Db} Db */

/** A YYYY-MM-DD string as a timestamp, which is what fixture.date is (TIMESTAMP, no zone). */
const day = (/** @type {string} */ iso) => /** @type {import('kysely').RawBuilder<Date>} */ (sql`${iso}::timestamp`)

/**
 * `rearranged` is the superseded row of a moved fixture (its replacement carries the new
 * date) and `void` is a fixture that will never be played: neither occupies a night, and
 * neither can be moved. Everything else comes back, `rearranging` included — it has no
 * new date yet and is exactly what the page is for. utils/gapFinder.js decides which of
 * the rest hold a night.
 */
const NEVER_PLAYED = ['rearranged', 'void']

/**
 * @param {Db} k
 * @param {{ start: string, end: string }} window YYYY-MM-DD, end exclusive
 */
async function readCalendar(k, window) {
  const teams = await k.selectFrom('team')
    .leftJoin('club', 'club.id', 'team.club')
    .leftJoin('division', 'division.id', 'team.division')
    .select(['team.id', 'team.name', 'club.name as club', 'division.name as division'])
    .orderBy('team.id')
    .execute()
  const fixtures = await k.selectFrom('fixture')
    .select(eb => ['fixture.id', 'fixture.homeTeam', 'fixture.awayTeam', 'fixture.status',
      eb.fn('to_char', ['fixture.date', sql.lit('YYYY-MM-DD')]).as('day')])
    .where('fixture.date', '>=', day(window.start))
    .where('fixture.date', '<', day(window.end))
    .where('fixture.status', 'not in', NEVER_PLAYED)
    .orderBy('fixture.date').orderBy('fixture.id')
    .execute()
  return {
    teams,
    fixtures: fixtures.map(f => ({ ...f, day: /** @type {string} */ (f.day) })),
  }
}

/** @param {{ start: string, end: string }} window */
exports.stockport = window => readCalendar(kysely, window)

/**
 * Tameside's calendar, or null when TAMESIDE_DATABASE_URL is not set (and in every test).
 * Throws when it is set and the read fails; the caller says so on the page.
 * @param {{ start: string, end: string }} window
 */
exports.tameside = async function(window) {
  if (!config.TAMESIDE_DATABASE_URL) return null
  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: config.TAMESIDE_DATABASE_URL, max: 1 })
  pool.on('error', err => log.error({ err }, '[gap-finder] Tameside pool error')) // gotcha 2c
  const c = await pool.connect()
  try {
    await c.query('BEGIN TRANSACTION READ ONLY')
    const result = await readCalendar(overClient(c), window)
    await c.query('ROLLBACK')
    return result
  } finally {
    c.release()
    await pool.end()
  }
}

/**
 * The named season's start and end, as YYYY-MM-DD. Undefined for a season with no row.
 * @param {string} name
 */
exports.seasonWindow = async function(name) {
  const row = await kysely.selectFrom('season')
    .select(eb => [
      eb.fn('to_char', ['season.startDate', sql.lit('YYYY-MM-DD')]).as('start'),
      eb.fn('to_char', ['season.endDate', sql.lit('YYYY-MM-DD')]).as('end'),
    ])
    .where('season.name', '=', name)
    .executeTakeFirst()
  return row && { start: /** @type {string} */ (row.start), end: /** @type {string} */ (row.end) }
}

exports.readCalendar = readCalendar
exports.NEVER_PLAYED = NEVER_PLAYED
