// The points-based rating's weekly snapshots, charted beside the ELO for a superadmin only:
// /elo-chart offers it, and a player's game stats page draws it and gives the latest week.
// Everyone else sees the ELO pages as they were, and nothing of the rating reaches them.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/userInViews', () => () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/players');
jest.mock('../../models/teamStrength');
jest.mock('../../models/division');
jest.mock('../../models/club');
jest.mock('../../models/teams');
jest.mock('../../models/roster');

const Player = require('../../models/players');
const TeamStrength = require('../../models/teamStrength');
const Division = require('../../models/division');
const Club = require('../../models/club');
const Team = require('../../models/teams');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Results Secretary', _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' } };
const MEMBER = { id: 'b', displayName: 'A Captain', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Dome' } };

const game = (id, date, after) => ({ id, date, teamName: 'Manor B', teamAdjustment: null, partnerName: 'A Partner',
  oppName1: 'Opp One', oppName2: 'Opp Two', score: 21, vsScore: 15, gameType: 'Ladies', beforeVal: after - 8, after, adjustment: 8 });

beforeEach(() => {
  jest.clearAllMocks();
  Division.getAll.mockResolvedValue([]);
  Club.getAll.mockResolvedValue([]);
  Team.getAll.mockResolvedValue([]);
  Player.getPlayerEloTimeSeries.mockResolvedValue([]);
  // Newest first, as the page's query returns them.
  Player.getPlayerGameData.mockResolvedValue([game(2, '2026-11-10', 1530), game(1, '2026-10-06', 1522)]);
  TeamStrength.playerWeeks.mockResolvedValue([
    { player: 409, asOf: '2026-05-04', rating: 1580, se: 45 }, // last season: before this season's games
    { player: 409, asOf: '2026-09-28', rating: 1600, se: 42 },
    { player: 409, asOf: '2026-11-16', rating: 1615, se: 40 },
  ]);
});

describe('GET /elo-chart', () => {
  it('offers a superadmin the points rating beside the ELO, and keeps the page out of caches', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get('/elo-chart');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="rating-mode"');
    expect(res.text).toContain('var SHOW_STRENGTH = true;');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('shows anyone else the ELO alone', async () => {
    mockCurrentUser = MEMBER;
    const res = await request(app).get('/elo-chart');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('id="rating-mode"');
    expect(res.text).toContain('var SHOW_STRENGTH = false;');
  });
});

describe('GET /playerStats/:id/:fullName', () => {
  it('gives a superadmin the latest week, and charts from the week they came into this season\'s first game with', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get('/playerStats/409/Claire%20Inglis');
    expect(res.status).toBe(200);
    expect(TeamStrength.playerWeeks).toHaveBeenCalledWith([409]);
    expect(res.text).toMatch(/Points rating \(admin only\): <strong>1615<\/strong>\s*±40, week of 2026-11-16/);
    const points = JSON.parse(res.text.match(/var points = (\[.*?\]);/)[1]);
    expect(points).toEqual([{ x: '2026-09-28', y: 1600, se: 42 }, { x: '2026-11-16', y: 1615, se: 40 }]);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('shows a member of the player\'s club who is not a superadmin nothing of it', async () => {
    // Signed-out visitors no longer reach the page at all (player-data-access.test.js).
    require('../../models/roster').getPlayerOwner.mockResolvedValue({ id: 409, clubName: 'Dome' });
    mockCurrentUser = MEMBER;
    const res = await request(app).get('/playerStats/409/Claire%20Inglis');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('id="points-rating"');
    expect(res.text).toContain('var points = [];');
    expect(TeamStrength.playerWeeks).not.toHaveBeenCalled();
  });
});

describe('GET /player-stats', () => {
  const stats = (playerId, playername, teamName) => ({ playerId, playername, playergender: 'Female', teamName, clubName: 'Manor',
    forPoints: 100, againstPoints: 80, Points: 3, gamesPlayed: 6, gamesWon: 4, rating: 1522 });
  // Columns are read back by header: the points rating is the last one when it is there.
  const lastCells = text => [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1])
    .filter(r => r.includes('/playerStats/'))
    .map(r => [...r.matchAll(/<td([^>]*)>([^<]*)<\/td>/g)].pop());

  beforeEach(() => {
    // Player 409 played for two teams: an "All Teams" row and one per team. Player 410 has no week.
    Player.newGetPlayerStats.mockResolvedValue([stats(409, 'Claire Inglis', 'Manor A'), stats(409, 'Claire Inglis', 'Manor B'),
      stats(410, 'Anne Other', 'Manor A')]);
    TeamStrength.ratingsAt.mockResolvedValue([{ player: 409, rating: 1615, se: 40, asOf: '2026-11-16' }]);
  });

  it('gives a superadmin a points rating column, with its uncertainty and week on hover', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get('/player-stats');
    expect(res.status).toBe(200);
    expect(TeamStrength.ratingsAt).toHaveBeenCalledWith(null);
    expect(res.text).toContain('>Points rating</th>');
    const cells = lastCells(res.text);
    expect(cells.map(c => c[2])).toEqual(['1615', '1615', '1615', '']); // All Teams, Manor A, Manor B, Anne
    expect(cells[0][1]).toContain('title="±40, week of 2026-11-16"');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('shows an earlier season\'s rating as it stood when that season ended', async () => {
    mockCurrentUser = SUPERADMIN;
    await request(app).get('/player-stats/season-20242025');
    expect(TeamStrength.ratingsAt).toHaveBeenCalledWith('20242025');
  });

  it('shows anyone else the table without it', async () => {
    mockCurrentUser = MEMBER;
    const res = await request(app).get('/player-stats');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Points rating');
    expect(lastCells(res.text).map(c => c[2])).toEqual(['1522', '1522', '1522', '1522']); // the ELO column is last
    expect(TeamStrength.ratingsAt).not.toHaveBeenCalled();
  });
});

describe('the ratings explainer', () => {
  const bands = [{ rank: 1, division: 'Premier', gender: 'Female', players: 55, p10: 1391, median: 1721, p90: 1867 }];
  beforeEach(() => {
    TeamStrength.divisionBands.mockResolvedValue(bands);
    Player.newGetPlayerStats.mockResolvedValue([]);
    TeamStrength.ratingsAt.mockResolvedValue([]);
  });

  it.each(['/elo-chart', '/player-stats'])('on %s, explains the ELO to anyone and keeps the points rating to a superadmin', async page => {
    mockCurrentUser = MEMBER;
    let res = await request(app).get(page);
    expect(res.text).toContain('About these ratings');
    expect(res.text).toContain('Everyone starts at 1500');
    expect(res.text).not.toContain('Compare men with men, and ladies with ladies.');
    expect(res.text).not.toContain('1721');
    expect(TeamStrength.divisionBands).not.toHaveBeenCalled();

    mockCurrentUser = SUPERADMIN;
    res = await request(app).get(page);
    expect(res.text).toContain('Compare men with men, and ladies with ladies.');
    expect(res.text).toMatch(/<td>Premier<\/td><td>Ladies<\/td><td class="text-right">55<\/td>\s*<td class="text-right">1391<\/td><td class="text-right"><strong>1721<\/strong><\/td><td class="text-right">1867<\/td>/);
  });
});
