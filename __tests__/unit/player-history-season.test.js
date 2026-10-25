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
// change in `teamName` or `teamAdjustment`, the current season identical. Jest cannot run
// that SQL, so this tests what it can: which snapshots the query is built to read.

jest.mock('../../db_connect.js', () => ({ otherConnect: jest.fn(), isObject: o => o === Object(o) }));
jest.mock('../../models/season', () => ({
  ...jest.requireActual('../../models/season'),
  current: () => '20262027',
}));

const db = require('../../db_connect.js');
const Player = require('../../models/players');

// A connection that answers the snapshot lookup and records the main query.
function fakeDb(tables) {
  const calls = [];
  db.otherConnect.mockResolvedValue({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('information_schema.tables')) return [tables.map(t => ({ table_name: t }))];
      return [[]];
    },
  });
  const last = () => calls[calls.length - 1].sql;
  last.first = () => calls[0];
  return last;
}

describe('Player.getPlayerGameData reads each game in its own season', () => {
  it("reads every season's team and player snapshots", async () => {
    const mainSql = fakeDb(['team20182019', 'team20242025', 'player20182019', 'player20242025']);
    await Player.getPlayerGameData(14);
    const sql = mainSql();

    expect(sql).toContain("SELECT '20182019'::text AS season, id, name, rank FROM team20182019");
    expect(sql).toContain("SELECT '20242025'::text AS season, id, name, rank FROM team20242025");
    expect(sql).toContain("SELECT '20182019'::text AS season, id, team FROM player20182019");
    expect(sql).toContain("SELECT '20242025'::text AS season, id, team FROM player20242025");
  });

  // Discovered from the schema, so the next rollover's archive is read without a code
  // change. That is what the old comment here said could not be done safely.
  it('asks the schema which snapshots exist rather than listing them', async () => {
    const mainSql = fakeDb([]);
    await Player.getPlayerGameData(14);

    expect(mainSql.first().sql).toContain('information_schema.tables');
    expect(mainSql.first().params).toEqual(['public', '^(team|player)20[0-9]{6}$']);
  });

  it('matches each fixture to a season by its date, and the snapshot by season', async () => {
    const mainSql = fakeDb(['team20242025']);
    await Player.getPlayerGameData(14);
    const sql = mainSql();

    expect(sql).toMatch(/LEFT JOIN LATERAL \(SELECT s\.name FROM season s WHERE fixture\.date > s\."startDate" AND fixture\.date < s\."endDate"/);
    expect(sql).toContain('LEFT JOIN teamThen homeThen ON homeThen.season = fixtureSeason.name AND homeThen.id = fixture."homeTeam"');
    expect(sql).toContain('LEFT JOIN teamThen awayThen ON awayThen.season = fixtureSeason.name AND awayThen.id = fixture."awayTeam"');
  });

  // The bracket compares the team they were registered to that season, falling back to
  // today's team only where the season holds no record of them.
  it("judges playing up against the player's own team that season", async () => {
    const mainSql = fakeDb(['team20242025', 'player20242025']);
    await Player.getPlayerGameData(14);
    const sql = mainSql();

    expect(sql).toContain('LEFT JOIN playerThen ownThen ON ownThen.season = allGames.fixtureseason AND ownThen.id = player.id');
    expect(sql).toContain('LEFT JOIN teamThen ownTeamThen ON ownTeamThen.season = allGames.fixtureseason AND ownTeamThen.id = ownThen.team');
    expect(sql).toContain('CASE WHEN ownThen.id IS NULL THEN team.rank ELSE ownTeamThen.rank END - teamrank AS "teamAdjustment"');
  });

  // Until it ends, the live tables are the record of the current season.
  it('never reads a snapshot of the current season', async () => {
    const mainSql = fakeDb(['team20252026', 'team20262027', 'player20262027']);
    await Player.getPlayerGameData(14);
    const sql = mainSql();

    expect(sql).toContain('FROM team20252026');
    expect(sql).not.toContain('team20262027');
    expect(sql).not.toContain('player20262027');
  });

  // A fresh local database, or any database with no archives yet, must still produce a
  // query that runs — and reads everything live, as before.
  it('still builds a valid query when there are no snapshots', async () => {
    const mainSql = fakeDb([]);
    await Player.getPlayerGameData(14);
    const sql = mainSql();

    expect(sql).toMatch(/WITH teamThen AS \(SELECT NULL::text AS season, NULL::integer AS id, NULL::varchar AS name, NULL::integer AS rank WHERE false\)/);
    expect(sql).toMatch(/playerThen AS \(SELECT NULL::text AS season, NULL::integer AS id, NULL::integer AS team WHERE false\)/);
  });

  // The view reverses the rows for the rating chart and keeps each night's last game, so
  // the order is part of the contract. It used to sit inside a CTE, where Postgres may
  // ignore it, and 595 of 915 histories came back out of date order.
  it('orders on the outer query: newest first, and within a night the last game first', async () => {
    const mainSql = fakeDb([]);
    await Player.getPlayerGameData(14);
    expect(mainSql().trimEnd()).toMatch(/ORDER BY date DESC, allGames\.id DESC$/);
  });
});
