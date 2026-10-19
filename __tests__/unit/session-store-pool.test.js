// The session store must share the app's pg pool, not build its own.
//
// Supabase's session-mode pooler allows 15 clients in total. db_connect caps the app's
// pool at 5 per instance so two instances fit — but connect-pg-simple, given only a
// connection string, builds a second Pool with pg's default max of 10. That is 15 per
// instance, so one busy instance can hold every slot and a second one starting up gets
// EMAXCONNSESSION on its first request (Sentry NODE-18, 19 Oct 2026: a scanner burst,
// /dashboard and /api-docs answered 500).
//
// Asserted by counting Pools: requiring app.js must construct none, and connecting the
// database must construct exactly one, which the session store then queries through.

jest.mock('pg', () => {
  const actual = jest.requireActual('pg');
  const Pool = jest.fn(function() {
    this.on = jest.fn();
    this.end = jest.fn().mockResolvedValue();
    this.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  });
  return { ...actual, Pool };
});

describe('session store connection pool', () => {
  test('app.js builds no pg Pool of its own; the store queries the app pool', async () => {
    const { Pool } = require('pg');
    const app = require('../../app');
    expect(Pool).toHaveBeenCalledTimes(0);

    const db = require('../../db_connect');
    db.connect();
    expect(Pool).toHaveBeenCalledTimes(1);
    const appPool = Pool.mock.instances[0];

    const store = app.get('sessionStore');
    expect(store).toBeDefined();
    await new Promise((resolve, reject) =>
      store.get('some-sid', err => (err ? reject(err) : resolve())));

    expect(appPool.query).toHaveBeenCalled();
    expect(Pool).toHaveBeenCalledTimes(1);
    await db.end();
  });
});
