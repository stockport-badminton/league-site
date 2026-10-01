// /missed-three and its notice: preview the email, then send it through SES. All of
// it is superadmin-only, and the send derives everything server-side.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

const ses = require('../../utils/ses');
const mailer = require('../../utils/mailer');
const Player = require('../../models/players');
const Club = require('../../models/club');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Neil Cooper', _json: { 'https://my-app.example.com/role': 'superadmin' } };
const MEMBER = { id: 'b', displayName: 'A Member', _json: { 'https://my-app.example.com/role': 'captain' } };

const ROWS = [
  { club: 43, team_name: 'Alderley Park A', next_team_name: 'Alderley Park B', playerID: 1, first_name: 'Olivia', family_name: 'Frankland', gender: 'Female' },
  { club: 59, team_name: 'Racketeers A', next_team_name: 'Racketeers B', playerID: 2, first_name: 'Zoe', family_name: 'Siu', gender: 'Female' },
];
const OFFICERS = [
  { clubId: 43, clubName: 'Alderley Park', playerId: 10, name: 'Club Sec', email: 'clubsec@example.com' },
  { clubId: 43, clubName: 'Alderley Park', playerId: 11, name: 'Match Sec', email: 'matchsec@example.com' },
];

beforeEach(() => {
  jest.restoreAllMocks();
  ses.sendEmail.mockClear();
  mockCurrentUser = SUPERADMIN;
  jest.spyOn(Player, 'getMissedThreePlayers').mockResolvedValue(ROWS.map(r => ({ ...r })));
  jest.spyOn(Club, 'getOfficerEmails').mockImplementation(async ids =>
    OFFICERS.filter(o => ids.map(Number).includes(o.clubId)));
});

describe('the list', () => {
  it('links each player to a preview, and says when a club has nobody to write to', async () => {
    const res = await request(app).get('/missed-three');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/missed-three/1/notice"');
    expect(res.text).not.toContain('href="/missed-three/2/notice"');
    expect(res.text).toContain('No secretary email on file');
    // Addresses are for the preview, where they are about to be used.
    expect(res.text).not.toContain('clubsec@example.com');
  });
});

describe('the preview', () => {
  it('shows who it goes to, and frames the rendered email', async () => {
    const res = await request(app).get('/missed-three/1/notice');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Club Sec &lt;clubsec@example.com&gt;');
    expect(res.text).toContain('Match Sec &lt;matchsec@example.com&gt;');
    expect(res.text).toContain(mailer.RESULTS_MAILBOX);
    expect(res.text).toContain('src="/missed-three/1/notice/email"');
    expect(res.text).toContain('action="/missed-three/1/notice"');
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('renders the email itself, and sends nothing', async () => {
    const res = await request(app).get('/missed-three/1/notice/email');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alderley Park B team needs to be nominated in');
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('offers no Send button when the club has nobody on file', async () => {
    const res = await request(app).get('/missed-three/2/notice');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nobody at this club has a contact email on file');
    expect(res.text).not.toContain('action="/missed-three/2/notice"');
  });

  it('is a 404 for a player no longer on the list', async () => {
    const res = await request(app).get('/missed-three/999/notice');
    expect(res.status).toBe(404);
  });
});

describe('the send', () => {
  it('sends through SES to the officers, with a filed copy, and says so', async () => {
    const res = await request(app).post('/missed-three/1/notice');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/missed-three?sent=' + encodeURIComponent('Olivia Frankland, Alderley Park A'));
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    const p = ses.sendEmail.mock.calls[0][0];
    expect(p.Destination.ToAddresses).toEqual(['clubsec@example.com', 'matchsec@example.com']);
    expect(p.Destination.BccAddresses).toEqual([mailer.RESULTS_MAILBOX]);
    expect(p.ReplyToAddresses).toEqual([mailer.RESULTS_MAILBOX]);
    expect(p.Message.Subject.Data).toBe('Olivia Frankland, Alderley Park A');
    expect(p.Message.Body.Text.Data).toContain('rule 19b');
    expect(p.Message.Body.Html.Data).toContain('Alderley Park B team needs to be nominated in');
  });

  // The recipients come from the club's officers, never from the request.
  it('ignores any address in the body', async () => {
    await request(app).post('/missed-three/1/notice').type('form')
      .send({ to: 'attacker@example.com', recipients: 'attacker@example.com' });
    const p = ses.sendEmail.mock.calls[0][0];
    expect(JSON.stringify(p.Destination)).not.toContain('attacker');
  });

  it('refuses a club with nobody on file, and a player no longer on the list', async () => {
    expect((await request(app).post('/missed-three/2/notice')).status).toBe(422);
    expect((await request(app).post('/missed-three/999/notice')).status).toBe(404);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });
});

describe('who may', () => {
  it.each([
    ['get', '/missed-three'],
    ['get', '/missed-three/1/notice'],
    ['get', '/missed-three/1/notice/email'],
    ['post', '/missed-three/1/notice'],
  ])('refuses anyone but a superadmin: %s %s', async (method, url) => {
    mockCurrentUser = MEMBER;
    const res = await request(app)[method](url);
    expect(res.status).toBe(403);
    expect(Player.getMissedThreePlayers).not.toHaveBeenCalled();
    expect(Club.getOfficerEmails).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });
});
