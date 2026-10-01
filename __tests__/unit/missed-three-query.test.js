// /missed-three listed every nominated player at the start of the season. `fixture`
// holds every season back to 2012 and the query took each team's last three
// completed matches with no season bound, so a team yet to play was judged on last
// April's results. The No Club holding pen also passed the "not the club's lowest
// team" filter, which put 28 released players on the list.
//
// This asserts the SQL rather than its rows, because the unit suite has no database.
// The rows were checked against production when this was written: 37 before, all
// false positives; 0 after, which is right while only single-team clubs (and
// Featherforce, whose two teams share team.rank 1) have played three matches.

const mockQuery = jest.fn(() => Promise.resolve([[]]));
jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({ query: mockQuery })),
}));
jest.mock('../../models/season', () => ({
  current: () => '20262027',
  assertName: n => n,
  isValidName: () => true,
}));

const Player = require('../../models/players');
const Roster = require('../../models/roster');

async function run() {
  mockQuery.mockClear();
  await Player.getMissedThreePlayers();
  const [sql, params] = mockQuery.mock.calls[0];
  return { sql: sql.replace(/\s+/g, ' '), params };
}

describe('getMissedThreePlayers', () => {
  it('only counts fixtures inside the current season', async () => {
    const { sql, params } = await run();
    expect(params[0]).toBe('20262027');
    expect(sql).toMatch(/FROM season WHERE name = \?/);
    // Both halves of the home/away union must be bounded, not just one.
    expect(sql.match(/JOIN season_window w ON f\.date >= w\."startDate" AND f\.date <= w\."endDate"/g)).toHaveLength(2);
  });

  it('leaves out a team that has not yet played three matches this season', async () => {
    const { sql } = await run();
    expect(sql).toMatch(/HAVING COUNT\(\*\) >= 3/);
    expect(sql).toMatch(/JOIN teams_with_three twt ON twt\.team_id = t\.id/);
  });

  it('treats a NULL rank as nominated and anything from the reserve base as a reserve', async () => {
    const { sql, params } = await run();
    expect(sql).toMatch(/p\."rank" IS NULL OR p\."rank" < \?/);
    expect(params[1]).toBe(Roster.RESERVE_BASE);
  });

  it('does not treat the No Club holding pen as a club', async () => {
    const { sql, params } = await run();
    expect(sql).toMatch(/FROM team t WHERE t\.club <> \?/);
    expect(params[2]).toBe(Roster.NO_CLUB_ID);
  });
});
