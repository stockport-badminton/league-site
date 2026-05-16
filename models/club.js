var db = require('../db_connect.js');

exports.create = async function(name, venue) {
  const [result] = await (await db.otherConnect()).query(
    'INSERT INTO club (name,venue) VALUES (?,?)',
    [name, venue]
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
  const [result] = await (await db.otherConnect()).query('SELECT * FROM club ORDER BY name ASC')
  return result
}

exports.clubDetail = async function() {
  const [result] = await (await db.otherConnect()).query(`SELECT
  club.id AS clubId,
  club.name,
  team.name AS teamName,
  team."matchDay" AS matchDay,
  venue.name AS clubvenue,
  venue."gMapUrl" AS clubgmap,
  venue.address AS clubaddress,
  club."matchNightText",
  club."clubNightText",
  club."clubWebsite",
  club."matchVenue",
  teamvenue.name AS teammatchvenue,
  teamvenue."gMapUrl" AS teamgmap,
  teamvenue.address AS teamaddress
FROM
  club
  JOIN team ON team.club = club.id
  JOIN venue ON venue.id = club.venue
  JOIN venue teamvenue ON teamvenue.id = team.venue
ORDER BY
  name, teamName
`)
  return result
}

exports.clubDetailbyId = async function(clubId) {
  const [result] = await (await db.otherConnect()).query(
    `SELECT a.clubId, a.name, a.venue, a.address, a."gMapUrl" AS clubVenueURL,
            a."matchNightText", a."clubNightText", a."clubWebsite",
            venue.name AS matchVenueName, venue."gMapUrl" AS matchVenueURL,
            venue."Lat", venue."Lng"
     FROM (
       SELECT club.id AS clubId, club.name, venue.name AS venue, venue."gMapUrl", venue.address,
              club."matchNightText", club."clubNightText", club."clubWebsite", club."matchVenue"
       FROM club JOIN venue ON venue.id = club.venue
     ) AS a
     JOIN venue ON a."matchVenue" = venue.id
     WHERE a.clubId = ?
     ORDER BY a.name`,
    clubId
  )
  return result
}

exports.getContactDetailsById = async function(clubId) {
  console.log(clubId)
  const [result] = await (await db.otherConnect()).query(
    `SELECT club.name AS clubName, team.name AS teamName,
            venue.id AS venueId, venue.name AS venueName, venue.address AS address,
            "matchVenue".id AS matchVenueId, "matchVenue".name AS matchVenueName, "matchVenue".address AS matchVenueAddress,
            "matchNightText" AS matchNight,
            CONCAT(matchSec.first_name, ' ', matchSec.family_name) AS matchSecretary,
            pgp_sym_decrypt(matchSec."playerTel", 'euvbdijnyvshmcf')::text AS matchSecTel,
            pgp_sym_decrypt(matchSec."playerEmail", 'euvbdijnyvshmcf')::text AS matchSecEmail,
            CONCAT(clubSec.first_name, ' ', clubSec.family_name) AS clubSecretary,
            pgp_sym_decrypt(clubSec."playerTel", 'euvbdijnyvshmcf')::text AS clubSecTel,
            pgp_sym_decrypt(clubSec."playerEmail", 'euvbdijnyvshmcf')::text AS clubSecEmail,
            CONCAT(teamCaptain.first_name, ' ', teamCaptain.family_name) AS teamCaptain,
            pgp_sym_decrypt(teamCaptain."playerTel", 'euvbdijnyvshmcf')::text AS teamCaptainTel,
            pgp_sym_decrypt(teamCaptain."playerEmail", 'euvbdijnyvshmcf')::text AS teamCaptainEmail
     FROM club
     JOIN team ON team.club = club.id
     JOIN venue ON club.venue = venue.id
     JOIN venue "matchVenue" ON club."matchVenue" = "matchVenue".id
     JOIN player matchSec ON club.id = matchSec.club AND matchSec."matchSecrertary" = 1
     JOIN player clubSec ON ((club.id = clubSec.club AND clubSec."clubSecretary" = 1) OR (club."clubSec" = clubSec.id))
     JOIN player teamCaptain ON ((team.id = teamCaptain.team AND teamCaptain."teamCaptain" = 1) OR (team.captain = teamCaptain.id))
     WHERE club.id = ?
     GROUP BY teamCaptain.id, teamCaptain.first_name, teamCaptain.family_name, teamCaptain."playerTel", teamCaptain."playerEmail",
              team.name,
              venue.id, venue.name, venue.address,
              "matchVenue".id, "matchVenue".name, "matchVenue".address,
              club."matchNightText",
              matchSec.first_name, matchSec.family_name, matchSec."playerTel", matchSec."playerEmail",
              clubSec.first_name, clubSec.family_name, clubSec."playerTel", clubSec."playerEmail",
              club.name, club.id
     ORDER BY teamName`,
    clubId
  )
  return result
}

exports.getById = async function(clubId) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM club WHERE id = ?', clubId)
  return result
}

exports.deleteById = async function(clubId) {
  const [result] = await (await db.otherConnect()).query('DELETE FROM club WHERE id = ?', clubId)
  return result
}

exports.updateById = async function(name, venue, clubId) {
  const [result] = await (await db.otherConnect()).query(
    'UPDATE club SET name = ?, venue = ? WHERE id = ?',
    [name, venue, clubId]
  )
  return result
}
