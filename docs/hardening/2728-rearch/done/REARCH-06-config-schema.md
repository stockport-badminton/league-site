# REARCH-06 — environment variables declared in one place

**Status:** ✓ Done 26 Oct 2026. The `--target` question below: Neil chose local by default with `--prod` to ask for production (done the same day).

**Size:** S · **Window:** in-season OK
**Blocked by:** nothing.
**Owns:** a new `config/` module; every `process.env` read in `app.js`, `instrument.js`,
`db_connect.js`, `controllers/`, `models/`, `utils/`, `middleware/`, `routes/`;
`__tests__/setup.js`, `e2e/server-env.js`, `utils/testEnvGuard.js`,
`tools/lib/loadEnv.js`; the *Environment Variables* section of CLAUDE.md.
**Source:** the 24 Oct 2026 "build it from scratch" review.

## Why

The app reads **55 distinct environment variables** (counted 24 Oct 2026 across the entry
files and `controllers/`, `models/`, `utils/`, `middleware/`, `routes/`). What each one
*means* is written in five places, by hand:

- CLAUDE.md's prose — and the most important property of many is what **unset** means:
  "unset closes the token path", "unset means nothing is ever sent", "unset posts no
  story", "unset keeps the Make path";
- `__tests__/setup.js`, which declares the test environment variable by variable, assigning
  fakes to some and *deleting* others because they are safe only when absent;
- `e2e/server-env.js`, the same decision again for the browser suite;
- `utils/testEnvGuard.js`, which recognises live credentials by shape;
- `tools/lib/loadEnv.js`, which decides which database the tools reach.

HARD-26's history is the argument: the test environment was patched three times, one
variable at a time, each time one behind whatever had been added to `.env`, and the
second miss wrote two objects into the production bucket. *Declaring* the environment was
the fix. This package makes the declaration the thing the app reads, rather than a
separate list that has to be kept in step with it.

## Design

`config/schema.js` — one entry per variable:

```js
SOCIAL_CRON_TOKEN: {
  kind: 'secret',            // secret | id | flag | url | list | number | string
  shape: /^.{32,}$/,         // what a live value looks like, for the guard
  unset: 'closes',           // closes | disables | default(x) | required
  test: 'unset',             // fake | unset | real — what test runs get
  doc: 'Scheduler → the weekly posts and the result drains. One secret for all, on purpose.',
}
```

- `config.load(env)` validates at startup, fails fast on a `required` variable, freezes
  the result. Code reads `config.SOCIAL_CRON_TOKEN`, never `process.env`.
- **`__tests__/setup.js` and `e2e/server-env.js` are generated from the schema** (or call
  `config.forTest()` / `config.forE2E()`): `unset` entries are deleted, `fake` entries get
  values that resolve nowhere, `real` entries (`S3_BUCKET_NAME`, for the reason CLAUDE.md
  gives) are passed through. Adding a variable to the schema decides its test treatment in
  the same line — there is no second list to forget.
- `testEnvGuard` keeps its shape checks (they catch a secret under a name nobody
  anticipated) and **adds** every `secret` entry's `shape`.
- The *Environment Variables* section of CLAUDE.md shrinks to a pointer and the few that
  need a story; `doc` holds the one-line meaning, and a script prints the table.

**No new dependency.** A hand-rolled validator in this repo's style is a few dozen lines.
Zod would also do and is not needed.

### A decision for Neil

`tools/` default to **production** (`tools/lib/loadEnv.js`), deliberately, and `--local`
asks for the development database. A from-scratch design would require `--target=prod` or
`--target=local` on every invocation, so a reader of a command can see where it went. That
changes muscle memory and every command in CLAUDE.md. Recommended, but your call; the rest
of this package does not depend on it.

## What to do

1. ✓ **Done 26 Oct 2026.** Re-measured: 58 names read by our code, plus 5 cron tokens
   read by name, plus 6 the AWS SDK reads itself and one read only by a tool. That makes
   67 entries. `THEME` and `FLASK_DEBUG` (71 of the reads) went instead: they were set
   nowhere and read by no template. `AUTH0_AUDIENCE` went too: it was checked at startup
   and used by nothing. **`config.X` is a getter, not a frozen snapshot**, a deviation
   from the design above: 43 test files set and restore variables around a test, and
   several replace `process.env` wholesale, so the default config reads `() => process.env`.
   What is frozen is the set of names; an undeclared one throws, and `requireCronCaller`
   refuses an undeclared token when it is built. Required: the Auth0 trio, `DATABASE_URL`,
   `DB_PI_KEY`, `S3_BUCKET_NAME`, and `SESSION_SECRET` in production only (it used to fall
   back to `'ThisisMySecret'`). `node tools/env-table.js --cloud-run` confirmed production
   sets all of them.
   Original step: `config/schema.js` and `config/index.js`, describing all 55. For each, the `unset`
   meaning comes from CLAUDE.md or from reading the code — where the two disagree, the code
   wins and the doc is corrected in the same commit.
2. ✓ **Done 26 Oct 2026**, in one commit rather than one per directory: every read was
   mechanical except the flags, numbers and lists, which were converted by hand, and their
   inline fallbacks moved into the schema. `views/header.ejs` reads `config` from `app.locals`.
   Original step: replace `process.env.X` reads with `config.X`, a directory per PR.
3. ✓ **Done 26 Oct 2026.** `__tests__/unit/config.test.js` also fails on a `config.X` the
   schema lacks. Both checks were shown to fail when a read and a typo were put back.
   Original step: a test that fails on `process.env` outside `config/` (and outside `tools/`, `scripts/`,
   `e2e/`, `__tests__/`).
4. ✓ **Done 26 Oct 2026.** `config/testEnv.js`: `applyForJest` and `applyForE2E`. The e2e
   server now takes **only declared variables** from `dev.env`/`.env`. Before, the old
   Twitter, RDS, Make and SendGrid secrets in `.env` were all loaded into it.
   `testEnvGuard` matches each schema `shape` against every value. For the demonstration,
   an `AKIA…` key planted under a new name first went **unnoticed**, because the guard
   only checked AWS shapes on `AWS_ACCESS_KEY_ID`. With the shape added to the schema, it
   and an `AIza…` key both abort the run with `Tests: 0 total`. Full Jest (2525), `test:db`
   (188) and four Playwright specs pass.
   Original step: generate the test and e2e environments from the schema. Then repeat HARD-26's
   demonstration: plant a real-shaped secret under a new name, run the suite, watch it
   abort with `Tests: 0 total`.

## Acceptance criteria

- No `process.env` read in application code outside `config/`; a test enforces it.
- Removing a `required` variable makes the app refuse to start, with the variable's name
  in the message.
- The test and e2e environments are derived, not hand-listed; a new `secret` added to the
  schema with `test: 'unset'` is absent in tests without editing `setup.js`.
- The HARD-26 planted-secret demonstration still aborts the run.
- Cost: none.

## Out of scope

- Moving secrets into Secret Manager — a hosting change.
- The browser-side config printed into pages (Sentry DSN, PostHog key, Maps key); they
  are read from `config` like everything else but how they reach the page does not change.
