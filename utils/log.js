// @ts-check
// The application's logger (REARCH-09 part B). Every log line in app code goes through
// here; __tests__/unit/no-console.test.js fails on a `console.` call anywhere it covers.
//
// Cloud Run hands stdout to Cloud Logging one line at a time. Plain `console.log` text
// arrived with no severity, a multi-line object arrived as a separate entry per line, and
// nothing tied a line to the request that wrote it — which is why HARD-47 had to invent a
// `[timing]` text prefix to be able to find its own lines. A line written as JSON is
// parsed instead: `severity` and `message` are Cloud Logging's own field names, everything
// else lands in `jsonPayload`, and `logging.googleapis.com/trace` nests the line under its
// request in the console's request view.
//
// Usage is pino's: `log.info('message')`, or a fields object first —
// `log.warn({ fixtureId }, 'no draft for fixture')`, `log.error({ err }, 'publish failed')`.
// An error goes in as `err`, so pino serialises its type, message and stack.
//
// One logger, no children: the request's ids come from `mixin` below, so a test can spy
// on `log.info` and see every call.

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const pino = require('pino');
const Sentry = require('@sentry/node');
const config = require('../config');

// pino's level names to Cloud Logging's LogSeverity.
/** @type {Record<string, string>} */
const SEVERITY = {
  trace: 'DEBUG', debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR', fatal: 'CRITICAL',
};

// Sentry's console integration used to turn every console line into a breadcrumb on the
// next error event. pino does not go through console, and Sentry's pino integration only
// sends Sentry Logs or captures errors — so the breadcrumb is added here instead. A no-op
// when Sentry was never initialised (anywhere but Cloud Run).
/** @type {Record<string, string>} */
const BREADCRUMB_LEVEL = { trace: 'debug', debug: 'debug', info: 'info', warn: 'warning', error: 'error', fatal: 'fatal' };

/** @type {AsyncLocalStorage<Record<string, string>>} */
const requestContext = new AsyncLocalStorage();

// In a terminal, a line a person can read: `12:04:05 WARN  message {"fixtureId":42}`.
// Production gets the JSON untouched. Not pino-pretty: that is a dev dependency, and
// every runtime require names a production one.
const readable = {
  /** @param {string} line */
  write(line) {
    const { severity, message, time, err, ...fields } = JSON.parse(line);
    const extra = Object.keys(fields).length ? ' ' + JSON.stringify(fields) : '';
    const stack = err ? '\n  ' + String(err.stack || err.message).replace(/\n/g, '\n  ') : '';
    const clock = new Date(time).toTimeString().slice(0, 8);
    const out = severity === 'ERROR' || severity === 'CRITICAL' || severity === 'WARNING' ? process.stderr : process.stdout;
    out.write(`${clock} ${String(severity).padEnd(7)} ${message || ''}${extra}${stack}\n`);
  },
};

// What an `err` field carries. Not pino's default, which copies every enumerable property:
// an axios error holds the whole request config — headers, params, the Meta access token
// in the query string — and its response. The lines this replaced logged `err.message`.
/** @param {any} err */
function serializeErr(err) {
  if (!(err instanceof Error)) return err;
  const out = /** @type {Record<string, unknown>} */ ({ type: err.name, message: err.message, stack: err.stack });
  const e = /** @type {any} */ (err);
  if (e.code !== undefined) out.code = e.code;
  const status = e.status ?? e.statusCode ?? (e.response && e.response.status) ?? (e.$metadata && e.$metadata.httpStatusCode);
  if (status !== undefined) out.status = status;
  return out;
}

function level() {
  if (config.NODE_ENV === 'test') return 'silent';
  return config.LOG_LEVEL || 'info';
}

const log = pino({
  level: level(),
  messageKey: 'message',
  // No pid or hostname: Cloud Run's resource labels already say which instance.
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: label => ({ severity: SEVERITY[label] || 'DEFAULT' }),
  },
  serializers: { err: serializeErr },
  mixin: () => requestContext.getStore() || {},
  hooks: {
    logMethod(args, method, levelNumber) {
      const label = this.levels.labels[levelNumber];
      const first = /** @type {any} */ (args[0]);
      const message = typeof first === 'string' ? first : (typeof args[1] === 'string' ? args[1] : '');
      if (typeof Sentry.addBreadcrumb === 'function') Sentry.addBreadcrumb({
        category: 'log',
        level: /** @type {any} */ (BREADCRUMB_LEVEL[label] || 'info'),
        message: message || (first instanceof Error ? first.message : (first && first.err && first.err.message) || ''),
      });
      return method.apply(this, args);
    },
  },
}, config.K_SERVICE || config.NODE_ENV === 'production' ? pino.destination(1) : readable);

// The request id for this request's lines. On Cloud Run, from the X-Cloud-Trace-Context
// header (`TRACE_ID/SPAN_ID;o=1`) the load balancer adds, written as the trace field
// Cloud Logging groups by. Anywhere else, a random id, so a local request's lines can
// still be told apart.
/**
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
function contextFor(header) {
  const traceId = typeof header === 'string' ? header.split('/')[0] : '';
  if (/^[0-9a-f]{32}$/i.test(traceId)) {
    return {
      requestId: traceId,
      'logging.googleapis.com/trace': `projects/${config.GCP_PROJECT}/traces/${traceId}`,
    };
  }
  return { requestId: crypto.randomUUID() };
}

/**
 * Express middleware: everything logged while this request is handled carries its ids.
 * @param {{ get(name: string): string | undefined }} req
 * @param {unknown} res
 * @param {() => void} next
 */
function requestIds(req, res, next) {
  requestContext.run(contextFor(req.get('x-cloud-trace-context')), next);
}

module.exports = Object.assign(log, { requestIds, contextFor });
