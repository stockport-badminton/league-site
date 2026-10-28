// The league tables' row keys, against a real Postgres (REARCH-03 part C).
//
// The tables rank on GAMES won and lost, every one of a fixture's 18 counting, and the
// keys used to say `pointsFor` / `pointsAgainst`. They are now `gamesWon` / `gamesLost`.
// A key the templates read and the query no longer returns renders a blank column, not
// an error, so the keys are asserted here on what the SQL actually returns, and the pages
// are asserted on their HTML in __tests__/integration/league-tables.test.js.
const db = require('../../db_connect');
const League = require('../../models/league');
const Season = require('../../models/season');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const HOME = 1001, AWAY = 1002;
let DIVISION;

beforeEach(async () => {
  await run(`INSERT INTO season (id, name, "startDate", "endDate", label)
    SELECT 1001, ?, now() - interval '30 days', now() + interval '300 days', 'test'
    WHERE NOT EXISTS (SELECT 1 FROM season WHERE name = ?)`, [Season.current(), Season.current()]);
  const [club] = await run('SELECT id, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
  [DIVISION] = await run(`INSERT INTO division (id, name, league, rank) VALUES (1001, 'Test Division', 1, 99)
    RETURNING id, name`);
  await run(`INSERT INTO team (id, name, club, venue, rank, division, "divRank", penalties) VALUES
    (${HOME}, 'Table Home A', ${club.id}, ${club.venue}, 1, ${DIVISION.id}, 1, 0),
    (${AWAY}, 'Table Away A', ${club.id}, ${club.venue}, 1, ${DIVISION.id}, 2, 0)`);
  await run(`INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status, "homeScore", "awayScore") VALUES
    (1001, ?, ?, date_trunc('day', now()) - interval '7 days', 'complete', 11, 7),
    (1002, ?, ?, date_trunc('day', now()) - interval '3 days', 'complete', 8, 10)`, [HOME, AWAY, AWAY, HOME]);
});

// Home won 11 then 10 (21), lost 7 then 8 (15); away the reverse.
const EXPECTED = [
  { name: 'Table Home A', played: 2, gamesWon: 21, gamesLost: 15 },
  { name: 'Table Away A', played: 2, gamesWon: 15, gamesLost: 21 },
];
const numbers = rows => rows.map(r => ({ name: r.name, played: Number(r.played),
  gamesWon: Number(r.gamesWon), gamesLost: Number(r.gamesLost) }));

describe('getLeagueTable', () => {
  it('returns games won and lost as gamesWon / gamesLost, most games won first', async () => {
    const rows = await League.getLeagueTable(DIVISION.name.replace(' ', '-'));
    expect(numbers(rows)).toEqual(EXPECTED);
    expect(rows[0]).not.toHaveProperty('pointsFor');
  });
});

describe('getAllLeagueTables', () => {
  it('returns games won and lost as gamesWon / gamesLost, most games won first', async () => {
    const rows = (await League.getAllLeagueTables()).filter(r => r.division === DIVISION.id);
    expect(numbers(rows)).toEqual(EXPECTED);
    expect(rows[0]).toMatchObject({ divisionName: 'Test Division' });
    expect(rows[0]).not.toHaveProperty('pointsFor');
  });
});

// The run-in page's standings (utils/leagueRunIn.js does the rest). The seed's 2026/27
// has one fixture of each pairing played and the return still to come.
describe('getRunIn', () => {
  const seeded = async () => (await League.getRunIn()).find(r => r.name === 'Northfield A');

  it("counts each team's fixtures played and left, as numbers", async () => {
    const [played] = await run(`SELECT "homeScore", "awayScore" FROM fixture WHERE id = 301`);
    expect(await seeded()).toMatchObject({
      divisionName: 'Premier', divisionRank: 1, played: 1, remaining: 1,
      gamesWon: played.homeScore, gamesLost: played.awayScore,
    });
  });

  it('takes penalties off games won', async () => {
    const before = (await seeded()).gamesWon;
    await run('UPDATE team SET penalties = 3 WHERE id = 1');
    expect((await seeded()).gamesWon).toBe(before - 3);
  });

  it('leaves out a withdrawn team', async () => {
    await run('UPDATE team SET withdrawn = now() WHERE id = 1');
    expect(await seeded()).toBeUndefined();
  });

  it('lists divisions in rank order, each best first', async () => {
    const rows = (await League.getRunIn()).filter(r => r.divisionRank <= 4);
    const ranks = rows.map(r => r.divisionRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const rank of new Set(ranks)) {
      const won = rows.filter(r => r.divisionRank === rank).map(r => r.gamesWon);
      expect(won).toEqual([...won].sort((a, b) => b - a));
    }
  });
});
