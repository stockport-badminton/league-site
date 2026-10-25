// @ts-check
// SES delivery events, as reported by the `baddersEmail` configuration set's SNS topic.
//
// See migrations/014_email_event.sql for why these are stored at all.

const { kysely } = require('../db');

// One row per recipient per event. SNS delivers at least once, so the natural key
// (message_id, email, event_type) carries an ON CONFLICT DO NOTHING — a redelivered
// notification must not double-count a bounce in the weekly digest.
/**
 * @typedef {{ eventType: string, email: string | null, occurredAt: string,
 *   bounceType?: string, bounceSubType?: string | null, diagnosticCode?: string | null,
 *   subject?: string | null, messageId?: string | null }} EventRow
 * @param {EventRow[]} rows
 */
exports.record = async function(rows) {
  if (!rows || !rows.length) return 0;
  let written = 0;
  for (const r of rows) {
    const inserted = await kysely.insertInto('email_event')
      .values({
        event_type: r.eventType, email: r.email, occurred_at: r.occurredAt,
        bounce_type: r.bounceType || null, bounce_subtype: r.bounceSubType || null,
        diagnostic_code: r.diagnosticCode || null, subject: r.subject || null,
        message_id: r.messageId || null,
      })
      .onConflict(oc => oc.columns(['message_id', 'email', 'event_type']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) written++;
  }
  return written;
};

// Turn one SNS message body into rows. Exported so it can be tested without a database,
// which matters because the shapes differ per event type and the only samples anyone has
// are the notifications that landed in an inbox.
/** @param {any} event @returns {EventRow[]} */
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
    return (b.bouncedRecipients || []).map((/** @type {any} */ r) => Object.assign({}, common, {
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
    return (c.complainedRecipients || []).map((/** @type {any} */ r) => Object.assign({}, common, {
      email: r.emailAddress,
      occurredAt: c.timestamp || mail.timestamp,
      bounceSubType: c.complaintFeedbackType || null,
    }));
  }

  if (event.eventType === 'DeliveryDelay' && event.deliveryDelay) {
    const d = event.deliveryDelay;
    return (d.delayedRecipients || []).map((/** @type {any} */ r) => Object.assign({}, common, {
      email: r.emailAddress,
      occurredAt: d.timestamp || mail.timestamp,
      bounceSubType: d.delayType || null,
      diagnosticCode: r.diagnosticCode || null,
    }));
  }

  if (event.eventType === 'Reject' && event.reject) {
    return (mail.destination || [null]).map((/** @type {string | null} */ email) => Object.assign({}, common, {
      email,
      occurredAt: mail.timestamp,
      bounceSubType: event.reject.reason || null,
    }));
  }

  // Delivery, Send and the rest: one row per destination, so the digest can say how many
  // of a list actually arrived rather than only how many failed.
  return (mail.destination || []).map((/** @type {string} */ email) => Object.assign({}, common, {
    email,
    occurredAt: (event.delivery && event.delivery.timestamp) || mail.timestamp,
  }));
};
