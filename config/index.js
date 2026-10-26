// The one place application code reads the environment (REARCH-06). Everything else reads
// `config.X`; __tests__/unit/config-only-env.test.js fails on `process.env` anywhere else.
//
// Each property is a getter that reads the environment when it is asked, not a snapshot
// taken at startup. 43 test files set and restore variables around a single test, and a
// frozen copy would have made every one of them a no-op. What is fixed is the *set* of
// names: asking for one the schema does not declare throws, so a typo or a new variable
// that skipped the schema fails on first use instead of reading undefined.
const schema = require('./schema');

// Under test, __tests__/setup.js declares the whole environment, so nothing is inherited
// from .env (HARD-26). The browser suite's server has already loaded exactly what it
// should in e2e/server-env.js, and a tool has loaded exactly one file through
// tools/lib/loadEnv.js; loading .env again would put back what they kept out.
if (process.env.NODE_ENV !== 'test' && process.env.E2E_SERVER !== '1' && process.env.CONFIG_ENV_LOADED !== '1') {
  require('dotenv').config();
}

function isAbsent(entry, raw) {
  return raw === undefined || (raw === '' && !entry.emptyIsValue);
}

function parse(entry, raw) {
  if (entry.kind === 'flag') return raw === 'true';
  if (isAbsent(entry, raw)) {
    if (entry.kind === 'list') return [];
    return entry.default;
  }
  if (entry.kind === 'number') return Number(raw) || entry.default;
  if (entry.kind === 'list') return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  return raw;
}

/**
 * Which `required` variables are missing from `env`. 'production' ones count only when
 * NODE_ENV is production.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function missing(env) {
  const production = env.NODE_ENV === 'production';
  return Object.entries(schema)
    .filter(([name, entry]) => entry.required === true || (entry.required === 'production' && production)
      ? isAbsent(entry, env[name]) : false)
    .map(([name]) => name);
}

/** Throws, naming every missing variable, if startup should refuse. */
function validate(env) {
  const names = missing(env);
  if (names.length) {
    throw new Error(
      `Missing required environment variable${names.length > 1 ? 's' : ''}: ${names.join(', ')}. ` +
      'See config/schema.js.');
  }
}

/**
 * @typedef {typeof import('./schema')} Schema
 * @typedef {{ readonly [K in keyof Schema]:
 *   Schema[K]['kind'] extends 'flag' ? boolean :
 *   Schema[K]['kind'] extends 'number' ? number :
 *   Schema[K]['kind'] extends 'list' ? string[] : (string | undefined) }} Values
 * @typedef {Values & { validate(): void, createConfig(env: object): Config, missing(env: object): string[] }} Config
 */

/**
 * @param {Record<string, string | undefined> | (() => Record<string, string | undefined>)} env
 *   the environment to read, or a function returning it. The app's own config passes
 *   `() => process.env`, because tests replace process.env wholesale (`process.env = {...saved}`)
 *   and a captured reference would go on reading the object they threw away.
 * @returns {Config}
 */
function createConfig(env) {
  const read = typeof env === 'function' ? env : () => env;
  const target = {};
  for (const [name, entry] of Object.entries(schema)) {
    Object.defineProperty(target, name, { enumerable: true, get: () => parse(entry, read()[name]) });
  }
  Object.defineProperty(target, 'validate', { value: () => validate(read()) });
  Object.defineProperty(target, 'createConfig', { value: createConfig });
  Object.defineProperty(target, 'missing', { value: missing });
  Object.freeze(target);
  return /** @type {Config} */ (/** @type {unknown} */ (new Proxy(target, {
    get(t, key) {
      // Only names shaped like an environment variable are policed, so util.inspect, EJS
      // and `await` probing for `then` or Symbol.toStringTag still see a plain object.
      if (typeof key === 'string' && /^[A-Z][A-Z0-9_]+$/.test(key) && !(key in t)) {
        throw new Error(`${key} is not declared in config/schema.js`);
      }
      return t[key];
    },
  })));
}

module.exports = createConfig(() => process.env);
