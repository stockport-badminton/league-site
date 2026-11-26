// /club-officers: who gets in (a secretary of THIS club, by flag, with a verified address,
// or the superadmin), and what the forms send to the model. The model's own scoping is
// proved against Postgres in __tests__/db/club-officers.test.js.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/clubOfficers');
jest.mock('../../models/club');

const ClubOfficers = require('../../models/clubOfficers');
const Club = require('../../models/club');
const app = require('../../app');

const ROLE = 'https://my-app.example.com/role';
const user = (email, json = {}) => ({ id: email, displayName: email, emails: [{ value: email }], _json: { email, ...json } });
const SUPERADMIN = user('rs@example.invalid', { [ROLE]: 'superadmin', 'https://my-app.example.com/club': 'All' });
const SECRETARY = user('sec@example.invalid');
const CLUB_ADMIN = user('admin@example.invalid', { [ROLE]: 'admin', 'https://my-app.example.com/club': 'Aardvark BC' });

const CLUB = 9001;
const p = (id, name, extra = {}) => ({ id, name, clubId: CLUB, teamId: 1, teamClubId: CLUB, clubSecretary: false,
  matchSecretary: false, teamCaptain: false, email: null, tel: null, ...extra });
const DATA = {
  club: { id: CLUB, name: 'Aardvark BC' },
  teams: [{ id: 1, name: 'Aardvark A' }],
  players: [
    p(11, 'Sam Secretary', { clubSecretary: true, email: 'sec@example.invalid' }),
    p(12, 'Cath Captain', { teamCaptain: true, tel: '0161 111 1111' }),
    p(13, 'Mo Member'),
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SECRETARY;
  ClubOfficers.secretaryClubs.mockImplementation(async email =>
    email === 'sec@example.invalid' ? [{ playerId: 11, clubId: CLUB, clubName: 'Aardvark BC' }] : []);
  ClubOfficers.getClubOfficers.mockResolvedValue(DATA);
  ClubOfficers.setContact.mockResolvedValue(1);
  ClubOfficers.setSecretary.mockResolvedValue(1);
  ClubOfficers.setCaptain.mockResolvedValue(true);
  Club.getAll.mockResolvedValue([{ id: CLUB, name: 'Aardvark BC' }, { id: 9002, name: 'Zebra BC' }]);
});

describe('who gets in', () => {
  it('lets a secretary see their own club\'s page', async () => {
    const res = await request(app).get(`/club-officers/${CLUB}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Aardvark BC officers');
    expect(res.text).toMatch(/<strong>Sam Secretary<\/strong> <span class="badge badge-primary text-bg-primary">you<\/span>/);
    expect(res.text).toContain('value="0161 111 1111"');
    // The captain dropdown has the current captain selected.
    expect(res.text).toMatch(/<option value="12" selected>Cath Captain<\/option>/);
  });

  it('refuses a secretary on another club\'s page, and writes nothing', async () => {
    expect((await request(app).get('/club-officers/9002')).status).toBe(403);
    expect((await request(app).post('/club-officers/9002/secretary').type('form')
      .send({ role: 'clubSecretary', playerId: '13', action: 'add' })).status).toBe(403);
    expect(ClubOfficers.setSecretary).not.toHaveBeenCalled();
  });

  it('refuses a club admin who holds no secretary office', async () => {
    mockCurrentUser = CLUB_ADMIN;
    expect((await request(app).get(`/club-officers/${CLUB}`)).status).toBe(403);
  });

  it('refuses a login whose address is unverified, even if it matches', async () => {
    mockCurrentUser = user('sec@example.invalid', { email_verified: false });
    expect((await request(app).get(`/club-officers/${CLUB}`)).status).toBe(403);
    expect(ClubOfficers.secretaryClubs).not.toHaveBeenCalled();
  });

  it('lets the superadmin into any club', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get(`/club-officers/${CLUB}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('You are seeing this as the results secretary');
  });

  it('sends a secretary from /club-officers to their club, and explains the page to anyone else', async () => {
    expect((await request(app).get('/club-officers')).headers.location).toBe(`/club-officers/${CLUB}`);
    mockCurrentUser = user('someone@example.invalid');
    const res = await request(app).get('/club-officers');
    expect(res.status).toBe(200);
    expect(res.text).toContain("isn't the one on your player\n      record");
  });
});

describe('forms', () => {
  it('saves contact details, blank meaning none', async () => {
    const res = await request(app).post(`/club-officers/${CLUB}/contact`).type('form')
      .send({ playerId: '12', email: ' cath@example.invalid ', tel: '' });
    expect(res.headers.location).toBe(`/club-officers/${CLUB}?saved=contact#officer-12`);
    expect(ClubOfficers.setContact).toHaveBeenCalledWith(CLUB, 12, { email: 'cath@example.invalid', tel: null });
  });

  it('re-renders a bad email with what was typed, and saves nothing', async () => {
    const res = await request(app).post(`/club-officers/${CLUB}/contact`).type('form')
      .send({ playerId: '12', email: 'not-an-address', tel: '0161 222' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('&#34;not-an-address&#34; is not an email address.');
    expect(res.text).toContain('id="email-12" name="email" maxlength="254" value="not-an-address"');
    expect(res.text).toContain('id="tel-12" name="tel" maxlength="30" value="0161 222"');
    expect(ClubOfficers.setContact).not.toHaveBeenCalled();
  });

  it('says so when the player is not one of the club\'s officers', async () => {
    ClubOfficers.setContact.mockResolvedValue(0);
    expect((await request(app).post(`/club-officers/${CLUB}/contact`).type('form')
      .send({ playerId: '13', email: 'mo@example.invalid' })).status).toBe(400);
  });

  it('adds a match secretary by the real column name', async () => {
    await request(app).post(`/club-officers/${CLUB}/secretary`).type('form')
      .send({ role: 'matchSecretary', playerId: '13', action: 'add' });
    expect(ClubOfficers.setSecretary).toHaveBeenCalledWith(CLUB, 13, 'matchSecrertary', true);
  });

  it('refuses a role that is not a secretary office', async () => {
    expect((await request(app).post(`/club-officers/${CLUB}/secretary`).type('form')
      .send({ role: 'teamCaptain', playerId: '13', action: 'add' })).status).toBe(400);
    expect(ClubOfficers.setSecretary).not.toHaveBeenCalled();
  });

  it('sends a secretary who removed their own last office back to the index', async () => {
    ClubOfficers.secretaryClubs
      .mockResolvedValueOnce([{ playerId: 11, clubId: CLUB, clubName: 'Aardvark BC' }]) // the access check
      .mockResolvedValueOnce([]);                                                       // after the change
    const res = await request(app).post(`/club-officers/${CLUB}/secretary`).type('form')
      .send({ role: 'clubSecretary', playerId: '11', action: 'remove' });
    expect(ClubOfficers.setSecretary).toHaveBeenCalledWith(CLUB, 11, 'clubSecretary', false);
    expect(res.headers.location).toBe('/club-officers');
  });

  it('sets a captain, or none', async () => {
    await request(app).post(`/club-officers/${CLUB}/captain`).type('form').send({ teamId: '1', playerId: '13' });
    expect(ClubOfficers.setCaptain).toHaveBeenLastCalledWith(CLUB, 1, 13);
    await request(app).post(`/club-officers/${CLUB}/captain`).type('form').send({ teamId: '1', playerId: '' });
    expect(ClubOfficers.setCaptain).toHaveBeenLastCalledWith(CLUB, 1, null);
  });
});
