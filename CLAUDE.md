# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

**Stockport Badminton League Website** — A full-stack Node.js app using:
- **Backend**: Express.js server (Node 22.x)
- **Database**: PostgreSQL (Supabase) — uses `DATABASE_URL` connection string
- **Authentication**: Auth0 (OAuth 2.0 with Auth0 hosted login)
- **Session Store**: PostgreSQL (via `connect-pg-simple`)
- **Rendering**: EJS templates
- **Storage**: AWS S3 for scorecard images and generated assets
- **Email**: AWS SES for transactional emails

**Key URL Routing**: `/routes/index.js` — imports all controllers and establishes routes

## Critical Database Details

### PostgreSQL with MySQL-Compatible Wrapper

The app uses **PostgreSQL** (Supabase) but with a compatibility wrapper in `db_connect.js` that makes queries look like MySQL:

- **Placeholder syntax**: Use `?` in queries; wrapper converts to `$1, $2, ...` automatically
- **Column names**: camelCase columns MUST be quoted in SQL: `f."homeTeam"`, `f."awayScore"`, etc.
  - Unquoted identifiers are folded to lowercase by PostgreSQL, breaking JavaScript destructuring
- **Query API**: Always returns `[rows]` for mysql2-like destructuring: `const [results] = await conn.query(...)`
- **Connection**: Via `db.otherConnect()` — async, returns `{ query: pgQuery }`

**Example:**
```javascript
const [results] = await (await db.otherConnect()).query(`
  SELECT f.id, f."homeTeam" as "homeTeam", f."awayScore" as "awayScore"
  FROM fixture f
  WHERE f.id = ?
`, [fixtureId]);
```

### Common Table Patterns

- **fixture**: `id, date, homeTeam (int), awayTeam (int), homeScore, awayScore, status ('complete'/'conceded'/etc)`
- **team**: `id, name, division (int)`
- **division**: `id, name, league (int)`
- **scorecardstore**: Draft submissions — `(id, date, homeTeam, awayTeam, Game1homeScore, ..., Game18awayScore, homeMan1, homeMan2, ...)`
- **messer_scorecard**: Messer knockout draft submissions — similar schema but Game1-Game15 (15 games, not 18)
- **player**: `id, name, gender ('Male'/'Female'), team (int)`

**JOIN Pattern**: Always quote both column names:
```sql
LEFT JOIN team ht ON f."homeTeam" = ht.id
LEFT JOIN division d ON ht."division" = d.id
```

## Authentication & Authorization

### Session & User Model

- **Session name**: Must be `__session` (Firebase Cloud Run requirement)
- **Session store**: PostgreSQL (auto-creates table on startup)
- **User object** (`req.user`):
  - `id, displayName, email`
  - `_json['https://my-app.example.com/role']` — user role (e.g., 'superadmin', 'captain')
  - `_json['https://my-app.example.com/messeradmin']` — boolean flag for messer admin

### Two email columns on `player`, and they are not interchangeable

Both are `pgp_sym_encrypt`'d bytea — always bind `DB_PI_KEY` as a `?` parameter,
never inline it (one query had it as a string literal until Aug 2026).

- **`authEmail`** — the login identity, written only when a superadmin approves a
  signup (`Player.setAuthRole`). Read by `getAuthRoleByEmail` at login to enrich
  `req.user`. A player's Auth0 address is often not the one they gave their captain,
  which is why it exists at all.
- **`playerEmail`** — the contact address. This is what the profile form, the club
  contact page (`/club/:id`), the roster's mail links and the fixture reminder emails
  all read. Editable by the player.

Approving a signup **seeds `playerEmail` when it is blank**, in the same statement.
Without that the two never met: a player added to a roster by their captain starts
with no contact email, nothing else ever fills it in, and a signed-up player showed
blank on every surface above while holding a good address in `authEmail`. 53 players
were in that state before it was found (Aug 2026). The seed is guarded with
`COALESCE(NULLIF(TRIM(...), ''), '') = ''` — an initialisation, never an overwrite.

Note the blank is sometimes `NULL` and sometimes `pgp_sym_encrypt('')`, so a plain
`IS NOT NULL` test is not enough to decide whether someone has an email.

### Secured Routes

Use `/middleware/secured.js` middleware for auth-gated pages:
```javascript
router.get('/scorecard-beta', secured, scorecard_controller.scorecard_beta);
```

**Behavior**:
- If authenticated, proceeds
- If **DEV_MODE=true** and **NODE_ENV ≠ production**, injects mock user (any role/permissions)
- Otherwise redirects to `/login`

### Dev Mode (Local Development Only)

Set in `.env`:
```
DEV_MODE=true
NODE_ENV=development
```

Injects a mock `req.user` with superadmin + messeradmin roles. **SAFE** — only works outside production.

## Model/Controller/Route Structure

### Models (`/models/*.js`)
- Pure data layer; export async functions
- Handle SQL queries via `db.otherConnect()`
- Example: `fixture.js` exports `create()`, `getScorecardById()`, `createScorecard()`, etc.
- Pattern: `const [result] = await (await db.otherConnect()).query(sql, params)`

### Controllers (`/controllers/*.js`)
- Handle HTTP request/response logic
- Validate input (express-validator rules)
- Call models for data operations
- Render EJS views or return JSON

### Routes (`/routes/index.js`)
- Declare all endpoints
- Mount controllers
- Apply middleware (secured, JWT checks, etc.)

## Testing

### Setup
- **Framework**: Jest
- **Setup file**: `__tests__/setup.js` — sets required env vars before modules load
- **Test files**: Match `__tests__/**/*.test.js`

### Commands
```bash
npm test           # Run all tests once
npm run test:watch # Watch mode
```

### Test Patterns
- Unit tests: Mock dependencies, test middleware/pure functions in isolation
- Integration tests: Test full request/response flow (e.g., scoring endpoints)
- Mock `req`, `res`, `next` for middleware tests
- Use `supertest` for HTTP integration tests (see `__tests__/integration/`)

### Browser tests (Playwright)

Jest renders routes with supertest but never runs the page's JavaScript. The
scorecard forms live inside a Bootstrap modal and populate their team/player
dropdowns with jQuery from three endpoints; the stats tables are built by
DataTables. `e2e/` covers that layer.

```bash
npm run test:e2e      # headless
npm run test:e2e:ui   # interactive
npm run test:all      # jest, then playwright
```

- **Config**: `playwright.config.js` — starts the dev server itself with
  `DEV_MODE=true` (so the secured routes render without Auth0) and reuses one
  that's already running.
- **Specs**: `scorecard.spec.js` (18-game), `messer-scorecard.spec.js` (15-game),
  `populated-scorecard.spec.js` (the confirmation view for both),
  `filter-toolbar.spec.js` (filters/chips/DataTables controls),
  `roster-edit.spec.js` (team-management: pointer and **real touch** drag, drag
  *precision* — the row tracking the pointer and not falling into the wrong list —
  arrow-key reordering, the row menu and its clipping/flip, Discard, plus mobile
  stacking; the reordering is JavaScript-only behaviour that no server-side test can
  reach),
  `read-only-guard.spec.js` (self-test for the guard below).
- **Known bugs** are recorded with `test.fail()` *inside* the test body (at
  describe level the modifier applies to every test in the group). The suite stays
  green, and if the bug gets fixed the run says "expected to fail, but passed" —
  which is the prompt to delete the annotation. None outstanding.
- **Assert on rendered HTML, not the view name.** The older Jest tests in
  `__tests__/integration/messer-scorecard.test.js` mock `res.render` and only check
  which view was chosen — which is why they stayed green while
  `/populated-messer-scorecard/:id` rendered a blank form. The
  `— real render` describe block in that file restores the real render with
  `require('express').response.render.mockRestore()` and matches on the HTML. Use
  that pattern when the bug you care about is in the template's data contract.

**⚠️ These tests MUST stay read-only.** `dev.env` carries the *same*
`DATABASE_URL` as `.env`, so a local dev server is talking to the **production**
Supabase instance. A test that submitted a scorecard would create real rows in
`scorecardstore` / `messer_scorecard` / `fixture`.

`e2e/helpers/read-only.js` enforces this at the network layer rather than
trusting each test: it aborts any mutating request and `assertNoWrites()` then
fails the test. Call it at the end of every test. `POST /teams` is allowlisted
because `team_search()` only SELECTs despite the verb. If you need coverage of
actual submission, point the tests at a separate database first — don't widen the
allowlist.

Gotchas the specs already encode:
- Score/player dropdowns lead with `<option disabled selected>Choose …</option>`
  with no `value`, so `option.value` falls back to the *text*. Use
  `e2e/helpers/selects.js` to pick a genuinely selectable option.
- The scorecard modal is a multi-step wizard — the score inputs are not on step 1,
  so assert on attributes (e.g. messer's `min="-10"` vs the standard `min="0"`)
  rather than trying to type into them.
- The messer team dropdown is server-rendered with *every* team and replaced on
  section change, so "the list changed" is not a valid assertion for whichever
  section holds them all. Assert against the API payload instead.

## Querying the database

**Don't hand-write dotenv/db.connect boilerplate for a one-off query.** Use:

```bash
node tools/dbq.js "SELECT id, name FROM team LIMIT 5"
node tools/dbq.js --schema player        # columns and types
node tools/dbq.js --check all            # data-integrity checks
node tools/dbq.js --check orphan-results # the offending rows
node tools/dbq.js --json "SELECT ..."    # machine-readable
```

It loads `dev.env` then `.env`, connects, and prints a table. **It refuses anything that
is not a single read** — `DATABASE_URL` is production, and there is no local copy to
practise on. A write belongs in a reviewed script under `scripts/` (gitignored) with a
dry run, modelled on `scripts/backfill-contact-emails.js`: dry by default, `--apply` to
write, and the guard repeated in the `WHERE` clause of the write itself so a row that
changed between the read and the write can't be clobbered.

`tools/audit/checks.js` holds the integrity checks — orphaned results, orphaned drafts,
impossible scores, duplicate ranks, ghost teams, fixtures pointing at deleted teams.
Each one found something real. Run `--check all` before and after any data work.

One lesson already encoded there: **a data check must not inner-join to the data it is
checking.** The `bad-totals` check reported 2 of 8 offending fixtures until it was
changed to a `LEFT JOIN`, because six of them reference teams that no longer exist.

## Hardening backlog

`docs/hardening/` holds the work packages from the August 2026 audit — thirteen
self-contained briefs with evidence, acceptance criteria and a conflict map showing which
can run in parallel. `docs/hardening/README.md` first. The `/hardening` skill loads a
single package without pulling in the rest.

## Common Commands

### Development
```bash
npm run dev          # Development server (nodemon, dev.env)
npm start            # Production server (app.js with .env)
npm run prodlocal    # Prod-like server locally (prod build, .env)
```

### Testing
```bash
npm run test:e2e     # Browser tests (Playwright) — read-only, see Testing above
npm test             # Run once
npm run test:watch   # Watch mode
```

### Other
```bash
npm run gallery      # Run beta gallery tool
```

## Project-Specific Patterns

### Form Validation (express-validator)

Scorecard form validation is complex — validates 18 games + player uniqueness:
```javascript
// In controller, define validation rules:
const { validationResult } = require('express-validator');
const errors = validationResult(req);
if (!errors.isEmpty()) {
  // Re-render form with errors AND repopulated data (see below)
}
```

**Critical**: On validation error, must repopulate form with:
1. `data: req.body` — submitted form values
2. `scorecard: { divisionRows, homeTeamRows, ... }` — team/player dropdowns with selected flags set

Without this, form appears empty after error (user loses all entered data). See `controllers/scorecardController.js` lines 155-169 for the working error handler pattern.

### Image Generation (sharp + SVG overlays)

Result images are created via sharp with SVG text overlays:
```javascript
const sharp = require('sharp');
const postBuffer = await sharp(bgPath)
  .resize(1080, 1350, { fit: 'cover' })
  .composite([{ input: svgOverlay(1080, 1350, elements) }])
  .jpeg({ quality: 90 })
  .toBuffer();
```

SVG elements use XML escaping to avoid injection (see `utils/` for helpers).

### Video Generation (FFmpeg)

Phase 8a: Weekly video generation from fixture results
- Endpoint: `GET /api/social/generate-weekly-video?duration=2&aspect=both`
- Queries real fixture results from database
- Generates slideshow video using FFmpeg
- Supports 16-9 (1920×1080) and 1-1 (1080×1080) aspect ratios
- Creates temporary image sequences, outputs to `static/beta/videos/generated/`

### Scorecard confirmation links and the photo endpoint

The link emailed when a draft is filed is `/populated-scorecard-beta/:id?t=<token>`. The
token is a random per-draft column, `scorecardstore."confirmToken"` (migration 011), and
it exists because the id alone is a sequential primary key running to ~2,400 — every
scorecard ever filed could be walked by counting, and confirmed by an outsider.

- **All of it lives in `utils/scorecardLinks.js`** — minting, comparing (constant time),
  building the URL, and the rule for what may be stored as a photo. Don't reimplement any
  of those next to a new caller.
- **A draft with no token still opens.** Links filed before the column existed are
  already in captains' inboxes; `draftRequiresToken()` treats NULL/'' as "no token
  needed", and there is deliberately **no backfill**, because minting tokens for existing
  rows is exactly what would invalidate those links. The clause carries a note saying what
  removes it.
- **Emailed links go through `confirmationUrl()`/`absoluteUrl()`**, never
  `req.headers.host` — see gotcha 1b.
- **`POST /add-scorecard-photo/:id` is unauthenticated**, so it takes four checks: the URL
  must be an object in our own S3 bucket, it is HTML-escaped into the email regardless,
  the draft must exist and have no photo yet, and a draft with a token must present it. It
  used to interpolate `req.body.imgURL` raw into a mail from
  `results@stockport-badminton.co.uk`, so a crafted value rewrote the message — phishing
  from our own verified domain, to the inbox expecting that exact email.
- **Hand-built email HTML escapes with `utils/html.js`.** EJS escapes; string
  concatenation does not, and every outbound email in this codebase is concatenated.

### Messer Knockout Tournament

Messer is a 15-game knockout (vs. 18-game regular fixtures):
- **Validation**: Allows negative scores (handicapped competition), no difference-of-2 requirement
- **Form**: `views/messer-scorecard.ejs` — 15 games (not 18)
- **Controller**: `controllers/messer-scorecard-controller.js`
- **Draft table**: `messer_scorecard` (mirrors `scorecardstore` but for 15 games)

### Search / crawlability

`GET /sitemap.xml` is **generated per request** by `controllers/sitemapController.js`
(~718 URLs: public static pages, tables/results per division, the archived seasons'
All views, and the last 18 months of `/event/` pages). It replaced a hand-written
`rootfiles/sitemap.xml` from 2018. Two things to keep in mind:

- `express.static('rootfiles')` is mounted in `app.js` **well before** the router, so
  re-adding a `rootfiles/sitemap.xml` would silently shadow the route. Same trap as
  `/sw.js`, which is registered early for this reason.
- Only list URLs that answer 200 to an anonymous request. Anything behind `secured`
  (`/player-stats`, `/pair-stats`, `/messer-results`, `/manage-players`,
  `/shuttle-prices`, all of `/admin`) must stay out — a login redirect in a sitemap
  reads as a soft 404. There's a test asserting this.

Event-page URLs come from `eventPath()` in `utils/canonical.js`, exposed to views as
`app.locals.eventPath`. `homepage.ejs` and the sitemap both call it: only `:id` is
read from `/event/:id/:date-:homeTeam-:awayTeam`, so a second spelling of the
decorative part would be a duplicate URL for a page that self-canonicalises. Club
pages work the same way through `clubPath()` / `app.locals.clubPath`.

**Club pages** — `/clubs/:slug` (`club_public_page`, view `club-page.ejs`), matched
by name slug against `Club.getPublicClubs()`, with `clubSlug()` dropping punctuation
rather than hyphenating it so "G.H.A.P" is `ghap`. They exist because Search Console
showed `badminton club near me` at position 24.5 on 1,387 impressions with all 18
clubs sharing the single `/info/clubs` URL — one page cannot rank for 18 local
intents. What makes them work is the town in the `<title>` plus machine-readable
address and coordinates, so keep those.

Two constraints on that page:
- **No captain or secretary names or contact details.** It is indexable and they are
  volunteers; enquiries go via `/contact-us?club=<id>` (which preselects the club) or
  the club's own site. There's a test asserting this.
- It must stay linked from `/info/clubs`, which is in the sitewide nav. A sitemap
  entry alone is weak — before this, the club names on that page linked straight out
  to the clubs' own websites, so nothing on the site linked to our own club pages at
  all. The outbound link is still there, just beside rather than instead.

**Structured data (JSON-LD) is built in `utils/structuredData.js`, never in a
template.** Controllers pass a `jsonLd` local — an array of already-serialised
blocks — and `header.ejs` emits them with `<%- %>`. To add markup to a page, build
an object there and pass it; do not write JSON into an EJS file.

That rule exists because the previous approach failed in two ways that could not
error: escaped-output tags escape for HTML, not JSON (a club called Mulberry's
shipped as `Mulberry&#39;s`, and a double quote would have broken the block), and
several property names were not schema.org at all — `competitor: [{"@type":
"SportsTeam", "homeTeam": "..."}]`, `"type"` instead of `"@type"` on the address,
`Lat`/`Lng` instead of `geo` — so the team names, the whole postal address and the
coordinates were silently discarded. Invalid JSON-LD is ignored, not reported.

Notes on the helpers:
- `parseUkAddress` recovers streetAddress/locality/postcode from the single freetext
  `venue.address` column by splitting on the postcode. It replaced a regex against a
  hardcoded town list that emitted match *arrays*
  (`"addressLocality": "Cheadle Hulme,Cheadle Hulme"`) and picked "Manchester" out of
  "Manchester Road". `addressRegion` is deliberately omitted — it was hardcoded
  "Cheshire" for every club including the Greater Manchester ones.
- `geoOf` drops coordinates outside a bounding box for the league's catchment,
  because one venue is stored ~110km north of it. A wrong location is worse than
  none for a "near me" query.
- `londonOffset` asks `Intl` for the offset instead of `getTimezoneOffset()`, which
  is 0 on Cloud Run — so production used to emit `startDate` with no offset at all.
- Times come from `to24h`. Check am/pm **before** treating `H:MM` as 24-hour, or
  "7:30pm" reads as 07:30.

### Spam and abuse controls

Five layers, deliberately independent, because each covers what the others can't:

| Layer | Where | Notes |
|---|---|---|
| reCAPTCHA | `validCaptcha` in `contactusController` | On `/contact-us` only. It works — a fake token is rejected |
| Rate limits | `middleware/rateLimit.js` | 12 public endpoints + sitewide backstop |
| Blocklists | `blocked_entry` table, `models/spamControls.js` | ip / email / phrase / word |
| Honeypot + timing | `views/spam-fields.ejs`, `utils/spamChecks.js` | Catches bots we've never seen |
| Submission log | `submission_log` table | The only way to tell whether any of it works |

**Blocking someone is a form submission, not a deploy** — `/admin/spam` (superadmin, in
the Admin nav). It used to be a source edit: 89 spammer addresses and ~180 phrases were
hardcoded in `contactusController.js` and three IPs in `app.js`. Don't put lists back in
code.

Rules worth not rediscovering:

- **Mount `globalLimiter` after the static handlers.** Above them it counts every
  stylesheet, script and image, so one page view is a dozen hits — the Playwright suite
  exhausted a 600-request budget partway through and only 23 of 44 specs ran.
- **A new public form must include `views/spam-fields.ejs`** inside its `<form>`, and its
  route must carry `spamGate()` and a limiter. The shared partial exists so the honeypot
  and the timing floor can't drift apart or be forgotten.
- **A rejection is deliberately indistinguishable from a success.** Naming the check that
  fired is how a spammer tunes a payload. The cost is that a false positive silently eats
  a real message — which is why only the two checks with negligible false-positive rates
  behave this way, and why every rejection is logged with a reason. **Watch the
  `validation` count on `/admin/spam`:** rising means real people failing the form.
- **A missing timing stamp is not spam.** Caches, autofill and any form rendered before
  the field existed would all be caught. Only the floor is enforced, so a stale tab still
  submits.
- **`models/spamControls` never fails closed.** A DB hiccup means empty lists, not
  rejecting every submission. The cache is warmed before `listen()` because the IP check
  reads it synchronously on every request.
- **Rate limiters keep counters in module state**, so `resetRateLimits()` runs before each
  test from `__tests__/setupAfterEnv.js`. It can't live in `setup.js` — that's a
  `setupFiles` entry and runs before `beforeEach` exists. A test that wants to see a limit
  bite must exhaust it within one case.

Anything unauthenticated that sends email must derive its recipients server-side.
`/fixture/reminder` took the address from the request body and was an open relay from our
own verified domain; the risk there is the domain's sending reputation, not spam arriving.

**Still open:** `POST /fixture/rearrangement` is unauthenticated and writes to `fixture` —
it sets a fixture to `rearranged` and inserts a replacement from `{homeTeam, awayTeam,
date}`. Rate-limited but not authorized. Fixing it changes how captains request
rearrangements, so ask first.

### Security response headers and the CSP

`helmet` is mounted at the very top of `app.js` — above the static handlers, the IP
blocklist and `/healthz` — because the requirement is every response. The policy itself
is in **`utils/securityHeaders.js`**, where every allowlist entry sits beside the
template that forces it. Read that file, not `app.js`, to understand the policy.

Two CSP headers go out, and the split is the design:

| Header | Holds | Why |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors`, `base-uri`, `object-src`, `form-action` | No resource allowlist at all, so it cannot blank a page that works today |
| `Content-Security-Policy-Report-Only` | the full `script-src`/`style-src`/`img-src`/… allowlist | This is the one that could break the scorecard modal, so it observes first |

- **Adding a CDN to a view means adding it to `OBSERVED`.** A test walks `views/**/*.ejs`
  for external `<script src>` / `<link href>` and fails if a host is missing, so this is
  caught rather than discovered when enforcement is flipped on.
- **Not everything is greppable.** Google Maps injects a `fonts.googleapis.com`
  stylesheet at runtime, and both the Facebook page plugin and reCAPTCHA create iframes
  that appear in no template. Grepping for `<iframe>` finds nothing and builds a policy
  that breaks both.
- **`script-src` keeps `'unsafe-inline'`**, because `views/` has 159 inline `onclick`
  attributes. Do not "improve" this by adding a nonce: a nonce makes the browser *ignore*
  `'unsafe-inline'`, and no nonce can be attached to an `onclick` at all, so it would
  break every one of them. Removing them is HARD-15.
- **`frame-ancestors` is ignored in a report-only header**, which is why the clickjacking
  protection had to go in the enforcing one to do anything.
- Violations POST to `/csp-report` (in `app.js`, above `globalLimiter` for the same reason
  `/healthz` is). Sentry does *not* collect these by default — that needs `report-uri`
  pointed at its security endpoint and the feature enabled, which was never set up.

### Team management (rosters)

Two pages, two audiences — they used to be one template switching on a
`superadmin` boolean, which is why the captain's view was laid out around drag
targets she couldn't use.

| Route | Who | View |
|---|---|---|
| `/manage-players` | superadmin picks a club; a club admin is redirected to their own | `roster-clubs.ejs` |
| `/manage-players/club-:club` | captains and admins — read-only | `roster.ejs` |
| `/manage-players/club-:club/edit` | reordering, moves, add/transfer | `roster-edit.ejs` |
| `/manage-players/club-:club/registration.docx` | the league's registration table, streamed | — |

`roster-team-card.ejs` and `roster-row.ejs` are shared by both pages so they can't
drift. Editor behaviour lives in `static/beta/js/roster-edit.js`; styles in
`static/beta/css/roster.css`, opted into with
`include('header.ejs', { useRosterCss: true })`.

**player.rank is the nominated order AND the reserve flag**, per `(team, gender)`:

```
rank 1..N   nominated, in strength order
rank >= 99  reserve, in order (99 = first reserve, 100 = second, ...)
NULL        treated as nominated; gets a real rank on the next save
```

Reserves were previously all written a flat `rank = 99`, so their order could be
dragged but never saved. Anything asking "is this a reserve" must use
`Roster.isReserve(rank)` (i.e. `>= 99`), never `=== 99`. Ranks are per-gender
because a fixture picks 3 men and 3 ladies independently — a team's number 1 man
and number 1 lady both hold rank 1. Display position is recomputed from list order,
so a team whose stored ranks have gaps (there are several, left by the old
client-side renumbering) still reads 1, 2, 3 and is normalised on its next save.

**Writes take intent, never SQL.** `POST /player/batch-update` used to accept
`tablename` and `fields` from the request body and interpolate both into an
`UPDATE`, behind `secured` only — any logged-in captain could write any column of
any table, including their own `player.role`. It is gone. Use:

```
POST /api/teams/:id/order        { sections: [{ gender, section, playerIds: [...] }] }
POST /api/players/:id/move       { teamId, section }
POST /api/players/:id/release
GET  /api/roster/club-:club/candidates?term=
POST /api/roster/club-:club/players | /attach | /transfer
```

`models/roster.js` renumbers **both ends of a move in one transaction** via
`db.withTransaction` (added for this — `otherConnect()` takes a connection per
query, so it cannot hold a transaction). Never renumber client-side: doing so is
what left teams ranked 1, 2, 4, 6.

**`saveTeamOrder` takes section membership from the payload, and settles a gender's
two lists together** (`renumberGender`). Whether someone is nominated is what the
save is *changing*, so it cannot also be the thing that decides which list they
belong to. Reading it from the rank already stored meant a promoted reserve was
dropped from the nominated list for not already being nominated, then re-appended to
the reserve list as a member the payload hadn't named: the save wrote **nothing**,
answered `ok: true`, and the refresh put them back. It was live for a month and no
test caught it — every case posted one section, or four with nobody crossing.
`renumberSection` still derives membership from the ranks, and is only for closing
the gap a departing player leaves behind in `movePlayer` / `releasePlayer`.

**Authorization**: `secured` only proves someone is logged in. Anything scoped to a
club also needs `middleware/requireClubAccess` — as route middleware where the path
carries `:club`, or `assertClubAccess(req, clubName)` inside a handler that has to
look the club up first. Id-keyed endpoints resolve the club from the row's real
owner (`Roster.getTeamOwner` / `getPlayerOwner`), never from the request.

**`/api/` errors answer in JSON**, via a handler that runs before the HTML one in
`routes/index.js`. 4xx messages are passed through to the client (the editor shows
them in its toast); 5xx messages are not, since they can carry SQL.

Gotchas:
- `custom.css` styles `.fa` globally for the footer's social icons (`font-size: 30px;
  float: right`), and `nav.ejs` wraps every page in `.starter-template` which sets
  `text-align: center`. `roster.css` undoes both for `.roster-page` — don't "fix"
  them centrally, 40-odd other pages depend on them.
- Drag uses **Pointer Events** plus `touch-action: none` on the handle. Both are
  needed; the old page bound only `dragstart`/`drop`, which mobile browsers never
  fire from touch, so nothing on it worked on a phone. `touch-action: none` also
  means the dragging finger can't scroll, which is why the drag runs its own
  edge auto-scroll off `requestAnimationFrame`.
- **The dragged row is positioned in document coordinates**, from the pointer's
  offset within it, re-derived after every DOM move (`reanchor()`). Don't go back to
  a running delta with the transform reset to zero on each swap: that snaps the row
  into its new slot out from under the finger, and the asymmetric hysteresis it
  leaves behind is what made the drag feel like it was catching.
- **The drop target is the list the pointer is in**, chosen by distance
  (`listUnder()`), not the first list that would accept an insert. A pointer *above*
  a list also tests as "before its first row", so first-match-wins meant a nominated
  player dragged up from the bottom of the list landed at the top of the reserves.
- **`.roster-card` must not clip** (no `overflow: hidden`). The row menu is absolutely
  positioned inside its row, so clipping the card cut the menu in half for everyone in
  the bottom half of a team. The head's rounded corners are set explicitly instead, and
  the menu flips to `.drop-up` near the foot of the window.
- `models/players.js:create` has no `RETURNING`, so its `insertId` is always
  `undefined`. Use `Roster.createPlayer` when you need the new id.
- Club 63 is `No Club` and team 52 is `No Team` — the sentinels a released player is
  parked on. Named as `Roster.NO_CLUB_ID` / `NO_TEAM_ID`.

## Docker & Deployment

- **Dockerfile**: Alpine Node 22 + ffmpeg + fontconfig + ttf-liberation
- **Target**: Google Cloud Run (requires `__session` cookie name, `PORT` env var)
- **Build**: `npm ci --omit=dev` (clean install, no dev dependencies)
- **Entry**: `node app.js`

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
- `SENTRY_DSN` — Server-side Sentry DSN (the `node` project). If unset, Sentry is a no-op, so it's optional locally. Set it in Cloud Run for prod error reporting. Wired via `instrument.js` (loaded first in `app.js`); errors are captured in the central 500 handler in `routes/index.js`. Note: the **browser** Sentry is separate — hardcoded in `views/header.ejs` (the `javascript` project), not env-driven.

## Gotchas & Lessons Learned

1. **PostgreSQL column quoting**: Unquoted camelCase columns become lowercase. Always quote column names in SQL.
   This bites `AS` aliases too, not just column references: `AS teamCaptain` becomes
   `teamcaptain`, so `row.teamCaptain` is `undefined`. That silently blanked the
   captain and match secretary on every `/event/` page for as long as it existed.
1b. **Never build a URL from `req.get('host')`.** Firebase Hosting rewrites `**` to
   Cloud Run and the Host header that arrives is the *Cloud Run* one — the requested
   host is passed separately, in `x-fh-requested-host`. Every canonical and `og:url`
   on the site pointed at `league-site-akvq7tsxuq-nw.a.run.app`, which serves the
   whole site publicly, so Google was told the authoritative copy of every page was
   on another hostname. Use `canonicalFor(req)` / `absoluteUrl(path)` from
   `utils/canonical.js` — including for links in emails. `SITE_ORIGIN` overrides the
   default for a staging deploy.
1bb. **`/healthz` never reaches the container, and a new endpoint gets curled in
   production.** Google's frontend intercepts that exact literal path in front of Cloud
   Run and answers its own `Error 404 (Not Found)!!1` page — no response headers of ours,
   so the request demonstrably never arrives. The health endpoint is therefore served at
   **`/health`** (both are registered; monitor `/health`). What makes this worth
   remembering is not the path: it passed Jest, it passed against a real local server,
   and it 404'd in production, because the thing that breaks it only exists once there is
   a Google frontend in front of the app. `/healthz/` and `/HEALTHZ` both answer 200,
   which is how it was pinned down — compare a path you know has no route (it should
   return *our* 404 page, with our headers) against the one you are debugging.
1c. **An INNER JOIN to something optional loses the whole page.** `getFixtureEventById`
   joined the home team's captain, six teams have none flagged, and the 48 affected
   fixtures rendered as `HTTP 200` with a two-byte body. Two lessons: join optional
   things with `LEFT JOIN` (or a scalar subquery, which also makes the pick
   deterministic when there are duplicates), and never `res.send(err)` — an Error
   serialises to `{}` and goes out with the default **status 200**, so a crawler
   banks it as a real page. Use `next(err)`, or an explicit `res.status(404)`.
2. **Query placeholders**: Use `?`, not `$1`. The wrapper converts automatically.
2b. **There is no `insertId`.** The wrapper mimics mysql2's `[rows]` shape but cannot
   invent MySQL's `insertId`: Postgres reports nothing about an inserted row unless the
   statement says `RETURNING id`. Without it an INSERT resolves to an *empty rows
   array*, so `result.insertId` is `undefined` — silently, since nothing throws. Any
   INSERT whose id is needed must end `RETURNING id`, and the caller reads
   `result[0].id`. This bit three separate flows (submitted scorecards redirected to
   `/populated-scorecard-beta/undefined` and emailed that dead link for months; the
   add-player modal posted `NaN` as the new id). **When mocking such a model in a
   test, mock `[{ id: 42 }]`, never `{ insertId: 42 }`** — the invented shape is
   exactly what let the scorecard bug live behind a green test.
2c. **The `pg` Pool must keep its `'error'` listener.** `pg` emits `'error'` on the
   Pool when the backend hangs up on an **idle** client, and an EventEmitter `'error'`
   with no listener is an uncaught exception — so a connection Supabase reaped while
   nobody was using it killed the whole Cloud Run instance, in-flight requests
   included (Sentry NODE-X, 6 Aug). Nothing catches this for you: the pool works
   perfectly in dev, in tests, and under any load that keeps its connections busy, so
   the gap is invisible until it isn't. Only idle clients come through the handler —
   an error on an in-flight query rejects that query's promise and surfaces through
   the caller's `try`/`catch` and the central 500 handler. Swallowing is correct (pg
   has already discarded the client); it's captured to Sentry so the event stays
   visible as *handled*. If it starts arriving often, the real fix is the transaction
   pooler on 6543 — which is what `PG_POOL_MAX` exists for.
3. **Form repopulation on errors**: Must pass both submitted data AND team/player dropdowns with selected flags, or form appears empty to user.
4. **Session cookie name**: Must be `__session` for Cloud Run (Firebase requirement).
5. **DEV_MODE is safe**: Only works outside production; injects mock user for local testing without Auth0.
6. **Model exports are async**: Always await model calls — they return promises.
7. **Test setup**: `__tests__/setup.js` runs before any test, sets env vars (don't rely on .env in tests).

## File Organization

```
league-site/
├── app.js              # Main entry point
├── db_connect.js       # PostgreSQL wrapper (MySQL-like API)
├── package.json        # Dependencies & scripts
├── controllers/        # HTTP handlers
├── middleware/         # Express middleware (auth, dev mode)
├── models/             # Data layer
├── routes/             # Route definitions
├── views/              # EJS templates
├── __tests__/          # Jest tests
│   ├── setup.js
│   ├── unit/
│   └── integration/
├── static/             # Static assets (CSS, images, generated videos)
├── migrations/         # Database schema (SQL)
└── Dockerfile          # Container config
```
