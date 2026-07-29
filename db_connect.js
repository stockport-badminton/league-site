const { Pool } = require('pg');

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

exports.isObject = function(obj) {
  return obj === Object(obj);
};
