// Turning an SES notification into rows.
//
// The samples here are the real 27 Aug 2026 notification, trimmed. That matters: the
// shapes differ per event type, the AWS docs describe several of them loosely, and the
// only samples anyone actually has are the ones that landed in an inbox.

const EmailEvent = require('../../models/emailEvent');

// The bounce that cost eleven people a fixture withdrawal notice.
const REAL_BOUNCE = {
  eventType: 'Bounce',
  bounce: {
    feedbackId: '010201a048343ce2-591a6440',
    bounceType: 'Transient',
    bounceSubType: 'General',
    timestamp: '2026-08-28T11:49:38.101Z',
    bouncedRecipients: [
      { emailAddress: 'julian.cherryman@gmail.com', action: 'failed', status: '4.4.7',
        diagnosticCode: 'smtp; 554 4.4.7 Message expired: unable to deliver in 840 minutes.<421-4.7.28 Gmail has detected an unusual rate of mail originating from your SPF domain>' },
      { emailAddress: 'annenorbury@gmail.com', action: 'failed', status: '4.4.7',
        diagnosticCode: 'smtp; 554 4.4.7 Message expired: unable to deliver in 840 minutes.' },
    ],
  },
  mail: {
    timestamp: '2026-08-27T21:49:37.311Z',
    messageId: '010201a045332e9f-2c039867',
    destination: ['julian.cherryman@gmail.com', 'annenorbury@gmail.com', 'ok@example.com'],
    commonHeaders: { subject: 'Parrs Wood C withdrawal' },
  },
};

describe('rowsFrom', () => {
  // One row per failed recipient, not one per message. "Who did not get it" is the only
  // question worth asking, and a message-level row cannot answer it.
  it('produces a row per bounced recipient, not per message', () => {
    const rows = EmailEvent.rowsFrom(REAL_BOUNCE);
    expect(rows.map(r => r.email)).toEqual([
      'julian.cherryman@gmail.com', 'annenorbury@gmail.com',
    ]);
    // The third destination did not bounce and must not be recorded as though it did.
    expect(rows.map(r => r.email)).not.toContain('ok@example.com');
  });

  // Transient is the whole reason this table exists: GetSendStatistics does not count it,
  // so it is invisible everywhere else.
  it('keeps the bounce type, which is what made this one invisible', () => {
    const [first] = EmailEvent.rowsFrom(REAL_BOUNCE);
    expect(first.bounceType).toBe('Transient');
    expect(first.bounceSubType).toBe('General');
  });

  it('keeps the receiving server reason, which is where the cause is', () => {
    const [first] = EmailEvent.rowsFrom(REAL_BOUNCE);
    expect(first.diagnosticCode).toMatch(/421-4\.7\.28/);
    expect(first.diagnosticCode).toMatch(/unusual rate of mail/);
  });

  it('carries the subject and message id so a row can be traced back', () => {
    const [first] = EmailEvent.rowsFrom(REAL_BOUNCE);
    expect(first.subject).toBe('Parrs Wood C withdrawal');
    expect(first.messageId).toBe('010201a045332e9f-2c039867');
    // The bounce's own timestamp, not the send's — 14 hours apart in this very sample.
    expect(first.occurredAt).toBe('2026-08-28T11:49:38.101Z');
  });

  it('handles a complaint', () => {
    const rows = EmailEvent.rowsFrom({
      eventType: 'Complaint',
      complaint: {
        timestamp: '2026-09-01T10:00:00.000Z',
        complainedRecipients: [{ emailAddress: 'cross@example.com' }],
        complaintFeedbackType: 'abuse',
      },
      mail: { messageId: 'm1', commonHeaders: { subject: 'Weekly fixtures' } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('cross@example.com');
    expect(rows[0].bounceSubType).toBe('abuse');
  });

  // A delay is the shape the 27 Aug incident had for fourteen hours before it became a
  // failure. Catching it there means the mail can still be made to arrive.
  it('handles a delivery delay', () => {
    const rows = EmailEvent.rowsFrom({
      eventType: 'DeliveryDelay',
      deliveryDelay: {
        timestamp: '2026-09-01T10:00:00.000Z',
        delayType: 'TransientCommunicationFailure',
        delayedRecipients: [{ emailAddress: 'slow@example.com', diagnosticCode: '421 try later' }],
      },
      mail: { messageId: 'm2' },
    });
    expect(rows[0].email).toBe('slow@example.com');
    expect(rows[0].bounceSubType).toBe('TransientCommunicationFailure');
  });

  it('records a delivery per destination, so a list can be reconciled', () => {
    const rows = EmailEvent.rowsFrom({
      eventType: 'Delivery',
      delivery: { timestamp: '2026-09-01T10:00:00.000Z' },
      mail: { messageId: 'm3', destination: ['a@example.com', 'b@example.com'] },
    });
    expect(rows.map(r => r.email)).toEqual(['a@example.com', 'b@example.com']);
    expect(rows.every(r => r.eventType === 'Delivery')).toBe(true);
  });

  it('never throws on a shape it does not know', () => {
    for (const input of [null, {}, { eventType: 'Open' }, { eventType: 'Bounce' }]) {
      expect(() => EmailEvent.rowsFrom(input)).not.toThrow();
      expect(Array.isArray(EmailEvent.rowsFrom(input))).toBe(true);
    }
  });
});
