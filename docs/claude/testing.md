# Testing and delegation

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.

## Testing

### The test process holds no production credential

`app.js` and `instrument.js` skip `dotenv.config()` under `NODE_ENV=test`, so
`__tests__/setup.js` **declares the whole environment** rather than inheriting it. A
variable a test needs must be stated there.

That inverts the old default, which had been patched three times variable by variable —
Sentry reporting our own test runs as production errors, then `npm test` writing **two real
objects into the production bucket** — each patch one variable behind whatever went into
`.env` next. Of the 40 variables the code reads, `setup.js` used to set 15.

Declaring an environment means deciding, per variable, whether **absence is meaningful**:

- **credentials** get obviously-fake values that resolve nowhere;
- **some variables are safe *because* they are unset** and are `delete`d, not assigned —
  an unset `AUDIT_EMAIL_TO` is what makes the suite incapable of emailing the results
  secretary, an unset cron token *closes* that path, an unset `SNS_TOPIC_ARN` skips the
  topic check the signature fixtures rely on, and an unset `AUDIT_EMAIL_FROM` falls back to
  the league address the digest test asserts. Declaring fakes for those last two is the
  mistake that broke three tests when this was written;
- **`S3_BUCKET_NAME` keeps its real value on purpose** — tests build URLs from it and
  compare against `normalisePhotoUrl`, which checks the host against it. Renaming it makes
  those tests wrong rather than safer; the dead credentials are what make the bucket
  unreachable.

`utils/testEnvGuard.js`, wired into `setupAfterEnv.js`, refuses the whole run if anything
live is present. It checks **shapes, not names** — a `supabase` host, an `AKIA`/`ASIA` key
id, a set cron token — which is what stops it going one variable out of date the way the
patches did. Demonstrated by removing a line from `setup.js` and confirming it fires.

### supertest binds 127.0.0.1, and that is load-bearing

`__tests__/setupAfterEnv.js` overrides supertest's `serverAddress` so the per-request
server binds **`127.0.0.1`** rather than the wildcard. Do not simplify it back to
`app.listen(0)`.

`request(app)` stands up a server on an ephemeral port for every call — about 600 a run.
Upstream binds the IPv6 wildcard `::` while addressing its requests to `127.0.0.1`, and
that combination is a bug: the port-0 allocator for `::` **will** hand out a port already
held on `127.0.0.1` specifically, and a loopback connection then goes to the *more
specific* binding — the other process. Seven VS Code helpers listen in that range on a
typical dev machine. **A quarter of full runs failed this way**, in twelve different
suites, for a week, and it was read as a dozen separate bugs including an authorization
one. Binding the loopback address makes it impossible: that allocator will not hand out a
port already taken on that address.

Two things follow, both of which cost days before they were understood:

- **A foreign process can answer with anything** — 400, 401, `200 ok`, `ECONNRESET`
  (which reads as `socket hang up`), or Express's own `Cannot GET /whatever` 404. A test
  asserting only a status code can therefore **pass for the wrong reason**; one run had a
  squatter return `200 ok`.
- **Do not identify our own responses by their security headers.** The previous guard
  inferred "ours" from the presence of helmet's CSP and `X-Content-Type-Options` — but
  Express's default 404 carries both, so every collision with an Express squatter was
  silently attributed to our code. Each server now stamps responses with an id we issue
  (`__tests__/helpers/foreign-response.js`); an outsider cannot produce one.

The suite is sized so this matters: the flake rate is a function of how many requests it
makes, so it grows as the suite grows.

### Model SQL is tested against a real Postgres (`npm run test:db`)

**A model function's SQL is tested in `__tests__/db/`, or not at all.** A mocked-database
test of a model is not evidence that its query works; every bug in the gap between SQL and
what the wrapper returns (`insertId`, folded aliases, `[, info]`) passed one. Controller
tests keep mocking models — that is a different seam. REARCH-08.

- `jest.db.config.js`, separate from the default config so `npm test` needs no database.
  Needs `tools/local-db.sh up`; it builds its own `sdbl_test` beside the development
  database from `migrations/` and `tools/local-db/test-seed.sql` (synthetic, committed —
  never the real-data `migrations/data/002_data.sql`), and never touches `sdbl`. CI runs it against a `postgres:17`
  service step.
- Every test is a rolled-back transaction: `pg`'s Pool is swapped for one connection
  (`__tests__/db/helpers/onePool.js`), while `db_connect.js` stays real. Ids a test
  inserts start above 1000; seed ids are small and fixed, so a test can name a row.
- Compare result arrays with `[...rows]` — the wrapper hangs `affectedRows` on them and
  `toEqual` counts it.

For proving a query rewrite changes nothing against the **full** local seed, use
`node tools/query-snapshot.js <model>.<fn> --args a.json --out before.json`, then
`--compare before.json`. Local only and read-only by construction.

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
  `form-contract.spec.js` (what each of the five scorecard forms *serialises to* — no
  field name twice, and the right number of game pairs),
  `scorecard-wizard.spec.js` / `messer-wizard.spec.js` (the score rules and the gate that
  blocks Continue, 18-game and 15-game),
  `scorecard-messages.spec.js` (one test per captain-visible failure message, each also
  asserting the recovery it points at is on the page),
  `scorecard-prefill.spec.js` (what the auto-fill fills in beyond the photo),
  `scorecard-submit.spec.js` (**writes** — see below),
  `scorecard-phone.spec.js` (the whole wizard at 390px by touch, both cards: no sideways
  scroll on any step, the gate's reason on screen at three phone shapes, the digit pad,
  and the camera — its league walk **also writes**, one draft, the same way),
  `filter-toolbar.spec.js` (filters/chips/DataTables controls),
  `roster-edit.spec.js` (team-management: pointer and **real touch** drag, drag
  *precision* — the row tracking the pointer and not falling into the wrong list —
  arrow-key reordering, the row menu and its clipping/flip, Discard, plus mobile
  stacking; the reordering is JavaScript-only behaviour that no server-side test can
  reach),
  `homepage-gallery.spec.js` (the Messer gallery's images download only when its modal
  opens — HARD-43),
  `read-only-guard.spec.js` (self-test for the guard below).
- **Two specs write, and they say so.** `scorecard-submit.spec.js` fills the captain's form
  in the browser, POSTs it, and reads the row back out of `scorecardstore` — one row per
  test, no updates or deletes; `scorecard-phone.spec.js` does the same once, on a phone.
  Each writing test is declared:
  `readOnly(page, baseURL, { allowWrites: [/^\/email-scorecard$/] })`. Cross-origin is
  still aborted unconditionally and any same-origin write the test did not name still
  fails `assertNoWrites()`, so "this test writes" stays a statement in the test rather than
  a property of the helper. **Do not widen `READ_ONLY_POSTS`** to make a write pass; name
  it in `allowWrites` instead.
  It must also stay re-runnable without `tools/local-db.sh load` in between — a spec that
  only passes against a freshly loaded database is a spec that gets skipped.
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

**The server the suite starts is configured by `e2e/server-env.js`** — the browser
counterpart of `__tests__/setup.js`, preloaded with `node -r ./e2e/server-env.js app.js`.
It takes the local database and `DB_PI_KEY` from `dev.env`, assigns dead credentials for
everything outbound, deletes the variables that are safe *because* they are unset, and
**refuses to start** if anything live survives. `npm run dev` is untouched and still has
real credentials for actual local work.

Two traps it closes, neither of which was obvious (HARD-33):

- **`e2e/helpers/read-only.js` cannot see a write the server makes.** It intercepts
  *browser* requests, so it stops a presigned PUT from the page and aborts anything
  cross-origin — but `POST /api/analyse-scorecard` and `/api/convert-scorecard-document`
  store the photo they read (since Oct 2026, an image as well as a converted document) from inside Node, where the guard has no visibility at all.
  Until Sep 2026 `dev.env` held a live `AKIA` key, so that write would have landed in the
  **production** bucket with the suite reporting no writes. Both layers are needed: the
  environment makes it harmless, the helper keeps the page honest.
- **`reuseExistingServer` means the suite adopts whatever is on port 8080**, `npm run
  prodlocal` included — which loads `.env` and is pointed at production. `/health` reports
  `e2e: true` only when `E2E_SERVER` is set, and `e2e/global-setup.js` refuses to run
  without it. Checking for *our* marker rather than for evidence of production is
  deliberate: production can never emit it, so the check fails closed.

An earlier version of this section said the opposite of the truth — that `dev.env` carried
the same `DATABASE_URL` as `.env`, so the suite hit production Postgres. True when written,
false from the moment HARD-13 landed, and nobody noticed for days. **A warning that has
quietly inverted is worse than no warning**, because it is what a careful person checks
instead of looking.

Keep tests read-only anyway unless a spec deliberately writes: the local database is
disposable, but a spec that only passes against a freshly loaded one will get skipped.

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


## Delegate the mechanical work to subagents

**This section is the authorisation.** The default session instruction is not to use the
Agent tool unless the user, a CLAUDE.md file, or a skill asks for it. This file is asking.

The reason is cost, not capability. Running the suite and reading logs produces thousands
of lines whose *content* is irrelevant once it has been summarised — the answer is "1130
passed" or "these three failed and here is why". Spending the main model's context window
on the other 1,127 lines is waste, and it is waste that compounds: every later turn carries
it. Delegate the reading, keep the deciding.

| Delegate | To | Why |
|---|---|---|
| Running `npm test` / a single suite | `test-runner` | It reports failures only. A full run is ~80 suites of output. |
| Searching Cloud Logging, or any large log | `log-trawler` | Log queries return pages; you want the three lines that matter. |
| "Where is X used", "what calls Y" across the repo | `Explore` | Read-only, and a wide grep is most of a context window. |
| "How does the scorecard flow work end to end" | `code-cartographer` | Tracing a subsystem means opening a dozen files to keep two facts. |

Pass a cheaper model for these — `model: 'haiku'` for mechanical runs and searches,
`model: 'sonnet'` when the task needs some judgement about what is relevant. The default
is to inherit, which is the expensive choice and rarely the right one here.

**What must NOT be delegated**, because this codebase has been burned by each:

- **The judgement about whether a test proves anything.** The rule is that a fix needs a
  test that fails without it, verified by removing the fix and watching it fail. A
  subagent reporting "tests pass" is precisely the evidence that has been wrong here
  before — a mock inventing `{insertId: 42}`, a green suite over a blank page, an
  assertion that passed because a foreign process answered `200 ok`. Run the
  before-and-after yourself.
- **Deciding what a failure means.** "Three tests failed" is a fact worth delegating;
  which of them is a real bug and which is contention is not.
- **Anything that writes.** Subagents inherit tool access; a delegated task should be
  read-only unless you have a specific reason otherwise.

Two repo-specific traps, both of which make a delegated run lie rather than fail:

- **`npm test` inside a git worktree collects nothing at all.** `testPathIgnorePatterns`
  carries `<rootDir>/\.claude/`, which matches the worktree's own path, so Jest finds zero
  suites and exits 0. An agent in a worktree will report success having run nothing. Use
  `npx jest --testPathIgnorePatterns=/node_modules/` there, or do not delegate the run.
- **Never run Playwright in two places at once.** `playwright.config.js` starts its dev
  server on a fixed port with `reuseExistingServer`, so a second run adopts the first's
  server and the two interleave. One browser run at a time, by whoever merges.

And concurrent Jest processes contend: `testTimeout` is 15s to absorb it, but a test that
fails with `Exceeded timeout` on a busy machine should be re-run alone before it is
believed. A wrong *status* is a real bug; a timeout usually is not.

