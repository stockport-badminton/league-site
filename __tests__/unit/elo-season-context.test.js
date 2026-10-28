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
const Player = require('../../models/players');
const seasonModel = require('../../models/season');

beforeEach(() => {
  db.__state.log = [];
  db.__state.respond = () => [];
});

// Which season's tables the fixture list and the season ranks read is tested against a
// real Postgres, in __tests__/db/season-history-readers.test.js: both read the season
// history views since REARCH-02, and getSeasonRanks is on the typed query layer.

describe('Player.getSeasonRanks', () => {
  it('refuses a malformed season before it reaches the database', async () => {
    await expect(Player.getSeasonRanks('2021 AS x --')).rejects.toThrow(/invalid season/);
    expect(db.__state.log).toHaveLength(0);
  });
});

describe('Player.getPrevRating', () => {
  // The season ranks come from getSeasonRanks, tested against a real database; here it
  // is stubbed, so these tests are about what getPrevRating does with its answer.
  function respondWith({ ratings = [], ranks = [] }) {
    db.__state.respond = () => ratings;
    jest.spyOn(Player, 'getSeasonRanks')
      .mockResolvedValue(Object.fromEntries(ranks.map(r => [r.id, r.rank])));
  }
  afterEach(() => jest.restoreAllMocks());

  it('takes rank from the season being replayed, not the player\'s current team', async () => {
    respondWith({
      ratings: [{ playerId: 409, rating: 1200, date: '2021-11-01' }],
      ranks: [{ id: 409, rank: 4 }],
    });
    const out = await Player.getPrevRating('2022-01-01', { 409: {} }, { season: '20212022', fallbackRank: 2 });
    expect(out[409]).toEqual({ rating: 1200, date: '2021-11-01', rank: 4 });
    expect(Player.getSeasonRanks).toHaveBeenCalledWith('20212022', [409]);
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
