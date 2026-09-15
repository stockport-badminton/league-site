# Handover: porting direct Facebook and Instagram posting to Tameside

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

### 1. The two leagues share ONE Instagram account

Meta refused a second Instagram account when Tameside's was set up. Both leagues post to
`stockport.badders.results` (`17841409056774880`).

This is why the Instagram module in the Make results scenario has **no league filter**. It
looks like a bug. It is not. Adding a filter there stops Tameside appearing on Instagram at
all.

**What it means for this port:** two codebases can post to the same Instagram account, so
they can double-post. Move Tameside's Instagram posting and retire its Make route **in the
same change**, never in two.

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

Each step is safe to stop after. **Steps 4 and 6 can double-post**, which is why each is
paired with its Make change in the same step.

1. **Serve table images on demand, as JPEG.** A route per division returning bytes, no file
   writing. Worth doing alone: it makes the *existing* Make scenario's Instagram half work
   for the first time, with none of the rest of this.
2. **Copy `metaPublisher` and wire the credentials.** Page id and token into the **service
   config**, not just `.env`. Verify by comparing hashes, not by eye — a malformed
   `gcloud --update-env-vars` delimiter can set one variable of seven and report success.
   That happened here.
3. **Dry-run against Meta.** `validateImages` on the real URLs. Publishes nothing. This is
   where a wrong URL or a stray PNG shows up harmlessly.
4. **Results posts, and stop sending the webhook — together.** Tameside's site posts its own
   webhook to the shared Make scenario, routed by `imgUrl` containing `tameside-badminton`.
   Stop sending it and that route stops firing; **no edit to the scenario is needed**. Do not
   do one without the other: the Instagram module is unfiltered, so leaving the webhook on
   means every Tameside result posts twice to the shared account.
5. **Weekly tables post, paused.** Build it, create the Cloud Scheduler job, and
   **pause it**. Make's route 3 still posts Tameside's tables.
6. **Remove Tameside from Make's route 3, then unpause.** Route 3 fetches
   `tameside-badminton.co.uk/tables-social`, its two table images, and posts to page
   `413441425183665`. Remove those modules, then unpause — same day, or Saturday posts twice.

---

## Things that will not be in any brief

- **Firebase Hosting caches a response with no `Cache-Control` for ten minutes, 404s
  included.** Meta fetches these URLs and retries, so a transient 404 during a deploy gets
  cached and the retry never sees the fix. Set `no-store` on the miss path.
- **Hardcoded Instagram handles rot.** Make's caption mentioned `@manor_badminton_club`
  where the club's stored handle was `manorbadmintonclubwilmslow`, and named a club with no
  handle at all. A wrong `@handle` mentions a stranger or nothing, and nobody ever notices.
  Build the caption from the database — `Club.getInstagramHandles()`.
- **Facebook page mentions do not work as plain text.** The `@Shell Badminton Club` in
  Make's message has been posting literal @-names for years. Page mentions need the Pages
  API. Instagram mentions from a bare `@handle` **do** work.
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
