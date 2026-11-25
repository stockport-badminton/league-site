# REARCH-07 — inline scripts out, and a bundler for code shared with the server

**Size:** M · **Window:** the scorecard templates off-season only; everything else
in-season OK
**Blocked by:** REARCH-03 part B step 1 (the shared rules module) for the wizard part.
**Absorbs:** **HARD-15** (inline scripts), whose brief stays the reference for the method.
Close HARD-15 into this package rather than running both.
**Owns:** inline handlers and `<script>` blocks in `views/**/*.ejs`, `static/beta/js/`, a
build step for browser modules, `OBSERVED['script-src']` in `utils/securityHeaders.js`.
**Source:** the 24 Oct 2026 "build it from scratch" review.

## Progress

**Steps 1 and 2 done, 25 Nov 2026, and widened to every handler outside the scorecard
templates.** The `.backup` template is deleted. Nothing could render it: the one dynamic
`res.render` builds `beta/messer-draw-*`, and Express reads `.backup` as an extension with
no engine. That took the count from **166 to 114**; the brief's 159 → 107 was measured in
October, and seven handlers have been added since. The other 12 then went too, leaving
**102, all in the three scorecard templates** (`index-scorecard` 52, `messer-scorecard` 26,
`populated-scorecard` 24), which wait for step 4:

- **`static/beta/js/actions.js`**, loaded on every page by `footer.ejs`. It reads
  `data-confirm` on a form (asks on submit) or a button (asks on click), and
  `data-navigate` on a select (goes to the URL plus the value). That covered six
  `confirm()` prompts (login cull, push test, homepage and junior-club deletes, the Messer
  swap) and the team form's copy-from dropdown. The Messer swap and login-cull prompts had
  team names, or `\'`, inside a JS string inside an attribute, so a name with an
  apostrophe broke the prompt. An attribute value has no such problem.
- **`elo-backfill` and `debugPanel`** use delegated listeners in their own script blocks
  (`data-backfill`, `data-debug`). Those blocks move to files in step 5.
- **`club-v2`'s Maps script is created from script** with `onerror` set there, instead of
  `onerror="showMapFallback()"` on the tag. The CSP template scan in
  `security-headers.test.js` now reads `x.src = '//host…'` as well as tags, since this was
  the last place it could see `maps.googleapis.com`.

**Held by** `__tests__/unit/no-inline-handlers.test.js`: zero outside the three
scorecards, and a ceiling on each of those, to lower as they go. **Proved by**
`e2e/inline-handlers.spec.js`, with no writes. Each case fails when its wiring is removed:
a declined confirm sends nothing and an accepted one posts; the dropdown navigates; the
backfill button asks for the selected season; the venue map shows its fallback within 2 s
(not the 4 s timer) when Maps is blocked.

Found on the way, not fixed here: the fixed footer covers the backfill page's
"Recalculate Season" button in a 720 px-tall window. The pre-existing failure in
`filter-toolbar.spec.js` ("the Columns dropdown hides a column and is not clipped") is
unrelated; it fails with these changes stashed.

**Step 5, first slice, 25 Nov 2026: the blocks with no EJS in them.** Twelve blocks in
eleven templates moved to `static/beta/js/` unchanged, loaded from where each block was,
so they run at the same moment with the same globals: `approve-signup`, `debug-panel`,
`elo-backfill`, `notifications-banner`, `notifications-video`, `tournament-gallery`,
`contact-us-form`, `push-test-form`, `team-strength-compare`, `homepage-content-form`, and
from `pwa-head` `sw-register` and `offline-banner`. The last two are `defer`, because
`pwa-head` is in every page's `<head>` and neither does anything before the page loads.
`offline-banner` and `actions.js` are now in the service worker's precache, because the
offline snapshot pages load them. The footer's login-link block went into `actions.js`.
`views/scorecard-upload.ejs` is deleted, along with `scorecardController.scorecard_upload`:
no route rendered it. `/sign-s3`'s `signedRequest` key was only for that page and can go.

**What is left: 29 blocks in 20 templates**, capped per template in
`no-inline-handlers.test.js`. They all interpolate server data. Slice B moves that data to
data attributes or a `<script type="application/json">` block, which the guard does not
count, and then moves the code. Slice C is `header.ejs`'s Sentry and PostHog setup, last.
`static-asset-caching.test.js` now checks that every literal `asset('…')` in `views/` is a
real file, so a mistyped path fails in Jest rather than as a 404 in the browser.
`e2e/moved-scripts.spec.js` checks each moved script loads, raises no error and still
works: SW registration, the offline banner, the contact form's dropdown and global
`onSubmit`, the video dialog, banner dismissal, and the Quill editors.

**Step 5, slice B begun, 25 Nov 2026.** `filtersJs.ejs` had no EJS in it and was pasted
into three pages' inline blocks; it is `static/beta/js/filters.js` now, loaded under the
same `filter` condition. `player_form` moved as is (its conditional closed inside the
`<script>`, so a page without `club_list` rendered a stray `</script>`). Two blocks whose
data went to data attributes: `messer-concede.js` reads the section from
`#concedeForm[data-section]`, and `event-map.js` (Google's loader plus "Show map") reads
the key, coordinates and venue name from `#eventMap`. The ceilings in
`no-inline-handlers.test.js` were recounted with the guard's own pattern. The first list
came from a shell count that still counted `gap-finder`, `player-request` and
`live-scorecard`, which already use JSON data blocks, and `filtersJs`, which only matched
because of a comment. **Left: 18 blocks in 12 templates.** Of those, 12 blocks in 8
templates are slice B (`club-v2` 4, `fixtures-results` 2, `datatables`,
`datatables-stats`, `elo-chart`, `messer-result-detail`, `player-game-stats`,
`shuttle-prices`), 2 are `header.ejs` (slice C), and 4 are in the scorecard templates
(step 4, off-season).

**Slice B, second batch, 25 Nov 2026.**
- **DataTables:** `datatables.ejs` and `datatables-stats.ejs` emit a `#dt-config` JSON
  block (the kind of table, the CSV and column-search flags, the results table's date and
  the `icon()` markup for the buttons). `static/beta/js/datatables-setup.js` builds both
  kinds of table from it, `defer`red after the library files it uses.
  `datatables-controls.ejs` is gone and its config is in the file. That template had
  `<% nearestDate = new Date() %>`, a second leaked global of the same kind: a page with
  no date jumped to the day the instance first rendered one. It is read, not assigned,
  now.
- **`messer-result-review.js`** reads the scorecard id from the Actions card's
  `data-scorecard-id`.
- **`shuttle-prices.js`:** the button's busy label is a `<template>` holding the
  spinner `icon()`.
- **`player-elo-chart.js`** draws from an `#elo-data` JSON block. The player's name used
  to be pasted unescaped into a JS string (`'<%- fullName %> ELO'`), so an apostrophe
  stopped the chart, and a `</script>` in a name would have ended the block. The data
  block escapes `<`.

**Left: 13 blocks in 7 templates.** Slice B is down to `club-v2` (4), `fixtures-results`
(2) and `elo-chart` (1). `header.ejs` (2) is slice C, and the scorecard templates (4) wait
for step 4.

**Slice B finished, 25 Nov 2026.**
- **`elo-compare.js`** (`/elo-chart`) reads `#elo-chart-config`.
- **`fixtures-results`:** `result-share.js` moved as is. A superadmin's
  `fixture-date-edit.js` takes its pencil icon from a `#fdPencil` `<template>`.
- **`club-v2`'s four blocks:** the fallback, `initMap` and the Maps loader are one
  `venue-map.js`, loaded after `venue-popup.js`. The venues are a `#venue-data` block
  (still through `jsonForScript`, which stops an address containing `</script>` ending
  it) and the key is `#map[data-maps-key]`. `initMap` stays a top-level function for
  Maps' `callback=initMap`. The contact buttons are `club-contact.js`. `venue-popup.js`
  now goes through `asset()`; it was the one script here on an unversioned URL.
- **Tests:**
  - `clubs-page-scripts.test.js` checks the JSON block and the files instead of inline
    blocks.
  - `venue-map.spec.js` reads `#venue-data` from the page instead of re-fetching it and
    parsing the source.
  - The CSP host scan in `security-headers.test.js` also reads `x.src = '//host…'` in
    `static/beta/js/`. Without that it would have stopped checking `maps.googleapis.com`
    without saying so.

**Step 5 now: no inline `<script>` outside `header.ejs` (2, slice C) and the three
scorecard templates (4, step 4).**

**A production bug found on the way, fixed.** `clubController` had `for (row of result)`
with no declaration, which assigned a global `row`. EJS resolves names a template is not
given against the globals, so after anyone loaded `/info/clubs`, every render of
`player_form` on that instance took the "Player Created!" branch and threw: `/player/create`
answered 500 until the instance recycled. `fixtureController` leaked `filter` and `division`
the same way, and `contactusController` leaked `row`. `filter` is the name the
filter-toolbar templates test. All four are declared now. `no-implicit-globals.test.js`
fails on an undeclared `for (x of/in …)` anywhere in server code. It was found because
`moved-scripts.spec.js` loads `/info/clubs` and `/player/create` on one server in parallel.

**Decided 25 Nov 2026 (Neil): `dist/` is built in the Docker image, not committed.** The
image installs with `npm ci --omit=dev`, so it needs a multi-stage Dockerfile: a build
stage with every dependency runs the bundle, and the runtime stage copies in only
`static/beta/js/dist/`. `dist/` goes in `.gitignore`. `npm run dev` and `npm run test:e2e`
get `pre` hooks that build it. Jest does not need it, because `asset()` renders a missing
file without a hash rather than throwing. A unit test should check that every `dist/` file
a view names has a `src/` entry, because Jest cannot see a 404 that only appears in a
browser. **Step 3 waits for the off-season, just before step 4**, so the bundler arrives
with its first consumer (the wizard importing `scorecard/rules.js`), not as an image
change with nothing using it. Step 5 does not need it: the moved blocks become plain
files under `static/beta/js/`.

## Why

Two separate reasons, which happen to need the same piece of work.

**1. The CSP cannot stop an injected script while `'unsafe-inline'` is in `script-src`,**
and it cannot leave while inline handlers exist (HARD-15 has the full argument, including
why a nonce makes it worse, not better, until the attributes are gone).

The count has moved since HARD-15 was written, and the shape of the job with it. Measured
24 Oct 2026, `onclick=` occurrences in `views/`:

| Template | `onclick=` |
|---|---|
| `views/index-scorecard.ejs` | 52 |
| `views/messer-scorecard.ejs.backup` | 52 |
| `views/messer-scorecard.ejs` | 26 |
| `views/populated-scorecard.ejs` | 24 |
| `views/partials/debugPanel.ejs` | 3 |
| `views/elo-backfill.ejs` | 2 |

So: **a third of HARD-15's 159 is a `.backup` file** sitting in `views/`, and of the real
107, **102 are in the three scorecard templates.** HARD-15 read as a long tail across the
site; it is actually the scorecard wizard, which is exactly the code REARCH-03 part B
rewrites around a shared rules module. Doing them separately means rewriting the wizard
twice.

**2. The scorecard rules must run in the browser and on the server from one file**
(REARCH-03 part B). Today the browser has its own copy of the score rules inside the
template. Sharing one CommonJS module with the browser needs a bundler.

## Design

- **esbuild**, one dev dependency, building `static/beta/js/src/*.js` →
  `static/beta/js/dist/*.js`. Entry points: `scorecard-wizard`, `messer-wizard`,
  `populated-scorecard`, and anything else that wants to import shared code.
- **Where it builds: in the Docker image** (decided 25 Nov 2026; see Progress). The brief
  had recommended committing `dist/` with a staleness test.
- **`asset()` already does the cache-busting** (HARD-42: content hash in `?v=`, a year's
  `immutable`). Bundles go through it like any other file. No hashed filenames, no
  manifest.
- **Icons are done** (HARD-44's `icon()`), and so are the MJML emails
  (`tools/build-emails.js`). This package does not touch either.
- **No framework.** Event delegation off a container with `data-action` attributes, the
  pattern `roster-edit.js` already uses. The wizard is a few hundred lines of DOM; a
  framework would be more code than it replaces.

## What to do

1. **Delete `views/messer-scorecard.ejs.backup`** after checking nothing renders it
   (`grep -rn "messer-scorecard.ejs.backup\|messer-scorecard.ejs\\.backup"`; Express
   resolves `.ejs`, so a `.backup` file should be unreachable — confirm, then delete). One
   commit, takes the count from 159 to 107.
2. The two small ones (`debugPanel`, `elo-backfill`) in-season, following HARD-15's method.
3. esbuild and the staleness test.
4. **Off-season, with REARCH-03 part B:** move the three scorecard templates' handlers and
   inline scripts into `src/` entry points that import `scorecard/rules.js`. The e2e specs
   (`scorecard-*`, `messer-*`, `populated-scorecard`, `form-contract`, `scorecard-phone`)
   are the safety net and must pass unchanged at every step.
5. The remaining inline `<script>` blocks (22 templates have one; the largest are
   `elo-chart`, `header`, `club-v2`, `filtersJs`) move to files. `header.ejs`'s third-party
   configuration (Sentry, PostHog) last. HARD-44 item 3 removed gtag in Nov 2026.
6. Drop `'unsafe-inline'` from the **report-only** `script-src`, watch `/csp-report` for a
   week of real traffic, then decide on `CSP_ENFORCE` for the resource policy (HARD-15's
   acceptance criteria, unchanged).

## Acceptance criteria

- Zero inline event-handler attributes in `views/`; a guard test holds it at zero.
- `script-src` has no `'unsafe-inline'` in the report-only header, and a week of
  `/csp-report` shows no violations from real pages.
- The browser and server score rules are the same file (a test imports the bundle's
  source and the server module and asserts they are the same module, or the wizard spec
  exercises a rule that only exists in the shared file).
- Every e2e spec passes unchanged.
- Cost: none. esbuild is a dev dependency; the bundles replace inline bytes the pages
  already download.

## Out of scope

- `style-src 'unsafe-inline'` (HARD-15's reasoning stands).
- Rewriting pages that do not share code with the server.
- A design refresh. Pixel-for-pixel the same pages.
