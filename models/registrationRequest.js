// Player registration requests that arrived by email. See migrations/020 for why they
// exist and what `candidates` holds; utils/registrationEmail.js reads the email and
// controllers/playerRequestController.js is the page that works through them.

const db = require('../db_connect.js')

const OUTCOMES = ['created', 'attached', 'transferred', 'skipped']
exports.OUTCOMES = OUTCOMES

// Queue one email. Returns its id, or null when this message is already queued — SNS
// delivers at least once, and a redelivery must not add the same six players twice.
exports.create = async function({ messageId, forwardedBy, originalFrom, subject, bodyText, attachments, candidates }) {
  const [rows] = await (await db.otherConnect()).query(
    `INSERT INTO registration_request
       (message_id, forwarded_by, original_from, subject, body_text, attachments, candidates)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)
     ON CONFLICT (message_id) DO NOTHING
     RETURNING id`,
    [messageId, forwardedBy, originalFrom, subject, bodyText,
      JSON.stringify(attachments || []), JSON.stringify(candidates || [])]
  )
  return rows.length ? Number(rows[0].id) : null
}

exports.list = async function(status) {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT id, received_at AS "receivedAt", forwarded_by AS "forwardedBy",
            original_from AS "originalFrom", subject, candidates, status,
            closed_at AS "closedAt", closed_by AS "closedBy"
     FROM registration_request
     WHERE status = ?
     ORDER BY received_at DESC
     LIMIT 100`,
    [status]
  )
  return rows
}

exports.countPending = async function() {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT count(*)::int AS n FROM registration_request WHERE status = 'pending'`
  )
  return rows[0] ? rows[0].n : 0
}

exports.getById = async function(id) {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT id, received_at AS "receivedAt", forwarded_by AS "forwardedBy",
            original_from AS "originalFrom", subject, body_text AS "bodyText",
            attachments, candidates, status, closed_at AS "closedAt", closed_by AS "closedBy"
     FROM registration_request
     WHERE id = ?`,
    [id]
  )
  return rows[0] || null
}

// Record what happened to one person on the request. The whole candidate is replaced
// by the edited version the page sends (a corrected spelling, a chosen team), so what
// is kept is what was actually registered rather than the first reading of the email.
//
// Written with jsonb_set on the one index, in one statement, so two tabs working the
// same request cannot overwrite each other's rows — only the same row.
exports.setCandidate = async function(id, index, candidate) {
  const [rows] = await (await db.otherConnect()).query(
    `UPDATE registration_request
     SET candidates = jsonb_set(candidates, ARRAY[?::text], ?::jsonb)
     WHERE id = ? AND ?::int < jsonb_array_length(candidates)
     RETURNING candidates`,
    [String(index), JSON.stringify(candidate), id, index]
  )
  return rows.length ? rows[0].candidates : null
}

// Add a person the reading missed.
exports.appendCandidate = async function(id, candidate) {
  const [rows] = await (await db.otherConnect()).query(
    `UPDATE registration_request
     SET candidates = candidates || jsonb_build_array(?::jsonb)
     WHERE id = ?
     RETURNING candidates`,
    [JSON.stringify(candidate), id]
  )
  return rows.length ? rows[0].candidates : null
}

exports.setStatus = async function(id, status, by) {
  const closing = status !== 'pending'
  const [rows] = await (await db.otherConnect()).query(
    `UPDATE registration_request
     SET status = ?, closed_at = ${closing ? 'now()' : 'NULL'}, closed_by = ?
     WHERE id = ?
     RETURNING id`,
    [status, closing ? by : null, id]
  )
  return rows.length > 0
}

// Teams a player can be registered to: every team a real club owns. Teams under the
// No Club sentinel are retired ("Carrington B", "Unknown team") and offering them would
// put a new player somewhere nobody plays.
exports.registrableTeams = async function(noClubId) {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT team.id, team.name, club.id AS "clubId", club.name AS "clubName"
     FROM team
     JOIN club ON club.id = team.club
     WHERE club.id <> ?
     ORDER BY club.name, team.name`,
    [noClubId]
  )
  return rows
}
