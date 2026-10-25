const request = require('supertest');

// `POST /scorecard-beta` takes either a superadmin session or a valid draft token
// (HARD-24) and is deliberately not `secured`, so `req.user` comes from the global
// `passport.session()` in app.js. These tests are about what the route DOES with a body;
// who may call it is __tests__/integration/scorecard-publish-authority.test.js.
jest.mock('passport', () => {
  const actual = jest.requireActual('passport');
  actual.session = () => (req, res, next) => {
    req.user = {
      id: 'auth0|boss',
      _json: {
        'https://my-app.example.com/role': 'superadmin',
        'https://my-app.example.com/club': 'All',
      },
    };
    req.isAuthenticated = () => true;
    next();
  };
  return actual;
});

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

// GET /fixtures and GET /fixture/home-:homeTeam/away-:awayTeam were removed on 26 Oct 2026.
// Both read `season.id = 2`, which is 2019/20 in production: /fixtures served that season's
// fixtures, and the team-names lookup matched every meeting of a pairing since 2019. Thirty
// days of request logs held one call between them (the owner, checking), and nothing in
// this repo or in remnants-badminton — which reads /fixtures/club/..., a different route —
// linked to either. Deleted rather than fixed.
describe('the removed fixture JSON routes', () => {
  it.each(['/fixtures', '/fixture/home-Shell%20A/away-Mellor%20A'])('%s answers 404', async path => {
    const res = await request(app).get(path);
    expect(res.status).toBe(404);
    expect(Object.keys(Fixture).some(k => /^getAll$|^getFixtureIdFromTeamNames$/.test(k))).toBe(false);
  });

  // /fixtures/club/... is the route remnants-badminton reads, and must not go with it.
  it('leaves /fixtures/club/... in place', async () => {
    const res = await request(app).get('/fixtures/club/Remnants');
    expect(res.status).not.toBe(404);
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

  it('404s a malformed id without reaching the database', async () => {
    // A link pasted with a trailing bracket reached Postgres as "7199]" and came back as
    // a 500 (Sentry NODE-15). Not a fixture, so it is a 404 — decided by the route.
    const res = await request(app).get('/scorecard/fixture/7199%5D');
    expect(res.status).toBe(404);
    expect(Fixture.getScorecardDataById).not.toHaveBeenCalled();
  });

  it('surfaces a model failure as an error, not a 200', async () => {
    // The handler used to `res.send(err)`, answering 200 with a serialised error —
    // so a real failure looked like a success to the browser and to monitoring.
    Fixture.getScorecardDataById.mockRejectedValue(new Error('connection terminated'));

    const res = await request(app).get('/scorecard/fixture/795');
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
