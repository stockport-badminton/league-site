// The ELO backfill replays every season since 2018/19, and two of its inputs were read
// from the LIVE tables rather than the season being replayed. Both failed silently —
// the backfill ran to completion, printed counts, and produced plausible numbers:
//
//   - The fixture list inner-joined the live `division` table. It has no Division 4
//     (id 11), so every Division 4 fixture of 2018/19 and 2019/20 simply was not in the
//     list — about 2,500 games never rated, and the players in them started 2021/22 as
//     if new.
//   - A player's division rank, which drives the reserving adjustment, came from their
//     CURRENT team. In 2021/22, 268 of the 387 players who played are registered in a
//     different division today.
//
// And the live publish path read a player's previous rating by taking their latest game
// FIRST and discarding it if unrated SECOND, so a void fixture or walkover in someone's
// recent history reset them to 1500.
//
// The db layer is faked to capture SQL and hand back canned rows; these tests are about
// which tables the queries read and what the model does with the answer.

jest.mock('../../db_connect.js', () => {
  const state = { log: [], respond: () => [] };
  return {
    __state: state,
    isObject: o => o === Object(o),
    otherConnect: async () => ({
      query: jest.fn(async (sql, params) => {
        const flat = sql.replace(/\s+/g, ' ').trim();
        state.log.push({ sql: flat, params });
        const rows = state.respond(flat, params) || [];
        rows.affectedRows = rows.length;
        return [rows];
      }),
    }),
  };
});

const db = require('../../db_connect.js');
const Fixture = require('../../models/fixture');
const Player = require('../../models/players');
const seasonModel = require('../../models/season');

beforeEach(() => {
  db.__state.log = [];
  db.__state.respond = () => [];
});

describe('fixture lists for an archived season join that season\'s division table', () => {
  it('getFixtureDetails reads division20182019, not the live division table', async () => {
    await Fixture.getFixtureDetails({ status: 'complete', season: '20182019' });
    const { sql } = db.__state.log[0];
    expect(sql).toMatch(/JOIN division20182019 division ON homeTeam\.division = division\.id/);
    expect(sql).not.toMatch(/JOIN division ON/);
  });

  it('getFixtureDetails for the current season still reads the live tables', async () => {
    await Fixture.getFixtureDetails({ status: 'complete' });
    expect(db.__state.log[0].sql).toMatch(/JOIN division division ON homeTeam\.division/);
  });

  it('getClubFixtureDetails reads the archived division table too', async () => {
    await Fixture.getClubFixtureDetails({ season: '20182019' });
    const { sql } = db.__state.log[0];
    expect(sql).toMatch(/JOIN division20182019 AS division ON division\.id = d\.division/);
  });
});

describe('Player.getSeasonRanks', () => {
  it('reads the season archive tables for a past season', async () => {
    db.__state.respond = sql => {
      if (sql.startsWith('SELECT to_regclass')) return [{ t: 'player20212022' }];
      return [{ id: 409, rank: 4 }];
    };
    const ranks = await Player.getSeasonRanks('20212022', [409]);
    expect(ranks).toEqual({ 409: 4 });
    const q = db.__state.log[1].sql;
    expect(q).toMatch(/FROM player20212022 p JOIN team20212022 t ON t\.id = p\.team JOIN division20212022 d/);
  });

  it('returns nothing, rather than throwing, for a season with no player archive', async () => {
    db.__state.respond = sql => (sql.startsWith('SELECT to_regclass') ? [{ t: null }] : [{ id: 1, rank: 1 }]);
    expect(await Player.getSeasonRanks('20172018')).toEqual({});
    expect(db.__state.log).toHaveLength(1);
  });

  it('refuses a malformed season before it reaches a table name', async () => {
    await expect(Player.getSeasonRanks('2021 AS x --')).rejects.toThrow(/invalid season/);
    expect(db.__state.log).toHaveLength(0);
  });
});

describe('Player.getPrevRating', () => {
  function respondWith({ ratings = [], ranks = [] }) {
    db.__state.respond = sql => {
      if (sql.startsWith('SELECT to_regclass')) return [{ t: 'exists' }];
      if (sql.includes('JOIN division')) return ranks;
      return ratings;
    };
  }

  it('takes rank from the season being replayed, not the player\'s current team', async () => {
    respondWith({
      ratings: [{ playerId: 409, rating: 1200, date: '2021-11-01' }],
      ranks: [{ id: 409, rank: 4 }],
    });
    const out = await Player.getPrevRating('2022-01-01', { 409: {} }, { season: '20212022', fallbackRank: 2 });
    expect(out[409]).toEqual({ rating: 1200, date: '2021-11-01', rank: 4 });
    expect(db.__state.log.some(l => l.sql.includes('FROM player20212022 p'))).toBe(true);
    // The rating lookup itself must not depend on the player having a team at all —
    // it used to inner-join player -> team -> division, so a player with no current
    // team lost their whole history and restarted at 1500.
    const ratingSql = db.__state.log.find(l => l.sql.includes('FROM game g')).sql;
    expect(ratingSql).not.toMatch(/JOIN team/);
  });

  it('uses the fixture\'s rank for a player with no team that season (no adjustment), not Premier', async () => {
    respondWith({ ratings: [], ranks: [] });
    const out = await Player.getPrevRating('2022-01-01', { 77: {} }, { season: '20212022', fallbackRank: 3 });
    expect(out[77]).toMatchObject({ rating: 1500, rank: 3 });
  });

  it('skips an unrated game rather than letting it reset the player to 1500', async () => {
    respondWith({ ratings: [] });
    await Player.getPrevRating('2022-01-01', { 409: {} }, { season: '20212022', fallbackRank: 4 });
    const ratingSql = db.__state.log.find(l => l.sql.includes('FROM game g')).sql;
    // The `rating > 0` filter must sit BEFORE the ORDER BY ... LIMIT 1 picks the latest,
    // in the same query block. Filtering outside it is what reset players to 1500.
    expect(ratingSql).toMatch(/\) a WHERE rating > 0 ORDER BY date DESC, gid DESC LIMIT 1\)/);
    expect(ratingSql).toMatch(/f\.status = 'complete'/);
  });

  it('sends no rating query for a fixture with only placeholder players', async () => {
    const out = await Player.getPrevRating('2022-01-01', { 0: {} }, { fallbackRank: 2 });
    expect(out[0]).toMatchObject({ rating: 1500, rank: 2 });
    expect(db.__state.log.filter(l => l.sql.includes('FROM game g'))).toHaveLength(0);
  });
});

describe('Player.refreshRatings', () => {
  it('reads each player\'s latest rated game back from `game`, keeping the old value if none', async () => {
    await Player.refreshRatings(['1', '2', '0', 'undefined']);
    expect(db.__state.log).toHaveLength(1);
    const { sql, params } = db.__state.log[0];
    expect(sql).toMatch(/^UPDATE player SET rating = COALESCE\(\(/);
    expect(sql).toMatch(/ORDER BY f\.date DESC, g\.id DESC LIMIT 1 \), rating\)/);
    expect(params).toEqual([[1, 2]]);
  });

  it('does nothing when there is nobody to refresh', async () => {
    await Player.refreshRatings(['0']);
    expect(db.__state.log).toHaveLength(0);
  });
});

// Keeps the fake honest: current() must not be one of the archive seasons used above,
// or "current season reads live tables" would be testing the wrong branch.
it('the current season is not one of the archived seasons these tests use', () => {
  expect(['20182019', '20212022', '20172018']).not.toContain(seasonModel.current());
});
