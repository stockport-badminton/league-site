-- Tracking which clubs have sent in their player registration forms.
--
-- Every club must return the league's team registration form before its first fixture,
-- and chasing that is currently done from memory. This table is what the daily reminder
-- and /admin/registrations read.
--
-- KEYED BY SEASON, and that is the whole design. The task runs once a season, so the
-- status has to reset every season -- and the cheapest correct reset is not to reset at
-- all: a new season simply has no rows, which reads as "nothing received, nothing
-- chased". No cron to clear it, nothing to remember in July, and last season's record is
-- still there to look back at. A `received` boolean on `club` would have needed exactly
-- the annual wipe that nobody would remember to run.
--
-- No row is created until something happens to a club, so absence is meaningful and the
-- table stays small (18 rows a season at most).
--
-- `club` is deliberately NOT a foreign key, matching the rest of this schema, which has
-- none -- see the `orphan-team-refs` and `ghost-teams` checks in tools/audit/checks.js
-- for what that costs. A club is never deleted, only emptied, so the risk here is small.

CREATE TABLE IF NOT EXISTS club_registration (
  id           SERIAL PRIMARY KEY,
  season       VARCHAR(8)  NOT NULL,
  club         INTEGER     NOT NULL,
  received_at  TIMESTAMP   NULL,
  chased_at    TIMESTAMP   NULL,
  chase_count  INTEGER     NOT NULL DEFAULT 0,
  note         TEXT        NULL,
  updated_by   VARCHAR(255) NULL,
  updated_at   TIMESTAMP   NOT NULL DEFAULT now()
);

-- One row per club per season. The upserts in models/clubRegistration.js rely on this
-- constraint by name, so ON CONFLICT has something to target.
CREATE UNIQUE INDEX IF NOT EXISTS club_registration_season_club
  ON club_registration (season, club);

-- The reminder reads one season at a time.
CREATE INDEX IF NOT EXISTS club_registration_season
  ON club_registration (season);
