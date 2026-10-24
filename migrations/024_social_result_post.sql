-- Published results waiting to be posted to Facebook and Instagram (HARD-47).
--
-- Until Oct 2026 these were posted inside the request that publishes a result, one target
-- after another: 26–33 s a publish, and 52 s on 24 Oct, against Firebase Hosting's 60 s cut
-- (CLAUDE.md 1bc). The four Meta targets were 92–95% of that time. So publishing a result
-- now only writes rows here, and the scheduled job `sbl-results-meta` posts them
-- (controllers/metaResultsController.js). Threads met the same problem first and has its
-- own table, threads_result_post (migration 021), whose rules this copies.
--
-- One row per fixture AND target, because the outcome is per target: a run that posted the
-- Page and failed Instagram retries Instagram alone, and "did every result reach every
-- target" is a query. `target` is a utils/metaPublisher kind. Named generically so Threads
-- can move in later; it stays where it is for now because it works.
--
-- A fixture already queued for a target is never re-queued by a republish; to try a failed
-- row again, set its state back to 'pending' with a reviewed script.
--
-- `state`:
--   pending  waiting for the job
--   posting  claimed by a run. A row left here means a run died between asking Meta to
--            publish and recording the answer, so whether it is live is unknown. NOT
--            retried automatically, because the retry might be a second post; the audit
--            digest reports it (`meta-result-posts`) for a person to look and decide.
--   posted   `media_id` is the post (story ids comma-joined)
--   failed   gave up; `last_error` says why
--   skipped  deliberately not posted (too old, or the fixture no longer has a result);
--            `last_error` says which
--
-- TIMESTAMPTZ for the same reason as threads_result_post: instants compared with now().

CREATE TABLE IF NOT EXISTS social_result_post (
  id          SERIAL PRIMARY KEY,
  fixture_id  INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
  target      VARCHAR(32) NOT NULL
              CHECK (target IN ('page', 'instagram', 'instagram-story', 'page-story')),
  state       VARCHAR(16) NOT NULL DEFAULT 'pending'
              CHECK (state IN ('pending', 'posting', 'posted', 'failed', 'skipped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  queued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at  TIMESTAMPTZ NULL,
  posted_at   TIMESTAMPTZ NULL,
  media_id    VARCHAR(128) NULL,
  last_error  TEXT NULL,
  UNIQUE (fixture_id, target)
);

CREATE INDEX IF NOT EXISTS social_result_post_pending
  ON social_result_post (id) WHERE state = 'pending';

-- RLS on and no policy, as threads_result_post: the app's role has BYPASSRLS, and a
-- `TO postgres` policy would stop `tools/local-db.sh load`, whose database has no such role.
ALTER TABLE social_result_post ENABLE ROW LEVEL SECURITY;
