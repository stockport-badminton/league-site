# Project-specific patterns

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.

### A new admin tool goes in `utils/adminTools.js`, not in the nav

The superadmin Admin dropdown carries a shortlist and "All admin tools…" (`/admin`, built
from `utils/adminTools.js`). It used to list every tool — 23 items — and because the navbar
is `fixed-top`, a dropdown taller than the window **cannot be scrolled**: the newest items
were unreachable on a laptop. Add a tool to `GROUPS`; it appears on the hub, and
`__tests__/unit/admin-tools.test.js` checks its route exists. Promote it to
`NAV_SHORTLIST` only if the request logs say it is used every week.
`e2e/admin-nav.spec.js` fails if any menu item cannot be clicked at 1280x720 or on a
375x640 phone.

### Asset URLs go through `asset()`, never by hand

`asset('/static/beta/css/custom.css')` (`utils/assets.js`, on `app.locals`) appends
`?v=<content hash>`, and a URL carrying the **current** hash is served
`max-age=31536000, immutable` — that is what lets Firebase's CDN and browsers hold the shell
(HARD-42; it was `max-age=0`, ~30,000 full re-downloads in 19 days). Three rules in it:

- **A hash this instance does not hold answers `no-cache`.** Two revisions serve side by
  side during a deploy, and the new page's `?v=<new>` reaching the old instance would
  otherwise pin the old bytes under the new URL for a year.
- **Unversioned is an hour, not a year**, so a template that forgets `asset()` is slow, not
  stale. `static/generated/` and `static/beta/images/generated/` stay `max-age=0` (written
  at runtime); `/sw.js` and `rootfiles/` keep their own treatment.
- **`/scripts` is not `node_modules` any more** — only `VENDOR_DIRS`. A new vendor file a
  page loads needs its directory added there, or it 404s.

### Icons are `icon('name')`, not Font Awesome classes

`<%- icon('trophy') %>` (`utils/icons.js`, on `app.locals`) inlines the SVG from the
installed `@fortawesome/fontawesome-free` package. The webfont and its stylesheet are gone
(HARD-44 — 118–274 KB of fonts for ~33 icons), so **an `fa-` class now renders as
nothing**; `__tests__/unit/icons.test.js` fails on one. Names are Font Awesome 6 file names
(`xmark`, not `times`), and an unknown name throws at render. The output is safe inside a
single-quoted JS string. An icon is the size and colour of its text; `icon-float` is the
old 30px floated look, opted into on the results pages.

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
- **`POST /scorecard-beta` — the publish step — takes a superadmin session OR a valid
  draft token** (`middleware/requirePublishAuthority.js`, Sep 2026). It used to carry a
  rate limiter and nothing else, while the `GET` was `secured` and the messer `POST` was
  too. `secured` alone is the wrong gate in both directions: it would let any logged-in
  member publish any outstanding fixture, and it would break the results secretary
  publishing from the emailed link on a device with no session.
  **The token test is `mayPublishDraft`, not `mayOpenDraft`.** Reading a tokenless draft
  is open to a superadmin only (HARD-03, narrowed by REARCH-09); publishing one by token
  never was. Reusing `mayOpenDraft` here, when it still opened tokenless drafts to anyone,
  would have left 1,557 of 1,562 drafts anonymously publishable while passing review and
  its own tests — which is why the two rules sit next to each other in
  `utils/scorecardLinks.js`, each saying why it is not the other.
- **`POST /add-scorecard-photo/:id` is unauthenticated**, so it takes four checks: the URL
  must be an object in our own S3 bucket, it is HTML-escaped into the email regardless,
  the draft must exist and have no photo yet, and a draft with a token must present it. It
  used to interpolate `req.body.imgURL` raw into a mail from
  `results@stockport-badminton.co.uk`, so a crafted value rewrote the message — phishing
  from our own verified domain, to the inbox expecting that exact email.
- **Hand-built email HTML escapes with `utils/html.js`.** EJS escapes; string
  concatenation does not, and every outbound email in this codebase is concatenated.

### A notification must not be able to fail the write it is reporting

`utils/afterCommit.js`. Anything that runs after a row is committed — the notification
email, the social webhook, extra data for the page about to be rendered — is courtesy, and
letting it reject sends the captain to the 500 page, **whose entire message is that nothing
was recorded**. What a captain does about that is submit the same result again.

```js
const notified = await afterCommit('draft received email', () => mailer.send({...}));
```

It returns the step's value or `null`, reports to Sentry as a **handled** event, and the
caller carries on. Two rules around it:

- **Then say which of the two happened.** "Filed, and the results secretary knows" and
  "filed, and nobody has been told" are different situations and only one needs the captain
  to do anything. The publish page has `notificationFailed`; the draft redirect carries
  `notified=0` and `populated-scorecard.ejs` reads it. Reporting only success makes a
  half-failure indistinguishable from a success — the same mistake as a rejection that
  looks like an acceptance in `POST /fixture/rearrangement`.
- **Swallowing inside the helper being called is not the same thing.** The three messer
  send helpers each caught their own failure and `console.error`'d it, so a failed send
  produced no Sentry event *and* the approver was answered "Result approved" either way.
  The catch belongs at the call site, where the caller can tell its user.

This was HARD-01's fix, and for four months it guarded `POST /scorecard-beta` — the publish
path — while `POST /email-scorecard`, the path captains actually use every week, awaited
`mailer.send` bare inside its `try` after the draft was already written. The same shape sat
in the messer submit and approve/reject handlers. **A fix that lives inside one handler
protects one handler**; the second caller is what turns it into a rule.

### Messer Knockout Tournament

Messer is a 15-game knockout (vs. 18-game regular fixtures):
- **Validation**: Allows negative scores (handicapped competition), no difference-of-2 requirement
- **Form**: `views/messer-scorecard.ejs` — 15 games (not 18)
- **Controller**: `controllers/messer-scorecard-controller.js`
- **Draft table**: `messer_scorecard` (mirrors `scorecardstore` but for 15 games)


### A lazy require is a deploy-time bug that waits

`models/fixture.js:sendResultZap` did `require('canvas')` inside the function. `e25436f`
(17 May 2026) replaced canvas with sharp in `controllers/socialController.js` and removed
`canvas` from `package.json`, touching three files — and missing that call site. So it
threw `Cannot find module 'canvas'` on **every result submitted for nearly four months**.

Nothing caught it because the require is inside a function on a path that only runs when a
result is submitted: the app boots, the tests pass, and it fails in production only.

It also shows how a fix can arrive as a blame: the exception surfaced as Sentry NODE-11
attributed to HARD-01, because HARD-01's `afterCommit` is what finally *caught and
reported* it. Before that it failed the request after the result had already saved — which
is the exact symptom HARD-01 was written to fix.

`__tests__/unit/runtime-requires.test.js` now walks `controllers/`, `models/`, `utils/`,
`routes/`, `middleware/` and the entry files and asserts every bare `require()` names a
**production** dependency — `dependencies`, not `devDependencies`, because the Dockerfile
runs `npm ci --omit=dev` and a devDependency required at runtime is exactly as missing.

## `sanitize-html` is pinned to an exact version, and it is the only one

`package.json` says `"sanitize-html": "2.17.5"` with no caret. Every other dependency
carries a range; this one does not, and the reason is not style.

**2.17.6 and 2.17.7 break the Jest suite** — 34 of 35 integration suites fail on
`require('sanitize-html')` with:

```
sanitize-html/node_modules/htmlparser2/dist/index.js:1
SyntaxError: Cannot use import statement outside a module
```

A nested `htmlparser2` ships ESM that Jest will not load. A caret range **allows** those
versions, so `npm ci` was safe only because the lockfile happened to hold 2.17.5 — and a
single `npm update` would have taken the whole suite out. The exact pin is what makes the
constraint deliberate rather than lucky. Verified by installing 2.17.7 and watching it
happen (Sep 2026).

**This costs us a real advisory, knowingly.** Two sanitize-html XSS advisories are open,
and 2.17.7 fixes both. What makes the trade acceptable rather than lazy is the reach:
`sanitize-html` is used in exactly one place, `controllers/homepageContentController.js`,
so the person supplying the HTML it sanitises is a **superadmin** editing site content.
There is no member-facing input path into it. Check that is still true before renewing the
decision — the moment it sanitises anything a captain or the public can submit, the
calculation changes and the suite is the thing that has to give.

**The way out is Node 24.9+ — HARD-41.** 2.18.0 moves to an ESM-only `htmlparser2 ^12`; Node 22 loads it, Jest 30 on Node 22 does not, and a babel-jest CJS transform was tried (11 Oct 2026) and fails the same way, because Jest's ESM check runs before any transform. Jest loads it natively from Node 24.9.

Note also that Dependabot names **2.17.6** as the fix. That is wrong for us: the SVG/SMIL
advisory covers `<= 2.17.6`, so 2.17.6 closes one of the two and leaves the other. If this
is ever revisited, 2.17.7 is the floor.


## Authentication & Authorization

### Session & User Model

- **Session name**: Must be `__session` (Firebase Cloud Run requirement)
- **Session store**: PostgreSQL (auto-creates table on startup)
- **User object** (`req.user`):
  - `id, displayName, email`
  - `_json['https://my-app.example.com/role']` — user role (e.g., 'superadmin', 'captain')
  - `_json['https://my-app.example.com/messeradmin']` — boolean flag for messer admin


### Route access (REARCH-04)

Every route starts with one declaration from `middleware/access.js`, and
`docs/routes.md` lists them all:
```javascript
router.get('/scorecard-beta', access.member, scorecard_controller.scorecard_beta);
router.get('/admin/spam', access.superadmin, spam_admin_controller.form);
```

`access.member` (and every level built on it) runs `middleware/secured.js`.

**`secured`'s behaviour**:
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


## Hardening backlog

`docs/hardening/` holds the work packages from the August 2026 audit, plus the ones each
round of work has turned up since — self-contained briefs with evidence, acceptance
criteria and a conflict map showing which can run in parallel.
`docs/hardening/README.md` first. The `/hardening` skill loads a single package without
pulling in the rest.

**Landed packages move to `docs/hardening/done/`**, so the top level is what is still open.
They are kept, not deleted: each records why some code is shaped the way it is, and is
worth reading before touching a file it owned. A package whose *code* is finished but which
still needs a human to do something — set an env var, change a bucket policy, flip a
switch — stays at the top level until that happens.

