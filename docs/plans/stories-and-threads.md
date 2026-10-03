# Plan: Instagram Stories and Threads

**Written 25 Sep 2026. Status 27 Sep: step 4 (Threads token) is live; step 3 (result stories) is built and switched off.** See *Where it stands* below.

## Where it stands (3 Oct 2026)

- **Step 6 (results to Threads) is built, 3 Oct, behind `SOCIAL_POST_THREADS`.** Publishing
  a result queues the fixture in `threads_result_post` (migration 021), one row per fixture
  so a republish cannot post twice. `POST /admin/social/results/threads`, on the scheduler
  job `sbl-results-threads` (Cloud Run direct, no retries), claims up to three pending rows
  with `FOR UPDATE SKIP LOCKED` and posts each as a single image with a one-tag caption.
  Retrying happens per row instead of in the scheduler: a row goes back to `pending` (up to
  three attempts) only when Threads cannot have published it. A publish that got no answer
  may be live, so that row is marked `failed`; a post that went out but whose `posted` write
  did not stays `posting`. Neither is retried, and the audit digest reports both
  (`threads-result-posts`). A row queued over 48 hours ago is skipped, so a reconnected
  account does not post a week of old results in one go.

- **Steps 3, 4 and 5 are live and confirmed, 3 Oct.** The token refreshed on its own on
  30 Sep (generation 2), the first weekly tables carousel posted on 3 Oct, and the result
  stories look right on real phones.

- **Step 5 (weekly tables to Threads) is built, 27 Sep.** `POST
  /admin/social/weekly-tables/threads` (`SOCIAL_CRON_TOKEN`) posts the four tables as one
  carousel with the token from `social_token`. `utils/threadsPublisher.js` polls each
  container until FINISHED rather than sleeping the documented 30s, and publishes nothing if
  one fails or times out. The caption has one tag and no mentions, because whether
  `@handle` works in Threads text is still unmeasured. `?dry=1` prepares the images and
  publishes nothing. It has its own scheduler job, `sbl-weekly-tables-threads`, which calls
  Cloud Run directly with no retries, a few minutes after the Facebook and Instagram post.

- **Step 3 (Stories for results) is built, behind `SOCIAL_POST_STORY`, unset.** The 9:16 card
  already existed, drawn on every request and written to the container's disk as `-Ig.jpg`
  for Make.com, and never served. Its layout was the feed card's, stretched, and that put
  the away team, half the score and the host line under Instagram's reply box. Three
  layouts were rendered and Neil chose "A, lifted": the same design with the panel ending
  at 0.80H (1536px). Stretching the 4:5 backgrounds turned out fine at 1:1. Native 9:16
  backgrounds regenerated from the same seeds come out a different colour, which would make
  the story unlike its feed post, so they were not used.
  - `GET /resultImage/…/:division/story.jpg` (`resultStoryImagePath()`), per request, no
    disk. The feed route stopped writing to disk too; nothing read those files.
  - `publishInstagramStory`, and an `instagram-story` target in `publishEverywhere`, so
    the story is reported apart from the feed post.
  - **Next: one real story.** Set `SOCIAL_POST_STORY=true` on Cloud Run and the next
    published result goes out as one, visible for 24 hours. That is the only check of where
    Instagram's overlays actually fall.

- **Step 4 is built, and the token from the hand login is gone.** It lived only in that
  session's scratchpad. The next token comes from `/admin/threads`, which is the point:
  the first real login also tests the recovery path.
  - `social_token` (migration 019) holds it, encrypted with `DB_PI_KEY`. A `generation`
    column stops a refresh overwriting a login that landed while it ran.
  - `/admin/threads` (superadmin) shows the status and runs the login, with `state` tied
    to the session. **It refuses any account but `META_THREADS_USER_ID`**, the trap from
    the first attempt, which connected a personal account.
  - `POST /admin/threads/refresh` (`SOCIAL_CRON_TOKEN`) skips a token under 24 hours old.
    It answers 409 on an expired token and 502 on a refusal, and records either, so the
    job goes red rather than reporting a quiet 200.
  - The audit digest's `social-token-expiry` check reports a failed last attempt, under
    45 days left (at least two missed weekly refreshes), or expiry.
  - **Live in production, 26 Sep 2026.** Migration 019 has run, and `anon`/`authenticated`
    have been revoked on the table. The three `META_THREADS_*` variables are on Cloud Run,
    and the code deployed as `league-site-00288-7v9`. Neil connected at `/admin/threads`:
    @stockport.badders.results, generation 1, expiring 24 Nov 2026. **Threads issued 59.06
    days, not a round 60**, so a healthy token sits at about 52 to 59 days, still well
    clear of the 45-day warning.
  - **`sbl-weekly-threads-refresh`** runs Wednesdays 04:00 Europe/London: POST to the public
    domain with `X-Social-Token`, attempt deadline 60s, no retries. Run by hand straight
    after the login, it answered 200 in 44ms and left the row alone, which is the
    under-24-hours skip. **A real refresh has not been seen yet.** The first is 30 Sep, or
    use Refresh now on the page any time after 27 Sep 23:30.

- **Stories: the container dry-run passed.** A `media_type=STORIES` container was created
  with the existing Page token for the live 4:5 result card (`status_code: FINISHED`) and
  for a 1080×1920 JPEG (`IN_PROGRESS`, accepted). Neither was published. So no new
  permission or use case is needed. Still unknown: how a 4:5 card *looks* as a story,
  which needs one real post.
- **Threads: a working token, and a container dry-run passed** (26 Sep). The app is
  `META_THREADS_APP_ID` / `META_THREADS_APP_SECRET`, the callback is
  `https://stockport-badminton.co.uk/admin/threads/callback`, and the account is
  `stockport.badders.results`, Threads user id `28753684917596556`. The long-lived token
  lasts `expires_in: 5184000` (60.0 days) and starts **`THAA`**, which is not `EAA`, so
  `testEnvGuard`'s by-value check does not catch it. Extend it. Publishing quota reads
  250 per 24h. An `IMAGE` container of the live 4:5 result card reached `FINISHED` within
  5 seconds, so our cards are accepted as they are. The token is held only in the session
  scratchpad, not in `.env`, until token storage is built.

  Traps met on the way, all of them setup rather than code:
  - **Threads cannot be set up from a browser.** The profile has to be created in the
    Threads *phone* app from the Instagram account, and a browser login lands on whichever
    Instagram identity is signed in. That was Neil's personal account.
  - **The Instagram Tester role is not the Threads Tester role.** Without the Threads one,
    the code exchange *succeeds* and then every call, including `/me` and
    `th_exchange_token`, answers "requires the threads_basic permission … list of Threads
    testers". A token that exchanges but works for nothing means the role is missing.
  - **Adding the tester sends an invite**, which the account has to accept in Threads under
    Settings → Account → Website permissions → Invites.
  - `/me` reports `name: "Neil Cooper"`: the profile's display name is Neil's, not the
    league's. Change it in the Threads app before anything is posted.

**Nothing below this line had been measured when it was written.** Facts marked *(docs)* come
from Meta's developer documentation as read on that date, and the rest is inference. This
repo has learned twice that documentation and behaviour disagree (the dev-mode Instagram
visibility result and the deleted-post "control", both in CLAUDE.md), so each phase starts
with a free measurement before any code gets written.

The two asks look alike and are not. **Stories is a small extension of the pipeline we
already run**, with the same token, the same endpoint and the same dry-run. **Threads is a
separate integration**: a different API host, a different login and a token that expires.
Do them in that order.

---

## What we have today

`utils/metaPublisher.js` publishes Facebook albums and videos with a Page token, and
Instagram photos, carousels and reels on the same token through the container flow
(`POST /{ig-id}/media` then `media_publish`). `publishEverywhere` and
`publishVideoEverywhere` fan out to `targets()` and report per target. Callers:

| Post | Controller | Scheduler | Takes |
|---|---|---|---|
| Result | `Fixture.sendResultZap` (with `SOCIAL_POST_DIRECT`) | none, on publish | ~1s card |
| Weekly tables | `weeklyTablesController` | Sat 13:00 | 39.1s |
| Weekly fixtures | `weeklyFixturesController` | Sun 18:00 | 38.6s |
| Weekly video | (video handler) | calls Cloud Run directly | ~91s |

Keep the timings in mind. Firebase Hosting cuts a request at 60s (CLAUDE.md 1bc), and both
of these features **add** publish calls to requests that are already over halfway there.

---

## 1. Instagram Stories

### What the API gives us

- **Same flow, one parameter.** A container with `media_type=STORIES` plus `image_url` or
  `video_url`, then `media_publish`. *(docs)* No new permission beyond
  `instagram_content_publish`, which we already hold, and no new use case expected. **That
  last point is the first thing to measure.**
- **A published story reports `media_type` as `IMAGE`/`VIDEO`.** Only
  `media_product_type` says `STORY`. *(docs)* That matters for anything that reads our
  own history back, such as a de-duplication check.
- **The documentation says nothing about aspect ratio, stickers or captions for stories.**
  From general knowledge and not from the docs: the API can add no link, mention, poll or
  music stickers, a `caption` is not displayed, and 9:16 (1080×1920) is the shape that
  fills the screen. A 4:5 card is expected to be accepted and letterboxed. **So everything
  a story says has to be in the pixels.**
- Stories disappear after 24 hours, and each one presumably counts against the 100-per-24h
  publishing quota (`publishingQuota` reads it).

### What it would take

1. **A 9:16 render of the result card.** `socialCard.js` and `backgroundFor()` already
   draw on the division artwork. A portrait layout is a layout job, and it inherits every
   constraint of the existing cards: the dark panel at 0.80 (don't raise it), the accent
   floor, and the rule that it is served per request and never written to disk. Serve it as
   `GET /resultImage/.../story` or with a `?format=story` flag, built through
   `resultImagePath()`, never by interpolation.
2. **`publishInstagramStory(igUserId, token, { imageUrl })`** in `metaPublisher.js`, which
   is about fifteen lines next to `publishInstagramPhoto`.
3. **A target option on `publishEverywhere`**, so a caller can ask for feed + story and get
   both reported separately. Report which of them happened: a story that failed alongside a
   feed post that worked is a half-failure, and it must not read as a success.

**Start with the result card.** It is one image, it is timely, and it is the kind of post
Stories suits. A tables or fixtures story would mean four portrait frames per week, which
is a design question to settle after seeing the first one.

**Facebook Page stories are a separate API**, and I believe it lives at
`/{page-id}/photo_stories` and `/video_stories`. That is unverified and out of scope until
checked. Instagram is where stories get watched.

### Measure first (free, publishes nothing)

```
POST /{ig-id}/media  media_type=STORIES  image_url=<current 4:5 result card URL>
  -> CONTAINER CREATED ?   (permission and URL both acceptable)
POST /{ig-id}/media  media_type=STORIES  image_url=<a 1080x1920 test JPEG>
  -> CONTAINER CREATED ?
```

A container is not a publish and expires in 24 hours, the same free test as `?dry=1`.
**It cannot tell us how a 4:5 image looks as a story.** That needs one real story, which
is visible for 24 hours. Posting one late at night is a reasonable price, but it is Neil's
call.

---

## 2. Threads

### What the API gives us

- **Host:** `graph.threads.net` (the OAuth token exchange is documented at
  `graph.threads.com/oauth/access_token`; confirm which host serves which call rather than
  assuming one). *(docs)*
- **Its own login.** `https://threads.com/oauth/authorize` with `client_id`,
  `redirect_uri`, `scope`, `response_type=code`, then a POST to exchange the code with the
  **Threads** app id and secret. The redirect URI must exactly match one registered in the
  App Dashboard, and the Dashboard may have added a trailing slash. *(docs)*
- **Scopes:** `threads_basic` (required) and `threads_content_publish`. Optionally
  `threads_manage_replies` and `threads_manage_insights`, which we don't need.
- **The token expires. This is the real difference from Meta Pages.** Short-lived: 1
  hour. Long-lived: 60 days, from `GET /access_token?grant_type=th_exchange_token`.
  Refreshed with `GET /refresh_access_token?grant_type=th_refresh_token`, which only
  works on a token that is **at least 24 hours old and not yet expired**. A token not
  refreshed within 60 days is dead, and the only way back is a human logging in again.
  *(docs)*
- **Publishing:** `POST /{threads-user-id}/threads` creates a container (`TEXT`, `IMAGE`,
  `VIDEO`, `CAROUSEL`), then `POST /{threads-user-id}/threads_publish`. *(docs)*
- **Limits:** 500 characters of text; a carousel takes 2–20 items; images JPEG or PNG, at
  most 8 MB, 320–1440px wide; 250 posts per 24h with a carousel counting as one. *(docs)*
  Our cards are 1080px JPEGs, so they fit as they are.
- **"Wait on average 30 seconds before publishing a container."** *(docs)* Read that next
  to the timings table above.

### The token is most of the work

A Page token that never expires let us treat the credential as configuration. A 60-day
token is state, and it needs:

- **Somewhere to live that the app can write.** Cloud Run env vars are set at deploy, so
  a refreshed token cannot go back into one. Candidates are a small table (encrypted like
  `playerEmail`, with `DB_PI_KEY` bound as `?`, never inlined) or Secret Manager. The
  table is simpler and keeps everything in the one database.
- **A scheduled refresh**, for example weekly, well inside the 60 days and outside the
  24-hour floor. It goes behind `requireCronCaller` with its own token, or reuses
  `SOCIAL_CRON_TOKEN` for the same reason the two weekly posts share one. It must
  **report loudly when it fails**: a refresh job nobody watches is exactly how the posts
  stop in week nine with nothing said. It could go in the Monday audit digest: "Threads
  token expires in N days".
- **A one-off login route** (superadmin) that runs the OAuth dance and stores the first
  long-lived token, which is also the recovery path when the refresh has lapsed. The
  redirect URI has to be the public domain via `absoluteUrl()`, never `req.get('host')`
  (gotcha 1b), and it has to be registered in the Threads use case settings.

### Then the posting

- `publishThreadsImage`, `publishThreadsCarousel` and possibly `publishThreadsText` in
  `metaPublisher.js` (or a sibling `threadsPublisher.js`, since the host and token are
  different), with a Threads entry in `targets()` that is simply absent when no token is
  stored.
- **Weekly tables → a Threads carousel** (4 cards fit comfortably in 20), and **a result
  → an image post**. Both captions need a 500-character version.
- **Whether `@mentions` work in Threads post text is not documented** on the posts page.
  Measure it before promising clubs anything, following the rule from
  `social-mentions.md`: a negative observation needs its other causes ruled out.

### The 60-second problem

The tables post takes 39.1s today. A Threads carousel means N child containers, a carousel
container, **a recommended 30s wait**, and then a publish. Added to the same request, that
lands past Firebase's 60s cutoff, and a timed-out request reads as a failure while Cloud
Run finishes and posts (1bc). **Don't add Threads into the existing request.** Either:

- give it its own scheduler job, pointed at Cloud Run directly with `retryCount` unset, as
  the video job does; or
- have the weekly handler respond, then post to Threads afterwards (Cloud Run's CPU
  throttling after the response makes this unreliable unless CPU is always allocated). I'm
  not recommending this one.

The first option is the one the codebase already knows how to run. The result post is
triggered by a captain submitting, so it must go through `afterCommit` like everything else
there, and a 30-second wait inside a captain's submit is not acceptable. Result → Threads
therefore needs to be deferred work too.

### Credentials

Name them **`META_THREADS_APP_ID`, `META_THREADS_APP_SECRET`** and, later,
**`META_THREADS_TOKEN`** if one is ever held in env at all. The `META_` prefix is
load-bearing:

- `__tests__/setup.js` and `e2e/server-env.js` delete every `/^META_/` variable;
- `utils/testEnvGuard.js` refuses the run on any `META_*SECRET` / `META_*TOKEN` by name.

A `THREADS_APP_SECRET` would slip past all three. The guard's by-value check matches
`EAA…` Page tokens. **Whether Threads tokens share a recognisable prefix is unknown**
(the docs show placeholders). Look at the first real one and extend the value check if
they do.

### Measure first

1. Is the Threads profile linked to the league's Instagram account? It has to exist
   before anything else.
2. Register a redirect URI, run the authorize URL once by hand, exchange the code, and
   check the scopes come back including `threads_content_publish`. That also answers
   whether Development mode needs the account to accept a tester invite.
3. `GET /me?fields=id,username` with the token. That gives the `threads-user-id`, which is
   an id and not a secret (`META_THREADS_USER_ID`, like `META_IG_USER_ID`).
4. Create a container without publishing it. Like Instagram's, it should be a free test of
   whether our card URL is accepted. That is unverified for Threads, so confirm that
   nothing appears on the profile.

---

## Recommended order

1. **Stories dry-run** (container only). About ten minutes, publishes nothing.
2. **Threads login by hand** (measure steps 1–3). About half an hour, publishes nothing.
3. **Stories for result posts:** the portrait card, `publishInstagramStory`, target option,
   and one real story to look at.
4. **Threads token storage + refresh + audit-digest line.** Build this before any posting
   code, because a poster without the refresh will work for 60 days and then stop.
5. **Threads weekly tables carousel** on its own scheduler job.
6. **Threads result posts**, deferred off the publish request. Built 3 Oct (see above).
