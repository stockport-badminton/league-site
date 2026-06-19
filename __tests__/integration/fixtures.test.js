const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/auth.js');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const Division = require('../../models/division');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
});

// GET /fixtures — unauthenticated, returns JSON via Fixture.getAll
describe('GET /fixtures', () => {
  it('returns 200 with fixtures array', async () => {
    Fixture.getAll.mockResolvedValue([
      { id: 1, homeTeam: 'Mellor A', awayTeam: 'Disley A', status: 'complete' },
      { id: 2, homeTeam: 'Dome A', awayTeam: 'Shell A', status: 'outstanding' },
    ]);
    const res = await request(app).get('/fixtures');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].homeTeam).toBe('Mellor A');
  });

  it('returns empty array when no fixtures', async () => {
    Fixture.getAll.mockResolvedValue([]);
    const res = await request(app).get('/fixtures');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// GET /fixture/homeId-:homeTeam/awayId-:awayTeam — unauthenticated, returns JSON via Fixture.getFixtureId
describe('GET /fixture/homeId-:homeTeam/awayId-:awayTeam', () => {
  it('returns 200 with fixture id data', async () => {
    Fixture.getFixtureId.mockResolvedValue([{ id: 42, homeTeam: 'Bramhall A', awayTeam: 'Canute A' }]);
    const res = await request(app).get('/fixture/homeId-BramhallA/awayId-CanuteA');
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(42);
  });

  it('calls Fixture.getFixtureId with correct team params', async () => {
    Fixture.getFixtureId.mockResolvedValue([]);
    await request(app).get('/fixture/homeId-BramhallA/awayId-CanuteA');
    expect(Fixture.getFixtureId).toHaveBeenCalledWith({
      homeTeam: 'BramhallA',
      awayTeam: 'CanuteA',
    });
  });
});

// POST /scorecard-beta — validateScorecard runs first; empty body triggers validation errors
// which causes full_fixture_post to render the error page (200 HTML)
describe('POST /scorecard-beta (validation errors path)', () => {
  it('returns 200 and renders error page when scores are missing', async () => {
    Division.getAllAndSelectedById.mockResolvedValue([{ id: 1, name: 'Division 1' }]);
    const Team = require('../../models/teams');
    const Player = require('../../models/players');
    Team.getAllAndSelectedById.mockResolvedValue([]);
    Player.getEligiblePlayersAndSelectedById.mockResolvedValue([]);

    const res = await request(app)
      .post('/scorecard-beta')
      .type('form')
      .send({});
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Scorecard Received - Errors/);
  });

  it('calls Division.getAllAndSelectedById(1) when validation fails', async () => {
    Division.getAllAndSelectedById.mockResolvedValue([{ id: 1, name: 'Division 1' }]);
    const Team = require('../../models/teams');
    const Player = require('../../models/players');
    Team.getAllAndSelectedById.mockResolvedValue([]);
    Player.getEligiblePlayersAndSelectedById.mockResolvedValue([]);

    await request(app).post('/scorecard-beta').type('form').send({});
    expect(Division.getAllAndSelectedById).toHaveBeenCalledWith(1, undefined);
  });
});
