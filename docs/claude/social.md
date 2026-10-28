# Social posting: result cards, weekly posts, Meta

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.

### The social result card's URL

`GET /resultImage/:homeTeam/:awayTeam/:homeScore/:awayScore/:division` renders the share
card with sharp, on demand — nothing stores the file, which is why Make.com fetches this
URL just before it posts rather than being handed an image.

**Build it with `resultImagePath()` from `utils/canonical.js`** (or `resultStoryImagePath()`
for the 9:16 story card; see `SOCIAL_POST_STORY`) (exposed to views as
`app.locals.resultImagePath`), never by interpolation. Every segment must be
percent-encoded: almost every team name in this league contains a space — "Tatton A",
"Mellor B" — as does every division name, and a raw space is not a legal URL character.

Make.com posts that URL straight to the Facebook Graph API, which fetches it server-side
and answered:

```
[400] Missing or invalid image file (324, OAuthException)
```

That reads as a problem with the image, the token, or Make. It was none of them — fetched
with the spaces encoded the endpoint returns 200 and a 1080x1350 JPEG in about a second.
Only the URL was malformed, and it was malformed by us, in `models/fixture.js`.

Two things worth keeping from it:

- **The URL was built in two places** — the webhook and `views/fixtures-results.ejs`
  (whose `data-img-url` the share button hands to the Web Share API). That is the same
  trap `eventPath()` exists to close, so it is one helper now.
- **`sendResultZap` is mocked in every suite that reaches it**, so what it posts had
  never been asserted by anything. `__tests__/unit/result-post-direct.test.js` now asserts
  what it queues and the URL it is posted with (the webhook payload test went with Make).
  A function that is only ever mocked is untested, however many tests mention it.

### The weekly social images, and why they are on demand too

`GET /league-table-image/:division` and `GET /tournament-image/:poster` render the weekly
carousel's pictures per request and return the bytes. Build the URLs with
`leagueTableImagePath()` / `tournamentImagePath()` from `utils/canonical.js` (exposed to
views), never by interpolation — every division name bar Premier contains a space.

They were added Sep 2026 because the originals could not work, for two independent reasons
that had both been true since the weekly post was built:

- **They were PNG, and Instagram's publishing API accepts JPEG and nothing else.** Meta's
  documentation is explicit. The Make.com scenario hands Instagram `image_url` values
  ending `.png`, so that carousel has never been accepted. The Facebook branch of the same
  scenario is fine — Make fetches the bytes itself and uploads them as `data`, so it never
  meets the format check. **One platform posting and the other silently not is what a
  format constraint on the fetching side looks like.**
- **They were files in `static/beta/images/generated/`**, which is the *container's* disk.
  On Cloud Run it belongs to one instance, does not outlive it, and is invisible to every
  other instance. The scenario's sequence is generate → sleep → fetch by URL; Instagram's
  fetch is later still and comes from Meta's servers. Measured 15 Sep 2026: all four table
  URLs returned **404**.

**Anything Meta fetches must be public and unauthenticated**, because the fetch comes from
Meta, not from a logged-in browser. Both routes are, and both are pure functions of data
already public on the league tables page.

The file-writing routes (`/tables-social`, `/tournament-social`,
`/handicap-tournament-social`) are still there and still writing, deliberately: the live
Make scenario calls them and its Facebook half works. They now take their content from
`TOURNAMENT_POSTERS` in `socialController`, the same object the on-demand route reads, so
the two cannot drift. Remove them once the scenario is repointed.

**A broken link was hiding a broken picture.** The images had been unreachable for so long
that nobody had seen what they said — and what they said was `0 null null` for every team,
because `String(null)` is four characters and only the `avg` column was guarded. It
surfaced the moment the URL worked. When something has been unreachable, assume nothing
about its contents.

### The weekly fixtures post, and the case where a scheduled job must publish nothing

`POST /admin/social/weekly-fixtures` (Sunday 18:00, `sbl-weekly-fixtures-post`) posts the
coming week's matches — one **1080x1350** card per division, as a Facebook album and an
Instagram carousel. 4:5 rather than the tables post's square: it is what the result card
uses, so the two match, and Instagram gives a 4:5 image more of the feed. `controllers/weeklyFixturesController.js`, and it deliberately mirrors
`weeklyTablesController` next to it: same `publishEverywhere` call, same per-target
reporting, same gate, same caption rules. The card is drawn by
`GET /fixtures-image/:division`, built per request like the league tables are, for the same
reason — Meta fetches it from Meta's servers, so it must be public and it must not be a
file on a container's disk.

It is a new post rather than a ported one: Make's scenario only ever looked backwards.

Three things about it are not in the tables post, and each is the interesting half:

- **Its content can legitimately be empty, and then it must publish nothing.** The league
  plays September to April. A job that fires all year would spend the summer posting four
  cards headed "Fixtures this week" with nothing underneath. So the division list is built
  from the fixtures that exist, and an empty week answers **200 with `skipped` set and
  `posted: []`** — 200 because nothing went wrong and a scheduler retrying a 4xx every
  Sunday of the summer is noise, `skipped` because `ok: true` with nothing posted is
  otherwise indistinguishable from a post that went out. That is the same rule as
  `notificationFailed` on the publish page: **report which of the two happened.**
- **The cards are chosen, not fixed.** A division always has a table; it can easily have no
  fixtures in a given week while the other three do. The list is filtered through
  `weeklyTablesController`'s `DIVISIONS` rather than built from whatever `divisionName`
  values come back, so a friendly or a renamed division cannot quietly add a fifth card —
  Instagram's carousel limit is 10 and a runaway list fails the whole post.
- **Only the clubs playing are mentioned.** The tables post names every club with a stored
  handle, because all four tables name them anyway. Here a mention is a notification, and
  notifying a club about a week it is not playing in is how an account gets muted.

Two smaller things worth not rediscovering:

- **The card is drawn on the division's own artwork** — `social-Premier.png` and friends,
  the same files `resultImage` uses, so a fixtures post and a result post for the same
  division look like one league. `fixturesBackground()` is the single lookup and **falls
  back to the plain background rather than throwing**: a division name with no matching
  file is reachable (a rename, a friendly) and Meta is fetching this route.
  That artwork has a fade and the division's letter baked into the pixels, which constrains
  every layout drawn on it. **HARD-37** (done) replaced it with clean backgrounds via
  `backgroundFor()` in `utils/socialCard.js`; the 2024 files are the fallback.
- **The panel is DARK, and that is the second attempt.** A white panel was built first and
  does not work: to be legible over the busy backgrounds it has to be near-opaque, and at
  that point the artwork underneath may as well not be there — which defeats the only
  reason for using the artwork. Measured by rendering 0.93 / 0.97 / 1.0 and looking at
  them. `#0d0d0f` at 0.80 lets the colour read through while white text sits on it
  comfortably. **Don't "fix" a legibility complaint by raising the opacity**; that is the
  road back to a white rectangle with a picture behind it.
- **The accent colour is derived from the artwork, with a floor.** Sampled from the
  artwork's TOP strip and then forced to a fixed lightness and minimum saturation. Derived
  so it followed the artwork when HARD-37 replaced it, rather than becoming four stale hex values;
  floored because the first version sampled `stats().dominant` over the *whole* image,
  which on these backgrounds is the bottom third's fade to near-white — producing an
  invisible accent, and in an earlier layout white text on a near-white bar. The tests
  assert every background yields something light enough to read **and** with chroma left in
  it, which is what catches the wash-out.
- **It names the league and the dates.** "Premier / Fixtures this week" tells someone who
  does not follow the league neither the sport nor the town nor which week, and a card gets
  seen by exactly those people. `fixtureDateRange` parses the range out of `dayLabel`
  rather than recomputing from a `Date`, so the heading cannot disagree with the rows.
- **`dayLabel` is formatted in SQL, with `to_char`.** `fixture.date` is `timestamp without
  time zone`, so Postgres prints exactly what is stored and no timezone is involved at any
  point. Formatting it from a JS `Date` works today *because* the container happens to be
  UTC, which is the shape of the BST off-by-one-day bug `localYmd` exists to apologise for.
- **The card caches for an hour, not the tables' day.** Its content is a function of
  `NOW()`, so a copy taken Sunday evening and served on Monday shows last week's window
  with nothing on it to say so.

**A preview page must show its own server's pictures.** Both preview pages build the card
URLs with `absoluteUrl()`, because that is what gets posted and Meta fetches it from Meta's
servers. Putting those same absolute URLs in the page's `<img src>` means the preview
always renders **production's** version of each card, whatever server you are looking at —
so a change to the renderer appears to do nothing locally. Found 16 Sep 2026 on the
fixtures preview, where it failed honestly (the route was not deployed, so the images were
simply missing while the page reported "2 of 4 divisions"). The tables preview had the
identical defect and **hid it**, because its routes *are* deployed and production's picture
loaded over the top of whatever the local code would have drawn. Both now use a same-origin
path for `src` and print the absolute URL beside it as text — the posted URL is information
the preview exists to give, it just must not be the thing rendered.

**The seven-day window is anchored to Europe/London's day, not the database's.** Supabase
runs UTC, so under BST `date_trunc('day', NOW())` is an hour behind the UK day: between
00:00 and 01:00 British time it truncates to *yesterday*. Measured 17 Sep 2026 at 00:03
BST — the UTC day was the 16th where the UK day was the 17th, and the card was showing a
night of fixtures already played while cutting the seventh day off the far end. **Both
boundaries were wrong at once**, which is what an off-by-one-day window looks like.
`fixture.date` holds UK local midnight as a naive timestamp, so `NOW() AT TIME ZONE
'Europe/London'` compares like with like.

`getUpcomingWeek` is **not** `getupComing`. The latter starts at `NOW() - 1 day` so the
homepage still shows a match being played tonight — right for a page someone is reading,
wrong for a post announcing what is still to come.

### Make.com is gone, and what it taught us on the way out

**Every scenario in the Make account is disabled as of 15 Sep 2026.** Both leagues post to
Facebook and Instagram from their own codebases, and the scheduled jobs that used to live
there are Cloud Scheduler jobs hitting our own gated routes. Nothing depends on Make any
more; the account is kept only so the disabled scenarios remain readable, on the free tier.
The webhook branch in `sendResultZap` and its `SOCIAL_POST_DIRECT` switch were removed on
28 Oct 2026, after a month with nothing sent through them.

Three things from that migration are still load-bearing:

- **Neither results scenario needed editing to retire.** It was webhook-triggered and routed
  on whether `imgUrl` contained `stockport-badminton` or `tameside-badminton`, so each
  league's route went dormant the moment that league stopped sending. The lesson generalises:
  **a webhook-driven integration is retired by ceasing to call it**, and reaching into the
  automation to remove routes is work you can usually decline.
- **The weekly tables scenario was schedule-triggered**, so it fired every Saturday whatever
  the two sites did. That one needed an atomic cutover — disable it and enable the scheduler
  jobs the same day, or Saturday posts twice.
- **Two of its three routes were dead**, gated on a `tournament` variable hardcoded to
  `"false"`. Read an automation before reproducing it; a third of that scenario was features
  nobody used.

**The two leagues used to share one Instagram account**, because Meta refused a second one
when Tameside's was set up — which is why that scenario's Instagram module carried no league
filter, and why anyone tidying it up would have silently stopped Tameside appearing at all.
**That stopped being true on 15 Sep 2026**, when `tameside.badminton` was finally created.
The constraint it imposed — that two codebases posting to one account can double-post — is
gone with it. Recorded because the previous version of this section said the opposite in the
present tense, and a warning that has quietly inverted is worse than no warning.

### Posting to Meta directly: what was measured, Sep 2026

Establishing whether the league can post without Make.com. `META_APP_ID` / `META_APP_SECRET`
identify our own app; the durable credential is a **Page access token**, minted from a
long-lived user token via `GET /me/accounts`.

- **A Page access token does not expire.** Confirmed with `debug_token`: `type: PAGE`,
  `expires: never`. It dies only if the granting user changes their password or loses their
  role on the Page. The user token it came from lasts ~60 days and is then disposable.
- **Instagram publishing works from an app in Development mode, and the post is publicly
  visible.** Measured: published from a dev-mode app, then fetched **unauthenticated** at
  its permalink — HTTP 200, full `og:` tags, no login wall. Meta's "data created in
  Development mode is only visible to role users" rule did not apply. An Instagram post
  belongs to the *account*, not the app. That contradicts the plain reading of the docs, so
  re-measure rather than trusting this line if it ever matters.
- **Whether the same is true of Facebook Pages is UNKNOWN, and was briefly recorded here as
  a finding when it was not one.** The reasoning failed in a way worth keeping:

  A Page post published from the dev-mode app did not render when fetched logged out, while
  a post Make had published to the same page three days earlier did. That looked like a
  clean controlled comparison, and the conclusion — "Pages enforce the dev-mode
  restriction, Instagram does not" — was written up. **The post had been deleted.** Asking
  the API settled it: the id returns "Object does not exist" while a later post returns
  normally for the same token.

  **A negative observation needs its other causes ruled out; a positive one does not.** The
  Instagram result stands precisely because the post *rendered* — nothing but a live public
  post produces `og:` tags. The Facebook result was "nothing came back", which deletion,
  a login wall, caching and a genuine restriction all produce identically. The control
  ruled out one of those and was mistaken for ruling out all of them.
- **Facebook Page publishing works, with the app Live.** A multi-photo album posted with
  the app in Live mode rendered publicly on an unauthenticated fetch, `og:image` included.
- **Creating a media container is not publishing, which makes it a free test.**
  `POST /{ig-id}/media` asks Meta to fetch and validate the image and returns a
  `creation_id`; nothing is visible until `POST /{ig-id}/media_publish`. Containers expire
  on their own in 24 hours. Use this to check a URL is acceptable before posting anything —
  it is how the PNG diagnosis was proved from Meta's side:

  ```
  new .jpg URL  -> CONTAINER CREATED
  old .png URL  -> "The media could not be fetched from this URI"
  ```

- **`pages_manage_posts` and `pages_read_engagement` are gated behind a use case**, not just
  app type: without "Manage everything on your Page" added in the App Dashboard, the login
  dialog answers `Invalid Scopes` and the permission cannot be requested at all. Instagram
  is a separate use case again, even though Instagram publishing runs on a Page token.
  Once added, both came through and a **multi-photo album post worked first time**:
  `POST /{page-id}/photos` with `published=false` for each image, then one
  `POST /{page-id}/feed` carrying `attached_media[n]={"media_fbid":...}`.
- **`published=false` is Facebook's free test, the same way a container is Instagram's.**
  The photo uploads and nothing appears on the page until a feed post attaches it. Use it
  to check Meta will accept a URL before anything is visible. Both platforms refused the
  old PNGs and accepted the new JPEGs, in different words:

  ```
  Instagram : "The media could not be fetched from this URI"
  Facebook  : "Make sure that your Page post includes an image that can be used in an ad"
  ```
- **A privacy policy URL is required to switch an app to Live mode** and is unset on ours.
  `https://stockport-badminton.co.uk/privacy-policy` exists and answers 200.
- `GET /{ig-id}/content_publishing_limit` reports quota: 100 posts per rolling 24 hours, a
  carousel counting as one.

