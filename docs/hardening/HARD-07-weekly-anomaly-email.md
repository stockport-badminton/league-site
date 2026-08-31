# HARD-07 — Weekly anomaly email

**Severity:** high · **Wave:** B · **Blocked by:** HARD-09 (so the first email is not all noise)
**Owns:** new `controllers/auditController.js`, new `views/emails/weekly-anomalies.ejs`, one new route
**Sources:** SEASON-11

The highest-leverage item in the backlog relative to its cost, and **the only mitigation
here that a non-technical owner can act on unaided.**

## Why

Every failure in both audits is silent by construction. A half-applied result, an
orphaned draft, a score that doesn't total 18, a defunct team in a division — each
renders a perfectly normal page. Discovery depends entirely on a member noticing
something odd and telling Neil. The three broken results from last season went the
whole season unreported.

One email a week converts every one of those into something a person sees within days.

## What to do

The queries already exist: `tools/audit/checks.js`, built during the audit and used by
`node tools/dbq.js --check all`. **Reuse that module — do not re-write the SQL.**

1. `controllers/auditController.js` — run `checks.runAll(conn)`, render the results,
   send via `utils/ses`.
2. `views/emails/weekly-anomalies.ejs` — one section per check that found something,
   each naming the fixture or player and linking to the relevant admin page. Say nothing
   about checks that are clean beyond a one-line "everything else looks fine", so a quiet
   week is a short email and an interesting one is obvious.
3. A route to trigger it. **It must not be publicly callable** — the invoice endpoints
   are the cautionary tale (SEC-3, unauthenticated, and everyone finds out on the one
   day a year it fires). Either `secured` + superadmin, or a shared secret in a header
   if a scheduler will call it.
4. Schedule it. Cloud Scheduler hitting the endpoint is the least new machinery.
   Monday morning, so the weekend's results have landed.

Recipients derive **server-side** from the results secretary role — never from the
request body. That rule is in CLAUDE.md and exists because `/fixture/reminder` was an
open relay.

## Acceptance criteria

- The email lists every non-empty check, with enough identifying detail to act on
  (fixture id, date, team names).
- A week with nothing wrong produces a short "all clear", not silence — silence is
  indistinguishable from the job being broken.
- The endpoint cannot be triggered anonymously.
- A failing check (bad SQL, schema change) is reported in the email rather than
  aborting the whole send. `checks.runAll` already catches per-check errors.

## Tests

- `checks.runAll` with a mocked connection → shape of the result
- the controller with all checks clean → "all clear" email
- the controller with one check failing → error surfaced, other sections still rendered
- anonymous request → 403

## Out of scope

- Fixing anything the email reports.
- Alerting for the site being *down* — that is `/healthz` in HARD-04.
