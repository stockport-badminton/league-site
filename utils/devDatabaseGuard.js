// Refuse to start a development server against the production database.
//
// `dev.env` carried the same DATABASE_URL as `.env` for as long as both have existed, so
// every `npm run dev` talked to the live Supabase instance. This is not a hypothetical
// risk that someone might one day write to production by accident — it has already
// happened, twice over:
//
//   * three `messer_scorecard` rows in the live database were written by a dev server;
//   * because a dev server logs nothing to Cloud Run, those rows exist with no request
//     behind them, which made a route-usage audit report the whole Messer flow as unused
//     and nearly got it deleted.
//
// So the guard is a refusal, not a warning. A warning on startup is read once and then
// scrolls past for ever.
//
// It runs only when app.js is started directly — never on import — so the Jest suite,
// which requires app.js in 35 files and never opens a connection, is unaffected.

// Hosts that are the live database. Substring match, because the connection string also
// appears in pooler form (aws-0-eu-west-1.pooler.supabase.com).
const PRODUCTION_HOSTS = ['supabase.co', 'supabase.com'];

function hostOf(connectionString) {
  const match = String(connectionString || '').match(/@([^:/?]+)/);
  return match ? match[1] : '';
}

/**
 * @returns {string|null} the reason to refuse, or null to proceed.
 */
function refusalReason(env) {
  const e = env || process.env;

  // Production is production: Cloud Run sets K_SERVICE, and NODE_ENV is production there.
  if (e.NODE_ENV === 'production' || e.K_SERVICE) return null;

  // The deliberate escape hatch. Reading production locally is sometimes the right thing
  // — that is what tools/dbq.js is for, and it refuses anything that is not a single
  // read. This exists for the rare case that needs the whole app, and it has to be typed
  // out, which is the point.
  if (e.ALLOW_PRODUCTION_DB === 'i-know-what-i-am-doing') return null;

  const host = hostOf(e.DATABASE_URL);
  if (!host) return null;
  if (!PRODUCTION_HOSTS.some(h => host.endsWith(h))) return null;

  return [
    '',
    'Refusing to start: this is a development server pointed at the PRODUCTION database.',
    '',
    '  DATABASE_URL host : ' + host,
    '  NODE_ENV          : ' + (e.NODE_ENV || '(unset)'),
    '',
    'Start the local one instead:',
    '',
    '  tools/local-db.sh up && tools/local-db.sh load',
    '',
    'then point dev.env at it:',
    '',
    '  DATABASE_URL=postgresql://sdbl:sdbl@127.0.0.1:5433/sdbl',
    '  DB_PI_KEY=local-dev-not-a-secret',
    '',
    'To read production with the whole app anyway — rarely the right answer, and',
    'tools/dbq.js is the read-only way — set:',
    '',
    '  ALLOW_PRODUCTION_DB=i-know-what-i-am-doing',
    '',
  ].join('\n');
}

module.exports = { refusalReason, hostOf, PRODUCTION_HOSTS };
