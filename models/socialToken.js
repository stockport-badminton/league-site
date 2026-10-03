// Tokens the app renews itself. One row per platform, in `social_token`.
//
// See migrations/019_social_token.sql for why this is a table rather than an environment
// variable, and why `generation` exists.
//
// The token is pgp_sym_encrypt'd. DB_PI_KEY is BOUND AS A PARAMETER on every statement
// and never interpolated (__tests__/unit/no-secrets-in-sql.test.js enforces it).

const db = require('../db_connect.js');

function key() {
  const k = process.env.DB_PI_KEY;
  if (!k) throw new Error('DB_PI_KEY is not set, so the social token cannot be read or stored');
  return k;
}

// Everything except the token. Anything that only needs to *describe* the connection
// (the admin page, the refresh job's decision) reads this and never decrypts.
const STATUS_COLUMNS = `
  platform,
  account_id    AS "accountId",
  username,
  obtained_at   AS "obtainedAt",
  expires_at    AS "expiresAt",
  refreshed_at  AS "refreshedAt",
  last_error    AS "lastError",
  last_error_at AS "lastErrorAt",
  generation,
  updated_by    AS "updatedBy",
  updated_at    AS "updatedAt"`;

exports.status = async function(platform) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `SELECT ${STATUS_COLUMNS} FROM social_token WHERE platform = ?`, [platform]);
  return rows[0] || null;
};

/** The status plus the decrypted token. Only for code that is about to call the API. */
exports.withToken = async function(platform) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `SELECT ${STATUS_COLUMNS}, pgp_sym_decrypt(token, ?)::text AS token
     FROM social_token WHERE platform = ?`, [key(), platform]);
  return rows[0] || null;
};

/**
 * A person has just logged in. Replaces whatever was there, including a different
 * account, because a login is the recovery path and has to win.
 */
exports.saveLogin = async function(platform, { accountId, username, token, expiresIn, updatedBy }) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `INSERT INTO social_token
       (platform, account_id, username, token, obtained_at, expires_at,
        refreshed_at, last_error, last_error_at, generation, updated_by, updated_at)
     VALUES (?, ?, ?, pgp_sym_encrypt(?, ?), now(), now() + make_interval(secs => ?),
             NULL, NULL, NULL, 1, ?, now())
     ON CONFLICT (platform) DO UPDATE SET
       account_id    = EXCLUDED.account_id,
       username      = EXCLUDED.username,
       token         = EXCLUDED.token,
       obtained_at   = EXCLUDED.obtained_at,
       expires_at    = EXCLUDED.expires_at,
       refreshed_at  = NULL,
       last_error    = NULL,
       last_error_at = NULL,
       generation    = social_token.generation + 1,
       updated_by    = EXCLUDED.updated_by,
       updated_at    = now()
     RETURNING generation`,
    [platform, String(accountId), username || null, token, key(), Number(expiresIn), updatedBy || null]);
  return rows[0] ? rows[0].generation : null;
};

/**
 * A refresh succeeded. Written only if the row is still the one the refresh read, so a
 * login that landed in between is kept. Returns the number of rows written, 0 or 1.
 *
 * The count is read from `rows.affectedRows`, NOT from a second tuple element. The
 * wrapper returns `[rows]` and nothing else (CLAUDE.md gotcha 2d).
 */
exports.saveRefresh = async function(platform, { token, expiresIn, generation, updatedBy }) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `UPDATE social_token SET
       token         = pgp_sym_encrypt(?, ?),
       obtained_at   = now(),
       expires_at    = now() + make_interval(secs => ?),
       refreshed_at  = now(),
       last_error    = NULL,
       last_error_at = NULL,
       generation    = generation + 1,
       updated_by    = ?,
       updated_at    = now()
     WHERE platform = ? AND generation = ?`,
    [token, key(), Number(expiresIn), updatedBy || null, platform, Number(generation)]);
  return rows.affectedRows || 0;
};

/** A refresh failed. The token is left alone: it may well still work until it expires. */
exports.recordError = async function(platform, message) {
  const conn = await db.otherConnect();
  await conn.query(
    `UPDATE social_token SET last_error = ?, last_error_at = now() WHERE platform = ?`,
    [String(message).slice(0, 1000), platform]);
};

/**
 * The stored account if it can post right now, or why not. Every route that posts checks
 * this before doing anything, so a missing or expired token is a 503 that names the
 * recovery, never an attempt that fails halfway.
 */
exports.usable = async function(platform) {
  const row = await exports.withToken(platform);
  if (!row) return { error: 'No Threads account is connected. Connect one at /admin/threads.' };
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return { error: 'The Threads token has expired. Connect again at /admin/threads.' };
  }
  return { account: row };
};
