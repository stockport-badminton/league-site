// Who may call a route, declared as the route's first middleware (REARCH-04).
//
//   router.get('/tables/:division',   access.public,     …)
//   router.get('/profile',            access.member,     …)
//   router.get('/admin/spam',         access.superadmin, …)
//
// Until this, who could call a route was decided in four places: route middleware, a
// check inside the handler, a rate limiter alone, or nothing. "Nothing" and "a rate limiter"
// read exactly like "public on purpose", and that is how an unauthenticated GET /player/:id
// served every player's decrypted email and phone until 26 Oct 2026, and how the five
// routes in the REARCH-04 brief shipped. A declaration makes the choice visible: an open
// route says `access.public`, and the route table (docs/routes.md) shows it.
//
// Each level wraps the middleware that already does the work — it does not reimplement any
// of it — and tags the function with `.access`, which is what the route-table walker reads.
// A rate limiter is never a declaration; it goes after one.

const secured = require('./secured');
const devOnly = require('./devOnly');
const requireClubAccess = require('./requireClubAccess');
const requirePublishAuthority = require('./requirePublishAuthority');
const verifySns = require('./verifySns');
const { webhookLimiter } = require('./rateLimit');
const multer = require('multer');
const { isMesserAdmin } = require('../utils/sessionUser');

function declare(level, fn) {
  fn.access = level;
  return fn;
}

// Runs `mws` in order as one middleware. next(err), next('route') and next('router')
// leave the chain and go to the outer `next` unchanged, so devOnly's fall-through to the
// 404 still works when composed. A rejected promise from an async middleware is an error.
function compose(mws) {
  return function (req, res, next) {
    let i = 0;
    const step = (err) => {
      if (err !== undefined && err !== null) return next(err);
      const mw = mws[i++];
      if (!mw) return next();
      try {
        const r = mw(req, res, step);
        if (r && typeof r.catch === 'function') r.catch(next);
      } catch (e) {
        next(e);
      }
    };
    step();
  };
}

function requireMesserAdmin(req, res, next) {
  if (isMesserAdmin(req.user)) return next();
  const err = new Error('Only a Messer administrator can do that');
  err.status = 403;
  next(err);
}

// Anyone. Say why in a comment on the route when it is not obvious.
exports.public = declare('public', function (req, res, next) { next(); });

// Logged in.
exports.member = declare('member', function (req, res, next) { return secured(req, res, next); });

// Logged in, and the superadmin (results secretary).
exports.superadmin = declare('superadmin', compose([secured, requireClubAccess.requireSuperAdmin]));

// Logged in, and either the superadmin or holding the messeradmin claim.
exports.messerAdmin = declare('messerAdmin', compose([secured, requireMesserAdmin]));

// Logged in, and the route's :club is the viewer's own club (or they are the superadmin).
exports.clubScoped = declare('clubScoped', compose([secured, requireClubAccess]));

// A Cloud Scheduler token or a superadmin session. Takes the middleware requireCronCaller
// built — the tokens are configured where the routes are — and refuses anything else, so
// this cannot be used to label an arbitrary function as gated.
exports.cron = function (gate) {
  if (typeof gate !== 'function' || !gate.cronEnvVar) {
    throw new Error('access.cron() takes a middleware built by requireCronCaller');
  }
  return declare('cron:' + gate.cronEnvVar, function (req, res, next) { return gate(req, res, next); });
};

// The superadmin, or a valid token for the draft being published (requirePublishAuthority).
exports.publish = declare('publish', function (req, res, next) { return requirePublishAuthority(req, res, next); });

// A message signed by Amazon SNS. The one level that carries a limiter and a body parser:
// verifySns reads req.body, so the body has to be parsed before the check, and the limiter
// stays ahead of both so a flood of unsigned POSTs never reaches the certificate fetch.
// Same order /mail and /ses-events had before REARCH-04.
exports.sns = declare('sns', compose([webhookLimiter, multer().none(), verifySns]));

// Exists only on a dev server; anywhere else it falls through to the 404.
exports.devOnly = declare('devOnly', function (req, res, next) { return devOnly(req, res, next); });

// The handler checks a capability token itself (a draft link, a live-scorecard code).
// Declares that; enforces nothing. `what` says which token, for the route table.
exports.token = function (what) {
  if (!what) throw new Error('access.token() needs to say which token the handler checks');
  return declare('token:' + what, function (req, res, next) { next(); });
};

exports.compose = compose;
