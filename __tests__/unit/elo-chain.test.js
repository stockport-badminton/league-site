// utils/eloChain re-rates forward from a result published out of date order (21 Oct
// 2026). Before it, the publish path rated the late fixture and stopped, so every later
// game of its players stayed rated as if it had not been played until a full backfill.
//
// The property that matters is that a targeted walk gives EXACTLY what a full recompute
// gives — not "close", because a backfill later would then quietly move everyone. So a
// synthetic season is rated from scratch with the same per-game code the backfill uses,
// then each fixture in turn is withheld, the rest rated without it, and the walk is run
// from it once it arrives. Every game row must then match the from-scratch answer.
//
// The database is a fake holding game rows in memory; Game.calculateRating is real.

jest.mock('../../db_connect.js', () => ({
  withTransaction: jest.fn(),
  otherConnect: jest.fn(),
  isObject: o => o === Object(o),
}));
jest.mock('../../models/fixture', () => ({ getFixtureDetails: jest.fn() }));
jest.mock('../../models/players', () => ({
  getSeasonRanks: jest.fn(),
  getRatingStateBefore: jest.fn(),
  refreshRatings: jest.fn(),
}));

const db = require('../../db_connect.js');
const Fixture = require('../../models/fixture');
const Player = require('../../models/players');
const Game = require('../../models/game');
const { rerateFrom, rateFixtureGames, MAX_CHAIN_FIXTURES } = require('../../utils/eloChain');

const COLS = ['homePlayer1Start', 'homePlayer2Start', 'awayPlayer1Start', 'awayPlayer2Start',
  'homePlayer1End', 'homePlayer2End', 'awayPlayer1End', 'awayPlayer2End'];
const SLOTS = [['homePlayer1', 'homePlayer1End'], ['homePlayer2', 'homePlayer2End'],
  ['awayPlayer1', 'awayPlayer1End'], ['awayPlayer2', 'awayPlayer2End']];

// Deterministic, so a failure reproduces.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Eight teams of six, a fixture a team a week, an occasional reserve from another team,
// and some players new enough that the provisional K applies — which is the half the
// publish path used to get wrong.
function makeSeason(seed, weeks = 10) {
  const r = rng(seed);
  const teams = Array.from({ length: 8 }, (_, t) => Array.from({ length: 6 }, (_, i) => t * 6 + i + 1));
  const fixtures = [];
  const games = [];
  let gid = 1;
  for (let w = 0; w < weeks; w++) {
    const order = [...teams.keys()].sort(() => r() - 0.5);
    for (let m = 0; m < 4; m++) {
      const fid = 100 + fixtures.length;
      // Two fixtures share each night, so the id tie-break is exercised.
      fixtures.push({ id: fid, date: new Date(Date.UTC(2026, 8, 1 + w * 7 + (m >> 1))), rank: 1 });
      const side = t => {
        const p = [...teams[t]];
        if (r() < 0.25) p[Math.floor(r() * 6)] = teams[(t + 1) % 8][Math.floor(r() * 6)];
        return p;
      };
      const h = side(order[2 * m]);
      const a = side(order[2 * m + 1]);
      for (let g = 0; g < 6; g++) {
        const win = r() < 0.5;
        games.push({
          id: gid++, fixture: fid,
          homePlayer1: h[g % 6], homePlayer2: h[(g + 1) % 6],
          awayPlayer1: a[g % 6], awayPlayer2: a[(g + 2) % 6],
          homeScore: win ? 21 : Math.floor(r() * 20), awayScore: win ? Math.floor(r() * 20) : 21,
          ...Object.fromEntries(COLS.map(c => [c, 0])),
        });
      }
    }
  }
  return { fixtures, games };
}

// What a backfill produces: every fixture in order, state carried in memory.
function rateFromScratch(fixtures, games, skip = null) {
  const rows = games.map(g => ({ ...g }));
  const state = {};
  for (const f of fixtures) {
    const fg = rows.filter(g => g.fixture === f.id);
    if (f.id === skip) { fg.forEach(g => COLS.forEach(c => { g[c] = 0 })); continue }
    const fp = {};
    for (const g of fg) for (const [s] of SLOTS) fp[g[s]] = state[g[s]] || { rating: 1500, date: null, gamesCount: 0 };
    for (const p of Object.keys(fp)) fp[p] = { ...fp[p], rank: f.rank };
    for (const out of rateFixtureGames(fg, fp, f)) Object.assign(fg.find(g => g.id === out.id), out);
    for (const p of Object.keys(fp)) state[p] = fp[p];
  }
  return rows;
}

// The fake database, answering the queries eloChain makes from `rows`.
function serve(fixtures, rows) {
  const pos = Object.fromEntries(fixtures.map((f, i) => [f.id, i]));
  Fixture.getFixtureDetails.mockResolvedValue([...fixtures, { id: 99999 }]);
  Player.getSeasonRanks.mockResolvedValue({});
  Player.refreshRatings.mockResolvedValue();
  Player.getRatingStateBefore.mockImplementation(async (fixtureId, pids) => {
    const out = {};
    for (const g of rows) {
      if (pos[g.fixture] >= pos[fixtureId]) continue;
      SLOTS.forEach(([s, e], slot) => {
        if (!pids.includes(g[s]) || !(g[e] > 0)) return;
        const o = out[g[s]] || (out[g[s]] = { rating: 0, date: null, gamesCount: 0, at: -1 });
        o.gamesCount++;
        // Same order as the SQL: fixture, game, then slot — so a player in two slots of
        // one game (the generator's reserves can do that) resolves as the backfill does.
        const at = pos[g.fixture] * 1e6 + g.id * 10 + slot;
        if (at > o.at) Object.assign(o, { rating: g[e], at });
      });
    }
    return out;
  });
  const writes = [];
  jest.spyOn(Game, 'updateEloBatch').mockImplementation(async w => { writes.push(...w) });
  db.withTransaction.mockImplementation(async fn => fn({
    query: async (sql, params) => {
      if (/^SELECT \* FROM game/.test(sql)) return [rows.filter(g => params[0].includes(g.fixture)).map(g => ({ ...g }))];
      return [[]];
    },
  }));
  return writes;
}

const apply = (rows, writes) => { for (const w of writes) Object.assign(rows.find(g => g.id === w.id), w) };
const eloOf = rows => rows.map(g => [g.id, ...COLS.map(c => g[c])]);

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('eloChain.rerateFrom', () => {
  const { fixtures, games } = makeSeason(7);
  const truth = rateFromScratch(fixtures, games);

  it('a late result, once re-rated forward, gives exactly what a full recompute gives — whichever fixture was late', async () => {
    let reachedFewerThanAll = 0;
    for (const late of fixtures) {
      const rows = rateFromScratch(fixtures, games, late.id);
      const writes = serve(fixtures, rows);
      const result = await rerateFrom(late.id);
      apply(rows, writes);
      expect(eloOf(rows)).toEqual(eloOf(truth));
      if (result.fixtures < fixtures.length - fixtures.indexOf(late)) reachedFewerThanAll++;
    }
    // And it is targeted: it is not just re-rating the rest of the season every time.
    expect(reachedFewerThanAll).toBeGreaterThan(fixtures.length / 2);
  });

  it('the scenario is real: without the walk, games after the late result are wrong', () => {
    const late = fixtures[5];
    const rows = rateFromScratch(fixtures, games, late.id);
    const after = new Set(fixtures.slice(6).map(f => f.id));
    const wrong = rows.filter(g => after.has(g.fixture) && COLS.some(c => g[c] !== truth.find(t => t.id === g.id)[c]));
    expect(wrong.length).toBeGreaterThan(0);
  });

  it('a result published in order re-rates only itself', async () => {
    const rows = truth.map(g => ({ ...g }));
    const last = fixtures[fixtures.length - 1];
    const writes = serve(fixtures, rows);
    const result = await rerateFrom(last.id);
    expect(result.fixtures).toBe(1);
    expect(writes).toEqual([]);
  });

  it('corrects the provisional K the publish path could not see', async () => {
    // Rate everything, then stamp one fixture's games as the publish path did: K=32 for
    // everybody, because getPrevRating carries no games-played count.
    const late = fixtures[3];
    const rows = truth.map(g => ({ ...g }));
    const fg = rows.filter(g => g.fixture === late.id);
    const fp = {};
    for (const g of fg) for (const [s] of SLOTS) fp[g[s]] = { rating: 1500, date: null, rank: 1 };
    for (const out of rateFixtureGames(fg, fp, late)) Object.assign(fg.find(g => g.id === out.id), out);
    expect(eloOf(rows)).not.toEqual(eloOf(truth));

    const writes = serve(fixtures, rows);
    await rerateFrom(late.id);
    apply(rows, writes);
    expect(eloOf(rows)).toEqual(eloOf(truth));
  });

  it('refuses a chain longer than the cap and writes nothing', async () => {
    const long = makeSeason(11, Math.ceil((MAX_CHAIN_FIXTURES + 8) / 4) + 2);
    const rows = rateFromScratch(long.fixtures, long.games, long.fixtures[0].id);
    const writes = serve(long.fixtures, rows);
    await expect(rerateFrom(long.fixtures[0].id)).rejects.toThrow(/run a full backfill/);
    expect(writes).toEqual([]);
    expect(Player.refreshRatings).not.toHaveBeenCalled();
  });

  it('does nothing for a fixture that is not a complete fixture this season', async () => {
    const rows = truth.map(g => ({ ...g }));
    const writes = serve(fixtures, rows);
    const result = await rerateFrom(1);
    expect(result.skipped).toMatch(/not a complete fixture/);
    expect(writes).toEqual([]);
  });

  it('takes the lock before it reads anything', async () => {
    const rows = truth.map(g => ({ ...g }));
    serve(fixtures, rows);
    const seen = [];
    db.withTransaction.mockImplementation(async fn => fn({
      query: async (sql, params) => {
        seen.push(sql);
        if (/^SELECT \* FROM game/.test(sql)) return [rows.filter(g => params[0].includes(g.fixture))];
        return [[]];
      },
    }));
    await rerateFrom(fixtures[0].id);
    expect(seen[0]).toMatch(/pg_advisory_xact_lock/);
    expect(Fixture.getFixtureDetails.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });
});
