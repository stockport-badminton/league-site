// HARD-48: /fixture-players/:season read each player's rank and team from the LIVE
// player table, so a past season was judged by where everyone plays now. In 2024/25,
// 1,168 of 2,993 lineup slots had moved since; the page flagged players as turning out
// for another team when they had not, and when today's team did not exist that season
// the inner join dropped the whole fixture — 60 fixtures in 2024/25, and all but 17 rows
// of 2018/19.
//
// The SQL was proved against production and the local database by snapshotting the
// function for every season before and after and classifying each difference (see the
// brief). Jest cannot run that SQL, so this tests the part it can: which source the query
// is built to read, for each shape of archive the database actually holds.

jest.mock('../../db_connect.js', () => ({ otherConnect: jest.fn(), isObject: o => o === Object(o) }));
jest.mock('../../models/season', () => ({
  ...jest.requireActual('../../models/season'),
  current: () => '20262027',
}));

const db = require('../../db_connect.js');
const Fixture = require('../../models/fixture');

// A connection that answers the two lookups and records the main query.
function fakeDb({ columns = [], registered = 0, ranked = 0 } = {}) {
  const calls = [];
  db.otherConnect.mockResolvedValue({
    query: async (sql, params) => {
      calls.push(sql);
      if (sql.includes('information_schema.columns')) return [columns.map(c => ({ column_name: c }))];
      if (sql.includes('FILTER (WHERE team IS NOT NULL)')) return [[{ registered, ranked }]];
      return [[]];
    },
  });
  const last = () => calls[calls.length - 1];
  last.all = calls;
  return last;
}

const PLAYERS = 12;   // six a side, home and away

describe('Fixture.getMatchPlayerOrderDetails reads a past season as it was', () => {
  it('takes rank and team from the season archive when it records them', async () => {
    const mainSql = fakeDb({ columns: ['id', 'team', 'rank'], registered: 1018, ranked: 1009 });
    await Fixture.getMatchPlayerOrderDetails({ season: '20242025' });
    const sql = mainSql();

    expect(sql.split('(SELECT id, team, rank FROM player20242025)').length - 1).toBe(PLAYERS);
    expect(sql).toMatch(/CASE WHEN homeMan1Season\.id IS NULL THEN homeMan1\.team ELSE homeMan1Season\.team END/);
    expect(sql).toMatch(/CASE WHEN awayLady3Season\.id IS NULL THEN awayLady3\.rank ELSE awayLady3Season\.rank END/);
  });

  // The inner join is what dropped the fixtures. A player whose team cannot be found now
  // costs a blank cell, not the row.
  it('joins each player\'s team with a LEFT JOIN', async () => {
    const mainSql = fakeDb({ columns: ['id', 'team', 'rank'], registered: 10, ranked: 10 });
    await Fixture.getMatchPlayerOrderDetails({ season: '20242025' });
    const sql = mainSql();

    for (const slot of ['Man1', 'Man2', 'Man3', 'Lady1', 'Lady2', 'Lady3']) {
      expect(sql).toContain(`LEFT JOIN team20242025 ${slot}Team ON playerNames.${slot}TeamID`);
    }
  });

  // player20182019 has no rank column at all.
  it('keeps the live rank for an archive with no rank column, and still uses its team', async () => {
    const mainSql = fakeDb({ columns: ['id', 'team'] });
    await Fixture.getMatchPlayerOrderDetails({ season: '20182019' });

    expect(mainSql()).toContain('(SELECT h.id, h.team, live.rank FROM player20182019 h LEFT JOIN player live ON live.id = h.id)');
  });

  // player20192020 has the column but 587 of 876 registered players are blank. Reading it
  // would paint half that season red for a record nobody kept.
  it('keeps the live rank for an archive that mostly did not record one', async () => {
    const mainSql = fakeDb({ columns: ['id', 'team', 'rank'], registered: 876, ranked: 289 });
    await Fixture.getMatchPlayerOrderDetails({ season: '20192020' });

    expect(mainSql()).toContain('(SELECT h.id, h.team, live.rank FROM player20192020 h LEFT JOIN player live ON live.id = h.id)');
  });

  it('falls back to the live table for a season with no player archive', async () => {
    const mainSql = fakeDb({ columns: [] });
    await Fixture.getMatchPlayerOrderDetails({ season: '20152016' });
    const sql = mainSql();

    expect(sql).toContain('LEFT JOIN player homeMan1Season');
    expect(sql).not.toContain('player20152016');
  });

  // The live table IS the current season, so nothing may change there.
  it('reads the live table for the current season and looks nothing up', async () => {
    const lastSql = fakeDb();
    await Fixture.getMatchPlayerOrderDetails({});

    expect(lastSql.all).toHaveLength(1);
    expect(lastSql()).toContain('LEFT JOIN player homeMan1Season');
    expect(lastSql()).not.toMatch(/player20\d{6}/);
  });
});
