// A scheduled job authenticating without a session.
//
// Four endpoints are driven by Cloud Scheduler — the weekly data audit (HARD-07), the
// daily registration reminder, the annual invoice run (HARD-23) and the daily
// missing-scorecard reminder. Each had, or needed, the same gate, and the first two were
// near-identical copies of each other differing only in an env var name, a header name and
// an error message. This is that gate once. HARD-23 is the third caller, and CLAUDE.md's
// rule is that the second caller is what turns a fix into a rule.
//
// The fourth arrived differently and is worth noting: `GET /fixture/outstanding` was not a
// scheduler endpoint missing a gate, it was an **ungated** endpoint that a Make.com
// scenario had been calling every morning since 2025 — ungated precisely because the
// caller could not present anything. Pulling a job out of Make is therefore also a
// security fix, and that is the shape to look for in the ones still there.
//
// Three properties, and each one exists because of a specific way this has gone wrong:
//
// **Not `secured`.** `secured` redirects an anonymous caller to `/login`. Make.com's HTTP
// module follows the 302, gets a 200 from Auth0, and records a successful run — which is
// exactly how the 1 Sep 2026 invoice send failed silently. SEC-3 put `secured` on the
// invoice endpoints without checking who was already calling them, and the caller it did
// not look for was an automation whose failure is invisible for a year. A superadmin
// session still works here: `req.user` is put there by passport's session deserialisation,
// which runs globally in app.js, not by `secured`.
//
// **An unset token closes the path rather than opening it.** "Empty secret matches empty
// header" is how an unconfigured deploy becomes a public endpoint.
//
// **Both sides are hashed before comparison**, so `timingSafeEqual` gets two equal-length
// buffers. Comparing the raw strings means either a length check that leaks the secret's
// length, or a throw on mismatched lengths.

const crypto = require('crypto');
const { isSuperAdmin } = require('../utils/authz');

function tokenOk(envVar, header, req) {
  const expected = process.env[envVar] || '';
  if (!expected) return false;
  const presented = req.get(header) || '';
  if (!presented) return false;
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(presented).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Build the route middleware for one scheduled endpoint.
 *
 * @param {object}  opts
 * @param {string}  opts.envVar   env var holding the shared secret; unset closes the path
 * @param {string}  opts.header   header the scheduler presents it in, lowercase
 * @param {string}  opts.describe what the caller is trying to run, for the 403 message
 * @param {string}  opts.callerProp  request property set to 'scheduler' | 'superadmin',
 *                                   so the handler can report which one ran it
 */
function requireCronCaller(opts) {
  const { envVar, header, describe, callerProp } = opts;

  return function (req, res, next) {
    if (tokenOk(envVar, header, req)) {
      req[callerProp] = 'scheduler';
      return next();
    }
    if (isSuperAdmin(req)) {
      req[callerProp] = 'superadmin';
      return next();
    }
    const err = new Error('Not authorised to run ' + describe);
    err.status = 403;
    next(err);
  };
}

module.exports = requireCronCaller;
module.exports.requireCronCaller = requireCronCaller;
// Exported for the guard test that asserts an unset token refuses rather than admits.
module.exports.tokenOk = tokenOk;
