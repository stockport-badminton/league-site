// The pg Pool must carry an 'error' listener.
//
// Sentry NODE-X (6 Aug 2026): Supabase hung up on an idle connection, `pg` emitted
// 'error' on the Pool, nothing was listening, and Node turned that into an uncaught
// exception — mechanism auto.node.onuncaughtexception, handled: no. The Cloud Run
// instance died mid-request while a crawler was on /event/7328.
//
// This is easy to regress, because the failure is invisible until an idle
// connection actually drops: the pool works perfectly in dev, in tests, and under
// any load that keeps its connections busy. So assert the wiring directly.
//
// `pg` is faked here rather than connected to. dev.env carries the same
// DATABASE_URL as .env, so the only reachable database locally is production.

const { EventEmitter } = require('events');

const created = [];

jest.mock('pg', () => {
  class FakePool extends require('events').EventEmitter {
    constructor(opts) {
      super();
      this.options = opts;
      created.push(this);
    }
  }
  return { Pool: FakePool };
});

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const Sentry = require('@sentry/node');
const db = require('../../db_connect');

describe('pg pool error handling', () => {
  let errSpy;

  beforeEach(() => {
    created.length = 0;
    Sentry.captureException.mockClear();
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.connect();
  });

  afterEach(() => errSpy.mockRestore());

  function pool() {
    expect(created).toHaveLength(1);
    return created[0];
  }

  test('an idle-client error does not become an uncaught exception', () => {
    const p = pool();

    // The listener is the whole point: without one, this emit throws.
    expect(p.listenerCount('error')).toBeGreaterThan(0);

    const boom = new Error('Connection terminated unexpectedly');
    expect(() => p.emit('error', boom, {})).not.toThrow();
  });

  test('the error is still reported to Sentry, just handled', () => {
    const boom = new Error('Connection terminated unexpectedly');
    pool().emit('error', boom, {});

    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ tags: { source: 'pg-pool-idle-client' } })
    );
    expect(errSpy).toHaveBeenCalled();
  });

  test('idle sockets are kept alive, and the session-mode cap still applies', () => {
    expect(pool().options).toEqual(
      expect.objectContaining({ keepAlive: true, max: db.poolMax() })
    );
  });
});
