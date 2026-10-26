# Environment variables

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.

## Environment Variables

Key vars (see `.env` for examples):
- `AUTH0_DOMAIN`, `AUTH0_CLIENTID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE` — Auth0 config
- `DATABASE_URL` — PostgreSQL connection string (Supabase)
- `SENDGRID_API_KEY` — Email sending
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — S3 access
- `NODE_ENV` — `'production'` or `'development'`
- `DEV_MODE` — `'true'` for local auth bypass (dev/test only)
- `PORT` — Server port (default 8080)
- `SESSION_SECRET` — Session encryption key
- `CSP_ENFORCE` — `'true'` promotes the Content-Security-Policy resource allowlist from
  report-only to enforcing. **Leave unset** until the prerequisites in
  `utils/securityHeaders.js` are met; a wrong policy blanks pages silently, and the
  scorecard wizard is the most likely casualty.
- `CSP_REPORT_URI` — where CSP violations are POSTed. Defaults to `/csp-report`, handled
  in `app.js` and logged to Cloud Logging. Set it to Sentry's security-header endpoint to
  send them there instead; set it to `''` to emit no reporting directives at all.
- `AUDIT_EMAIL_TO` — comma-separated recipients of the weekly data-integrity digest
  (HARD-07). **Unset means nothing is ever sent**, which is the safe default and is why
  it is unset locally: `dev.env` points at production, so a stray run would otherwise mail
  the real results secretary. The recipient never comes from the request — `/fixture/reminder`
  was an open relay from our own verified domain for exactly that reason.
- `AUDIT_EMAIL_FROM` — sender for that digest. Defaults to the results address.
- `AUDIT_CRON_TOKEN` — shared secret Cloud Scheduler presents as `X-Audit-Token` to
  `POST /admin/audit/run`. Compared with `timingSafeEqual` over SHA-256 of both sides;
  **unset closes the token path rather than opening it**. A superadmin session also works.
  `GET /admin/audit` previews the same email (Admin → Data Health).
- `REGISTRATION_EMAIL_TO` — comma-separated recipients of the **daily** player-registration
  reminder. Falls back to `AUDIT_EMAIL_TO`. **Unset means nothing is ever sent**, which is
  why it is unset locally — `dev.env` points at production, so a stray run would mail the
  real results secretary.
- `REGISTRATION_CRON_TOKEN` — shared secret Cloud Scheduler presents as `X-Registration-Token`
  to `POST /admin/registrations/run`, compared with `timingSafeEqual` over SHA-256 of both
  sides. **Unset closes the token path rather than opening it.** A superadmin session also
  works. `GET /admin/registrations/digest` previews the same email and sends nothing.
- `REGISTRATION_INBOX_SENDERS` — comma-separated addresses allowed to put an email in the
  `registrations@` queue (`/admin/player-requests`, Admin → Registration Requests). The
  From must also pass SES's SPF or DKIM verdict, and a DMARC FAIL refuses it outright.
  **Unset closes the queue**: mail to `registrations@` is then forwarded to the results
  inbox exactly as before, so nothing is lost either way — a refused message always falls
  through to the ordinary forward. See the `registrations` skill.
- `INVOICE_CRON_TOKEN` — shared secret the scheduled caller presents as `X-Invoice-Token`
  to `POST /league/sendInvoices`, compared with `timingSafeEqual` over SHA-256 of both
  sides. **Unset closes the token path rather than opening it.** A superadmin session also
  works, and `/admin/invoices` (Admin → Annual Invoices) is the button — there was no
  trigger anywhere in the app before HARD-23, so the recovery when the 2026 run failed was
  a `fetch()` typed into devtools. The gate is `middleware/requireCronCaller.js`, shared
  with the audit and registration tokens; it answers **403, never a redirect**, because
  `secured`'s 302 to `/login` is what Make.com recorded as a successful run while the
  invoices went unsent for a year.
  **Every run is recorded in `invoice_run`** (migration 023, HARD-35), refusals included,
  with each club's outcome. The audit digest's `invoice-run` check reports from it: once
  the window after 1 Sep closes with nothing sent, and any club whose latest outcome is not
  "sent". It works from the *absence* of a successful run, because a run that never
  happens raises no error to report. **The send also CCs the treasurer's real Hotmail and
  BCCs real addresses, hard-coded** — the local seed's fake `playerEmail` covers only the
  To, so never run it locally with working AWS credentials.
- `LATE_SCORECARD_CRON_TOKEN` — shared secret Cloud Scheduler presents as
  `X-Late-Scorecard-Token` to `GET /fixture/outstanding`, the daily missing-scorecard
  reminder. Same gate, same `timingSafeEqual` over SHA-256 of both sides, and **unset
  closes the token path rather than opening it**. A superadmin session also works.
  Nothing in the app links to this route — it has no UI and never had one.
  **It was completely ungated until 15 Sep 2026**, and that is the interesting part: the
  handler sends mail, so anyone who knew the URL could make the league email itself at
  will. It was open because the thing calling it was a Make.com scenario whose single HTTP
  module cannot authenticate. **An automation that cannot present a credential is a reason
  an endpoint is open**, so auditing what the automation platform calls is also a way of
  finding ungated routes. The recipients were always derived server-side, which is what
  kept this a free send rather than the open relay `/fixture/reminder` was.
- `META_APP_ID` / `META_APP_SECRET` — the league's own Meta app, *Badminton Results App*.
  Only needed to mint or debug tokens; neither can publish anything on its own.
- `META_PAGE_TOKEN` / `META_TAMESIDE_PAGE_TOKEN` — **Page access tokens, and they do not
  expire.** `debug_token` reports `type: PAGE`, `expires: never`; a Page token has no clock
  of its own and dies only if the granting user changes their Facebook password or loses
  their role on the Page. Each can publish to that Page, and the Stockport one can publish
  to the league's Instagram account, so **these are the sharpest credentials in `.env`** —
  there is no sandbox Meta to point them at and no expiry to save us.
  `__tests__/setup.js` deletes every `META_*` variable and `utils/testEnvGuard.js` refuses
  the whole run if one survives, matching **both** by value (`EAA…`, which catches a token
  stored under a name nobody anticipated) and by name pattern (`META_*TOKEN`/`*SECRET`,
  which survives a variable being added). Demonstrated by planting a real one and watching
  the suite abort with `Tests: 0 total`.
- `META_PAGE_ID`, `META_TAMESIDE_PAGE_ID`, `META_IG_USER_ID` — ids, not secrets; they
  appear in page URLs and are deliberately *not* flagged by the guard. `META_IG_USER_ID` is
  recorded because discovering it needs `pages_read_engagement`, which the app cannot
  currently request.
- `META_USER_TOKEN` — short-lived, and spent. Only needed to mint replacement Page tokens:
  exchange it for a long-lived user token (`grant_type=fb_exchange_token`, ~60 days) then
  `GET /me/accounts`. Nothing reads it at runtime.
- `META_THREADS_APP_ID` / `META_THREADS_APP_SECRET` — the Threads app, which is **not** the
  Graph app above: Threads has its own id, secret, host (`graph.threads.net`) and login.
  `META_THREADS_USER_ID` (`28753684917596556`, `stockport.badders.results`) is an id, not a
  secret, and it is **required**: the login callback refuses any other account, because a
  browser login connects whichever Instagram identity is signed in, and on 26 Sep 2026 that
  was a person's.
  **The Threads token is not an env var.** It lasts 60 days and is renewed weekly, so it is
  state: `social_token` (migration 019), encrypted with `DB_PI_KEY`. `/admin/threads`
  connects it and is also the recovery path once a refresh has lapsed;
  `POST /admin/threads/refresh` renews it on `SOCIAL_CRON_TOKEN`, and
  `POST /admin/social/weekly-tables/threads` posts with it (`utils/threadsPublisher.js`, its
  own scheduler job because Threads containers are waited on); the audit digest's
  `social-token-expiry` check says when either has stopped working. Threads tokens start
  `THAA`, not `EAA`, and `testEnvGuard` matches both.
- `SOCIAL_CRON_TOKEN` — shared secret Cloud Scheduler presents as `X-Social-Token` to the
  two weekly social posts: `POST /admin/social/weekly-tables` (Saturday 13:00) and
  `POST /admin/social/weekly-fixtures` (Sunday 18:00). Also the three Threads routes, each on
  its own job calling Cloud Run directly with no retries: `/admin/social/weekly-tables/threads`
  (Sat 13:05), `/admin/social/weekly-fixtures/threads` (Sun 18:05; one division playing goes
  out as a single image, because a Threads carousel needs two) and
  `/admin/social/results/threads` (see `SOCIAL_POST_THREADS`), and the Meta results queue,
  `/admin/social/results/meta` (see `SOCIAL_POST_DIRECT`). Same gate as the other four;
  **unset closes the token path**. A superadmin session also works, and the matching `GET`
  on each previews the images and both captions and sends nothing. `?dry=1` on either POST
  asks Meta whether it will accept the images and publishes nothing — worth running before
  a season's first real post, since a scheduled job nobody watches is exactly where a
  silent refusal hides.
  **One secret for both, deliberately.** They are the same job done by the same caller,
  both publishing content that is already public on the site. A sixth variable would mean
  the new route stays shut until somebody remembers to set it on the service — *unset
  closes the path* is a good default and a poor deployment plan, and the thing that gets
  forgotten is never the code.
- `SOCIAL_POST_DIRECT` — `'true'` makes `Fixture.sendResultZap` post the result to Meta
  itself rather than handing it to the Make.com webhook. **Unset keeps the Make path**, so
  a rollback is one environment variable rather than one deploy — this runs when a captain
  publishes a result, and a bad week is a week of missing posts nobody notices. Switching it
  on needs no change in Make: see *Two leagues, one Make account* above.
  **"Itself" means queued** (HARD-47, Oct 2026). Publishing writes one `social_result_post`
  row per configured target (migration 024) and returns; `POST /admin/social/results/meta`
  (`SOCIAL_CRON_TOKEN`), on `sbl-results-meta` every 15 min 07:00–23:45, calling Cloud Run
  directly with no retries, posts them. Posting inline took 26–52 s of Firebase's 60. A
  result reaches Facebook and Instagram up to 15 minutes later, overnight ones at 07:00. The
  job retries per row only where Meta cannot have published (`metaPublisher.mayHavePublished`),
  and the digest's `meta-result-posts` check reports failures, dead runs and a job that has
  stopped running. The story flags below now decide which rows are queued.
- `SOCIAL_POST_STORY` — `'true'` also posts each published result as an **Instagram story**,
  as a third target beside the Page and the feed post, so a failed story is reported on its
  own. Needs `SOCIAL_POST_DIRECT`. **Unset posts no story.** The card is
  `/resultImage/…/:division/story.jpg` (`resultStoryImagePath()`), a 1080x1920 layout of its
  own: Instagram draws its profile bar over roughly the top 250px of a story and its reply box
  over roughly the bottom 340px, and the feed layout stretched to 9:16 put the away team and
  half the score under that box. `STORY_SAFE` in `socialController` holds those figures, which
  are the commonly published ones, not measured.
- `SOCIAL_POST_FB_STORY` — `'true'` also posts **every Facebook Page post as a Facebook Page
  story**: the result (its 9:16 story card), the weekly tables and fixtures (one frame per
  card, in division order, so four frames a week each — those cards are square and 4:5, not
  9:16) and the weekly video (`video_stories`, the 4:5 file). It is its own `page-story`
  target, reported apart from the feed post, and `metaPublisher.pageStoryTarget()` is the one
  switch all four callers read. **Unset posts no Facebook story.** Built 11 Oct 2026 from
  Meta's documentation with **nothing published for real**: `/{page-id}/photo_stories` takes
  an unpublished photo's id, so the upload half is the usual free test, but the publish half
  has no dry run. The first post after switching it on is the measurement. Story uploads run
  in parallel because the tables post already takes ~39s of Firebase's 60 (1bc).
- `SOCIAL_POST_THREADS` — `'true'` queues each published result for **Threads**
  (`threads_result_post`, migration 021). It does not post: a Threads container has to be
  waited on, and that wait cannot sit inside the publish request in front of Firebase's 60s
  cut (1bc). `POST /admin/social/results/threads` (`SOCIAL_CRON_TOKEN`), on the
  `sbl-results-threads` job every few minutes, posts up to three per run. It retries a row
  only where Threads cannot have published it (a publish that got **no answer** may be live,
  so it fails instead), skips anything queued over 48 hours ago, and the audit digest's
  `threads-result-posts` check reports failures and runs that died mid-post. Independent of
  `SOCIAL_POST_DIRECT`. **Unset queues nothing.**
- `GMAPSAPIKEY` — the browser Maps key, printed into every club and event page **on both
  sites** (Tameside renders the same key). It is restricted in GCP, not here, so grepping
  will not find the rule (1 Oct 2026):
  - **API targets**: Maps JavaScript API (`maps-backend.googleapis.com`) and Places API
    (New) (`places.googleapis.com`, which `Place.fetchFields` on the event pages needs).
    Until then it was unrestricted, so anyone viewing source could call Vision or anything
    else enabled on `stockport-badminton-map`, billed to us.
  - **Referrers**: `https://` + `stockport-badminton.co.uk`, `tameside-badminton.co.uk`,
    each **with and without `www.`** (all four serve the site; none redirects), plus
    `http://localhost:8080` and `http://127.0.0.1:8080`, because `dev.env` carries this
    same key.
  - **A new hostname loses its maps** until it is added — a staging deploy, or the
    `*.run.app` address, which is already in that state. A new browser use of another
    Maps API (Geocoding, Static, a keyed Embed) fails the same way.
  - Read it back with `gcloud services api-keys describe 9407c937-129b-48c9-9dfd-cbbfdd987466
    --project stockport-badminton-map`. When updating referrers, **pass both
    `--api-target` flags in the same command**.
  - The venues map generator uses a separate server-only `GMAPS_STATIC_API_KEY` and is
    unaffected; Vision on the server uses ADC, not a key.
- `POSTHOG_KEY` — PostHog project key (`phc_…`, EU cloud). Public, like a DSN: it is
  printed into the page. **Unset loads no PostHog at all.** When set, `header.ejs` loads
  PostHog on **every page** in production (not for superadmins) as web analytics, running
  beside Google Analytics from Oct 2026 to see whether it can replace it, and **records
  sessions only on the results-entry pages** for logged-in users. The scorecard wizard sends
  `scorecard_ocr_*` / `scorecard_step` events through `sblTrack`, so a recording can be
  found by what happened in it.
  **`cookieless_mode: 'always'` is what lets it run without a consent bar** — measured in a
  real browser: nothing in cookies, localStorage or sessionStorage, against a cookie plus
  four storage keys without it. The cost is that `identify()` is unavailable (the account
  id goes on every event as `account_id` instead) and a visitor returning on another day
  counts as new. Needs "Cookieless server hash mode" on in the project settings.
  **PostHog drops events from automated browsers**, so a Playwright check of what it sends
  sees nothing at all unless that test sets `opt_out_useragent_filter: true` — it reads as
  "cookieless mode sends no events" and is not.
  It replaced Sentry's replay: 50 a month shared with Tameside ran out within days, and
  Sentry's record-on-error keeps only ~60s, which misses the OCR steps before the failure.
- `SENTRY_DSN` — Server-side Sentry DSN (the `node` project). If unset, Sentry is a no-op, so it's optional locally. Set it in Cloud Run for prod error reporting. Wired via `instrument.js` (loaded first in `app.js`); errors are captured in the central 500 handler in `routes/index.js`. Note: the **browser** Sentry is separate — hardcoded in `views/header.ejs` (the `javascript` project), not env-driven.

