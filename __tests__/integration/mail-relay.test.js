const request = require('supertest');

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
  ses.sendEmail.mockResolvedValue({});
});

function sentParams() {
  expect(ses.sendEmail).toHaveBeenCalled();
  return ses.sendEmail.mock.calls[0][0];
}

// POST /fixture/reminder is reachable from the public /results page. It used to put
// req.body.email straight into SES ToAddresses and req.body.homeTeam/awayTeam into the
// Subject — an open relay sending from our own verified domain, which risks the domain
// reputation and the SES account rather than merely spamming us.
describe('POST /fixture/reminder', () => {
  it('sends to the captain resolved from the fixture, not to the address supplied', async () => {
    Fixture.getReminderRecipients.mockResolvedValue(['captain@example.com']);
    Fixture.getFixtureId.mockResolvedValue([{ id: 1 }]);

    const res = await request(app).post('/fixture/reminder').send({
      email: 'attacker-chosen@evil.example.com',
      homeTeam: 'Mellor A',
      awayTeam: 'Aerospace A',
    });

    expect(res.status).toBe(200);
    const params = sentParams();
    expect(params.Destination.ToAddresses).toEqual(['captain@example.com']);
    expect(JSON.stringify(params)).not.toContain('evil.example.com');
  });

  it('ignores a comma-separated list of recipients in the body', async () => {
    // The old code split on commas, so one request could reach many addresses.
    Fixture.getReminderRecipients.mockResolvedValue(['captain@example.com']);
    Fixture.getFixtureId.mockResolvedValue([{ id: 1 }]);

    await request(app).post('/fixture/reminder').send({
      email: 'a@evil.com,b@evil.com,c@evil.com',
      homeTeam: 'Mellor A', awayTeam: 'Aerospace A',
    });

    expect(sentParams().Destination.ToAddresses).toEqual(['captain@example.com']);
  });

  it('does not let the sender author the subject line', async () => {
    Fixture.getReminderRecipients.mockResolvedValue(['captain@example.com']);
    Fixture.getFixtureId.mockResolvedValue([{ id: 1 }]);

    await request(app).post('/fixture/reminder').send({
      homeTeam: 'Buy cheap pills at evil.example.com',
      awayTeam: 'CLICK HERE',
    });

    const subject = sentParams().Message.Subject.Data;
    expect(subject).toBe('Reminder: outstanding scorecard');
    expect(subject).not.toMatch(/pills|CLICK HERE/);
  });

  it('sends nothing at all for a fixture that does not exist', async () => {
    Fixture.getReminderRecipients.mockResolvedValue([]);
    Fixture.getFixtureId.mockResolvedValue([]);

    const res = await request(app).post('/fixture/reminder').send({
      homeTeam: 'Made Up A', awayTeam: 'Also Fake B',
    });

    expect(res.status).toBe(200);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to the league inbox when the fixture is real but nobody is on file', async () => {
    Fixture.getReminderRecipients.mockResolvedValue([]);
    Fixture.getFixtureId.mockResolvedValue([{ id: 42 }]);

    await request(app).post('/fixture/reminder').send({
      homeTeam: 'Manor B', awayTeam: 'Parrswood C',
    });

    expect(sentParams().Destination.ToAddresses).toEqual(['stockport.badders.results@gmail.com']);
  });

  it('caps the recipient count', async () => {
    Fixture.getReminderRecipients.mockResolvedValue([
      'a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com',
    ]);
    Fixture.getFixtureId.mockResolvedValue([{ id: 1 }]);

    await request(app).post('/fixture/reminder').send({ homeTeam: 'A', awayTeam: 'B' });
    expect(sentParams().Destination.ToAddresses).toHaveLength(3);
  });

  it('400s without a fixture to identify', async () => {
    const res = await request(app).post('/fixture/reminder').send({});
    expect(res.status).toBe(400);
    expect(ses.sendEmail).not.toHaveBeenCalled();
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
