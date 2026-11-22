// Who may see /fixture-players: every fixture's six players by name. It was public from
// 2018 to Nov 2026 (linked only from the admin hub, so it looked like an admin page). Now:
// signed in, a superadmin sees every club, anyone else their own club only, filtered in
// the query so another club's line-ups are never read.
const request = require('supertest');

let mockUser = null;
jest.mock('passport', () => {
  const actual = jest.requireActual('passport');
  actual.session = () => (req, res, next) => {
    if (mockUser) req.user = mockUser;
    req.isAuthenticated = () => !!mockUser;
    next();
  };
  return actual;
});
jest.mock('../../models/fixture');
jest.mock('../../models/season');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const app = require('../../app');

const userFor = (role, club) => ({ id: 'auth0|t', _json: { 'https://my-app.example.com/role': role, 'https://my-app.example.com/club': club } });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  Fixture.getMatchPlayerOrderDetails.mockResolvedValue([]);
});

it('sends a signed-out visitor to log in, and reads nothing', async () => {
  for (const path of ['/fixture-players', '/fixture-players/20252026', '/fixture-players/club-Tatton', '/fixture-players/team-Tatton%20A']) {
    const res = await request(app).get(path);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  }
  expect(Fixture.getMatchPlayerOrderDetails).not.toHaveBeenCalled();
});

it('shows a superadmin every club, or the one asked for', async () => {
  mockUser = userFor('superadmin', 'All');
  expect((await request(app).get('/fixture-players')).status).toBe(200);
  expect(Fixture.getMatchPlayerOrderDetails).toHaveBeenLastCalledWith({});
  await request(app).get('/fixture-players/club-Shell');
  expect(Fixture.getMatchPlayerOrderDetails).toHaveBeenLastCalledWith({ club: 'Shell' });
});

// The Messer admin checks who has played for which team, for Messer eligibility, across
// the league (Nov 2026); their account's own club is just where they play.
it('shows the Messer admin every club, or the one asked for', async () => {
  mockUser = { id: 'auth0|m', _json: { 'https://my-app.example.com/role': 'admin',
    'https://my-app.example.com/club': 'Macclesfield', 'https://my-app.example.com/messeradmin': true } };
  expect((await request(app).get('/fixture-players')).status).toBe(200);
  expect(Fixture.getMatchPlayerOrderDetails).toHaveBeenLastCalledWith({});
  expect((await request(app).get('/fixture-players/club-Featherforce')).status).toBe(200);
  expect(Fixture.getMatchPlayerOrderDetails).toHaveBeenLastCalledWith({ club: 'Featherforce' });
  expect((await request(app).get('/fixture-players/team-Featherforce%20A')).status).toBe(200);
  expect(Fixture.getMatchPlayerOrderDetails).toHaveBeenLastCalledWith({ team: 'Featherforce A' });
});

it('shows a club officer their own club only, whatever else the URL asks for', async () => {
  mockUser = userFor('admin', 'Tatton');
  const res = await request(app).get('/fixture-players/20252026');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(Fixture.getMatchPlayerOrderDetails).toHaveBeenLastCalledWith({ season: '20252026', club: 'Tatton' });
  await request(app).get('/fixture-players/team-Tatton%20A');
  expect(Fixture.getMatchPlayerOrderDetails).toHaveBeenLastCalledWith({ team: 'Tatton A', club: 'Tatton' });
});

it('refuses another club by URL, and a signed-in user with no club, without reading anything', async () => {
  mockUser = userFor('admin', 'Tatton');
  expect((await request(app).get('/fixture-players/club-Shell')).status).toBe(403);
  mockUser = userFor(undefined, undefined);
  expect((await request(app).get('/fixture-players')).status).toBe(403);
  expect(Fixture.getMatchPlayerOrderDetails).not.toHaveBeenCalled();
});
