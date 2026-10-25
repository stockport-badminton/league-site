# HARD-32 — nothing records which migrations have run

**Severity:** low · **Wave:** C · **Blocked by:** nothing
**Owns:** `run-migration.js`, `tools/local-db.sh`, a new `schema_migrations` table
**Sources:** noted as out of scope in HARD-18, split out 12 Sep 2026

## Why

There is no `schema_migrations` table. Nothing anywhere records that `011` has been
applied to production, or which of the numbered files a given database has seen. What
stands in for it:

- the migration files are written with `IF NOT EXISTS`, so re-applying is usually harmless;
- `run-migration.js` treats `already exists` as a skip rather than an error;
- `tools/local-db.sh load` drops the schema and replays everything from nothing, so the
  local database is defined by the files rather than by a history.

That combination works, and it is why this is low severity rather than urgent. What it
cannot answer is the question you actually want answered before a deploy: **has this
migration run against production yet?** Today that is answered by remembering, or by
looking at the schema and inferring. CLAUDE.md already carries the consequence — `011`'s
own header says in capitals that it must be applied *before* the code that reads it is
deployed, because deploying first makes every scorecard submission fail on an unknown
column. Nothing enforces that ordering, and nothing would notice it had been got wrong
until a captain's submission failed.

It is also the reason a migration cannot safely do anything that is not idempotent. Every
file so far is `ADD COLUMN IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS` — a discipline
that holds only while everyone remembers why.

## What to do

1. A `schema_migrations` table: filename, applied-at, and ideally a hash of the file so an
   edited migration is visibly not the one that ran.
2. `run-migration.js` records a successful application and refuses (or skips with a clear
   message) one already recorded. Keep `--local`.
3. Decide what to do about the migrations already applied — the honest options are to
   backfill the table from the filenames known to have run, or to start recording from now
   and accept that history is blank. Backfilling is a guess unless the schema confirms it.
4. `tools/local-db.sh load` should populate the table as it replays, or the local database
   will look permanently un-migrated.

## Acceptance criteria

- Applying a migration twice is a recorded no-op, not a reliance on `IF NOT EXISTS`.
- The table says which migrations a database has had, and it is right for local.
- `npm test` green.

## Out of scope

- A migration framework. This is a table and two queries; anything larger is a different
  decision for a site with 14 migration files.
- Rewriting existing migrations to drop their `IF NOT EXISTS` guards. Belt and braces is
  fine.

## What was done (25 Oct 2026)

- **`migrations/025_schema_migrations.sql`**: `filename`, `sha256` of the file's bytes,
  `how` (`applied` / `replayed` / `backfilled`), `recorded_at`. RLS on and no policy, as 024.
- **`run-migration.js`** checks the ledger before running anything. A file recorded with the
  same hash is a no-op that says when and how it was recorded; a file whose hash differs is
  **refused** (write a new migration for the difference); a database with no ledger refuses
  every file except 025. It records only after every statement has succeeded, so a failed
  run leaves no row. `--record-only` records without running; `--status` lists every
  numbered file against the record, plus anything recorded that is no longer in the repo.
  The statements and the record are deliberately not one transaction: an "already exists"
  inside a transaction aborts it, and tolerating those is what lets 003 replay.
- **`tools/local-db.sh load`** records each replayed file as `replayed`, hashed with
  `shasum`/`sha256sum`, once every file has gone in and before the seed. `LOCAL_DB_NAME`
  overrides the database name, for rehearsing a load without wiping the working one.
- **Step 3, the history: backfilled on evidence, not on a guess.** The local database is
  built only from the files, so its schema was diffed against production's (columns,
  indexes, constraints, functions, RLS). Every object 001–024 create is on production; the
  differences were all explained (pgcrypto lives in another schema on Supabase, RLS is not
  replayed locally, one constraint differs in case, and production has the two columns and
  three indexes no migration creates). The only data the files write — 005's site setting
  and announcements, 010's blocklist — is there too. So production records 001–024 as
  `backfilled` and 025 as `applied`. `enable-rls-policies.sql` is not numbered, is not
  replayed, and was superseded by `scripts/rls-consolidate-policies.js`; it is left
  unrecorded.

## How it was proved

- Rehearsed against a scratch database built by the real `load`: status after load, a file
  applied twice, a new file applied then edited (refused, both hashes named), a database
  with the ledger dropped (011 refused, 025 accepted), and a backfill followed by an apply.
  The no-op after load is also the proof that the shell's digest matches the runner's.
- `__tests__/unit/migration-ledger.test.js`, 13 tests. With the fix stashed the suite fails
  outright — the old runner has no `applyMigration` to test, which is the finding itself.
- Full Jest: 151 suites, 2,421 tests, all passing.

## Acceptance criteria

- **Applying a migration twice is a recorded no-op** — met; shown locally and by test.
- **The table says which migrations a database has had, and it is right for local** — met;
  `load` writes it, and production's is backfilled on the schema evidence above.
- **`npm test` green** — met.
