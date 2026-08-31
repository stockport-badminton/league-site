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

// The database. withTransaction is the point of these tests, so the fake records the
// connection it hands out and whether the body threw — that is how a test can assert
// both writes joined the same transaction, and that a failing one rolls back rather
// than leaving a result with no games behind it.
jest.mock('../../db_connect', () => {
  const state = {
    __lastTransactionConn: null,
    __rolledBack: false,
    connect: jest.fn(),
    otherConnect: jest.fn(() => Promise.resolve({
      query: jest.fn(() => Promise.resolve([[]]))
    })),
    isObject: obj => obj === Object(obj),
    withTransaction: jest.fn(async fn => {
      const conn = { query: jest.fn(() => Promise.resolve([[]])) };
      state.__lastTransactionConn = conn;
      try {
        const out = await fn(conn);
        state.__rolledBack = false;
        return out;
      } catch (err) {
        state.__rolledBack = true;
        throw err;
      }
    })
  };
  return state;
});

const Division = require('../../models/division');
const Team = require('../../models/teams');
const Player = require('../../models/players');
const Fixture = require('../../models/fixture');
const Game = require('../../models/game');
const Auth = require('../../models/auth.js');
const axios = require('axios');
const ses = require('../../utils/ses');
const db = require('../../db_connect');
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
    // The rubber-stamped match totals. The form posts these and the handler writes
    // them straight onto the fixture; this fixture omitted them entirely, so every
    // test here was exercising a body the real form never sends. Home wins all 18.
    homeScore: '18',
    awayScore: '0',
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

  // One open fixture for the pairing. The controller now resolves which fixture a
  // result belongs to from every row for those two teams, so the mock returns rows
  // with a status rather than a pre-filtered id.
  Fixture.getFixturesForTeams.mockResolvedValue([
    { id: 99, status: 'outstanding', date: '2026-01-15', rank: 1, name: 'Division 1' }
  ]);
  // resolveFixtureForResult is pure, so use the real one — mocking it would leave the
  // choosing logic, which is the part that was broken, untested.
  Fixture.resolveFixtureForResult.mockImplementation(
    jest.requireActual('../../models/fixture').resolveFixtureForResult
  );
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
      // The shape Fixture.createScorecard really resolves to: the db wrapper returns
      // a rows array, and the INSERT carries RETURNING id.
      //
      // This used to be mocked as `{ insertId: 42 }` — a mysql2 shape that this model
      // never produced — and the assertion below passed against it while production
      // redirected every captain to /populated-scorecard-beta/undefined and emailed
      // the results secretary the same dead link. A mock that invents its subject's
      // return shape can only test itself.
      Fixture.createScorecard.mockResolvedValue([{ id: 42 }]);
    });

    it('redirects to the new draft, using the id the INSERT returned', async () => {
      const res = await request(app)
        .post('/email-scorecard')
        .send(validScorecard());

      expect(res.status).toBe(302);
      // The token is asserted separately, below; the id is what this test is about.
      expect(res.headers.location).toMatch(/^\/populated-scorecard-beta\/42(\?|$)/);
      expect(res.headers.location).not.toContain('undefined');
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

    // The half of the bug a redirect assertion can't see: the results secretary is
    // emailed a link to the draft, and for a long time that link ended in
    // "undefined". This asserts on the mail body itself.
    it('emails the results secretary a link containing the real id', async () => {
      await request(app)
        .post('/email-scorecard')
        .send(validScorecard());

      expect(ses.sendEmail).toHaveBeenCalledTimes(1);
      const html = ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;
      expect(html).toContain('/populated-scorecard-beta/42');
      expect(html).not.toContain('undefined');
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

  // If RETURNING is ever dropped from the INSERT again, this is what it looks like:
  // the write may have landed but there is no way to tell anyone where. Fail
  // visibly rather than send another dead link.
  describe('when the insert returns no id', () => {
    it('500s instead of building a link ending in undefined', async () => {
      Fixture.createScorecard.mockResolvedValue([]);
      const res = await request(app)
        .post('/email-scorecard')
        .send(validScorecard());
      expect(res.status).toBe(500);
      expect(ses.sendEmail).not.toHaveBeenCalled();
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
      expect(Fixture.getFixturesForTeams).toHaveBeenCalledWith(
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
      Fixture.getFixturesForTeams.mockRejectedValue(new Error('fixture not found'));
      Division.getAllByLeague.mockResolvedValue(mockDivisions);

      const res = await request(app)
        .post('/scorecard-beta')
        .send(validScorecard());

      expect(res.status).toBe(500);
    });
  });

  // The result and its games must land together or not at all.
  //
  // They were two independent writes with the fixture first, so anything that threw
  // afterwards left a score in the league table with no games behind it — player
  // stats, pair stats and ELO all silently omitting the match. Three fixtures from
  // last season are still in that state (#6117, #6576, #6037), unnoticed for a whole
  // season because a half-applied result renders perfectly.
  describe('atomicity', () => {
    beforeEach(() => {
      setupFullFixtureMocks();
    });

    it('writes the result and the games in one transaction', async () => {
      await request(app).post('/scorecard-beta').send(validScorecard());

      expect(db.withTransaction).toHaveBeenCalledTimes(1);
      // Both writes received the transaction's connection, not a fresh one.
      const conn = db.__lastTransactionConn;
      expect(Fixture.updateById).toHaveBeenCalledWith(expect.anything(), 99, conn);
      expect(Game.createBatch).toHaveBeenCalledWith(expect.anything(), conn);
    });

    it('does not record the result when the games cannot be written', async () => {
      Game.createBatch.mockRejectedValue(new Error('insert exploded'));

      const res = await request(app).post('/scorecard-beta').send(validScorecard());

      // The transaction rolls back, so the request fails honestly rather than leaving
      // a score with nothing behind it.
      expect(res.status).toBe(500);
      expect(db.__rolledBack).toBe(true);
    });
  });

  // Everything after the commit is notification and presentation. None of it may cost
  // the captain a result that is already saved — which is how a momentary SES outage
  // used to turn into a captain resubmitting and being told "no matching fixtures".
  describe('when a post-commit step fails', () => {
    beforeEach(() => {
      setupFullFixtureMocks();
    });

    it('still succeeds when the results email cannot be sent', async () => {
      ses.sendEmail.mockRejectedValue(new Error('SES is having a moment'));

      const res = await request(app).post('/scorecard-beta').send(validScorecard());

      expect(res.status).toBe(200);
      expect(Game.createBatch).toHaveBeenCalled();
      // And the captain is told the difference between "saved" and "saved and notified".
      expect(res.text).toMatch(/couldn't email the results secretary/i);
    });

    it('still succeeds when the Zapier webhook fails', async () => {
      Fixture.sendResultZap.mockRejectedValue(new Error('zap down'));
      const res = await request(app).post('/scorecard-beta').send(validScorecard());
      expect(res.status).toBe(200);
    });

    it('still succeeds when the confirmation-page data cannot be fetched', async () => {
      Player.getMatchStats.mockRejectedValue(new Error('stats down'));
      const res = await request(app).post('/scorecard-beta').send(validScorecard());
      expect(res.status).toBe(200);
    });
  });

  // A captain resubmitting used to read the literal string "no matching fixtures" on
  // the 500 page, and reasonably conclude nothing had saved.
  describe('when the fixture cannot be matched', () => {
    beforeEach(() => {
      setupFullFixtureMocks();
      Fixture.resolveFixtureForResult.mockImplementation(
        jest.requireActual('../../models/fixture').resolveFixtureForResult
      );
    });

    it('tells a captain the result is already recorded, and writes nothing', async () => {
      Fixture.getFixturesForTeams.mockResolvedValue([
        { id: 99, status: 'complete', date: '2026-01-15', homeScore: 11, awayScore: 7 }
      ]);

      const res = await request(app).post('/scorecard-beta').send(validScorecard());

      expect(res.status).toBe(409);
      expect(res.text).toMatch(/already recorded/i);
      expect(res.text).toContain('11');
      expect(res.text).not.toMatch(/no matching fixtures/i);
      expect(Fixture.updateById).not.toHaveBeenCalled();
      expect(Game.createBatch).not.toHaveBeenCalled();
    });

    it('refuses to guess between two open fixtures for the same pairing', async () => {
      Fixture.getFixturesForTeams.mockResolvedValue([
        { id: 99, status: 'outstanding', date: '2026-01-15' },
        { id: 77, status: 'outstanding', date: '2026-03-02' }
      ]);
      // Submitted date matches neither, so there is nothing to disambiguate on.
      const res = await request(app)
        .post('/scorecard-beta')
        .send(validScorecard({ date: '2026-02-01' }));

      expect(res.status).toBe(409);
      expect(res.text).toMatch(/can't tell which match/i);
      expect(Game.createBatch).not.toHaveBeenCalled();
    });

    it('picks the fixture matching the submitted date when two are open', async () => {
      Fixture.getFixturesForTeams.mockResolvedValue([
        { id: 99, status: 'outstanding', date: '2026-01-15', rank: 1, name: 'Division 1' },
        { id: 77, status: 'outstanding', date: '2026-03-02', rank: 1, name: 'Division 1' }
      ]);

      const res = await request(app)
        .post('/scorecard-beta')
        .send(validScorecard({ date: '2026-03-02' }));

      expect(res.status).toBe(200);
      expect(Fixture.updateById).toHaveBeenCalledWith(expect.anything(), 77, expect.anything());
    });

    it('explains a rearranged fixture instead of failing', async () => {
      Fixture.getFixturesForTeams.mockResolvedValue([
        { id: 99, status: 'rearranged', date: '2026-01-15' }
      ]);
      const res = await request(app).post('/scorecard-beta').send(validScorecard());
      expect(res.status).toBe(409);
      expect(res.text).toMatch(/rearranged/i);
    });

    it('404s when the pairing has no fixture at all', async () => {
      Fixture.getFixturesForTeams.mockResolvedValue([]);
      const res = await request(app).post('/scorecard-beta').send(validScorecard());
      expect(res.status).toBe(404);
      expect(res.text).toMatch(/can't find that fixture/i);
    });
  });

  // Nothing checked that a result was a possible one. Eight fixtures in the live table
  // record something other than 18 games, a 3–3 among them.
  describe('score totals', () => {
    beforeEach(() => {
      setupFullFixtureMocks();
    });

    it('refuses a result that does not total 18 games', async () => {
      const res = await request(app)
        .post('/scorecard-beta')
        .send(validScorecard({ homeScore: '3', awayScore: '3' }));

      expect(res.status).toBe(409);
      expect(res.text).toMatch(/don't add up to a match/i);
      expect(Fixture.updateById).not.toHaveBeenCalled();
      expect(Game.createBatch).not.toHaveBeenCalled();
    });

    it('accepts a result that totals 18', async () => {
      const res = await request(app)
        .post('/scorecard-beta')
        .send(validScorecard({ homeScore: '11', awayScore: '7' }));
      expect(res.status).toBe(200);
    });
  });
});

// ── HARD-03: the photo endpoint and the confirmation link ─────────────────────
//
// POST /add-scorecard-photo/:id was unauthenticated, wrote req.body.imgURL against any
// draft id, and interpolated that value unescaped into an HTML email sent from
// results@stockport-badminton.co.uk — so a crafted value rewrote the message itself and
// arrived as a phishing mail from our own verified domain, at the one inbox that is
// expecting exactly that email.
//
// And /populated-scorecard-beta/:id took only the draft's sequential id, so every
// scorecard ever filed could be walked by counting.

const BUCKET = 'badmintontemp';
const PHOTO_URL = `https://${BUCKET}.s3.eu-west-1.amazonaws.com/scorecards/20262027/photo.jpg`;
// The Host header Firebase actually forwards to Cloud Run. Any link built from it goes
// to a hostname that is not the site.
const CLOUD_RUN_HOST = 'league-site-akvq7tsxuq-nw.a.run.app';

function updateResult(affectedRows) {
  return Object.assign([], { affectedRows });
}

// jest.clearAllMocks() clears calls but keeps implementations, and the post-commit
// describe above leaves ses.sendEmail rejecting. Every describe below sends mail, so it
// has to be put back or they all see an SES outage that no test asked for.
function sesWorks() {
  ses.sendEmail.mockResolvedValue({});
}

describe('POST /add-scorecard-photo/:id', () => {
  beforeEach(() => {
    sesWorks();
    process.env.S3_BUCKET_NAME = BUCKET;
    Fixture.getScorecardById.mockResolvedValue([
      { id: 7, 'scoresheet-url': '', confirmToken: null }
    ]);
    Fixture.updateScorecardPhoto.mockResolvedValue(updateResult(1));
  });

  describe('the imgURL', () => {
    it('is rejected when it points somewhere other than our bucket', async () => {
      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: 'https://evil.example.com/scorecard.jpg' });

      expect(res.status).toBe(400);
      expect(Fixture.updateScorecardPhoto).not.toHaveBeenCalled();
      expect(ses.sendEmail).not.toHaveBeenCalled();
    });

    it('is rejected when it carries HTML metacharacters, so nothing is emailed at all', async () => {
      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: `${PHOTO_URL}"><a href="https://evil.example.com">Confirm</a>` });

      expect(res.status).toBe(400);
      expect(ses.sendEmail).not.toHaveBeenCalled();
    });

    it('is rejected when it is a javascript: URL', async () => {
      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: 'javascript:alert(document.domain)' });

      expect(res.status).toBe(400);
      expect(ses.sendEmail).not.toHaveBeenCalled();
    });

    it('is stored, and emailed, when it really is a photo in our bucket', async () => {
      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: PHOTO_URL });

      expect(res.status).toBe(200);
      expect(Fixture.updateScorecardPhoto).toHaveBeenCalledWith('7', PHOTO_URL);
      expect(ses.sendEmail).toHaveBeenCalledTimes(1);
      const html = ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;
      expect(html).toContain(PHOTO_URL);
    });
  });

  describe('the emailed confirmation link', () => {
    it('uses the public origin even when the Host header is the Cloud Run one', async () => {
      await request(app)
        .post('/add-scorecard-photo/7')
        .set('Host', CLOUD_RUN_HOST)
        .send({ imgURL: PHOTO_URL });

      const html = ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;
      expect(html).toContain('https://stockport-badminton.co.uk/populated-scorecard-beta/7');
      expect(html).not.toContain(CLOUD_RUN_HOST);
    });

    it('carries the draft token when the draft has one', async () => {
      Fixture.getScorecardById.mockResolvedValue([
        { id: 7, 'scoresheet-url': '', confirmToken: 'tok-en-123' }
      ]);

      await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: PHOTO_URL, token: 'tok-en-123' });

      const html = ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;
      expect(html).toContain('/populated-scorecard-beta/7?t=tok-en-123');
    });
  });

  describe('the write itself', () => {
    it('404s for a draft that does not exist, rather than writing against the id', async () => {
      Fixture.getScorecardById.mockResolvedValue([]);

      const res = await request(app)
        .post('/add-scorecard-photo/9999')
        .send({ imgURL: PHOTO_URL });

      expect(res.status).toBe(404);
      expect(Fixture.updateScorecardPhoto).not.toHaveBeenCalled();
      expect(ses.sendEmail).not.toHaveBeenCalled();
    });

    it('refuses to replace a photo that is already there', async () => {
      Fixture.getScorecardById.mockResolvedValue([
        { id: 7, 'scoresheet-url': `https://${BUCKET}.s3.eu-west-1.amazonaws.com/original.jpg`, confirmToken: null }
      ]);

      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: PHOTO_URL });

      expect(res.status).toBe(409);
      expect(Fixture.updateScorecardPhoto).not.toHaveBeenCalled();
      expect(ses.sendEmail).not.toHaveBeenCalled();
    });

    it('409s when the guarded UPDATE matched nothing, so no email claims a write that did not happen', async () => {
      Fixture.updateScorecardPhoto.mockResolvedValue(updateResult(0));

      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: PHOTO_URL });

      expect(res.status).toBe(409);
      expect(ses.sendEmail).not.toHaveBeenCalled();
    });

    it('requires the draft token when the draft has one', async () => {
      Fixture.getScorecardById.mockResolvedValue([
        { id: 7, 'scoresheet-url': '', confirmToken: 'the-real-token' }
      ]);

      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: PHOTO_URL, token: 'a-guess' });

      expect(res.status).toBe(403);
      expect(Fixture.updateScorecardPhoto).not.toHaveBeenCalled();
      expect(ses.sendEmail).not.toHaveBeenCalled();
    });

    it('accepts the draft token when it matches', async () => {
      Fixture.getScorecardById.mockResolvedValue([
        { id: 7, 'scoresheet-url': '', confirmToken: 'the-real-token' }
      ]);

      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: PHOTO_URL, token: 'the-real-token' });

      expect(res.status).toBe(200);
      expect(Fixture.updateScorecardPhoto).toHaveBeenCalledWith('7', PHOTO_URL);
    });

    // Grandfathered: drafts filed before the token column existed have none.
    it('still accepts a photo for a draft that has no token', async () => {
      const res = await request(app)
        .post('/add-scorecard-photo/7')
        .send({ imgURL: PHOTO_URL });

      expect(res.status).toBe(200);
    });
  });
});

// The escaping is the second line of defence behind the URL check above, and is proved
// directly here because no value that survives validation can exercise it.
describe('buildPhotoEmailHtml', () => {
  const { buildPhotoEmailHtml } = require('../../controllers/scorecardController');

  it('cannot have its structure altered by the URL it is given', () => {
    const hostile = 'https://x/a.jpg"><a href="https://evil.example.com">Confirm</a><!--';
    const html = buildPhotoEmailHtml(hostile, 'https://stockport-badminton.co.uk/x');

    expect(html).not.toContain('evil.example.com">Confirm');
    expect(html).not.toContain('<!--');
    // Exactly the two anchors the template itself writes: the photo and the link.
    expect((html.match(/<a /g) || []).length).toBe(2);
    expect(html).toContain('&quot;&gt;&lt;a href=&quot;');
  });
});

// ── HARD-03: the confirmation link needs the token ───────────────────────────

describe('GET /populated-scorecard-beta/:id with tokens', () => {
  const draft = (overrides = {}) => [{
    id: 42, division: 1, homeTeam: 10, awayTeam: 20,
    homeMan1: 1, homeMan2: 2, homeMan3: 3,
    homeLady1: 4, homeLady2: 5, homeLady3: 6,
    awayMan1: 7, awayMan2: 8, awayMan3: 9,
    awayLady1: 10, awayLady2: 11, awayLady3: 12,
    'scoresheet-url': '', confirmToken: null,
    ...overrides,
  }];

  beforeEach(() => {
    Division.getAllAndSelectedById.mockResolvedValue([{ id: 1, name: 'Division 1', selected: 1 }]);
    Team.getAllAndSelectedById.mockResolvedValue([{ id: 10, name: 'Mellor A', selected: 1 }]);
    // populated-scorecard.ejs prints first_name/family_name, not name — assert on what
    // the template really renders, not on what the mock happens to carry.
    Player.getEligiblePlayersAndSelectedById.mockResolvedValue([
      { id: 1, first_name: 'Player', family_name: 'One', first: 1 }
    ]);
  });

  it('does not render a scorecard when the draft has a token and the URL has none', async () => {
    Fixture.getScorecardById.mockResolvedValue(draft({ confirmToken: 'the-real-token' }));

    const res = await request(app).get('/populated-scorecard-beta/42');

    expect(res.status).toBe(403);
    expect(res.text).not.toContain('Player One');
    expect(res.text).not.toContain('signupForm');
  });

  it('does not render a scorecard for a guessed token', async () => {
    Fixture.getScorecardById.mockResolvedValue(draft({ confirmToken: 'the-real-token' }));

    const res = await request(app).get('/populated-scorecard-beta/42?t=a-guess');

    expect(res.status).toBe(403);
    expect(res.text).not.toContain('Player One');
  });

  it('renders for the token that was emailed', async () => {
    Fixture.getScorecardById.mockResolvedValue(draft({ confirmToken: 'the-real-token' }));

    const res = await request(app).get('/populated-scorecard-beta/42?t=the-real-token');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Player One');
  });

  // Grandfather clause: the links already in captains' inboxes have no token.
  it('still renders a draft that has no token stored', async () => {
    Fixture.getScorecardById.mockResolvedValue(draft());

    const res = await request(app).get('/populated-scorecard-beta/42');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Player One');
  });

  it('404s for a draft that does not exist, instead of crashing on row zero', async () => {
    Fixture.getScorecardById.mockResolvedValue([]);

    const res = await request(app).get('/populated-scorecard-beta/9999');

    expect(res.status).toBe(404);
  });

  it('keeps the token out of the page canonical', async () => {
    Fixture.getScorecardById.mockResolvedValue(draft({ confirmToken: 'the-real-token' }));

    const res = await request(app).get('/populated-scorecard-beta/42?t=the-real-token');

    expect(res.text).toContain('href="https://stockport-badminton.co.uk/populated-scorecard-beta/42"');
    expect(res.text).not.toContain('/populated-scorecard-beta/42?t=');
  });
});

// ── HARD-03: the draft gets a token when it is filed ─────────────────────────

describe('POST /email-scorecard link and token', () => {
  beforeEach(() => {
    sesWorks();
    process.env.S3_BUCKET_NAME = BUCKET;
    Fixture.createScorecard.mockResolvedValue([{ id: 42 }]);
  });

  it('stores a token on the new draft', async () => {
    await request(app).post('/email-scorecard').send(validScorecard());

    const written = Fixture.createScorecard.mock.calls[0][0];
    expect(typeof written.confirmToken).toBe('string');
    expect(written.confirmToken.length).toBeGreaterThanOrEqual(32);
  });

  it('emails a link on the public origin, not the Cloud Run host', async () => {
    await request(app)
      .post('/email-scorecard')
      .set('Host', CLOUD_RUN_HOST)
      .send(validScorecard());

    const html = ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;
    expect(html).toContain('https://stockport-badminton.co.uk/populated-scorecard-beta/42?t=');
    expect(html).not.toContain(CLOUD_RUN_HOST);
  });

  it('emails a link carrying the same token it stored', async () => {
    await request(app).post('/email-scorecard').send(validScorecard());

    const token = Fixture.createScorecard.mock.calls[0][0].confirmToken;
    const html = ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;
    expect(html).toContain('/populated-scorecard-beta/42?t=' + token);
  });

  it('redirects the captain to a URL that carries the token, so their own draft opens', async () => {
    const res = await request(app).post('/email-scorecard').send(validScorecard());

    const token = Fixture.createScorecard.mock.calls[0][0].confirmToken;
    expect(res.headers.location).toBe('/populated-scorecard-beta/42?t=' + token);
  });

  // The other end of the same injection: this handler emails req.body['scoresheet-url']
  // as an anchor too. A result must not be lost over it, so the URL is dropped and the
  // draft still saved.
  it('saves the draft but drops an off-bucket scoresheet URL', async () => {
    const res = await request(app)
      .post('/email-scorecard')
      .send(validScorecard({ 'scoresheet-url': 'https://evil.example.com/x.jpg">' }));

    expect(res.status).toBe(302);
    expect(Fixture.createScorecard).toHaveBeenCalledTimes(1);
    expect(Fixture.createScorecard.mock.calls[0][0]['scoresheet-url']).toBe('');
    const html = ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;
    expect(html).not.toContain('evil.example.com');
  });

  it('keeps a scoresheet URL that really is in our bucket', async () => {
    await request(app)
      .post('/email-scorecard')
      .send(validScorecard({ 'scoresheet-url': PHOTO_URL }));

    expect(Fixture.createScorecard.mock.calls[0][0]['scoresheet-url']).toBe(PHOTO_URL);
    const html = ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;
    expect(html).toContain(PHOTO_URL);
  });
});

// ── HARD-03: the photo-upload list has to carry the token ────────────────────

describe('GET /email-scorecard passes each draft token to the page', () => {
  beforeEach(() => {
    Division.getAllByLeague.mockResolvedValue(mockDivisions);
    Auth.getManagementAPIKey.mockResolvedValue('mock-token');
    axios.get.mockResolvedValue({ data: [{ email: 'test@test.com', app_metadata: {} }] });
  });

  it('renders the token alongside the file input, so the POST can prove it', async () => {
    Fixture.getMissingScorecardPhotos.mockResolvedValue([
      { id: 7, homeTeam: 'Mellor A', awayTeam: 'Canute A', confirmToken: 'tok-en-123' }
    ]);

    const res = await request(app).get('/email-scorecard');

    expect(res.status).toBe(200);
    expect(res.text).toContain('tok-en-123');
  });

  it('renders the list for a legacy draft with no token', async () => {
    Fixture.getMissingScorecardPhotos.mockResolvedValue([
      { id: 7, homeTeam: 'Mellor A', awayTeam: 'Canute A', confirmToken: null }
    ]);

    const res = await request(app).get('/email-scorecard');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Mellor A');
  });
});
