# REARCH-04 — every route declares who may call it

**Size:** M · **Window:** in-season OK
**Blocked by:** nothing. Soft: REARCH-09 part A (the normalised session user) makes the
role checks one line, but this package can read the current shape.
**Owns:** `routes/index.js` (split into `routes/*.js`), a new `middleware/access.js`, the
`isSuperadmin`-style helpers in controllers, a route-table snapshot test.
**Source:** the 24 Oct 2026 "build it from scratch" review.

## Why

Re-measured 26 Oct 2026, by walking the Express router stack rather than grepping (the
24 Oct figures, 270 routes and 37 `checkJwt`, predate HARD-49, which deleted the whole
Auth0 machine API). **231 routes** in `routes/index.js` (898 lines), plus 4 `router.use`
layers (`userInViews`, the 404 and the two error handlers), and **6 routes in `app.js`**
(`/sw.js`, `/static/generated/venues-map.png`, `/health`, `/healthz`, `/csp-report`,
`/api/live-scorecard/:id/state`). Who may call each one is decided in four different ways:

- route middleware — `secured` (118), `requireClubAccess.requireSuperAdmin` (31 routes;
  already the de facto `access.superadmin`), `requireClubAccess` (6), the
  `requireCronCaller` family (15: social ×10, invoices ×2, late scorecards, audit,
  registrations), `verifySns` (2), `requirePublishAuthority` (1), `devOnly` (1);
- **inside the handler** — 20 comparisons with `'superadmin'` on the role claim in 14
  files. Nine controllers each define a private `isSuperAdmin`/`isSuperadmin` (club,
  player, venue, shuttle, fixture, team, siteSettings, homepageContent, plus the one in
  `requireClubAccess`), `playerController` has three more inline, `messer-scorecard-controller`
  has four inline superadmin-or-messeradmin checks, and **a shared helper already exists
  twice** — `utils/authz.js` `isSuperAdmin` (3 callers) and `requireClubAccess.isSuperAdmin`.
  The rest are `utils/sessionUser.js:54`, `middleware/adminNavCounts.js` and the login
  mapping in `app.js:399`. Also in the handler: draft tokens (`mayOpenDraft` on
  `/populated-scorecard-beta/:id`, the live-scorecard API), and an env check on the three
  `/dev/*` routes instead of `devOnly`;
- a rate limiter and nothing else (`/sign-s3`, `POST /email-scorecard`,
  `/add-scorecard-photo/:id`, `/submit-form`, `/new-users-v2`, `POST /contact-us`,
  `/social-video/:aspect`, `/scorecard-photo/:id`);
- nothing at all — 110 of the 231 have no gating middleware. Most are public pages on
  purpose (tables, results, fixtures, clubs, rules, images, sitemap, `/login`,
  `/callback`, `/logout`), but none of them *says* so.

**First surprise, found by the re-measure:** 22 ungated `GET /{player,team,league,club,
division,fixture,game,venue}/…/{create,delete,update}` routes whose handlers only
`res.send('NOT IMPLEMENTED: …')` — Express-generator scaffold from the start of the site.
Harmless, but crawlable, and they make the ungated list look worse than it is. Check
production logs for them (with a `timestamp>=`) and delete them as their own commit
before step 2, rather than declaring them `access.public`. Note that some siblings are
real and gated (`/player/:id/update` is `secured`, `GET /player/create` is `secured`), so
delete by handler, not by path pattern.

"Nothing at all" and "a rate limiter only" are indistinguishable from "public on purpose",
and that is how these shipped:

| Route | What it did open | Recorded in |
|---|---|---|
| `GET /fixture/outstanding` | Made the league email itself at will | CLAUDE.md, `LATE_SCORECARD_CRON_TOKEN` |
| `POST /fixture/rearrangement` | Anyone could rearrange a fixture and insert a replacement | *Spam and abuse controls* |
| `POST /scorecard-beta` | Anyone could publish a result | HARD-24 |
| `POST /fixture/reminder` | An open relay from our own domain | *Spam and abuse controls* |
| `GET /messer-scorecard-beta/test` | A test form posting to the real submit, in production | HARD-40 |

Each was found by reading code, one at a time. Nothing would have flagged any of them as
*new* in review, because "no gate" is the absence of a line.

## Design

**Every route's first middleware is exactly one access declaration**, and a route without
one fails the test suite:

```js
route.get('/tables/:division',         access.public,        …)
route.get('/profile',                  access.member,        …)
route.post('/api/roster/:teamId',      access.clubScoped(…), …)
route.get('/admin/spam',               access.superadmin,    …)
route.post('/admin/social/results/meta', access.cron('SOCIAL'), …)  // token or superadmin
route.post('/scorecard-beta',          access.draftToken,    …)     // token or superadmin
route.post('/ses-events',              access.sns,           …)     // signed SNS message
route.get('/dev/elo-audit',            access.devOnly,       …)
```

- `access.*` wraps the existing middleware — `secured`, `requireCronCaller`,
  `requirePublishAuthority`, `requireClubAccess` / `requireSuperAdmin`, `verifySns`,
  `devOnly` — it does not reimplement them. (`checkJwt` and the machine API went with
  HARD-49, so there is no `access.machine`.) What changes is that the choice is visible, named and mandatory.
- **`access.public` is explicit.** An open route says so, which makes it reviewable.
- `access.superadmin` is `secured` + `requireClubAccess.requireSuperAdmin`, which 31
  routes already chain by hand, and replaces the in-handler copies **where the whole route
  is superadmin-only**. Where a handler shows a superadmin *more* (extra controls on a page
  everyone sees), the check stays in the handler, through one shared `isSuperAdmin(req)`:
  keep `requireClubAccess.isSuperAdmin` and make `utils/authz.js` re-export it, so there is
  one definition, not two. The Messer checks become `access.messerAdmin`
  (superadmin or the messeradmin claim).
- The `/dev/*` handlers' own `DEV_MODE` checks move to `access.devOnly`.
- A rate limiter is never an access declaration; it goes after it.

**A route table, committed.** A test walks the Express router stack and writes
`docs/routes.md`: method, path, access level. The test fails if the file is out of date.
So a pull request that opens a route, or changes `superadmin` to `member`, shows as a
one-line diff in a file whose only purpose is to be read. That is the review signal that
did not exist for any of the five above.

## What to do

0. ✓ **Done 26 Oct 2026.** The 22 `NOT IMPLEMENTED` scaffold routes and their handlers
   are deleted, and so are `divisionController.js` and `gameController.js`, which held
   nothing else. There was no GET to any of them in 30 days of logs. **The surprise was
   `GET /player/:id`**, from the same scaffold: ungated, it returned `Player.getById` as
   JSON, *decrypted* `playerEmail` and `playerTel` included, for any sequential id.
   Confirmed against production. Nothing called it, and no GET other than the
   confirmation requests appeared in the log window. It was deleted, not gated. It had
   also shadowed `GET /player/create`, which now renders, and is now superadmin-only like
   its POST. `__tests__/integration/scaffold-routes-removed.test.js` covers all of this.
   `/league/create` and `/club/create` now fall through to the real `GET /league/:id` and
   `GET /club/:id`. That leaves **214 routes**: 208 in `routes/index.js` and 6 in `app.js`.
1. ✓ **Done 26 Oct 2026.** `middleware/access.js` provides `public`, `member`,
   `superadmin`, `messerAdmin`, `clubScoped`, `cron(gate)`, `publish`, `sns`, `devOnly` and
   `token(what)`, each tagged `.access`. `access.cron()` accepts only a gate built by
   `requireCronCaller`, which now marks its output with `.cronEnvVar`. `access.sns` is the
   one level that carries a limiter and a body parser (`webhookLimiter`, `multer().none()`,
   `verifySns`, in the order `/mail` and `/ses-events` already had), because verifying
   needs the body. The walker is `__tests__/helpers/routeTable.js`, tested on a small app
   in `__tests__/unit/routeTable.test.js`. It reads the `.access` tag, not `fn.name`:
   `requireCronCaller` returns an anonymous closure.
2. ✓ **Done 26 Oct 2026.** All 214 routes are declared: 67 public, 65 superadmin, 38
   member, 9 messerAdmin, 6 clubScoped, 14 cron, 8 token (3 draft link, 5 live
   scorecard), 4 devOnly, 2 sns, 1 publish. The in-handler checks the declaration now
   covers are deleted: 32 superadmin guards across 8 controllers and `models/auth.js`,
   the 9 Messer checks, the 3 ELO "superadmin or dev" checks and the 3 `/dev/*`
   `DEV_MODE` checks. Of the 8 private `isSuperAdmin`/`isSuperadmin` copies, 7 are
   deleted and `playerController`'s is now an import.
   `utils/authz.js` re-exports `requireClubAccess.isSuperAdmin`, and
   `adminNavCounts` uses it. Checks that show a superadmin *more*
   (`player_update_*`, `club_roster`, `club_picker`) stay in the handler, through the
   shared helper.
   - **Behaviour changes, all deliberate:** a refused caller now gets the central 403
     page (or the `/api/` JSON) instead of each handler's own `Forbidden` text. An
     anonymous visitor to a superadmin route is sent to log in rather than refused.
     `GET /players/eloPop` (no route gate, only a check in the handler) and
     `GET /players/eloBackfillAdmin` (a `secured` admin page with no role check) are
     now `access.superadmin`. On `POST /scorecard-beta` the gate moved ahead of
     `publicFormLimiter`.
   - **For the owner to decide** (left as they are, declared honestly):
     - `POST /email-scorecard` is public while `GET /email-scorecard` is `secured`. It
       files a draft and emails the results secretary. Gating it risks losing a captain's
       result when a session expires mid-form, the trade-off `requirePublishAuthority`
       documents.
     - `GET /club-api/:id` (any member) returns decrypted officer contacts for any club.
       That's the same data as the member-only `/club/:id` page, so it's no new exposure.
       But nothing calls it now, because the reminder modal moved to
       `/fixture/:id/reminder-contacts`.
     - `GET /team/:id` and `GET /league/:id` are public JSON from the old scaffold, with
       `selectAll()` and no caller. No personal data today, but any column added to
       `team` or `league` would be published automatically.
     - `GET /sign-s3` still lets an anonymous caller upload a JPEG to `scorecards/`. This
       is a known residual, documented on the route.
3. ✓ **Done 26 Oct 2026.** `route-access.test.js` fails on a route with no declaration,
   one that is not first, or two. It also fails when `docs/routes.md` differs from the
   live table. Regenerate with `UPDATE_ROUTE_TABLE=1 npx jest route-access`. Both
   failure modes were demonstrated: removing `GET /rules`'s declaration fails the
   coverage check, and downgrading `GET /admin/spam` to `member` fails as a one-line
   table diff.
4. **Split `routes/index.js` by area** — `results`, `scorecard`, `messer`, `rosters`,
   `registrations`, `social`, `admin`, `email`, `static`, `api`. Pure moves, one PR, with the
   route table proving no route changed path or access. Do this early in the programme:
   every other package appends routes, and one 898-line file is where they collide.
   **Order matters in the split:** `router.use(userInViews())` is first and the 404 and
   error handlers are last; the area routers mount between them, and overlapping patterns
   (`/fixture/outstanding` before `/fixture/:id`, `/tables/All` before `/tables/:division`)
   must keep their relative order — the route table should record registration order so
   the diff shows a reorder.

## Acceptance criteria

- Every route in `app.js` and `routes/` has exactly one `access.*` as first middleware; a
  test fails otherwise, and fails when one is removed (demonstrate).
- `docs/routes.md` is generated, committed and checked.
- `=== 'superadmin'` on the role claim appears once, in the shared helper (plus the
  login mapping in `app.js` and `utils/sessionUser.js`, which REARCH-09 owns). The
  `req.invoiceCaller === 'superadmin'` / `req.socialCaller` comparisons are caller labels,
  not role checks, and stay.
- The full Jest and Playwright suites pass unchanged — this package changes no route's
  behaviour, except any ungated route step 2 decides to gate, each recorded in the PR.
- Cost: none.

## Out of scope

- **Moving to Fastify.** Considered and rejected; see the folder README.
- Changing what any role may do. If step 2 finds a route that is wrong, gating it is in
  scope only when it is plainly an omission; anything that is a judgement goes to the
  backlog as its own package.
- Where roles come from (REARCH-09).
