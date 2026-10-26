// Tools must not choose their own database.
//
// dotenv does not overwrite a variable that is already set, so whichever env file loads
// FIRST decides which database a tool talks to. Every tool used to load dev.env first and
// .env second. That was harmless for as long as dev.env carried the same connection
// string as .env — and wrong the instant HARD-13 pointed dev.env at a local Postgres.
//
// The failure was silent and, for an audit tool, the worst available: `dbq --check all`
// kept running and kept printing counts, against a two-year-old local seed rather than
// production. It surfaced only because a query returned "no rows" for drafts that plainly
// existed — and it could just as easily have been a data decision taken on the wrong
// numbers.
//
// So the ordering is no longer something each tool gets right or wrong: it lives in
// tools/lib/loadEnv.js. Since 26 Oct 2026 the local database is the default and production
// is asked for with --prod. This asserts nothing drifts back.

const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '../../tools');

// Subfolders too: the sweep used to read tools/*.js only, and three tools under
// fixture-import/ and gap-finder/ loaded .env themselves — one of them a writer.
// local-db/sync.js reads the production URL on purpose (copying it is its job) and parses
// .env rather than loading it; sentry/ needs only a Sentry token, given on its command line.
const EXEMPT = ['local-db/sync.js', 'sentry/sentry-issues.js'];
function walk(dir) {
  return fs.readdirSync(path.join(TOOLS, dir), { withFileTypes: true }).flatMap(d => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' || d.name === 'generated' ? [] : walk(rel);
    return d.name.endsWith('.js') && !EXEMPT.includes(rel) && rel !== path.join('lib', 'loadEnv.js') ? [rel] : [];
  });
}
const files = walk('')
  .map(f => ({ name: f, source: fs.readFileSync(path.join(TOOLS, f), 'utf8') }));

const stripComments = src =>
  src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('tools load their environment through one helper', () => {
  const usingEnv = files.filter(f => /dev\.env|\.env'|loadEnv|dotenv/.test(stripComments(f.source)));

  it('there are tools to check', () => {
    // If this reaches zero the sweep below is vacuous and would pass for ever.
    expect(usingEnv.length).toBeGreaterThan(2);
  });

  for (const file of usingEnv) {
    it(`${file.name} uses loadEnv rather than calling dotenv itself`, () => {
      const code = stripComments(file.source);
      expect(code).toMatch(/loadEnv\(/);
      // A direct dotenv call is how the order becomes a per-file decision again.
      // (Jest's expect takes no message argument — that is Playwright's.)
      expect(code).not.toMatch(/require\(['"]dotenv['"]\)\.config\(/);
    });
  }

  it('finds the subfolder tools', () => {
    expect(usingEnv.map(f => f.name)).toEqual(expect.arrayContaining([
      path.join('fixture-import', 'publish-fixtures.js'), path.join('gap-finder', 'dump.js'),
    ]));
  });
});

// Since 26 Oct 2026: local unless --prod. Run in a child, because loadEnv may exit.
describe('tools/lib/loadEnv.js', () => {
  const { spawnSync } = require('child_process');
  const root = path.join(TOOLS, '..');
  function run(opts, args = []) {
    const code = `
      const r = require('./tools/lib/loadEnv').loadEnv(${JSON.stringify(opts)});
      console.log('@@' + JSON.stringify({ r, marker: process.env.CONFIG_ENV_LOADED,
        host: (String(process.env.DATABASE_URL || '').match(/@([^:/?]+)/) || [])[1] || null }));`;
    // A clean environment: the test process's own fake DATABASE_URL must not decide anything.
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    const p = spawnSync(process.execPath, ['-e', code, '--', ...args], { cwd: root, env, encoding: 'utf8' });
    const line = (p.stdout || '').split('\n').find(l => l.startsWith('@@'));
    return { status: p.status, stderr: p.stderr, out: line ? JSON.parse(line.slice(2)) : null };
  }
  const hasDevEnv = fs.existsSync(path.join(root, 'dev.env'));

  it('defaults to local, and never reads .env to get there', () => {
    const { status, stderr, out } = run({});
    if (!hasDevEnv) {
      // A clean checkout (CI): refusing is right, and it must not fall back to .env.
      expect(status).toBe(2);
      return expect(stderr).toMatch(/dev\.env not found/);
    }
    expect(stderr).toMatch(/local database/);
    expect(out.r).toEqual({ local: true, prod: false });
    expect(out.marker).toBe('1');
    expect(out.host || '').not.toMatch(/supabase/);
  });

  it("ignores a caller's { local: false }: old scripts cannot default to production", () => {
    const { out, status } = run({ local: false });
    if (!hasDevEnv) return expect(status).toBe(2);
    expect(out.r.prod).toBe(false);
  });

  it('loads nothing into a test process, and a tool can still be required from a test', () => {
    // dbq-guard.test.js requires tools/dbq.js. Under the old helper that put .env (production)
    // into the Jest worker; under the first version of this one, CI (no dev.env) exited.
    const p = spawnSync(process.execPath, ['-e', `
      const before = Object.keys(process.env).length;
      const r = require('./tools/lib/loadEnv').loadEnv();
      require('./tools/dbq.js');
      console.log('@@' + JSON.stringify({ r, added: Object.keys(process.env).length - before }));`],
    { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' }, encoding: 'utf8' });
    const out = JSON.parse(p.stdout.split('\n').find(l => l.startsWith('@@')).slice(2));
    expect(p.status).toBe(0);
    expect(out.r.skipped).toBe(true);
    expect(out.added).toBe(0);
  });

  it('refuses --prod for a local-only tool', () => {
    const { status, stderr } = run({ localOnly: true }, ['--prod']);
    expect(status).toBe(2);
    expect(stderr).toMatch(/never runs against production/);
  });

  it('refuses to run a production-only tool without --prod, saying why', () => {
    const { status, stderr } = run({ prodOnly: 'it reads the bucket.' });
    expect(status).toBe(2);
    expect(stderr).toMatch(/needs --prod: it reads the bucket/);
  });
});
