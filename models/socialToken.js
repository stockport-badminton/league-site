// @ts-check
// Tokens the app renews itself. One row per platform, in `social_token`.
//
// See migrations/019_social_token.sql for why this is a table rather than an environment
// variable, and why `generation` exists.
//
// The token is pgp_sym_encrypt'd, read and written only through db/encrypted.js, which
// binds DB_PI_KEY as a parameter and has no way not to.

const { sql } = require('kysely');
const { kysely, encrypt, decrypt } = require('../db');

/**
 * `now() + make_interval(secs => n)`: when a token that lasts `secs` from now expires.
 * @param {number} secs
 */
const fromNow = secs =>
  /** @type {import('kysely').RawBuilder<Date>} */ (sql`now() + make_interval(secs => ${secs})`);

// Everything except the token. Anything that only needs to *describe* the connection
// (the admin page, the refresh job's decision) reads this and never decrypts.
const STATUS_COLUMNS = /** @type {const} */ ([
  'platform',
  'account_id as accountId',
  'username',
  'obtained_at as obtainedAt',
  'expires_at as expiresAt',
  'refreshed_at as refreshedAt',
  'last_error as lastError',
  'last_error_at as lastErrorAt',
  'generation',
  'updated_by as updatedBy',
  'updated_at as updatedAt',
]);

/** @param {string} platform */
exports.status = async function(platform) {
  const row = await kysely.selectFrom('social_token').select(STATUS_COLUMNS)
    .where('platform', '=', platform).executeTakeFirst();
  return row || null;
};

/**
 * The status plus the decrypted token. Only for code that is about to call the API.
 * @param {string} platform
 */
exports.withToken = async function(platform) {
  const row = await kysely.selectFrom('social_token').select(STATUS_COLUMNS)
    .select(eb => decrypt(eb.ref('token')).as('token'))
    .where('platform', '=', platform).executeTakeFirst();
  return row || null;
};

/**
 * A person has just logged in. Replaces whatever was there, including a different
 * account, because a login is the recovery path and has to win.
 * @param {string} platform
 * @param {{ accountId: string | number, username?: string, token: string, expiresIn: number | string, updatedBy?: string }} login
 */
exports.saveLogin = async function(platform, { accountId, username, token, expiresIn, updatedBy }) {
  const row = await kysely.insertInto('social_token')
    .values(eb => ({
      platform, account_id: String(accountId), username: username || null, token: encrypt(token),
      obtained_at: eb.fn('now'), expires_at: fromNow(Number(expiresIn)),
      refreshed_at: null, last_error: null, last_error_at: null, generation: 1,
      updated_by: updatedBy || null, updated_at: eb.fn('now'),
    }))
    .onConflict(oc => oc.column('platform').doUpdateSet(eb => ({
      account_id: eb.ref('excluded.account_id'),
      username: eb.ref('excluded.username'),
      token: eb.ref('excluded.token'),
      obtained_at: eb.ref('excluded.obtained_at'),
      expires_at: eb.ref('excluded.expires_at'),
      refreshed_at: null,
      last_error: null,
      last_error_at: null,
      generation: eb('social_token.generation', '+', 1),
      updated_by: eb.ref('excluded.updated_by'),
      updated_at: eb.fn('now'),
    })))
    .returning('generation')
    .executeTakeFirst();
  return row ? row.generation : null;
};

/**
 * A refresh succeeded. Written only if the row is still the one the refresh read, so a
 * login that landed in between is kept. Returns the number of rows written, 0 or 1.
 * @param {string} platform
 * @param {{ token: string, expiresIn: number | string, generation: number | string, updatedBy?: string }} refresh
 */
exports.saveRefresh = async function(platform, { token, expiresIn, generation, updatedBy }) {
  const res = await kysely.updateTable('social_token')
    .set(eb => ({
      token: encrypt(token),
      obtained_at: eb.fn('now'),
      expires_at: fromNow(Number(expiresIn)),
      refreshed_at: eb.fn('now'),
      last_error: null,
      last_error_at: null,
      generation: eb('generation', '+', 1),
      updated_by: updatedBy || null,
      updated_at: eb.fn('now'),
    }))
    .where('platform', '=', platform).where('generation', '=', Number(generation))
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
};

/**
 * A refresh failed. The token is left alone: it may well still work until it expires.
 * @param {string} platform @param {unknown} message
 */
exports.recordError = async function(platform, message) {
  await kysely.updateTable('social_token')
    .set(eb => ({ last_error: String(message).slice(0, 1000), last_error_at: eb.fn('now') }))
    .where('platform', '=', platform).execute();
};

/**
 * The stored account if it can post right now, or why not. Every route that posts checks
 * this before doing anything, so a missing or expired token is a 503 that names the
 * recovery, never an attempt that fails halfway.
 */
/** @param {string} platform */
exports.usable = async function(platform) {
  const row = await exports.withToken(platform);
  if (!row) return { error: 'No Threads account is connected. Connect one at /admin/threads.' };
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return { error: 'The Threads token has expired. Connect again at /admin/threads.' };
  }
  return { account: row };
};
