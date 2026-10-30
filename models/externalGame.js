// @ts-check
// Other leagues' games, for the team-strength ratings (migration 033, utils/externalLeagues.js).

const { sql } = require('kysely')
const { kysely } = require('../db')

// A DATE as its own text: pg hands a DATE back as a JS Date at local midnight, which reads as
// the day before once it goes through toISOString in British Summer Time.
/** @param {string} col */
const day = col => /** @type {import('kysely').RawBuilder<string>} */ (sql`to_char(${sql.ref(col)}, 'YYYY-MM-DD')`)

/**
 * @typedef {{ league: 'tameside' | 'mcrbl', source_key: string, played_on: string, game_type: string,
 *   mixed: boolean, home1: string, home2: string, away1: string, away2: string,
 *   home1_gender: string | null, home2_gender: string | null, away1_gender: string | null, away2_gender: string | null,
 *   home_score: number, away_score: number }} ExternalGame
 */

// Adds the games not already held (by league and source key) and returns how many were
// new, so an import can be re-run over the same season without doubling anything.
/** @param {ExternalGame[]} rows */
exports.add = async function(rows) {
  let added = 0
  for (let i = 0; i < rows.length; i += 500) {
    const res = await kysely.insertInto('external_game').values(rows.slice(i, i + 500))
      .onConflict(oc => oc.columns(['league', 'source_key']).doNothing())
      .executeTakeFirst()
    added += Number(res.numInsertedOrUpdatedRows || 0)
  }
  return added
}

// Every game held, oldest first, for the nightly fit.
exports.all = async function() {
  return kysely.selectFrom('external_game')
    .select(['league', day('played_on').as('played_on'), 'game_type', 'mixed', 'home1', 'home2', 'away1', 'away2',
      'home1_gender', 'home2_gender', 'away1_gender', 'away2_gender', 'home_score', 'away_score'])
    .orderBy('played_on').orderBy('id')
    .execute()
}

// Games held per league, with the latest date: what the import reports.
exports.summary = async function() {
  return kysely.selectFrom('external_game')
    .select(eb => ['league', eb.fn.countAll().as('games'),
      /** @type {import('kysely').RawBuilder<string>} */ (sql`to_char(max(played_on), 'YYYY-MM-DD')`).as('latest')])
    .groupBy('league').orderBy('league')
    .execute()
}
