/*
 * Publish approved fixture dates (exported from the review artifact) to the live `fixture` table.
 *
 *   node scripts/fixture-import/publish-fixtures.js approved.json            # DRY RUN (default)
 *   node scripts/fixture-import/publish-fixtures.js approved.json --apply     # writes to DB (after backup)
 *
 * Safe by design:
 *  - refuses to run if the export has any blank/bad/out-of-season date, team clash, or both-legs clash
 *  - only updates fixture ids that actually exist in the target divisions
 *  - always writes a timestamped backup of current dates to generated/ before applying
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const fs = require('fs');
const db = require('../../db_connect.js');
const GEN = path.join(__dirname, 'generated');
fs.mkdirSync(GEN, { recursive: true });

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!file) { console.error('Usage: node scratch_publish_fixtures.js <approved.json> [--apply]'); process.exit(1); }

const WIN_START = Date.UTC(2026, 7, 15), WIN_END = Date.UTC(2027, 4, 15);
const parseUTC = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2]-1, +m[3]) : NaN; };

(async () => {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dates = payload.dates || payload; // accept {dates:{}} or raw {}
  const ids = Object.keys(dates).map(Number);
  console.log(`Loaded ${ids.length} fixtures from ${file}`);

  db.connect();
  const conn = await db.otherConnect();

  // pull live rows for these ids (with team + division guard).
  // to_char reads the DB wall-clock directly — avoids the JS Date TZ shift on TIMESTAMP columns.
  const [live] = await conn.query(`
    SELECT f.id, f."homeTeam", f."awayTeam", f.status, d.name AS div,
           to_char(f.date,'YYYY-MM-DD') AS curdate,
           to_char(f.date,'YYYY-MM-DD HH24:MI:SS') AS curts
    FROM fixture f JOIN team ht ON f."homeTeam"=ht.id JOIN division d ON ht.division=d.id
    WHERE f.id = ANY(?) AND d.id BETWEEN 7 AND 10`, [ids]);
  const liveById = Object.fromEntries(live.map(r => [r.id, r]));

  // ---- validation ----
  const errs = [];
  const teamDate = {}, byPair = {};
  live.forEach(r => { byPair[`${r.homeTeam}-${r.awayTeam}`] = r.id; });

  ids.forEach(id => {
    const r = liveById[id];
    if (!r) { errs.push(`fixture ${id} not found in div 7-10 (refusing)`); return; }
    const v = dates[id];
    const t = parseUTC(v);
    if (isNaN(t)) { errs.push(`fixture ${id} (${r.div}): blank/bad date "${v}"`); return; }
    if (t < WIN_START || t > WIN_END) errs.push(`fixture ${id} (${r.div}): ${v} out of season window`);
    [r.homeTeam, r.awayTeam].forEach(tid => { const k = `${tid}|${v}`; (teamDate[k] = teamDate[k] || []).push(id); });
  });
  Object.entries(teamDate).forEach(([k, arr]) => { if (arr.length > 1) errs.push(`team clash: team ${k.split('|')[0]} on ${k.split('|')[1]} in fixtures ${arr.join(', ')}`); });
  live.forEach(r => { const rev = byPair[`${r.awayTeam}-${r.homeTeam}`]; if (rev && dates[r.id] && dates[r.id] === dates[rev] && r.id !== rev) errs.push(`both legs same day: ${r.id} & ${rev} on ${dates[r.id]}`); });

  if (ids.length !== 272) errs.push(`expected 272 fixtures, got ${ids.length}`);

  if (errs.length) {
    console.error(`\n✗ ${errs.length} problem(s) — nothing written:\n` + errs.map(e => '  - ' + e).join('\n'));
    process.exit(2);
  }

  // ---- diff ---- (compare true DB wall-clock date, no TZ shift)
  const changes = ids.map(id => ({ id, from: liveById[id].curdate, to: dates[id], div: liveById[id].div }))
    .filter(c => c.from !== c.to);

  console.log(`\n${changes.length} of ${ids.length} fixtures will change date (${ids.length - changes.length} already match).`);
  changes.slice(0, 12).forEach(c => console.log(`  #${c.id} ${c.div}: ${c.from} -> ${c.to}`));
  if (changes.length > 12) console.log(`  … and ${changes.length - 12} more`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write these to the live table.');
    process.exit(0);
  }

  // ---- backup then apply ----
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = { takenAt: new Date().toISOString(), note: 'wall-clock dates; restore with: UPDATE fixture SET date=ts WHERE id=id',
    rows: live.map(r => ({ id: r.id, ts: r.curts, status: r.status })) };
  const backupFile = path.join(GEN, `fixture-dates-backup-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1));
  console.log(`\nBackup of ${live.length} current rows -> ${backupFile}`);

  let n = 0;
  for (const c of changes) {
    await conn.query('UPDATE fixture SET date = ? WHERE id = ?', [c.to + ' 00:00:00', c.id]);
    n++;
  }
  console.log(`✓ Applied ${n} date updates to the live fixture table.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
