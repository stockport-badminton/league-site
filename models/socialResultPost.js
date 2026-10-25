// @ts-check
// Published results waiting for Facebook and Instagram, one row per fixture and target.
// See migrations/024_social_result_post.sql for the states and why this is a queue rather
// than a call inside the publish request. Mirrors models/threadsResultPost.js.

const db = require('../db_connect.js');
const ThreadsResultPost = require('./threadsResultPost');
const { kysely } = require('../db');

// REARCH-01: everything here is on the typed query layer except `enqueue`, which runs
// inside the publish request (Fixture.sendResultZap). The brief keeps the publish path for
// the off-season.

/**
 * Queue a fixture's result for each target kind. A target already queued for that fixture,
 * in any state, is left alone. Returns the rows that were added.
 */
/** @param {number} fixtureId @param {string[]} targets */
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
 * @param {number} limit
 */
exports.claim = async function(limit) {
  const rows = await kysely.updateTable('social_result_post')
    .set(eb => ({ state: 'posting', claimed_at: eb.fn('now'), attempts: eb('attempts', '+', 1) }))
    .where('id', 'in', eb => eb.selectFrom('social_result_post').select('id')
      .where('state', '=', 'pending').orderBy('id').limit(limit).forUpdate().skipLocked())
    .returning(['id', 'fixture_id as fixtureId', 'target', 'attempts', 'queued_at as queuedAt'])
    .execute();
  // RETURNING does not promise the subquery's order, and a fixture's targets should go out
  // in the order they were queued.
  return rows.sort((a, b) => a.id - b.id);
};

/**
 * The result as it stands now, which is what gets posted. The same read as Threads.
 * @param {number} fixtureId
 */
exports.resultFor = fixtureId => ThreadsResultPost.resultFor(fixtureId);

// Each finishing write is guarded on `state = 'posting'`, so it can only close a row this
// run claimed. Returns the number of rows written, 0 or 1.
/**
 * @param {number} id
 * @param {import('kysely').UpdateObject<import('../db/schema').DB, 'social_result_post'>} values
 */
async function finish(id, values) {
  const res = await kysely.updateTable('social_result_post').set(values)
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
