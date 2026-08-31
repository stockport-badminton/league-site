# HARD-05 — `res.send(err)` sweep

**Severity:** high · **Wave:** A · **Blocked by:** nothing
**Owns:** `controllers/fixtureController.js`, `playerController.js`, `clubController.js`, `divisionController.js`
**Sources:** FAIL-2

## Why

Eleven handlers still answer `res.send(err)`. An `Error` serialises to `{}` and goes out
with the default status — **HTTP 200**. A visitor sees a blank page, Sentry hears
nothing because as far as Express is concerned the request succeeded, and Google indexes
it as a valid empty page.

This is not hypothetical: it is exactly what blanked 48 `/event/` pages for months, and
CLAUDE.md already records the lesson. These are the handlers that were missed.

Reachable read paths — the ones that matter most — are in `fixtureController`:
`fixture_list`, `fixture_detail`, `fixture_id`, `fixture_id_from_team_names`. The rest
are `checkJwt`-gated create/batch endpoints.

Locate them with:

```bash
grep -rn "res.send(err" controllers/
```

## What to do

Replace each with `next(err)` so the central handler in `routes/index.js` renders a real
500 and reports it to Sentry. Where the error is genuinely a bad request rather than a
fault — an unknown id, say — attach a status (`err.status = 404`) so the 4xx branch of
the handler renders the right page and does not spend a Sentry event.

Add a guard test so the pattern cannot come back.

## Acceptance criteria

- `grep -rn "res.send(err" controllers/` returns nothing.
- A handler whose model throws answers 500 (or 404 where that is the truth), never 200.
- A test fails if `res.send(err)` reappears anywhere under `controllers/`.

## Tests

- Per-handler: mock the model to reject, assert the status and that `next` was called.
  `__tests__/integration/fixtures.test.js:151` already documents this bug for a
  neighbouring handler — reuse the shape.
- One repo-level guard test that greps the controllers directory. Cheap, and it is the
  only thing that stops the eleventh reappearance.

## Out of scope

- `scorecardController` — owned by HARD-01 and HARD-03 in the same wave. Leave it.
- The 500 page's content — **HARD-06**.
