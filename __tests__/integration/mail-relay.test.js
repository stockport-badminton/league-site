const request = require('supertest');

// One mutable user, as in fixture-rearrangement.test.js. Named `mock*` so jest's
// hoisted factory may close over it.
let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (!mockCurrentUser) {
    return res.redirect('/login?returnTo=' + encodeURIComponent(req.originalUrl));
  }
  req.user = mockCurrentUser;
  req.isAuthenticated = () => true;
  next();
});

const SUPERADMIN = {
  id: 'auth0|boss',
  _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' },
};
const CAPTAIN = {
  id: 'auth0|captain',
  _json: { 'https://my-app.example.com/role': 'captain', 'https://my-app.example.com/club': 'Mellor' },
};

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');

// SES is mocked hard. These tests exercise endpoints that send real email to real club
// captains, so nothing here may reach AWS.
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

const ses = require('../../utils/ses');
const Fixture = require('../../models/fixture');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  ses.sendEmail.mockResolvedValue({});
});

function sentParams() {
  expect(ses.sendEmail).toHaveBeenCalled();
  return ses.sendEmail.mock.calls[0][0];
}

// POST /fixture/reminder was reachable from the public /results page and once put
// req.body.email straight into SES ToAddresses — an open relay from our own verified
// domain. Since Oct 2026 the results secretary edits the recipients in the popup, which
// is only safe because the route is now superadmin-only. These tests hold both halves:
// nobody else can send, and the superadmin's list is still checked.
describe('POST /fixture/reminder', () => {
  const OK_BODY = { fixtureId: '7200', recipients: 'sec@example.com, captain@example.com' };

  beforeEach(() => {
    Fixture.getReminderContacts.mockResolvedValue({
      fixture: { id: 7200, homeTeam: 'Mellor A', awayTeam: 'Aerospace A' },
      contacts: [],
    });
  });

  it('refuses an anonymous caller and sends nothing', async () => {
    const res = await request(app).post('/fixture/reminder').send(OK_BODY);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login/);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a logged-in captain and sends nothing', async () => {
    mockCurrentUser = CAPTAIN;
    const res = await request(app).post('/fixture/reminder').send(OK_BODY);
    expect(res.status).toBe(403);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('sends to the addresses the superadmin typed', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).post('/fixture/reminder').send(OK_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sent: 2 });
    expect(Fixture.getReminderContacts).toHaveBeenCalledWith(7200);
    expect(sentParams().Destination.ToAddresses).toEqual(['sec@example.com', 'captain@example.com']);
  });

  it('refuses the whole send when any entry is not one address', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).post('/fixture/reminder')
      .send({ fixtureId: '7200', recipients: 'ok@example.com, "Evil" <x@evil.example.com>' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Not an email address/);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses an empty list rather than sending to nobody', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).post('/fixture/reminder').send({ fixtureId: '7200', recipients: ' , ' });
    expect(res.status).toBe(400);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('caps the recipient count', async () => {
    mockCurrentUser = SUPERADMIN;
    const many = Array.from({ length: 7 }, (_, i) => `p${i}@example.com`).join(',');
    const res = await request(app).post('/fixture/reminder').send({ fixtureId: '7200', recipients: many });
    expect(res.status).toBe(400);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('sends nothing for a fixture that does not exist', async () => {
    mockCurrentUser = SUPERADMIN;
    Fixture.getReminderContacts.mockResolvedValue(null);
    const res = await request(app).post('/fixture/reminder').send(OK_BODY);
    expect(res.status).toBe(404);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('does not let the request author the subject line', async () => {
    mockCurrentUser = SUPERADMIN;
    await request(app).post('/fixture/reminder')
      .send({ ...OK_BODY, homeTeam: 'Buy cheap pills', awayTeam: 'CLICK HERE', subject: 'CLICK HERE' });
    const subject = sentParams().Message.Subject.Data;
    expect(subject).toBe('Reminder: outstanding scorecard');
  });

  it('400s without a fixture to identify', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).post('/fixture/reminder').send({ recipients: 'a@example.com' });
    expect(res.status).toBe(400);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });
});

describe('GET /fixture/:id/reminder-contacts', () => {
  it('is not readable anonymously — it returns decrypted addresses', async () => {
    const res = await request(app).get('/fixture/7200/reminder-contacts');
    expect(res.status).toBe(302);
    expect(Fixture.getReminderContacts).not.toHaveBeenCalled();
  });

  it('is not readable by a captain', async () => {
    mockCurrentUser = CAPTAIN;
    const res = await request(app).get('/fixture/7200/reminder-contacts');
    expect(res.status).toBe(403);
    expect(Fixture.getReminderContacts).not.toHaveBeenCalled();
  });

  it('gives a superadmin the labelled contacts', async () => {
    mockCurrentUser = SUPERADMIN;
    const payload = {
      fixture: { id: 7200, homeTeam: 'Mellor A', awayTeam: 'Aerospace A' },
      contacts: [{ role: 'Club secretary', name: 'A Person', email: 'sec@example.com' }],
    };
    Fixture.getReminderContacts.mockResolvedValue(payload);
    const res = await request(app).get('/fixture/7200/reminder-contacts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });

  it('404s an unknown fixture', async () => {
    mockCurrentUser = SUPERADMIN;
    Fixture.getReminderContacts.mockResolvedValue(null);
    const res = await request(app).get('/fixture/999999/reminder-contacts');
    expect(res.status).toBe(404);
  });
});

// The endpoints that existed only to send mail and had no caller.
describe('deleted endpoints', () => {
  it('POST /SESemail is gone', async () => {
    const res = await request(app).post('/SESemail').send({});
    expect(res.status).toBe(404);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /mailtest is gone', async () => {
    const res = await request(app).post('/mailtest').send({});
    expect(res.status).toBe(404);
  });
});

describe('POST /mail', () => {
  it('rejects a forged SNS notification instead of forwarding it', async () => {
    // No valid signature, so verifySns answers 403 and distribution_list never runs.
    const res = await request(app)
      .post('/mail')
      .set('Content-Type', 'text/plain')
      .set('x-amz-sns-message-type', 'Notification')
      .send(JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify({ content: Buffer.from('spam').toString('base64') }),
      }));

    expect(res.status).toBe(403);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('no longer trusts the x-amz-sns-message-type header alone', async () => {
    const res = await request(app)
      .post('/mail')
      .set('Content-Type', 'text/plain')
      .set('x-amz-sns-message-type', 'SubscriptionConfirmation')
      .send(JSON.stringify({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://169.254.169.254/computeMetadata/v1/',
      }));

    expect(res.status).toBe(403);
  });
});

describe('POST /new-users-v2', () => {
  it('escapes the supplied label and does not honour a caller-set reply-to', async () => {
    await request(app).post('/new-users-v2').send({
      id: 'auth0|abc123',
      user: '<img src=x onerror=alert(1)>',
      contactEmail: 'attacker@evil.example.com',
    });

    const params = sentParams();
    const html = params.Message.Body.Html.Data;
    // Assert the property — the supplied label cannot become markup — rather than "there
    // is no <img in this email". Since this moved onto the MJML pipeline the email
    // legitimately contains one: the league logo in the header.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(params.ReplyToAddresses).toEqual(['stockport.badders.results@gmail.com']);
    expect(JSON.stringify(params)).not.toContain('evil.example.com');
  });

  // The reason this send was rewritten at all: it was the last one building its HTML by
  // concatenation, so it arrived unstyled, with no plain-text part and no footer saying
  // why you got it. All three are properties of the pipeline rather than of this route,
  // but this is the send that was missing them.
  it('sends a styled email with a plain-text alternative and a why-you-got-this line', async () => {
    await request(app).post('/new-users-v2').send({ id: 'auth0|abc123', user: 'Priya Ramanathan' });

    const params = sentParams();
    const html = params.Message.Body.Html.Data;
    const text = params.Message.Body.Text.Data;

    expect(html).toContain('#002060');                       // the league's own navy
    expect(html).toMatch(/why you|You are a league administrator/i);
    expect(text).toContain('Priya Ramanathan');
    expect(text).toContain('/approve-user/auth0%7Cabc123');  // encoded, or the link breaks
    expect(html).toContain('/approve-user/auth0%7Cabc123');
  });

  it('says nothing and answers 200 when there is no user id to approve', async () => {
    const res = await request(app).post('/new-users-v2').send({ id: 'undefined' });
    expect(res.status).toBe(200);
  });
});
