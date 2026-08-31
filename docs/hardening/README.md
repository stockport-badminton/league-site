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
3. **Run `npm test` before you claim done.** 573 Jest tests, ~25s. If you touched
   anything the browser drives, `npm run test:e2e` too (48 specs + 1 skipped, ~60s,
   read-only) — but see rule 7 if you are one of several agents.
7. **If you are working in parallel with other agents, do not run Playwright**, and do
   not trust a single loaded Jest run. Playwright starts its own dev server on a fixed
   port, so two agents racing it produce nonsense. Jest is safe per-worktree (a worktree
   contains no sibling worktrees), but concurrent Jest processes contend: that is what
   produced every "a different arbitrary subset failed" report on 31 Aug, all of them
   `Exceeded timeout of 5000 ms`. `testTimeout` is now 15s, which should absorb it. If a
   test fails on a busy machine, re-run that suite **alone** before reporting it — and if
   it fails with a wrong *status* rather than a timeout, that is a real bug, not
   contention. Whoever merges runs the browser suite once on the merged result.
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
| HARD-03 | **done, migration pending** | `01e10fe` | Photo URL validated + escaped, write gated, per-draft `confirmToken` in the confirmation link. **`migrations/011_scorecard_confirm_token.sql` is NOT applied** — it must be, before this deploys, or every scorecard submission fails on an unknown column. Tokenless drafts are grandfathered (see the clause in `utils/scorecardLinks.js`). |
| HARD-04 | **done** | `19d27ec` | unhandledRejection + uncaughtException handlers, SIGTERM drain, health endpoint above the limiter. **Monitor `/health`, not `/healthz`** — Google's frontend intercepts the exact literal path `/healthz` in front of Cloud Run and answers its own 404, so the request never reaches the container (found 31 Aug by curling production after the deploy; `/healthz/` and `/HEALTHZ` both return 200, which is how it was pinned down). The endpoint had been shipped, tested and documented at the one spelling that could not be reached. Both paths are now registered. |
| HARD-05 | **done** | `4a10c68` | All 11 replaced with next(err), plus a repo-level guard test. |
| HARD-06 | **done** | `869257e` | Error out of the page entirely, six-hex reference on the page and as a Sentry tag, three canonicals moved to `canonicalFor`. Left alone, same `req.get('host')` bug: `middleware/validateSeason.js:23` (its own 404 render) and `routes/index.js` lines 83 (`failed-login`) and 408 (`/user`) — out of this package's ownership. |
| HARD-07 | not started | | |
| HARD-08 | **done** | `5d48fa6` | `npm ci && npm test` before the build. Verified the suite passes with no .env, as in CI. Playwright stays local — HARD-13. |
| HARD-09 | **done** | see below | `--check all` went from **8 of 11 failing to 3 of 11**. The three left are correct: `orphan-team-refs` (2,132 — HARD-11, needs a decision) and `short-squads`/`ghost-teams` (both Parrswood C, withdrawn 31 Aug — HARD-10). Applied: 114 stale fixtures voided; fixture 345 corrected 2–14 → 4–14 from its own game rows; 72 null ranks normalised across 10 lists via `Roster.renumberGender`. **Not** applied, by decision: the 4 orphaned results (not reconstructable — see HARD-17) and 7 unrecoverable bad totals; both are now excluded by id in `tools/audit/checks.js` with the reason beside them, so they cannot mask a new one. Two checks were themselves broken and are fixed — see the note in that file. |
| HARD-10 | not started | | |
| HARD-11 | not started | | |
| HARD-12 | **done (report-only)** | `aa20cf8` | helmet + two CSP headers: an enforcing baseline with no resource allowlist, and the full allowlist report-only. `CSP_ENFORCE=true` flips it — prerequisites in `utils/securityHeaders.js`, do not flip without them. Nothing was receiving reports (Sentry needs setup that was never done), so `POST /csp-report` collects them into Cloud Logging. Residual: `'unsafe-inline'` must stay in `script-src` until the 159 inline `onclick` handlers go — tracked as HARD-15. |
| HARD-13 | not started | | |
| HARD-14 | **mostly diagnosed** | `d60312d` | **Most of what looked like flakiness was contention, not the suite.** Three agents working in parallel worktrees each ran their own Jest, and the reports that came back ("`sign-s3`, `club-pages`, `roster`, `event-page-and-sitemap` fail intermittently, a different set each run") all describe the same mechanism: the default 5s `testTimeout` is too tight for a supertest case that boots the whole app once the machine is contended. Measured, not assumed — the suite is **12/12 clean** alone, clean at **load 12–14**, and clean at `--maxWorkers=16` on 8 cores; it takes **two concurrent Jest processes** to fail one arbitrary test, and the failure is always `Exceeded timeout of 5000 ms`. `testTimeout` is now 15s. Separately, a run in the main checkout was collecting **140 test files, 106 of them from `.claude/worktrees/`**, because `testMatch` starts with `**` — now ignored. **What is still open:** the original 403→404 on `roster.test.js` › *403s a club admin ordering another club's team*. That is a wrong *status*, not a timeout, so it is a different bug and the one that still matters — a test that fails in the "access granted" direction. Reproduce it alone before assuming it is contention too. |
| HARD-02b | not started | | Residual from HARD-02. |
| HARD-16 | not started | | Found during HARD-09. **221 players sit on a shared `rank = 99`** across 21 team/gender lists — the flat pre-migration convention, so their reserve *order* can be dragged in the editor and never saved. Nothing is visibly wrong, which is why it has survived. One pass of `Roster.renumberGender(conn, team, gender, {})` per list fixes it (195 rows); `scripts/hard09-normalise-ranks.js` does exactly this and only needs its `HAVING` widened to drop the `rank < 99` filter. HARD-09 was deliberately scoped narrow (Neil, 31 Aug) so this is the remainder. Note `duplicate-ranks` cannot see it — that check counts nominated collisions only. |
| HARD-17 | not started | | Found during HARD-09, and the reason the 4 orphaned results were not rebuilt. **For roughly 1 fixture in 9, the draft in `scorecardstore` disagrees with the `game` rows actually recorded for it.** Measured over 120 fixtures holding both: a faithful re-derivation reproduces 99, and 98 of 110 when restricted to drafts with a full squad and full mixed pairings, so the divergence is not explained by unfielded rubbers. Either games are written from a later submission than the draft that survives, or a draft is editable after its result is published. Worth knowing before anything else trusts a draft as a record of what was played — HARD-03's confirmation flow and any future "rebuild from draft" both would. |
| HARD-18 | not started | | Found while applying migration 011. **`run-migration.js` splits a file on `;` with no regard for comments**, so a semicolon inside a `--` comment produces chunks beginning with bare prose, and the real statement can end up inside one. Migration 011 hit this: Postgres would have rejected the chunk and the `ALTER` would never have run. It fails loudly rather than silently, but it reads as a broken migration rather than a broken runner, and it will catch the next person. Fix is to strip line comments before splitting — the same class of bug as the `pgify` one fixed in `db_connect.js` (commit `baf2215`), which is worth reading first since it has the scanner already written. |
| HARD-15 | not started | | Residual from HARD-12. Move the 159 inline `onclick=` attributes and 17 inline `<script>` blocks in `views/` onto delegated handlers, so `script-src` can drop `'unsafe-inline'` for a nonce. Until then the CSP stops a script being *loaded* from an unlisted host but not an injected inline one. Not a package brief yet — no evidence gathered beyond the counts. |
