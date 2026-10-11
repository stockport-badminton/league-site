// The live scorecard's routes: who can see and change a card, and the sign-off that turns
// it into a draft. controllers/liveScorecardController.js.
//
// models/liveScorecard is replaced by an in-memory fake that keeps the real one's
// SEMANTICS — edits bump `version` and clear both signatures, a signature must name the
// current version, writes need status 'live', filing is claimed once — because those are
// what the controller relies on. The SQL itself is exercised against a real database by
// e2e/live-scorecard.spec.js.

const request = require('supertest');

let mockUser = null;
jest.mock('passport', () => {
  const actual = jest.requireActual('passport');
  actual.session = () => (req, res, next) => {
    if (mockUser) {
      req.user = mockUser;
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }
    next();
  };
  return actual;
});

jest.mock('../../models/fixture');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/division');
jest.mock('../../models/game');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

jest.mock('../../models/liveScorecard', () => {
  const cards = new Map();
  let nextId = 1;
  const clearSigs = c => Object.assign(c, { home_signed_by: null, home_signed_at: null, away_signed_by: null, away_signed_at: null });
  const copy = c => (c ? JSON.parse(JSON.stringify(c)) : null);
  return {
    __reset: () => { cards.clear(); nextId = 1; },
    __get: id => cards.get(id),
    create: jest.fn(async ({ fixtureId, tokens, createdBy, createdEmail }) => {
      for (const c of cards.values()) if (c.fixture_id === fixtureId) return null;
      const card = { id: nextId++, fixture_id: fixtureId, edit_token: tokens.edit, home_token: tokens.home,
        away_token: tokens.away, players: {}, games: {}, version: 1, rev: 1, status: 'live',
        created_by: createdBy, created_email: createdEmail, draft_id: null };
      clearSigs(card);
      cards.set(card.id, card);
      return copy(card);
    }),
    getById: jest.fn(async id => copy(cards.get(id))),
    getByFixture: jest.fn(async fid => copy([...cards.values()].find(c => c.fixture_id === fid))),
    getForFixtures: jest.fn(async ids => [...cards.values()].filter(c => ids.includes(c.fixture_id)).map(copy)),
    getContext: jest.fn(async () => ({ fixtureId: 500, fixtureStatus: 'outstanding', dateText: '2026-10-08 00:00:00',
      dateLabel: 'Thursday 8 October 2026', homeTeamId: 10, homeTeamName: 'Tatton A', awayTeamId: 11,
      awayTeamName: 'Mellor B', divisionId: 7, divisionName: 'Premier' })),
    setPlayer: jest.fn(async (id, slot, playerId) => {
      const c = cards.get(id);
      if (!c || c.status !== 'live') return null;
      if (playerId === null) delete c.players[slot]; else c.players[slot] = playerId;
      c.version++; c.rev++; clearSigs(c);
      return copy(c);
    }),
    setGame: jest.fn(async (id, n, score) => {
      const c = cards.get(id);
      if (!c || c.status !== 'live') return null;
      if (score === null) delete c.games[String(n)]; else c.games[String(n)] = { h: score.h, a: score.a, by: score.by, at: 'now' };
      c.version++; c.rev++; clearSigs(c);
      return copy(c);
    }),
    sign: jest.fn(async (id, side, name, version) => {
      const c = cards.get(id);
      if (!c || c.status !== 'live' || c.version !== version) return null;
      c[side + '_signed_by'] = name; c[side + '_signed_at'] = '2026-10-08T21:00:00Z'; c.rev++;
      return copy(c);
    }),
    claimForFiling: jest.fn(async id => {
      const c = cards.get(id);
      if (!c || c.status !== 'live' || !c.home_signed_at || !c.away_signed_at) return null;
      c.status = 'filing'; c.rev++;
      return copy(c);
    }),
    markFiled: jest.fn(async (id, draftId) => {
      const c = cards.get(id);
      if (!c || c.status !== 'filing') return null;
      c.status = 'filed'; c.draft_id = draftId; c.rev++;
      return copy(c);
    }),
    releaseClaim: jest.fn(async id => { const c = cards.get(id); if (c && c.status === 'filing') c.status = 'live'; }),
  };
});

const LiveScorecard = require('../../models/liveScorecard');
const Fixture = require('../../models/fixture');
const Player = require('../../models/players');
const scorecardController = require('../../controllers/scorecardController');
const live = require('../../utils/liveScorecard');
const app = require('../../app');

const CREATOR = { id: 'auth0|creator', emails: [{ value: 'captain@example.com' }], displayName: 'Cap', _json: {} };
const STRANGER = { id: 'auth0|someone-else', emails: [{ value: 'x@example.com' }], _json: {} };

const MEN = [1, 2, 3, 4].map(i => ({ id: i, first_name: 'Man', family_name: String(i) }));
const LADIES = [11, 12, 13, 14].map(i => ({ id: i, first_name: 'Lady', family_name: String(i) }));

let notify;

beforeEach(() => {
  LiveScorecard.__reset();
  mockUser = CREATOR;
  Fixture.getScorecardCandidates.mockResolvedValue([
    { id: 500, date: new Date(), homeId: 10, homeName: 'Tatton A', awayId: 11, awayName: 'Mellor B', divisionId: 7 },
  ]);
  Fixture.createScorecard.mockResolvedValue([{ id: 9001 }]);
  Fixture.supersedeEarlierDrafts.mockResolvedValue(0);
  Player.findElgiblePlayersFromTeamId.mockImplementation(async (team, gender) => (gender === 'Male' ? MEN : LADIES));
  notify = jest.spyOn(scorecardController, 'sendDraftReceivedEmail').mockResolvedValue(true);
});

afterEach(() => notify.mockRestore());

async function startCard() {
  const res = await request(app).post('/live-scorecard').type('form').send({ fixtureId: '500' });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/live-scorecard/1/share');
  return LiveScorecard.__get(1);
}

async function fillCard(card) {
  const ids = { Man: [1, 2, 3], Lady: [11, 12, 13] };
  for (const slot of live.SLOTS) {
    const m = /(Man|Lady)(\d)$/.exec(slot);
    await request(app).post('/api/live-scorecard/1/players')
      .send({ t: card.edit_token, slot, playerId: ids[m[1]][m[2] - 1] }).expect(200);
  }
  for (let n = 1; n <= 18; n++) {
    await request(app).post('/api/live-scorecard/1/games/' + n)
      .send({ t: card.edit_token, home: n % 2 ? 21 : 17, away: n % 2 ? 15 : 21 }).expect(200);
  }
}

describe('starting a card', () => {
  test('needs a login', async () => {
    mockUser = null;
    const res = await request(app).post('/live-scorecard').type('form').send({ fixtureId: '500' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login/);
    expect(LiveScorecard.create).not.toHaveBeenCalled();
  });

  test('only for a fixture the start page offered', async () => {
    const res = await request(app).post('/live-scorecard').type('form').send({ fixtureId: '999' });
    expect(res.status).toBe(404);
  });

  test('a second person starting the same match is not handed the first card', async () => {
    await startCard();
    mockUser = STRANGER;
    const res = await request(app).post('/live-scorecard').type('form').send({ fixtureId: '500' });
    expect(res.headers.location).toBe('/live-scorecard?taken=500');
  });
});

describe('who can see what', () => {
  test('the share page is the creator\'s alone, and carries the captains\' links', async () => {
    const card = await startCard();
    const mine = await request(app).get('/live-scorecard/1/share');
    expect(mine.status).toBe(200);
    expect(mine.text).toContain(card.home_token);
    expect(mine.text).toContain(card.away_token);
    expect(mine.text).toContain('<svg');

    mockUser = STRANGER;
    const theirs = await request(app).get('/live-scorecard/1/share');
    expect(theirs.status).toBe(404);
    expect(theirs.text).not.toContain(card.home_token);
  });

  test('the card needs its token, and a wrong one is a 404, not a 403', async () => {
    const card = await startCard();
    mockUser = null;
    expect((await request(app).get('/live-scorecard/1')).status).toBe(404);
    expect((await request(app).get('/live-scorecard/1?t=nope')).status).toBe(404);
    const ok = await request(app).get('/live-scorecard/1?t=' + card.edit_token);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('Tatton A');
    expect(ok.text).toContain('noindex');
  });

  test('a player\'s link shows neither captain\'s token; a captain\'s shows only their own', async () => {
    const card = await startCard();
    mockUser = null;
    const player = await request(app).get('/live-scorecard/1?t=' + card.edit_token);
    expect(player.text).not.toContain(card.home_token);
    expect(player.text).not.toContain(card.away_token);

    const home = await request(app).get('/live-scorecard/1?t=' + card.edit_token + '&c=' + card.home_token);
    expect(home.text).toContain('home captain');
    expect(home.text).not.toContain(card.away_token);
  });
});

describe('filling it in', () => {
  test('a bad score is refused with the reason', async () => {
    const card = await startCard();
    const res = await request(app).post('/api/live-scorecard/1/games/3').send({ t: card.edit_token, home: 21, away: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/two-point/);
  });

  test('a half-entered game is refused rather than stored as 21-0', async () => {
    const card = await startCard();
    const res = await request(app).post('/api/live-scorecard/1/games/3').send({ t: card.edit_token, home: 21, away: '' });
    expect(res.status).toBe(400);
    expect(LiveScorecard.setGame).not.toHaveBeenCalled();
  });

  test('only a player the paper form would offer can go in a slot', async () => {
    const card = await startCard();
    const res = await request(app).post('/api/live-scorecard/1/players').send({ t: card.edit_token, slot: 'homeMan1', playerId: 11 });
    expect(res.status).toBe(400);
    const nobody = await request(app).post('/api/live-scorecard/1/players').send({ t: card.edit_token, slot: 'homeMan1', playerId: 0 });
    expect(nobody.status).toBe(200);
  });

  test('writes need the token', async () => {
    await startCard();
    const res = await request(app).post('/api/live-scorecard/1/games/1').send({ t: 'nope', home: 21, away: 3 });
    expect(res.status).toBe(404);
  });
});

describe('polling', () => {
  test('204 while nothing has changed, the state once it has', async () => {
    const card = await startCard();
    const url = '/api/live-scorecard/1/state?t=' + card.edit_token + '&rev=';
    const rev = card.rev;
    const same = await request(app).get(url + rev);
    expect(same.status).toBe(204);
    await request(app).post('/api/live-scorecard/1/games/1').send({ t: card.edit_token, home: 21, away: 3 });
    const changed = await request(app).get(url + rev);
    expect(changed.status).toBe(200);
    expect(changed.body.games['1']).toMatchObject({ h: 21, a: 3 });
    expect(JSON.stringify(changed.body)).not.toContain(card.edit_token);
  });

  test('needs the token too', async () => {
    await startCard();
    expect((await request(app).get('/api/live-scorecard/1/state?t=nope')).status).toBe(404);
  });
});

describe('signing off', () => {
  test('a player\'s link cannot sign', async () => {
    const card = await startCard();
    await fillCard(card);
    const res = await request(app).post('/api/live-scorecard/1/sign').send({ t: card.edit_token, name: 'Me', version: 37 });
    expect(res.status).toBe(403);
  });

  test('an incomplete card cannot be signed', async () => {
    const card = await startCard();
    const res = await request(app).post('/api/live-scorecard/1/sign')
      .send({ t: card.edit_token, c: card.home_token, name: 'Home Cap', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Not ready/);
  });

  test('a signature is for the version on screen; an edit afterwards clears it', async () => {
    const card = await startCard();
    await fillCard(card);
    const v = LiveScorecard.__get(1).version;

    const stale = await request(app).post('/api/live-scorecard/1/sign')
      .send({ c: card.home_token, name: 'Home Cap', version: v - 1 });
    expect(stale.status).toBe(409);

    const signed = await request(app).post('/api/live-scorecard/1/sign')
      .send({ c: card.home_token, name: 'Home Cap', version: v });
    expect(signed.status).toBe(200);
    expect(signed.body.state.signatures.home.by).toBe('Home Cap');

    const edited = await request(app).post('/api/live-scorecard/1/games/4').send({ t: card.edit_token, home: 21, away: 19 });
    expect(edited.body.state.signatures.home).toBeNull();
    expect(Fixture.createScorecard).not.toHaveBeenCalled();
  });

  test('both captains signing files one draft and tells the results secretary', async () => {
    const card = await startCard();
    await fillCard(card);
    const v = LiveScorecard.__get(1).version;

    await request(app).post('/api/live-scorecard/1/sign').send({ c: card.home_token, name: 'Home Cap', version: v }).expect(200);
    expect(Fixture.createScorecard).not.toHaveBeenCalled();
    const done = await request(app).post('/api/live-scorecard/1/sign').send({ c: card.away_token, name: 'Away Cap', version: v });
    expect(done.status).toBe(200);
    expect(done.body.state.filed).toBe(true);

    expect(Fixture.createScorecard).toHaveBeenCalledTimes(1);
    const row = Fixture.createScorecard.mock.calls[0][0];
    expect(row).toMatchObject({ date: '2026-10-08 00:00:00', division: 7, homeTeam: 10, awayTeam: 11,
      homeMan1: 1, awayLady3: 13, FirstMixedhomeMan1: 1, Game1homeScore: 21, Game2awayScore: 21,
      email: 'captain@example.com' });
    expect(typeof row.confirmToken).toBe('string');
    expect(Fixture.supersedeEarlierDrafts).toHaveBeenCalledWith(9001, expect.objectContaining({ homeTeam: 10, awayTeam: 11 }));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ scorecardId: 9001, confirmToken: row.confirmToken });
    expect(notify.mock.calls[0][0].photoLine).toMatch(/Home Cap \(home\) and Away Cap \(away\)/);
    expect(LiveScorecard.__get(1)).toMatchObject({ status: 'filed', draft_id: 9001 });

    // Read-only from here.
    const late = await request(app).post('/api/live-scorecard/1/games/1').send({ t: card.edit_token, home: 21, away: 0 });
    expect(late.status).toBe(409);
  });

  test('if the draft cannot be written, the card goes back to live with its signatures', async () => {
    const card = await startCard();
    await fillCard(card);
    const v = LiveScorecard.__get(1).version;
    Fixture.createScorecard.mockRejectedValueOnce(new Error('db down'));
    await request(app).post('/api/live-scorecard/1/sign').send({ c: card.home_token, name: 'H', version: v }).expect(200);
    const res = await request(app).post('/api/live-scorecard/1/sign').send({ c: card.away_token, name: 'A', version: v });
    expect(res.status).toBe(500);
    expect(LiveScorecard.__get(1).status).toBe('live');
    expect(notify).not.toHaveBeenCalled();
  });
});
