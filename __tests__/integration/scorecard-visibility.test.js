// Who may open /scorecard/fixture/:id. Who played is a club's business: the route needs a
// sign-in, and then a superadmin or someone from either of the two clubs. It was public
// until Nov 2026, with only the links to it hidden, so any scorecard could be read by id.
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
jest.mock('axios');

const Fixture = require('../../models/fixture');
const app = require('../../app');

const userFor = (role, club) => ({ id: 'auth0|t', _json: { 'https://my-app.example.com/role': role, 'https://my-app.example.com/club': club } });
const GAME = { date: new Date(2026, 9, 21), homeTeam: 'Mellor A', awayTeam: 'Disley A', homePlayer1: 'Pat One', homePlayer2: 'Sam Two',
  awayPlayer1: 'Alex Three', awayPlayer2: 'Jo Four', homeScore: 21, awayScore: 15, totalHomeScore: 12, totalAwayScore: 6 };

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  Fixture.getFixtureSummaryById.mockResolvedValue([{ id: 7183, homeTeam: 'Mellor A', awayTeam: 'Disley A', homeClub: 'Mellor', awayClub: 'Disley' }]);
  Fixture.getScorecardDataById.mockResolvedValue([GAME]);
});

it('sends a signed-out visitor to log in, tells crawlers to stay out, and reads no players', async () => {
  const res = await request(app).get('/scorecard/fixture/7183');
  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/\/login/);
  expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(Fixture.getScorecardDataById).not.toHaveBeenCalled();
});

it.each([
  ['a superadmin', userFor('superadmin', 'All')],
  ['the home club', userFor('admin', 'Mellor')],
  ['the away club', userFor('admin', 'Disley')],
])('shows the scorecard to %s, privately', async (who, user) => {
  mockUser = user;
  const res = await request(app).get('/scorecard/fixture/7183');
  expect(res.status).toBe(200);
  expect(res.text).toContain('Pat One');
  expect(res.headers['cache-control']).toBe('private, no-store');
});

it.each([
  ['another club', userFor('admin', 'Tatton')],
  ['a signed-in user with no club', userFor(undefined, undefined)],
])('refuses %s, without reading who played', async (who, user) => {
  mockUser = user;
  const res = await request(app).get('/scorecard/fixture/7183');
  expect(res.status).toBe(403);
  expect(res.text).not.toContain('Pat One');
  expect(Fixture.getScorecardDataById).not.toHaveBeenCalled();
});
