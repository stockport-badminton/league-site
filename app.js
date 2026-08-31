// Sentry instrumentation — must load before express and other modules.
require('./instrument');
const Sentry = require('@sentry/node');

require('dotenv').config();

var express = require('express');
var session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
var passport = require('passport');
var Auth0Strategy = require('passport-auth0');
var bodyParser = require('body-parser');
var helmet = require('helmet');
var path = require('path');
const fs = require('fs');
const compression = require('compression');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { S3_KEY: VENUES_MAP_S3_KEY } = require('./utils/venues-map-generator');
// Required up here rather than beside the startup block below, because /healthz uses it
// and a hoisted `var` that only happens to be assigned in time is not something to rely
// on.
var db = require('./db_connect');

if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
  throw 'Make sure you have AUTH0_DOMAIN, and AUTH0_AUDIENCE in your .env file';
}

// See utils/clientIp.js for why this is not `req.connection.remoteAddress` — the short
// version is that behind Firebase → Cloud Run that value is a Google frontend, so the
// IP blacklist below has been comparing a Google internal address against a list of
// spammers and matching nothing since the day it was written.
const { clientIp: getClientIp } = require('./utils/clientIp');

var app = express();

// ---------------------------------------------------------------------------
// Security response headers
// ---------------------------------------------------------------------------
//
// Mounted first, above everything including the static handlers, the IP blocklist and
// /healthz, because "present on every response" is the requirement — a header that is
// missing from the one response an attacker cares about is not a control.
//
// The policy itself lives in utils/securityHeaders.js, where each allowlist entry sits
// next to the template that forces it. Read that file before changing anything here.
//
// Two CSP headers go out. The enforcing one carries no resource allowlist at all, so it
// cannot blank a page that works today; the full allowlist ships report-only until it
// has been observed. See the module for why that split, and for why a nonce-based
// policy is not the answer on a site with 159 inline onclick handlers.
var securityHeaders = require('./utils/securityHeaders');

app.use(helmet({
  // Set explicitly below, as two headers rather than helmet's single enforcing one.
  contentSecurityPolicy: false,

  // Helmet's default is no-referrer, which also strips the referrer from links out to
  // the clubs' own websites and from analytics. strict-origin-when-cross-origin keeps
  // the full path same-origin and sends only the origin outward — the modern browser
  // default, and enough for the privacy the strict setting was buying.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  // A year, for this host only.
  //
  // No `preload`: that is a submission to a browser-vendor list which is slow and
  // awkward to reverse, and is not ours to commit to unilaterally.
  //
  // No `includeSubDomains` either, for a smaller version of the same reason. It commits
  // *every* subdomain of stockport-badminton.co.uk to HTTPS for a year, and a browser
  // that has already seen the header keeps honouring it — so anything http-only on a
  // subdomain (an old blog, a webmail interface, something at a hosting provider) breaks
  // and stays broken for people who have visited the site, whatever we serve afterwards.
  // Nobody has confirmed what lives on the subdomains, and the apex is what this app
  // serves. Set HSTS_INCLUDE_SUBDOMAINS=true once someone has checked.
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS === 'true',
    preload: false,
  },

  // Everything on this site is public, and it is meant to be embedded elsewhere:
  // views/emails/websiteUpdated.ejs mails a generated result image hosted here, and the
  // og:image is fetched by other people's link previewers. Helmet's same-origin default
  // would tell browsers not to render our own images anywhere but our own pages.
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // Helmet's default is same-origin, which severs window.opener for any popup. The
  // Auth0 login here is a redirect flow so nothing depends on it today, but the
  // Facebook SDK opens popups and the allow-popups variant keeps the isolation that
  // matters without betting on that.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },

  // Off (which is also helmet's default since v6). Requiring CORP on every cross-origin
  // subresource would block Cloudinary, Google Maps tiles, the Facebook plugin and
  // every avatar Auth0 hands back, none of which send one.
  crossOriginEmbedderPolicy: false,
}));

// Chrome no longer honours report-uri; it wants a named group declared in this header.
// Firefox and Safari have it the other way round, so both go out — see the module.
app.use(function(req, res, next) {
  var endpoints = securityHeaders.reportingEndpointsHeader();
  if (endpoints) res.setHeader('Reporting-Endpoints', endpoints);
  next();
});

app.use(helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: securityHeaders.enforcedDirectives(),
}));

if (securityHeaders.observedDirectives()) {
  app.use(helmet.contentSecurityPolicy({
    useDefaults: false,
    reportOnly: true,
    directives: securityHeaders.observedDirectives(),
  }));
}

// Past seasons for the History nav / archive, loaded from the DB at startup
// (below). Default to empty so views always have an array to iterate.
app.locals.pastSeasons = [];

// Event-page URLs are built in two places that must not drift: the homepage's
// upcoming-fixtures list and the generated sitemap. Exposed as a view local so
// the template calls the same function the sitemap does, rather than reassembling
// the date arithmetic inline.
app.locals.eventPath = require('./utils/canonical').eventPath;

// Same reasoning for club pages: /info/clubs links them, the sitemap lists them and
// their SportsClub markup names them as `url`. One builder, so they cannot diverge.
app.locals.clubPath = require('./utils/canonical').clubPath;

// Honeypot field name and a freshly signed render timestamp, for views/spam-fields.ejs.
// Per-request rather than app-wide because the stamp has to be the time this page was
// rendered — that is the whole point of it. One HMAC per request is nothing.
const spamChecks = require('./utils/spamChecks');
app.locals.spamHoneypotField = spamChecks.HONEYPOT_FIELD;
app.use(function(req, res, next) {
  res.locals.spamFormStamp = spamChecks.formStamp();
  next();
});

// Blocked addresses now come from the blocked_entry table via models/spamControls, so
// blocking someone is a form submission on /admin/spam rather than an edit to this file
// followed by a deploy. The three addresses that used to be hardcoded here are seeded in
// migration 010.
//
// Read from the in-memory cache synchronously: this runs on every request, and awaiting a
// query here would put a DB round trip in front of every page. The cache is warmed at
// startup and refreshed on a timer below.
//
// Answers 403 now. It used to `res.send(...)` a message about a "whiteList" with a 200
// status, which tells a crawler the page exists and a spammer exactly what happened.
const spamControls = require('./models/spamControls');

app.use(function(req, res, next) {
  var ipAddress = getClientIp(req);
  if (!spamControls.isBlockedIpSync(ipAddress)) {
    return next();
  }
  console.log(`traffic from ${ipAddress} blocked`);
  res.status(403).send('Forbidden');
});

app.use(compression());
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// (The sitewide request ceiling is mounted after the static handlers below — see there.)

// Must be registered before the `rootfiles` static mount below, or that
// mount shadows this route and the service worker never gets a fresh
// per-deploy cache version.
app.get('/sw.js', function(req, res) {
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'no-cache');
  res.render('sw', { cacheVersion: process.env.K_REVISION || 'dev-local' });
});

// Same reasoning/ordering as /sw.js above: registered before the /static
// mount so it isn't shadowed. Proxies from S3 (not local disk, which is
// ephemeral/per-instance on Cloud Run) but keeps the same site-relative
// path so the service worker's existing /static/generated/* caching rule
// applies with no changes.
var venuesMapS3 = new S3Client({ region: 'eu-west-1' });
app.get('/static/generated/venues-map.png', async function(req, res) {
  try {
    var obj = await venuesMapS3.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: VENUES_MAP_S3_KEY
    }));
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    obj.Body.pipe(res);
  } catch (err) {
    res.status(404).end();
  }
});

// Liveness + readiness, for an external uptime monitor.
//
// Mounted here, above globalLimiter, on purpose: a monitor polling every minute would
// otherwise spend the sitewide request budget, which is the same trap that made the
// browser suite run out of requests when the limiter sat above the static handlers.
//
// It answers "can this instance reach the database", not merely "is the process alive".
// The homepage is a poor substitute for that — it is cached, and it renders happily from
// a warm instance while Postgres is unreachable, which is precisely the outage you want
// to be told about. Excluded from the sitemap: it is not a page.
app.get('/healthz', async function(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const conn = await db.otherConnect();
    await conn.query('SELECT 1');
    res.status(200).json({ ok: true, uptime: Math.round(process.uptime()) });
  } catch (err) {
    console.error('healthz: database unreachable:', err.message);
    res.status(503).json({ ok: false, error: 'database unreachable' });
  }
});

// Where the report-only CSP sends its violations.
//
// HARD-12 assumed Sentry would collect these. It does not do so by itself — that needs
// report-uri pointed at the project's security-header endpoint and the feature switched
// on in project settings, and neither had been done. A report-only period with nothing
// receiving the reports observes nothing, which is exactly the outcome the report-only
// step exists to avoid. So we collect them ourselves, into Cloud Logging, where they
// cost nothing and can be counted. CSP_REPORT_URI redirects them elsewhere.
//
// Mounted here for the same reason /healthz is, and more so: a browser fires one report
// per blocked subresource, so one page load under a wrong policy can be a dozen POSTs.
// Below globalLimiter those would spend a real visitor's sitewide budget and then
// rate-limit the pages they were trying to read.
//
// Deliberately not sent to Sentry. Browser extensions inject scripts into pages
// constantly and each one is a violation; forwarding them would exhaust the free-tier
// quota within days and bury the server errors it exists to show.
var cspBodyParser = express.json({
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
  limit: '32kb'
});

// The report body is written by the visitor's browser about a URL an attacker may have
// chosen, and it ends up in a log. A newline in it would forge a log line of its own.
function logSafe(value) {
  if (typeof value !== 'string') return '-';
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300);
}

// chrome-extension:, moz-extension:, safari-web-extension: and friends are injected
// scripts; webkit-masked-url: is what Safari substitutes for one rather than naming it.
var IGNORED_SCHEMES = /^(?:(?:chrome|moz|safari|safari-web|ms-browser)-extension|webkit-masked-url|about):/i;

app.post('/csp-report', require('./middleware/rateLimit').cspReportLimiter, cspBodyParser, function(req, res) {
  // Answer first and unconditionally. A report endpoint that can 4xx teaches a browser
  // nothing useful and gives an attacker a probe; there is nothing for the client to do
  // with the answer either way.
  res.status(204).end();

  var body = req.body;
  // Two wire formats: report-uri posts { "csp-report": {...} }, the Reporting API posts
  // an array of { type, url, body }. Both are in the field simultaneously.
  var reports = Array.isArray(body)
    ? body.filter(function(r) { return r && r.type === 'csp-violation'; })
        .map(function(r) {
          return {
            directive: r.body && (r.body.effectiveDirective || r.body.violatedDirective),
            blocked: r.body && r.body.blockedURL,
            document: r.body && r.body.documentURL || r.url,
            source: r.body && r.body.sourceFile
          };
        })
    : (body && body['csp-report'] ? [{
        directive: body['csp-report']['effective-directive'] || body['csp-report']['violated-directive'],
        blocked: body['csp-report']['blocked-uri'],
        document: body['csp-report']['document-uri'],
        source: body['csp-report']['source-file']
      }] : []);

  reports.forEach(function(r) {
    // Extension-injected scripts violate any policy on any site and are not ours to
    // fix. Left in, they are the overwhelming majority of the volume and the reason a
    // report-only period gets abandoned as noise.
    if (r.blocked && IGNORED_SCHEMES.test(r.blocked)) return;
    console.warn('csp-report: ' + logSafe(r.directive) +
      ' blocked=' + logSafe(r.blocked) +
      ' page=' + logSafe(r.document) +
      ' source=' + logSafe(r.source));
  });
});

app.use('/static', express.static(path.join(__dirname, '/static')));
app.use('/scripts', express.static(__dirname + '/node_modules/'));
app.use(express.static('rootfiles'));

// Sitewide request ceiling — the backstop for anything nobody thought to limit
// individually. The per-endpoint limits in routes/index.js are the ones that matter for
// spam.
//
// Mounted *after* the static handlers deliberately. Mounted before them it counted every
// stylesheet, script and image, so one page view was a dozen or more hits and the browser
// test suite exhausted a 600-request budget partway through — which is also what a real
// visitor on a slow connection would eventually do. Below the static mounts, one page view
// is one hit.
app.use(require('./middleware/rateLimit').globalLimiter);
app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(bodyParser.urlencoded({ extended: false }));

var Player = require('./models/players');

var strategy = new Auth0Strategy(
  {
    domain: process.env.AUTH0_DOMAIN,
    clientID: process.env.AUTH0_CLIENTID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    callbackURL: process.env.AUTH0_CALLBACK_URL || 'http://127.0.0.1:8080/callback'
  },
  function(accessToken, refreshToken, extraParams, profile, done) {
    // Enrich the profile with role/club/messeradmin from the player table
    // (Postgres, not Auth0 app_metadata, is now the source of truth for
    // authorization — see migrations/008_player_auth_roles.sql). Writing to
    // the same claim keys the rest of the app already reads means no other
    // call site needs to change. The whole profile is cached in the session
    // for its lifetime, so this is one DB query per login, not per request.
    var email = profile.emails && profile.emails[0] && profile.emails[0].value;
    Player.getAuthRoleByEmail(email).then(function(authRow) {
      var role = authRow && authRow.role;
      profile._json['https://my-app.example.com/role'] = role || undefined;
      profile._json['https://my-app.example.com/club'] = role === 'superadmin' ? 'All' : (role === 'admin' ? authRow.clubName : undefined);
      profile._json['https://my-app.example.com/messeradmin'] = !!(authRow && authRow.messerAdmin);
      done(null, profile);
    }).catch(function(err) { done(err); });
  }
);

passport.use(strategy);

passport.serializeUser(function(user, done) { done(null, user); });
passport.deserializeUser(function(user, done) { done(null, user); });

var sess = {
  name: '__session',
  store: new pgSession({ conString: process.env.DATABASE_URL, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'ThisisMySecret',
  cookie: {},
  resave: false,
  saveUninitialized: false
};
if (process.env.NODE_ENV === 'production') {
  // `true`, not `1`. There are two proxies in front of this app (Firebase Hosting and
  // the Cloud Run frontend), so trusting a single hop left `req.ip` as a Google
  // address — which would put every visitor in one rate-limit bucket. Trusting the
  // chain takes the leftmost X-Forwarded-For entry, i.e. the visitor. See
  // utils/clientIp.js for the spoofability trade-off that comes with it.
  app.set('trust proxy', true);
  sess.cookie.secure = true;
  sess.proxy = true;
}

app.use(session(sess));
app.use(require('./middleware/devMode'));
app.use(passport.initialize());
app.use(passport.session());

// Parses the filter path segments (/player-stats/Division-1/gender-Male/...) into
// res.locals.filterBar, so views/filters.ejs can show what's applied and build
// links that add or drop one filter without losing the others.
app.use(require('./middleware/filterState').middleware);

app.use(require('./routes'));

// Sentry error handler — must be after all routes, before any other error middleware.
Sentry.setupExpressErrorHandler(app);

var port = process.env.PORT || 8080;

// ---------------------------------------------------------------------------
// Staying alive, and dying tidily
// ---------------------------------------------------------------------------

// Node 22 treats an unhandled promise rejection as fatal — the process exits. There was
// no handler anywhere in this codebase, so a single promise rejecting without a .catch()
// (an SES send in a fire-and-forget path, an S3 call, a timer callback) took the whole
// Cloud Run instance down and every in-flight request with it. Same shape as the pg pool
// crash on 6 August; that one has a listener now, nothing else did.
//
// Report it and keep serving. A rejected promise somewhere is a bug to fix, not a reason
// to drop the requests of everyone currently using the site.
process.on('unhandledRejection', function(reason) {
  const err = reason instanceof Error ? reason : new Error('Unhandled rejection: ' + reason);
  console.error('unhandledRejection (kept serving):', err.message);
  Sentry.captureException(err, { tags: { source: 'unhandled-rejection' } });
});

// An uncaught exception is different: the stack unwound through code that was not
// expecting it, so the process state is genuinely unknown and carrying on risks serving
// wrong answers. Report, flush, and exit non-zero so Cloud Run replaces the instance —
// still far better than dying silently with nothing recorded.
process.on('uncaughtException', function(err) {
  console.error('uncaughtException (exiting):', err && err.message);
  Sentry.captureException(err, { tags: { source: 'uncaught-exception' } });
  Sentry.flush(2000).catch(function() {}).finally(function() {
    process.exit(1);
  });
});

// Cloud Run sends SIGTERM and allows ten seconds before killing the container. With no
// handler the process died at once, severing whatever was in flight — on every deploy
// and every scale-down. Usually a page load somebody retries; occasionally a captain
// submitting a scorecard.
//
// `server` is captured from app.listen below; without a reference there is nothing to
// close. The timeout is deliberately under Cloud Run's grace period, so a single stuck
// request cannot hold the shutdown past the point where we are killed anyway.
const SHUTDOWN_GRACE_MS = 8000;
function shutdown(signal, server) {
  console.log(`${signal} received — draining`);
  const done = function(code) {
    db.end().catch(function() {}).finally(function() { process.exit(code); });
  };
  const timer = setTimeout(function() {
    console.error('drain timed out; exiting anyway');
    done(1);
  }, SHUTDOWN_GRACE_MS);
  timer.unref();

  if (!server) return done(0);
  server.close(function() {
    clearTimeout(timer);
    console.log('drained cleanly');
    done(0);
  });
}

if (require.main === module) {
  try {
    db.connect();
    // Resolve the current/previous season from the DB (cached) before serving,
    // so all season-scoped queries agree on which season is "current".
    const seasonModel = require('./models/season');
    seasonModel.init().then(async function() {
      // Cache past seasons (all but the current) for the History nav / archive.
      try {
        const all = await seasonModel.getAll();
        const current = seasonModel.current();
        app.locals.pastSeasons = all.filter(function(s) { return s.name !== current; });
      } catch (err) {
        console.error('pastSeasons load failed:', err.message);
      }
      // Which seasons the archive can actually serve, for the /tables season guard
      // (middleware/validateSeason.js). Falls back to format-only checks if this
      // fails, so a hiccup here means some 500s rather than a 404 on every archive
      // page — see models/season.js.
      try {
        const servable = await seasonModel.loadServable();
        console.log('Servable seasons loaded:', servable);
      } catch (err) {
        console.error('servable seasons load failed:', err.message);
      }
      // Division/season option lists for the filter toolbar. Runs after
      // season.init() because the current season decides which seasons are
      // offerable (see middleware/filterState.js).
      try {
        const counts = await require('./middleware/filterState').init();
        console.log('Filter options loaded:', counts.divisions, 'divisions,', counts.seasons, 'seasons');
      } catch (err) {
        console.error('filterState load failed:', err.message);
      }
      // Warm the blocklist cache before serving, because the IP check on every request
      // reads it synchronously. A failure here leaves the lists empty rather than
      // failing closed — the rate limits, captcha and honeypot all still apply — and the
      // timer below picks it up on the next tick.
      try {
        await spamControls.refresh();
        console.log('Blocklists loaded');
      } catch (err) {
        console.error('blocklist load failed:', err.message);
      }
      // Keep the cache fresh so an admin change lands within a minute on every instance
      // without needing a restart or cross-instance invalidation. unref() so this timer
      // never holds the process open.
      setInterval(function() {
        spamControls.refresh().catch(function(err) {
          console.error('blocklist refresh failed:', err.message);
        });
      }, 60 * 1000).unref();
    }).finally(function() {
      const server = app.listen(port, function() {
        console.log('Server running at http://127.0.0.1:' + port + '/');
      });
      ['SIGTERM', 'SIGINT'].forEach(function(sig) {
        process.on(sig, function() { shutdown(sig, server); });
      });
    });
  } catch {
    console.log('Unable to connect to database.');
    process.exit(1);
  }
}

module.exports = app;
