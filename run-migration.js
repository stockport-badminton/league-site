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
//    like every other tool now: production by default, `--local` to ask for the
//    development database deliberately.
//
// Note what this still does NOT do: there is no schema_migrations table, so nothing
// records which migrations have run. Re-applying is safe only because the files are
// written with IF NOT EXISTS and the runner tolerates "already exists". That gap is real
// and is noted in HARD-18 rather than fixed here.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const local = args.includes('--local');
const migrationFile = args.filter(a => !a.startsWith('--'))[0];

require('./tools/lib/loadEnv').loadEnv({ local });
const db = require('./db_connect');
const { splitStatements, preview } = require('./utils/sqlScan');

function targetHost() {
  const m = /@([^:/?]+)/.exec(process.env.DATABASE_URL || '');
  return m ? m[1] : '(no DATABASE_URL)';
}

async function runMigration(file) {
  const full = path.join(__dirname, 'migrations', file);
  if (!fs.existsSync(full)) {
    console.error(`✗ No such migration: ${path.relative(__dirname, full)}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(full, 'utf8');
  const statements = splitStatements(sql);

  console.log(`Running migration: ${file}`);
  console.log(`  target: ${targetHost()}${local ? '  (--local)' : ''}`);
  console.log(`  ${statements.length} statement${statements.length === 1 ? '' : 's'}`);

  db.connect();
  const conn = await db.otherConnect();

  for (const statement of statements) {
    // Log the first line of real SQL, not the paragraph of comment above it — echoing the
    // comment back tells you nothing about which statement failed.
    const label = preview(statement);
    try {
      await conn.query(statement);
      console.log(`✓ ${label}`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`· ${label}`);
        console.log(`    (already exists, skipping)`);
        continue;
      }
      console.error(`✗ ${label}`);
      console.error(`    ${err.message}`);
      throw err;
    }
  }

  console.log(`✓ Migration ${file} completed successfully`);
}

if (!migrationFile) {
  console.error('usage: node run-migration.js <file.sql> [--local]');
  process.exit(1);
}

runMigration(migrationFile)
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`✗ Migration failed: ${err.message}`);
    process.exit(1);
  });
