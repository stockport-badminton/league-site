var db = require('../db_connect.js');

exports.getAll = async function() {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM division')
  return result
}

exports.getAllByLeague = async function(leagueId) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM division WHERE league = ?', leagueId)
  return result
}

exports.getById = async function(divisionId) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM division WHERE id = ?', divisionId)
  return result
}

exports.getByName = async function(divisionName) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM division WHERE name = ?', divisionName)
  return result
}

exports.getIdByURLParam = async function(divisionName) {
  divisionName = divisionName.replace('-', ' ');
  const [result] = await (await db.otherConnect()).query('SELECT id FROM division WHERE name = ?', divisionName)
  return result
}

exports.getAllAndSelectedByName = async function(leagueId, divisionName) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT *, CASE WHEN division.name = ? THEN true ELSE false END as selected FROM division WHERE league = ?',
    [divisionName, leagueId]
  )
  return result
}

exports.getAllAndSelectedById = async function(leagueId, divisionId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT *, CASE WHEN division.id = ? THEN true ELSE false END as selected FROM division WHERE league = ?',
    [divisionId, leagueId]
  )
  return result
}
