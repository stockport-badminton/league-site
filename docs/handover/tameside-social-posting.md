# Handover: porting direct Facebook and Instagram posting to Tameside

> **Superseded 15 Sep 2026, the day it was written.** Tameside was ported the same evening,
> got its own Instagram account (`tameside.badminton`), and **every Make.com scenario is now
> disabled**. So trap 1 below no longer applies, and the ordering describes work that is
> done. Kept because the traps in it are why the port went the way it did — and because the
> record of a document being wrong within hours is worth more than a tidy one.

**Written 15 Sep 2026, for whoever picks up the
[tameside](https://github.com/stockport-badminton/tameside) repo.** Assumes no context from
the Stockport session that produced it. Everything here was measured against the live Meta
Graph API, not read from documentation — and where the two disagreed, the documentation
lost.

Stockport now posts results and weekly league tables to Facebook and Instagram from its own
codebase instead of Make.com. The Tameside Facebook page is in the same Meta Business
portfolio, so most of this is a different id and a different token. **The parts that are not
a straight copy are the ones that will cost you a double-posted week if you skim.**

---

## Read these three first

### 1. ~~The two leagues share ONE Instagram account~~ — resolved 15 Sep 2026

**Tameside now has its own account, `tameside.badminton`.** Everything below was true until
that evening and is kept because it explains why the Make scenario looks the way it does.

Meta had refused a second Instagram account when Tameside's was first set up, so both
leagues posted to `stockport.badders.results` (`17841409056774880`).

This is why the Instagram module in the Make results scenario has **no league filter**. It
looks like a bug. It is not. Adding a filter there stops Tameside appearing on Instagram at
all.

**What it means for this port:** two codebases can post to the same Instagram account, so
they can double-post. For *results* that resolves itself — the scenario is webhook-triggered,
so when Tameside stops sending its webhook the Instagram module stops firing for Tameside
too, with no edit needed. For the *weekly tables* it is a real constraint, and step 6 below
is the atomic cutover that handles it.

One thing that is NOT currently shared: **Tameside's league tables have never gone to
Instagram at all.** Route 3 posts them to Facebook only — the Instagram carousel alongside
carries Stockport's image URLs, not Tameside's. So porting the weekly post gives Tameside an
Instagram tables post it has never had, rather than reproducing one.

### 2. Instagram accepts JPEG and nothing else

Not PNG, not WebP. And Meta fetches `image_url` **from its own servers, later**, so the URL
must be public, unauthenticated and still serving when it gets round to it.

Tameside currently writes league-table PNGs into `/static/images/generated/` — a container's
own disk, which on Cloud Run belongs to one instance and does not outlive it. Both faults
were true on the Stockport side too, and its weekly Instagram carousel **never once worked**
in its entire existence.

Nobody noticed because Facebook kept posting. Make uploads *bytes* to Facebook, so that
branch never meets the format check; Instagram gets a *URL*. **One platform posting and the
other silently not is what a format constraint on the fetching side looks like** — if you
ever see that asymmetry again, suspect the fetch, not the code.

The fix was a route that renders on demand and returns JPEG bytes. Copy that shape; do not
try to make the file writing reliable.

### 3. A switch whose halves live in two places must fail loudly

On Stockport, `SOCIAL_POST_DIRECT` lives in the Cloud Run service config while the
credentials live in `.env`, which is gitignored and **never deployed**. Setting the flag
without copying the credentials across produced a service that took the direct path, found
no targets, **posted nowhere, and returned `ok: true`** — because an empty target list
produces neither a post nor a failure.

Make the equivalent throw. Do **not** fall back to Make: a fallback hides the
misconfiguration until it bites somewhere less convenient. See `models/fixture.js`,
`publishResultToMeta`.

---

## What already exists

| Thing | Value | Note |
|---|---|---|
| Facebook page | `413441425183665` | Same Business portfolio as Stockport's |
| Page token | `META_TAMESIDE_PAGE_TOKEN` | Already minted, in Stockport's `.env` and Cloud Run. Copy it |
| Instagram | `17841409056774880` | Shared — see trap 1 |
| Meta app | *Badminton Results App* | Live, with the "Manage everything on your Page" use case. Nothing further needed from Meta |
| Divisions | 2 | Stockport has 4; the image route is per-division either way |
| Static path | `/static/images/generated/` | Stockport uses `/static/beta/images/generated/`. **Do not copy paths blind** |

**A Page access token does not expire.** `debug_token` reports `type: PAGE`,
`expires: never`. It dies only if the granting account changes its Facebook password or
loses its role on the Page — and then everything fails at once and needs a person with a
browser. Meta reports that as error code `190`; make the message say so rather than
surfacing `OAuthException`, which sends you hunting a code bug that is not there.

---

## What to copy from league-site

| File | What it does | Change for Tameside |
|---|---|---|
| `utils/metaPublisher.js` | FB albums, IG photos and carousels, error flattening, per-target fan-out | Copy as is; point `targets()` at Tameside's env vars |
| `controllers/socialController.js` | On-demand table image route, `tableRowValues` | Copy the route shape; the drawing is Tameside's own |
| `utils/canonical.js` | `leagueTableImagePath` etc — every segment percent-encoded, URL ends `.jpg` | Copy. Division names contain spaces in both leagues |
| `controllers/weeklyTablesController.js` | The weekly post, with a dry run and a preview page | Two divisions instead of four; its own captions |
| `middleware/requireCronCaller.js` | Scheduler token or superadmin session, **403 never a redirect** | Copy; its own token variable |

Two things in `metaPublisher` that look like fussiness and are not:

- **Both platforms have a free "not yet visible" step.** Instagram creates a container that
  shows nowhere until `media_publish`; Facebook uploads with `published=false` and the photo
  shows nowhere until a feed post attaches it. Unused ones expire in 24 hours.
  `validateImages()` uses this to ask Meta whether it will accept an image **before anybody
  can see the answer**. It is how the PNG diagnosis was proved in the first place.
- **A post that reached Facebook and not Instagram has still reached Facebook.**
  `publishEverywhere()` collects per-target outcomes rather than throwing on the first
  failure — throwing would make a retry double-post the half that worked.

The `.jpg` on the end of every image URL is load-bearing. Instagram inspects the bytes, not
the extension, so an extensionless URL works fine — but then nothing upstream can tell a
JPEG URL from the PNG one that broke the carousel, and the guard has to choose between
crying wolf and being useless. The routes strip it before use, so old links keep working.

---

## The order to do it in

**The agreed plan is to leave both Make scenarios alone until Tameside is across too**, so
that retiring them is a disable rather than surgery. That is the better call and it changes
the ordering below — an earlier draft of this document paired each code change with a Make
edit, which would have meant picking routes out of a live scenario twice.

Each step is safe to stop after.

1. **Serve table images on demand, as JPEG.** A route per division returning bytes, no file
   writing. Everything downstream needs it, and it is worth doing on its own merits: the
   current PNGs on a container's disk are unfetchable by anything outside that instance.
   (On the Stockport side this also unblocked its Make Instagram carousel — but only because
   that scenario passes Stockport's URLs. Tameside's tables go to Facebook as *bytes*, so
   nothing in Make changes for you here.)
2. **Copy `metaPublisher` and wire the credentials.** Page id and token into the **service
   config**, not just `.env`. Verify by comparing hashes, not by eye — a malformed
   `gcloud --update-env-vars` delimiter can set one variable of seven and report success.
   That happened here.
3. **Dry-run against Meta.** `validateImages` on the real URLs. Publishes nothing. This is
   where a wrong URL or a stray PNG shows up harmlessly.
4. **Results: switch to direct, and stop sending the webhook.** These are the same change —
   the flag that turns one on turns the other off. **No Make edit is needed**, now or later:
   that scenario is webhook-triggered and routes on `imgUrl` containing `tameside-badminton`,
   so when Tameside stops sending, its route simply stops firing. Stockport's already has.
   Once both leagues are off it, the whole scenario is a no-op that can be disabled.
5. **Weekly tables: build it and create the scheduler job PAUSED.** Make's route 3 is still
   posting both leagues' tables, so an enabled job means two posts on a Saturday. Stockport's
   `sbl-weekly-tables-post` has been sitting paused since 15 Sep for exactly this reason.
6. **The one cutover that has to be atomic.** League Tables is schedule-triggered, not
   webhook — it fires every Saturday whatever the two sites do. So when both leagues are
   ready: **disable the Make scenario and unpause both scheduler jobs on the same day.**
   Either order within that day is fine; spanning a Saturday is not.

## Things that will not be in any brief

- **Firebase Hosting caches a response with no `Cache-Control` for ten minutes, 404s
  included.** Meta fetches these URLs and retries, so a transient 404 during a deploy gets
  cached and the retry never sees the fix. Set `no-store` on the miss path.
- **Hardcoded Instagram handles rot.** Make's caption mentioned `@manor_badminton_club`
  where the club's stored handle was `manorbadmintonclubwilmslow`, and named a club with no
  handle at all. A wrong `@handle` mentions a stranger or nothing, and nobody ever notices.
  Build the caption from the database — `Club.getInstagramHandles()`.
- **Facebook page mentions do not work as plain text.** The `@Shell Badminton Club` in
  Make's message has been posting literal @-names for years. Instagram mentions from a bare
  `@handle` **do** work. Don't spend time on the Facebook half: measured 16 Sep 2026, the
  `@[page-id]` syntax is silently stripped because the **Page Mentioning feature** is not
  granted, and getting it needs App Review plus business verification. Read
  `docs/plans/social-mentions.md` before touching this.
- **Check what the images actually say once the URL works.** Stockport's tables rendered
  `0 null null` for every team at the start of a season — the games columns are NULL before
  a first result, and `String(null)` is four characters. Nobody had seen it because nobody
  could fetch it. **A broken link was hiding a broken picture.**
- **Read the Make scenario before reproducing it.** Two of its three routes are dead, gated
  on a `tournament` variable hardcoded to `"false"`. Reproducing all three would have been
  building two features nobody uses.
- **`pointsFor` / `pointsAgainst` are GAMES won and lost, not league points.** Both leagues
  rank on games, all 18 of a fixture counting. A team with 6 played showing 60 and 48 is
  correct; the column names are what mislead.

---

## Where the rest of the detail lives

- `CLAUDE.md` in league-site — *Posting to Meta directly: what was measured*, and *Two
  leagues, one Make account, one Instagram account*. Both record **method as well as
  conclusion**, because one conclusion in there had to be retracted: a Facebook post that
  did not render logged out was read as a dev-mode restriction, when the post had simply
  been deleted. *A negative observation needs its other causes ruled out; a positive one
  does not.*
- Commits `5f95bbe` (publisher), `3f7b76c` (results path), `20188c9` (loud failure),
  `02d1f60` (weekly tables).
- The Make account is `My Lab` on `eu1`, shared between both leagues. Its free tier allows
  **two active scenarios**, which is the limit that put it on a paid plan — so retiring the
  last Tameside route is also what makes downgrading possible.
