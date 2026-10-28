#!/usr/bin/env node
// REARCH-02 step 6: the season rollover. Copies today's team, club, division, player, venue
// and messer rows into their history tables as <season>'s snapshot, and records that it ran.
//
//   node tools/season-archive.js 20262027                   local, dry: copy, verify, roll back
//   node tools/season-archive.js 20262027 --apply           local, commit
//   node tools/season-archive.js 20262027 --prod [--apply]
//
// Run it at the end of a season, AFTER the last result is in and BEFORE anyone starts
// editing teams, divisions or squads for the next one. The live tables are the season's
// record only until then; a snapshot taken late shows next season's names on this season's
// pages for ever. That is why the season is named on the command line rather than worked
// out: it must be the current season (the one whose startDate has most recently passed).
// Once the next season's startDate has passed, the live tables may already be next
// season's, and it refuses unless told `--late`.
//
// It replaces public.clone_season, a function stored in production and run by hand. That
// made a table per season and copied rows only on its first run, silently, and kept no
// record of when. This writes rows into the tables migration 030 made, and one row in
// season_archive_run (migration 031) in the same transaction: when, by whom, and the
// counts it re-read after writing.
//
// Refuses, before writing anything, if:
//   - the season already has a season_archive_run row, or any history row in any of the six
//     tables (the backfilled seasons have the second and not the first);
//   - a live column is neither in its history table nor deliberately not kept (contact and
//     login details, site permissions — the backfill's NOT_KEPT). A new column nobody added
//     to history would otherwise be dropped from every snapshot.
// Then, inside the transaction: the live rows EXCEPT the history rows, and the history rows
// EXCEPT the live rows, both empty, and the counts equal (gotcha 2d: read back, do not
// trust affectedRows alone). Any failure rolls back the lot, --apply or not.
const { loadEnv } = require('./lib/loadEnv');
const { NOT_KEPT } = require('./season-history-backfill');

const ENTITIES = ['team', 'club', 'division', 'player', 'venue', 'messer'];
const SEASON = /^20\d{6}$/;

const q = name => `"${name.replace(/"/g, '""')}"`;

class Refusal extends Error {}

async function columnsOf(conn, table) {
  const [rows] = await conn.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`, [table]);
  return rows.map(r => r.column_name);
}

// Copies the live tables into history as `season`, on `conn`, inside whatever transaction
// the caller holds. Throws Refusal for anything that must stop the run; otherwise returns
// { season, current, late, unplayed, tables: [{ entity, live, inserted, problems }] }.
async function archiveSeason(conn, season, { late = false } = {}) {
  if (!SEASON.test(String(season))) throw new Refusal(`"${season}" is not a season name (e.g. 20262027)`);

  const [seasons] = await conn.query(
    `SELECT name, "startDate" <= now() AS started FROM season ORDER BY "startDate" DESC`);
  if (!seasons.some(s => s.name === season)) throw new Refusal(`there is no season ${season} in the season table`);
  const started = seasons.filter(s => s.started);
  const current = started[0] && started[0].name;
  if (season !== current) {
    if (!(late && started[1] && started[1].name === season)) {
      throw new Refusal(season === (started[1] && started[1].name)
        ? `${current} has already started, so the live tables may hold its teams rather than ${season}'s. ` +
          `If you are sure nothing has been edited for ${current} yet, re-run with --late.`
        : `${season} is not the current season (${current}). Only the current season's rows are in the live tables.`);
    }
  }

  const [[ran]] = await conn.query('SELECT ran_at FROM season_archive_run WHERE season = ?', [season]);
  if (ran) throw new Refusal(`${season} was archived already, at ${new Date(ran.ran_at).toISOString()}`);
  const plan = [];
  for (const entity of ENTITIES) {
    const history = `${entity}_season`;
    const [[{ n }]] = await conn.query(`SELECT count(*) AS n FROM ${history} WHERE season = ?`, [season]);
    if (Number(n)) throw new Refusal(`${history} already has ${n} rows for ${season}; nothing is overwritten`);

    const kept = (await columnsOf(conn, history)).filter(c => c !== 'season');
    const live = (await columnsOf(conn, entity)).filter(c => !NOT_KEPT.has(c));
    const lost = live.filter(c => !kept.includes(c));
    if (lost.length) {
      throw new Refusal(`${entity} has columns ${history} does not: ${lost.join(', ')}. ` +
        'Add them to the history table (and its view) in a migration, or to NOT_KEPT.');
    }
    plan.push({ entity, history, cols: live.map(q).join(', ') });
  }

  const [[{ unplayed }]] = await conn.query(
    `SELECT count(*) AS unplayed FROM fixture f JOIN season s ON s.name = ?
      WHERE f.date >= s."startDate" AND f.date <= s."endDate" AND f.date > now()
        AND f.status NOT IN ('void', 'complete', 'conceded')`, [season]);

  const tables = [];
  for (const { entity, history, cols } of plan) {
    const [ins] = await conn.query(
      `INSERT INTO ${history} (season, ${cols}) SELECT ?, ${cols} FROM ${q(entity)}`, [season]);
    const [[c]] = await conn.query(
      `SELECT (SELECT count(*) FROM ${q(entity)}) AS live,
              (SELECT count(*) FROM ${history} WHERE season = ?) AS held,
              (SELECT count(*) FROM (SELECT ${cols} FROM ${q(entity)}
                                     EXCEPT SELECT ${cols} FROM ${history} WHERE season = ?) x) AS only_live,
              (SELECT count(*) FROM (SELECT ${cols} FROM ${history} WHERE season = ?
                                     EXCEPT SELECT ${cols} FROM ${q(entity)}) x) AS only_history`,
      [season, season, season]);
    const n = k => Number(c[k]);
    const problems = [];
    if (n('live') !== n('held')) problems.push(`${n('live')} live, ${n('held')} in history`);
    if (n('only_live')) problems.push(`${n('only_live')} live rows not in history`);
    if (n('only_history')) problems.push(`${n('only_history')} history rows not live`);
    tables.push({ entity, live: n('live'), inserted: ins.affectedRows, held: n('held'), problems });
  }

  const counts = Object.fromEntries(tables.map(t => [t.entity, t.held]));
  await conn.query('INSERT INTO season_archive_run (season, row_counts) VALUES (?, ?::jsonb)',
    [season, JSON.stringify(counts)]);
  const [[recorded]] = await conn.query(
    'SELECT ran_at, ran_by, row_counts FROM season_archive_run WHERE season = ?', [season]);

  return { season, current, late: season !== current, unplayed: Number(unplayed), tables, recorded };
}

module.exports = { archiveSeason, Refusal };

if (require.main === module) {
  const { prod } = loadEnv();
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const season = args.find(a => !a.startsWith('--'));
  const db = require('../db_connect');
  db.connect();
  const ROLLBACK = new Error('dry run');

  (async () => {
    if (!season) throw new Refusal('usage: node tools/season-archive.js <season> [--apply] [--prod] [--late]');
    let r;
    try {
      await db.withTransaction(async conn => {
        r = await archiveSeason(conn, season, { late: args.includes('--late') });
        if (!apply || r.tables.some(t => t.problems.length)) throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    console.log(`season ${r.season}${r.late ? ` (late: ${r.current} has started)` : ''}${prod ? '  PRODUCTION' : '  local'}`);
    if (r.unplayed) console.log(`⚠ ${r.unplayed} fixtures in ${r.season} are still in the future and not void, complete or conceded. Is the season over?`);
    for (const t of r.tables) {
      console.log(`  ${(t.entity + '_season').padEnd(16)} ${String(t.inserted).padStart(5)} rows  ${t.problems.length ? '✗ ' + t.problems.join('; ') : '✓ matches live'}`);
    }
    const total = r.tables.reduce((s, t) => s + t.inserted, 0);
    if (r.tables.some(t => t.problems.length)) {
      console.log('\n✗ the copy did not match the live tables. Nothing written.');
      process.exitCode = 1;
    } else if (apply) {
      console.log(`\n✓ ${total} rows committed; season_archive_run records ${r.season} at ${new Date(r.recorded.ran_at).toISOString()} by ${r.recorded.ran_by}.`);
    } else {
      console.log(`\n✓ ${total} rows would be written. Dry run: rolled back. --apply to write.`);
    }
  })().catch(err => {
    console.error(err instanceof Refusal ? '✗ ' + err.message : err);
    process.exitCode = 1;
  }).finally(() => db.end && db.end());
}
