// Read-only DB lookups for tests that need a real row id.
//
// /populated-scorecard-beta/:id is only ever reached from a link emailed to the
// away captain (see the confirmation flow in controllers/scorecardController.js),
// so there is no page a test can discover an id from, and hardcoding one would
// break as soon as that draft is processed.
//
// SELECT only. The same read-only rule as e2e/helpers/read-only.js applies here
// for the same reason: dev.env points at the production database.

require('dotenv').config({ path: 'dev.env' });
const db = require('../../db_connect.js');

let connected = false;

async function query(sql, params) {
  if (!connected) { db.connect(); connected = true; }
  const [rows] = await (await db.otherConnect()).query(sql, params || []);
  return rows;
}

/** Newest scorecard draft id, or null if there are none. */
async function latestScorecardDraftId() {
  const rows = await query('SELECT id FROM scorecardstore ORDER BY id DESC LIMIT 1');
  return rows.length ? rows[0].id : null;
}

/**
 * The path a captain would follow from their email for the newest draft: the id plus
 * the confirmation token, which /populated-scorecard-beta/:id now requires (HARD-03).
 * Returns null when there are no drafts.
 *
 * The token is read through to_jsonb rather than as a column so that this works both
 * before and after migrations/011_scorecard_confirm_token.sql is applied — `->>` on a
 * key that isn't there is NULL, where a missing column is an error. A draft with no
 * token is grandfathered by the app and opens without one.
 */
async function latestScorecardDraftPath() {
  const rows = await query(
    `SELECT id, to_jsonb(s) ->> 'confirmToken' AS token
       FROM scorecardstore s ORDER BY id DESC LIMIT 1`);
  if (!rows.length) return null;
  const { id, token } = rows[0];
  return '/populated-scorecard-beta/' + id + (token ? '?t=' + encodeURIComponent(token) : '');
}

/** Newest messer draft id, or null if there are none. */
async function latestMesserDraftId() {
  const rows = await query('SELECT id FROM messer_scorecard ORDER BY id DESC LIMIT 1');
  return rows.length ? rows[0].id : null;
}

/**
 * Whether a draft actually holds scores. The one messer draft currently in the
 * database is a partial row with almost every score null, so asserting that the
 * populated view prefills would be asserting against the data rather than the
 * view. Tests use this to skip the prefill check while keeping the structural ones.
 */
async function draftHasScores(table, id) {
  if (!id) return false;
  // Whitelisted, not interpolated from anything a caller could vary at runtime.
  const allowed = { scorecardstore: true, messer_scorecard: true };
  if (!allowed[table]) throw new Error('unexpected table: ' + table);
  const rows = await query(
    `SELECT "Game1homeScore", "Game1awayScore" FROM "${table}" WHERE id = ?`, [id]);
  if (!rows.length) return false;
  return rows[0].Game1homeScore !== null || rows[0].Game1awayScore !== null;
}

module.exports = {
  query, latestScorecardDraftId, latestScorecardDraftPath, latestMesserDraftId, draftHasScores
};
