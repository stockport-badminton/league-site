-- Player registration requests that arrived by email, waiting for the results secretary.
--
-- Registrations reach the league as email — from club secretaries, captains and players
-- themselves, often several names to a message — and were handled by copying each name
-- into the roster editor by hand. Forwarding such an email to
-- registrations@stockport-badminton.co.uk now lands it here instead
-- (contactusController.distribution_list), with the names it appears to contain already
-- pulled out, for /admin/player-requests to work through.
--
-- Nothing here is ever applied automatically. `candidates` is a *reading* of the email,
-- and a wrong reading is corrected on the page before anything touches `player`; the
-- writes themselves go through the roster API that the club pages use.
--
-- `message_id` is unique because SNS delivers at least once: a redelivered notification
-- must not queue the same email twice.
--
-- `candidates` is a JSON array, one element per person the email seems to name:
--   { first, family, gender, team, raw, outcome, playerId }
-- `outcome` is null until that person is dealt with, then 'created' | 'attached' |
-- 'transferred' | 'skipped'. It is per person, not per email, because a message naming
-- six players is rarely finished in one sitting.
--
-- TIMESTAMPTZ for the same reason as social_token: instants compared with now(), which
-- `pg` would otherwise read in the laptop's local time.

CREATE TABLE IF NOT EXISTS registration_request (
  id            SERIAL PRIMARY KEY,
  message_id    TEXT NOT NULL UNIQUE,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  forwarded_by  TEXT,
  original_from TEXT,
  subject       TEXT,
  body_text     TEXT,
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidates    JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'done', 'dismissed')),
  closed_at     TIMESTAMPTZ,
  closed_by     TEXT
);

CREATE INDEX IF NOT EXISTS registration_request_status_idx
  ON registration_request (status, received_at DESC);

-- RLS on and no policy, exactly as social_token (019) explains: the app connects with
-- BYPASSRLS, and a `TO postgres` policy would stop `tools/local-db.sh load`, which has no
-- such role. The bodies are other people's email, so default-deny is the right shape.
ALTER TABLE registration_request ENABLE ROW LEVEL SECURITY;
