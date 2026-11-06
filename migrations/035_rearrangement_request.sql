-- Fixture rearrangement emails, waiting for the results secretary.
--
-- Captains and secretaries agree a rearrangement between themselves and email the league,
-- usually with the opposition copied in. Those emails were read and the change entered by
-- hand through the superadmin modal on the results page. Forwarding one to
-- rearrangements@stockport-badminton.co.uk now lands it here instead
-- (contactusController.distribution_list), with a first reading of it — the dates it
-- mentions, the clubs it names, the fixture and new date those point at — for
-- /admin/rearrangements to confirm.
--
-- Nothing here is ever applied automatically. `reading` is what utils/rearrangementEmail.js
-- made of the email; the page shows it beside the email, every part editable, and the one
-- write goes through Fixture.rearrangeById.
--
-- `message_id` is unique because SNS delivers at least once (as registration_request, 020).
--
-- `reading`: { dates: [{ ymd, raw, role }], clubs: [id], fixtureId, newDate, noDateYet }
-- `outcome`: null until applied, then { action: 'rearranged' | 'rearranging', fixtureId,
--   replacementId, date } — what was actually written, not what the email said.
--
-- TIMESTAMPTZ for the same reason as social_token: instants compared with now().

CREATE TABLE IF NOT EXISTS rearrangement_request (
  id            SERIAL PRIMARY KEY,
  message_id    TEXT NOT NULL UNIQUE,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  forwarded_by  TEXT,
  original_from TEXT,
  subject       TEXT,
  body_text     TEXT,
  reading       JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome       JSONB,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'done', 'dismissed')),
  closed_at     TIMESTAMPTZ,
  closed_by     TEXT
);

CREATE INDEX IF NOT EXISTS rearrangement_request_status_idx
  ON rearrangement_request (status, received_at DESC);

-- RLS on and no policy, as registration_request (020) and social_token (019) explain.
ALTER TABLE rearrangement_request ENABLE ROW LEVEL SECURITY;
