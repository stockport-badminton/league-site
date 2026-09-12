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
