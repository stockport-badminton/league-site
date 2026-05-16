const { Pool } = require('pg');

const state = { pool: null };

exports.connect = function() {
  state.pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
