// Every caller-supplied value must reach Postgres as a PARAMETER — never as text inside
// the statement. HARD-27: `getEmails` pasted DB_PI_KEY in as a string literal five times,
// with `console.log(sql)` on the line above, so the key reached Cloud Logging on every
// distribution-list send; `getById` and `updateBulk` had the same defect.
//
// Those three, and `search`, are on the typed query layer now (REARCH-01), where it holds
// by construction: db/encrypted.js's encrypt() and decrypt() can only bind the key, and the
// builder binds every value. That is tested in __tests__/db/kysely.test.js and, per
// function, in __tests__/db/players-writes.test.js and players-search.test.js.
//
// What is left here is newGetPairStats, which is still a string query until REARCH-02
// rewrites it, and so is still checked by reading the statement it sends.

const mockQuery = jest.fn().mockResolvedValue([[]]);
jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  isObject: o => o !== null && typeof o === 'object',
  otherConnect: jest.fn(() => Promise.resolve({ query: mockQuery })),
}));

const Player = require('../../models/players');
const KEY = process.env.DB_PI_KEY;

const lastCall = () => {
  const [sql, params] = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
  return { sql, params: params === undefined ? [] : (Array.isArray(params) ? params : [params]) };
};
const placeholders = sql => (sql.match(/\?/g) || []).length;

beforeEach(() => mockQuery.mockClear());

describe('newGetPairStats binds its filters', () => {
  it('cannot have its statement altered by any filter in the URL', async () => {
    const hostile = "x' UNION SELECT sess::text FROM session /*";
    await Player.newGetPairStats({ team: hostile, club: hostile, gameType: hostile, division: '7 OR 1=1' });
    const { sql, params } = lastCall();
    expect(sql).not.toContain('UNION SELECT sess');
    expect(sql).not.toContain('1=1');
    expect(params).toEqual(expect.arrayContaining([hostile, '7 OR 1=1']));
    expect(placeholders(sql)).toBe(params.length);
  });

  it('keeps placeholders and parameters in step for every combination', async () => {
    const filters = [
      {}, { division: '8' }, { team: 'Mellor A' }, { club: 'Remnants' }, { gameType: 'Mixed' },
      { division: '9', team: 'Tatton A', club: 'Tatton', gameType: 'Mens' },
      { season: '20242025', club: 'Canute' },
    ];
    for (const f of filters) {
      mockQuery.mockClear();
      await Player.newGetPairStats(f);
      const { sql, params } = lastCall();
      expect(placeholders(sql)).toBe(params.length);
    }
  });

  it('matches everything when a filter is absent, as before', async () => {
    await Player.newGetPairStats({});
    const { params } = lastCall();
    // season, then team / club / gameType each defaulting to the LIKE wildcard.
    expect(params.slice(1)).toEqual(['%', '%', '%']);
  });
});

// Its club join ignored the season: player<season>.club ids were matched against the
// LIVE club table, so an archived season showed today's club names. Club 47 was Canute
// in 2024/25 and is Remnants now, so that season's pair stats labelled Canute's pairs
// "Remnants" and /pair-stats/20242025/club-Canute was empty while player stats for the
// same URL was not. A folded club's pairs would vanish outright. The archives are
// snapshotted together, so the ids line up.
describe('newGetPairStats reads clubs from the season it is showing', () => {
  it('joins the archived club table for an archived season', async () => {
    await Player.newGetPairStats({ season: '20242025' });
    const { sql } = lastCall();
    expect(sql).toMatch(/JOIN club20242025 club ON club\.id = Player1\.club/);
  });

  it('joins the live club table for the current season', async () => {
    await Player.newGetPairStats({});
    const { sql } = lastCall();
    expect(sql).toMatch(/JOIN club club ON club\.id = Player1\.club/);
  });
});
