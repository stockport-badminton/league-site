// The browser Sentry must only report from pages we are actually serving.
//
// `views/header.ejs` decides `sentryEnabled` at RENDER time, from NODE_ENV/K_SERVICE.
// That is the right gate for "should this build report at all" and it is what keeps
// localhost and the Playwright suite out of the production project. What it cannot do is
// keep a *production* render from being saved and reopened somewhere else: the saved HTML
// carries the snippet, the DSN and the baked-in `Sentry.setUser` id with it, and goes on
// reporting as `environment: production` for as long as the file exists.
//
// 14 Sep 2026, issue JAVASCRIPT-1VF: a saved copy of `/email-scorecard` — a `secured`
// page, so whoever saved it was logged in — opened off a Windows network share at
// `file://server/Data/.../stockport-badminton.co.uk/email-scorecard.html` and reported
// `ReferenceError: $ is not defined`, because jQuery cannot load over `file://`. Nothing
// was wrong with the site. The "user" was a file path.
//
// This test evaluates the predicate THE TEMPLATE ACTUALLY EMITS rather than a copy of it
// written here, for the reason CLAUDE.md gives about asserting on rendered output: a test
// that restates the logic can only ever agree with itself.

const ejs = require('ejs');
const path = require('path');
const vm = require('vm');

const HEADER = path.join(__dirname, '..', '..', 'views', 'header.ejs');
const { siteOrigin } = require('../../utils/canonical');

function renderHeader(env) {
  const before = { NODE_ENV: process.env.NODE_ENV, K_SERVICE: process.env.K_SERVICE };
  Object.assign(process.env, env);
  if (env.K_SERVICE === undefined) delete process.env.K_SERVICE;
  try {
    return ejs.render(require('fs').readFileSync(HEADER, 'utf8'), {
      static_path: '/static',
      pageTitle: 't',
      pageDescription: 'd',
      theme: 'flatly',
      siteOrigin,
      user: { user_id: 'auth0|test' },
      canonical: 'https://stockport-badminton.co.uk/',
    }, { filename: HEADER });
  } finally {
    process.env.NODE_ENV = before.NODE_ENV;
    if (before.K_SERVICE === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = before.K_SERVICE;
  }
}

// Pull the emitted guard out of the rendered page and run it against a fake `location`,
// so what is under test is the shipped code.
function servedByUs(html, location) {
  const m = html.match(/var expectedHost =[\s\S]*?test\(h\)\);/);
  if (!m) throw new Error('origin guard not found in rendered header');
  const sandbox = { location, result: null };
  vm.createContext(sandbox);
  vm.runInContext(m[0] + '\nresult = servedByUs;', sandbox);
  return sandbox.result;
}

describe('the browser Sentry only reports from pages we serve', () => {
  const html = renderHeader({ NODE_ENV: 'production' });

  it('emits the guard, and it runs before Sentry.init', () => {
    expect(html).toMatch(/var servedByUs/);
    expect(html).toMatch(/if \(!servedByUs\) return;/);
    expect(html.indexOf('if (!servedByUs) return;')).toBeLessThan(html.indexOf('Sentry.init('));
  });

  it('takes the expected host from siteOrigin, not a hardcoded string', () => {
    expect(html).toContain("var expectedHost = 'stockport-badminton.co.uk';");
  });

  // The case that actually happened.
  it('refuses a page opened from a file:// path', () => {
    expect(servedByUs(html, { protocol: 'file:', hostname: 'server' })).toBe(false);
    expect(servedByUs(html, { protocol: 'file:', hostname: '' })).toBe(false);
  });

  it('refuses a copy re-hosted on somebody else’s domain', () => {
    expect(servedByUs(html, { protocol: 'https:', hostname: 'example.com' })).toBe(false);
    // A lookalike must not pass on a suffix match.
    expect(servedByUs(html, { protocol: 'https:', hostname: 'stockport-badminton.co.uk.evil.test' })).toBe(false);
    expect(servedByUs(html, { protocol: 'https:', hostname: 'notstockport-badminton.co.uk' })).toBe(false);
  });

  it('allows the real site, www, and the Cloud Run hostname', () => {
    expect(servedByUs(html, { protocol: 'https:', hostname: 'stockport-badminton.co.uk' })).toBe(true);
    expect(servedByUs(html, { protocol: 'https:', hostname: 'www.stockport-badminton.co.uk' })).toBe(true);
    // Firebase rewrites to Cloud Run and that hostname serves the whole site publicly
    // (CLAUDE.md gotcha 1b), so it is a legitimate origin, not an impostor.
    expect(servedByUs(html, { protocol: 'https:', hostname: 'league-site-akvq7tsxuq-nw.a.run.app' })).toBe(true);
  });

  // The render-time gate is the other half and must keep working: without it, localhost
  // and the browser suite report into production, which is what the July 2026 triage found.
  it('emits no Sentry at all outside production', () => {
    const dev = renderHeader({ NODE_ENV: 'development', K_SERVICE: undefined });
    expect(dev).not.toMatch(/Sentry\.init\(/);
    expect(dev).not.toMatch(/sentry-cdn\.com/);
  });
});
