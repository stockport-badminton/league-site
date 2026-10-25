// The typed query layer's infrastructure against a real Postgres (REARCH-01, step 1).
//
// What has to be true before a single model function is converted: Kysely reaches the
// database through the app's one pool, and inside db.withTransaction an old `conn` query
// and a converted Kysely query are in the SAME transaction. If they are not, a converted
// function commits when the rest of its transaction rolls back, and nothing errors.
const db = require('../../db_connect');
const { kysely, encrypt, decrypt } = require('../../db');
const { sql } = require('kysely');

const read = async (text, params) => [...(await (await db.otherConnect()).query(text, params))[0]];
const MARK = 'rearch01-bridge-test';
const marked = () => read('SELECT kind FROM blocked_entry WHERE value = ? ORDER BY kind', [MARK]);

describe('kysely over the shared pool', () => {
  it('reads the same row the string wrapper does', async () => {
    const [legacy] = await read('SELECT id, name, division FROM team WHERE id = ?', [1]);
    const typed = await kysely.selectFrom('team')
      .select(['id', 'name', 'division']).where('id', '=', 1).executeTakeFirstOrThrow();
    expect(typed).toEqual(legacy);
  });

  // Kysely quotes every identifier, which is the whole of gotcha 1: no alias can fold.
  it('keeps a camelCase alias camelCase', async () => {
    const row = await kysely.selectFrom('fixture as f')
      .select(['f.homeTeam as homeTeam', 'f.awayTeam as awayTeam']).where('f.id', '=', 302)
      .executeTakeFirstOrThrow();
    expect(Object.keys(row)).toEqual(['homeTeam', 'awayTeam']);
  });

  it('reports affected rows as a typed field, not off a tuple (gotcha 2d)', async () => {
    const res = await kysely.updateTable('team').set({ name: sql`name` }).where('id', 'in', [1, 2])
      .executeTakeFirst();
    expect(res.numUpdatedRows).toBe(2n);
  });
});

describe('the transaction bridge — withTransaction hands fn (conn, trx) on one client', () => {
  const both = (conn, trx) => Promise.all([
    conn.query('INSERT INTO blocked_entry (kind, value) VALUES (?, ?)', ['ip', MARK]),
    trx.insertInto('blocked_entry').values({ kind: 'word', value: MARK }).execute(),
  ]);

  it('commits both halves together', async () => {
    await db.withTransaction(both);
    expect(await marked()).toEqual([{ kind: 'ip' }, { kind: 'word' }]);
  });

  // The test the package asks for. Without the bridge — trx being the pool-wide kysely —
  // the Kysely write runs on another connection and survives the rollback (on the test
  // pool, which has one connection, it deadlocks and times out instead: still a failure).
  it('rolls back both halves together', async () => {
    await expect(db.withTransaction(async (conn, trx) => {
      await both(conn, trx);
      expect(await trx.selectFrom('blocked_entry').select('kind')
        .where('value', '=', MARK).execute()).toHaveLength(2);
      throw new Error('abandon');
    })).rejects.toThrow('abandon');
    expect(await marked()).toEqual([]);
  });

  it('is one transaction, seen from either side', async () => {
    const [a, b] = await db.withTransaction(async (conn, trx) => {
      const [[x]] = await conn.query('SELECT txid_current()::text AS t');
      const y = await sql`SELECT txid_current()::text AS t`.execute(trx);
      return [x.t, /** @type {any} */ (y.rows[0]).t];
    });
    expect(a).toBe(b);
  });

  it('refuses to nest: .transaction() on trx would commit the outer one early', async () => {
    await expect(db.withTransaction(async (conn, trx) => {
      await conn.query('INSERT INTO blocked_entry (kind, value) VALUES (?, ?)', ['ip', MARK]);
      await trx.transaction().execute(async inner => inner.selectFrom('team').select('id').execute());
    })).rejects.toThrow(/inside db\.withTransaction/);
    expect(await marked()).toEqual([]);
  });

  it('leaves a body that ignores trx exactly as it was', async () => {
    const out = await db.withTransaction(async conn => {
      const [rows] = await conn.query('SELECT name FROM team WHERE id = ?', [1]);
      return rows[0].name;
    });
    expect(typeof out).toBe('string');
  });
});

// The same rollback on a REAL pool, of several connections, because the test pool above
// has only one and so cannot show the actual failure: with the bridge removed it
// deadlocks, and a timeout is weak evidence of anything. Here, without the bridge, the
// Kysely half lands on a second connection, autocommits, and is still there after the
// rollback — the bug itself, as an assertion. These writes do commit, to sdbl_test, which
// is rebuilt every run; afterAll removes them anyway.
describe('the transaction bridge, on a real multi-connection pool', () => {
  let real;
  beforeAll(() => {
    // Not jest.doMock: Jest answers a require from the mock it already built for 'pg'
    // before it looks at a new factory, so that silently gave this block the test pool
    // again. Instead the real Pool goes onto that cached mock object for exactly one
    // fresh load of db_connect, which captures it, and is put back.
    const pg = require('pg');
    const testPool = pg.Pool;
    pg.Pool = jest.requireActual('pg').Pool;
    try {
      jest.isolateModules(() => { real = require('../../db_connect'); });
    } finally {
      pg.Pool = testPool;
    }
    real.connect();
    expect(real.pool()).toBeInstanceOf(jest.requireActual('pg').Pool);
  });
  afterAll(async () => {
    await (await real.otherConnect()).query('DELETE FROM blocked_entry WHERE value = ?', [MARK + '-real']);
    await real.end();
  });

  it('rolls back the Kysely half with the rest', async () => {
    const value = MARK + '-real';
    await expect(real.withTransaction(async (conn, trx) => {
      await conn.query('INSERT INTO blocked_entry (kind, value) VALUES (?, ?)', ['ip', value]);
      await trx.insertInto('blocked_entry').values({ kind: 'word', value }).execute();
      throw new Error('abandon');
    })).rejects.toThrow('abandon');
    const [rows] = await (await real.otherConnect())
      .query('SELECT kind FROM blocked_entry WHERE value = ?', [value]);
    expect([...rows]).toEqual([]);
  });
});

describe('encrypted columns — the key is a parameter, never text (HARD-27)', () => {
  it('binds DB_PI_KEY rather than writing it into the statement', () => {
    const q = kysely.selectFrom('player as p')
      .select(eb => decrypt(eb.ref('p.playerEmail')).as('playerEmail'))
      .where('p.id', '=', 1).compile();
    expect(q.sql).not.toContain(process.env.DB_PI_KEY);
    expect(q.parameters).toContain(process.env.DB_PI_KEY);
    expect(q.sql).toMatch(/pgp_sym_decrypt\("p"\."playerEmail", \$1\)::text/);
  });

  it('round-trips through the database, and decrypts what the string queries wrote', async () => {
    const [legacy] = await read(
      'SELECT id, pgp_sym_decrypt("playerEmail", ?)::text AS email FROM player WHERE "playerEmail" IS NOT NULL ORDER BY id LIMIT 1',
      [process.env.DB_PI_KEY]);
    const typed = await kysely.selectFrom('player')
      .select(eb => decrypt(eb.ref('playerEmail')).as('email'))
      .where('id', '=', legacy.id).executeTakeFirstOrThrow();
    expect(typed.email).toBe(legacy.email);

    await kysely.updateTable('player').set({ playerTel: encrypt('07700 900999') })
      .where('id', '=', legacy.id).execute();
    const [back] = await read('SELECT pgp_sym_decrypt("playerTel", ?)::text AS tel FROM player WHERE id = ?',
      [process.env.DB_PI_KEY, legacy.id]);
    expect(back.tel).toBe('07700 900999');
  });

  it('fails at the query that needed the key, rather than decrypting to NULL', () => {
    const saved = process.env.DB_PI_KEY;
    delete process.env.DB_PI_KEY;
    try {
      expect(() => encrypt('x')).toThrow(/DB_PI_KEY is not set/);
    } finally {
      process.env.DB_PI_KEY = saved;
    }
  });
});
