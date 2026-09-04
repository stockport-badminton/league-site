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
    // `(1, 0)`, not `(1, undefined)`. The error branch now coerces every id it queries
    // with, because these land in integer columns and the values come straight off a
    // form: a value-less <option> posts its own label, and a scanner posts junk. Passing
    // the raw value through is what made the page whose only job is to show a validation
    // message throw `invalid input syntax for type bigint` instead — see
    // __tests__/integration/scorecard-no-player.test.js. 0 selects nobody, which is the
    // right answer for an unusable id.
    expect(Division.getAllAndSelectedById).toHaveBeenCalledWith(1, 0);
  });
});

// GET /scorecard/fixture/:id — renders the real EJS, so these assert on the HTML.
//
// getScorecardDataById INNER JOINs `game`, and 3,261 of 5,214 fixtures have no game
// rows (the archive predates game-level recording). The view read result[0].date off
// that empty array and threw a TypeError on every one of them — Sentry NODE-T.
describe('GET /scorecard/fixture/:id', () => {
  const GAME_ROWS = [
    { date: new Date(2026, 2, 17), homeTeam: 'Mellor A', awayTeam: 'Disley A',
      homePlayer1: 'Pat One', homePlayer2: 'Sam Two',
      awayPlayer1: 'Alex Three', awayPlayer2: 'Jo Four',
      homeScore: 21, awayScore: 15, totalHomeScore: 7, totalAwayScore: 11 },
    { date: new Date(2026, 2, 17), homeTeam: 'Mellor A', awayTeam: 'Disley A',
      homePlayer1: 'Pat One', homePlayer2: 'Sam Two',
      awayPlayer1: 'Alex Three', awayPlayer2: 'Jo Four',
      homeScore: 21, awayScore: 18, totalHomeScore: 7, totalAwayScore: 11 },
  ];

  it('renders the summary and an explanation when no games were recorded', async () => {
    Fixture.getScorecardDataById.mockResolvedValue([]);
    Fixture.getFixtureSummaryById.mockResolvedValue([{
      id: 795, date: new Date(2019, 9, 13), status: 'complete',
      homeTeam: 'Bramhall A', awayTeam: 'Canute A', homeScore: 9, awayScore: 9,
    }]);

    const res = await request(app).get('/scorecard/fixture/795');

    expect(res.status).toBe(200);
    // The fixture is still described, rather than the page blowing up.
    expect(res.text).toContain('13/10/2019');
    expect(res.text).toContain('Bramhall A');
    expect(res.text).toContain('Canute A');
    expect(res.text).toMatch(/No game-by-game detail was recorded/);
    // Final score from the fixture row; no points total, since there are no games.
    expect(res.text).toMatch(/<div class="col-1">9-9<\/div>/);
  });

  it('renders the games and no explanation when detail exists', async () => {
    Fixture.getScorecardDataById.mockResolvedValue(GAME_ROWS);

    const res = await request(app).get('/scorecard/fixture/6577');

    expect(res.status).toBe(200);
    expect(res.text).toContain('17/03/2026');
    expect(res.text).toContain('Pat One');
    expect(res.text).toContain('Alex Three');
    expect(res.text).not.toMatch(/No game-by-game detail was recorded/);
    // Points total (21+21 v 15+18) alongside the fixture score.
    expect(res.text).toMatch(/<div class="col-2">42-33<\/div>/);
    expect(res.text).toMatch(/<div class="col-1">7-11<\/div>/);
    // The summary comes off the first game row, so no second query is needed.
    expect(Fixture.getFixtureSummaryById).not.toHaveBeenCalled();
  });

  it('404s when the fixture does not exist at all', async () => {
    Fixture.getScorecardDataById.mockResolvedValue([]);
    Fixture.getFixtureSummaryById.mockResolvedValue([]);

    const res = await request(app).get('/scorecard/fixture/999999');
    expect(res.status).toBe(404);
  });

  it('surfaces a model failure as an error, not a 200', async () => {
    // The handler used to `res.send(err)`, answering 200 with a serialised error —
    // so a real failure looked like a success to the browser and to monitoring.
    Fixture.getScorecardDataById.mockRejectedValue(new Error('connection terminated'));

    const res = await request(app).get('/scorecard/fixture/795');
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
