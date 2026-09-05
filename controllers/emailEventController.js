// POST /ses-events — SES delivery notifications from the `baddersEmail` configuration
// set's SNS topic.
//
// Stored so the weekly digest can report them; see migrations/014_email_event.sql for
// why. Nothing here answers a user, and nothing here sends mail.
//
// `verifySns` runs as route middleware, exactly as it does for /mail: without it this is
// an endpoint anyone can POST invented bounces to, and those bounces would then appear in
// the results secretary's weekly email as fact.

const https = require('https');
const Sentry = require('@sentry/node');
const verifySns = require('../middleware/verifySns');
const EmailEvent = require('../models/emailEvent');

exports.ses_events = async function(req, res, next) {
  const msg = req.snsMessage || {};

  // Subscribing the endpoint. The URL is fetched by our own server, so it is checked
  // against the SNS host pattern rather than followed on trust — otherwise a
  // confirmation message is an SSRF primitive pointed at anything reachable from inside
  // GCP. Same reasoning, and the same helper, as /mail.
  if (msg.Type === 'SubscriptionConfirmation') {
    if (!verifySns.isAmazonSubscribeUrl(msg.SubscribeURL)) {
      console.warn('ses-events: refusing non-SNS SubscribeURL:', msg.SubscribeURL);
      return res.status(400).send('bad SubscribeURL');
    }
    https.get(msg.SubscribeURL, r => {
      console.log('ses-events: subscription confirmation returned', r.statusCode);
      r.resume();
    }).on('error', e => console.error('ses-events: confirm failed:', e.message));
    return res.sendStatus(200);
  }

  if (msg.Type !== 'Notification') return res.sendStatus(200);

  try {
    const event = JSON.parse(msg.Message);
    const rows = EmailEvent.rowsFrom(event);
    const written = await EmailEvent.record(rows);
    console.log(`ses-events: ${event.eventType} for ${rows.length} recipient(s), ` +
                `${written} new`);
    // 200 regardless of whether anything was new: a duplicate is not an error, and SNS
    // retries anything that is not a 2xx — which would spin on a message we have already
    // stored.
    res.sendStatus(200);
  } catch (err) {
    // Do NOT 500. SNS would retry a malformed message forever. Log it and accept it.
    console.error('ses-events: could not handle notification:', err.message);
    Sentry.captureException(err);
    res.sendStatus(200);
  }
};