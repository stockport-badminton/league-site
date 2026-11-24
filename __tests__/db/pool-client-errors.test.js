// A connection that drops while a client is checked out must not kill the process
// (gotcha 2c, second half — see the 'connect' listener in db_connect.js).
//
// pg-pool takes its idle-client error listener off a client when it is checked out, and
// pool.connect() — which Kysely's driver and withTransaction both use — puts nothing in
// its place. A socket reset between statements was then an 'error' event with no
// listener: on 5 Nov 2026 that was `uncaughtException (exiting) read ECONNRESET` and an
// instance restart. Needs the real pg Pool, not the db project's one-connection stand-in.
let real;
let realLog; // db_connect's own copy of utils/log: isolateModules gives it a separate registry
beforeAll(() => {
  // As in kysely.test.js: put the real Pool on the cached 'pg' mock for exactly one fresh
  // load of db_connect, then put the test pool back.
  const pg = require('pg');
  const testPool = pg.Pool;
  pg.Pool = jest.requireActual('pg').Pool;
  try {
    jest.isolateModules(() => {
      real = require('../../db_connect');
      realLog = require('../../utils/log');
    });
  } finally {
    pg.Pool = testPool;
  }
  real.connect();
  expect(real.pool()).toBeInstanceOf(jest.requireActual('pg').Pool);
});
afterAll(() => real.end());

it('survives a socket reset on a checked-out client, and discards that client', async () => {
  const warn = jest.spyOn(realLog, 'warn').mockImplementation(() => {});
  try {
    const pool = real.pool();
    const client = await pool.connect();
    // No listener of the test's own on `client`: one would mask exactly the fault under test.
    const logged = new Promise(resolve => warn.mockImplementation(resolve));

    // What a peer reset looks like to pg: the socket errors while no query is running.
    client.connection.stream.destroy(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    await logged;

    expect(warn).toHaveBeenCalledWith(
      { err: expect.objectContaining({ code: 'ECONNRESET' }) },
      'pg client error (connection will be discarded)');
    await expect(client.query('SELECT 1')).rejects.toThrow();

    client.release();
    expect(pool.totalCount).toBe(0);                          // not handed out again
    const { rows } = await pool.query('SELECT 1 AS ok');      // and the pool still works
    expect(rows).toEqual([{ ok: 1 }]);
  } finally {
    warn.mockRestore();
  }
});
