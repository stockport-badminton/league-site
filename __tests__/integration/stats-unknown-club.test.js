// A `club-` filter naming a club that did not exist in the season being viewed sends the
// stats pages to the same URL without it. Found Oct 2026 as /player-stats/club-Canute,
// bookmarked before Canute was renamed Remnants: an empty table (or, for a club admin,
// their own club's stats) under a chip still reading "Canute".
//
// An old or folded club's name is still a real filter on the seasons it was used in,
// which is why the lookup is asked about the season in the URL and not about the live
// club table.

const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/userInViews', () => () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  res.locals.user = req.user;
  next();
});
jest.mock('../../models/club');
jest.mock('../../models/players');

const Club = require('../../models/club');
const Player = require('../../models/players');
const app = require('../../app');

const adminOf = club => ({
  id: 'auth0|test', displayName: 'Test Admin', emails: [{ value: 'admin@example.invalid' }],
  _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': club },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = adminOf('Remnants');
  Player.newGetPlayerStats.mockResolvedValue([]);
  Player.newGetPairStats.mockResolvedValue([]);
});

describe.each(['/player-stats', '/pair-stats'])('%s with a club filter', page => {
  it('redirects to the bare page when the club does not exist this season', async () => {
    Club.existsInSeason.mockResolvedValue(false);
    const res = await request(app).get(`${page}/club-Canute`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(page);
    expect(Club.existsInSeason).toHaveBeenCalledWith('Canute', '');
  });

  it('keeps every other filter when it drops the club', async () => {
    Club.existsInSeason.mockResolvedValue(false);
    const res = await request(app).get(`${page}/Division-1/gender-Male/club-Canute`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${page}/Division-1/gender-Male`);
  });

  it('checks an archived season against that season, and renders when it played then', async () => {
    Club.existsInSeason.mockResolvedValue(true);
    const res = await request(app).get(`${page}/20242025/club-Canute`);
    expect(Club.existsInSeason).toHaveBeenCalledWith('Canute', '20242025');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Stats');
  });

  it('decides on the club in the URL, before an admin is scoped to their own', async () => {
    Club.existsInSeason.mockResolvedValue(false);
    await request(app).get(`${page}/club-Canute`);
    expect(Club.existsInSeason).toHaveBeenCalledWith('Canute', '');
    expect(Player.newGetPlayerStats).not.toHaveBeenCalled();
    expect(Player.newGetPairStats).not.toHaveBeenCalled();
  });

  it('renders the page as before if the lookup itself fails', async () => {
    Club.existsInSeason.mockRejectedValue(new Error('DB connection lost'));
    const res = await request(app).get(`${page}/club-Canute`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Stats');
  });

  it('does not look anything up without a club filter', async () => {
    const res = await request(app).get(page);
    expect(res.status).toBe(200);
    expect(Club.existsInSeason).not.toHaveBeenCalled();
  });
});
