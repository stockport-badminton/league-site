// @ts-check
// Published results waiting for Threads. See migrations/021_threads_result_post.sql for the
// states and why this is a queue rather than a call inside the publish request.

const db = require('../db_connect.js');
const { kysely } = require('../db');

// REARCH-01: everything here is on the typed query layer except `enqueue`, which runs
// inside the publish request (scorecardController, after the result commits). The brief
// keeps the publish path for the off-season.

/** Queue a fixture's result. A fixture already queued, in any state, is left alone. */
/** @param {number} fixtureId */
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
 * @param {number} limit
 */
exports.claim = async function(limit) {
  return kysely.updateTable('threads_result_post')
    .set(eb => ({ state: 'posting', claimed_at: eb.fn('now'), attempts: eb('attempts', '+', 1) }))
    .where('id', 'in', eb => eb.selectFrom('threads_result_post').select('id')
      .where('state', '=', 'pending').orderBy('id').limit(limit).forUpdate().skipLocked())
    .returning(['id', 'fixture_id as fixtureId', 'attempts', 'queued_at as queuedAt'])
    .execute();
};

/**
 * The result as it stands now, which is what gets posted, not what was published.
 * @param {number} fixtureId
 */
exports.resultFor = async function(fixtureId) {
  const row = await kysely.selectFrom('fixture as f')
    .leftJoin('team as ht', 'f.homeTeam', 'ht.id')
    .leftJoin('team as awt', 'f.awayTeam', 'awt.id')
    .leftJoin('division as d', 'ht.division', 'd.id')
    .select(['f.status', 'f.homeScore as homeScore', 'f.awayScore as awayScore',
      'ht.name as homeTeam', 'awt.name as awayTeam', 'd.name as division'])
    .where('f.id', '=', fixtureId)
    .executeTakeFirst();
  return row || null;
};

// Each finishing write is guarded on `state = 'posting'`, so it can only close a row this
// run claimed. Returns the number of rows written, 0 or 1.
/**
 * @param {number} id
 * @param {import('kysely').UpdateObject<import('../db/schema').DB, 'threads_result_post'>} values
 */
async function finish(id, values) {
  const res = await kysely.updateTable('threads_result_post').set(values)
    .where('id', '=', id).where('state', '=', 'posting').executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/** @param {number} id @param {string} mediaId */
exports.markPosted = (id, mediaId) =>
  finish(id, { state: 'posted', posted_at: eb => eb.fn('now'), media_id: mediaId, last_error: null });

/** @param {number} id @param {string} error */
exports.markFailed = (id, error) => finish(id, { state: 'failed', last_error: error });

/** @param {number} id @param {string} reason */
exports.markSkipped = (id, reason) => finish(id, { state: 'skipped', last_error: reason });

/**
 * Back to the queue for the next run, keeping the error that sent it back.
 * @param {number} id @param {string} error
 */
exports.release = (id, error) => finish(id, { state: 'pending', last_error: error });
