-- Access tokens the app has to renew itself, starting with Threads.
--
-- Every other Meta credential here is a Page token, which never expires, so it lives in
-- an environment variable like any other configuration. A Threads token lasts 60 days,
-- and it is renewed by exchanging it for a new one. Cloud Run sets environment variables
-- at deploy, so a refreshed token cannot be written back into one. It has to be state,
-- and this is where it lives.
--
-- Only 24 hours to 60 days old is refreshable. A token nobody refreshes for 60 days is
-- dead, and the only way back is a person logging in again at /admin/threads. So the
-- weekly audit digest reads `expires_at` and `last_error_at` from here
-- (tools/audit/checks.js, `social-token-expiry`).
--
-- One row per platform. `platform` is the key, not an id, because there is exactly one
-- account per platform and the row is replaced on every login.
--
-- `token` is pgp_sym_encrypt'd with DB_PI_KEY, bound as a parameter and never inlined,
-- the same as `player."playerEmail"`. It can publish as the league.
--
-- `generation` goes up on every write. A refresh reads the row, calls Threads, and then
-- writes `WHERE generation = <what it read>`, so a login that lands in between is not
-- overwritten by a refresh of the token it replaced. The timestamp cannot do this job:
-- Postgres keeps microseconds and a JS Date keeps milliseconds, so an equality test on a
-- round-tripped timestamp never matches.
--
-- TIMESTAMPTZ, unlike most of this schema. These are instants compared against now() in
-- both SQL and JavaScript, and `pg` reads a plain TIMESTAMP as the *laptop's* local time,
-- which under BST puts every expiry an hour out.

CREATE TABLE IF NOT EXISTS social_token (
  platform       VARCHAR(32)  PRIMARY KEY,
  account_id     VARCHAR(64)  NOT NULL,
  username       VARCHAR(255) NULL,
  token          BYTEA        NOT NULL,
  obtained_at    TIMESTAMPTZ  NOT NULL,   -- when this token was issued, by login or refresh
  expires_at     TIMESTAMPTZ  NOT NULL,
  refreshed_at   TIMESTAMPTZ  NULL,       -- last successful refresh; NULL straight after a login
  last_error     TEXT         NULL,       -- cleared by the next success, so set means the latest attempt failed
  last_error_at  TIMESTAMPTZ  NULL,
  generation     INTEGER      NOT NULL DEFAULT 1,
  updated_by     VARCHAR(255) NULL,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- RLS on and no policy, so every role but the app's is denied. The app connects as
-- `postgres`, which has BYPASSRLS (CLAUDE.md, "The RLS on this database is inert").
--
-- There is deliberately no `TO postgres` policy like the other tables have. The local
-- database's role is `sdbl` and it has no `postgres` role, so that statement would stop
-- `tools/local-db.sh load`. It would also add nothing: BYPASSRLS never consults a policy.
ALTER TABLE social_token ENABLE ROW LEVEL SECURITY;
