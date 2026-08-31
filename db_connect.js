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

// Closes the pool, for a graceful shutdown. Cloud Run gives ten seconds after SIGTERM;
// handing session-mode slots back inside that window is politer to Supabase's small
// connection ceiling than letting them time out. Safe to call when nothing was ever
// connected, and safe to call twice.
exports.end = async function() {
  if (!state.pool) return;
  const pool = state.pool;
  state.pool = null;
  try {
    await pool.end();
  } catch (err) {
    // Already closing, or a client died on the way out. Nothing useful to do while the
    // process is on its way down.
    console.error('pg pool: error while closing:', err.message);
  }
};

// Converts MySQL ? placeholders to Postgres $N in sequence.
//
// This used to be `sql.replace(/\?/g, ...)`, which rewrites every question mark in the
// statement — including the ones inside string literals, quoted identifiers and
// comments, which are not placeholders at all. Two ways that went wrong:
//
//   SELECT ?::text AS param, '?#unknown' AS literal      -- one parameter supplied
//     -> the literal came back as '$2#unknown'.  Silent. No error.
//
//   SELECT COALESCE(t.name, '?#' || f."homeTeam") ... WHERE f.date < ?
//     -> the literal takes $1, the real placeholder becomes $2, and Postgres rejects
//        the statement with "could not determine data type of parameter $1".
//
// Which of the two you get depends only on whether the literal appears before or after
// the real placeholder, so the same mistake is either a hard error or corrupted output.
// It was already live: `tools/audit/checks.js` labels a missing team `'?#' || id`, and
// the audit has been printing `$1#44` where it meant `?#44` for as long as it has
// existed.
//
// So the scan tracks what it is inside and rewrites only outside:
//   'literal'        with '' as the escape
//   "identifier"     with "" as the escape
//   $tag$ ... $tag$  dollar quoting
//   -- to end of line
//   /* ... */        nestable, as Postgres allows
//
// Note the one thing this deliberately does not solve: Postgres' jsonb operators are
// spelled `?`, `?|` and `?&`, and a bare `?` outside a literal is genuinely ambiguous
// between "placeholder" and "does this key exist". Nothing in this codebase uses them,
// and if that changes the answer is a `jsonb_exists(...)` function call rather than
// guesswork here.
function pgify(sql) {
  let out = '';
  let idx = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */, which Postgres allows to nest
    if (ch === '/' && next === '*') {
      let depth = 0;
      const start = i;
      while (i < sql.length) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; continue; }
        if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; if (!depth) break; continue; }
        i++;
      }
      out += sql.slice(start, i);
      continue;
    }

    // $tag$ dollar-quoted string. The tag may be empty ($$) or a bare identifier.
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const marker = tag[0];
        const close = sql.indexOf(marker, i + marker.length);
        const stop = close === -1 ? sql.length : close + marker.length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    // 'string literal' or "quoted identifier"; a doubled quote is an escaped one.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out += sql.slice(start, i);
      continue;
    }

    if (ch === '?') {
      out += '$' + (++idx);
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
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

// Exported for its unit test. Every query in the app goes through it, and the failure it
// used to have was silent in one direction, so it is worth testing directly rather than
// only through a mocked pool.
exports.pgify = pgify;
