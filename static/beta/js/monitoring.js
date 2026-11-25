// Browser monitoring: `sblTrack` on every page, and in production PostHog and Sentry.
//
// Loaded from header.ejs, in <head> and not deferred: the scorecard wizard calls
// sblTrack unconditionally from its Continue buttons, which exist before a deferred
// script would run, and a recorded page starts PostHog at once. What the server knows
// (the site's host, the PostHog key, who is logged in) arrives in the
// #sbl-monitoring JSON block just above this script, which the header emits only in
// production (NODE_ENV or Cloud Run's K_SERVICE, the same condition instrument.js uses
// for the server side). Without the block, sblTrack is defined and nothing else runs.
(function () {
  // Named PostHog events (the scorecard wizard's photo auto-fill, for a start), so a
  // recording or a funnel can be found by what happened in it. Always defined, and a
  // no-op wherever PostHog was not loaded (dev, tests, superadmins), so callers never
  // need to check.
  //
  // `opts.leaving` is for a caller about to navigate away (a filter Apply, a save
  // followed by a reload): it sends the event now rather than in the next batch, which
  // the navigation could otherwise cut off.
  window.sblTrack = function (name, props, opts) {
    if (!(window.posthog && window.posthog.__loaded)) return;
    if (opts && opts.leaving) window.posthog.capture(name, props || {}, { send_instantly: true });
    else window.posthog.capture(name, props || {});
  };

  var el = document.getElementById('sbl-monitoring');
  if (!el) return;
  var cfg;
  try { cfg = JSON.parse(el.textContent); } catch (e) { return; }

  // Are we actually the ones serving this page? Shared by Sentry and PostHog.
  //
  // The production gate is decided when the page is RENDERED, which keeps dev and test
  // renders out but cannot keep a *production* render from being saved and reopened
  // elsewhere. A saved page carries the config block and the user id with it, and goes
  // on reporting as `environment: production` for as long as the file exists.
  //
  // 14 Sep 2026: a saved copy of `/email-scorecard` (a `secured` page, so whoever saved
  // it was logged in) opened off a Windows network share at
  // `file://server/Data/.../stockport-badminton.co.uk/email-scorecard.html` and reported
  // `ReferenceError: $ is not defined`, because jQuery cannot load over `file://`.
  // Nothing was wrong with the site. Two events and one "user" who was a file path.
  //
  // So the runtime check: a real scheme, and a host we recognise. `.run.app` is allowed
  // because Firebase rewrites to Cloud Run and that hostname serves the whole site
  // publicly (CLAUDE.md gotcha 1b). An optional `www.` is allowed so a visitor arriving
  // that way is not silently unmonitored.
  var h = location.hostname;
  window.sblServedByUs =
    (location.protocol === 'https:' || location.protocol === 'http:') &&
    (h === cfg.expectedHost || h === 'www.' + cfg.expectedHost || /\.run\.app$/.test(h));

  if (cfg.sentry) {
    // Called by Sentry's loader (deferred, in the header after this file) once the SDK
    // is available.
    window.sentryOnLoad = function () {
      if (!window.sblServedByUs) return;
      // No session replay: PostHog records the scorecard flows. Sentry's free tier is 50
      // replays a month shared with tameside-site, which ran out within days, and a
      // replay that starts at the error misses the OCR steps that come before it.
      Sentry.init({
        dsn: 'https://41a5442332daa78ebc9dba9dfe8da392@o4508301910540288.ingest.de.sentry.io/4508301914800208',
        environment: cfg.sentry.environment,
        tracesSampleRate: 0,
      });
      Sentry.lazyLoadIntegration('captureConsoleIntegration').then(function (integration) {
        // Only real errors, not console.log/info/debug/warn, so stray logging does not
        // flood the free-tier quota.
        Sentry.addIntegration(integration({ levels: ['error'] }));
      });
      Sentry.setUser({ id: cfg.sentry.userId });
    };
  }

  // PostHog: web analytics on every page, and session recordings on the results-entry
  // pages only. It replaced Google Analytics in Nov 2026 (HARD-44 item 3).
  //
  // Started after the `load` event, so the 104 KB of array.js does not share a phone's
  // connection with the stylesheets and the LCP image. The page view is still counted,
  // and the web vitals are read from buffered performance entries. A recorded page is
  // the exception: the recording exists to show the start of the session.
  //
  // cookieless_mode 'always' stores nothing in the browser, so it needs no consent.
  // identify() is not available in that mode: the account id goes on each event as a
  // property instead. Not loaded at all for a superadmin, who tests these pages daily.
  //
  // Recorded only on a results-entry page, to watch how captains use the photo
  // auto-fill. Inputs are unmasked so scores are visible; recordings carry player names.
  var ph = cfg.posthog;
  if (!ph || !window.sblServedByUs || ph.isSuperadmin) return;
  var RECORD_PATHS = [
    /^\/email-scorecard/,
    /^\/populated-scorecard-beta/,
    /^\/messer-scorecard-beta/,
    /^\/populated-messer-scorecard/
  ];
  var record = ph.loggedIn && RECORD_PATHS.some(function (re) { return re.test(location.pathname); });

  var s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = 'https://eu-assets.i.posthog.com/static/array.js';
  s.onload = function () {
    // A recorded page uses in-memory persistence instead of cookieless mode, because
    // the recorder cannot run cookieless: that mode keeps no session in the browser, and
    // without one the recorder never starts. 'memory' still stores nothing in the
    // browser; the cost is that each page load is a new session.
    var storage = record ? { persistence: 'memory' } : { cookieless_mode: 'always' };
    window.posthog.init(ph.key, Object.assign({
      api_host: 'https://eu.i.posthog.com',
      person_profiles: 'never',
      // Names the element behind each LCP/INP/CLS reading. Web vitals capture itself is
      // switched on in the project settings, not here.
      capture_performance: { web_vitals_attribution: true },
      disable_session_recording: !record,
      session_recording: { maskAllInputs: false },
    }, storage));
    window.posthog.register({
      league: location.hostname.replace(/^www\./, ''),
      logged_in: ph.loggedIn,
      account_id: ph.accountId,
      role: ph.role,
      club: ph.club,
      messer_admin: ph.messerAdmin
    });
  };
  function start() { document.head.appendChild(s); }
  if (record || document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
