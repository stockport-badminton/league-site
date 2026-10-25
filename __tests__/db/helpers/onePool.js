// A stand-in for pg's Pool that puts every query of a test inside one transaction, so the
// test can be rolled back and leaves nothing behind.
//
// Only the Pool is replaced. db_connect.js is the real module — its pgify, its [rows]
// wrapper, its affectedRows — and Postgres is the real server. That is the seam under
// test: the gap between what the SQL does and what the wrapper hands back is where
// insertId, folded aliases and `[, info]` lived.
//
// How it stays faithful to a real pool:
//
// - Each pool.query runs inside its own SAVEPOINT. In production every pool.query is its
//   own autocommitted statement, so one failing does not poison the next; inside a single
//   test transaction it would ("current transaction is aborted"), and a test asserting an
//   error and then reading would fail for a reason production does not have.
// - pool.connect() (db.withTransaction, and every Kysely query) maps BEGIN / COMMIT / ROLLBACK onto a savepoint,
//   so a rolled-back transaction really does roll back and a committed one is still
//   inside the test's outer transaction.
// - Everything goes through one connection, serialised. A real pool would run a
//   Promise.all on several connections; here they queue. Results are the same; only
//   timing differs. A transaction body that waits on a pool.query (rather than its own
//   conn) would deadlock here where it would see another snapshot in production — the
//   test then times out, which is the right outcome for code that does that.
const { Client } = jest.requireActual('pg');

class Mutex {
  constructor() { this.tail = Promise.resolve(); }
  acquire() {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const ready = this.tail.then(() => release);
    this.tail = this.tail.then(() => held);
    return ready;
  }
}

const state = { client: null, lock: new Mutex(), n: 0 };

async function inSavepoint(text, params) {
  const sp = `q${++state.n}`;
  await state.client.query(`SAVEPOINT ${sp}`);
  try {
    const result = await state.client.query(text, params);
    await state.client.query(`RELEASE SAVEPOINT ${sp}`);
    return result;
  } catch (err) {
    await state.client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
    throw err;
  }
}

class OnePool {
  on() { return this; }
  async end() {}

  async query(text, params) {
    const release = await state.lock.acquire();
    try { return await inSavepoint(text, params); } finally { release(); }
  }

  async connect() {
    const release = await state.lock.acquire();
    let sp = null;
    return {
      query(text, params) {
        const verb = typeof text === 'string' ? text.trim().replace(/;$/, '').toUpperCase() : '';
        if (verb === 'BEGIN') { sp = `tx${++state.n}`; return state.client.query(`SAVEPOINT ${sp}`); }
        if (verb === 'COMMIT') { const s = sp; sp = null; return state.client.query(`RELEASE SAVEPOINT ${s}`); }
        if (verb === 'ROLLBACK') { const s = sp; sp = null; return state.client.query(`ROLLBACK TO SAVEPOINT ${s}`); }
        // Outside a BEGIN, a checked-out client is autocommit, like pool.query — and that
        // is how every Kysely query arrives (its driver always connects; it never calls
        // pool.query). Inside one, a failure aborts the transaction, as it would for real.
        if (sp === null) return inSavepoint(text, params);
        return state.client.query(text, params);
      },
      release() { release(); },
    };
  }
}

async function open(connectionString) {
  state.client = new Client({ connectionString });
  await state.client.connect();
}

// Waits for anything still queued, so a query a test forgot to await cannot land in the
// next test's transaction.
async function exclusive(sql) {
  const release = await state.lock.acquire();
  try { return await state.client.query(sql); } finally { release(); }
}

async function close() {
  if (state.client) await state.client.end();
  state.client = null;
}

module.exports = { OnePool, open, exclusive, close };
