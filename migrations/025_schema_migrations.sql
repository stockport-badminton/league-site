-- Which migrations this database has had (HARD-32).
--
-- Until Oct 2026 nothing recorded it. Re-applying was safe only because every file is
-- written with IF NOT EXISTS and run-migration.js treated "already exists" as a skip, and
-- the question worth asking before a deploy — has this one run against production yet? —
-- was answered by remembering. 011's header says in capitals that it must be applied
-- before the code that reads it is deployed; nothing could check that it had been.
--
-- One row per file, written by whatever put the file into this database:
--   applied     run-migration.js ran it and every statement succeeded
--   replayed    tools/local-db.sh load rebuilt the database from the files
--   backfilled  recorded without running, for a file the schema shows had already been
--               applied before this table existed (001–024 on production, 25 Oct 2026)
--
-- `sha256` is of the file's bytes when it was recorded, so a migration edited after it ran
-- is visibly not the one that ran: the runner refuses it rather than calling it done.
--
-- Not created by the runner on the fly: a migration describes what the database holds,
-- and this file is how a fresh database gets it. The runner applies this file to a
-- database that has no ledger yet, and refuses every other file until it has.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    VARCHAR(255) PRIMARY KEY,
  sha256      CHAR(64) NOT NULL,
  how         VARCHAR(16) NOT NULL CHECK (how IN ('applied', 'replayed', 'backfilled')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on and no policy, as social_result_post: the app's role has BYPASSRLS, and a
-- `TO postgres` policy would stop `tools/local-db.sh load`, whose database has no such role.
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
