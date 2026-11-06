// @ts-check
// auth_account_notice (migration 034): the monthly login cull's record of warnings sent and
// logins kept. See controllers/authCullController.js.

const crypto = require('crypto')
const { sql } = require('kysely')
const { kysely } = require('../db')

/** @param {string} token */
const hash = token => crypto.createHash('sha256').update(String(token)).digest()
const NOW = /** @type {import('kysely').RawBuilder<Date>} */ (sql`now()`)

/** @returns {Promise<Map<string, { user_id: string, notified_at: Date | null, kept_at: Date | null }>>} */
exports.getAll = async function() {
  const rows = await kysely.selectFrom('auth_account_notice')
    .select(['user_id', 'notified_at', 'kept_at'])
    .execute()
  return new Map(rows.map(r => [r.user_id, r]))
}

// A new warning: a new keep token, and any earlier keep forgotten (it belongs to an
// earlier year, or the warning would not be going out).
/** @param {string} userId @param {string} token */
exports.recordNotice = async function(userId, token) {
  await kysely.insertInto('auth_account_notice')
    .values({ user_id: userId, notified_at: NOW, keep_token_hash: hash(token), kept_at: null })
    .onConflict(oc => oc.column('user_id').doUpdateSet(eb => ({
      notified_at: NOW, keep_token_hash: eb.ref('excluded.keep_token_hash'), kept_at: null,
    })))
    .execute()
}

// The keep link's account, or undefined. Used by the GET, which changes nothing.
/** @param {string} token */
exports.findByToken = async function(token) {
  return kysely.selectFrom('auth_account_notice')
    .select(['user_id', 'notified_at'])
    .where('keep_token_hash', '=', hash(token))
    .executeTakeFirst()
}

// Spends the token: one confirmation per warning.
/** @param {string} token */
exports.keepByToken = async function(token) {
  return kysely.updateTable('auth_account_notice')
    .set({ kept_at: NOW, keep_token_hash: null })
    .where('keep_token_hash', '=', hash(token))
    .returning('user_id')
    .executeTakeFirst()
}

// A superadmin knows this person is still about.
/** @param {string} userId */
exports.keep = async function(userId) {
  await kysely.insertInto('auth_account_notice')
    .values({ user_id: userId, kept_at: NOW })
    .onConflict(oc => oc.column('user_id').doUpdateSet({ kept_at: NOW, keep_token_hash: null }))
    .execute()
}

/** @param {string} userId */
exports.remove = async function(userId) {
  await kysely.deleteFrom('auth_account_notice').where('user_id', '=', userId).execute()
}
