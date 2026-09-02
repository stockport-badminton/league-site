// Content Security Policy for the site (HARD-12).
//
// Kept out of app.js because the allowlist is a *finding*, not configuration: every
// entry below is here because a named template loads it, and the comment saying which
// one is the only thing that will stop it being deleted or duplicated later. app.js
// wires it up; this file is what you read when you want to know why maps.googleapis.com
// is on the list.
//
// -------------------------------------------------------------------------------
// Two headers, deliberately
// -------------------------------------------------------------------------------
//
// A CSP is the only change in the hardening backlog that can break a page it never
// touched, and the failure mode is silent — a blank modal, nothing in the server log.
// This site is a bad candidate for a confident first policy: 159 inline `onclick`
// attributes, 17 templates with inline <script> blocks, a scorecard wizard that fills
// its dropdowns from three endpoints with jQuery, DataTables building the stats tables,
// and a browser Sentry loader hardcoded in views/header.ejs. So the directives are
// split by whether getting them wrong can blank a page:
//
//   ENFORCED — no resource allowlist at all. Nothing here can stop a page loading
//              something it legitimately loads, because none of these directives name
//              a source of scripts, styles or images. Safe to turn on today.
//
//   OBSERVED — the full allowlist, shipped as Content-Security-Policy-Report-Only.
//              Violations are reported; nothing is blocked. This is the one that could
//              break the scorecard modal on a Tuesday night while captains are filing
//              results, so it observes first.
//
// -------------------------------------------------------------------------------
// Before setting CSP_ENFORCE=true
// -------------------------------------------------------------------------------
//
// All four, or the flip is a guess:
//
// 1. Reports are actually being received. Nothing collects them unless CSP_REPORT_URI
//    is set or the /csp-report handler in app.js is deployed — see below. A quiet week
//    with no collector is not evidence; it is no evidence.
// 2. A full week including a Tuesday and a Wednesday. Those are league nights: it is
//    the only window in which captains use the scorecard wizard in anger, and the
//    wizard is the most inline-scripted thing on the site.
// 3. Someone has visited the pages the reports cannot reach on their own — /admin
//    (Quill), /player-stats and /pair-stats (DataTables + Chart.js), /file-upload
//    (SheetJS from unpkg), an /event/ page and a /clubs/ page (Google Maps), and the
//    contact form (reCAPTCHA). Several are behind `secured` and get no anonymous
//    traffic at all, so a silent week says nothing about them.
// 4. `npm run test:e2e` passes with CSP_ENFORCE=true set for the dev server the
//    Playwright config starts — 48 specs, including the scorecard modal.
//
// The flip is reversible in a redeploy: unset the variable.
//
// Note what enforcing this policy would and would not buy. It would stop a script being
// loaded from a host not on the list. It would NOT stop an injected inline script,
// because 'unsafe-inline' has to stay while the views carry 159 onclick attributes.
// Closing that is a separate and much larger piece of work — see the note on script-src
// below — and is the reason this policy is defence in depth rather than an XSS fix.

// ---------------------------------------------------------------------------
// Enforced now
// ---------------------------------------------------------------------------
const ENFORCED = {
  // Clickjacking. The package's stated motivation — the site can be framed today. No
  // page of ours is meant to be embedded anywhere, and X-Frame-Options is set alongside
  // for browsers that predate frame-ancestors.
  //
  // Note this directive is *ignored* in a report-only header, so it has to live here to
  // do anything at all.
  'frame-ancestors': ["'self'"],

  // No template contains a <base> tag, so a legitimate page cannot be affected. An
  // injected one would silently re-point every relative URL on the page — including
  // /scripts/jquery/dist/jquery.min.js.
  'base-uri': ["'self'"],

  // No <object>, <embed> or <applet> anywhere in views/.
  'object-src': ["'none'"],

  // Every <form action> in views/ is same-origin (all 24, including the two computed
  // ones — index-scorecard.ejs defaults to /email-scorecard, scorecardController passes
  // /scorecard-beta). So this cannot break a real form, and it stops an injected form
  // posting a captain's roster edits or a contact message to somebody else's server.
  'form-action': ["'self'"],
};

// ---------------------------------------------------------------------------
// Observed (report-only) — the resource allowlist
// ---------------------------------------------------------------------------
const OBSERVED = {
  'default-src': ["'self'"],

  'script-src': [
    // jQuery, Popper, Bootstrap and Font Awesome are served from /scripts (a static
    // mount over node_modules), and roster-edit.js from /static — all same-origin.
    "'self'",

    // The honest state of the templates, not a shortcut. views/ has 159 inline
    // `onclick=` attributes and 17 files with inline <script> blocks — the gtag config,
    // the Sentry init, the Hotjar snippet, the scorecard wizard, the roster toasts.
    // Removing them is explicitly out of scope for HARD-12 and is a much larger piece
    // of work.
    //
    // The middle path the package suggests — nonces or hashes — does not help here:
    // adding a nonce makes the browser *ignore* 'unsafe-inline', which would kill all
    // 159 attribute handlers (a nonce cannot be attached to an onclick at all), and
    // 'unsafe-hashes' would need a hash per distinct handler.
    //
    // Leaving it in is also what makes the report-only period useful. With it out,
    // every page would report violations we already know about, and the one signal
    // worth having — a host nobody remembered — would be buried.
    "'unsafe-inline'",

    'https://www.googletagmanager.com',   // header.ejs — gtag.js, every page
    'https://js-de.sentry-cdn.com',       // header.ejs — the browser Sentry loader
    'https://browser.sentry-cdn.com',     // what that loader then fetches, plus every
                                          // Sentry.lazyLoadIntegration call
    'https://static.hotjar.com',          // header.ejs — the Hotjar bootstrap
    'https://script.hotjar.com',          // and the module it pulls in turn
    'https://cdn.datatables.net',         // datatables-scripts.ejs, datatables.ejs —
                                          // every stats and results table
    'https://cdn.jsdelivr.net',           // elo-chart.ejs, player-game-stats.ejs —
                                          // Chart.js and its date adapter
    'https://cdn.quilljs.com',            // admin/homepage-content-form.ejs — the
                                          // announcement editor
    'https://unpkg.com',                  // file-upload.ejs — SheetJS
    'https://connect.facebook.net',       // footer.ejs — the page plugin, every page
    'https://www.google.com',             // contact-us-form.ejs, club-v2.ejs — reCAPTCHA
    'https://www.gstatic.com',            // what reCAPTCHA loads next
    'https://maps.googleapis.com',        // club-v2.ejs directly; viewEventDetails.ejs
                                          // via the inline importLibrary bootstrap
    'https://maps.gstatic.com',
  ],

  'style-src': [
    "'self'",
    // 24 templates use style="" attributes and 4 have <style> blocks (header.ejs's
    // #eventMap height among them). Same out-of-scope reasoning as script-src.
    "'unsafe-inline'",
    'https://cdn.datatables.net',   // datatables-css.ejs
    'https://cdn.quilljs.com',      // quill.snow.css
    'https://fonts.googleapis.com', // not linked by any template — the Google Maps JS
                                    // API injects a Roboto stylesheet at runtime, which
                                    // is why grepping the views alone misses it
  ],

  'font-src': [
    "'self'",   // Font Awesome, self-hosted from /scripts
    'data:',    // DataTables and Quill inline small faces
    'https://fonts.gstatic.com', // the faces the Maps-injected stylesheet then wants
  ],

  'img-src': [
    "'self'",
    'data:',
    'blob:',
    // Deliberately open, and the one directive that is. Images on this site have no
    // fixed set of hosts: homepage.ejs renders homepage_content.image_url, an arbitrary
    // URL an admin pastes into /admin/homepage-content; the scorecard views render
    // scorecardstore."scoresheet-url" from S3; user.picture is whatever avatar host
    // Auth0 hands back; and then there are Google Maps tiles, the Facebook plugin,
    // Cloudinary event cards and analytics pixels. Images are also the lowest-value
    // XSS vector of the lot.
    'https:',
    // viewEventDetails.ejs composes its Cloudinary card over plain http. That is
    // already mixed content and already blocked on an https page — listed so the
    // report-only period does not report it as though the policy were the cause.
    'http://res.cloudinary.com',
  ],

  'connect-src': [
    "'self'",
    'https://*.ingest.de.sentry.io',      // the DSN hardcoded in header.ejs
    'https://browser.sentry-cdn.com',
    'https://*.google-analytics.com',     // gtag beacons, including region1.*
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
    'https://*.hotjar.com',
    'https://*.hotjar.io',
    'wss://*.hotjar.com',                 // Hotjar's recorder holds a websocket open
    'https://maps.googleapis.com',
    // Added 2 Sep 2026 from the report-only data — 88 of the 94 violations in the first
    // two days were these three, and none is a surprise: all three hosts are already
    // trusted in script-src, they are just also fetched from.
    'https://stats.g.doubleclick.net',    // gtag's second beacon, alongside
                                          // *.google-analytics.com above. 48 reports.
    // GA's ga-audiences beacon goes to the *viewer's local* Google domain, so this is
    // .co.uk only because the traffic is. CSP cannot wildcard a TLD, so a visitor from
    // elsewhere will report google.ie, google.fr and so on. Add them if they show up;
    // for a Stockport league they are rounding errors, and a blocked analytics beacon
    // costs a statistic rather than a feature.
    'https://www.google.co.uk',           // /ads/ga-audiences. 22 reports.
    'https://connect.facebook.net',       // the page plugin fetches its own app_config
                                          // JSON, from the host it was loaded from.
                                          // 18 reports.
  ],

  'frame-src': [
    "'self'",
    // Neither of these is an <iframe> in any template — both are created at runtime, so
    // a policy built by grepping for <iframe> finds nothing and breaks both.
    'https://www.facebook.com',   // footer.ejs's .fb-page plugin, on every page
    'https://www.google.com',     // the reCAPTCHA challenge
    'https://recaptcha.google.com',
    'https://vars.hotjar.com',
  ],

  // /sw.js, registered by pwa-head.ejs on every page.
  'worker-src': [
    "'self'",
    // Sentry Session Replay compresses in a Worker built from a blob URL. It is
    // path-gated by REPLAY_PATHS in header.ejs, which is why the only reports came from
    // /email-scorecard rather than sitewide. A narrow concession: it permits a worker
    // from a blob this origin created, not script from anywhere.
    'blob:',
  ],
  // /manifest.json, likewise.
  'manifest-src': ["'self'"],
  // No <video> or <audio> in any template today; the generated social videos are handed
  // out as S3 URLs by an API, not embedded.
  'media-src': ["'self'"],
};

// ---------------------------------------------------------------------------
// Where reports go
// ---------------------------------------------------------------------------
//
// HARD-12 says "Sentry will collect the violations". Sentry does not do that on its own:
// it needs report-uri pointed at the project's security-header endpoint *and* the
// feature enabled in project settings, and neither was ever set up. A report-only period
// with nowhere receiving the reports observes nothing, which is the failure mode this
// whole package is trying to avoid.
//
// So the default is our own /csp-report handler in app.js, which writes one greppable
// line to Cloud Logging per violation. That costs no Sentry quota — and browser
// extensions generate a great deal of CSP noise, so quota would have been the first
// thing to go.
//
// To send them to Sentry instead, set CSP_REPORT_URI to the security endpoint derived
// from the browser DSN in views/header.ejs:
//
//   https://o4508301910540288.ingest.de.sentry.io/api/4508301914800208/security/
//     ?sentry_key=41a5442332daa78ebc9dba9dfe8da392
//
// Set CSP_REPORT_URI='' to emit no reporting directives at all.
const DEFAULT_REPORT_URI = '/csp-report';
const REPORT_GROUP = 'csp-endpoint';

function reportUri() {
  return process.env.CSP_REPORT_URI === undefined
    ? DEFAULT_REPORT_URI
    : process.env.CSP_REPORT_URI;
}

function isEnforcing() {
  return process.env.CSP_ENFORCE === 'true';
}

// HSTS, as a value rather than a literal in app.js — so it can be tested without booting
// the app.
//
// It lived inline in the helmet() call, and the only way to test the env switch was
// `jest.resetModules()` plus `require('../../app')`, which builds a second application
// including a second pg pool. That leaked: Jest reported "a worker process has failed to
// exit gracefully" and the test timed out roughly one full run in nine. It looked exactly
// like the contention flakiness this suite already had, which is the worst kind of bad
// test — it hides in a known problem.
//
// `includeSubDomains` is off unless asked for. It commits *every* subdomain of the domain
// to HTTPS for a year, and a browser that has seen the header keeps honouring it, so
// anything http-only on a subdomain breaks and stays broken for people who have already
// visited — whatever we serve afterwards. Nobody has confirmed what is on the subdomains,
// and this app serves the apex.
//
// No `preload` either: that is a submission to a browser-vendor list, slow to reverse and
// not ours to make unilaterally.
const HSTS_MAX_AGE = 31536000; // one year

function strictTransportSecurity() {
  return {
    maxAge: HSTS_MAX_AGE,
    includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS === 'true',
    preload: false,
  };
}

// report-uri is deprecated but is still the only one Firefox and Safari implement;
// report-to (with the Reporting-Endpoints header) is the only one current Chrome
// honours. Both, or half the visitors report nothing.
function reportingDirectives() {
  const uri = reportUri();
  if (!uri) return {};
  return { 'report-uri': [uri], 'report-to': [REPORT_GROUP] };
}

function reportingEndpointsHeader() {
  const uri = reportUri();
  return uri ? `${REPORT_GROUP}="${uri}"` : null;
}

// The observed policy carries the reporting directives; the enforced baseline does not,
// because a violation of frame-ancestors or form-action is an attack in progress rather
// than something to tune, and doubling every report is not worth the noise. When
// CSP_ENFORCE is set the two merge and the reporting comes with them.
function enforcedDirectives() {
  if (isEnforcing()) return { ...ENFORCED, ...OBSERVED, ...reportingDirectives() };
  // helmet refuses a policy with no default-src unless you say so in as many words,
  // which is the right default and the wrong one here: the absence of default-src is
  // the entire point of the enforced baseline. With one, every resource this site loads
  // from a CDN would be blocked for real visitors from the moment this deploys — which
  // is the failure the report-only header exists to rehearse.
  return {
    ...ENFORCED,
    'default-src': require('helmet').contentSecurityPolicy.dangerouslyDisableDefaultSrc,
  };
}

function observedDirectives() {
  return isEnforcing() ? null : { ...OBSERVED, ...reportingDirectives() };
}

module.exports = {
  ENFORCED,
  OBSERVED,
  REPORT_GROUP,
  DEFAULT_REPORT_URI,
  reportUri,
  isEnforcing,
  strictTransportSecurity,
  HSTS_MAX_AGE,
  enforcedDirectives,
  observedDirectives,
  reportingEndpointsHeader,
};
