// POST /ses-events — the endpoint that records what SES says happened to our mail.
//
// It exists because the 27 Aug 2026 Gmail rate-limit went unnoticed for eight days: the
// only record was one SNS notification in an inbox, and both places anyone would have
// looked said all was well.
//
// The security shape matters as much as the parsing. Anyone who can POST invented bounces
// here can put false statements into the results secretary's weekly email, so verifySns
// gates it exactly as it gates /mail.

const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');
jest.mock('../../models/emailEvent', () => {
  const actual = jest.requireActual('../../models/emailEvent');
  return { rowsFrom: actual.rowsFrom, record: jest.fn().mockResolvedValue(0) };
});

// The confirmation path fetches the SubscribeURL with https.get. Stubbed so the test does
// not make a real outbound request to AWS — and so nothing logs after the run finishes.
const mockConfirmGets = [];
// Only `get` is replaced — the real module has to stay otherwise, because Sentry's
// instrumentation reaches for https.Agent at import time and a wholesale mock breaks the
// whole suite before a single test runs.
jest.mock('https', () => Object.assign({}, jest.requireActual('https'), {
  get: (url, cb) => {
    mockConfirmGets.push(url);
    if (cb) cb({ statusCode: 200, resume() {} });
    return { on: () => ({}) };
  },
}));

// Verified by default; one describe turns it off to prove the gate.
let mockVerified = true;
jest.mock('../../middleware/verifySns', () => {
  const mw = (req, res, next) => {
    if (!mockVerified) return res.status(403).send('bad signature');
    req.snsMessage = req.body;
    next();
  };
  mw.isAmazonSubscribeUrl = url => /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(url || '');
  return mw;
});

const EmailEvent = require('../../models/emailEvent');
const app = require('../../app');

const BOUNCE = {
  eventType: 'Bounce',
  bounce: {
    bounceType: 'Transient', bounceSubType: 'General',
    timestamp: '2026-08-28T11:49:38.101Z',
    bouncedRecipients: [
      { emailAddress: 'julian.cherryman@gmail.com', diagnosticCode: 'smtp; 554 4.4.7 ...421-4.7.28 unusual rate...' },
      { emailAddress: 'annenorbury@gmail.com', diagnosticCode: 'smtp; 554 4.4.7 ...' },
    ],
  },
  mail: { messageId: 'm1', timestamp: '2026-08-27T21:49:37.311Z',
          commonHeaders: { subject: 'Parrs Wood C withdrawal' } },
};

const post = body => request(app).post('/ses-events').type('json').send(body);

beforeEach(() => {
  jest.clearAllMocks();
  mockVerified = true;
  EmailEvent.record.mockResolvedValue(2);
});

describe('recording an event', () => {
  it('stores a row per bounced recipient', async () => {
    const res = await post({ Type: 'Notification', Message: JSON.stringify(BOUNCE) });
    expect(res.status).toBe(200);
    expect(EmailEvent.record).toHaveBeenCalledTimes(1);
    const rows = EmailEvent.record.mock.calls[0][0];
    expect(rows.map(r => r.email)).toEqual([
      'julian.cherryman@gmail.com', 'annenorbury@gmail.com']);
    expect(rows[0].bounceType).toBe('Transient');
  });

  // SNS retries anything that is not a 2xx, so a message we cannot handle must be
  // ACCEPTED and logged rather than rejected — otherwise one malformed notification is
  // retried forever.
  it('accepts rubbish rather than making SNS retry it for ever', async () => {
    const res = await post({ Type: 'Notification', Message: 'not json at all' });
    expect(res.status).toBe(200);
    expect(EmailEvent.record).not.toHaveBeenCalled();
  });

  it('ignores an event type it has no rows for', async () => {
    const res = await post({ Type: 'Notification', Message: JSON.stringify({ eventType: 'Open' }) });
    expect(res.status).toBe(200);
    expect(EmailEvent.record).toHaveBeenCalledWith([]);
  });
});

describe('subscribing', () => {
  it('confirms a subscription from a real SNS URL', async () => {
    const res = await post({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=x',
    });
    expect(res.status).toBe(200);
    expect(mockConfirmGets).toHaveLength(1);
  });

  // The URL is fetched by our own server, so following one on trust makes a confirmation
  // message an SSRF primitive pointed at anything reachable from inside GCP.
  it('refuses a SubscribeURL that is not SNS', async () => {
    mockConfirmGets.length = 0;
    const res = await post({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'http://169.254.169.254/computeMetadata/v1/',
    });
    expect(res.status).toBe(400);
    // And it must not have been fetched at all.
    expect(mockConfirmGets).toHaveLength(0);
  });
});

describe('the signature gate', () => {
  // Without it, anyone who can POST can put invented bounces into the weekly email.
  it('refuses an unverified notification', async () => {
    mockVerified = false;
    const res = await post({ Type: 'Notification', Message: JSON.stringify(BOUNCE) });
    expect(res.status).toBe(403);
    expect(EmailEvent.record).not.toHaveBeenCalled();
  });
});
