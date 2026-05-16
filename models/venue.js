var db = require('../db_connect.js');

exports.create = async function(name, address, gMapUrl) {
  const [result] = await (await db.otherConnect()).query(
    'INSERT INTO venue (name,address,"gMapUrl") VALUES (?,?,?)',
    [name, address, gMapUrl]
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
  const [result] = await (await db.otherConnect()).query('SELECT * FROM venue')
  return result
}

exports.getVenueClubs = async function() {
  const [result] = await (await db.otherConnect()).query(
    `SELECT venueName, "Lat", "Lng", STRING_AGG(venueClubsHTML, '<br />') AS venueInfoBox
     FROM (
       SELECT venueName, "Lat", "Lng",
         concat('<strong id="firstHeading" class="firstHeading"><a href="',"clubWebsite",'">',clubName,'</a></strong><div id="bodyContent"><p>Match Night:',"matchNightText",'<br />Club Night:',"clubNightText",'<br />Address:<a href="',"gMapUrl",'">',address,'</a></p></div>') AS venueClubsHTML
       FROM (
         SELECT venue.name AS venueName, venue.address, venue."gMapUrl", venue."Lat", venue."Lng",
                club.name AS clubName, club."matchNightText", club."clubNightText", club."clubWebsite"
         FROM venue JOIN club ON venue.id = club.venue
         UNION
         SELECT venue.name AS venueName, venue.address, venue."gMapUrl", venue."Lat", venue."Lng",
                club.name AS clubName, club."matchNightText", club."clubNightText", club."clubWebsite"
         FROM venue JOIN club ON venue.id = club."matchVenue"
       ) AS venueInfo
     ) AS groupedVenueInfo
     GROUP BY venueName, "Lat", "Lng"`
  )
  return result
}

exports.getById = async function(venueId) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM venue WHERE id = ?', venueId)
  return result
}

exports.deleteById = async function(venueId) {
  const [result] = await (await db.otherConnect()).query('DELETE FROM venue WHERE id = ?', venueId)
  return result
}

exports.updateById = async function(name, address, gMapUrl, venueId) {
  const [result] = await (await db.otherConnect()).query(
    'UPDATE venue SET name = ?, address = ?, "gMapUrl" = ? WHERE id = ?',
    [name, address, gMapUrl, venueId]
  )
  return result
}
