# REARCH-04 — every route declares who may call it

**Size:** M · **Window:** in-season OK
**Blocked by:** nothing. Soft: REARCH-09 part A (the normalised session user) makes the
role checks one line, but this package can read the current shape.
**Owns:** `routes/index.js` (split into `routes/*.js`), a new `middleware/access.js`, the
`isSuperadmin`-style helpers in controllers, a route-table snapshot test.
**Source:** the 24 Oct 2026 "build it from scratch" review.

## Why

Measured 24 Oct 2026: **270 route registrations** in `routes/index.js` (949 lines) and 28
more in `app.js`. Who may call each one is decided in four different ways:

- route middleware — `secured` (116), `checkJwt` (37, the Auth0 machine API),
  `requireSocialCaller` (9), `requireInvoiceCaller`, `requireClubAccess`,
  `requirePublishAuthority`, `devOnly`;
- **inside the handler** — 19 copies of
  `req.user._json['https://my-app.example.com/role'] === 'superadmin'` in 15 files, several
  as a private `isSuperadmin` helper redefined per controller;
- a rate limiter and nothing else;
- nothing at all.

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
route.post('/player/batch-create',     access.machine,       …)     // Auth0 JWT
route.get('/messer-scorecard-beta/test', access.devOnly,     …)
```

- `access.*` wraps the existing middleware — `secured`, `requireCronCaller`,
  `requirePublishAuthority`, `requireClubAccess`, `devOnly`, `checkJwt` — it does not
  reimplement them. What changes is that the choice is visible, named and mandatory.
- **`access.public` is explicit.** An open route says so, which makes it reviewable.
- `access.superadmin` replaces the 19 in-handler copies **where the whole route is
  superadmin-only**. Where a handler shows a superadmin *more* (extra controls on a page
  everyone sees), the check stays in the handler, through one shared `isSuperadmin(req)`.
- A rate limiter is never an access declaration; it goes after it.

**A route table, committed.** A test walks the Express router stack and writes
`docs/routes.md`: method, path, access level. The test fails if the file is out of date.
So a pull request that opens a route, or changes `superadmin` to `member`, shows as a
one-line diff in a file whose only purpose is to be read. That is the review signal that
did not exist for any of the five above.

## What to do

1. `middleware/access.js` and the walker test, with the walker initially **reporting**,
   not failing.
2. Declare every route. Mechanical for the 200-odd with gating middleware already; the
   in-handler superadmin routes need reading. For every route currently with nothing, write
   down in the PR why it is public, or gate it. Expect to find at least one surprise — every
   previous pass did.
3. Flip the walker to failing. Commit `docs/routes.md`.
4. **Split `routes/index.js` by area** — `results`, `scorecard`, `messer`, `rosters`,
   `registrations`, `social`, `admin`, `email`, `static`, `api`. Pure moves, one PR, with the
   route table proving no route changed path or access. Do this early in the programme:
   every other package appends routes, and one 949-line file is where they collide.

## Acceptance criteria

- Every route in `app.js` and `routes/` has exactly one `access.*` as first middleware; a
  test fails otherwise, and fails when one is removed (demonstrate).
- `docs/routes.md` is generated, committed and checked.
- `=== 'superadmin'` appears once, in the shared helper.
- The full Jest and Playwright suites pass unchanged — this package changes no route's
  behaviour, except any ungated route step 2 decides to gate, each recorded in the PR.
- Cost: none.

## Out of scope

- **Moving to Fastify.** Considered and rejected; see the folder README.
- Changing what any role may do. If step 2 finds a route that is wrong, gating it is in
  scope only when it is plainly an omission; anything that is a judgement goes to the
  backlog as its own package.
- Where roles come from (REARCH-09).
