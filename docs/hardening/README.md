# Hardening backlog

Work packages from the August 2026 audit. Each one is self-contained: an agent or a
person can pick a single file up cold, without the conversation that produced it.

**Read this file first**, then the package you have been assigned. Do not work on a
package that is not assigned to you — several of them touch the same files, and the
conflict map below is the only thing keeping that safe.

**Landed packages live in [`done/`](done/).** The top level is what is still open, so a
glance at the directory answers "what is left". They are kept rather than deleted because
each one records why the code is shaped the way it is, and the status table below still
links to them — worth reading before touching a file a finished package owned. Three
packages stay at the top level despite their code being complete, because a **human** still
has to do something: HARD-07 (set `AUDIT_EMAIL_TO` or nothing is ever sent), HARD-02b (the
bucket steps in its runbook) and HARD-12 (the CSP is report-only until someone flips it).
Moving those into `done/` would hide the only part still outstanding.

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
3. **Run `npm test` before you claim done.** 720 Jest tests, ~25s. If you touched
   anything the browser drives, `npm run test:e2e` too (48 specs + 1 skipped, ~60s,
   read-only) — but see rule 7 if you are one of several agents.
4. **Read `CLAUDE.md` first.** It documents the Postgres quoting rules, the missing
   `insertId`, the canonical-URL trap and the roster rank convention. Most of the
   listed gotchas were expensive to learn.
5. **Stay in scope.** Each package has an *Out of scope* section. If you find something
   else, add it to this backlog rather than fixing it.
6. **Do not widen the Playwright read-only allowlist** (`e2e/helpers/read-only.js`).
   The e2e suite runs against production data.
7. **If you are working in parallel with other agents, do not run Playwright**, and do
   not trust a single loaded Jest run. Playwright starts its own dev server on a fixed
   port, so two agents racing it produce nonsense. Jest is safe per-worktree (a worktree
   contains no sibling worktrees), but concurrent Jest processes contend: that is what
   produced every "a different arbitrary subset failed" report on 31 Aug, all of them
   `Exceeded timeout of 5000 ms`. `testTimeout` is now 15s, which should absorb it. If a
   test fails on a busy machine, re-run that suite **alone** before reporting it — and if
   it fails with a wrong *status* rather than a timeout, that is a real bug, not
   contention. Whoever merges runs the browser suite once on the merged result.

## Conflict map

Packages in the same wave touch disjoint handlers and can run in parallel. Adding a
*new* route line to `routes/index.js` is append-only and merges cleanly; editing the
*same handler* does not.

| Package | Owns | Wave | Blocked by |
|---|---|---|---|
| [HARD-01](done/HARD-01-scorecard-submission.md) Scorecard submission integrity | `controllers/scorecardController.js` (`full_fixture_post`), `models/fixture.js` | A | — |
| [HARD-02](done/HARD-02-s3-upload-lockdown.md) S3 upload lockdown | `routes/index.js` (`/sign-s3`), new `utils/uploads.js` | A | — |
| [HARD-04](done/HARD-04-process-resilience.md) Crash handlers, shutdown, `/healthz` | `app.js` | A | — |
| [HARD-05](done/HARD-05-error-handling-sweep.md) `res.send(err)` sweep | `fixtureController`, `playerController`, `clubController`, `divisionController` | A | — |
| [HARD-08](done/HARD-08-tests-in-ci.md) Run the tests in CI | `cloudbuild.yaml` | A | — |
| [HARD-09](done/HARD-09-data-cleanup.md) Clean the known-bad data | `scripts/` + database | A | — |
| [HARD-03](done/HARD-03-photo-and-links.md) Photo endpoint + confirmation links | `controllers/scorecardController.js` (other handlers) | B | HARD-01 |
| [HARD-06](done/HARD-06-friendly-errors.md) Friendly 500 page | `views/500-error.ejs`, `routes/index.js` (error handlers) | B | — |
| [HARD-07](HARD-07-weekly-anomaly-email.md) Weekly anomaly email | new controller + view, one new route | B | HARD-09 |
| [HARD-10](done/HARD-10-team-lifecycle.md) Withdraw a team properly | `teamController`, `models/league.js`, admin views | B | — |
| [HARD-11](HARD-11-referential-integrity.md) 2,132 orphaned team references | model queries across the app | B | — |
| [HARD-02b](HARD-02b-private-scorecard-photos.md) Make scorecard photos private | `routes/index.js` (`/sign-s3`), a new read path | C | — |
| [HARD-12](HARD-12-security-headers.md) helmet + CSP | `app.js` | C | HARD-04 |
| [HARD-13](HARD-13-dev-database-guard.md) Stop dev pointing at production | `app.js`, `dev.env` | C | HARD-04 |
| [HARD-14](HARD-14-flaky-authorization-test.md) A flaky authorization test | `__tests__/integration/roster.test.js` | A | — |
| [HARD-16](HARD-16-reserve-rank-migration.md) Finish the reserve-rank migration | `scripts/` + database | A | — |
| [HARD-18](HARD-18-migration-runner.md) Migration runner splits on comment semicolons | `run-migration.js` | A | — |
| [HARD-17](HARD-17-draft-games-divergence.md) Draft and games disagree for 1 fixture in 9 | investigation; then `scorecardController`, `models/fixture.js` | B | — |
| [HARD-15](HARD-15-inline-scripts.md) Remove the inline scripts so the CSP can bite | `views/**/*.ejs`, `static/beta/js/` | D | HARD-12 |
| [HARD-19](HARD-19-alias-and-join-guards.md) Guards for the two recurring gotchas | `__tests__/unit/`, plus whatever it finds | A | — |
| [HARD-20](HARD-20-phantom-401.md) A 401 from routes with no authorization | `__tests__/` setup | A | — |
| [HARD-21](HARD-21-social-video-read-proxy.md) The weekly social video has no readable URL | `controllers/socialVideoController.js`, one new route | C | — |

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
| HARD-03 | **done** | `01e10fe` | Photo URL validated + escaped, write gated, per-draft `confirmToken` in the confirmation link. `migrations/011_scorecard_confirm_token.sql` **applied 31 Aug 2026** (1557 rows unchanged, 0 tokens minted, so every confirmation link already in a captain's inbox still works). Tokenless drafts are grandfathered (see the clause in `utils/scorecardLinks.js`). |
| HARD-04 | **done** | `19d27ec` | unhandledRejection + uncaughtException handlers, SIGTERM drain, health endpoint above the limiter. **Monitor `/health`, not `/healthz`** — Google's frontend intercepts the exact literal path `/healthz` in front of Cloud Run and answers its own 404, so the request never reaches the container (found 31 Aug by curling production after the deploy; `/healthz/` and `/HEALTHZ` both return 200, which is how it was pinned down). The endpoint had been shipped, tested and documented at the one spelling that could not be reached. Both paths are now registered. |
| HARD-05 | **done** | `4a10c68` | All 11 replaced with next(err), plus a repo-level guard test. |
| HARD-06 | **done** | `869257e` | Error out of the page entirely, six-hex reference on the page and as a Sentry tag, three canonicals moved to `canonicalFor`. Left alone, same `req.get('host')` bug: `middleware/validateSeason.js:23` (its own 404 render) and `routes/index.js` lines 83 (`failed-login`) and 408 (`/user`) — out of this package's ownership. |
| HARD-07 | **done, needs configuring** | `932fde3` | `GET /admin/audit` (superadmin, renders the email itself so preview and inbox cannot diverge) and `POST /admin/audit/run` (superadmin session **or** `X-Audit-Token`, hashed then `timingSafeEqual`). **Nothing sends until `AUDIT_EMAIL_TO` is set** — unconfigured, the job builds the digest, answers `{sent:false,reason}` and mails nobody, deliberately, because `dev.env` points at production. Also set `AUDIT_CRON_TOKEN` (unset closes the token path rather than opening it), then `gcloud scheduler jobs create http sbl-weekly-audit --schedule="0 8 * * MON" --time-zone="Europe/London" --uri="https://stockport-badminton.co.uk/admin/audit/run" --http-method=POST --headers="X-Audit-Token=<token>"`. The digest **suppresses detail, never findings** — a `TRACKED` baseline in `utils/auditDigest.js` collapses HARD-10's and HARD-11's rows to one line each with a reason, so the first email is `all clear — 3 known issues tracked` at 6KB instead of 2,134 table rows; growth in any of them escalates in full, shrinkage asks for the baseline to be lowered, and a baseline that stops finding anything asks to be deleted. No new table, no DB write. **Not** wired into the Admin nav (`views/nav.ejs` belongs to HARD-10's wave) and `AUDIT_EMAIL_TO`/`AUDIT_EMAIL_FROM`/`AUDIT_CRON_TOKEN` are **not** yet in CLAUDE.md's env list, for the same reason — both are one-liners for whoever merges. Separately: `npm test` collects **nothing at all** inside a worktree, because HARD-14's `testPathIgnorePatterns: /\.claude/` matches the worktree's own path; run `npx jest --testPathIgnorePatterns=/node_modules/` until that is anchored to the repo root. And a contended full run produced `friendly-500 › answers 500` → **401** on `GET /fixtures`, a route carrying no `checkJwt` — a wrong status, not a timeout, so per rule 7 it deserves a look alongside HARD-14's outstanding 403→404. |
| HARD-08 | **done** | `5d48fa6` | `npm ci && npm test` before the build. Verified the suite passes with no .env, as in CI. Playwright stays local — HARD-13. |
| HARD-09 | **done** | see below | `--check all` went from **8 of 11 failing to 3 of 11**. The three left are correct: `orphan-team-refs` (2,132 — HARD-11, needs a decision) and `short-squads`/`ghost-teams` (both Parrswood C, withdrawn 31 Aug — HARD-10). Applied: 114 stale fixtures voided; fixture 345 corrected 2–14 → 4–14 from its own game rows; 72 null ranks normalised across 10 lists via `Roster.renumberGender`. **Not** applied, by decision: the 4 orphaned results (not reconstructable — see HARD-17) and 7 unrecoverable bad totals; both are now excluded by id in `tools/audit/checks.js` with the reason beside them, so they cannot mask a new one. Two checks were themselves broken and are fixed — see the note in that file. |
| HARD-10 | **done** | `8e7d79b` | Withdraw and reinstate a team from `/admin/teams`, superadmin only. The team row is never deleted (that is how the 2,132 orphaned refs happened); its division is cleared and kept in `"withdrawnDivision"`. Outstanding fixtures are **voided, not conceded** — conceding invents 18–0 results against opponents who never played, handing out points on the strength of fixture-list order. Recorded results are never touched, the predicate is repeated in the UPDATE's WHERE, and `"withdrawnFixtures"` stores the exact ids voided so Reinstate cannot resurrect the 114 that HARD-09 voided. `migrations/012_team_withdrawal.sql` **applied 1 Sep 2026** — 36 teams unchanged, 0 withdrawn, `--check all` identical either side. Checked against HARD-18: it splits into five chunks, none starting with prose. |
| HARD-11 | not started | | |
| HARD-12 | **done (report-only)** | `aa20cf8` | helmet + two CSP headers: an enforcing baseline with no resource allowlist, and the full allowlist report-only. `CSP_ENFORCE=true` flips it — prerequisites in `utils/securityHeaders.js`, do not flip without them. Nothing was receiving reports (Sentry needs setup that was never done), so `POST /csp-report` collects them into Cloud Logging. Residual: `'unsafe-inline'` must stay in `script-src` until the 159 inline `onclick` handlers go — tracked as HARD-15. |
| HARD-13 | not started | | |
| HARD-14 | **mostly diagnosed** | `d60312d` | **Most of what looked like flakiness was contention, not the suite.** Three agents working in parallel worktrees each ran their own Jest, and the reports that came back ("`sign-s3`, `club-pages`, `roster`, `event-page-and-sitemap` fail intermittently, a different set each run") all describe the same mechanism: the default 5s `testTimeout` is too tight for a supertest case that boots the whole app once the machine is contended. Measured, not assumed — the suite is **12/12 clean** alone, clean at **load 12–14**, and clean at `--maxWorkers=16` on 8 cores; it takes **two concurrent Jest processes** to fail one arbitrary test, and the failure is always `Exceeded timeout of 5000 ms`. `testTimeout` is now 15s. Separately, a run in the main checkout was collecting **140 test files, 106 of them from `.claude/worktrees/`**, because `testMatch` starts with `**` — now ignored. **Update, 1 Sep:** one of the intermittent failures turned out to be a *test*, not contention — the `HSTS_INCLUDE_SUBDOMAINS` case did `jest.resetModules()` + `require('../../app')`, building a second app and a second pg pool, and Jest reported a worker failing to exit gracefully. It failed about one full run in nine and was twice written off as contention. Fixed by moving the config into `utils/securityHeaders.js` so it can be read without booting anything. **The reasoning that missed it is worth naming: "did not reproduce in N runs" is not evidence of contention, it is absence of evidence.** A wrong *status* is never contention — contention produces timeouts. **Two wrong-status failures are still open**, and both fail in the permissive direction, which is why they are not dismissed as contention: `friendly-500 › answers 500` returned **401** on `GET /fixtures` under a contended run (a route carrying no `checkJwt` at all — found by HARD-07's agent, 31 Aug), and the original 403→404 on `roster.test.js` › *403s a club admin ordering another club's team*. That is a wrong *status*, not a timeout, so it is a different bug and the one that still matters — a test that fails in the "access granted" direction. Reproduce it alone before assuming it is contention too. |
| HARD-02b | **done, bucket steps pending — steps 0 and 2 verified 1 Sep, step 3 unblocked** | `8312d1d`, `2a2589a` | `GET /scorecard-photo/:id` serves photos through the site; `/sign-s3` no longer asks for `ACL: public-read`. **The bucket-level steps are deliberately not done** — objects keep the ACL they were written with and a public-read bucket policy would override the missing ACL anyway; the ordered runbook and how to reverse each step is in the package file. Two regressions caught by Playwright *after* merging, both invisible to unit tests that invent their own URLs: stored URLs spell a space as `+` (the old widget rewrote `%20`), and `GetObject` takes the key literally, so **every historical photo 404'd**; and 109 of the 1,479 scorecards on record are PDFs or Word documents, which the image-only proxy dropped — 7% of the archive. Both fixed, with tests taken from the real column. **Step 0 is now measured, not spot-checked** (`tools/scorecard-photo-audit.js`, read-only): **1,456 of 1,479 rows servable, and 0 refused by the guard** — so every stored URL shape resolves and step 3 cannot blank a photo that works today. The 23 failures already 404: 21 absent objects (17 of them the contiguous block ids 878–900, all Feb 2020) and 2 keys with no real extension. Also found: **406 bucket objects no row references**, and **step 4's warning is out of date** — `venues-map.png` and the weekly videos are already 403 to anonymous, the map being proxied with credentials. Five public objects are captain uploads that were never photos (`.xlsx`, `.msg`, a 25MB `.zip`, two extensionless). **Step 2 needs no action** — the bucket policy grants no public read at all (its one statement is `AllowSESReceiptWrite` into `inbound-email/*`), so per-object ACLs are the only lever and nothing overrides them. **Step 3 is unblocked and sweeps the whole root**: the Tameside league shares this bucket (338 root objects, all `tameside-`-prefixed) and has now shipped its own read proxy and dropped `public-read` from its `/sign-s3`, so no carve-out is needed — their reply, with its evidence, is copied to `docs/handover/tameside-s3-bucket-reply.md`. **Their one ask: do not switch Object Ownership to `bucket owner enforced` without telling them** — it is a *write* dependency (a presigned PUT carrying `x-amz-acl` fails), safe now that neither side sends one, but done in the wrong order it breaks uploads rather than displays. |
| [HARD-15](HARD-15-inline-scripts.md) | not started | | Residual from HARD-12. 161 inline handlers (159 of them `onclick=`) and 18 templates with inline `<script>`, so `script-src` must keep `'unsafe-inline'` — the CSP stops a script being *loaded* from an unlisted host but not an injected inline one. **A nonce is not a shortcut here: it makes the browser ignore `'unsafe-inline'` and cannot attach to an `onclick` at all.** |
| [HARD-16](HARD-16-reserve-rank-migration.md) | not started | | Found during HARD-09. **162 players share `rank = 99`** across 25 team/gender lists — the flat pre-migration convention, so their reserve *order* can be dragged in the editor and never saved. `scripts/hard09-normalise-ranks.js` already does this job and only needs its `HAVING` widened. Note `duplicate-ranks` **cannot see this** — it counts nominated collisions only, so `--check all` reads clean while all 162 sit there. |
| [HARD-17](HARD-17-draft-games-divergence.md) | not started | | Found during HARD-09, and the reason the 4 orphaned results were not rebuilt. **For ~1 fixture in 9 the draft in `scorecardstore` disagrees with the `game` rows recorded for it** — 99/120 reproduce, 98/110 even for drafts with a full squad and explicit mixed pairings, so unfielded rubbers do not explain it. Either games are written from a later submission than the surviving draft, or a draft stays editable after publication. Matters because HARD-03's confirmation flow asks a captain to agree a draft. |
| [HARD-20](HARD-20-phantom-401.md) | not started | | Two tests have been seen returning **401 on routes that have no `checkJwt`** — `POST /contact-us` and `GET /fixtures`. There is no 401 anywhere in this codebase; `express-jwt` is the only thing that can produce one. **Production shows zero 401s in 30 days** (the same query returns plenty of 404s, so logging works), so this is confined to the test harness and is not an authorization bug — which is why it is low severity and why the investigation starts at the Jest setup. Rare: not reproduced in 19 consecutive full runs with a diagnostic in place. The brief carries the diagnostic to re-apply and the Cloud Logging query. |
| [HARD-19](HARD-19-alias-and-join-guards.md) | not started | | Written 1 Sep after the club contact page turned up **gotcha 1 and gotcha 1c for the second time each**, in a query edited four days earlier without either being spotted. Documentation has not stopped them; `no-res-send-err.test.js` did stop its equivalent. The brief carries the measurement that matters: a naive grep yields **43 candidates and 3 of 4 spot checks were false positives**, so the useful version has to get quoting right, ignore matches inside SQL strings, and tie an alias to the function that declares it. If it cannot be made precise, closing the package is a legitimate answer. |
| [HARD-21](HARD-21-social-video-read-proxy.md) | not started | | Found auditing the bucket for HARD-02b. **The weekly video handoff has never worked**: `uploadVideoToS3` sets no ACL so the two `.mp4`s were never public, while the controller hands Make.com a plain `s3.amazonaws.com` URL that **403s**. Nothing is broken today only because the season had not started and no video has been generated in anger — the first real run is when it fails, so this is **dated: before the first weekly video**. Make.com just downloads the file and posts it, so a read proxy is all it needs — the third instance of a pattern already in `app.js` (venues map) and `/scorecard-photo/:id`, and copy the latter, which attaches the `Body` `'error'` listener the venues-map route omits. **Build the returned URL with `absoluteUrl()`** — it goes to a third party, and `req.get('host')` behind Firebase is the Cloud Run hostname (gotcha 1b). Separately noted, not folded in: that endpoint is unauthenticated and unlimited, so anyone can trigger an ffmpeg encode. |
| [HARD-18](HARD-18-migration-runner.md) | not started | | Found applying migration 011. **`run-migration.js` splits on `;` with no regard for comments**, so a semicolon in a `--` comment starts a chunk of bare prose — and the real statement can sit behind it. 011 hit exactly this and its `ALTER` would never have run. Loud, not silent, but it reads as a broken migration rather than a broken runner. `db_connect.js`'s `pgify` (commit `baf2215`) already contains the scanner this needs. |
