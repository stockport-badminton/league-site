// PostHog session replay is loaded only where it is meant to record.
//
// It replaced Sentry's replay because the 50-a-month quota ran out within days, mostly on
// the stats pages. So what matters is the gate: production, served by us, a results-entry
// page, not a superadmin. As in browser-sentry-origin.test.js, this runs the gate THE
// TEMPLATE ACTUALLY EMITS against a fake `location`, rather than a copy of it written here.

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HEADER = path.join(__dirname, '..', '..', 'views', 'header.ejs');
const { siteOrigin } = require('../../utils/canonical');

const KEY = 'phc_test_not_a_real_project';

function renderHeader(env, user = { user_id: 'auth0|test' }) {
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
      user,
      canonical: 'https://stockport-badminton.co.uk/',
    }, { filename: HEADER });
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

// Run the emitted PostHog block; report whether it injected the PostHog script.
function loadsPostHog(html, { pathname, servedByUs = true }) {
  const m = html.match(/\(function \(\) \{\s*var RECORD_PATHS[\s\S]*?\}\)\(\);/);
  if (!m) throw new Error('PostHog block not found in rendered header');
  const injected = [];
  const sandbox = {
    window: { sblServedByUs: servedByUs },
    location: { pathname, hostname: 'stockport-badminton.co.uk' },
    document: {
      createElement: () => ({}),
      head: { appendChild: (el) => injected.push(el) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(m[0], sandbox);
  return injected.some((el) => /posthog\.com\/static\/array\.js$/.test(el.src));
}

const PROD = { NODE_ENV: 'production', POSTHOG_KEY: KEY };

describe('PostHog session replay', () => {
  const html = renderHeader(PROD);

  it('records the results-entry pages', () => {
    expect(loadsPostHog(html, { pathname: '/email-scorecard' })).toBe(true);
    expect(loadsPostHog(html, { pathname: '/messer-scorecard-beta' })).toBe(true);
    expect(loadsPostHog(html, { pathname: '/populated-messer-scorecard/12' })).toBe(true);
  });

  it('does not record the stats pages, which used up Sentry’s quota', () => {
    expect(loadsPostHog(html, { pathname: '/player-stats' })).toBe(false);
    expect(loadsPostHog(html, { pathname: '/pair-stats' })).toBe(false);
    expect(loadsPostHog(html, { pathname: '/' })).toBe(false);
  });

  it('does not record a page that is not being served by us', () => {
    expect(loadsPostHog(html, { pathname: '/email-scorecard', servedByUs: false })).toBe(false);
  });

  it('does not record a superadmin', () => {
    const admin = renderHeader(PROD, {
      user_id: 'auth0|admin',
      _json: { 'https://my-app.example.com/role': 'superadmin' },
    });
    expect(loadsPostHog(admin, { pathname: '/email-scorecard' })).toBe(false);
  });

  it('keeps nothing in the browser and shows the scores', () => {
    expect(html).toContain("persistence: 'memory'");
    expect(html).toContain('maskAllInputs: false');
    expect(html).toContain(`'${KEY}'`);
  });

  it('emits no PostHog without a key, or outside production', () => {
    expect(renderHeader({ NODE_ENV: 'production' })).not.toMatch(/RECORD_PATHS/);
    expect(renderHeader({ NODE_ENV: 'development', POSTHOG_KEY: KEY })).not.toMatch(/RECORD_PATHS/);
  });

  // sblTrack is called unconditionally by the scorecard wizard, so it must exist on every
  // render — dev included — or the wizard throws a ReferenceError where PostHog is absent.
  it('always defines sblTrack, as a no-op where PostHog is not loaded', () => {
    const dev = renderHeader({ NODE_ENV: 'development' });
    const m = dev.match(/window\.sblTrack = function[\s\S]*?\n\s*\};/);
    expect(m).not.toBeNull();
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(m[0], sandbox);
    expect(() => sandbox.window.sblTrack('x', {})).not.toThrow();
  });

  it('no longer records with Sentry', () => {
    expect(html).not.toMatch(/replayIntegration/);
    expect(html).not.toMatch(/replaysSessionSampleRate/);
  });
});
