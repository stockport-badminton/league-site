// Published results waiting for Facebook and Instagram, one row per fixture and target.
// See migrations/024_social_result_post.sql for the states and why this is a queue rather
// than a call inside the publish request. Mirrors models/threadsResultPost.js.

const db = require('../db_connect.js');
const ThreadsResultPost = require('./threadsResultPost');

/**
 * Queue a fixture's result for each target kind. A target already queued for that fixture,
 * in any state, is left alone. Returns the rows that were added.
 */
exports.enqueue = async function(fixtureId, targets) {
  if (!targets.length) return [];
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `INSERT INTO social_result_post (fixture_id, target)
     VALUES ${targets.map(() => '(?, ?)').join(', ')}
     ON CONFLICT (fixture_id, target) DO NOTHING
     RETURNING id, target`, targets.flatMap(t => [fixtureId, t]));
  return rows;
};

/**
 * Take up to `limit` pending rows for this run, oldest first, and mark them `posting`.
 * SKIP LOCKED so two overlapping runs take different rows rather than the same ones.
 */
exports.claim = async function(limit) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `UPDATE social_result_post
     SET state = 'posting', claimed_at = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM social_result_post WHERE state = 'pending'
       ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED)
     RETURNING id, fixture_id AS "fixtureId", target, attempts, queued_at AS "queuedAt"`, [limit]);
  // RETURNING does not promise the subquery's order, and a fixture's targets should go out
  // in the order they were queued.
  return rows.sort((a, b) => a.id - b.id);
};

/** The result as it stands now, which is what gets posted. The same read as Threads. */
exports.resultFor = fixtureId => ThreadsResultPost.resultFor(fixtureId);

// Each finishing write is guarded on `state = 'posting'`, so it can only close a row this
// run claimed.
async function finish(id, sets, params) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `UPDATE social_result_post SET ${sets} WHERE id = ? AND state = 'posting'`, [...params, id]);
  return rows.affectedRows;
}

exports.markPosted = (id, mediaId) =>
  finish(id, `state = 'posted', posted_at = now(), media_id = ?, last_error = NULL`, [mediaId]);

exports.markFailed = (id, error) =>
  finish(id, `state = 'failed', last_error = ?`, [error]);

exports.markSkipped = (id, reason) =>
  finish(id, `state = 'skipped', last_error = ?`, [reason]);

/** Back to the queue for the next run, keeping the error that sent it back. */
exports.release = (id, error) =>
  finish(id, `state = 'pending', last_error = ?`, [error]);
