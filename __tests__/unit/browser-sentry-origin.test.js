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
// This test runs the guard WE SHIP (static/beta/js/monitoring.js, with the config the
// header renders) rather than a copy of it written here, for the reason CLAUDE.md gives
// about asserting on rendered output: a test that restates the logic can only ever agree
// with itself.

const { renderHeader, configBlock, runMonitoring, MONITORING } = require('../helpers/monitoring');

const USER = { user_id: 'auth0|test' };

function servedByUs(html, location) {
  return runMonitoring(html, location).window.sblServedByUs;
}

// Run sentryOnLoad as Sentry's loader would, and report what it did.
function runSentry(html, location) {
  const { window, sandbox } = runMonitoring(html, location);
  const seen = { init: null, user: null };
  sandbox.Sentry = {
    init: (o) => { seen.init = o; },
    lazyLoadIntegration: () => ({ then: () => {} }),
    addIntegration: () => {},
    setUser: (u) => { seen.user = u; },
  };
  if (window.sentryOnLoad) window.sentryOnLoad();
  return seen;
}

describe('the browser Sentry only reports from pages we serve', () => {
  const html = renderHeader({ NODE_ENV: 'production' }, USER);

  it('checks the origin before Sentry.init', () => {
    expect(runSentry(html, { protocol: 'https:', hostname: 'stockport-badminton.co.uk' }).init).not.toBeNull();
    expect(runSentry(html, { protocol: 'file:', hostname: 'server' }).init).toBeNull();
  });

  it('labels the environment and the user, and loads the SDK after defining sentryOnLoad', () => {
    const seen = runSentry(html, { protocol: 'https:', hostname: 'stockport-badminton.co.uk' });
    expect(seen.init).toMatchObject({ environment: 'production', tracesSampleRate: 0 });
    expect(seen.user).toEqual({ id: 'auth0|test' });
    expect(html.indexOf('monitoring.js')).toBeLessThan(html.indexOf('sentry-cdn.com'));
    expect(html).toMatch(/<script defer src="https:\/\/js-de\.sentry-cdn\.com\//);
  });

  it('takes the expected host from siteOrigin, not a hardcoded string', () => {
    expect(JSON.parse(configBlock(html)).expectedHost).toBe('stockport-badminton.co.uk');
    expect(MONITORING).not.toMatch(/['"](www\.)?stockport-badminton\.co\.uk['"]/);
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

  it('reports nothing for an anonymous visitor', () => {
    const anon = renderHeader({ NODE_ENV: 'production' });
    expect(anon).not.toMatch(/sentry-cdn\.com/);
    expect(runSentry(anon, { protocol: 'https:', hostname: 'stockport-badminton.co.uk' }).init).toBeNull();
  });

  // The render-time gate is the other half and must keep working: without it, localhost
  // and the browser suite report into production, which is what the July 2026 triage found.
  it('emits no Sentry at all outside production', () => {
    const dev = renderHeader({ NODE_ENV: 'development' }, USER);
    expect(dev).not.toMatch(/sentry-cdn\.com/);
    expect(dev).not.toMatch(/sbl-monitoring/);
    expect(runSentry(dev, { protocol: 'https:', hostname: 'stockport-badminton.co.uk' }).init).toBeNull();
  });

  // K_SERVICE alone (Cloud Run) counts as production, as it does for instrument.js.
  it('reports from Cloud Run whatever NODE_ENV says', () => {
    const run = renderHeader({ NODE_ENV: 'development', K_SERVICE: 'league-site' }, USER);
    expect(run).toMatch(/sentry-cdn\.com/);
  });
});
