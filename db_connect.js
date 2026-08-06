const { Pool } = require('pg');
// Safe to require here even though instrument.js owns Sentry.init: an
// uninitialised Sentry no-ops, so this stays inert under Jest (which mocks this
// module anyway) and in any process that never calls init.
const Sentry = require('@sentry/node');

const state = { pool: null };

// Cap the pool per instance, because the binding limit is on the other side of the
// connection and it is small.
//
// Supabase's session-mode pooler (port 5432) allows 15 clients in total. `pg`
// defaults to max: 10 per pool, and Cloud Run is configured with maxScale 2 — so
// two warm instances ask for 20 and the 16th connection is refused with
// `EMAXCONNSESSION: max clients reached in session mode`. That took the homepage
// down (Sentry NODE-V, 28 July): getupComing threw while rendering /.
//
// 5 per instance leaves headroom for a third instance if maxScale is ever raised.
// It is well within what this traffic needs — the heaviest page fires 7 queries
// through Promise.all, and any beyond the cap queue rather than fail.
//
// PG_POOL_MAX exists so this can be raised without a deploy once the connection
// string moves to the transaction pooler (6543), where multiplexing makes the
// 15-client ceiling stop being the constraint.
const POOL_MAX = parseInt(process.env.PG_POOL_MAX, 10) || 5;

exports.connect = function() {
  state.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: POOL_MAX,
    // Hand idle connections back rather than holding a session-mode slot open.
    idleTimeoutMillis: 10000,
    // Default is to wait forever. Fail with a clear error instead of hanging a
    // request indefinitely when the pool is saturated.
    connectionTimeoutMillis: 10000,
    // Keep idle sockets warm so the network path (Cloud Run -> Supabase pooler)
    // is less likely to drop one from under us between requests. Reduces how
    // often the handler below has to fire; it does not remove the need for it.
    keepAlive: true,
  });

  // REQUIRED, not defensive. `pg` emits 'error' on the Pool when the backend
  // hangs up on an *idle* client, and an EventEmitter 'error' with no listener
  // is an uncaught exception — which kills the whole Cloud Run instance, taking
  // every in-flight request with it. That is Sentry NODE-X (6 Aug): Supabase
  // reaped an idle connection and the process died mid-crawl.
  //
  // Note this is only for idle clients. An error on an in-flight query rejects
  // that query's promise instead, so it surfaces through the caller's try/catch
  // and the central 500 handler in routes/index.js — it never reaches here.
  //
  // Swallowing is the correct response: pg has already discarded the broken
  // client, and the next query gets a fresh one. We capture it so the event is
  // still visible in Sentry, just handled rather than fatal.
  state.pool.on('error', function(err) {
    console.error('pg pool: idle client error (connection discarded):', err.message);
    Sentry.captureException(err, { tags: { source: 'pg-pool-idle-client' } });
  });
};

// Exposed for logging/diagnostics; also lets a test assert the cap is applied.
exports.poolMax = function() {
  return POOL_MAX;
};

// Converts MySQL ? placeholders to Postgres $N in sequence.
function pgify(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

// Compatibility wrapper:
// - Converts ? → $N
// - Normalises params to array
// - Returns [rows] to match mysql2's [rows, fields] destructuring shape
// - Adds affectedRows / changedRows on rows for UPDATE/DELETE compat
async function pgQuery(sql, params = []) {
  const normParams = Array.isArray(params) ? params : [params];
  const result = await state.pool.query(pgify(sql), normParams);
  const rows = result.rows;
  rows.affectedRows = result.rowCount;
  rows.changedRows = result.rowCount;
  return [rows];
}

exports.get = function() {
  return { query: pgQuery };
};

exports.otherConnect = async function() {
  return exports.get();
};

// Runs `fn` against a single checked-out client wrapped in BEGIN/COMMIT, rolling
// back if it throws. The client exposes the same `{ query }` shape as
// otherConnect() — same ? → $N conversion, same [rows] return — so a model
// function can take a connection and be called either way.
//
// pgQuery goes through pool.query(), which grabs an arbitrary connection per
// call: fine for single statements, useless for a transaction, because BEGIN and
// the UPDATEs that follow could land on different sessions. Anything that has to
// be all-or-nothing (renumbering two teams' ranks in one go) needs this instead.
//
// Note the pool cap: a transaction holds one of POOL_MAX slots for its whole
// duration, so keep the body to queries and no awaited I/O.
exports.withTransaction = async function(fn) {
  const client = await state.pool.connect();
  const conn = {
    query: async function(sql, params = []) {
      const normParams = Array.isArray(params) ? params : [params];
      const result = await client.query(pgify(sql), normParams);
      const rows = result.rows;
      rows.affectedRows = result.rowCount;
      rows.changedRows = result.rowCount;
      return [rows];
    }
  };
  try {
    await client.query('BEGIN');
    const out = await fn(conn);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // A failed rollback means the connection is already unusable; the original
      // error is the one worth reporting.
      console.error('ROLLBACK failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
};

exports.isObject = function(obj) {
  return obj === Object(obj);
};
