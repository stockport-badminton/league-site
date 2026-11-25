// PostHog loads site-wide for analytics without cookies, and records only the
// results-entry pages.
//
// It replaced Sentry's replay because the 50-a-month quota ran out within days, mostly on
// the stats pages, and it replaced Google Analytics in Nov 2026 (HARD-44 item 3). What matters is the gate: production, served by us, not a superadmin, nothing
// stored in the browser, and recording only where captains enter results. As in browser-sentry-origin.test.js, this runs the gate THE
// CODE WE SHIP (static/beta/js/monitoring.js, with the config the header renders) against
// a fake `location`, rather than a copy of it written here.

const fs = require('fs');
const path = require('path');
const { renderHeader, runMonitoring, MONITORING } = require('../helpers/monitoring');

const KEY = 'phc_test_not_a_real_project';

// Run monitoring.js against the rendered header. Returns null if it did not load
// PostHog, otherwise the config it passed to init() and the properties it registered.
// The window's `load` event fires before the result is read, unless `fireLoad` is false;
// `beforeLoad` reports whether array.js had already been injected by then.
function runPostHog(html, { pathname, servedByUs = true, fireLoad = true, readyState = 'loading' }) {
  const hostname = servedByUs ? 'www.stockport-badminton.co.uk' : 'example.com';
  const { window, injected, load } = runMonitoring(html, { pathname, hostname, readyState });
  const beforeLoad = injected.length > 0;
  if (fireLoad) load();
  const script = injected.find((el) => /posthog\.com\/static\/array\.js$/.test(el.src));
  if (!script) return null;
  const seen = {};
  window.posthog = {
    init: (key, config) => { seen.key = key; seen.config = config; },
    register: (props) => { seen.registered = props; },
  };
  script.onload();
  seen.beforeLoad = beforeLoad;
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
    const { key, config } = runPostHog(anon, { pathname: '/' });
    expect(key).toBe(KEY);
    expect(config.cookieless_mode).toBe('always');
    expect(config.person_profiles).toBe('never');
    expect(config.api_host).toBe('https://eu.i.posthog.com');
  });

  it('records the results-entry pages for a logged-in captain, with the scores visible', () => {
    for (const pathname of ['/email-scorecard', '/populated-scorecard-beta/2465', '/messer-scorecard-beta', '/populated-messer-scorecard/12']) {
      const { config } = runPostHog(captain, { pathname });
      expect(config.disable_session_recording).toBe(false);
      expect(config.session_recording.maskAllInputs).toBe(false);
    }
  });

  // The recorder cannot run cookieless: that mode keeps no session in the browser, so it
  // never starts. Replay ran two days like that and stored nothing at all. A recorded page
  // keeps its session in memory instead — still nothing written to the browser.
  it('keeps a recorded page out of cookieless mode, in memory rather than storage', () => {
    const { config } = runPostHog(captain, { pathname: '/email-scorecard' });
    expect(config.cookieless_mode).toBeUndefined();
    expect(config.persistence).toBe('memory');
    expect(config.person_profiles).toBe('never');
    expect(runPostHog(captain, { pathname: '/player-stats' }).config.cookieless_mode).toBe('always');
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
      role: 'member', club: null, messer_admin: false,
    });
    expect(runPostHog(anon, { pathname: '/' }).registered).toEqual({
      league: 'stockport-badminton.co.uk', logged_in: false, account_id: null,
      role: null, club: null, messer_admin: false,
    });
    expect(MONITORING).not.toMatch(/posthog\.identify/);
  });

  // So "how many club admins used X" is one query. The club comes from the admin claim,
  // and is a string from the database printed into a <script>, so it must not be able
  // to close the tag.
  it('tags a club admin with their role and club, and a messer admin as such', () => {
    const admin = {
      user_id: 'auth0|sec',
      _json: {
        'https://my-app.example.com/role': 'admin',
        'https://my-app.example.com/club': 'Manor</script><script>alert(1)',
        'https://my-app.example.com/messeradmin': true,
      },
    };
    const html = renderHeader(PROD, admin);
    expect(html).not.toMatch(/Manor<\/script>/);
    expect(runPostHog(html, { pathname: '/' }).registered).toMatchObject({
      role: 'admin', club: 'Manor</script><script>alert(1)', messer_admin: true,
    });
  });

  it('sends an event immediately when the caller is about to navigate away', () => {
    const { window } = runMonitoring(renderHeader({ NODE_ENV: 'development' }, CAPTAIN));
    const calls = [];
    window.posthog = { __loaded: true, capture: (...a) => calls.push(a) };
    window.sblTrack('filter_applied', { page: '/results' }, { leaving: true });
    window.sblTrack('scorecard_step', { step: 2 });
    expect(calls[0]).toEqual(['filter_applied', { page: '/results' }, { send_instantly: true }]);
    expect(calls[1]).toEqual(['scorecard_step', { step: 2 }]);
  });

  it('does not load for a superadmin, or on a page not served by us', () => {
    expect(runPostHog(renderHeader(PROD, SUPERADMIN), { pathname: '/email-scorecard' })).toBeNull();
    expect(runPostHog(anon, { pathname: '/', servedByUs: false })).toBeNull();
  });

  it('emits no PostHog without a key, or outside production', () => {
    expect(runPostHog(renderHeader({ NODE_ENV: 'production' }, CAPTAIN), { pathname: '/' })).toBeNull();
    const dev = renderHeader({ NODE_ENV: 'development', POSTHOG_KEY: KEY }, CAPTAIN);
    expect(dev).not.toMatch(/sbl-monitoring|phc_/);
    expect(runPostHog(dev, { pathname: '/' })).toBeNull();
  });

  // sblTrack is called unconditionally by the scorecard wizard, so it must exist on every
  // render — dev included — or the wizard throws a ReferenceError where PostHog is absent.
  it('always defines sblTrack, as a no-op where PostHog is not loaded', () => {
    const dev = renderHeader({ NODE_ENV: 'development' }, CAPTAIN);
    expect(dev).toMatch(/<script src="\/static\/beta\/js\/monitoring\.js\?v=[^"]+"><\/script>/);
    const { window } = runMonitoring(dev);
    expect(typeof window.sblTrack).toBe('function');
    expect(() => window.sblTrack('x', {})).not.toThrow();
    expect(window.sblServedByUs).toBeUndefined();
  });

  // HARD-44: array.js is 104 KB, and on a phone it competed with the stylesheets and the
  // LCP image. Waiting for `load` still counts the page view.
  it('waits for the page to load before fetching PostHog', () => {
    expect(runPostHog(anon, { pathname: '/tables/All', fireLoad: false })).toBeNull();
    expect(runPostHog(anon, { pathname: '/tables/All' }).beforeLoad).toBe(false);
    expect(runPostHog(captain, { pathname: '/player-stats' }).beforeLoad).toBe(false);
  });

  // The header can run after `load` has already fired (a bfcache restore, say), when
  // waiting for it would mean never loading at all.
  it('starts at once if the page has already loaded', () => {
    expect(runPostHog(anon, { pathname: '/', fireLoad: false, readyState: 'complete' })).not.toBeNull();
  });

  // The recording exists to show the start of the session, so it cannot wait.
  it('starts a recorded page at once', () => {
    const seen = runPostHog(captain, { pathname: '/email-scorecard', fireLoad: false });
    expect(seen).not.toBeNull();
    expect(seen.beforeLoad).toBe(true);
  });

  // GA went in Nov 2026 (HARD-44 item 3). A stray gtag() call left behind would throw
  // a ReferenceError, so the scorecard wizards are checked as well as the header.
  it('loads no Google Analytics, and nothing calls it', () => {
    for (const html of [captain, anon]) {
      expect(html).not.toMatch(/googletagmanager|gtag\(|G-PSC0315491/);
    }
    for (const view of ['index-scorecard.ejs', 'messer-scorecard.ejs']) {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'views', view), 'utf8');
      expect(src).not.toMatch(/gtag\(/);
    }
  });

  it('no longer records with Sentry', () => {
    expect(MONITORING).not.toMatch(/replayIntegration|replaysSessionSampleRate/);
  });
});
