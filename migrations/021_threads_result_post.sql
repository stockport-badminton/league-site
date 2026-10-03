-- Published results waiting to be posted to Threads.
--
-- Facebook, Instagram and the story are posted inside the request that publishes a result
-- (Fixture.sendResultZap). Threads cannot be: a container has to be waited on before it can
-- be published, Meta recommends about 30 seconds, and the publish request is already doing
-- the Meta posts in front of Firebase Hosting's 60-second cut (CLAUDE.md 1bc). So publishing
-- a result only writes a row here, and the scheduled job `sbl-results-threads` posts it
-- (controllers/threadsResultsController.js).
--
-- One row per fixture, so publishing the same result twice cannot post it twice. A row is
-- never re-queued by a republish; to try a failed one again, set its state back to
-- 'pending' with a reviewed script.
--
-- `state`:
--   pending  waiting for the job
--   posting  claimed by a run. A row left here means a run died between creating the post
--            and recording it, so whether it was published is unknown. It is NOT retried
--            automatically, because the retry might be a second post; the audit digest
--            reports it (`threads-result-posts`) for a person to look at Threads and decide.
--   posted   `media_id` is the Threads post
--   failed   gave up; `last_error` says why
--   skipped  deliberately not posted (too old, or the fixture no longer has a result);
--            `last_error` says which
--
-- TIMESTAMPTZ for the same reason as social_token: instants compared with now(), which
-- `pg` would otherwise read in the laptop's local time.

CREATE TABLE IF NOT EXISTS threads_result_post (
  id          SERIAL PRIMARY KEY,
  fixture_id  INTEGER NOT NULL UNIQUE REFERENCES fixture(id) ON DELETE CASCADE,
  state       VARCHAR(16) NOT NULL DEFAULT 'pending'
              CHECK (state IN ('pending', 'posting', 'posted', 'failed', 'skipped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  queued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at  TIMESTAMPTZ NULL,
  posted_at   TIMESTAMPTZ NULL,
  media_id    VARCHAR(64) NULL,
  last_error  TEXT NULL
);

CREATE INDEX IF NOT EXISTS threads_result_post_pending
  ON threads_result_post (id) WHERE state = 'pending';

-- RLS on and no policy, as social_token: the app's role has BYPASSRLS, and a `TO postgres`
-- policy would stop `tools/local-db.sh load`, whose database has no such role.
ALTER TABLE threads_result_post ENABLE ROW LEVEL SECURITY;
