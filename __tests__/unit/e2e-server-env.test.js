// The browser suite's dev server must not hold a live credential.
//
// HARD-26 did this for the Jest process. Nothing had done it for the browser one, which is
// the more surprising gap: `npm test` cannot reach production, while `npm run test:e2e`
// starts a REAL server that was loading dev.env overlaid on .env — a live AKIA key and the
// real bucket name. Measured 12 Sep 2026: HeadBucket on badmintontemp returned 200.
//
// e2e/helpers/read-only.js does not cover it. It intercepts browser requests, so it cannot
// see a PUT the server makes from inside Node — which is exactly what the scorecard
// document endpoints do.
//
// This runs e2e/server-env.js in a child process, because it mutates process.env and may
// call process.exit. Either outcome is acceptable; what is not is exiting 0 while holding
// something live.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..', '..');

const REPORT = `
  require('./e2e/server-env.js');
  const { liveCredentials } = require('./utils/testEnvGuard');
  console.log('@@' + JSON.stringify({
    live: liveCredentials(process.env),
    awsKey: process.env.AWS_ACCESS_KEY_ID,
    dbHost: (String(process.env.DATABASE_URL || '').match(/@([^:/]+)/) || [])[1],
    bucket: process.env.S3_BUCKET_NAME,
    piKeySet: !!process.env.DB_PI_KEY,
    marker: process.env.E2E_SERVER,
    auditTo: process.env.AUDIT_EMAIL_TO,
    cronToken: process.env.AUDIT_CRON_TOKEN,
  }));
`;

function run() {
  const proc = spawnSync(process.execPath, ['-e', REPORT], { cwd: root, encoding: 'utf8' });
  const line = (proc.stdout || '').split('\n').find(l => l.startsWith('@@'));
  return { proc, env: line ? JSON.parse(line.slice(2)) : null };
}

describe('e2e/server-env.js', () => {
  const { proc, env } = run();

  // On a machine with a dev.env — which is any machine that can run the browser suite —
  // the server MUST come up, and must come up safe. Allowing "or it refused to start" as a
  // pass would make this test green when the neutralisation is deleted, since the guard
  // would simply refuse instead: the fix and its absence would look identical.
  const hasDevEnv = fs.existsSync(path.join(root, 'dev.env'));

  it(hasDevEnv ? 'starts, and holds nothing live' : 'refuses to start, with a reason', () => {
    if (hasDevEnv) {
      expect(proc.stderr || '').not.toMatch(/live production credentials/i);
      expect(env).not.toBeNull();
      return expect(env.live).toEqual([]);
    }
    // No dev.env means no local database to point at, so refusing is right — but it must
    // say why rather than dying quietly.
    expect(proc.status).not.toBe(0);
    expect(proc.stderr).toMatch(/live production credentials|not been declared/i);
  });

  const whenStarted = env ? describe : describe.skip;

  whenStarted('the environment it produces', () => {
    it('holds no usable AWS key', () => {
      expect(env.awsKey).not.toMatch(/^(AKIA|ASIA)[A-Z0-9]{16}$/);
    });

    it('points at a local database, never production', () => {
      expect(env.dbHost).toBeDefined();
      expect(env.dbHost).not.toMatch(/supabase/);
    });

    it('keeps the real bucket NAME, because normalisePhotoUrl checks the host against it', () => {
      expect(env.bucket).toBe('badmintontemp');
    });

    it('keeps a working DB_PI_KEY — the pages under test decrypt real local columns', () => {
      expect(env.piKeySet).toBe(true);
    });

    it('leaves unset the variables that are safe because they are unset', () => {
      expect(env.auditTo).toBeUndefined();
      expect(env.cronToken).toBeUndefined();
    });

    it('marks itself, so globalSetup can tell this server from somebody else\'s', () => {
      expect(env.marker).toBe('1');
    });
  });

  it('is the file playwright.config.js actually preloads', () => {
    const config = fs.readFileSync(path.join(root, 'playwright.config.js'), 'utf8');
    expect(config).toMatch(/-r \.\/e2e\/server-env\.js/);
    expect(config).toMatch(/globalSetup/);
    // The old form loaded dev.env straight into the server, which is the bug.
    expect(config).not.toMatch(/dotenv_config_path=\.\/dev\.env/);
  });
});
