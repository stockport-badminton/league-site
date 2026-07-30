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
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(params.ReplyToAddresses).toEqual(['stockport.badders.results@gmail.com']);
    expect(JSON.stringify(params)).not.toContain('evil.example.com');
  });
});
