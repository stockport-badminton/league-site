-- A scorecard filled in live, at the match, by anybody holding its link (proof of concept).
--
-- The paper card stays the reference; this is the copy that is already typed in. Players
-- at the match open it from a QR code or a shared link and enter each game as it finishes,
-- so everybody can see who is on next and how the match stands. When both captains have
-- signed it off, it is filed into `scorecardstore` as an ordinary draft, and from there the
-- results secretary publishes it exactly as they publish an uploaded card — so this table
-- never writes a result and needs no publish authority of its own.
--
-- Three secrets, because there are three kinds of holder:
--   edit_token   anyone at the match: view, pick players, enter scores
--   home_token   the home captain: all of the above, plus signing for the home side
--   away_token   the away captain: likewise for the away side
-- Only the person who started the card (or a superadmin) is shown the captains' links.
--
-- `players` maps a slot (homeMan1 … awayLady3) to a player id; 0 is "No Player", as on the
-- paper form. `games` maps "1" … "18" to {"h": 21, "a": 17, "by": "...", "at": "..."}.
-- JSONB rather than 24 + 36 columns because the card is written one cell at a time by
-- several phones, and a cell is a jsonb_set; the fixed-width shape is produced once, at
-- filing, by utils/liveScorecard.js toDraftRow.
--
-- Two counters, and they are not the same thing:
--   version  the CONTENT. A captain signs a specific version, and any edit bumps it and
--            clears both signatures, so a signature always covers exactly what was shown.
--   rev      ANY change, signatures included. The phones poll on this.
--
-- `status`:
--   live     being filled in
--   filing   both signed; claimed by the request that is writing the draft. A conditional
--            UPDATE takes this, so two captains signing in the same second file it once.
--   filed    written to scorecardstore as `draft_id`; read-only from then on

CREATE TABLE IF NOT EXISTS live_scorecard (
  id              SERIAL PRIMARY KEY,
  fixture_id      INTEGER NOT NULL UNIQUE REFERENCES fixture(id) ON DELETE CASCADE,
  edit_token      VARCHAR(64) NOT NULL,
  home_token      VARCHAR(64) NOT NULL,
  away_token      VARCHAR(64) NOT NULL,
  players         JSONB NOT NULL DEFAULT '{}'::jsonb,
  games           JSONB NOT NULL DEFAULT '{}'::jsonb,
  version         INTEGER NOT NULL DEFAULT 1,
  rev             INTEGER NOT NULL DEFAULT 1,
  status          VARCHAR(16) NOT NULL DEFAULT 'live'
                  CHECK (status IN ('live', 'filing', 'filed')),
  home_signed_by  VARCHAR(80) NULL,
  home_signed_at  TIMESTAMPTZ NULL,
  away_signed_by  VARCHAR(80) NULL,
  away_signed_at  TIMESTAMPTZ NULL,
  draft_id        INTEGER NULL,
  created_by      VARCHAR(128) NOT NULL,
  created_email   VARCHAR(200) NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on and no policy, as threads_result_post: the app's role has BYPASSRLS, and a
-- `TO postgres` policy would stop `tools/local-db.sh load`, whose database has no such role.
ALTER TABLE live_scorecard ENABLE ROW LEVEL SECURITY;
