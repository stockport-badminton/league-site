// POST /mail — forwarding an inbound message to the league's distribution lists.
//
// The thing under test is who the forwarded message appears to be FROM.
//
// It is a forwarder, so the envelope and the From header have to stay ours: sending as
// someone@gmail.com out of our SES account fails SPF and DKIM alignment for their domain,
// and a sender on `p=reject` would have the forward binned rather than delivered. So the
// sender's identity has to survive somewhere else — the display name and Reply-To — which
// is what a mailing list's "via" means.
//
// Before this, `from` was the flat league address, `sender` was computed and never used,
// and `text` was a debug string. Every forwarded message therefore arrived looking as
// though the league had written it, Reply went back to the league, and the plain-text
// alternative read "Email from sengrid parse send to <list>".

const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');
jest.mock('../../utils/ses', () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
  sendRawEmail: jest.fn().mockResolvedValue({}),
}));

// Nothing may reach SES. nodemailer's SES transport is what this path sends through, so
// the transport itself is stood in for and the composed message captured.
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test', envelope: {} });
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

// The signature check is not what these tests are about — mail-relay.test.js covers
// rejecting a forgery. Here the message is treated as verified so the forwarding runs.
jest.mock('../../middleware/verifySns', () => {
  const mw = (req, res, next) => {
    req.snsMessage = JSON.parse(req.body.Message ? JSON.stringify(req.body) : '{}');
    next();
  };
  mw.isAmazonSubscribeUrl = () => true;
  return mw;
});

const Player = require('../../models/players');
const app = require('../../app');

// A minimal but real MIME message, as SES delivers it.
function rawEmail({ from, replyTo, subject, text, html }) {
  return [
    'From: ' + from,
    replyTo ? 'Reply-To: ' + replyTo : null,
    'To: clubsecretaries@stockport-badminton.co.uk',
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '--b1--',
    '',
    // Only the optional Reply-To line is dropped. NOT .filter(Boolean) — the empty
    // strings are the blank lines that end a header block, and removing them leaves a
    // message whose headers parse and whose body silently vanishes.
  ].filter(l => l !== null).join('\r\n');
}

function post(mime, recipients) {
  const notification = {
    content: Buffer.from(mime).toString('base64'),
    receipt: { recipients: recipients || ['division3@stockport-badminton.co.uk'] },
  };
  // JSON, not .type('form'): the notification is base64 and form encoding turns a
  // '+' into a space, so the message decodes to garbage from the first + onwards —
  // which parses far enough for the headers and then quietly loses the body.
  return request(app).post('/mail').type('json').send({
    Type: 'Notification',
    Message: JSON.stringify(notification),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendMail.mockResolvedValue({ messageId: 'test', envelope: {} });
  // No distribution-list expansion: this file is about the message, not the audience.
  Player.getEmails = jest.fn().mockResolvedValue([]);
});

const sent = () => {
  expect(mockSendMail).toHaveBeenCalled();
  return mockSendMail.mock.calls[0][0];
};

describe('POST /mail — the forwarded message', () => {
  const mime = () => rawEmail({
    from: '"Anne Secretary" <anne@someclub.org.uk>',
    subject: 'Re: player registration form',
    text: 'Here is our completed form.',
    html: '<p>Here is our completed form.</p>',
  });

  it('shows the original sender as the display name', async () => {
    await post(mime());
    expect(sent().from).toEqual({
      name: 'Anne Secretary',
      address: 'results@stockport-badminton.co.uk',
    });
  });

  // The From address must NOT become theirs: we cannot pass SPF or DKIM for someone
  // else's domain, and a sender on p=reject would have the forward rejected outright.
  it('keeps our own verified address in the From', async () => {
    await post(mime());
    expect(sent().from.address).toBe('results@stockport-badminton.co.uk');
  });

  it('points Reply-To at whoever wrote it', async () => {
    await post(mime());
    expect(sent().replyTo).toMatch(/anne@someclub\.org\.uk/);
  });

  it('honours a Reply-To the sender set themselves', async () => {
    await post(rawEmail({
      from: '"Anne Secretary" <anne@someclub.org.uk>',
      replyTo: 'committee@someclub.org.uk',
      subject: 's', text: 't', html: '<p>t</p>',
    }));
    expect(sent().replyTo).toMatch(/committee@someclub\.org\.uk/);
    expect(sent().replyTo).not.toMatch(/anne@/);
  });

  // The address is worth more than nothing when there is no display name.
  it('falls back to the address when the sender has no name', async () => {
    await post(rawEmail({
      from: 'anne@someclub.org.uk', subject: 's', text: 't', html: '<p>t</p>',
    }));
    expect(sent().from.name).toBe('anne@someclub.org.uk');
  });

  // This was "Email from sengrid parse send to <list>" for every forwarded message, so
  // the text alternative — what a text-only client and most spam scorers read — was that
  // sentence and nothing else.
  it('forwards the real plain-text body', async () => {
    await post(mime());
    expect(sent().text).toMatch(/Here is our completed form/);
    expect(sent().text).not.toMatch(/sengrid|parse send to/i);
  });

  it('keeps the original address in a header for the record', async () => {
    await post(mime());
    expect(sent().headers['X-Original-From']).toBe('anne@someclub.org.uk');
  });

  it('passes the subject and html through unchanged', async () => {
    await post(mime());
    expect(sent().subject).toBe('Re: player registration form');
    expect(sent().html).toMatch(/completed form/);
  });
});

// ── The unsubscribe header ───────────────────────────────────────────────────
describe('List-Unsubscribe', () => {
  const mime = () => rawEmail({
    from: '"Anne Secretary" <anne@someclub.org.uk>',
    subject: 's', text: 't', html: '<p>t</p>',
  });

  it('offers a mailto unsubscribe naming the list', async () => {
    await post(mime());
    const h = sent().headers;
    expect(h['List-Unsubscribe']).toMatch(/^<mailto:results@stockport-badminton\.co\.uk\?subject=/);
    expect(decodeURIComponent(h['List-Unsubscribe'])).toMatch(/unsubscribe division3/);
  });

  // Deliberately NOT one-click. These lists are computed from role flags at send time, so
  // nobody subscribed, and a one-click POST would silently drop a club officer out of
  // league business. It would also need a per-recipient token, which the one-blast-with-
  // everyone-in-Bcc shape cannot carry.
  it('does not claim one-click support', async () => {
    await post(mime());
    expect(sent().headers['List-Unsubscribe-Post']).toBeUndefined();
  });

  it('identifies the list it came from', async () => {
    await post(mime());
    expect(sent().headers['List-Id']).toMatch(/division3/);
  });
});

// ── Spreading the send ───────────────────────────────────────────────────────
//
// 27 Aug 2026: a list mail to 30 recipients had all eleven of its gmail.com addresses
// rejected with 421-4.7.28 (unusual rate from the sending domain), retried for 840
// minutes and expired. The complaint is about rate, and only spreading over time answers
// it — the same eleven messages reach Gmail either way, because SES expands Bcc into one
// delivery each.
describe('spreading a list send over time', () => {
  const many = n => Array.from({ length: n }, (_, i) => 'member' + i + '@example.com');

  beforeEach(() => {
    // division3@ — the list from the 27 Aug bounce. Note the matching is case-sensitive
    // and by substring (roles are spelled clubSecretaries, divisions division3), so a
    // lowercase clubsecretaries@ matches nothing and falls through to the default branch.
    Player.getEmails = jest.fn().mockResolvedValue(many(30));
  });

  const listMime = () => rawEmail({
    from: '"Anne Secretary" <anne@someclub.org.uk>',
    subject: 'Parrs Wood C withdrawal', text: 't', html: '<p>t</p>',
  });

  it('splits a large list across several sends rather than one blast', async () => {
    await post(listMime(), ['division3@stockport-badminton.co.uk']);
    expect(mockSendMail.mock.calls.length).toBeGreaterThan(1);
  });

  it('sends to every recipient exactly once across the chunks', async () => {
    await post(listMime(), ['division3@stockport-badminton.co.uk']);
    const delivered = mockSendMail.mock.calls.flatMap(c => c[0].bcc);
    const members = delivered.filter(a => /^member\d+@/.test(a));
    expect(members).toHaveLength(30);
    expect(new Set(members).size).toBe(30);
  });

  // SNS gives an HTTP endpoint about 15 seconds before it calls the delivery failed and
  // retries — and a retry would send the whole list again. A long list must therefore get
  // bigger chunks, not a longer wall clock.
  it('stays inside the SNS response budget however long the list is', async () => {
    Player.getEmails = jest.fn().mockResolvedValue(many(400));
    const started = Date.now();
    await post(listMime(), ['division3@stockport-badminton.co.uk']);
    expect(Date.now() - started).toBeLessThan(13000);
    const delivered = mockSendMail.mock.calls
      .flatMap(c => c[0].bcc).filter(a => /^member\d+@/.test(a));
    expect(new Set(delivered).size).toBe(400);
  }, 20000);

  it('does not split a single-recipient send', async () => {
    Player.getEmails = jest.fn().mockResolvedValue([]);
    await post(listMime(), ['division3@stockport-badminton.co.uk']);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
