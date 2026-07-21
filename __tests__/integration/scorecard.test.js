const request = require('supertest');

// Auth bypass — injects a fake authenticated user so secured() calls next()
jest.mock('../../middleware/secured', () => (req, res, next) => {
  req.user = { id: 'auth0|test', displayName: 'Test User', emails: [{ value: 'test@test.com' }] };
  next();
});

// Model mocks
jest.mock('../../models/division');
jest.mock('../../models/teams');
jest.mock('../../models/players');
jest.mock('../../models/fixture');
jest.mock('../../models/game');
jest.mock('../../models/auth.js');
jest.mock('axios');

// EJS renderFile mock (email template) — preserves __express so res.render() still works
jest.mock('ejs', () => {
  const actual = jest.requireActual('ejs');
  return { ...actual, renderFile: jest.fn().mockResolvedValue('<html>email</html>') };
});

// AWS SES mock
jest.mock('../../utils/ses', () => ({
  sendEmail: jest.fn().mockResolvedValue({})
}));

const Division = require('../../models/division');
const Team = require('../../models/teams');
const Player = require('../../models/players');
const Fixture = require('../../models/fixture');
const Game = require('../../models/game');
const Auth = require('../../models/auth.js');
const axios = require('axios');
const app = require('../../app');

// ── Fixtures (test data) ──────────────────────────────────────────────────────

const mockDivisions = [{ id: 1, name: 'Division 1' }];

const mockPlayerRows = [
  { id: 1, name: 'Player One', selected: 0 },
  { id: 2, name: 'Player Two', selected: 0 },
];

// Build a valid POST body with 18 games (home wins 21–15) and 12 distinct players.
// Also includes the game-type-specific player selectors that the form populates via JS.
function validScorecard(overrides = {}) {
  const games = {};
  for (let i = 1; i <= 18; i++) {
    games[`Game${i}homeScore`] = 21;
    games[`Game${i}awayScore`] = 15;
  }
  return {
    division: '1',
    homeTeam: '10',
    awayTeam: '20',
    date: '2026-01-15',
    // Standard player selectors (12 distinct IDs)
    homeMan1: '1', homeMan2: '2', homeMan3: '3',
    homeLady1: '4', homeLady2: '5', homeLady3: '6',
    awayMan1: '7', awayMan2: '8', awayMan3: '9',
    awayLady1: '10', awayLady2: '11', awayLady3: '12',
    // Game-type specific selectors (populated by JS in the form; needed by full_fixture_post)
    FirstMenshomeMan1: '1', FirstMenshomeMan2: '2', FirstMensawayMan1: '7', FirstMensawayMan2: '8',
    FirstLadieshomeLady1: '4', FirstLadieshomeLady2: '5', FirstLadiesawayLady1: '10', FirstLadiesawayLady2: '11',
    SecondMenshomeMan1: '1', SecondMenshomeMan3: '3', SecondMensawayMan1: '7', SecondMensawayMan3: '9',
    SecondLadieshomeLady1: '4', SecondLadieshomeLady3: '6', SecondLadiesawayLady1: '10', SecondLadiesawayLady3: '12',
    ThirdMenshomeMan2: '2', ThirdMenshomeMan3: '3', ThirdMensawayMan2: '8', ThirdMensawayMan3: '9',
    ThirdLadieshomeLady2: '5', ThirdLadieshomeLady3: '6', ThirdLadiesawayLady2: '11', ThirdLadiesawayLady3: '12',
    FirstMixedhomeMan1: '1', FirstMixedhomeLady1: '4', FirstMixedawayMan1: '7', FirstMixedawayLady1: '10',
    SecondMixedhomeMan2: '2', SecondMixedhomeLady2: '5', SecondMixedawayMan2: '8', SecondMixedawayLady2: '11',
    ThirdMixedhomeMan3: '3', ThirdMixedhomeLady3: '6', ThirdMixedawayMan3: '9', ThirdMixedawayLady3: '12',
    'scoresheet-url': '',
    email: 'secretary@example.com',
    ...games,
    ...overrides,
  };
}

// Standard mocks for the full_fixture_post success path
function setupFullFixtureMocks() {
  const fixtureRow = [{ id: 99, rank: 1, name: 'Division 1' }];
  const fixtureDetails = [{ homeTeam: 'Mellor A', awayTeam: 'Canute A', homeScore: 9, awayScore: 9 }];

  // prevScores needs entries for all 12 player IDs used in validScorecard()
  const mockPrevScores = {};
  for (let i = 1; i <= 12; i++) {
    mockPrevScores[String(i)] = { rating: 1500, date: '2026-01-01' };
  }

  Fixture.getOutstandingFixtureId.mockResolvedValue(fixtureRow);
  Fixture.updateById.mockResolvedValue({});
  Fixture.getFixtureDetailsById.mockResolvedValue(fixtureDetails);
  Fixture.sendResultZap.mockResolvedValue({});
  Fixture.getMatchPlayerOrderDetails.mockResolvedValue([]);
  Player.getPrevRating.mockResolvedValue(mockPrevScores);
  Player.getNominatedPlayers.mockResolvedValue([]);
  Player.getMatchStats.mockResolvedValue([[], []]);
  Game.calculateRating.mockReturnValue({
    updateObj: {
      homePlayer1Start: 1500, homePlayer2Start: 1500,
      awayPlayer1Start: 1500, awayPlayer2Start: 1500,
      homePlayer1End: 1510, homePlayer2End: 1510,
      awayPlayer1End: 1490, awayPlayer2End: 1490,
    }
  });
  Game.createBatch.mockResolvedValue({});
  Division.getAllByLeague.mockResolvedValue(mockDivisions);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── GET /scorecard-beta ───────────────────────────────────────────────────────

describe('GET /scorecard-beta', () => {
  it('returns 200 and renders the scorecard form', async () => {
    Division.getAllByLeague.mockResolvedValue(mockDivisions);
    const res = await request(app).get('/scorecard-beta');
    expect(res.status).toBe(200);
  });

  it('passes divisions to the view', async () => {
    Division.getAllByLeague.mockResolvedValue(mockDivisions);
    const res = await request(app).get('/scorecard-beta');
    expect(res.text).toContain('Division 1');
  });

  it('returns 500 when Division.getAllByLeague rejects', async () => {
    Division.getAllByLeague.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/scorecard-beta');
    expect(res.status).toBe(500);
  });
});

// ── GET /email-scorecard ──────────────────────────────────────────────────────

describe('GET /email-scorecard', () => {
  beforeEach(() => {
    Division.getAllByLeague.mockResolvedValue(mockDivisions);
    Auth.getManagementAPIKey.mockResolvedValue('mock-token');
    axios.get.mockResolvedValue({ data: [{ email: 'test@test.com', app_metadata: {} }] });
    Fixture.getMissingScorecardPhotos.mockResolvedValue([]);
  });

  it('returns 200', async () => {
    const res = await request(app).get('/email-scorecard');
    expect(res.status).toBe(200);
  });

  it('calls getMissingScorecardPhotos with the authenticated user email', async () => {
    await request(app).get('/email-scorecard');
    expect(Fixture.getMissingScorecardPhotos).toHaveBeenCalledWith('test@test.com');
  });

  it('returns 500 when Auth0 API call fails', async () => {
    Auth.getManagementAPIKey.mockResolvedValue('mock-token');
    axios.get.mockRejectedValue(new Error('Auth0 unreachable'));
    const res = await request(app).get('/email-scorecard');
    expect(res.status).toBe(500);
  });
});

// ── POST /email-scorecard ─────────────────────────────────────────────────────

describe('POST /email-scorecard', () => {
  describe('with invalid scores', () => {
    it('returns 200 and re-renders the form with errors', async () => {
      const mockPlayerResult = [[{ id: 1, name: 'P1', selected: 1 }]];
      Division.getAllAndSelectedById.mockResolvedValue([{ id: 1, name: 'Division 1', selected: 1 }]);
      Team.getAllAndSelectedById.mockResolvedValue([{ id: 10, name: 'Mellor A', selected: 1 }]);
      Player.getEligiblePlayersAndSelectedById.mockResolvedValue(mockPlayerResult);

      const res = await request(app)
        .post('/email-scorecard')
        .send({ ...validScorecard(), Game1homeScore: '0', Game1awayScore: '0' });

      expect(res.status).toBe(200);
    });

    it('does not call Fixture.createScorecard on validation failure', async () => {
      Division.getAllAndSelectedById.mockResolvedValue([]);
      Team.getAllAndSelectedById.mockResolvedValue([]);
      Player.getEligiblePlayersAndSelectedById.mockResolvedValue([]);

      await request(app)
        .post('/email-scorecard')
        .send({ ...validScorecard(), Game1homeScore: '0', Game1awayScore: '0' });

      expect(Fixture.createScorecard).not.toHaveBeenCalled();
    });
  });

  describe('with valid data', () => {
    beforeEach(() => {
      Fixture.createScorecard.mockResolvedValue({ insertId: 42 });
    });

    it('redirects to /populated-scorecard-beta/:insertId', async () => {
      const res = await request(app)
        .post('/email-scorecard')
        .send(validScorecard());

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/populated-scorecard-beta/42');
    });

    it('saves the scorecard draft before redirecting', async () => {
      await request(app)
        .post('/email-scorecard')
        .send(validScorecard());

      expect(Fixture.createScorecard).toHaveBeenCalledTimes(1);
      const callArg = Fixture.createScorecard.mock.calls[0][0];
      expect(callArg.homeTeam).toBe('10');
      expect(callArg.awayTeam).toBe('20');
    });

    it('does not re-render the form (prevents duplicate submission on refresh)', async () => {
      const res = await request(app)
        .post('/email-scorecard')
        .send(validScorecard());

      // A redirect, not a 200 render
      expect(res.status).not.toBe(200);
    });
  });

  describe('when DB write fails', () => {
    it('returns 500', async () => {
      Fixture.createScorecard.mockRejectedValue(new Error('DB connection lost'));
      const res = await request(app)
        .post('/email-scorecard')
        .send(validScorecard());
      expect(res.status).toBe(500);
    });
  });
});

// ── GET /populated-scorecard-beta/:id ────────────────────────────────────────

describe('GET /populated-scorecard-beta/:id', () => {
  const mockScorecardRow = [{
    division: 1, homeTeam: 10, awayTeam: 20,
    homeMan1: 1, homeMan2: 2, homeMan3: 3,
    homeLady1: 4, homeLady2: 5, homeLady3: 6,
    awayMan1: 7, awayMan2: 8, awayMan3: 9,
    awayLady1: 10, awayLady2: 11, awayLady3: 12,
  }];

  beforeEach(() => {
    Fixture.getScorecardById.mockResolvedValue(mockScorecardRow);
    Division.getAllAndSelectedById.mockResolvedValue([{ id: 1, name: 'Division 1', selected: 1 }]);
    Team.getAllAndSelectedById.mockResolvedValue([{ id: 10, name: 'Mellor A', selected: 1 }]);
    Player.getEligiblePlayersAndSelectedById.mockResolvedValue([{ id: 1, name: 'Player One', selected: 1 }]);
  });

  it('returns 200', async () => {
    const res = await request(app).get('/populated-scorecard-beta/42');
    expect(res.status).toBe(200);
  });

  it('fetches the scorecard by the ID in the URL', async () => {
    await request(app).get('/populated-scorecard-beta/42');
    expect(Fixture.getScorecardById).toHaveBeenCalledWith('42');
  });

  it('returns 500 when scorecard is not found', async () => {
    Fixture.getScorecardById.mockRejectedValue(new Error('not found'));
    const res = await request(app).get('/populated-scorecard-beta/99');
    expect(res.status).toBe(500);
  });
});

// ── POST /scorecard-beta ──────────────────────────────────────────────────────

describe('POST /scorecard-beta', () => {
  describe('with invalid scores', () => {
    it('returns 200 and re-renders the form with error messages', async () => {
      Division.getAllByLeague.mockResolvedValue(mockDivisions);

      const res = await request(app)
        .post('/scorecard-beta')
        .send({ ...validScorecard(), Game1homeScore: '0', Game1awayScore: '0' });

      expect(res.status).toBe(200);
    });

    it('does not write any games to the database on validation failure', async () => {
      Division.getAllByLeague.mockResolvedValue(mockDivisions);

      await request(app)
        .post('/scorecard-beta')
        .send({ ...validScorecard(), Game1homeScore: '0', Game1awayScore: '0' });

      expect(Game.createBatch).not.toHaveBeenCalled();
    });
  });

  describe('with valid data', () => {
    beforeEach(() => {
      setupFullFixtureMocks();
    });

    it('returns 200 on success', async () => {
      const res = await request(app)
        .post('/scorecard-beta')
        .send(validScorecard());
      expect(res.status).toBe(200);
    });

    it('looks up the fixture by home and away team names', async () => {
      await request(app).post('/scorecard-beta').send(validScorecard());
      expect(Fixture.getOutstandingFixtureId).toHaveBeenCalledWith(
        expect.objectContaining({ homeTeam: '10', awayTeam: '20' })
      );
    });

    it('creates exactly 18 games', async () => {
      await request(app).post('/scorecard-beta').send(validScorecard());
      const gamesArg = Game.createBatch.mock.calls[0][0];
      expect(gamesArg.data).toHaveLength(18);
    });

    it('triggers the Zapier webhook', async () => {
      await request(app).post('/scorecard-beta').send(validScorecard());
      expect(Fixture.sendResultZap).toHaveBeenCalledTimes(1);
    });
  });

  describe('when fixture lookup fails', () => {
    it('propagates the error', async () => {
      Fixture.getOutstandingFixtureId.mockRejectedValue(new Error('fixture not found'));
      Division.getAllByLeague.mockResolvedValue(mockDivisions);

      const res = await request(app)
        .post('/scorecard-beta')
        .send(validScorecard());

      expect(res.status).toBe(500);
    });
  });
});
