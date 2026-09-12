// Run a step that happens AFTER the write has committed, and must not be able to undo it.
//
// Returns the step's value, or null if it threw. The caller carries on either way.
//
// The rule this encodes: once a captain's result or draft is in the database, the request
// has succeeded. Everything after that — the notification email, the social webhook, the
// extra data a confirmation page would like to show — is courtesy. Letting one of them
// reject sends the captain to the 500 page, which tells them nothing was recorded, which
// is false. That is how a momentary SES outage turns into a captain re-submitting a result
// that was already saved, and being told "no matching fixtures" for their trouble.
//
// It lives here rather than in a controller because it had exactly one caller — the
// publish path, from HARD-01 — while the paths captains actually use every week did not
// have it: filing a draft (`POST /email-scorecard`), filing a messer card, and approving
// or rejecting one all awaited their notification email after the write and passed the
// rejection to `next(err)`. HARD-28's submission test is what surfaced that: with the
// browser suite's dead SES credentials, filing a draft wrote the row and then 500'd.
//
// Swallowing is correct — the write is done and nothing can un-do it from here — so the
// failure goes to Sentry as a HANDLED event rather than vanishing. `stage` is what tells
// the two apart there.

const Sentry = require('@sentry/node');

/**
 * @param {string} label   what the step was, for the log line and the Sentry tag
 * @param {Function} fn    the step; may be async
 * @param {object} [opts]
 * @param {string} [opts.stage='post-commit']  Sentry `stage` tag, for triage
 * @returns {Promise<*>}   the step's value, or null if it threw
 */
async function afterCommit(label, fn, opts) {
  const stage = (opts && opts.stage) || 'post-commit';
  try {
    return await fn();
  } catch (err) {
    console.error(`${stage}: ${label} failed after the write was committed:`, err.message);
    Sentry.captureException(err, { tags: { stage, step: label } });
    return null;
  }
}

module.exports = { afterCommit };
