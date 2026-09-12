// Who may publish a league result — HARD-24.
//
// `POST /scorecard-beta` writes the fixture score, inserts 18 `game` rows, fires the
// result zap and emails. It carried a rate limiter and nothing else, while `GET
// /scorecard-beta` was `secured` and `POST /messer-scorecard-beta` was `secured`.
//
// These tests are the ones the package's acceptance criteria name. The gate is
// deliberately NOT `secured`: a session is one of two ways through, and the other has to
// keep working without one.
//
// **On the passport mock.** The route is not `secured`, so mocking `middleware/secured`
// (what every other suite here does) injects nothing — that middleware never runs on this
// path. `req.user` arrives from the global `passport.session()` in app.js, so that is what
// is replaced: "restore the user from the session store" becomes "here is the user", which
// is exactly what a logged-in request looks like to everything downstream. Only `session`
// is swapped; `initialize` and the Auth0 strategy are the real ones.

const request = require('supertest');

let mockCurrentUser = null;
jest.mock('passport', () => {
  const actual = jest.requireActual('passport');
  actual.session = () => (req, res, next) => {
    if (mockCurrentUser) {
      req.user = mockCurrentUser;
      req.isAuthenticated = () => true;
    }
    next();
  };
  return actual;
});

jest.mock('../../models/division');
jest.mock('../../models/teams');
jest.mock('../../models/players');
jest.mock('../../models/fixture');
jest.mock('../../models/game');
jest.mock('../../models/auth.js');
jest.mock('axios');

jest.mock('ejs', () => {
  const actual = jest.requireActual('ejs');
  return { ...actual, renderFile: jest.fn().mockResolvedValue('<html>email</html>') };
});

jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: obj => obj === Object(obj),
  withTransaction: jest.fn(async fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
}));

const Division = require('../../models/division');
const Player = require('../../models/players');
const Fixture = require('../../models/fixture');
const Game = require('../../models/game');
const app = require('../../app');

const SUPERADMIN = {
  id: 'auth0|boss',
  _json: {
    'https://my-app.example.com/role': 'superadmin',
    'https://my-app.example.com/club': 'All',
  },
};

// A logged-in captain is NOT enough. `secured` alone would have admitted this user, which
// is half of why it was the wrong gate: any league member could publish any outstanding
// fixture.
const CAPTAIN = {
  id: 'auth0|captain',
  _json: {
    'https://my-app.example.com/role': 'captain',
    'https://my-app.example.com/club': 'Mellor',
  },
};

const GOOD_TOKEN = 'a'.repeat(64);
const WRONG_TOKEN = 'b'.repeat(64);

function validScorecard(overrides = {}) {
  const games = {};
  for (let i = 1; i <= 18; i++) {
    games[`Game${i}homeScore`] = 21;
    games[`Game${i}awayScore`] = 15;
  }
  return {
    division: '1', homeTeam: '10', awayTeam: '20', date: '2026-01-15',
    homeScore: '18', awayScore: '0',
    homeMan1: '1', homeMan2: '2', homeMan3: '3',
    homeLady1: '4', homeLady2: '5', homeLady3: '6',
    awayMan1: '7', awayMan2: '8', awayMan3: '9',
    awayLady1: '10', awayLady2: '11', awayLady3: '12',
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
    ...games,
    ...overrides,
  };
}

// Every write the publish path makes. A refusal must touch none of them.
function assertNothingWritten() {
  expect(Fixture.updateById).not.toHaveBeenCalled();
  expect(Game.createBatch).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;

  const prevScores = {};
  for (let i = 1; i <= 12; i++) prevScores[String(i)] = { rating: 1500, date: '2026-01-01' };

  Fixture.getFixturesForTeams.mockResolvedValue([
    { id: 99, status: 'outstanding', date: '2026-01-15', rank: 1, name: 'Division 1' },
  ]);
  // Pure — use the real one, so a conflict is decided the way production decides it.
  Fixture.resolveFixtureForResult.mockImplementation(
    jest.requireActual('../../models/fixture').resolveFixtureForResult
  );
  Fixture.updateById.mockResolvedValue({});
  Fixture.getFixtureDetailsById.mockResolvedValue([
    { homeTeam: 'Mellor A', awayTeam: 'Canute A', homeScore: 9, awayScore: 9 },
  ]);
  Fixture.sendResultZap.mockResolvedValue({});
  Fixture.getMatchPlayerOrderDetails.mockResolvedValue([]);
  Fixture.getScorecardById.mockResolvedValue([
    { id: 42, confirmToken: GOOD_TOKEN, email: 'captain@example.com' },
  ]);
  Player.getPrevRating.mockResolvedValue(prevScores);
  Player.getNominatedPlayers.mockResolvedValue([]);
  Player.getMatchStats.mockResolvedValue([]);
  Game.calculateRating.mockReturnValue({
    updateObj: {
      homePlayer1Start: 1500, homePlayer2Start: 1500,
      awayPlayer1Start: 1500, awayPlayer2Start: 1500,
      homePlayer1End: 1510, homePlayer2End: 1510,
      awayPlayer1End: 1490, awayPlayer2End: 1490,
    },
  });
  Game.createBatch.mockResolvedValue({});
  Division.getAllByLeague.mockResolvedValue([{ id: 1, name: 'Division 1' }]);
});

describe('POST /scorecard-beta — publish authority (HARD-24)', () => {
  it('refuses an anonymous publish, and writes nothing', async () => {
    const res = await request(app).post('/scorecard-beta').send(validScorecard());

    expect(res.status).toBe(403);
    assertNothingWritten();
  });

  it('refuses a logged-in captain — `secured` alone would have let this through', async () => {
    mockCurrentUser = CAPTAIN;

    const res = await request(app).post('/scorecard-beta').send(validScorecard());

    expect(res.status).toBe(403);
    assertNothingWritten();
  });

  it('lets a superadmin session publish, as it does today', async () => {
    mockCurrentUser = SUPERADMIN;

    const res = await request(app).post('/scorecard-beta').send(validScorecard());

    expect(res.status).toBe(200);
    expect(Fixture.updateById).toHaveBeenCalled();
  });

  it('lets a valid draft token publish without any session', async () => {
    const res = await request(app)
      .post('/scorecard-beta')
      .send(validScorecard({ draftId: '42', t: GOOD_TOKEN }));

    expect(res.status).toBe(200);
    expect(Fixture.updateById).toHaveBeenCalled();
  });

  it('refuses a wrong token, and writes nothing', async () => {
    const res = await request(app)
      .post('/scorecard-beta')
      .send(validScorecard({ draftId: '42', t: WRONG_TOKEN }));

    expect(res.status).toBe(403);
    assertNothingWritten();
  });

  it('refuses a draft id with no token at all', async () => {
    const res = await request(app)
      .post('/scorecard-beta')
      .send(validScorecard({ draftId: '42' }));

    expect(res.status).toBe(403);
    assertNothingWritten();
  });

  it('refuses a draft id that does not exist', async () => {
    Fixture.getScorecardById.mockResolvedValue([]);

    const res = await request(app)
      .post('/scorecard-beta')
      .send(validScorecard({ draftId: '999999', t: GOOD_TOKEN }));

    expect(res.status).toBe(403);
    assertNothingWritten();
  });

  // The trap this package nearly walked into. `mayOpenDraft` grandfathers a tokenless
  // draft OPEN, because links filed before migration 011 are already in captains' inboxes
  // (HARD-03). At the time of writing 1,557 of 1,562 drafts are tokenless, so a publish
  // gate built on `mayOpenDraft` would have admitted anonymous publishes for 99.7% of
  // them — while looking, in review and in a passing test, exactly like a fix.
  //
  // Reading an old draft stays grandfathered. Publishing one does not.
  it('refuses a TOKENLESS draft even though the same draft may still be READ', async () => {
    Fixture.getScorecardById.mockResolvedValue([
      { id: 7, confirmToken: null, email: 'captain@example.com' },
    ]);

    const res = await request(app)
      .post('/scorecard-beta')
      .send(validScorecard({ draftId: '7', t: '' }));

    expect(res.status).toBe(403);
    assertNothingWritten();

    // ...and the same row still opens for reading, which is the behaviour HARD-03
    // promised to keep. If this ever starts failing, the grandfather clause has been
    // removed and old confirmation links have stopped working.
    const { mayOpenDraft, mayPublishDraft } = require('../../utils/scorecardLinks');
    expect(mayOpenDraft(null, '')).toBe(true);
    expect(mayPublishDraft(null, '')).toBe(false);
  });

  it('refuses a token belonging to a DIFFERENT draft', async () => {
    // The caller holds a good token for draft 42 but names draft 43, whose token differs.
    Fixture.getScorecardById.mockImplementation(id =>
      Promise.resolve(String(id) === '43'
        ? [{ id: 43, confirmToken: WRONG_TOKEN, email: 'other@example.com' }]
        : [{ id: 42, confirmToken: GOOD_TOKEN, email: 'captain@example.com' }])
    );

    const res = await request(app)
      .post('/scorecard-beta')
      .send(validScorecard({ draftId: '43', t: GOOD_TOKEN }));

    expect(res.status).toBe(403);
    assertNothingWritten();
  });
});

describe('the "website updated" recipient is derived server-side (HARD-24)', () => {
  const mailer = require('../../utils/mailer');

  it('ignores a body-supplied address and uses the stored draft address', async () => {
    const spy = jest.spyOn(mailer, 'send').mockResolvedValue({});

    await request(app)
      .post('/scorecard-beta')
      .send(validScorecard({ draftId: '42', t: GOOD_TOKEN, email: 'attacker@evil.example' }));

    expect(spy).toHaveBeenCalled();
    const sent = spy.mock.calls.find(c => c[0] && c[0].template === 'website-updated');
    expect(sent).toBeDefined();
    expect(sent[0].to).toEqual(['captain@example.com']);
    expect(JSON.stringify(sent[0].to)).not.toMatch(/attacker@evil\.example/);

    spy.mockRestore();
  });

  it('falls back to the results mailbox when the draft stored no usable address', async () => {
    Fixture.getScorecardById.mockResolvedValue([
      { id: 42, confirmToken: GOOD_TOKEN, email: '' },
    ]);
    const spy = jest.spyOn(mailer, 'send').mockResolvedValue({});

    await request(app)
      .post('/scorecard-beta')
      .send(validScorecard({ draftId: '42', t: GOOD_TOKEN, email: 'attacker@evil.example' }));

    const sent = spy.mock.calls.find(c => c[0] && c[0].template === 'website-updated');
    expect(sent[0].to).toEqual([mailer.RESULTS_MAILBOX]);

    spy.mockRestore();
  });
});
