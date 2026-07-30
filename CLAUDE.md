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
  `roster-edit.spec.js` (team-management: pointer and **real touch** drag, arrow-key
  reordering, the row menu, Discard, plus mobile stacking — the reordering is
  JavaScript-only behaviour that no server-side test can reach),
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
  fire from touch, so nothing on it worked on a phone.
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
