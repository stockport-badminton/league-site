// tools/season-history-backfill.js against a real Postgres: the copy is exact, a re-run
// copies nothing, and each check catches the fault it exists for.
const db = require('../../db_connect');
const { backfill } = require('../../tools/season-history-backfill');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);
const go = async () => backfill(await db.otherConnect());
const problemsOf = (report, table) => report.find(r => r.table === table).problems;

describe('season history backfill', () => {
  it('copies every archive exactly, contact details left behind', async () => {
    const report = await go();
    expect(report.map(r => r.table)).toEqual(expect.arrayContaining(['team20242025', 'player20252026']));
    expect(report.filter(r => r.problems.length)).toEqual([]);
    expect(report.every(r => r.inserted === r.archived)).toBe(true);

    // The seed's history: team 8 was Eastbank C in Division 2 in 2024/25.
    expect(await run(`SELECT name, division FROM team_at WHERE season = '20242025' AND id = 8`))
      .toEqual([{ name: 'Eastbank C', division: 3 }]);
  });

  it('copies nothing on a second run, and still verifies', async () => {
    await go();
    const again = await go();
    expect(again.every(r => r.inserted === 0 && r.problems.length === 0)).toBe(true);
  });

  it('reports history that differs from its archive', async () => {
    await go();
    await run(`UPDATE team_season SET name = 'Altered' WHERE season = '20242025' AND id = 8`);
    expect(problemsOf(await go(), 'team20242025'))
      .toEqual(['1 archive rows not in history', '1 history rows not in the archive']);
  });

  it('reports a row missing from history', async () => {
    await go();
    await run(`DELETE FROM player_season WHERE season = '20252026' AND id = 12`);
    expect(problemsOf(await go(), 'player20252026')).toEqual(expect.arrayContaining([
      expect.stringMatching(/archived, \d+ in history$/), '1 archive rows not in history']));
  });

  // player20182019 has no rank column: its history rows must hold NULL there, not a value
  // from anywhere else.
  it('leaves a column the archive lacks NULL, and reports one that is not', async () => {
    await run('ALTER TABLE player20242025 DROP COLUMN rank');
    expect(problemsOf(await go(), 'player20242025')).toEqual([]);
    expect(await run(`SELECT count(*)::int AS n FROM player_season WHERE season = '20242025' AND rank IS NOT NULL`))
      .toEqual([{ n: 0 }]);

    await run(`UPDATE player_season SET rank = 1 WHERE season = '20242025' AND id = 12`);
    expect(problemsOf(await go(), 'player20242025')).toEqual(['1 rows with a value in a column the archive lacks']);
  });

  it('refuses an archive column the history table does not have', async () => {
    await run('ALTER TABLE team20242025 ADD COLUMN mystery int');
    const report = await go();
    expect(problemsOf(report, 'team20242025')).toEqual(['columns team_season does not have: mystery']);
    expect(report.find(r => r.table === 'team20242025').inserted).toBe(0);
  });

  it('does not copy contact details', async () => {
    await go();
    expect(await run(`SELECT column_name FROM information_schema.columns
      WHERE table_name = 'player_season' AND column_name IN ('playerEmail', 'playerTel')`)).toEqual([]);
  });
});
