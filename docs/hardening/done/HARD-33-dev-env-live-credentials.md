# HARD-33 — the browser suite's dev server still holds live credentials

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `dev.env`, `playwright.config.js`, `e2e/helpers/read-only.js`
**Sources:** found 12 Sep 2026 while re-scoping HARD-28 after HARD-13

## Why

HARD-26 made the Jest process incapable of reaching anything real: `app.js` skips
`dotenv.config()` under `NODE_ENV=test`, `__tests__/setup.js` declares the whole
environment, and `utils/testEnvGuard.js` refuses the run if anything live is present.

**Nothing has done the same for the browser suite.** `playwright.config.js` starts a real
server with `dotenv_config_path=./dev.env`, and `dev.env` carries a real `AKIA…` key and
the real bucket name. Measured 12 Sep: `HeadBucket` against `badmintontemp` with those
credentials returns **200**.

HARD-13 fixed the database half — `dev.env`'s `DATABASE_URL` is `127.0.0.1` now — which is
what makes this worth doing rather than academic: the browser suite is about to start
submitting scorecards (HARD-28), and a submitted scorecard with a document attached is
stored **server-side**.

That is the part `e2e/helpers/read-only.js` cannot help with. It intercepts browser
requests, so it blocks a presigned PUT from the page, and aborts anything cross-origin.
It cannot see a PUT made from inside the Node process. `POST /api/analyse-scorecard` and
`POST /api/convert-scorecard-document` both do exactly that. A test would pass, the guard
would report no writes, and the objects would be in the production bucket — which is how
HARD-25's first Jest run put two real objects there.

Second finding, same area: **`reuseExistingServer: !process.env.CI` means the suite adopts
whatever is already listening.** `npm run prodlocal` loads `.env`, so running the browser
suite while that server is up silently points all 71 specs at the production database and
the production bucket, with no warning anywhere.

## What to do

1. Give `dev.env` the HARD-26 treatment. The distinction that took three goes there
   applies here too: some variables are safe **because they are unset**, and declaring a
   fake for them changes behaviour rather than securing it. Read
   `__tests__/setup.js` before writing this.
2. Keep the real `S3_BUCKET_NAME`, for HARD-26's reason: `normalisePhotoUrl` checks the
   host against it, so renaming it makes tests wrong rather than safer. Dead credentials
   are what make the bucket unreachable.
3. A startup assertion in `playwright.config.js` (or a `globalSetup`) that refuses the run
   if the server it is about to use is pointed at a production database or holds a usable
   AWS key. `utils/testEnvGuard.js` already checks shapes rather than names and is the
   obvious thing to reuse — note it must run against **the server's** environment, not the
   Playwright process's, which is the whole difficulty.
4. Decide what `reuseExistingServer` should do. The cheapest correct answer may be to keep
   it and have the guard in (3) fail loudly, since that also catches a stale dev server
   left over from a different branch.

## Acceptance criteria

- The dev server the browser suite starts cannot write to the production bucket, and this
  is demonstrated — the HARD-25/26 way: make it try, and show it fails.
- Running the suite against a production-configured server is refused, not merely
  discouraged by a comment.
- `npm run test:e2e` still passes, and `npm run dev` is still usable for real local work.
- CLAUDE.md's browser-test section is updated. It currently describes the pre-HARD-13
  world.

## Out of scope

- The scorecard submission tests themselves. That is HARD-28, which this unblocks.
- `npm run prodlocal`, which is *supposed* to run production config locally.
