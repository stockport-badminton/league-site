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

/**
 * Every venue anything happens at, with what happens there.
 *
 * ── The red herring, which is what made this wrong ───────────────────────────
 *
 * `club."matchNightText"` and `club."matchVenue"` look like the answer to "where and when
 * does this club play". **They are not.** `matchNightText` is a hand-written summary that
 * lumps every team into one string — Featherforce's reads *"Weds & Thurs 8pm 2 courts"* —
 * and `matchVenue` can only name one place, so neither can describe a club whose teams
 * play on different nights or in different places.
 *
 * **The truth is per team**, in `team."matchDay"` and each team's own `team."venue"`.
 * Featherforce proves it here: Featherforce A plays Thursday and Featherforce B plays
 * Wednesday, and the club string tells a visitor neither of those things — only that the
 * club is out on both nights. Tameside had the sharper version of the same bug, where
 * G.H.A.P's two teams are at two different venues and both pins showed the same combined
 * sentence; that is what was reported and what prompted this.
 *
 * So this returns two separate things per venue, from the two places that actually know:
 *
 *   matchTeams  — from `team.venue`, one entry per TEAM, with that team's `matchDay`
 *   clubNights  — from `club.venue`, one entry per CLUB, with its `clubNightText`
 *
 * A venue can have either, or both.
 *
 * ── And why it returns data rather than HTML ─────────────────────────────────
 *
 * This used to build the popup markup in SQL with `concat`, interpolating the club name,
 * its website into an `href`, and the venue address — none of them escaped. The data
 * already contains `Mulberry's Sports Complex` and two `&`s; a `"` in a website would have
 * broken out of its attribute and a `<` anywhere would have broken the markup. The markup
 * now lives in `static/beta/js/venue-popup.js`, where it can be escaped and tested.
 *
 * Ported from the Tameside site (`Build the clubs map from teams, not from the club's
 * match-night summary`).
 */
exports.getVenueClubs = async function() {
  const [result] = await (await db.otherConnect()).query(
    `SELECT
       venue.name      AS "venueName",
       venue."Lat",
       venue."Lng",
       venue.address   AS "address",
       venue."gMapUrl" AS "gMapUrl",
       (
         SELECT json_agg(
                  json_build_object(
                    'club',     club.name,
                    'website',  club."clubWebsite",
                    'team',     team.name,
                    'matchDay', team."matchDay"
                  ) ORDER BY club.name, team.name)
         FROM team
         JOIN club ON club.id = team.club
         WHERE team.venue = venue.id
           AND team.withdrawn IS NULL
       ) AS "matchTeams",
       (
         SELECT json_agg(
                  json_build_object(
                    'club',          club.name,
                    'website',       club."clubWebsite",
                    'clubNightText', club."clubNightText"
                  ) ORDER BY club.name)
         FROM club
         WHERE club.venue = venue.id
       ) AS "clubNights"
     FROM venue
     WHERE EXISTS (SELECT 1 FROM team WHERE team.venue = venue.id AND team.withdrawn IS NULL)
        OR EXISTS (SELECT 1 FROM club WHERE club.venue = venue.id)
     ORDER BY venue.name`
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
