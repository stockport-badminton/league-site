# HARD-40 — A test-data messer form, live in production

**Severity:** low · **Wave:** A · **Blocked by:** nothing
**Owns:** `routes/index.js` (the `/messer-scorecard-beta/test` line),
`messer_scorecard_beta_test` in `controllers/messer-scorecard-controller.js`,
`e2e/messer-scorecard.spec.js` (the one test that visits it)
**Source:** found by HARD-34, 25 Sep 2026.

## Why

`views/partials/debugPanel.ejs` is a 400px dev panel showing the form's state and a log.
Every other render passes `devMode: process.env.DEV_MODE === 'true' || NODE_ENV ===
'development'`, so production never shows it. `messer_scorecard_beta_test` passes
`devMode: true` **unconditionally**, so `GET /messer-scorecard-beta/test` shows it in
production, behind `secured` alone — to any logged-in member, not only an admin.

The page is also a messer form **prefilled with test data**: the first two Section A teams,
their first three eligible players, 21-19 in every game. It posts to the real
`POST /messer-scorecard-beta`. So one tap of Submit files a plausible-looking messer draft
for a match that was never played.

HARD-34 found it because the panel is wider than a phone and covers the footer buttons; the
phone spec hides it.

## What to do

1. Decide whether the route is needed at all. Nothing in `views/` links to it; its only
   known caller is `e2e/messer-scorecard.spec.js`. **Do not decide on log silence alone**
   (CLAUDE.md, *Asking production what is actually used*) — corroborate with the code.
2. If it stays: gate it to dev (`DEV_MODE`/non-production, as `secured` does for the mock
   user) and derive `devMode` the way the other three renders do.
3. If it goes: remove the route, the controller function and the e2e test, or re-point that
   test at a fixture-driven page.

## Acceptance criteria

- In production, `GET /messer-scorecard-beta/test` either does not exist or does not render
  the debug panel, shown by a test that fails without the change.
- No render passes a literal `devMode: true`.

## Out of scope

- The debug panel itself, and whether dev builds need it.
- The phone layout of the messer card — HARD-34.

## Outcome (25 Sep 2026)

**Kept, and gated to dev.** The route has one real user — `e2e/messer-scorecard.spec.js`
uses it as the cheapest check that a fully populated messer card still renders — and the
controller's own comment already said "dev only". So it was never meant to be live; it
just had nothing making it so.

- `middleware/devOnly.js`, the same rule as `secured.js` and `devMode.js` (`DEV_MODE` set
  **and** not production), read per request. Anywhere else it calls `next('route')`, so the
  request falls through to the ordinary 404: production does not refuse the route, it does
  not have it. It sits *ahead of* `secured`, so a logged-out visitor gets the 404 too rather
  than a login redirect that would confirm the route exists.
- The render now derives `devMode` from the environment like the other three.
- `__tests__/integration/messer-scorecard.test.js` — 404 without `DEV_MODE`, 404 in
  production *even with* `DEV_MODE` set, and the prefilled card on a dev server. The two
  404 tests answered **200** with the route change stashed.
- `__tests__/unit/no-literal-devmode.test.js` fails on a literal `devMode: true` anywhere in
  `controllers/`, `routes/`, `utils/` or `middleware/`, and self-tests its pattern. It named
  `controllers/messer-scorecard-controller.js:272` with the fix stashed.
