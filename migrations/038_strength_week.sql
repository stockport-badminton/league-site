-- Weekly snapshots of the points-based rating (utils/teamStrength.js), for charting it over
-- time beside the ELO (superadmin only: /elo-chart and a player's game stats page).
--
-- The ELO leaves its history behind in every game row; this rating is a fit to the whole
-- history at a date, so its history has to be made. `as_of` is a Monday: the fit saw every
-- game played before that Monday (UK) and nothing after, so a past week is never revised with
-- hindsight. Only weeks with Stockport games in the seven days before are kept (no summers,
-- no 2020/21). The nightly run adds the newest week and refits any of the last four whose game
-- count has changed (a late result, a Manchester import); tools/strength-history.js fills in
-- the past.

CREATE TABLE IF NOT EXISTS strength_week (
  as_of       DATE PRIMARY KEY,
  games       INTEGER NOT NULL,              -- games the fit saw: a change means it is stale
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  caller      TEXT NOT NULL
);

-- Every one of our players with a game in the year before `as_of`. No foreign key to player:
-- a merged duplicate's rows are history, and must not block the merge.
CREATE TABLE IF NOT EXISTS strength_week_player (
  as_of   DATE NOT NULL REFERENCES strength_week (as_of) ON DELETE CASCADE,
  player  INTEGER NOT NULL,
  rating  INTEGER NOT NULL,                  -- the display scale: 1500 + 1000 × strength
  se      INTEGER NOT NULL,                  -- its standard error, on the same scale
  PRIMARY KEY (player, as_of)
);

-- RLS on and no policy, as the other tables the app alone reads (030, 031, 032).
ALTER TABLE strength_week ENABLE ROW LEVEL SECURITY;
ALTER TABLE strength_week_player ENABLE ROW LEVEL SECURITY;
