# REARCH-05 — one outbox for every side effect

**Size:** M · **Window:** off-season only
**Blocked by:** HARD-47 measured and stable (deployed 24 Oct 2026, measure ~31 Oct; give
it a few weeks of real results). Soft: REARCH-03 part B if it is changing the draft write
in the same summer — do them in one branch or one after the other, not in parallel.
**Owns:** `utils/afterCommit.js`, the `social_result_post` and `threads_result_post`
tables and their workers, a new `outbox` table and drain route, the
`meta-result-posts` / `threads-result-posts` audit checks, the corresponding Cloud
Scheduler jobs.
**Source:** the 24 Oct 2026 "build it from scratch" review.

## Why

The codebase has invented the same thing four times, each correctly, each separately:

| Mechanism | What it does | Added |
|---|---|---|
| `afterCommit(label, fn)` | Runs a step after the write; never fails the request; reports to Sentry | HARD-01 |
| `threads_result_post` + `/admin/social/results/threads` | Queue a post, a job drains it, retries only where Threads cannot have published | Oct 2026 |
| `social_result_post` + `/admin/social/results/meta` | The same, for Meta, with `mayHavePublished` | HARD-47 |
| `invoice_run` | A durable record of a run and each club's outcome, read by the digest | HARD-35 |

And the lessons each one learned are written beside it rather than built into one place:

- *A notification must not be able to fail the write it reports* (`afterCommit`).
- *Report which of the two happened* (`notificationFailed`, `notified=0`, `skipped`).
- *A publish that got no answer may be live; do not retry it* (`mayHavePublished`).
- *A run that never happens raises no error* (HARD-35's absence check).
- *Anything that publishes and can exceed 60 s must not sit behind Firebase or carry
  retries* (gotcha 1bc).

Meanwhile `afterCommit` steps — including the email that tells the results secretary a
draft has arrived — are **fire-once**: if SES has a bad minute, the step is reported to
Sentry and never tried again. The durability Threads and Meta posts have, emails do not.

## Design

```
outbox (
  id, kind, payload jsonb,
  dedupe_key text UNIQUE,          -- e.g. 'meta:page:fixture:7231'
  mode text,                       -- 'immediate' | 'deferred'
  status text,                     -- pending | sent | failed | gave_up
  attempts int, next_attempt_at, last_error,
  may_have_published bool,
  created_at, sent_at
)
```

- **Written in the same transaction as the domain write.** The result row and the
  "tell people" rows commit together or not at all. That is the property `afterCommit`
  cannot give: today the write commits and the intent to notify exists only in memory.
- **Two modes, to keep every feature's latency exactly as it is:**
  - `immediate` — after commit, the request tries the row once, as `afterCommit` does now,
    and reports which happened to the user exactly as now. A failure leaves the row
    `pending` for the drain to retry. Normal-case behaviour is identical; the failure case
    gains a retry. For the draft-received email, the confirmation emails, invoices.
  - `deferred` — the request never tries it; only the drain does. For everything HARD-47
    moved off the publish path (Meta, Threads, stories).
- **One drain route**, `POST /admin/outbox/drain`, on `requireCronCaller`, claiming rows
  with `FOR UPDATE SKIP LOCKED` so two overlapping runs cannot double-send. Per-kind
  handlers own the retry rule: an email retries freely; a Meta or Threads publish follows
  `mayHavePublished`. Called on the Cloud Run URL directly, no scheduler retries (1bc).
- **One audit check**, `outbox`: rows `failed`/`gave_up`, rows pending past their kind's
  deadline, and *no successful drain in N hours while rows are pending* (the job has
  stopped). Replaces `meta-result-posts` and `threads-result-posts`.

## What to do

1. Migration: `outbox`. The drain route and handler registry, with **no kinds** yet.
2. Move **Threads results** first — the oldest queue, so the best-understood. Migrate pending
   rows; run both drains for a week with the old one reading nothing new; retire
   `threads_result_post` and its job.
3. Move **Meta results** the same way, after HARD-47's measurement.
4. Move the `afterCommit` email steps to `immediate` kinds, one call site at a time (14 call
   sites across `scorecardController`, `messer-scorecard-controller`,
   `liveScorecardController`, `contactusController`). The user-facing report
   (`notificationFailed`, `notified=0`) must be unchanged: assert on the rendered page, not
   the mock.
5. `afterCommit` remains for steps that are not deliverables (refreshing ratings, extra data
   for the page being rendered) — it is still right for those.
6. Merge the Meta and Threads scheduler jobs into one drain job. List jobs first:
   `gcloud scheduler jobs list --location europe-west2 --project stockport-badminton-map`.

## Acceptance criteria

- Every email, post and webhook that follows a committed write is an `outbox` row
  committed in the same transaction; a test that rolls the write back finds no row.
- A forced SES failure on draft filing: the captain sees exactly what they see today, and
  the next drain sends the email (a test, and once by hand on staging data).
- Two concurrent drains send each row once (a test with two runs racing).
- The `outbox` check reports a stuck row and a stopped drain; each demonstrated.
- No request awaits Meta or Threads.
- Cost: flat or slightly lower — one scheduler job replaces two (Cloud Scheduler bills per
  job beyond the free three), and the drain runs on the same cadence as today's jobs.

## Out of scope

- The weekly tables/fixtures/video posts. They are scheduled jobs already, publish in one
  request, and record their result in the response; they could become outbox kinds later,
  but they do not have the commit-then-notify problem.
- SES delivery tracking (the `emails` skill's event feed) — the outbox knows SES *accepted*
  a message, not that it arrived.
