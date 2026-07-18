// Sentry instrumentation — must load before express and other modules.
require('./instrument');
const Sentry = require('@sentry/node');

require('dotenv').config();

var AWS = require('aws-sdk');
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

const BLACKLIST = ['136.243.212.110', '165.231.182.103', '65.0.96.6'];

var getClientIp = function(req) {
  var ipAddress = req.connection.remoteAddress;
  if (!ipAddress) { return ''; }
  if (ipAddress.substr(0, 7) == '::ffff:') { ipAddress = ipAddress.substr(7); }
  return ipAddress;
};

AWS.config.update({ region: 'eu-west-1' });

var app = express();

app.use(function(req, res, next) {
  var ipAddress = getClientIp(req);
  if (BLACKLIST.indexOf(ipAddress) === -1) {
    next();
  } else {
    console.log(`traffic from ${ipAddress} blocked`);
    res.send(ipAddress + ' IP is not in whiteList');
  }
});

app.use(compression());
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

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
app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(bodyParser.urlencoded({ extended: false }));

var strategy = new Auth0Strategy(
  {
    domain: process.env.AUTH0_DOMAIN,
    clientID: process.env.AUTH0_CLIENTID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    callbackURL: process.env.AUTH0_CALLBACK_URL || 'http://127.0.0.1:8080/callback'
  },
  function(accessToken, refreshToken, extraParams, profile, done) {
    return done(null, profile);
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
  app.set('trust proxy', 1);
  sess.cookie.secure = true;
  sess.proxy = true;
}

app.use(session(sess));
app.use(require('./middleware/devMode'));
app.use(passport.initialize());
app.use(passport.session());

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
    require('./models/season').init().finally(function() {
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
