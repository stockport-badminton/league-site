var db = require('../db_connect.js');

exports.create = async function(name, league, rank) {
  const [result] = await (await db.otherConnect()).query(
    'INSERT INTO division (name,league,rank) VALUES (?,?,?)',
    [name, league, rank]
  )
  return result
}

exports.createBatch = async function(batchObj) {
  if (!db.isObject(batchObj)) throw new Error('not object')
  const fields = batchObj.fields.map(f => `"${f}"`).join(',')
  const rows = Object.values(batchObj.data).map(row => Object.values(row))
  const valueClauses = rows.map(row => '(' + row.map(() => '?').join(',') + ')').join(',')
  const sql = `INSERT INTO "${batchObj.tablename}" (${fields}) VALUES ${valueClauses}`
  const [result] = await (await db.otherConnect()).query(sql, rows.flat())
  return result
}

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

exports.deleteById = async function(divisionId) {
  const [result] = await (await db.otherConnect()).query('DELETE FROM division WHERE id = ?', divisionId)
  return result
}

exports.updateById = async function(name, league, rank, divisionId) {
  const [result] = await (await db.otherConnect()).query(
    'UPDATE division SET name = ?, league = ?, rank = ? WHERE id = ?',
    [name, league, rank, divisionId]
  )
  return result
}
