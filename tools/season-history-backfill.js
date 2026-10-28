#!/usr/bin/env node
// REARCH-02 step 3: copy every season archive (team20242025, player20182019, …) into its
// history table (team_season, player_season, …), and prove the copy exact.
//
//   node tools/season-history-backfill.js            local, dry: copy, verify, roll back
//   node tools/season-history-backfill.js --apply    local, commit
//   node tools/season-history-backfill.js --prod [--apply]
//
// Kept in tools/ rather than the gitignored scripts/ because `tools/local-db.sh load` runs
// it too: the archives come from the seed, and the history tables have to be filled from
// them on every load. It cannot be a migration for the same reason: the load applies every
// migration before the seed, so a migration would copy empty archives.
//
// One transaction for everything. A dry run does the inserts and the checks and then rolls
// back, so it rehearses the real write rather than guessing at it.
//
// A FAITHFUL copy, column for column. Two changes the REARCH-02 brief once put here belong
// to the readers instead, so that this copy can be proved exact:
//   - HARD-48's rank rule (a season whose archive ranks fewer than half its players shows
//     the live rank). Writing the live rank in here would record today's rank as 2019/20's.
//     The rule stays in the reader, computed over player_season.
//   - Trimming names. The archives hold 298 untrimmed names in 2024/25 alone; tidying them
//     is a visible change, made and explained in Part 2, not hidden inside the copy.
//
// For each archive:
//   - an archive column the history table does not have stops the run, unless it is one
//     deliberately not kept (NOT_KEPT, below). Nothing is dropped by accident;
//   - the rows are inserted only if the history table has none for that season (the guard
//     is in the INSERT's own WHERE), so a re-run copies nothing and only verifies;
//   - then it checks: the archive EXCEPT the history rows, and the history rows EXCEPT the
//     archive, over the archive's columns, both empty; the row counts equal; and every
//     history column the archive lacks NULL.
// Any failure rolls back the lot, --apply or not.
const { loadEnv } = require('./lib/loadEnv');

const ENTITIES = ['team', 'club', 'division', 'player', 'venue', 'messer'];
// Archive columns that are not copied: contact and login details and site permissions,
// as migration 030 leaves out of player_season. Production's archives have only the first
// two; an archive copied from today's player table has all five.
const NOT_KEPT = new Set(['playerEmail', 'playerTel', 'authEmail', 'role', 'messerAdmin']);
const ARCHIVE = new RegExp(`^(${ENTITIES.join('|')})(20\\d{6})$`);

const q = name => `"${name.replace(/"/g, '""')}"`;

async function columnsOf(conn, table) {
  const [rows] = await conn.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`, [table]);
  return rows.map(r => r.column_name);
}

async function archives(conn) {
  const [rows] = await conn.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  return rows.map(r => ARCHIVE.exec(r.table_name)).filter(Boolean)
    .map(([table, entity, season]) => ({ table, entity, season }))
    .sort((a, b) => ENTITIES.indexOf(a.entity) - ENTITIES.indexOf(b.entity) || a.season.localeCompare(b.season));
}

// Copies and verifies every archive on `conn`, inside whatever transaction the caller holds.
// Returns one report row per archive; `problems` is empty when the copy is exact.
async function backfill(conn) {
  const report = [];
  const historyCols = {};
  for (const e of ENTITIES) historyCols[e] = (await columnsOf(conn, `${e}_season`)).filter(c => c !== 'season');

  for (const { table, entity, season } of await archives(conn)) {
    const history = `${entity}_season`;
    const problems = [];
    const archiveCols = (await columnsOf(conn, table)).filter(c => !NOT_KEPT.has(c));
    const unknown = archiveCols.filter(c => !historyCols[entity].includes(c));
    if (unknown.length) {
      report.push({ table, season, archived: null, inserted: 0, problems: [`columns ${history} does not have: ${unknown.join(', ')}`] });
      continue;
    }
    const cols = archiveCols.map(q).join(', ');
    const missing = historyCols[entity].filter(c => !archiveCols.includes(c));

    const [ins] = await conn.query(
      `INSERT INTO ${history} (season, ${cols})
       SELECT ?, ${cols} FROM ${q(table)}
        WHERE NOT EXISTS (SELECT 1 FROM ${history} WHERE season = ?)`, [season, season]);

    const [[counts]] = await conn.query(
      `SELECT (SELECT count(*) FROM ${q(table)}) AS archived,
              (SELECT count(*) FROM ${history} WHERE season = ?) AS held,
              (SELECT count(*) FROM (SELECT ${cols} FROM ${q(table)}
                                     EXCEPT SELECT ${cols} FROM ${history} WHERE season = ?) x) AS only_archive,
              (SELECT count(*) FROM (SELECT ${cols} FROM ${history} WHERE season = ?
                                     EXCEPT SELECT ${cols} FROM ${q(table)}) x) AS only_history,
              ${missing.length
                ? `(SELECT count(*) FROM ${history} WHERE season = ? AND (${missing.map(c => `${q(c)} IS NOT NULL`).join(' OR ')}))`
                : '0'} AS filled_missing`,
      missing.length ? [season, season, season, season] : [season, season, season]);
    const n = k => Number(counts[k]);
    if (n('archived') !== n('held')) problems.push(`${n('archived')} archived, ${n('held')} in history`);
    if (n('only_archive')) problems.push(`${n('only_archive')} archive rows not in history`);
    if (n('only_history')) problems.push(`${n('only_history')} history rows not in the archive`);
    if (n('filled_missing')) problems.push(`${n('filled_missing')} rows with a value in a column the archive lacks`);
    report.push({ table, season, archived: n('archived'), inserted: ins.affectedRows, problems });
  }
  return report;
}

module.exports = { backfill, NOT_KEPT };

if (require.main === module) {
  const { prod } = loadEnv();
  const apply = process.argv.includes('--apply');
  const db = require('../db_connect');
  db.connect();
  const ROLLBACK = new Error('dry run');

  (async () => {
    let report;
    try {
      await db.withTransaction(async conn => {
        report = await backfill(conn);
        if (!apply || report.some(r => r.problems.length)) throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    for (const r of report) {
      console.log(`${r.table.padEnd(18)} ${String(r.archived ?? '?').padStart(5)} archived  ${String(r.inserted).padStart(5)} inserted  ${r.problems.length ? '✗ ' + r.problems.join('; ') : '✓ exact'}`);
    }
    const bad = report.filter(r => r.problems.length);
    const total = report.reduce((s, r) => s + r.inserted, 0);
    if (bad.length) {
      console.log(`\n✗ ${bad.length} of ${report.length} archives did not copy exactly. Nothing written.`);
      process.exitCode = 1;
    } else if (apply) {
      console.log(`\n✓ ${report.length} archives, ${total} rows inserted and committed${prod ? ' (PRODUCTION)' : ''}.`);
    } else {
      console.log(`\n✓ ${report.length} archives, ${total} rows would be inserted. Dry run: rolled back. --apply to write.`);
    }
  })().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => db.end && db.end());
}
