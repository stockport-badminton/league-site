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

  it('shows a visitor, or a member who is not a superadmin, nothing of it', async () => {
    for (const user of [null, MEMBER]) {
      mockCurrentUser = user;
      const res = await request(app).get('/playerStats/409/Claire%20Inglis');
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('id="points-rating"');
      expect(res.text).toContain('var points = [];');
    }
    expect(TeamStrength.playerWeeks).not.toHaveBeenCalled();
  });
});
