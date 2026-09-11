// Refusing to start a dev server against the production database (HARD-13).
//
// This is a refusal rather than a warning because the thing it prevents has already
// happened: three messer_scorecard rows in the live database were written by somebody's
// dev server. And because a dev server logs nothing to Cloud Run, those rows exist with
// no request behind them — which later made a route-usage audit report the entire Messer
// flow as unused, and nearly got it deleted. A warning on startup is read once and then
// scrolls past for ever.

const { refusalReason, hostOf } = require('../../utils/devDatabaseGuard');

const PRODUCTION = 'postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
const DIRECT     = 'postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres';
const LOCAL      = 'postgresql://sdbl:sdbl@127.0.0.1:5433/sdbl';

describe('the dev database guard', () => {
  it('refuses a development server pointed at production', () => {
    expect(refusalReason({ DATABASE_URL: PRODUCTION })).toMatch(/Refusing to start/);
  });

  // Both spellings of the connection string are in use — the pooler on 6543 and the
  // direct host — and PG_POOL_MAX exists precisely so the app can move between them.
  it('recognises production by either host form', () => {
    expect(refusalReason({ DATABASE_URL: DIRECT })).toMatch(/Refusing to start/);
    expect(hostOf(PRODUCTION)).toBe('aws-0-eu-west-1.pooler.supabase.com');
    expect(hostOf(DIRECT)).toBe('db.abcdefgh.supabase.co');
  });

  it('allows the local database', () => {
    expect(refusalReason({ DATABASE_URL: LOCAL })).toBeNull();
  });

  // The guard must never be able to take production down. Cloud Run sets K_SERVICE, and
  // NODE_ENV is production there; either alone is enough.
  it('never refuses in production', () => {
    expect(refusalReason({ DATABASE_URL: PRODUCTION, NODE_ENV: 'production' })).toBeNull();
    expect(refusalReason({ DATABASE_URL: PRODUCTION, K_SERVICE: 'league-site' })).toBeNull();
  });

  // Reading production with the whole app is occasionally right — `npm run prodlocal` is
  // exactly that. It has to be typed out, which is the point: nobody sets this by
  // accident, and it appears in the command that needs it.
  it('has an escape hatch that must be spelled out', () => {
    expect(refusalReason({ DATABASE_URL: PRODUCTION, ALLOW_PRODUCTION_DB: 'i-know-what-i-am-doing' })).toBeNull();
    expect(refusalReason({ DATABASE_URL: PRODUCTION, ALLOW_PRODUCTION_DB: 'true' })).toMatch(/Refusing/);
    expect(refusalReason({ DATABASE_URL: PRODUCTION, ALLOW_PRODUCTION_DB: '1' })).toMatch(/Refusing/);
  });

  it('says what to do instead, not just no', () => {
    const message = refusalReason({ DATABASE_URL: PRODUCTION });
    expect(message).toContain('tools/local-db.sh');
    expect(message).toContain('ALLOW_PRODUCTION_DB');
  });

  it('stays out of the way when there is no DATABASE_URL at all', () => {
    expect(refusalReason({})).toBeNull();
  });

  // It is wired inside `if (require.main === module)`. If it ever moved to import time it
  // would refuse in the 35 suites that require app.js with the real .env loaded — every
  // one of which passes today precisely because nothing connects.
  it('is only wired into the startup path, not module load', () => {
    const appSource = require('fs').readFileSync(require('path').join(__dirname, '../../app.js'), 'utf8');
    const startupIndex = appSource.indexOf('require.main === module');
    const guardIndex = appSource.indexOf('devDatabaseGuard');
    expect(startupIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(startupIndex);
  });
});
