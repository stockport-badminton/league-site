// models/game.js's writes against a real Postgres (REARCH-01): the ELO backfill's single
// update and the two resets. createBatch and updateEloBatch are still on the wrapper
// (publish path, off-season) and are not tested here.
const db = require('../../db_connect');
const Game = require('../../models/game');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const ELO = ['homePlayer1Start', 'homePlayer2Start', 'awayPlayer1Start', 'awayPlayer2Start',
  'homePlayer1End', 'homePlayer2End', 'awayPlayer1End', 'awayPlayer2End'];
const eloSum = where => run(`SELECT count(*)::int AS n, COALESCE(sum(${ELO.map(c => `"${c}"`).join(' + ')}), 0)::int AS total
  FROM game g JOIN fixture f ON f.id = g.fixture ${where}`);

describe('game writes', () => {
  // Every seed game gets a rating, so a reset has something to clear.
  beforeEach(() => run(`UPDATE game SET ${ELO.map(c => `"${c}" = 1500`).join(', ')}`));

  it('updateById writes the columns given, and writes undefined as NULL', async () => {
    const [{ id }] = await run('SELECT id FROM game ORDER BY id LIMIT 1');
    await Game.updateById({ homePlayer1Start: 1510, homePlayer1End: undefined }, id);
    const [g] = await Game.getByFixture((await run('SELECT fixture FROM game WHERE id = ?', [id]))[0].fixture);
    const mine = (await run('SELECT "homePlayer1Start", "homePlayer1End", "homePlayer2Start" FROM game WHERE id = ?', [id]))[0];
    expect(mine).toEqual({ homePlayer1Start: 1510, homePlayer1End: null, homePlayer2Start: 1500 });
    expect(g).toBeDefined();
  });

  it('resetSeasonElo clears only completed fixtures inside the season window', async () => {
    const [season] = await run(`SELECT s.name FROM season s
      WHERE EXISTS (SELECT 1 FROM fixture f JOIN game g ON g.fixture = f.id
                    WHERE f.date > s."startDate" AND f.date < s."endDate" AND f.status = 'complete')
      ORDER BY s."startDate" DESC LIMIT 1`);
    const window = `JOIN season s ON f.date > s."startDate" AND f.date < s."endDate" AND s.name = '${season.name}'`;
    const outside = await eloSum(`WHERE g.id NOT IN (SELECT g2.id FROM game g2 JOIN fixture f ON f.id = g2.fixture ${window} WHERE f.status = 'complete')`);
    expect((await eloSum(`${window} WHERE f.status = 'complete'`))[0].total).toBeGreaterThan(0);

    await Game.resetSeasonElo(season.name);

    expect((await eloSum(`${window} WHERE f.status = 'complete'`))[0].total).toBe(0);
    expect(await eloSum(`WHERE g.id NOT IN (SELECT g2.id FROM game g2 JOIN fixture f ON f.id = g2.fixture ${window} WHERE f.status = 'complete')`))
      .toEqual(outside);
  });

  it('resetAllElo clears every game', async () => {
    await Game.resetAllElo();
    expect((await eloSum(''))[0].total).toBe(0);
  });

  it('getSeasonGamesOrdered returns rated games in date order, as integers', async () => {
    const [season] = await run(`SELECT s.name FROM season s ORDER BY s."startDate" DESC LIMIT 1`);
    const games = await Game.getSeasonGamesOrdered(season.name);
    for (let i = 1; i < games.length; i++) expect(games[i].date >= games[i - 1].date).toBe(true);
    for (const g of games) expect(Number.isInteger(g.homePlayer1Start)).toBe(true);
  });
});
