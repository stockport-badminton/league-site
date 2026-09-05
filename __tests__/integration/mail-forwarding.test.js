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
    receipt: { recipients: recipients || ['clubsecretaries@stockport-badminton.co.uk'] },
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
