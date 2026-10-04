// Bring the local database up to date with production's CURRENT SEASON, without
// bringing any member's contact details with it.
//
//   tools/local-db.sh sync            # what it would do, nothing written
//   tools/local-db.sh sync --apply    # do it
//
// `load` rebuilds from migrations/data/002_data.sql, a snapshot whose newest season is
// 2024/25. That is fine for history and useless for anything happening now: no 2026/27
// season row, no 2026/27 fixtures, none of this season's new teams. This fills that gap
// incrementally, on top of a loaded database, and can be re-run whenever.
//
// What moves, and what happens to it on the way:
//
//   season, division, venue, club, team   upserted whole. They do not change mid-season,
//                                         but the snapshot is two seasons old, and a
//                                         fixture cannot point at a team that is not here.
//   player                                upserted, with playerEmail / playerTel /
//                                         authEmail NEVER READ. Each is rebuilt locally as
//                                         sanitise.sql does it (bigcoops+firstnamelastname,
//                                         07700 900xxx) under the LOCAL key, and only
//                                         where production has a value at all.
//   fixture                               the current season, upserted.
//   game                                  REPLACED per synced fixture, not upserted: a
//                                         result republished in production gets new game
//                                         rows, and an upsert would leave the old ones
//                                         beside them — doubled stats, silently.
//   scorecardstore, messer_scorecard      the current season. Photo URL cleared, submitter
//                                         email aliased, and confirmToken replaced: a
//                                         production token is a credential that can PUBLISH
//                                         that draft on the live site.
//
// Rows are matched by id, and local writes draw ids from the same sequences. So a row
// written locally — a draft filed by the browser suite, a player added on a dev server —
// is overwritten when production later uses that id. Fine for a database that is thrown
// away by design; worth knowing before relying on a hand-made local row surviving.
//
// Nothing is deleted except those game rows. A fixture deleted in production stays here,
// and so do the fake ones dev-fixtures.sql adds; the summary counts them.
//
// Production is read inside a READ ONLY transaction. The target must be on localhost or
// the script refuses, and any bytea column it does not already know how to handle stops
// it before anything is written — a new encrypted column is a new contact detail until
// somebody decides otherwise.
//
// The whole write is one transaction. Foreign keys are suspended for it (club and player
// point at each other) and then every one is re-validated, as seed-repairs.sql does after
// a load; a violation rolls the lot back and leaves the local database as it was.
'use strict';

const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..', '..');
const APPLY = process.argv.includes('--apply');

// Values cross as text, untouched: no Date round trip through this process's timezone
// (fixture.date is a naive timestamp and must arrive exactly as stored).
const RAW = { getTypeParser: () => v => v };

const CONTACT_COLUMNS = ['playerEmail', 'playerTel', 'authEmail'];
const KNOWN_BYTEA = new Set(CONTACT_COLUMNS.map(c => 'player.' + c));

const SEASON_RANGE = 'date > $1 AND date < $2';
const TABLES = [
  { name: 'season' },
  { name: 'division' },
  { name: 'venue' },
  { name: 'club' },
  { name: 'team' },
  { name: 'player', omit: CONTACT_COLUMNS },
  { name: 'fixture', where: SEASON_RANGE },
  { name: 'game', where: `fixture IN (SELECT id FROM fixture WHERE ${SEASON_RANGE})`, replaceByFixture: true },
  { name: 'scorecardstore', where: SEASON_RANGE, draft: true },
  { name: 'messer_scorecard', where: SEASON_RANGE, draft: true },
];

function fail(msg) {
  console.error('sync: ' + msg);
  process.exit(1);
}

function q(ident) {
  return '"' + ident.replace(/"/g, '""') + '"';
}

async function columnsOf(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table]);
  return rows;
}

async function main() {
  const prodUrl = dotenv.parse(fs.readFileSync(path.join(ROOT, '.env'))).DATABASE_URL;
  const localUrl = process.env.SYNC_TARGET_URL;
  const localKey = process.env.LOCAL_DB_PI_KEY;
  if (!prodUrl) fail('no DATABASE_URL in .env to read production from');
  if (!localUrl || !localKey) fail('run this through tools/local-db.sh sync');
  if (!['127.0.0.1', 'localhost'].includes(new URL(localUrl).hostname)) {
    fail(`refusing to write to ${new URL(localUrl).hostname} — the target must be the local database`);
  }
  if (new URL(prodUrl).host === new URL(localUrl).host) fail('source and target are the same database');

  const prod = new Client({ connectionString: prodUrl, types: RAW });
  const local = new Client({ connectionString: localUrl, types: RAW });
  await prod.connect();
  await local.connect();

  try {
    await prod.query('BEGIN TRANSACTION READ ONLY');

    // The season whose start has most recently passed — models/season.js's rule.
    const { rows: [season] } = await prod.query(
      `SELECT name, "startDate", "endDate" FROM season
        WHERE "startDate" <= NOW() ORDER BY "startDate" DESC LIMIT 1`);
    if (!season) fail('production has no current season');
    console.log(`season ${season.name} (${season.startDate} → ${season.endDate})`);
    console.log(APPLY ? 'APPLYING' : 'dry run — nothing will be written (--apply to write)');

    const pulled = [];
    for (const t of TABLES) {
      const srcCols = await columnsOf(prod, t.name);
      const dstCols = new Set((await columnsOf(local, t.name)).map(c => c.column_name));
      if (!dstCols.size) fail(`local database has no ${t.name} table — run tools/local-db.sh load first`);

      for (const c of srcCols) {
        if (c.data_type === 'bytea' && !KNOWN_BYTEA.has(`${t.name}.${c.column_name}`)) {
          fail(`${t.name}.${c.column_name} is bytea and this script does not know what it holds. ` +
               'Decide how it is scrubbed (see sanitise.sql) before syncing it.');
        }
      }

      const omit = new Set(t.omit || []);
      const cols = srcCols.map(c => c.column_name).filter(c => !omit.has(c) && dstCols.has(c));
      const missingLocally = srcCols.map(c => c.column_name).filter(c => !omit.has(c) && !dstCols.has(c));

      // For player, whether each contact column HAS a value — never the value.
      const presence = t.name === 'player'
        ? ', ' + CONTACT_COLUMNS.map(c => `(${q(c)} IS NOT NULL) AS ${q('has_' + c)}`).join(', ')
        : '';
      const params = t.where ? [season.startDate, season.endDate] : [];
      const { rows } = await prod.query(
        `SELECT ${cols.map(q).join(', ')}${presence} FROM ${q(t.name)}
          ${t.where ? 'WHERE ' + t.where : ''} ORDER BY id`, params);

      pulled.push({ t, cols, rows, missingLocally });
      console.log(`  ${t.name.padEnd(17)} ${String(rows.length).padStart(6)} rows` +
        (missingLocally.length ? `   (not in local schema, skipped: ${missingLocally.join(', ')} — a migration not applied locally?)` : ''));
    }
    await prod.query('COMMIT');

    // Counts worth knowing before writing anything.
    const fixtureIds = pulled.find(p => p.t.name === 'fixture').rows.map(r => r.id);
    const { rows: [{ n: localOnly }] } = await local.query(
      `SELECT count(*) AS n FROM fixture WHERE ${SEASON_RANGE} AND NOT (id = ANY($3::int[]))`,
      [season.startDate, season.endDate, fixtureIds]);
    console.log(`  local fixtures this season that production does not have: ${localOnly}` +
      ' (left alone — dev-fixtures.sql adds some on purpose)');

    if (!APPLY) return;

    await local.query('BEGIN');
    await local.query('SET LOCAL session_replication_role = replica');

    for (const { t, cols, rows } of pulled) {
      if (t.replaceByFixture) {
        const del = await local.query('DELETE FROM game WHERE fixture = ANY($1::int[])', [fixtureIds]);
        console.log(`  game: cleared ${del.rowCount} local rows for the synced fixtures`);
      }
      const updates = cols.filter(c => c !== 'id').map(c => `${q(c)} = EXCLUDED.${q(c)}`).join(', ');
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const values = [];
        const tuples = batch.map(r => '(' + cols.map(c => { values.push(r[c]); return '$' + values.length; }).join(', ') + ')');
        await local.query(
          `INSERT INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES ${tuples.join(', ')}
           ON CONFLICT (id) DO ${updates ? 'UPDATE SET ' + updates : 'NOTHING'}`, values);
      }

      if (t.name === 'player') await rebuildContacts(local, rows, localKey);
      if (t.draft) await scrubDrafts(local, t.name, rows.map(r => r.id));

      await local.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT max(id) FROM ${q(t.name)}), 1))
          WHERE pg_get_serial_sequence($1, 'id') IS NOT NULL`, [t.name]);
      console.log(`  ${t.name}: wrote ${rows.length}`);
    }

    await local.query('SET LOCAL session_replication_role = origin');
    console.log('  re-validating every foreign key');
    const repairs = fs.readFileSync(path.join(__dirname, 'seed-repairs.sql'), 'utf8');
    await local.query(repairs.slice(repairs.indexOf('-- ── re-validate every foreign key')));

    await local.query('COMMIT');
    await local.query(`ANALYZE ${TABLES.map(t => q(t.name)).join(', ')}`);
    console.log('done');
  } catch (err) {
    await local.query('ROLLBACK').catch(() => {});
    console.error('sync failed, nothing written: ' + err.message);
    process.exitCode = 1;
  } finally {
    await prod.end();
    await local.end();
  }
}

// The same aliases sanitise.sql builds, for exactly the players production has a value
// for. Recomputed every run, so a renamed player's alias follows the name.
async function rebuildContacts(local, rows, key) {
  const ids = col => rows.filter(r => r['has_' + col] === 't' || r['has_' + col] === true).map(r => r.id);
  const all = rows.map(r => r.id);
  const alias = `'bigcoops+' || lower(regexp_replace(coalesce(first_name,'') || coalesce(family_name,''), '[^a-zA-Z0-9]', '', 'g')) || '@gmail.com'`;

  await local.query(
    `UPDATE player SET "playerEmail" = CASE WHEN id = ANY($2::int[]) THEN pgp_sym_encrypt(${alias}, $1) END
      WHERE id = ANY($3::int[])`, [key, ids('playerEmail'), all]);
  await local.query(
    `UPDATE player SET "authEmail" = CASE WHEN id = ANY($2::int[]) THEN pgp_sym_encrypt(${alias}, $1) END
      WHERE id = ANY($3::int[])`, [key, ids('authEmail'), all]);
  // A phone number is kept if it already has one, so it does not change on every run.
  await local.query(
    `UPDATE player SET "playerTel" = CASE
        WHEN NOT (id = ANY($2::int[])) THEN NULL
        WHEN "playerTel" IS NOT NULL THEN "playerTel"
        ELSE pgp_sym_encrypt('07700 900' || lpad((floor(random()*1000))::int::text, 3, '0'), $1) END
      WHERE id = ANY($3::int[])`, [key, ids('playerTel'), all]);
}

async function scrubDrafts(local, table, ids) {
  const prefix = table === 'messer_scorecard' ? 'messer' : 'draft';
  const cols = new Set((await columnsOf(local, table)).map(c => c.column_name));
  const sets = [];
  if (cols.has('scoresheet-url')) sets.push(`"scoresheet-url" = NULL`);
  if (cols.has('email')) {
    sets.push(`email = CASE WHEN email IS NULL OR email = '' THEN email ELSE 'bigcoops+${prefix}' || id || '@gmail.com' END`);
  }
  if (cols.has('confirmToken')) {
    sets.push(`"confirmToken" = CASE WHEN "confirmToken" IS NULL OR "confirmToken" = '' THEN "confirmToken"
                                     ELSE 'local-' || md5(random()::text) END`);
  }
  await local.query(`UPDATE ${q(table)} SET ${sets.join(', ')} WHERE id = ANY($1::int[])`, [ids]);
}

main().catch(err => fail(err.message));
