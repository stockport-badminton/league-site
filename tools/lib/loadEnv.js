// Which environment a tool talks to, decided in one place.
//
// dotenv does not overwrite a variable that is already set, so whichever env file loads
// FIRST wins. Every tool here used to load dev.env first and .env second. That was
// harmless for as long as dev.env carried the same connection string as .env — and wrong
// the instant HARD-13 pointed dev.env at a local Postgres. The failure was silent: `dbq
// --check all` kept printing counts, against a two-year-old local seed rather than
// production.
//
// The fix then was to make production the default and local the opt-in. Since 26 Oct 2026
// it is the other way round (Neil's call): **local unless `--prod` is on the command line**
// (`--production` also works). A command that reaches production now says so where anyone
// reading it can see, and forgetting the flag costs a confusing answer from the local
// database rather than a write to the live one.
//
// Each side reads ONE file. Local is dev.env alone, so the process holds what dev.env holds
// (its AWS key, for npm run dev) and none of .env's Meta tokens, cron secrets or production
// database; --prod is .env alone. Callers' own options cannot change the target — older
// scripts in scripts/ still pass `{ local }`, and that is ignored on purpose, so none of
// them can default to production by passing `local: false`.
const fs = require('fs');
const path = require('path');

const PROD_FLAGS = ['--prod', '--production'];

/**
 * @param {{ localOnly?: boolean, prodOnly?: string, quiet?: boolean, argv?: string[] }} [opts]
 *   localOnly: refuse --prod (a tool that calls model functions, some of which write).
 *   prodOnly: refuse to run without --prod; the string says why, e.g. what it reads that
 *   only production has.
 * @returns {{ local: boolean, prod: boolean }}
 */
function loadEnv(opts = {}) {
  const argv = opts.argv || process.argv;
  const prod = PROD_FLAGS.some(f => argv.includes(f));

  if (prod && opts.localOnly) fail('This tool never runs against production; drop --prod.');
  if (!prod && opts.prodOnly) fail(`This tool needs --prod: ${opts.prodOnly}`);

  const file = prod ? '.env' : 'dev.env';
  const at = path.join(__dirname, '..', '..', file);
  if (!fs.existsSync(at)) fail(`${file} not found at ${at}.`);
  require('dotenv').config({ path: at });
  // config/index.js would otherwise load .env on top when a tool requires a model, and fill
  // in every production credential dev.env does not override.
  process.env.CONFIG_ENV_LOADED = '1';

  if (!prod) {
    const { hostOf, PRODUCTION_DB_HOSTS } = require('../../utils/testEnvGuard');
    const host = hostOf(process.env.DATABASE_URL);
    if (PRODUCTION_DB_HOSTS.some(h => host.endsWith(h))) {
      fail(`dev.env points DATABASE_URL at ${host}, which is production. Use --prod to mean it.`);
    }
  }
  // stderr, so --json output stays parseable.
  if (!opts.quiet) console.error(prod ? '→ PRODUCTION (.env)' : '→ local database (dev.env); --prod for production');
  return { local: !prod, prod };
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

module.exports = { loadEnv, PROD_FLAGS };
