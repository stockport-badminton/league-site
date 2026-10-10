// PostHog loads site-wide for analytics without cookies, and records only the
// results-entry pages.
//
// It replaced Sentry's replay because the 50-a-month quota ran out within days, mostly on
// the stats pages, and it is running beside Google Analytics to see whether it can replace
// that too. What matters is the gate: production, served by us, not a superadmin, nothing
// stored in the browser, and recording only where captains enter results. As in browser-sentry-origin.test.js, this runs the gate THE
// TEMPLATE ACTUALLY EMITS against a fake `location`, rather than a copy of it written here.

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HEADER = path.join(__dirname, '..', '..', 'views', 'header.ejs');
const { siteOrigin } = require('../../utils/canonical');

const KEY = 'phc_test_not_a_real_project';

function renderHeader(env, user) {
  const keys = ['NODE_ENV', 'K_SERVICE', 'POSTHOG_KEY'];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return ejs.render(fs.readFileSync(HEADER, 'utf8'), {
      static_path: '/static',
      pageTitle: 't',
      pageDescription: 'd',
      theme: 'flatly',
      siteOrigin,
      ...(user ? { user } : {}),
      canonical: 'https://stockport-badminton.co.uk/',
    }, { filename: HEADER });
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

// Run the emitted PostHog block against a fake browser. Returns null if it did not load
// PostHog, otherwise the config it passed to init() and the properties it registered.
function runPostHog(html, { pathname, servedByUs = true }) {
  const m = html.match(/\(function \(\) \{\s*var RECORD_PATHS[\s\S]*?\}\)\(\);/);
  if (!m) throw new Error('PostHog block not found in rendered header');
  const injected = [];
  const sandbox = {
    window: { sblServedByUs: servedByUs },
    location: { pathname, hostname: 'www.stockport-badminton.co.uk' },
    document: {
      createElement: () => ({}),
      head: { appendChild: (el) => injected.push(el) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(m[0], sandbox);
  const script = injected.find((el) => /posthog\.com\/static\/array\.js$/.test(el.src));
  if (!script) return null;
  const seen = {};
  sandbox.window.posthog = {
    init: (key, config) => { seen.key = key; seen.config = config; },
    register: (props) => { seen.registered = props; },
  };
  script.onload();
  return seen;
}

const PROD = { NODE_ENV: 'production', POSTHOG_KEY: KEY };
const CAPTAIN = { user_id: 'auth0|captain' };
const SUPERADMIN = { user_id: 'auth0|admin', _json: { 'https://my-app.example.com/role': 'superadmin' } };

describe('PostHog', () => {
  const captain = renderHeader(PROD, CAPTAIN);
  const anon = renderHeader(PROD, undefined);

  it('loads on every page, logged in or not', () => {
    expect(runPostHog(captain, { pathname: '/player-stats' })).not.toBeNull();
    expect(runPostHog(anon, { pathname: '/' })).not.toBeNull();
    expect(runPostHog(anon, { pathname: '/tables/Premier' })).not.toBeNull();
  });

  // The whole reason it can replace GA without a consent bar.
  it('stores nothing in the browser, and builds no person profiles', () => {
    const { config } = runPostHog(anon, { pathname: '/' });
    expect(config.cookieless_mode).toBe('always');
    expect(config.person_profiles).toBe('never');
    expect(config.api_host).toBe('https://eu.i.posthog.com');
  });

  it('records the results-entry pages for a logged-in captain, with the scores visible', () => {
    for (const pathname of ['/email-scorecard', '/messer-scorecard-beta', '/populated-messer-scorecard/12']) {
      const { config } = runPostHog(captain, { pathname });
      expect(config.disable_session_recording).toBe(false);
      expect(config.session_recording.maskAllInputs).toBe(false);
    }
  });

  it('records nowhere else', () => {
    expect(runPostHog(captain, { pathname: '/player-stats' }).config.disable_session_recording).toBe(true);
    expect(runPostHog(captain, { pathname: '/' }).config.disable_session_recording).toBe(true);
    // A secured page cannot render for an anonymous visitor, but the gate should not rely on that.
    expect(runPostHog(anon, { pathname: '/email-scorecard' }).config.disable_session_recording).toBe(true);
  });

  it('tags events with the account, not identify(), which cookieless mode does not support', () => {
    expect(runPostHog(captain, { pathname: '/' }).registered).toEqual({
      league: 'stockport-badminton.co.uk', logged_in: true, account_id: 'auth0|captain',
    });
    expect(runPostHog(anon, { pathname: '/' }).registered).toEqual({
      league: 'stockport-badminton.co.uk', logged_in: false, account_id: null,
    });
    expect(captain).not.toMatch(/posthog\.identify/);
  });

  it('does not load for a superadmin, or on a page not served by us', () => {
    expect(runPostHog(renderHeader(PROD, SUPERADMIN), { pathname: '/email-scorecard' })).toBeNull();
    expect(runPostHog(anon, { pathname: '/', servedByUs: false })).toBeNull();
  });

  it('emits no PostHog without a key, or outside production', () => {
    expect(renderHeader({ NODE_ENV: 'production' }, CAPTAIN)).not.toMatch(/RECORD_PATHS/);
    expect(renderHeader({ NODE_ENV: 'development', POSTHOG_KEY: KEY }, CAPTAIN)).not.toMatch(/RECORD_PATHS/);
  });

  // sblTrack is called unconditionally by the scorecard wizard, so it must exist on every
  // render — dev included — or the wizard throws a ReferenceError where PostHog is absent.
  it('always defines sblTrack, as a no-op where PostHog is not loaded', () => {
    const dev = renderHeader({ NODE_ENV: 'development' }, CAPTAIN);
    const m = dev.match(/window\.sblTrack = function[\s\S]*?\n\s*\};/);
    expect(m).not.toBeNull();
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(m[0], sandbox);
    expect(() => sandbox.window.sblTrack('x', {})).not.toThrow();
  });

  it('no longer records with Sentry', () => {
    expect(captain).not.toMatch(/replayIntegration/);
    expect(captain).not.toMatch(/replaysSessionSampleRate/);
  });
});
