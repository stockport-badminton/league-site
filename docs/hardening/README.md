# Hardening backlog

Work packages from the August 2026 audit. Each one is self-contained: an agent or a
person can pick a single file up cold, without the conversation that produced it.

**Read this file first**, then the package you have been assigned. Do not work on a
package that is not assigned to you — several of them touch the same files, and the
conflict map below is the only thing keeping that safe.

## Where the findings came from

Two passes, published as artifacts and rendered to PDF in `pdf/` (gitignored):

| Pass | Question | Artifact |
|---|---|---|
| One — security & operability | What could an attacker or an outage do, and what could a non-technical owner not fix? | [League Site Risk Register](https://claude.ai/code/artifact/509ed4e6-ba01-40b6-9e1f-0417fd1d5422) |
| Two — seasonal & functional | What breaks for captains and members during a season? | [What Breaks During a Season](https://claude.ai/code/artifact/e6b5419f-343a-4c69-b8b3-b0aa5818ff98) |

Regenerate the PDFs after editing either page:

```bash
node tools/artifact-to-pdf.js docs/hardening/pdf/risk-register.html \
                              docs/hardening/pdf/season-failures.html \
                              --out docs/hardening/pdf
```

## The tools you should be using

Do not hand-write database boilerplate. It was the single largest waste in the audit.

```bash
node tools/dbq.js "SELECT id, name FROM team LIMIT 5"   # ad-hoc read (refuses writes)
node tools/dbq.js --schema player                        # columns of a table
node tools/dbq.js --check all                            # every integrity check
node tools/dbq.js --check orphan-results                 # the offending rows
```

`tools/audit/checks.js` holds the checks. **Every package below that changes data or
data-handling must run `--check all` before and after, and report the difference.**

`DATABASE_URL` is production — `dev.env` carries the same connection string as `.env`.
`dbq.js` refuses anything that is not a single read. A write belongs in a reviewed
script under `scripts/` with a dry run, modelled on `scripts/backfill-contact-emails.js`.

## Rules of engagement

1. **One package per agent.** Check the conflict map before starting.
2. **Every fix needs a test that fails without it.** The discipline that has worked on
   this codebase: write the test, stash the fix (`git stash push <files>`), confirm the
   test fails, `git stash pop`, confirm it passes. Three of this year's bugs lived
   behind a green suite because nobody did this.
3. **Run `npm test` before you claim done.** 391 Jest tests, ~13s. If you touched
   anything the browser drives, `npm run test:e2e` too (48 specs, ~20s, read-only).
4. **Read `CLAUDE.md` first.** It documents the Postgres quoting rules, the missing
   `insertId`, the canonical-URL trap and the roster rank convention. Most of the
   listed gotchas were expensive to learn.
5. **Stay in scope.** Each package has an *Out of scope* section. If you find something
   else, add it to this backlog rather than fixing it.
6. **Do not widen the Playwright read-only allowlist** (`e2e/helpers/read-only.js`).
   The e2e suite runs against production data.

## Conflict map

Packages in the same wave touch disjoint handlers and can run in parallel. Adding a
*new* route line to `routes/index.js` is append-only and merges cleanly; editing the
*same handler* does not.

| Package | Owns | Wave | Blocked by |
|---|---|---|---|
| [HARD-01](HARD-01-scorecard-submission.md) Scorecard submission integrity | `controllers/scorecardController.js` (`full_fixture_post`), `models/fixture.js` | A | — |
| [HARD-02](HARD-02-s3-upload-lockdown.md) S3 upload lockdown | `routes/index.js` (`/sign-s3`), new `utils/uploads.js` | A | — |
| [HARD-04](HARD-04-process-resilience.md) Crash handlers, shutdown, `/healthz` | `app.js` | A | — |
| [HARD-05](HARD-05-error-handling-sweep.md) `res.send(err)` sweep | `fixtureController`, `playerController`, `clubController`, `divisionController` | A | — |
| [HARD-08](HARD-08-tests-in-ci.md) Run the tests in CI | `cloudbuild.yaml` | A | — |
| [HARD-09](HARD-09-data-cleanup.md) Clean the known-bad data | `scripts/` + database | A | — |
| [HARD-03](HARD-03-photo-and-links.md) Photo endpoint + confirmation links | `controllers/scorecardController.js` (other handlers) | B | HARD-01 |
| [HARD-06](HARD-06-friendly-errors.md) Friendly 500 page | `views/500-error.ejs`, `routes/index.js` (error handlers) | B | — |
| [HARD-07](HARD-07-weekly-anomaly-email.md) Weekly anomaly email | new controller + view, one new route | B | HARD-09 |
| [HARD-10](HARD-10-team-lifecycle.md) Withdraw a team properly | `teamController`, `models/league.js`, admin views | B | — |
| [HARD-11](HARD-11-referential-integrity.md) 2,132 orphaned team references | model queries across the app | B | — |
| [HARD-02b](HARD-02b-private-scorecard-photos.md) Make scorecard photos private | `routes/index.js` (`/sign-s3`), a new read path | C | — |
| [HARD-12](HARD-12-security-headers.md) helmet + CSP | `app.js` | C | HARD-04 |
| [HARD-13](HARD-13-dev-database-guard.md) Stop dev pointing at production | `app.js`, `dev.env` | C | HARD-04 |
| [HARD-14](HARD-14-flaky-authorization-test.md) A flaky authorization test | `__tests__/integration/roster.test.js` | A | — |

## Priority

If you are doing this alone and in order, the combined top of both passes is:

1. **HARD-01** — the only finding that has already lost league data. Three results from
   last season sit in the table with no games behind them.
2. **HARD-02** — the largest blast radius. Has never fired, which is the only reason it
   is not first.
3. **HARD-07 + HARD-04** — discovery. Every other finding is worse when the way you
   learn about it is a member emailing you.
4. **HARD-08** — 439 tests that only run when somebody remembers.
5. Everything else.

## Status

Update the table below as packages land, so a fresh session can see where things
stand without reading git log.

| Package | Status | Commit | Notes |
|---|---|---|---|
| SEC-3 | **done** | `f5f36ff` | Invoice endpoints gated to superadmin. Not a package — pulled forward because the annual send was the next day. |
| HARD-01 | **done** | `17e2d0e` | Transaction, resubmit page, deterministic lookup, 18-game validation. 17 new/updated tests. |
| HARD-02 | **done** | `8f1fb71` | Server-generated keys, image-only content types, rate limit. Residual tracked as HARD-02b. |
| HARD-03 | not started | | |
| HARD-04 | **done** | `19d27ec` | unhandledRejection + uncaughtException handlers, SIGTERM drain, /healthz above the limiter. Verified against a real server. |
| HARD-05 | **done** | `4a10c68` | All 11 replaced with next(err), plus a repo-level guard test. |
| HARD-06 | **done** | | Error out of the page entirely, six-hex reference on the page and as a Sentry tag, three canonicals moved to `canonicalFor`. Left alone, same `req.get('host')` bug: `middleware/validateSeason.js:23` (its own 404 render) and `routes/index.js` lines 83 (`failed-login`) and 408 (`/user`) — out of this package's ownership. |
| HARD-07 | not started | | |
| HARD-08 | **done** | `5d48fa6` | `npm ci && npm test` before the build. Verified the suite passes with no .env, as in CI. Playwright stays local — HARD-13. |
| HARD-09 | not started | | |
| HARD-10 | not started | | |
| HARD-11 | not started | | |
| HARD-12 | not started | | |
| HARD-13 | not started | | |
| HARD-14 | not started | | Found 31 Aug while working SEC-3. |
| HARD-02b | not started | | Residual from HARD-02. |
