# HARD-26 — The test suite runs with production credentials

**Severity:** medium (low urgency, wide blast radius) · **Wave:** C
**Blocked by:** nothing · **Amplified by:** HARD-08 (tests in CI)
**Owns:** `__tests__/setup.js`, `app.js` (the `dotenv` call), `instrument.js`
**Sources:** found 4 Sep 2026 while building HARD-25's storage half

## Why

`app.js` and `instrument.js` both call `require('dotenv').config()` at import time, and
**31 test suites `require('../../app')`**. So every integration test process is loaded
with the real `.env`: production `DATABASE_URL`, `TAMESIDE_DATABASE_URL` (another
league's database), `DB_PI_KEY`, the AWS keys, and the rest.

Of the **36 variables in `.env`, `__tests__/setup.js` overrides 9** — and two of those
nine were added on the day this was written.

This is not a hypothetical. It has been patched **three times already, symptom by
symptom**, which is the actual finding:

1. **Sentry.** `instrument.js:13` carries the comment *"This stops local dev AND the test
   suite (both load .env via dotenv, so SENTRY_DSN is present)"*, and the memory of the
   July triage records two `javascript` issues that turned out to be our own test runs.
   Fixed by gating `enabled` on `NODE_ENV === 'production'`.
2. **S3 — and this one got through.** HARD-25's storage half is the first *server-side*
   PUT in the codebase (image uploads are a presigned PUT from the browser), so no suite
   had ever had a reason to mock `@aws-sdk/client-s3`. The first run of
   `__tests__/integration/scorecard-analysis-upload.test.js` **wrote two real objects into
   the production bucket.** Fixed by planting dummy AWS credentials in `setup.js`, which
   also closes SES — `utils/mailer.js` sends through `utils/ses.js`, so until that day
   `npm test` held working credentials for the domain that sends the league's invoices.
3. **Postgres.** Never breached, and it is worth being precise about what has prevented
   it, because it is not structure:
   - Every suite mocks the models it touches, **per file**. Nothing mocks `db_connect`
     itself — the count is zero.
   - `app.js:363` sets `resave: false` and `saveUninitialized: false`, so a request that
     does not touch `req.session` never reaches the session store. A test that exercised
     a login or wrote to `req.session` would connect to production and insert a row.
   - Requiring `app.js` opens no connection (measured: `Pool.connect` is called 0 times),
     so the exposure is per-request, not per-import.

   In other words: a new suite that forgets one `jest.mock` on a model, or any test that
   touches a session, reaches the production database. Nothing would stop it and nothing
   would report it.

The pattern is a guard added per symptom, after each symptom. `e2e/helpers/read-only.js`
already makes the opposite argument for Playwright — it enforces at the network layer
"rather than trusting each test" — and this is the same argument for Jest.

**Why HARD-08 raises the stakes.** Putting this suite into CI means putting production
credentials into CI: a `.env` in the runner, or the same secrets as repository secrets.
Worth settling *before* that, not after.

## Also found, and trivial

`SENDGRID_API_KEY`, `SENDGRID_PASSWORD` and `SENDGRID_USERNAME` are in `.env` and
**nothing in the codebase references them** — the mail path is SES. Dead credentials that
are still live at the provider. Revoke and delete. `JAWSDB_URL` and the four `RDS_*`
variables look like the same thing from an earlier host; check before removing.

## What to do

Best to worst, take the highest you can afford:

1. **Do not load `.env` in tests at all.** Give `setup.js` a complete set of fake values
   and have `app.js`/`instrument.js` skip `dotenv.config()` when `NODE_ENV === 'test'`.
   This inverts the default: a variable a test needs must be declared, rather than
   inherited from production. Expect to spend the time on whatever turns out to have been
   quietly relying on a real value — that list *is* the finding.
2. **Neutralise every secret in `setup.js`**, not the nine that have bitten so far. Cheap,
   and it keeps the current shape. Weakness: it is a denylist, so the next variable added
   to `.env` is exposed until somebody remembers.
3. **A structural guard.** Fail any test that constructs a client pointed at a production
   host — the Jest counterpart of the Playwright network guard, in `setupAfterEnv.js`
   alongside the foreign-response guard that is already there.

1 and 3 together is the real answer; 2 is the stopgap that is already half-applied.

Whichever is chosen, **`S3_BUCKET_NAME` must keep its real value**: several tests build
URLs from it and compare them against `normalisePhotoUrl`, which checks the host against
that variable. Renaming it makes those tests wrong rather than safer.

## Acceptance criteria

- A test that makes an unmocked call to AWS, Postgres, SES or any third party **fails**,
  rather than succeeding against production.
- Demonstrated the way HARD-25's was: write a test that deliberately tries to reach
  production, confirm it fails, and keep it.
- `npm test` passes with no live credential in the process (or none that resolves).
- The dead SendGrid credentials are revoked at the provider and removed from `.env`.
- `npm run test:e2e` still works — `playwright.config.js` starts a real server that
  *does* need real values, so whatever is done must distinguish the two.

## Tests

- the guard's predicate: production host → refuse; anything else → allow
- a case asserting `setup.js` leaves no usable AWS credential
- confirm the 31 app-requiring suites still pass

## Out of scope

- Pointing local development at a non-production database (HARD-13 — same family, but
  that is the dev *server*; this is the test *process*).
- Setting up CI (HARD-08).
- Building a staging environment.
