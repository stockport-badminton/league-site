# HARD-04 — Crash handlers, graceful shutdown, `/healthz`

**Severity:** high · **Wave:** A · **Blocked by:** nothing
**Owns:** `app.js`
**Sources:** FAIL-1, FAIL-5, FAIL-3

Three small changes to one file. Highest value per line in the backlog.

## Why

**No `unhandledRejection` handler exists anywhere in the codebase.** Node 22 treats an
unhandled rejection as fatal — the process exits. Any promise that rejects without a
`.catch()` (an SES send in a fire-and-forget path, an S3 call, a timer callback) takes
the container down and every in-flight request with it. This is the same class of fault
as the pg pool crash on 6 August, documented in CLAUDE.md; the pool has a listener now,
nothing else does.

**No `SIGTERM` handler.** Cloud Run sends SIGTERM and allows ten seconds before killing
the container. Without a handler the process dies at once, severing whatever was in
flight — on every deploy and every scale-down. Usually a page load; occasionally a
captain submitting a scorecard.

**No health endpoint.** Nothing answers "is the app up *and* can it reach the database".
Today the site being down is discovered when a member emails. A homepage check is a poor
substitute: it can render from a warm instance while Postgres is unreachable.

## What to do

1. **`process.on('unhandledRejection')` and `process.on('uncaughtException')`.** Capture
   to Sentry, log, and — for the rejection case — keep serving. For `uncaughtException`
   the process state is genuinely unknown, so log, flush Sentry, and exit non-zero so
   Cloud Run replaces the instance; that is still far better than dying silently.
   Follow the reasoning already written up for the pg pool handler in `db_connect.js`.
2. **`SIGTERM` / `SIGINT`:** stop accepting new connections, let open requests finish,
   close the pg pool, exit. `app.listen` at `app.js:252` currently discards the server
   object — keep the reference. Cap the wait so a stuck request cannot block shutdown
   past Cloud Run's ten seconds.
3. **`GET /healthz`**, mounted in `app.js` **before** the router and **before**
   `globalLimiter`. Run `SELECT 1`; 200 with `{ ok: true }` when it succeeds, 503 when
   it does not. It must not be in the sitemap (see `controllers/sitemapController.js`)
   and must not consume a rate-limit token — a monitor polling every minute would
   otherwise eat the sitewide budget, which is exactly what happened to the Playwright
   suite when `globalLimiter` was mounted above the static handlers.

Then (a person, not the agent) point a free uptime monitor at `/healthz` with SMS
alerting. That step is what turns this from code into coverage.

## Acceptance criteria

- A deliberately unhandled rejection is logged and captured, and the server keeps
  answering requests.
- `SIGTERM` drains: a request in flight when the signal arrives completes.
- `GET /healthz` returns 200 when the database is reachable and 503 when it is not.
- `/healthz` is absent from `/sitemap.xml`.
- Hammering `/healthz` does not exhaust the sitewide rate limit.

## Tests

- `__tests__/unit/` — a test for the shutdown handler that asserts the server is closed
  and the pool ended. `db-pool-error.test.js` is the model to follow.
- `__tests__/integration/` — `/healthz` 200; `/healthz` 503 with the db mocked to throw;
  the existing sitemap test extended to assert `/healthz` is not listed.

## Out of scope

- `helmet` and CSP — **HARD-12**, same file, sequenced after this.
- The dev-database guard — **HARD-13**, same file, sequenced after this.
- Configuring the external uptime monitor (not a code change).
