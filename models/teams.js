// @ts-check
var db = require('../db_connect.js');
var seasonModel = require('./season');
const { kysely } = require('../db');

// REARCH-01: on the typed query layer, except getMesser, which splices a season into a
// table name and belongs to REARCH-02. Values are bound as the string queries bound them:
// several callers pass ids as strings from req.params, which Postgres coerces.


exports.getAll = async function() {
  return kysely.selectFrom('team').selectAll().execute()
}

/** @param {{ season: string, section: string }} searchTerms */
exports.getMesser = async function(searchTerms) {
  // Interpolated below as messer${season} / team${season}, so it must be validated
  // rather than bound — see models/season.js.
  const season = seasonModel.assertName(searchTerms.season)
  const [result] = await (await db.otherConnect()).query(`SELECT
    homeTeam.name AS "homeTeamName",
    homeTeam.handicap AS "homeTeamHandicap",
    awayTeam.name AS "awayTeamName",
    awayTeam.handicap AS "awayTeamHandicap",
    messer."homeScore",
    messer."awayScore",
    messer."drawPos",
    messer.id,
    messer."homeTeam",
    messer."awayTeam"
FROM
    messer${season} messer
    JOIN team${season} homeTeam ON messer."homeTeam" = homeTeam.id
    JOIN team${season} awayTeam ON messer."awayTeam" = awayTeam.id
WHERE messer.section LIKE ?`, [searchTerms.section])
  return result
}

// Filters only on the keys it knows, and only when they are truthy: it is handed req.body,
// so `divisionId: 0` or an unknown key means "no filter", as it always has.
/** @param {{ divisionId?: number, teamName?: string, clubid?: number, section?: string }} searchObject */
exports.getTeams = async function(searchObject) {
  if (!db.isObject(searchObject)) throw new Error('not object')
  return kysely.selectFrom('team').selectAll()
    .$if(!!searchObject.divisionId, qb => qb.where('division', '=', /** @type {number} */ (searchObject.divisionId)))
    .$if(!!searchObject.teamName, qb => qb.where('name', '=', /** @type {string} */ (searchObject.teamName)))
    .$if(!!searchObject.clubid, qb => qb.where('club', '=', /** @type {number} */ (searchObject.clubid)))
    .$if(!!searchObject.section, qb => qb.where('section', '=', /** @type {string} */ (searchObject.section)))
    .execute()
}

/** @param {number} teamId */
exports.getById = async function(teamId) {
  return kysely.selectFrom('team').selectAll().where('id', '=', teamId).execute()
}

/** @param {string} teamName */
exports.getByName = async function(teamName) {
  return kysely.selectFrom('team').selectAll().where('name', '=', teamName).execute()
}

/** @param {string | null} teamName @param {number} divisionId */
exports.getAllAndSelectedByName = async function(teamName, divisionId) {
  return kysely.selectFrom('team').selectAll()
    .select(eb => eb.case().when('team.name', '=', teamName).then(eb.lit(true)).else(eb.lit(false)).end().as('selected'))
    .where('division', '=', divisionId)
    .execute()
}

/** @param {number | null} teamId @param {number} divisionId */
exports.getAllAndSelectedById = async function(teamId, divisionId) {
  return kysely.selectFrom('team').selectAll()
    .select(eb => eb.case().when('team.id', '=', teamId).then(eb.lit(true)).else(eb.lit(false)).end().as('selected'))
    .where('division', '=', divisionId)
    .execute()
}

// Update or insert a team from an object of {column: value} pairs; only the provided keys
// are written, and Kysely quotes every column. A key whose value is `undefined` is left
// out, where the string version wrote NULL: teamController's buildTeamObj sets every key
// to a value or null, and its divRank move passes two defined values. Both return
// nothing; teamController never read the old rows array.
/** @param {import('kysely').Updateable<import('../db/schema').Team>} teamObj @param {number} teamId */
exports.updateById = async function(teamObj, teamId) {
  if (!db.isObject(teamObj)) throw new Error('not valid object')
  await kysely.updateTable('team').set(teamObj).where('id', '=', teamId).execute()
}

/** @param {import('kysely').Insertable<import('../db/schema').Team>} teamObj */
exports.createFull = async function(teamObj) {
  if (!db.isObject(teamObj)) throw new Error('not valid object')
  await kysely.insertInto('team').values(teamObj).execute()
}

// Next divRank (max+1) within a division — used when moving a team into a
// division so it sorts to the bottom until standings are finalised. divRank
// is NOT NULL, so a moved team always needs a concrete value.
/** @param {number} divisionId */
exports.getNextDivRank = async function(divisionId) {
  const row = await kysely.selectFrom('team')
    .select(eb => eb(eb.fn.coalesce(eb.fn.max('divRank'), eb.lit(0)), '+', eb.lit(1)).as('next'))
    .where('division', '=', divisionId)
    .executeTakeFirstOrThrow()
  return row.next
}

/** @param {string} section */
exports.getTeamsBySection = async function(section) {
  return kysely.selectFrom('team').select(['id', 'name']).where('section', '=', section).orderBy('name').execute()
}

/** @param {number} teamId @param {string} section */
exports.getAllAndSelectedBySection = async function(teamId, section) {
  return kysely.selectFrom('team').selectAll()
    .select(eb => eb.case().when('team.id', '=', teamId).then(eb.lit(true)).else(eb.lit(false)).end().as('selected'))
    .where('section', '=', section)
    .orderBy('name')
    .execute()
}
