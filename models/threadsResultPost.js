// Published results waiting for Threads. See migrations/021_threads_result_post.sql for the
// states and why this is a queue rather than a call inside the publish request.

const db = require('../db_connect.js');

/** Queue a fixture's result. A fixture already queued, in any state, is left alone. */
exports.enqueue = async function(fixtureId) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `INSERT INTO threads_result_post (fixture_id) VALUES (?)
     ON CONFLICT (fixture_id) DO NOTHING
     RETURNING id`, [fixtureId]);
  return rows[0] || null;
};

/**
 * Take up to `limit` pending rows for this run, oldest first, and mark them `posting`.
 * SKIP LOCKED so two overlapping runs take different rows rather than the same ones.
 */
exports.claim = async function(limit) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `UPDATE threads_result_post
     SET state = 'posting', claimed_at = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM threads_result_post WHERE state = 'pending'
       ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED)
     RETURNING id, fixture_id AS "fixtureId", attempts, queued_at AS "queuedAt"`, [limit]);
  return rows;
};

/** The result as it stands now, which is what gets posted, not what was published. */
exports.resultFor = async function(fixtureId) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `SELECT f.status, f."homeScore" AS "homeScore", f."awayScore" AS "awayScore",
            ht.name AS "homeTeam", awt.name AS "awayTeam", d.name AS division
     FROM fixture f
     LEFT JOIN team ht ON f."homeTeam" = ht.id
     LEFT JOIN team awt ON f."awayTeam" = awt.id
     LEFT JOIN division d ON ht.division = d.id
     WHERE f.id = ?`, [fixtureId]);
  return rows[0] || null;
};

// Each finishing write is guarded on `state = 'posting'`, so it can only close a row this
// run claimed.
async function finish(id, sets, params) {
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `UPDATE threads_result_post SET ${sets} WHERE id = ? AND state = 'posting'`, [...params, id]);
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
