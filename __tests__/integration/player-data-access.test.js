// Who may read player data by id (Nov 2026 access review). Before this, anyone could take
// every fixture's twelve player ids from /fixtures/*, name them through /api/player-elo,
// list any team's players from /eligiblePlayers, and filter the whole player list through
// /api/players/search: every line-up in the league, rebuilt without a sign-in.
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
jest.mock('../../models/players');
jest.mock('../../models/season');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const Player = require('../../models/players');
const app = require('../../app');

const member = { id: 'auth0|t', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Tatton' } };
const TOKEN = 'a'.repeat(43);

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  Player.findElgiblePlayersFromTeamId.mockResolvedValue([{ id: 1, first_name: 'Pat', family_name: 'One' }]);
  Player.getPlayerEloTimeSeries.mockResolvedValue([]);
});

describe('/fixtures/* JSON', () => {
  it('lists the fixtures without who played in them', async () => {
    Fixture.getFixtureDetails.mockResolvedValue([{ id: 7313, date: new Date(2026, 8, 3), homeTeam: 'Mellor A', awayTeam: 'Aerospace A',
      homeScore: 8, awayScore: 10, homeMan1: 68, homeLady3: 420, awayMan1: 848, awayLady3: 620 }]);
    const res = await request(app).get('/fixtures/club-Mellor');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 7313, homeTeam: 'Mellor A', homeScore: 8 });
    for (const k of ['homeMan1', 'homeLady3', 'awayMan1', 'awayLady3']) expect(res.body[0]).not.toHaveProperty(k);
  });
});

describe('/api/player-elo and /api/players/search', () => {
  it.each(['/api/player-elo?players=68,419', '/api/players/search?club=Mellor'])('refuses a signed-out visitor (401, as an API): %s', async path => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(Player.getPlayerEloTimeSeries).not.toHaveBeenCalled();
  });

  it('answers a signed-in user', async () => {
    mockUser = member;
    expect((await request(app).get('/api/player-elo?players=68')).status).toBe(200);
  });
});

describe('/eligiblePlayers/:team/:gender', () => {
  it('refuses a signed-out visitor without a draft link, before reading any player', async () => {
    const res = await request(app).get('/eligiblePlayers/29/Male');
    expect(res.status).toBe(403);
    expect(Player.findElgiblePlayersFromTeamId).not.toHaveBeenCalled();
  });

  it('refuses a draft link whose token is wrong, or a draft that does not exist', async () => {
    Fixture.getScorecardById.mockResolvedValue([{ id: 900, confirmToken: TOKEN }]);
    expect((await request(app).get(`/eligiblePlayers/29/Male?draft=900&t=${'b'.repeat(43)}`)).status).toBe(403);
    Fixture.getScorecardById.mockResolvedValue([]);
    expect((await request(app).get(`/eligiblePlayers/29/Male?draft=901&t=${TOKEN}`)).status).toBe(403);
    expect((await request(app).get(`/eligiblePlayers/29/Male?draft=1%20OR%201=1&t=${TOKEN}`)).status).toBe(403);
    expect(Player.findElgiblePlayersFromTeamId).not.toHaveBeenCalled();
  });

  it('answers the captain holding the draft link, and a signed-in user, privately', async () => {
    Fixture.getScorecardById.mockResolvedValue([{ id: 900, confirmToken: TOKEN }]);
    const captain = await request(app).get(`/eligiblePlayers/29/Male?draft=900&t=${TOKEN}`);
    expect(captain.status).toBe(200);
    expect(captain.body).toEqual([{ id: 1, first_name: 'Pat', family_name: 'One' }]);
    expect(captain.headers['cache-control']).toBe('private, no-store');
    mockUser = member;
    expect((await request(app).get('/eligiblePlayers/29/Female')).status).toBe(200);
  });
});

it('no longer has the unused /submit-form, which listed any team\'s players to anyone', async () => {
  const res = await request(app).post('/submit-form').type('form').send({ division: 'Premier', home_team: 'Mellor A' });
  expect(res.status).toBe(404);
});
