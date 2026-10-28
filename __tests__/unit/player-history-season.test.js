// A player's game history shows each game's teams as they were THAT season (25 Oct 2026).
//
// Player.getPlayerGameData read every team from the live `team` table. Team ids are reused
// (HARD-39: 51, 54–57) and teams are renamed, so a game was labelled with whichever team
// holds its id today: 15,152 of 141,212 history rows on production named the wrong team.
// The "(+N)" playing-up bracket compared today's team with today's team as well, and was
// shown on 40,778 rows; judged by the season the game was played in, it belongs on 11,778.
//
// The SQL was proved by snapshotting the function for every player with a rated game, on
// production and on the local database, before and after: no row lost or added, every
// change in `teamName` or `teamAdjustment`, the current season identical. The seasons'
// teams and players come from team_season / player_season since REARCH-02; what it reads
// is tested against a real Postgres in __tests__/db/season-history-readers.test.js. This
// file checks how the statement joins them.

jest.mock('../../db_connect.js', () => ({ otherConnect: jest.fn(), isObject: o => o === Object(o) }));
jest.mock('../../models/season', () => ({
  ...jest.requireActual('../../models/season'),
  current: () => '20262027',
}));

const db = require('../../db_connect.js');
const Player = require('../../models/players');

// A connection that records the query.
function fakeDb() {
  const calls = [];
  db.otherConnect.mockResolvedValue({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [[]];
    },
  });
  return () => calls[calls.length - 1].sql;
}

describe('Player.getPlayerGameData reads each game in its own season', () => {
  it('matches each fixture to a season by its date, and the history by season', async () => {
    const mainSql = fakeDb();
    await Player.getPlayerGameData(14);
    const sql = mainSql();

    expect(sql).toMatch(/LEFT JOIN LATERAL \(SELECT s\.name FROM season s WHERE fixture\.date > s\."startDate" AND fixture\.date < s\."endDate"/);
    expect(sql).toContain('LEFT JOIN teamThen homeThen ON homeThen.season = fixtureSeason.name AND homeThen.id = fixture."homeTeam"');
    expect(sql).toContain('LEFT JOIN teamThen awayThen ON awayThen.season = fixtureSeason.name AND awayThen.id = fixture."awayTeam"');
  });

  // The bracket compares the team they were registered to that season, falling back to
  // today's team only where the season holds no record of them.
  it("judges playing up against the player's own team that season", async () => {
    const mainSql = fakeDb();
    await Player.getPlayerGameData(14);
    const sql = mainSql();

    expect(sql).toContain('LEFT JOIN playerThen ownThen ON ownThen.season = allGames.fixtureseason AND ownThen.id = player.id');
    expect(sql).toContain('LEFT JOIN teamThen ownTeamThen ON ownTeamThen.season = allGames.fixtureseason AND ownTeamThen.id = ownThen.team');
    expect(sql).toContain('CASE WHEN ownThen.id IS NULL THEN team.rank ELSE ownTeamThen.rank END - teamrank AS "teamAdjustment"');
  });

  // The view reverses the rows for the rating chart and keeps each night's last game, so
  // the order is part of the contract. It used to sit inside a CTE, where Postgres may
  // ignore it, and 595 of 915 histories came back out of date order.
  it('orders on the outer query: newest first, and within a night the last game first', async () => {
    const mainSql = fakeDb();
    await Player.getPlayerGameData(14);
    expect(mainSql().trimEnd()).toMatch(/ORDER BY date DESC, allGames\.id DESC$/);
  });
});
