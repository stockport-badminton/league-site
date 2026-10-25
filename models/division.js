// @ts-check
const { kysely } = require('../db');

// Values are bound exactly as the string queries bound them. Several callers pass an id as
// a string straight from req.params; Postgres coerces '8' to 8, as it always has. The JSDoc
// says number because that is what the column holds — converting here would change what
// a junk value does (Number(undefined) is NaN, which Postgres rejects; undefined binds as
// NULL and finds nothing).
//
// None of these has an ORDER BY, and none had one before: callers that care sort for
// themselves (teamController sorts getAllByLeague by rank). Adding one would be a change,
// not a conversion.

exports.getAll = async function() {
  return kysely.selectFrom('division').selectAll().execute()
}

/** @param {number} leagueId */
exports.getAllByLeague = async function(leagueId) {
  return kysely.selectFrom('division').selectAll().where('league', '=', leagueId).execute()
}

/** @param {number} divisionId */
exports.getById = async function(divisionId) {
  return kysely.selectFrom('division').selectAll().where('id', '=', divisionId).execute()
}

/** @param {string | null} divisionName */
exports.getByName = async function(divisionName) {
  return kysely.selectFrom('division').selectAll().where('name', '=', divisionName).execute()
}

// Only the first hyphen becomes a space, as it always has: 'Division-1' is the only shape
// that reaches this.
/** @param {string} divisionName */
exports.getIdByURLParam = async function(divisionName) {
  divisionName = divisionName.replace('-', ' ');
  return kysely.selectFrom('division').select('id').where('name', '=', divisionName).execute()
}

/** @param {number} leagueId @param {string | null} divisionName */
exports.getAllAndSelectedByName = async function(leagueId, divisionName) {
  return kysely.selectFrom('division').selectAll()
    .select(eb => eb.case().when('name', '=', divisionName).then(eb.lit(true)).else(eb.lit(false)).end().as('selected'))
    .where('league', '=', leagueId)
    .execute()
}

/** @param {number} leagueId @param {number | null} divisionId */
exports.getAllAndSelectedById = async function(leagueId, divisionId) {
  return kysely.selectFrom('division').selectAll()
    .select(eb => eb.case().when('id', '=', divisionId).then(eb.lit(true)).else(eb.lit(false)).end().as('selected'))
    .where('league', '=', leagueId)
    .execute()
}
