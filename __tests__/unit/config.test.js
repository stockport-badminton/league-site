// config/ is the one place application code reads the environment (REARCH-06).
const fs = require('fs');
const path = require('path');
const schema = require('../../config/schema');
const { createConfig, missing } = require('../../config');

const root = path.join(__dirname, '..', '..');

// Application code: what runs in the Cloud Run container. tools/, scripts/, e2e/ and
// __tests__/ set up environments rather than run in one, and are outside the rule.
const APP = ['app.js', 'instrument.js', 'db_connect.js', 'db', 'controllers', 'models', 'utils', 'middleware', 'routes', 'views'];

function filesUnder(rel) {
  const at = path.join(root, rel);
  if (fs.statSync(at).isFile()) return [rel];
  return fs.readdirSync(at, { withFileTypes: true }).flatMap(d => {
    const child = path.join(rel, d.name);
    if (d.isDirectory()) return filesUnder(child);
    return /\.(js|ejs)$/.test(d.name) && !/\.backup$/.test(d.name) ? [child] : [];
  });
}
const appFiles = APP.flatMap(filesUnder);

describe('application code reads the environment only through config/', () => {
  it('has no process.env outside config/', () => {
    const offenders = appFiles.flatMap(rel =>
      fs.readFileSync(path.join(root, rel), 'utf8').split('\n')
        .map((line, i) => (/process\.env\b/.test(line) ? `${rel}:${i + 1}: ${line.trim()}` : null))
        .filter(Boolean));
    expect(offenders).toEqual([]);
  });

  it('reads only variables the schema declares', () => {
    // Static, so a typo fails here rather than on the one request that reaches it.
    const undeclared = appFiles.flatMap(rel => {
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      return [...text.matchAll(/\bconfig\.([A-Z][A-Z0-9_]+)\b/g)]
        .map(m => m[1]).filter(name => !schema[name]).map(name => `${rel}: ${name}`);
    });
    expect(undeclared).toEqual([]);
  });

  it('declares every cron token requireCronCaller is handed', () => {
    const names = appFiles.flatMap(rel =>
      [...fs.readFileSync(path.join(root, rel), 'utf8').matchAll(/envVar:\s*'([A-Z0-9_]+)'/g)].map(m => m[1]));
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) expect(schema[name]).toBeDefined();
  });
});

describe('config/schema.js', () => {
  const KINDS = ['secret', 'public', 'id', 'flag', 'url', 'list', 'number', 'string'];

  it.each(Object.entries(schema))('%s is fully declared', (name, entry) => {
    expect(KINDS).toContain(entry.kind);
    expect(typeof entry.doc).toBe('string');
    expect(['fake', 'real', 'unset', 'pass']).toContain(entry.test);
    if (entry.test === 'fake' || entry.test === 'real') expect(typeof entry.testValue).toBe('string');
    if (entry.e2e) expect(['fake', 'unset', 'local']).toContain(entry.e2e);
    // A required variable the tests delete would stop app.js loading in every suite.
    if (entry.required === true) expect(entry.test).not.toBe('unset');
    // A secret passed through from the shell is how HARD-26 happened.
    if (entry.kind === 'secret') expect(entry.test).not.toBe('pass');
  });
});

describe('config', () => {
  it('parses each kind', () => {
    const c = createConfig({
      DEV_MODE: 'true', CSP_ENFORCE: 'yes', PG_POOL_MAX: '9', GLOBAL_RATE_LIMIT: 'lots',
      AUDIT_EMAIL_TO: ' a@x.org, ,b@x.org ', SITE_ORIGIN: '', CSP_REPORT_URI: '',
    });
    expect(c.DEV_MODE).toBe(true);
    expect(c.CSP_ENFORCE).toBe(false);
    expect(c.HSTS_INCLUDE_SUBDOMAINS).toBe(false);
    expect(c.PG_POOL_MAX).toBe(9);
    expect(c.GLOBAL_RATE_LIMIT).toBe(600);
    expect(c.PORT).toBe(8080);
    expect(c.AUDIT_EMAIL_TO).toEqual(['a@x.org', 'b@x.org']);
    expect(c.REGISTRATION_EMAIL_TO).toEqual([]);
    expect(c.SITE_ORIGIN).toBe('https://stockport-badminton.co.uk');
    // '' is a real value for CSP_REPORT_URI (no reporting); absent is the default.
    expect(c.CSP_REPORT_URI).toBe('');
    expect(createConfig({}).CSP_REPORT_URI).toBe('/csp-report');
    expect(c.SOCIAL_CRON_TOKEN).toBeUndefined();
  });

  it('reads the environment when asked, so a test can set and restore a variable', () => {
    const env = {};
    const c = createConfig(env);
    expect(c.SOCIAL_POST_THREADS).toBe(false);
    env.SOCIAL_POST_THREADS = 'true';
    expect(c.SOCIAL_POST_THREADS).toBe(true);
  });

  it('follows process.env when a test replaces it wholesale', () => {
    const config = require('../../config');
    const saved = process.env;
    try {
      process.env = { ...saved, SOCIAL_POST_THREADS: 'true' };
      expect(config.SOCIAL_POST_THREADS).toBe(true);
    } finally {
      process.env = saved;
    }
    expect(config.SOCIAL_POST_THREADS).toBe(false);
  });

  it('throws on a name the schema does not declare', () => {
    expect(() => createConfig({}).NOT_A_VARIABLE).toThrow(/NOT_A_VARIABLE is not declared/);
  });

  it('cannot be written to', () => {
    const c = createConfig({});
    expect(() => { 'use strict'; c.PORT = 1; }).toThrow();
  });
});

describe('startup refuses without a required variable', () => {
  const complete = Object.fromEntries(
    Object.entries(schema).filter(([, e]) => e.required).map(([name]) => [name, 'x']));

  it('accepts a complete environment', () => {
    expect(missing(complete)).toEqual([]);
    expect(() => createConfig(complete).validate()).not.toThrow();
  });

  it('names what is missing', () => {
    const { DB_PI_KEY, ...rest } = complete;
    expect(() => createConfig(rest).validate()).toThrow(/Missing required environment variable: DB_PI_KEY\b/);
    const { AUTH0_DOMAIN, ...fewer } = rest;
    expect(() => createConfig(fewer).validate()).toThrow(/AUTH0_DOMAIN, DB_PI_KEY/);
  });

  it("requires SESSION_SECRET in production only — dev may run on the default", () => {
    const { SESSION_SECRET, ...rest } = complete;
    expect(missing(rest)).toEqual([]);
    expect(createConfig(rest).SESSION_SECRET).toBe('dev-only-session-secret');
    expect(missing({ ...rest, NODE_ENV: 'production' })).toEqual(['SESSION_SECRET']);
  });

  it('is what app.js runs at load', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    expect(app).toMatch(/^config\.validate\(\);$/m);
  });
});

describe('the Jest environment is derived from the schema', () => {
  // __tests__/setup.js has already run in this process.
  it.each(Object.entries(schema))('%s has the treatment its entry declares', (name, entry) => {
    if (entry.test === 'unset') expect(process.env[name]).toBeUndefined();
    if (entry.test === 'fake' || entry.test === 'real') expect(process.env[name]).toBe(entry.testValue);
  });

  it('removes a secret newly added to the schema without anyone editing setup.js', () => {
    jest.isolateModules(() => {
      jest.doMock('../../config/schema', () => ({
        ...jest.requireActual('../../config/schema'),
        BRAND_NEW_API_SECRET: { kind: 'secret', test: 'unset', doc: 'a new one' },
      }));
      const env = { BRAND_NEW_API_SECRET: 'live-value', PATH: '/bin' };
      require('../../config/testEnv').applyForJest(env);
      expect(env.BRAND_NEW_API_SECRET).toBeUndefined();
      expect(env.PATH).toBe('/bin');
    });
  });

  it('removes undeclared cron tokens and Meta credentials by pattern', () => {
    const env = { SOMETHING_CRON_TOKEN: 'x', META_APP_SECRET: 'y' };
    require('../../config/testEnv').applyForJest(env);
    expect(env).not.toHaveProperty('SOMETHING_CRON_TOKEN');
    expect(env).not.toHaveProperty('META_APP_SECRET');
  });
});
