// GET /missed-three — the email button, and who gets to see it. Each button carries
// the club officers' addresses, so the page is superadmin-only.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});

const Player = require('../../models/players');
const Club = require('../../models/club');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Neil Cooper', _json: { 'https://my-app.example.com/role': 'superadmin' } };
const MEMBER = { id: 'b', displayName: 'A Member', _json: { 'https://my-app.example.com/role': 'captain' } };

const ROWS = [
  { club: 43, team_name: 'Alderley Park A', next_team_name: 'Alderley Park B', playerID: 1, first_name: 'Olivia', family_name: 'Frankland', gender: 'Female' },
  { club: 59, team_name: 'Racketeers A', next_team_name: 'Racketeers B', playerID: 2, first_name: 'Zoe', family_name: 'Siu', gender: 'Female' },
];

beforeEach(() => {
  jest.restoreAllMocks();
  mockCurrentUser = SUPERADMIN;
  jest.spyOn(Player, 'getMissedThreePlayers').mockResolvedValue(ROWS.map(r => ({ ...r })));
  jest.spyOn(Club, 'getOfficerEmails').mockResolvedValue([
    { clubId: 43, playerId: 10, name: 'Club Sec', email: 'clubsec@example.com' },
    { clubId: 43, playerId: 11, name: 'Match Sec', email: 'matchsec@example.com' },
  ]);
});

it('gives a superadmin a button addressed to that club\'s officers only', async () => {
  const res = await request(app).get('/missed-three');
  expect(res.status).toBe(200);
  expect(Club.getOfficerEmails).toHaveBeenCalledWith([43, 59]);
  expect(res.text).toContain('href="mailto:clubsec%40example.com,matchsec%40example.com?subject=Olivia%20Frankland%2C%20Alderley%20Park%20A');
  // Racketeers has nobody on file, which must say so rather than open an empty To.
  expect(res.text).toContain('No secretary email on file');
  expect(res.text.match(/href="mailto:/g)).toHaveLength(1);
});

it('refuses anyone but a superadmin, before any address is looked up', async () => {
  mockCurrentUser = MEMBER;
  const res = await request(app).get('/missed-three');
  expect(res.status).toBe(403);
  expect(res.text).not.toContain('Olivia');
  expect(Player.getMissedThreePlayers).not.toHaveBeenCalled();
  expect(Club.getOfficerEmails).not.toHaveBeenCalled();
});
