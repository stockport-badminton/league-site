-- REARCH-02 step 6: a record of each season rollover.
--
-- tools/season-archive.js copies the live team, club, division, player, venue and messer
-- rows into their history tables (migration 030) as a season's snapshot, and writes one
-- row here in the same transaction. The rollover it replaces, public.clone_season, kept no
-- record at all: nothing said when it ran, so nothing could say whether a past season's
-- names were taken before or after someone began editing the next season's teams.
--
-- One row per season, so a second rollover of the same season fails on the key even if
-- the script's own check were bypassed. row_counts is what the script re-read after
-- writing: {"team": 37, "player": 1160, …}.
--
-- Seasons backfilled from the old archives (step 3) have no row here; their history came
-- from clone_season, whose run time is unknown. The season-history audit check therefore
-- looks at the history rows, and uses this table only to say when a rollover ran.
--
-- Not schema_migrations: that is the record of migration files, keyed by filename and
-- hash, and `run-migration.js --status` reports a row with no file as drift.

CREATE TABLE IF NOT EXISTS season_archive_run (
  season     TEXT PRIMARY KEY REFERENCES season (name),
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ran_by     TEXT NOT NULL DEFAULT current_user,
  row_counts JSONB NOT NULL
);

-- RLS on and no policy, as the history tables (030).
ALTER TABLE season_archive_run ENABLE ROW LEVEL SECURITY;
