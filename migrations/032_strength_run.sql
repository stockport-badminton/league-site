-- Team strength: one row per nightly run (/admin/team-strength, utils/teamStrength.js).
--
-- The run fits a points-based rating to every game since 2018, then predicts the coming
-- week's fixtures, plays out the rest of the season and checks each club's team order.
-- None of that is wanted on the publish path, so it is computed once a night and kept
-- here whole: `payload` is everything the page shows, as of `ran_at`.
--
-- Only the latest row is read. models/teamStrength.js keeps the last 14 so a bad night can
-- be compared with the one before; a payload is a few hundred KB.

CREATE TABLE IF NOT EXISTS strength_run (
  id       SERIAL PRIMARY KEY,
  ran_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  season   TEXT NOT NULL,
  caller   TEXT NOT NULL,
  games    INTEGER NOT NULL,
  took_ms  INTEGER NOT NULL,
  payload  JSONB NOT NULL
);

-- RLS on and no policy, as the other tables the app alone reads (030, 031).
ALTER TABLE strength_run ENABLE ROW LEVEL SECURITY;
