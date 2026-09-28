// Two things about ELO that no model test can see, because they live in the controller
// loop and the template:
//
//   - The backfill carries each player's rating from season to season in memory
//     (knownRatings). It carried their division RANK the same way, loaded once at their
//     first appearance, so a player first seen in Division 4 in 2018 was still treated
//     as Division 4 in 2024 — and everyone who first appeared after they moved was
//     treated as being in today's division all the way back. Rank must be re-read for
//     every season.
//   - /playerStats/:id showed an unrated game (a void fixture, or one the backfill never
//     reached) as a rating of 0, which read as the player having collapsed to zero.

const request = require('supertest');

jest.mock('../../models/players');
jest.mock('../../models/fixture');
jest.mock('../../models/game');

const Player = require('../../models/players');
const Fixture = require('../../models/fixture');
const Game = require('../../models/game');
const seasonModel = require('../../models/season');
const playerController = require('../../controllers/playerController');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('eloBackfillAll re-reads every player\'s division rank each season', () => {
  // One player (5) who plays one fixture per season: Division 3 (rank 4) in the first
  // season, Premier (rank 1) in the second.
  const SEASONS = [{ name: '20212022' }, { name: '20222023' }];
  const RANKS = { '20212022': { 5: 4, 6: 4, 7: 4, 8: 4 }, '20222023': { 5: 1, 6: 4, 7: 4, 8: 4 } };

  let seen = [];

  function fixtureFor(id) {
    return {
      id, date: `2022-0${id}-01`, rank: 4,
      homeMan1: 5, homeMan2: 6, awayMan1: 7, awayMan2: 8,
    };
  }

  async function runBackfill() {
    Fixture.getAllSeasons.mockResolvedValue(SEASONS);
    Fixture.getFixtureDetails.mockImplementation(async ({ season }) =>
      [fixtureFor(season === '20212022' ? 1 : 2)]);
    Game.resetAllElo.mockResolvedValue();
    Game.resetSeasonElo.mockResolvedValue();
    Game.getByFixture.mockImplementation(async fixtureId => [{
      id: fixtureId * 100, fixture: fixtureId,
      homePlayer1: 5, homePlayer2: 6, awayPlayer1: 7, awayPlayer2: 8,
      homeScore: 21, awayScore: 15,
    }]);
    Game.updateById.mockResolvedValue();
    // Snapshot what each call was given: the loop mutates fixturePlayers straight after.
    const realCalc = jest.requireActual('../../models/game').calculateRating;
    seen = [];
    Game.calculateRating.mockImplementation((game, players, ...rest) => {
      seen.push(JSON.parse(JSON.stringify(players)));
      return realCalc(game, players, ...rest);
    });
    Player.getSeasonRanks.mockImplementation(async season => RANKS[season] || {});
    // What the old getPrevRating did: rank from the player's current team, whatever
    // the season. The fix must not depend on getPrevRating getting this right.
    Player.getPrevRating.mockImplementation(async (date, players) => {
      for (const p of Object.values(players)) Object.assign(p, { rating: 1500, date, rank: 1 });
      return players;
    });
    Player.updateBulk.mockResolvedValue();

    const out = [];
    const req = { user: { _json: { 'https://my-app.example.com/role': 'superadmin' } }, query: {} };
    const res = { setHeader() {}, write: s => out.push(s), end() {}, status() { return this; }, send() {} };
    // Neither test season may be treated as "current" (that branch passes undefined).
    expect(SEASONS.map(s => s.name)).not.toContain(seasonModel.current());
    await playerController.player_elo_backfill_all(req, res);
    return out.join('');
  }

  it('passes each season\'s own rank into the rating calculation', async () => {
    const log = await runBackfill();
    expect(log).not.toMatch(/skipped \(/);
    expect(seen).toHaveLength(2);
    const [firstPlayers, secondPlayers] = seen;
    expect(firstPlayers[5].rank).toBe(4);
    // Carried over from the first season, but re-registered in Premier for the second.
    expect(secondPlayers[5].rank).toBe(1);
    // Rating did carry over — the carryover itself is not what was wrong.
    expect(secondPlayers[5].rating).not.toBe(1500);
  });

  it('asks for the ranks of the season being replayed', async () => {
    await runBackfill();
    expect(Player.getSeasonRanks.mock.calls.map(c => c[0])).toEqual(['20212022', '20222023']);
  });
});

describe('GET /playerStats/:id/:fullName', () => {
  const row = (over) => ({
    id: 1, date: '2022-10-10', teamName: 'Manor B', teamAdjustment: null,
    partnerName: 'A Partner', oppName1: 'Opp One', oppName2: 'Opp Two',
    score: 21, vsScore: 15, gameType: 'Ladies', ...over,
  });

  it('shows an unrated game as a dash, not as a rating of 0', async () => {
    Player.getPlayerGameData.mockResolvedValue([
      row({ id: 2, beforeVal: 1014, after: 1022, adjustment: 8 }),
      row({ id: 1, beforeVal: 0, after: 0, adjustment: 0 }),
    ]);
    const res = await request(app).get('/playerStats/409/Claire%20Inglis');
    expect(res.status).toBe(200);
    const cells = [...res.text.matchAll(/<td>([^<]*)<\/td>/g)].map(m => m[1].trim());
    expect(cells).toEqual(expect.arrayContaining(['1014', '1022', '8']));
    expect(cells.filter(c => c === '–')).toHaveLength(3);
    expect(cells).not.toContain('0');
  });
});

// /players/eloPop rewrites ELO values and had no gate at all: no `secured` on the route
// and no check in the handler. It answered anybody.
describe('GET /players/eloPop', () => {
  it('refuses a visitor who is not a superadmin, without touching anything', async () => {
    const res = await request(app).get('/players/eloPop');
    expect(res.status).toBe(403);
    expect(Fixture.getFixtureDetails).not.toHaveBeenCalled();
    expect(Game.updateById).not.toHaveBeenCalled();
  });
});
