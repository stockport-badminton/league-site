-- Team strength: games from other leagues (utils/externalLeagues.js).
--
-- Players who also play in the Tameside and Manchester leagues get their ratings from
-- those games too: in a walk-forward backtest, adding both leagues' 40,000 games called
-- 76.0% of Stockport results right against 75.3%, and 77.7% against 75.4% where a player
-- had few games here. Used by the superadmin team-strength page only, never published.
--
-- Players are names, as the other leagues record them, not ids: neither league shares an
-- id with ours (Tameside's player table was once a copy of ours, so about half its ids
-- coincide with ours by accident). The nightly run links a name to one of our players
-- only on a one-to-one exact match with the same gender.
--
-- `source_key` is the other league's identity for the game, so an import can be re-run:
-- Tameside's game id, or Manchester's date, teams, pairing and game number.

CREATE TABLE IF NOT EXISTS external_game (
  id           SERIAL PRIMARY KEY,
  league       TEXT NOT NULL CHECK (league IN ('tameside', 'mcrbl')),
  source_key   TEXT NOT NULL,
  played_on    DATE NOT NULL,
  game_type    TEXT NOT NULL,
  mixed        BOOLEAN NOT NULL,
  home1        TEXT NOT NULL,
  home2        TEXT NOT NULL,
  away1        TEXT NOT NULL,
  away2        TEXT NOT NULL,
  -- 'Male' / 'Female', or NULL where the card does not say (Manchester's Open division)
  home1_gender TEXT,
  home2_gender TEXT,
  away1_gender TEXT,
  away2_gender TEXT,
  home_score   INTEGER NOT NULL,
  away_score   INTEGER NOT NULL,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league, source_key)
);

CREATE INDEX IF NOT EXISTS external_game_played_on ON external_game (played_on);

-- RLS on and no policy, as the other tables only the app reads (030, 031, 032).
ALTER TABLE external_game ENABLE ROW LEVEL SECURITY;
