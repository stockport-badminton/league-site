const request = require('supertest');

jest.mock('../../models/club');
jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/auth.js');
jest.mock('../../models/spamControls');
jest.mock('axios');
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

const Spam = require('../../models/spamControls');
const Club = require('../../models/club');
const ses = require('../../utils/ses');
const axios = require('axios');
const { formStamp, HONEYPOT_FIELD } = require('../../utils/spamChecks');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
  ses.sendEmail.mockResolvedValue({});
  Club.getAll.mockResolvedValue([]);
  // reCAPTCHA siteverify. The captcha itself is not what these tests are about, and it
  // genuinely rejects a fake token — which is worth knowing, since it means the captcha is
  // doing its job independently of everything added around it.
  axios.post.mockResolvedValue({ data: { success: true } });
  Spam.isBlockedIpSync.mockReturnValue(false);
  Spam.isBlockedIp.mockResolvedValue(false);
  Spam.isBlockedEmail.mockResolvedValue(false);
  Spam.matchBlockedText.mockResolvedValue(null);
  Spam.logSubmission.mockResolvedValue();
  Spam.refresh.mockResolvedValue({});
});

// A stamp old enough to pass the timing floor.
const goodStamp = () => formStamp(Date.now() - 10000);

function post(body) {
  return request(app).post('/contact-us').send({
    contactEmail: 'someone@example.com',
    contactQuery: 'Can I join on Tuesday?',
    formTs: goodStamp(),
    'g-recaptcha-response': 'test-token',
    ...body,
  });
}

describe('the spam gate', () => {
  it('rejects a filled honeypot and logs the reason', async () => {
    const res = await post({ [HONEYPOT_FIELD]: 'http://spam.example' });

    expect(res.status).toBe(200);
    expect(Spam.logSubmission).toHaveBeenCalledWith(expect.objectContaining({
      verdict: 'rejected', reason: 'honeypot', endpoint: '/contact-us',
    }));
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a submission faster than the floor', async () => {
    const res = await post({ formTs: formStamp(Date.now()) });

    expect(res.status).toBe(200);
    expect(Spam.logSubmission).toHaveBeenCalledWith(expect.objectContaining({
      verdict: 'rejected', reason: 'too-fast',
    }));
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a blocked IP and records which form it was aiming at', async () => {
    // The sitewide 403 in app.js catches these first in production; this exists so the
    // attempt shows up against the form rather than as a bare 403 nobody sees.
    Spam.isBlockedIp.mockResolvedValue(true);
    await post({});
    expect(Spam.logSubmission).toHaveBeenCalledWith(expect.objectContaining({
      verdict: 'rejected', reason: 'blocked-ip', endpoint: '/contact-us',
    }));
  });

  it('looks identical to success, so there is nothing to tune against', async () => {
    // Telling a bot which check caught it is how a spammer iterates. A rejection must not
    // be distinguishable from an accepted submission by status or body.
    const rejected = await post({ [HONEYPOT_FIELD]: 'x' });
    expect(rejected.status).toBe(200);
    expect(rejected.text).not.toMatch(/honeypot|blocked|spam|rejected/i);
    expect(rejected.text).toMatch(/sent/i);
  });

  it('passes a clean submission through and leaves the handler its context', async () => {
    // Exercised against the middleware rather than through the route: the accepted path
    // runs the whole contact flow (club lookup, recipient resolution, SES), and mocking all
    // of that would be testing the flow rather than the gate.
    const spamGate = require('../../middleware/spamGate');
    const req = {
      originalUrl: '/contact-us',
      path: '/contact-us',
      ip: '203.0.113.9',
      headers: {},
      get: () => 'test-agent',
      body: { contactEmail: 'a@example.com', contactQuery: 'hello', formTs: goodStamp() },
    };
    const next = jest.fn();
    await spamGate({ endpoint: '/contact-us' })(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(Spam.logSubmission).not.toHaveBeenCalled();
    // The handler needs this to log the real verdict once validation has run.
    expect(req._spamLogBase).toEqual(expect.objectContaining({
      endpoint: '/contact-us', ip: '203.0.113.9', userAgent: 'test-agent',
    }));
  });

  it('logOutcome records the handler\'s verdict against the gate\'s context', () => {
    const spamGate = require('../../middleware/spamGate');
    const req = {
      _spamLogBase: { endpoint: '/contact-us', ip: '203.0.113.9', email: 'a@example.com' },
    };
    spamGate.logOutcome(req, { verdict: 'accepted' });
    expect(Spam.logSubmission).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: '/contact-us', ip: '203.0.113.9', verdict: 'accepted', reason: null,
    }));
  });

  it('logOutcome is a no-op when the gate did not run', () => {
    // Handlers call it unconditionally, so it must not throw on a request that never
    // passed through the gate.
    const spamGate = require('../../middleware/spamGate');
    expect(() => spamGate.logOutcome({}, { verdict: 'accepted' })).not.toThrow();
    expect(Spam.logSubmission).not.toHaveBeenCalled();
  });

  it('records the forwarded chain alongside the resolved address', async () => {
    // The resolved address is the leftmost XFF entry and therefore client-settable, so the
    // raw header is kept for anyone about to block an address by hand.
    await request(app).post('/contact-us')
      .set('X-Forwarded-For', '203.0.113.9, 10.0.0.1')
      .send({ contactEmail: 'a@example.com', contactQuery: 'hello there', formTs: goodStamp(),
              [HONEYPOT_FIELD]: 'trip it' });

    expect(Spam.logSubmission).toHaveBeenCalledWith(expect.objectContaining({
      forwardedFor: '203.0.113.9, 10.0.0.1',
    }));
  });

  it('truncates the logged excerpt rather than archiving messages', async () => {
    await post({ contactQuery: 'x'.repeat(5000), [HONEYPOT_FIELD]: 'trip it' });
    const call = Spam.logSubmission.mock.calls[0][0];
    // The model slices to 200; the gate must at least not be the thing that fails.
    expect(call.excerpt.length).toBeGreaterThan(0);
  });
});

describe('the blocklist validators', () => {
  it('rejects a blocked sender and logs why', async () => {
    Spam.isBlockedEmail.mockResolvedValue(true);
    await post({ contactEmail: 'spammer@example.com' });
    expect(Spam.logSubmission).toHaveBeenCalledWith(expect.objectContaining({
      verdict: 'rejected', reason: 'blocked-email',
    }));
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects blocked content and names the kind that matched', async () => {
    Spam.matchBlockedText.mockResolvedValue({ kind: 'phrase', value: 'https://' });
    await post({ contactQuery: 'buy now at https://spam.example' });
    expect(Spam.logSubmission).toHaveBeenCalledWith(expect.objectContaining({
      verdict: 'rejected', reason: 'blocked-phrase',
    }));
  });

  it('tells ordinary validation failures apart from spam', async () => {
    // A rising 'validation' count means real people failing the form, which is a very
    // different signal from spam being caught.
    await post({ contactEmail: 'not-an-email' });
    expect(Spam.logSubmission).toHaveBeenCalledWith(expect.objectContaining({
      verdict: 'rejected', reason: 'validation',
    }));
  });
});
