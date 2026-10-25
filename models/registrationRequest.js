// @ts-check
// Player registration requests that arrived by email. See migrations/020 for why they
// exist and what `candidates` holds; utils/registrationEmail.js reads the email and
// controllers/playerRequestController.js is the page that works through them.

const { sql } = require('kysely')
const { kysely } = require('../db')

const OUTCOMES = ['created', 'attached', 'transferred', 'skipped']
exports.OUTCOMES = OUTCOMES

// jsonb columns take JSON.stringify(value): pg would send a JS array as a Postgres array
// literal, and the Json type does not stop it.

/** @typedef {import('kysely').RawBuilder<import('../db/schema').Json>} JsonExpr */

// Queue one email. Returns its id, or null when this message is already queued — SNS
// delivers at least once, and a redelivery must not add the same six players twice.
/**
 * @param {{ messageId: string, forwardedBy?: string | null, originalFrom?: string | null,
 *   subject?: string | null, bodyText?: string | null, attachments?: unknown[], candidates?: unknown[] }} email
 */
exports.create = async function({ messageId, forwardedBy, originalFrom, subject, bodyText, attachments, candidates }) {
  const row = await kysely.insertInto('registration_request')
    .values({
      message_id: messageId, forwarded_by: forwardedBy, original_from: originalFrom, subject,
      body_text: bodyText,
      attachments: JSON.stringify(attachments || []),
      candidates: JSON.stringify(candidates || []),
    })
    .onConflict(oc => oc.column('message_id').doNothing())
    .returning('id')
    .executeTakeFirst()
  return row ? Number(row.id) : null
}

/** @param {string} status */
exports.list = async function(status) {
  return kysely.selectFrom('registration_request')
    .select(['id', 'received_at as receivedAt', 'forwarded_by as forwardedBy',
      'original_from as originalFrom', 'subject', 'candidates', 'status',
      'closed_at as closedAt', 'closed_by as closedBy'])
    .where('status', '=', status)
    .orderBy('received_at', 'desc')
    .limit(100)
    .execute()
}

exports.countPending = async function() {
  const row = await kysely.selectFrom('registration_request')
    .select(eb => eb.cast(eb.fn.countAll(), 'integer').as('n'))
    .where('status', '=', 'pending')
    .executeTakeFirst()
  return row ? Number(row.n) : 0
}

/** @param {number} id */
exports.getById = async function(id) {
  const row = await kysely.selectFrom('registration_request')
    .select(['id', 'received_at as receivedAt', 'forwarded_by as forwardedBy',
      'original_from as originalFrom', 'subject', 'body_text as bodyText',
      'attachments', 'candidates', 'status', 'closed_at as closedAt', 'closed_by as closedBy'])
    .where('id', '=', id)
    .executeTakeFirst()
  return row || null
}

// Record what happened to one person on the request. The whole candidate is replaced
// by the edited version the page sends (a corrected spelling, a chosen team), so what
// is kept is what was actually registered rather than the first reading of the email.
//
// Written with jsonb_set on the one index, in one statement, so two tabs working the
// same request cannot overwrite each other's rows — only the same row.
/** @param {number} id @param {number} index @param {unknown} candidate */
exports.setCandidate = async function(id, index, candidate) {
  const replaced = /** @type {JsonExpr} */ (
    sql`jsonb_set(candidates, ARRAY[${String(index)}::text], ${JSON.stringify(candidate)}::jsonb)`)
  const row = await kysely.updateTable('registration_request')
    .set({ candidates: replaced })
    .where('id', '=', id)
    .where(eb => eb(eb.cast(eb.val(index), 'integer'), '<', eb.fn('jsonb_array_length', ['candidates'])))
    .returning('candidates')
    .executeTakeFirst()
  return row ? row.candidates : null
}

// Add a person the reading missed.
/** @param {number} id @param {unknown} candidate */
exports.appendCandidate = async function(id, candidate) {
  const appended = /** @type {JsonExpr} */ (
    sql`candidates || jsonb_build_array(${JSON.stringify(candidate)}::jsonb)`)
  const row = await kysely.updateTable('registration_request')
    .set({ candidates: appended })
    .where('id', '=', id)
    .returning('candidates')
    .executeTakeFirst()
  return row ? row.candidates : null
}

/** @param {number} id @param {string} status @param {string | null} by */
exports.setStatus = async function(id, status, by) {
  const closing = status !== 'pending'
  const row = await kysely.updateTable('registration_request')
    .set(eb => ({ status, closed_at: closing ? eb.fn('now') : null, closed_by: closing ? by : null }))
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst()
  return !!row
}

// Teams a player can be registered to: every team a real club owns. Teams under the
// No Club sentinel are retired ("Carrington B", "Unknown team") and offering them would
// put a new player somewhere nobody plays.
/** @param {number} noClubId */
exports.registrableTeams = async function(noClubId) {
  return kysely.selectFrom('team')
    .innerJoin('club', 'club.id', 'team.club')
    .select(['team.id', 'team.name', 'club.id as clubId', 'club.name as clubName'])
    .where('club.id', '<>', noClubId)
    .orderBy('club.name').orderBy('team.name')
    .execute()
}
