# HARD-47 — publishing a result takes 25 seconds, and the limit is 60

**Severity:** high (availability of the publish step) · **Wave:** P1 · **Blocked by:** nothing
**Owns:** `full_fixture_post` in `controllers/scorecardController.js` (the `afterCommit`
sequence after the write), `sendResultZap` / `publishResultToMeta` in `models/fixture.js`
**Source:** the PostHog field data pulled on 17 Oct 2026, confirmed in Cloud Run request logs.

## Why

This was not in the lab review, because Lighthouse cannot submit a form. PostHog's web
vitals for `/scorecard-beta` on desktop show **FCP and LCP both about 27 s**. FCP that high
means nothing was painted, so the delay is in the response to the publish POST, not in the
page. Cloud Run agrees. Every `POST /scorecard-beta` since 17 Sep:

| Period | Latency of each publish |
|---|---|
| 17–25 Sep | 15.6 – 20.2 s |
| 29–30 Sep | 30.7 – **46.0 s** |
| 1–15 Oct | 23.2 – 31.3 s, and **51.3 s** on 13 Oct |

Firebase Hosting cuts the connection at **60 s** (gotcha 1bc in CLAUDE.md). The 13 Oct
publish was 9 s from that limit. Past it, the results secretary gets an error page for a
result that was published, emailed and posted. That is the half-failure `afterCommit` exists
to prevent, arriving by a different route.

The reason is that the request awaits everything after the commit, in sequence, before it
renders: the player rating refresh, `sendResultZap`, the Threads enqueue, the confirmation
page data, then the results email. `sendResultZap` with `SOCIAL_POST_DIRECT` publishes to up
to four Meta targets: the Page, the Instagram feed post, the Instagram story
(`SOCIAL_POST_STORY`) and the Facebook Page story (`SOCIAL_POST_FB_STORY`, 11 Oct). Each
Instagram container has to be **waited on** until Meta has fetched and processed it. The step
from ~16 s to ~25 s lines up with the story targets being added. Each new target makes the
publish slower, and nothing warns when it does.

Threads already met this problem and solved it: `SOCIAL_POST_THREADS` queues the post in
`threads_result_post` and a scheduler job posts it, *"because a Threads container has to be
waited on, and that wait cannot sit inside the publish request in front of Firebase's 60s
cut"*. The Meta targets have the same property and were left inline.

The `409`s next to two of the publishes (5 Oct, 23 Sep) are the already-published guard
catching a second submit made while the first was still running. That guard works. It is
why a retry today does not double-post.

## What to do

1. **Measure the split first.** Log the duration of each `afterCommit` step (a
   `console.time`-shaped line per label is enough) and read one week of it. The rating
   refresh is the unknown. If it turns out to be a large share, it needs its own answer.
2. **Queue the Meta posts the way Threads is queued.** Enqueue the result in the request,
   and have a scheduler job (`SOCIAL_CRON_TOKEN`, no retries, called on Cloud Run directly
   like the video job) publish it. Keep the existing rules: retry only where Meta cannot have
   published, report partial success per target, and add a digest check for rows that died.
   A table shared with Threads, with a target column, is probably simpler than a second one.
3. **Do not "respond first and post afterwards" within the same request.** On Cloud Run,
   CPU is throttled once the response is sent unless CPU is always allocated, so the posting
   would stall or die without a sound. The queue exists so the work has a request of its own.
4. The cost: a result reaches Facebook and Instagram a few minutes later instead of
   immediately. Threads already works that way and nobody has noticed.

## Acceptance criteria

- `POST /scorecard-beta` p95 under 10 s in the request logs, a week after deploy.
- A test with Meta mocked to hang shows the publish completing and rendering anyway. It
  must fail with the queue removed.
- Every result published in that week reached every configured target, checked against the
  queue table, not the logs alone.

## Out of scope

- The Make.com path (`SOCIAL_POST_DIRECT` unset). It is a webhook and returns quickly.

## Step 1: the split, measured 18–24 Oct 2026

Six publishes, every one a 200. The `[timing]` lines carry no trace id, so they were grouped by
time: each POST's start plus its latency lands on that publish's `results email` line.

| Start (UTC) | Total | Page | Instagram | IG story | Page story | Everything else |
|---|---|---|---|---|---|---|
| 19 Oct 16:46 | 29.9 s | 5.7 | 8.3 | 8.1 | 5.5 | 0.5 |
| 20 Oct 22:31 | 29.3 s | 4.4 | 7.9 | 8.9 | 6.7 | 0.4 |
| 20 Oct 22:33 | 31.3 s | 6.5 | 10.1 | 8.8 | 5.1 | 0.5 |
| 22 Oct 17:11 | 32.8 s | 5.9 | 9.4 | 10.1 | 5.2 | 0.8 |
| 23 Oct 07:52 | 26.5 s | 4.4 | 6.5 **failed** | 8.1 | 5.1 | 0.8 |
| 24 Oct 11:25 | **52.0 s** | 8.8 | 16.1 | 14.7 | 9.9 | 1.2 |

- **The Meta posts are 92–95% of the request, and they run one after another.** The four
  targets add up to `result zap`'s own figure to within a millisecond.
- **The rating refresh, the unknown in step 1, is not a factor**: median 70 ms. With the ELO
  chain (late results only, median 356 ms), the Threads enqueue, the confirmation-page data
  and the results email, the whole rest of the request is under 2%. Nothing besides Meta
  needs its own answer.
- 24 Oct was a slow Meta day: every target took about 1.7x its usual time, and the publish
  finished 8 s inside Firebase's cut. Status 200.
- 23 Oct: the Instagram feed post failed, and `result zap` still logged `ok`, because the
  step reports success when any target does. The queue's per-target rows should make that
  visible rather than inherit it.

Step 2 as written stands. Running the four targets in parallel would bring the request to
~10–16 s and is a fallback if the queue stalls. It is not the fix: Meta's speed would still
set the publish request's duration.

## Step 2: the queue, designed 24 Oct 2026

**One row per fixture *and target*.** A new table, `social_result_post` (migration 024),
unique on `(fixture_id, target)`, where `target` is a `metaPublisher` kind: `page`,
`instagram`, `instagram-story`, `page-story`. Per target, not per fixture, because the
outcome is per target: a run that posted the Page and failed Instagram must retry Instagram
alone, and the acceptance check ("every result reached every configured target") is then a
query rather than a log read. Same states and the same rules as `threads_result_post`
(migration 021): `pending → posting → posted | failed | skipped`, `SKIP LOCKED` claiming,
finishing writes guarded on `state = 'posting'`, a row left in `posting` is never retried
automatically, stale after 48 hours, RLS on with no policy.

Threads stays in its own table for now. It is live and working, and moving it in is a
rename of a table a scheduled job is writing to, for no gain in this package. The new table
is named generically so that it can join later.

**The publish request enqueues and returns.** Under `SOCIAL_POST_DIRECT`, `sendResultZap`
writes one row per *configured* target (the flags are read at publish time; credentials at
post time) and returns. No configured target still throws, as now. The `[timing]` line
`result zap` becomes a few ms.

**`POST /admin/social/results/meta`** (`SOCIAL_CRON_TOKEN`), on a new job `sbl-results-meta`.
Like the video and Threads jobs, it calls Cloud Run directly with no retries. It claims a
bounded number of rows, reads the result *as it stands now* (`ThreadsResultPost.resultFor`'s
query, shared), and posts each target through the same `metaPublisher` functions with the
same caption and card URLs. It answers 502 if anything did not post, as the Threads job does.

**Retry only where Meta cannot have published**, with the Threads rule: a failure at the
step that publishes (`the page post`, `the page story`, `the Instagram publish`) with **no
HTTP status** may be live and is failed, not retried. Everything else is released for the
next run, up to 3 attempts.

**And wait for the container before publishing it.** Every Meta failure on a result since
25 Sep (five, of which 23 Oct is the latest) is the same refusal: *"The media is not ready
to be published. Please wait a moment."* Today we publish an Instagram container the moment
it is created, and nothing retries. Nothing was waited on because the wait would have been
inside the publish request. In the job it costs nothing, so the image publish polls
`status_code` until `FINISHED` the way `waitForContainer` already does for video. That
removes the failure rather than retrying around it, and the retry rule stays as a backstop.

**A digest check, `meta-result-posts`**, for failed rows, rows stuck in `posting` over 15
minutes, and **rows still `pending` an hour after queueing**. The last one is not in the
Threads check and should be: a queue whose job has stopped running fails silently, because
nothing is ever attempted.

**Schedule: `*/15 7-23 * * *` Europe/London, the same as `sbl-results-threads`** (Neil, 24
Oct). A result reaches Facebook and Instagram within 15 minutes, and one published after
midnight goes out from 07:00. The 48-hour stale rule is unaffected.

**No rollback flag** (Neil, 24 Oct). The queue is unconditional under
`SOCIAL_POST_DIRECT`, and backing it out is a revert and a deploy.
