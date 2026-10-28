// tools/season-archive.js and the season-history audit check against a real Postgres
// (REARCH-02 step 6): the rollover copies the live tables exactly, records itself, runs once
// per season, and refuses every way of snapshotting the wrong thing.
const db = require('../../db_connect');
const { archiveSeason, Refusal } = require('../../tools/season-archive');
const { backfill } = require('../../tools/season-history-backfill');
const checks = require('../../tools/audit/checks');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);
const archive = async (season, opts) => archiveSeason(await db.otherConnect(), season, opts);

const CURRENT = '20262027';   // tools/local-db/test-seed.sql
const LAST = '20252026';

it('the seed has the seasons these tests assume', async () => {
  expect(await run(`SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 2`))
    .toEqual([{ name: CURRENT }, { name: LAST }]);
});

describe('season-archive', () => {
  it('copies every live table into history exactly, and records the run', async () => {
    const r = await archive(CURRENT);
    expect(r.tables.map(t => t.entity)).toEqual(['team', 'club', 'division', 'player', 'venue', 'messer']);
    expect(r.tables.filter(t => t.problems.length)).toEqual([]);
    for (const t of r.tables) {
      const [{ n }] = await run(`SELECT count(*)::int AS n FROM ${t.entity}`);
      expect(t).toMatchObject({ inserted: n, held: n });
    }

    const [row] = await run('SELECT row_counts, ran_by FROM season_archive_run WHERE season = ?', [CURRENT]);
    expect(row.row_counts).toEqual(Object.fromEntries(r.tables.map(t => [t.entity, t.held])));
    expect(row.ran_by).toBeTruthy();

    // No contact details reach history.
    const [{ n }] = await run(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'player_season' AND column_name IN ('playerEmail', 'playerTel', 'authEmail')`);
    expect(n).toBe(0);
  });

  it('keeps a live row as it was when the season is archived', async () => {
    await archive(CURRENT);
    await run(`UPDATE team SET name = 'Renamed Next Season' WHERE id = 8`);
    const [{ name }] = await run(`SELECT name FROM team_season WHERE season = ? AND id = 8`, [CURRENT]);
    expect(name).not.toBe('Renamed Next Season');
  });

  it('runs once per season', async () => {
    await archive(CURRENT);
    await expect(archive(CURRENT)).rejects.toThrow(/was archived already/);
  });

  it('refuses a season that already has history, even with no run recorded', async () => {
    await run(`INSERT INTO venue_season (season, id, name) VALUES (?, 1, 'Leftover')`, [CURRENT]);
    await expect(archive(CURRENT)).rejects.toThrow(/venue_season already has 1 rows/);
    expect(await run('SELECT * FROM season_archive_run')).toEqual([]);
  });

  it('refuses anything but the current season, and last season without --late', async () => {
    await expect(archive('20242025')).rejects.toThrow(/not the current season/);
    await expect(archive(LAST)).rejects.toThrow(/already started.*--late/);
    await expect(archive('20302031')).rejects.toThrow(/no season 20302031/);
    await expect(archive("20262027' --")).rejects.toThrow(Refusal);

    const late = await archive(LAST, { late: true });
    expect(late).toMatchObject({ season: LAST, late: true });
  });

  it('refuses when a live column has nowhere to go in history', async () => {
    await run('ALTER TABLE team ADD COLUMN "newThing" INTEGER');
    await expect(archive(CURRENT)).rejects.toThrow(/team has columns team_season does not: newThing/);
  });

  // Left the current season's history rows in place: the <entity>_at views must keep
  // reading the live tables for it (migration 030).
  it('leaves the current season reading the live tables', async () => {
    await archive(CURRENT);
    await run(`UPDATE team SET name = 'Live Edit' WHERE id = 8`);
    expect(await run('SELECT name FROM team_at WHERE season = ? AND id = 8', [CURRENT]))
      .toEqual([{ name: 'Live Edit' }]);
  });
});

describe('the season-history audit check', () => {
  const findings = async () => run(checks.get('season-history').sql);

  it('reports last season when it has no history a week into this one', async () => {
    expect(await findings()).toEqual([expect.objectContaining({ season: LAST, currentSeason: CURRENT })]);
  });

  it('is quiet once last season has history, by rollover or backfill', async () => {
    await backfill(await db.otherConnect());
    expect(await findings()).toEqual([]);
  });

  it('allows a week after the season starts', async () => {
    await run(`UPDATE season SET "startDate" = now() - interval '3 days' WHERE name = ?`, [CURRENT]);
    expect(await findings()).toEqual([]);
  });
});
