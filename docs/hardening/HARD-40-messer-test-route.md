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
