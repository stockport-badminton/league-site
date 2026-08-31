// Crash handlers and graceful shutdown.
//
// There were none. Node 22 treats an unhandled promise rejection as fatal, so a single
// promise rejecting without a .catch() anywhere in 30,000 lines took the Cloud Run
// instance down and every in-flight request with it — the same shape as the pg pool
// crash on 6 August, which is why that one has a listener. And with no SIGTERM handler,
// every deploy and every scale-down severed whatever was in flight, because Cloud Run
// sends SIGTERM and then kills the container ten seconds later.
//
// These assert the handlers are installed and behave, rather than the mechanism inside
// them: a test that kills its own process is not a useful test.

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
  setupExpressErrorHandler: jest.fn(),
  init: jest.fn(),
}));

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[]]))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

jest.mock('../../middleware/secured', () => (req, res, next) => next());

const Sentry = require('@sentry/node');
require('../../app');

describe('unhandledRejection', () => {
  it('is handled at all', () => {
    // The bare fact is the finding: before this there was no listener, and Node's
    // default for an unhandled rejection is to terminate the process.
    expect(process.listenerCount('unhandledRejection')).toBeGreaterThan(0);
  });

  it('reports the rejection and does not stop the process', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    Sentry.captureException.mockClear();

    const handler = process.listeners('unhandledRejection')[0];
    handler(new Error('a promise nobody caught'));

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'a promise nobody caught' }),
      expect.objectContaining({ tags: { source: 'unhandled-rejection' } })
    );
    // Keeping serving is the whole point. A bug somewhere is not a reason to drop the
    // requests of everyone currently using the site.
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it('copes with a rejection that is not an Error', () => {
    Sentry.captureException.mockClear();
    const handler = process.listeners('unhandledRejection')[0];
    expect(() => handler('just a string')).not.toThrow();
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe('uncaughtException', () => {
  it('is handled', () => {
    expect(process.listenerCount('uncaughtException')).toBeGreaterThan(0);
  });

  // Different from a rejection on purpose: the stack unwound through code that wasn't
  // expecting it, so process state is unknown and carrying on risks wrong answers.
  // Report, flush, exit non-zero, let Cloud Run replace the instance.
  it('reports, flushes Sentry, and exits non-zero', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    Sentry.captureException.mockClear();
    Sentry.flush.mockClear();

    const handler = process.listeners('uncaughtException')[0];
    handler(new Error('boom'));
    await new Promise(r => setImmediate(r));

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      expect.objectContaining({ tags: { source: 'uncaught-exception' } })
    );
    // Flushed before exiting, or the event never leaves the instance.
    expect(Sentry.flush).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});
