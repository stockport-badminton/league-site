// @ts-check
// The Kysely instances, and the one rule they share: neither owns a connection.
//
// REARCH-01. The app reaches Postgres through exactly one `pg` Pool, the one
// db_connect.js builds — capped by PG_POOL_MAX for Supabase's 15-client ceiling, and
// carrying the idle-client 'error' listener that stops a reaped connection killing the
// instance (gotcha 2c). Kysely is handed that pool, never its own. Its PostgresDialect
// would happily build a second one from a connection string, and a second pool is
// exactly NODE-18: the session store did that and starved the next instance of slots.
//
// No require of db_connect here, so db_connect can require this file for the
// transaction bridge without a cycle.
const { Kysely, PostgresDialect } = require('kysely');

/**
 * @typedef {import('./schema').DB} DB
 * @typedef {import('kysely').Kysely<DB>} Db
 */

/**
 * A Kysely over a pool it does not own: every query borrows a client from `getPool()` at
 * the moment it runs, so this can be built at require time, before db.connect().
 *
 * `end` is a no-op on purpose. Kysely's `destroy()` ends its pool, and this pool is
 * db_connect's to close (`db.end()`, on SIGTERM).
 *
 * @param {() => import('pg').Pool | null} getPool
 * @returns {Db}
 */
function overPool(getPool) {
  const pool = {
    connect() {
      // A test that replaces db_connect with a factory mock has no pool() to give. Say so,
      // rather than "getPool is not a function": the fix is to test the converted model
      // in __tests__/db/, or to mock the model rather than the database under it.
      if (typeof getPool !== 'function') {
        return Promise.reject(new Error('kysely: db_connect has no pool() here, so it is mocked. ' +
          'A model on the typed query layer is tested in __tests__/db/, not through a db_connect mock.'));
      }
      const p = getPool();
      if (!p) return Promise.reject(new Error('kysely used before db.connect()'));
      return p.connect();
    },
    async end() {},
  };
  return new Kysely({ dialect: new PostgresDialect({ pool: /** @type {any} */ (pool) }) });
}

// What a transaction must not be told twice. Kysely sends these as plain statements.
const CONTROL = /^\s*(begin|start\s+transaction|commit|end|rollback|abort)\b/i;

/**
 * A Kysely over ONE client that is already inside a transaction — the transaction
 * bridge.
 *
 * During the conversion a db.withTransaction body will hold both kinds of function, old
 * ones taking `conn` and converted ones taking a Kysely. Both must run on the client
 * withTransaction checked out, or the converted half silently runs on another connection,
 * outside the transaction: it commits when the rest rolls back, and nothing errors.
 *
 * The client is lent, not given: release is a no-op, because withTransaction releases it
 * after COMMIT or ROLLBACK. And `.transaction()` on this instance is refused rather than
 * nested — Postgres answers a second BEGIN with a warning and carries on, so the inner
 * COMMIT would commit the outer transaction half way through.
 *
 * @param {import('pg').PoolClient} client
 * @returns {Db}
 */
function overClient(client) {
  const lent = {
    /** @param {string} text @param {unknown[]} params */
    query(text, params) {
      if (typeof text === 'string' && CONTROL.test(text)) {
        return Promise.reject(new Error(
          `"${text.trim()}" inside db.withTransaction: the transaction is withTransaction's to ` +
          'begin and end. Do not call .transaction() on the Kysely it hands you.'));
      }
      return client.query(text, params);
    },
    release() {},
  };
  const pool = { connect: async () => lent, async end() {} };
  return new Kysely({ dialect: new PostgresDialect({ pool: /** @type {any} */ (pool) }) });
}

module.exports = { overPool, overClient };
