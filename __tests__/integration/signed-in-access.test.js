// What a signed-in user may read beyond their own club (Nov 2026 access review, the
// signed-in group). Before this any sign-in listed every registered player in the league
// (/players), fuzzy-matched a name against all of them (/players/matching), and read any
// Messer draft's line-ups by counting up its id (/populated-messer-scorecard/:id).
// The live scorecard's own-club rule is in live-scorecard.test.js.
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
jest.mock('../../models/teams');
jest.mock('../../models/division');
jest.mock('../../models/roster');
jest.mock('../../models/club');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const Player = require('../../models/players');
const Team = require('../../models/teams');
const Roster = require('../../models/roster');
const app = require('../../app');

const CLUB = 'https://my-app.example.com/club';
const ROLE = 'https://my-app.example.com/role';
const tatton = { id: 'auth0|t', _json: { [ROLE]: 'admin', [CLUB]: 'Tatton' } };
const aerospace = { id: 'auth0|a', _json: { [ROLE]: 'admin', [CLUB]: 'Aerospace' } };
const messerAdmin = { id: 'auth0|m', _json: { [ROLE]: 'admin', [CLUB]: 'Aerospace', 'https://my-app.example.com/messeradmin': true } };
const superadmin = { id: 'auth0|s', _json: { [ROLE]: 'superadmin', [CLUB]: 'All' } };
const noClub = { id: 'auth0|n', _json: {} };

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
});

describe('/players (the registration list)', () => {
  beforeEach(() => {
    Player.getNamesClubsTeams.mockResolvedValue([
      { playerID: 68, name: 'Pat Tatton', gender: 'Male', clubId: 1, clubName: 'Tatton', teamName: 'Tatton A', teamId: 10, rank: 1 },
    ]);
  });

  it('lists only the viewer\'s own club, whatever the URL leaves out', async () => {
    mockUser = tatton;
    const res = await request(app).get('/players');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Pat Tatton');
    expect(Player.getNamesClubsTeams).toHaveBeenLastCalledWith(expect.objectContaining({ club: 'Tatton' }));
    expect(res.headers['cache-control']).toBe('private, no-store');

    await request(app).get('/players/gender-Female');
    expect(Player.getNamesClubsTeams).toHaveBeenLastCalledWith(expect.objectContaining({ club: 'Tatton', gender: 'Female' }));
  });

  it('refuses another club by name, and a sign-in with no club', async () => {
    mockUser = tatton;
    expect((await request(app).get('/players/club-Mellor')).status).toBe(403);
    mockUser = noClub;
    expect((await request(app).get('/players')).status).toBe(403);
    expect(Player.getNamesClubsTeams).not.toHaveBeenCalled();
  });

  it('lists every club for a superadmin', async () => {
    mockUser = superadmin;
    await request(app).get('/players');
    expect(Player.getNamesClubsTeams.mock.calls[0][0].club).toBeUndefined();
    await request(app).get('/players/club-Mellor');
    expect(Player.getNamesClubsTeams).toHaveBeenLastCalledWith(expect.objectContaining({ club: 'Mellor' }));
  });
});

describe('/players/matching', () => {
  it('is for the superadmin only', async () => {
    Player.getNamesClubsTeams.mockResolvedValue([{ playerID: 68, name: 'Pat Tatton', clubId: 1, clubName: 'Tatton' }]);
    mockUser = tatton;
    expect((await request(app).get('/players/matching/Pat/Male')).status).toBe(403);
    expect(Player.getNamesClubsTeams).not.toHaveBeenCalled();
    mockUser = superadmin;
    const res = await request(app).get('/players/matching/Pat/Male');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ playerID: 68 });
  });
});

describe('/populated-messer-scorecard/:id', () => {
  beforeEach(() => {
    Fixture.getMesserScorecardById.mockResolvedValue([{ id: 17, date: new Date(2026, 9, 1), homeTeam: 10, awayTeam: 11 }]);
    Roster.getTeamOwner.mockImplementation(async id => ({ 10: { clubName: 'Tatton' }, 11: { clubName: 'Mellor' } })[id] || null);
    Team.getById.mockResolvedValue([{ id: 10, section: 'A' }]);
    Team.getAllAndSelectedBySection.mockResolvedValue([{ id: 10, name: 'Tatton A', selected: true }]);
    Player.getEligiblePlayersAndSelectedById.mockResolvedValue([{ id: 68, first_name: 'Pat', family_name: 'Tatton', selected: true }]);
  });

  it('opens for either club in the tie', async () => {
    mockUser = tatton;
    const res = await request(app).get('/populated-messer-scorecard/17');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Pat');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('is a 404 for any other club, the same as a missing draft', async () => {
    mockUser = aerospace;
    const res = await request(app).get('/populated-messer-scorecard/17');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Pat');
    expect(Player.getEligiblePlayersAndSelectedById).not.toHaveBeenCalled();
  });

  it('opens for a Messer admin or the superadmin from any club', async () => {
    mockUser = messerAdmin;
    expect((await request(app).get('/populated-messer-scorecard/17')).status).toBe(200);
    mockUser = superadmin;
    expect((await request(app).get('/populated-messer-scorecard/17')).status).toBe(200);
  });
});
