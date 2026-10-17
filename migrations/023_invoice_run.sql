-- One row per annual invoice run, refusals included (HARD-35).
--
-- The 2026 invoice run failed on 1 Sep and nobody was told: the scheduler recorded a red
-- step in a history nobody read, and the next signal would have been a treasurer asking
-- where the invoices were. HARD-23 made the failure honest; this makes it *visible*. The
-- weekly audit digest's `invoice-run` check reads this table and says so once the annual
-- window has closed with nothing sent, or a club's latest outcome is not "sent".
--
-- A run that never happens writes nothing, which is exactly why the check works from the
-- ABSENCE of a row rather than from the presence of a failed one.
--
-- `status`   the HTTP status the run answered: 200 ran, 409 refused (wrong date, no clubs)
-- `outcomes` one element per club the run reached, as
--            {"club": "...", "sent": true|false, "detail": "..."}
--            A run for a single club (POST /league/sendInvoices/:club) has one element, and
--            the check takes each club's LATEST outcome in the season, so re-sending one
--            failed invoice clears that club without re-running the rest.
--
-- TIMESTAMPTZ for the same reason as social_token: an instant compared with now().

CREATE TABLE IF NOT EXISTS invoice_run (
  id        SERIAL PRIMARY KEY,
  season    TEXT        NOT NULL,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  caller    TEXT        NOT NULL,
  forced    BOOLEAN     NOT NULL DEFAULT false,
  status    INTEGER     NOT NULL,
  outcomes  JSONB       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS invoice_run_season_idx ON invoice_run (season, ran_at);

-- RLS on and no policy, as live_scorecard and threads_result_post: the app's role has
-- BYPASSRLS, and a `TO postgres` policy would stop `tools/local-db.sh load`, whose database
-- has no such role. Added after 023 first ran on production without it (17 Oct 2026); the
-- statement is idempotent, so re-running the file is how it was applied.
ALTER TABLE invoice_run ENABLE ROW LEVEL SECURITY;
