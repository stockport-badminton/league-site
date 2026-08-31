// The weekly data-integrity digest (HARD-07).
//
// Every failure the August 2026 audit found is silent by construction. A result that
// committed halfway, a filed scorecard that matches no fixture, a score that does not
// total 18, a withdrawn team still holding a division place — each of them renders a
// perfectly normal page. Discovery has depended entirely on a member noticing something
// odd and mentioning it, and the three broken results from last season went a whole
// season unmentioned. One email a week turns all of that into something a person sees
// within days.
//
// Three things in here are load-bearing.
//
// 1. The recipient comes only from AUDIT_EMAIL_TO. Never from the request, in any form.
//    `/fixture/reminder` took its address from the request body and was an open relay
//    from our own verified sending domain; the rule in CLAUDE.md exists because of it.
//    And with no recipient configured this sends nothing at all — which matters more
//    here than in most places, because DATABASE_URL is production even in dev.env, so a
//    scheduled job that mailed on import would mail the real results secretary from
//    whichever laptop happened to have the repo checked out.
//
// 2. The report is not public. It is a list of every weakness in the league's data,
//    which is a shopping list for anyone who wanted to quietly alter a result. The
//    invoice endpoints are the cautionary tale (SEC-3): unauthenticated, and everyone
//    would have found out on the one day a year they fired.
//
// 3. Nothing here can fail in a way that stops the email. A check that throws is
//    reported *in* the digest (checks.runAll already catches per-check), and a send that
//    fails answers 200 with the reason rather than a 500, because a 500 to Cloud
//    Scheduler produces a retry storm against a job whose whole output is one email.

const crypto = require('crypto');
const ejs = require('ejs');
const db = require('../db_connect.js');
const checks = require('../tools/audit/checks');
const { buildDigest } = require('../utils/auditDigest');
const { absoluteUrl } = require('../utils/canonical');
const ses = require('../utils/ses');
const { isSuperAdmin } = require('../utils/authz');

const VIEW = 'views/emails/weekly-anomalies.ejs';
const DEFAULT_SOURCE = 'results@stockport-badminton.co.uk';
const TOKEN_HEADER = 'x-audit-token';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Comma-separated, because Cloud Run environment variables are single strings and the
// results secretary will eventually want the chair copied in. Anything without an @ is
// dropped rather than passed to SES, which rejects the whole call on one bad address —
// so a stray trailing comma cannot cost the good recipients their email.
function recipients() {
  return String(process.env.AUDIT_EMAIL_TO || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.includes('@'));
}

function source() {
  return process.env.AUDIT_EMAIL_FROM || DEFAULT_SOURCE;
}

// ---------------------------------------------------------------------------
// Who may run it
// ---------------------------------------------------------------------------

// Cloud Scheduler has no session, so it presents a shared secret in a header.
//
// Both sides are hashed before comparison so timingSafeEqual gets two equal-length
// buffers: comparing the raw strings means either a length check that leaks the secret's
// length, or a throw on mismatched lengths. And an unset AUDIT_CRON_TOKEN closes the
// token path rather than opening it — the failure mode of "empty secret matches an empty
// header" is exactly how an unconfigured deploy becomes a public endpoint.
function cronTokenOk(req) {
  const expected = process.env.AUDIT_CRON_TOKEN || '';
  if (!expected) return false;
  const presented = req.get(TOKEN_HEADER) || '';
  if (!presented) return false;
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(presented).digest();
  return crypto.timingSafeEqual(a, b);
}

// Route middleware for the send endpoint. Deliberately not `secured`: `secured` redirects
// an anonymous caller to /login, and a scheduler following a 302 to Auth0 would be
// reported as a successful job. A superadmin session still works — req.user is put there
// by passport's session deserialisation, not by `secured`.
function requireAuditCaller(req, res, next) {
  if (cronTokenOk(req)) {
    req.auditCaller = 'scheduler';
    return next();
  }
  if (isSuperAdmin(req)) {
    req.auditCaller = 'superadmin';
    return next();
  }
  const err = new Error('Not authorised to run the league data audit');
  err.status = 403;
  next(err);
}

// ---------------------------------------------------------------------------
// Building the report
// ---------------------------------------------------------------------------

async function buildReport(opts = {}) {
  const conn = await db.otherConnect();
  const results = await checks.runAll(conn);
  const digest = buildDigest(results);
  const html = await ejs.renderFile(VIEW, {
    digest,
    recipients: recipients(),
    preview: !!opts.preview,
    absoluteUrl,
  }, { debug: false });
  return { digest, html };
}

// ---------------------------------------------------------------------------
// GET /admin/audit — preview, superadmin only, never sends
// ---------------------------------------------------------------------------
//
// Serves the email itself rather than a page wrapping it, so what you check in the
// browser is byte-for-byte what lands in the inbox. It also doubles as the manual
// "is anything wrong right now" view for someone who will never run dbq.js.
exports.audit_preview = async function(req, res, next) {
  try {
    const { html } = await buildReport({ preview: true });
    res.type('html').send(html);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /admin/audit/run — the scheduled send
// ---------------------------------------------------------------------------

exports.audit_run = async function(req, res, next) {
  let report;
  try {
    report = await buildReport();
  } catch (err) {
    // Only reachable if the connection or the template itself is broken; a broken check
    // is a section in the digest, not an exception.
    return next(err);
  }

  const { digest, html } = report;
  const to = recipients();
  const summary = {
    subject: digest.subject,
    allClear: digest.allClear,
    findings: digest.findings.length,
    failedChecks: digest.failed.length,
    tracked: digest.noted.length,
    caller: req.auditCaller || 'unknown',
  };

  if (!to.length) {
    // Not an error: an unconfigured deploy is the safe state, and this is the message
    // that tells whoever is looking why no email arrived. Cloud Scheduler records the
    // response body, so it is visible without reading application logs.
    console.warn('[audit] AUDIT_EMAIL_TO is not set — digest built but not sent:', digest.subject);
    return res.json(Object.assign({}, summary, {
      sent: false,
      reason: 'AUDIT_EMAIL_TO is not set, so there is nobody to send the digest to.',
    }));
  }

  try {
    await ses.sendEmail({
      Destination: { ToAddresses: to },
      Message: {
        Body: { Html: { Charset: 'UTF-8', Data: html } },
        Subject: { Charset: 'UTF-8', Data: digest.subject },
      },
      Source: source(),
    });
  } catch (sendErr) {
    // A 500 here would have Cloud Scheduler retry, and a retry that succeeds after a
    // throttle sends the digest twice. Report the failure in the response instead.
    console.error('[audit] digest send failed:', sendErr.toString());
    return res.json(Object.assign({}, summary, {
      sent: false,
      reason: sendErr.message || String(sendErr),
    }));
  }

  return res.json(Object.assign({}, summary, { sent: true, to: to }));
};

exports.requireAuditCaller = requireAuditCaller;
// Exported because "where does the recipient come from" is the first question anybody
// will ask of this file.
exports.recipients = recipients;
