#!/usr/bin/env node
//
// Applies one migration file.
//
// Two things here were wrong and are worth not reintroducing.
//
// 1. It split the file on `;` with String.split, so a semicolon inside a comment was a
//    statement boundary. The chunk after it began with whatever prose followed — bare
//    words, because the `--` that made it a comment was in the previous chunk — and
//    Postgres rejected it. migrations/011_scorecard_confirm_token.sql had two semicolons
//    in its header comment, and its ALTER TABLE sat in the chunk *behind* that syntax
//    error, so the column would never have been created. The failure is loud, but it
//    reads as a broken migration rather than a broken runner, which is the expensive part:
//    the next person edits their SQL looking for a mistake that is not there. Statements
//    are now split by utils/sqlScan.js, which knows what a comment, a literal and a
//    dollar-quoted body are. A `$$ ... $$` function body is the case that makes this more
//    than cosmetic — it is full of semicolons and the old splitter shredded it.
//
// 2. It called dotenv directly, which loads `.env` and nothing else — so it could only
//    ever target PRODUCTION, with no way to rehearse. It goes through tools/lib/loadEnv
//    like every other tool now: the local database by default, `--prod` for production.
//
// 3. Nothing recorded which migrations had run (HARD-32). Re-applying was safe only
//    because the files say IF NOT EXISTS, and "has this run against production yet?" was
//    answered by remembering. Every file this runs is now recorded in `schema_migrations`
//    (migrations/025) with a hash of its bytes, so applying one twice is a recorded no-op,
//    and a file edited since it ran is refused rather than reported as done.
//
// usage:
//   node run-migration.js <file.sql> [--prod]                  apply it, and record it
//   node run-migration.js <file.sql> --record-only [--prod]    record it WITHOUT running it,
//                                                              for a file the schema shows
//                                                              already applied
//   node run-migration.js --status [--prod]                    every file against the record

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { splitStatements, preview } = require('./utils/sqlScan');

const MIGRATIONS = path.join(__dirname, 'migrations');
// The file that creates the ledger. The only one a database without a ledger will accept.
const LEDGER_MIGRATION = '025_schema_migrations.sql';

// Of the bytes, not a decoded string, so it is the same digest `shasum -a 256` prints in
// tools/local-db.sh.
function fileHash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function ledgerExists(conn) {
  const [rows] = await conn.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present");
  return rows[0].present === true;
}

async function recorded(conn, file) {
  const [rows] = await conn.query(
    'SELECT sha256, how, recorded_at FROM schema_migrations WHERE filename = ?',
    [file]
  );
  return rows[0] || null;
}

class Refusal extends Error {}

// Applies (or with recordOnly, records) one migration. Returns what happened:
// 'applied', 'recorded' or 'already-applied'. Throws a Refusal when the file must not run.
async function applyMigration(conn, file, bytes, { recordOnly = false, log = console.log } = {}) {
  const hash = fileHash(bytes);
  const hasLedger = await ledgerExists(conn);

  if (!hasLedger && file !== LEDGER_MIGRATION) {
    throw new Refusal(
      `this database has no schema_migrations table, so nothing would record that ` +
      `${file} ran. Apply ${LEDGER_MIGRATION} first.`
    );
  }

  if (hasLedger) {
    const row = await recorded(conn, file);
    if (row && row.sha256.trim() === hash) {
      log(`· ${file} is already recorded (${row.how} ${new Date(row.recorded_at).toISOString()}); nothing to do`);
      return 'already-applied';
    }
    if (row) {
      throw new Refusal(
        `${file} has changed since it was recorded (${row.how}): recorded ${row.sha256.trim().slice(0, 12)}…, ` +
        `file now ${hash.slice(0, 12)}…. The database has the old version. Write a new ` +
        `migration for the difference rather than editing one that has run.`
      );
    }
  }

  if (recordOnly) {
    // A backfill is only as good as the evidence the schema already has the file in it.
    // The caller has to have looked; this just writes down that they did.
    await conn.query(
      "INSERT INTO schema_migrations (filename, sha256, how) VALUES (?, ?, 'backfilled')",
      [file, hash]
    );
    log(`✓ ${file} recorded as backfilled, not run`);
    return 'recorded';
  }

  const statements = splitStatements(bytes.toString('utf8'));
  log(`  ${statements.length} statement${statements.length === 1 ? '' : 's'}`);
  for (const statement of statements) {
    // Log the first line of real SQL, not the paragraph of comment above it — echoing the
    // comment back tells you nothing about which statement failed.
    const label = preview(statement);
    try {
      await conn.query(statement);
      log(`✓ ${label}`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        log(`· ${label}`);
        log(`    (already exists, skipping)`);
        continue;
      }
      log(`✗ ${label}`);
      log(`    ${err.message}`);
      throw err;
    }
  }

  // Recorded only once every statement has succeeded, so a failed run leaves no row and the
  // next attempt runs it again. Not one transaction with the statements: an "already
  // exists" inside a transaction aborts it, and tolerating those is what lets 003 replay.
  await conn.query(
    "INSERT INTO schema_migrations (filename, sha256, how) VALUES (?, ?, 'applied')",
    [file, hash]
  );
  return 'applied';
}

// Every numbered file in migrations/, against what this database has recorded.
async function status(conn) {
  const files = fs.readdirSync(MIGRATIONS).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  const hasLedger = await ledgerExists(conn);
  const rows = new Map();
  if (hasLedger) {
    const [all] = await conn.query('SELECT filename, sha256, how, recorded_at FROM schema_migrations');
    for (const r of all) rows.set(r.filename, r);
  }
  return {
    hasLedger,
    files: files.map(file => {
      const row = rows.get(file);
      const hash = fileHash(fs.readFileSync(path.join(MIGRATIONS, file)));
      if (!row) return { file, state: 'not recorded' };
      return { file, state: row.sha256.trim() === hash ? row.how : `${row.how}, file changed since`, at: row.recorded_at };
    }),
    // Recorded here but no longer in the repo — renamed or deleted after it ran.
    unknown: [...rows.keys()].filter(f => !files.includes(f)).sort(),
  };
}

function targetHost() {
  const m = /@([^:/?]+)/.exec(process.env.DATABASE_URL || '');
  return m ? m[1] : '(no DATABASE_URL)';
}

async function main(args) {
  const recordOnly = args.includes('--record-only');
  const file = args.filter(a => !a.startsWith('--'))[0];

  const { prod } = require('./tools/lib/loadEnv').loadEnv({ argv: args });
  const label = prod ? '  (PRODUCTION)' : '  (local)';
  const db = require('./db_connect');
  db.connect();
  const conn = await db.otherConnect();

  if (args.includes('--status')) {
    console.log(`target: ${targetHost()}${label}`);
    const s = await status(conn);
    if (!s.hasLedger) console.log(`no schema_migrations table: apply ${LEDGER_MIGRATION} first`);
    for (const f of s.files) {
      console.log(`  ${f.file.padEnd(44)} ${f.state}${f.at ? '  ' + new Date(f.at).toISOString().slice(0, 16) : ''}`);
    }
    for (const f of s.unknown) console.log(`  ${f.padEnd(44)} recorded, but no such file`);
    return;
  }

  if (!file) {
    console.error('usage: node run-migration.js <file.sql> [--record-only] [--prod] | --status [--prod]');
    process.exit(1);
  }
  const full = path.join(MIGRATIONS, file);
  if (!fs.existsSync(full)) {
    console.error(`✗ No such migration: ${path.relative(__dirname, full)}`);
    process.exit(1);
  }

  console.log(`${recordOnly ? 'Recording' : 'Running'} migration: ${file}`);
  console.log(`  target: ${targetHost()}${label}`);
  const outcome = await applyMigration(conn, file, fs.readFileSync(full), { recordOnly });
  if (outcome === 'applied') console.log(`✓ Migration ${file} completed successfully, and recorded`);
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`✗ ${err instanceof Refusal ? 'Refused' : 'Migration failed'}: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { applyMigration, status, fileHash, Refusal, LEDGER_MIGRATION };
