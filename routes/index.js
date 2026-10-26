var express = require('express');
const log = require('../utils/log');
var router = express.Router();
const Sentry = require('@sentry/node');

var userInViews = require('../models/userInViews');

router.use(userInViews());

// The routes, by area (REARCH-04). Order is registration order, and it matters wherever two
// patterns can match the same URL: __tests__/integration/route-shadowing.test.js checks that
// every route still answers its own URLs, and docs/routes.md records the order.
router.use(require('./auth'));
router.use(require('./social'));
router.use(require('./email'));
router.use(require('./scorecard'));
router.use(require('./static'));
router.use(require('./messer'));
router.use(require('./rosters'));
router.use(require('./results'));
router.use(require('./registrations'));
router.use(require('./admin'));

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------

// Required here rather than at the top of the file only to keep this package's diff
// inside the block it owns; `require` is cached, so there is no cost to it.
const { canonicalFor } = require('../utils/canonical');
const crypto = require('crypto');

// A short code the visitor can quote back to us, and the same string is put on the
// Sentry event as a *tag* — tags are indexed and searchable, extra context is not, so
// this is what makes "I saw error 7F2A1B" one search away from the stack trace. Without
// it a friendly error page is just a prettier dead end, which matters more here than
// usual: the site is meant to be runnable by someone who will never read a log.
//
// Random rather than a counter or a timestamp. A code has to name exactly one event,
// and Cloud Run runs several instances that share no state. Six hex characters is 16.7
// million — plenty to keep a day's errors apart, short enough to read down a phone.
function errorReference() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

router.use(function(req, res) {
  res.status(404);
  res.render('404-error', {
    static_path: '/static',
    pageTitle: 'Can\'t find the page your looking for',
    pageDescription: 'HTTP 404 Error',
    canonical: canonicalFor(req)
  });
});

// The /api/ routes answer in JSON, so their errors have to as well. Falling through
// to the HTML handler below sent a rendered 403 page to a fetch() caller, which
// could only report a generic "Save failed" — the roster editor shows the server's
// reason in its toast ("Priya Ramanathan is registered to College Green. Request a
// transfer instead."), and that only works if the reason survives the trip.
router.use(function(error, req, res, next) {
  if (!req.path.startsWith('/api/')) return next(error);

  var status = (error && (error.status || error.statusCode)) || 500;

  // A 4xx is a bad request, not a fault of ours: its message is written deliberately by
  // this code and is what the roster editor shows in its toast, so it goes straight
  // back. No Sentry event, no reference code — there is nothing to look up.
  if (status < 500) {
    return res.status(status).json({ ok: false, error: error.message });
  }

  var reference = errorReference();

  // Log as well as report — see the note on the HTML handler below.
  log.error({ err: error, reference }, '500 [' + reference + '] ' + (req && req.method) + ' ' + (req && req.originalUrl));

  Sentry.captureException(error, { tags: { reference: reference } });
  res.status(status).json({
    ok: false,
    // A 5xx message can carry internals (SQL fragments, connection strings), so it is
    // replaced rather than escaped or truncated. The reference is what makes the
    // generic message actionable.
    error: 'Something went wrong saving that. Try again.',
    reference: reference
  });
});

router.use(function(error, req, res, next) {
  // An error carrying a 4xx status is a bad request, not a fault of ours: render the
  // matching page and don't spend a Sentry event on it. Without this a junk season
  // in a path splat (see models/season.js) would 500 and refill the issue list the
  // way NODE-Q did, and assertClubAccess's 403 rendered the 500 page.
  var status = error && (error.status || error.statusCode);
  if (status >= 400 && status < 500) {
    var view = status === 403 ? '403-error' : '404-error';
    res.status(status);
    return res.render(view, {
      static_path: '/static',
      pageTitle: status === 403 ? 'Access Denied' : 'Can\'t find the page your looking for',
      pageDescription: 'HTTP ' + status + ' Error',
      canonical: canonicalFor(req)
    });
  }

  // Report to Sentry before rendering. Flush first so the event is sent while
  // Cloud Run still has CPU allocated — post-response CPU is throttled, which
  // can drop a fire-and-forget send. Flush is capped so the error page isn't
  // held up if Sentry is slow/unreachable.
  var reference = errorReference();

  // Log it as well as reporting it, and this is not belt-and-braces.
  //
  // Sentry is disabled outside production (instrument.js gates on NODE_ENV/K_SERVICE),
  // so with only the capture below, EVERY 500 in local development produced the friendly
  // page, a reference code, and absolutely nothing in the terminal. `GET /email-scorecard`
  // — the page captains actually file results from — has been failing under DEV_MODE with
  // no way to see why, which is why no browser test has ever covered it.
  //
  // In production it lands in Cloud Logging beside the request, and the same reference
  // ties the log line to the Sentry event and to the page the visitor was shown.
  log.error({ err: error, reference }, '500 [' + reference + '] ' + (req && req.method) + ' ' + (req && req.originalUrl));

  Sentry.captureException(error, { tags: { reference: reference } });
  Sentry.flush(2000).catch(() => {}).finally(function() {
    res.status(500);
    // `error` is deliberately NOT a local. The template used to render it, and a pg
    // error stringifies to its message — which is made of table and column names and
    // fragments of the failing statement. The visitor gets the reference instead; the
    // message stays on the Sentry event, tagged with the same code.
    res.render('500-error', {
      static_path: '/static',
      pageTitle: 'Something went wrong',
      pageDescription: 'HTTP 500 Error',
      reference: reference,
      canonical: canonicalFor(req)
    });
  });
});

module.exports = router;
