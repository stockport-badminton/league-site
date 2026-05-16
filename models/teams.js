var db = require('../db_connect.js');

const year = new Date().getFullYear()
const SEASON = new Date().getMonth() < 7
  ? `${year - 1}${year}`
  : `${year}${year + 1}`

exports.create = async function(name, starttime, endtime, matchDay, venue, courtspace, club, division, rank) {
  const [result] = await (await db.otherConnect()).query(
    'INSERT INTO team (name,starttime,endtime,"matchDay",venue,courtspace,club,division,rank) VALUES (?,?,?,?,?,?,?,?,?)',
    [name, starttime, endtime, matchDay, venue, courtspace, club, division, rank]
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
  const [result] = await (await db.otherConnect()).query('SELECT * FROM team')
  return result
}

exports.getMesser = async function(searchTerms) {
  const season = searchTerms.season || ''
  const [result] = await (await db.otherConnect()).query(`SELECT
    homeTeam.name AS "homeTeamName",
    homeTeam.handicap AS "homeTeamHandicap",
    awayTeam.name AS "awayTeamName",
    awayTeam.handicap AS "awayTeamHandicap",
    messer."homeScore",
    messer."awayScore",
    messer."drawPos"
FROM
    messer${season} messer
    JOIN team${season} homeTeam ON messer."homeTeam" = homeTeam.id
    JOIN team${season} awayTeam ON messer."awayTeam" = awayTeam.id
WHERE messer.section LIKE ?`, searchTerms.section)
  return result
}

exports.getTeams = async function(searchObject) {
  if (!db.isObject(searchObject)) throw new Error('not object')
  let sql = 'SELECT * FROM team'
  const whereTerms = []
  const params = []

  if (searchObject.divisionId) {
    whereTerms.push('division = ?')
    params.push(searchObject.divisionId)
  }
  if (searchObject.teamName) {
    whereTerms.push('name = ?')
    params.push(searchObject.teamName)
  }
  if (searchObject.clubid) {
    whereTerms.push('club = ?')
    params.push(searchObject.clubid)
  }
  if (searchObject.section) {
    whereTerms.push('section = ?')
    params.push(searchObject.section)
  }

  if (whereTerms.length > 0) sql += ' WHERE ' + whereTerms.join(' AND ')

  const [result] = await (await db.otherConnect()).query(sql, params)
  return result
}

exports.getById = async function(teamId) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM team WHERE id = ?', teamId)
  return result
}

exports.getByName = async function(teamName) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM team WHERE name = ?', teamName)
  return result
}

exports.getAllAndSelectedByName = async function(teamName, divisionId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT *, CASE WHEN team.name = ? THEN true ELSE false END as selected FROM team WHERE division = ?',
    [teamName, divisionId]
  )
  return result
}

exports.getAllAndSelectedById = async function(teamId, divisionId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT *, CASE WHEN team.id = ? THEN true ELSE false END as selected FROM team WHERE division = ?',
    [teamId, divisionId]
  )
  return result
}

exports.deleteById = async function(teamId) {
  const [result] = await (await db.otherConnect()).query('DELETE FROM team WHERE id = ?', teamId)
  return result
}

exports.updateById = async function(teamObj, teamId) {
  if (!db.isObject(teamObj)) throw new Error('not valid object')
  const setClauses = Object.keys(teamObj).map(k => `"${k}" = ?`).join(', ')
  const sql = `UPDATE team SET ${setClauses} WHERE id = ?`
  const [result] = await (await db.otherConnect()).query(sql, [...Object.values(teamObj), teamId])
  return result
}
