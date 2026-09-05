// SES delivery events, as reported by the `baddersEmail` configuration set's SNS topic.
//
// See migrations/014_email_event.sql for why these are stored at all.

const db = require('../db_connect.js');

// One row per recipient per event. SNS delivers at least once, so the natural key
// (message_id, email, event_type) carries an ON CONFLICT DO NOTHING — a redelivered
// notification must not double-count a bounce in the weekly digest.
exports.record = async function(rows) {
  if (!rows || !rows.length) return 0;
  const conn = await db.otherConnect();
  let written = 0;
  for (const r of rows) {
    const [res] = await conn.query(
      `INSERT INTO email_event
         (event_type, email, occurred_at, bounce_type, bounce_subtype,
          diagnostic_code, subject, message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (message_id, email, event_type) DO NOTHING
       RETURNING id`,
      [r.eventType, r.email, r.occurredAt, r.bounceType || null, r.bounceSubType || null,
       r.diagnosticCode || null, r.subject || null, r.messageId || null]);
    if (res.length) written++;
  }
  return written;
};

// Turn one SNS message body into rows. Exported so it can be tested without a database,
// which matters because the shapes differ per event type and the only samples anyone has
// are the notifications that landed in an inbox.
exports.rowsFrom = function(event) {
  if (!event || !event.eventType) return [];
  const mail = event.mail || {};
  const common = {
    eventType: event.eventType,
    messageId: mail.messageId || null,
    subject: (mail.commonHeaders && mail.commonHeaders.subject) || null,
  };

  // A bounce names every recipient it failed for, and that list is the entire point:
  // "who did not get it" is the question, and the message-level view cannot answer it.
  if (event.eventType === 'Bounce' && event.bounce) {
    const b = event.bounce;
    return (b.bouncedRecipients || []).map(r => Object.assign({}, common, {
      email: r.emailAddress,
      occurredAt: b.timestamp || mail.timestamp,
      bounceType: b.bounceType,
      bounceSubType: b.bounceSubType,
      // The receiving server's own words. `421-4.7.28 ... unusual rate of mail` is what
      // told us what had actually happened; a status code alone would not have.
      diagnosticCode: r.diagnosticCode || null,
    }));
  }

  if (event.eventType === 'Complaint' && event.complaint) {
    const c = event.complaint;
    return (c.complainedRecipients || []).map(r => Object.assign({}, common, {
      email: r.emailAddress,
      occurredAt: c.timestamp || mail.timestamp,
      bounceSubType: c.complaintFeedbackType || null,
    }));
  }

  if (event.eventType === 'DeliveryDelay' && event.deliveryDelay) {
    const d = event.deliveryDelay;
    return (d.delayedRecipients || []).map(r => Object.assign({}, common, {
      email: r.emailAddress,
      occurredAt: d.timestamp || mail.timestamp,
      bounceSubType: d.delayType || null,
      diagnosticCode: r.diagnosticCode || null,
    }));
  }

  if (event.eventType === 'Reject' && event.reject) {
    return (mail.destination || [null]).map(email => Object.assign({}, common, {
      email,
      occurredAt: mail.timestamp,
      bounceSubType: event.reject.reason || null,
    }));
  }

  // Delivery, Send and the rest: one row per destination, so the digest can say how many
  // of a list actually arrived rather than only how many failed.
  return (mail.destination || []).map(email => Object.assign({}, common, {
    email,
    occurredAt: (event.delivery && event.delivery.timestamp) || mail.timestamp,
  }));
};
