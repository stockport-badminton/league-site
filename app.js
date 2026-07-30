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
var path = require('path');
const fs = require('fs');
const compression = require('compression');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { S3_KEY: VENUES_MAP_S3_KEY } = require('./utils/venues-map-generator');

if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
  throw 'Make sure you have AUTH0_DOMAIN, and AUTH0_AUDIENCE in your .env file';
}

// See utils/clientIp.js for why this is not `req.connection.remoteAddress` — the short
// version is that behind Firebase → Cloud Run that value is a Google frontend, so the
// IP blacklist below has been comparing a Google internal address against a list of
// spammers and matching nothing since the day it was written.
const { clientIp: getClientIp } = require('./utils/clientIp');

var app = express();

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

var db = require('./db_connect');
var port = process.env.PORT || 8080;

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
      app.listen(port, function() {
        console.log('Server running at http://127.0.0.1:' + port + '/');
      });
    });
  } catch {
    console.log('Unable to connect to database.');
    process.exit(1);
  }
}

module.exports = app;
