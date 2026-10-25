// models/emailEvent.js and models/invoiceRun.js against a real Postgres (REARCH-01).
//
// Until these, neither model's SQL had been run by any test: the unit tests cover the
// pure halves (rowsFrom, findingsFor) and the integration tests mock the model.
// invoiceRun.findings's snapshot cannot fail either — the current season is exempt, so
// it answers [] whatever the query does.
const db = require('../../db_connect');
const EmailEvent = require('../../models/emailEvent');
const InvoiceRun = require('../../models/invoiceRun');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

describe('emailEvent.record', () => {
  const bounce = {
    eventType: 'Bounce',
    mail: { messageId: 'rearch01-msg', timestamp: '2026-10-20T10:00:00.000Z', commonHeaders: { subject: 'Fixtures' } },
    bounce: {
      bounceType: 'Permanent', bounceSubType: 'General', timestamp: '2026-10-20T10:00:05.000Z',
      bouncedRecipients: [
        { emailAddress: 'a@example.invalid', diagnosticCode: '550 5.1.1 no such user' },
        { emailAddress: 'b@example.invalid' },
      ],
    },
  };

  it('writes one row per recipient, and a redelivered notification writes nothing', async () => {
    expect(await EmailEvent.record(EmailEvent.rowsFrom(bounce))).toBe(2);
    expect(await EmailEvent.record(EmailEvent.rowsFrom(bounce))).toBe(0);

    const rows = await run(
      `SELECT email, event_type, bounce_type, bounce_subtype, diagnostic_code, subject,
              to_char(occurred_at, 'YYYY-MM-DD HH24:MI:SS') AS at
         FROM email_event WHERE message_id = 'rearch01-msg' ORDER BY email`);
    expect(rows).toEqual([
      { email: 'a@example.invalid', event_type: 'Bounce', bounce_type: 'Permanent', bounce_subtype: 'General',
        diagnostic_code: '550 5.1.1 no such user', subject: 'Fixtures', at: expect.stringMatching(/^2026-10-20 1\d:00:05$/) },
      { email: 'b@example.invalid', event_type: 'Bounce', bounce_type: 'Permanent', bounce_subtype: 'General',
        diagnostic_code: null, subject: 'Fixtures', at: expect.stringMatching(/^2026-10-20 1\d:00:05$/) },
    ]);
  });
});

describe('invoiceRun', () => {
  // A season the exemption list cannot cover, started an hour ago so findings picks it.
  const SEASON = '20982099';
  const AFTER_WINDOW = new Date('2098-09-10T12:00:00Z');
  beforeEach(() => run(`INSERT INTO season (id, name, "startDate", "endDate", label)
    VALUES (1001, ?, now() - interval '1 hour', now() + interval '1 year', 'test')`, [SEASON]));

  it('record stores outcomes as a JSON array, not a Postgres array, and returns the id', async () => {
    const id = await InvoiceRun.record({
      season: SEASON, status: 200,
      outcomes: [{ club: 'Zebra BC', sent: true }, { club: 'Yak BC', sent: false, detail: 'bounced' }],
    });
    expect(Number.isInteger(id)).toBe(true);
    expect(await run(`SELECT caller, forced, jsonb_typeof(outcomes) AS kind, outcomes FROM invoice_run WHERE id = ?`, [id]))
      .toEqual([{ caller: 'unknown', forced: false, kind: 'array',
        outcomes: [{ club: 'Zebra BC', sent: true }, { club: 'Yak BC', sent: false, detail: 'bounced' }] }]);
  });

  it('findings names the current season when no run was recorded, once the window has closed', async () => {
    expect(await InvoiceRun.findings(AFTER_WINDOW)).toEqual([
      expect.objectContaining({ season: SEASON, club: '(all clubs)', last_attempt: 'no run recorded at all' }),
    ]);
  });

  it('findings reads the recorded runs: only the club that was not sent is reported', async () => {
    await InvoiceRun.record({
      season: SEASON, status: 200, caller: 'scheduler',
      outcomes: [{ club: 'Zebra BC', sent: true }, { club: 'Yak BC', sent: false, detail: 'bounced' }],
    });
    expect(await InvoiceRun.findings(AFTER_WINDOW)).toEqual([
      expect.objectContaining({ season: SEASON, club: 'Yak BC', problem: 'bounced' }),
    ]);
  });
});
