# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Database Details

### PostgreSQL with MySQL-Compatible Wrapper

The app uses **PostgreSQL** (Supabase) but with a compatibility wrapper in `db_connect.js` that makes queries look like MySQL:

- **Placeholder syntax**: Use `?` in queries; wrapper converts to `$1, $2, ...` automatically
- **Column names**: camelCase columns MUST be quoted in SQL: `f."homeTeam"`, `f."awayScore"`, etc.
  - Unquoted identifiers are folded to lowercase by PostgreSQL, breaking JavaScript destructuring
- **Query API**: Always returns `[rows]` for mysql2-like destructuring: `const [results] = await conn.query(...)`
- **Connection**: Via `db.otherConnect()` — async, returns `{ query: pgQuery }`

**Example:**
```javascript
const [results] = await (await db.otherConnect()).query(`
  SELECT f.id, f."homeTeam" as "homeTeam", f."awayScore" as "awayScore"
  FROM fixture f
  WHERE f.id = ?
`, [fixtureId]);
```

### Common Table Patterns

- **fixture**: `id, date, homeTeam (int), awayTeam (int), homeScore, awayScore, status ('complete'/'conceded'/etc)`
- **team**: `id, name, division (int)`
- **`pointsFor` / `pointsAgainst` are GAMES won and lost, not league points.** The league
  ranks on games, not on a win/draw/loss table — every one of the 18 games in a fixture
  counts towards the standing, which is why a team with 6 matches played shows 60 and 48.
  The league table image captions the columns `P / W / L / Avg.` and is correct: P is
  matches played, W and L are games. The column *names* are the misleading part, and they
  read as though a team had won 60 of 6 matches.
- **division**: `id, name, league (int)`
- **scorecardstore**: Draft submissions — `(id, date, homeTeam, awayTeam, Game1homeScore, ..., Game18awayScore, homeMan1, homeMan2, ...)`
- **messer_scorecard**: Messer knockout draft submissions — similar schema but Game1-Game15 (15 games, not 18)
- **player**: `id, name, gender ('Male'/'Female'), team (int)`

**JOIN Pattern**: Always quote both column names:
```sql
LEFT JOIN team ht ON f."homeTeam" = ht.id
LEFT JOIN division d ON ht."division" = d.id
```

### Settings that live in Supabase, not in this repo

Grepping `migrations/` will not find these, the same way grepping for
`ConfigurationSetName` does not find the SES configuration set. Recorded here because the
scripts that applied them are under `scripts/`, which is gitignored.

- **The Data API (PostgREST) is disabled**, Sep 2026. Nothing here ever used it: no
  `@supabase/supabase-js`, no anon or service-role key in any env file, no `rest/v1` or
  `graphql/v1` call anywhere. The app talks plain Postgres through
  `new Pool({ connectionString: DATABASE_URL })`. Disabling it is what makes the RLS
  advisories structurally inapplicable rather than individually silenced — RLS exists to
  constrain the `anon` and `authenticated` roles that PostgREST authenticates as, and
  without PostgREST nothing authenticates as either.
- **`authenticator` has `pgrst.db_schemas = 'pgrst_no_exposed_schemas'`**, and that empty
  schema exists. Disabling the Data API does not fully stop PostgREST: it keeps reloading
  and falls back to a schema name that was never created, logging
  `schema "pg_pgrst_no_exposed_schemas" does not exist` every time. Log noise, not a fault
  — [Supabase's own page](https://supabase.com/docs/guides/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist)
  says so. **The two names really do differ** (`pg_pgrst_…` in the error, `pgrst_…` in the
  fix) and that is not a typo to tidy up: the name is arbitrary, and all that matters is
  that the schema exists and is empty. `scripts/pgrst-no-exposed-schemas.js`, dry by
  default.

**Neither belongs in `migrations/`.** `tools/local-db.sh load` replays every numbered
migration against a plain Postgres in Docker that has no `authenticator` role, and an
error that is not "already exists" **stops the load**. A migration for either of these
would break local database setup for everyone in order to tidy one hosted project's logs.
That is the general rule: a migration describes the schema the application needs, not the
configuration of the machine it happens to run on.

### The RLS on this database is inert, and the reason is not the obvious one

Every public table has RLS enabled and exactly one policy:

```sql
CREATE POLICY "enable full access for postgres" ON public.<table>
  AS PERMISSIVE FOR ALL TO postgres USING (true);
```

**None of it ever applies to this application**, because the role it connects as —
`postgres` — has **`rolbypassrls = true`**. That is a stronger exemption than owning the
table: `FORCE ROW LEVEL SECURITY` makes an *owner* subject to policies, and does not touch
`BYPASSRLS` at all. So RLS on this database is a statement about what PostgREST would see,
and PostgREST is disabled.

**An earlier version of this section said something else, and it was wrong.** It claimed
the app survived on owner bypass and warned that enabling FORCE on any table would make it
return zero rows silently. Measured 18 Sep 2026 inside a rolled-back transaction: with
FORCE enabled on `division`, both the current policy *and* the old `auth.role() =
'postgres'` one returned all 4 rows. That result made no sense under the owner-bypass
story and is exactly what `rolbypassrls` predicts. There is no such landmine. Recorded
because a warning that has quietly inverted is worse than no warning, and because the test
that produced it was cheap — the claim had been asserted rather than checked.

The consolidation happened because **Supabase's performance advisor reported 485 warnings
and every one came from the policy set** (18 Sep 2026):

| | |
|---|---|
| `multiple_permissive_policies` | 345 — 69 tables carried both an `ALL` and a `SELECT` policy, × 5 roles |
| `auth_rls_initplan` | 140 — every policy called `auth.*` unwrapped, re-evaluated per row |

One policy per table clears the first; no `auth.*` call clears the second. Verified 485 → 0.
`scripts/rls-consolidate-policies.js`, dry by default, one transaction.

Two things worth keeping:

- **`auth.role()` is a JWT claim and is NULL on a direct connection**, so the old policies
  read literally denied everything. They were never load-bearing; nothing noticed because
  of `BYPASSRLS`.
- **The dropped `allow_authenticated_select` granted any authenticated caller SELECT on 69
  tables.** Inert while the Data API is off, and a real exposure the moment it is turned
  back on. Nothing is granted to `anon` or `authenticated` now, so the default is deny.

## Authentication & Authorization

### Session & User Model

- **Session name**: Must be `__session` (Firebase Cloud Run requirement)
- **Session store**: PostgreSQL (auto-creates table on startup)
- **User object** (`req.user`):
  - `id, displayName, email`
  - `_json['https://my-app.example.com/role']` — user role (e.g., 'superadmin', 'captain')
  - `_json['https://my-app.example.com/messeradmin']` — boolean flag for messer admin

### Two email columns on `player`, and they are not interchangeable

Both are `pgp_sym_encrypt`'d bytea — always bind `DB_PI_KEY` as a `?` parameter,
never inline it. `__tests__/unit/no-secrets-in-sql.test.js` enforces that, because the
Aug 2026 sweep that was recorded here as finished had in fact fixed one query and left
**three functions in `models/players.js`**: `getEmails` (five times, once per UNION
branch, with `console.log(sql)` above it — so the key went to Cloud Logging on every
distribution-list send), `getById` (twice) and `updateBulk`. Note the last one used a
**template literal**, so the obvious grep for `+ process.env.DB_PI_KEY` does not find it;
the guard matches both spellings and self-tests that it still does. Closed Sep 2026
(HARD-27). **The key was in the logs for as long as that `console.log` existed, so
whether to rotate is a decision to take knowingly** — rotating means re-encrypting every
`pgp_sym_encrypt` value, which is why it should be decided rather than deferred.

- **`authEmail`** — the login identity, written only when a superadmin approves a
  signup (`Player.setAuthRole`). Read by `getAuthRoleByEmail` at login to enrich
  `req.user`. A player's Auth0 address is often not the one they gave their captain,
  which is why it exists at all.
- **`playerEmail`** — the contact address. This is what the profile form, the club
  contact page (`/club/:id`), the roster's mail links and the fixture reminder emails
  all read. Editable by the player.

Approving a signup **seeds `playerEmail` when it is blank**, in the same statement.
Without that the two never met: a player added to a roster by their captain starts
with no contact email, nothing else ever fills it in, and a signed-up player showed
blank on every surface above while holding a good address in `authEmail`. 53 players
were in that state before it was found (Aug 2026). The seed is guarded with
`COALESCE(NULLIF(TRIM(...), ''), '') = ''` — an initialisation, never an overwrite.

Note the blank is sometimes `NULL` and sometimes `pgp_sym_encrypt('')`, so a plain
`IS NOT NULL` test is not enough to decide whether someone has an email.

### Secured Routes

Use `/middleware/secured.js` middleware for auth-gated pages:
```javascript
router.get('/scorecard-beta', secured, scorecard_controller.scorecard_beta);
```

**Behavior**:
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
  `scorecard-submit.spec.js` (**the one spec that writes** — see below),
  `filter-toolbar.spec.js` (filters/chips/DataTables controls),
  `roster-edit.spec.js` (team-management: pointer and **real touch** drag, drag
  *precision* — the row tracking the pointer and not falling into the wrong list —
  arrow-key reordering, the row menu and its clipping/flip, Discard, plus mobile
  stacking; the reordering is JavaScript-only behaviour that no server-side test can
  reach),
  `read-only-guard.spec.js` (self-test for the guard below).
- **One spec writes, and it says so.** `scorecard-submit.spec.js` fills the captain's form
  in the browser, POSTs it, and reads the row back out of `scorecardstore` — one row per
  test, no updates or deletes. It is declared:
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
  store their converted image from inside Node, where the guard has no visibility at all.
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

## Querying the database

**Don't hand-write dotenv/db.connect boilerplate for a one-off query.** Use:

```bash
node tools/dbq.js "SELECT id, name FROM team LIMIT 5"
node tools/dbq.js --schema player        # columns and types
node tools/dbq.js --check all            # data-integrity checks
node tools/dbq.js --check orphan-results # the offending rows
node tools/dbq.js --json "SELECT ..."    # machine-readable
node tools/key-contract.js               # do consumers read the keys queries return?
node tools/key-contract.js --coverage    # ...and what it could not check
```

It loads `dev.env` then `.env`, connects, and prints a table. **It refuses anything that
is not a single read** — `DATABASE_URL` is production, and there is no local copy to
practise on. A write belongs in a reviewed script under `scripts/` (gitignored) with a
dry run, modelled on `scripts/backfill-contact-emails.js`: dry by default, `--apply` to
write, and the guard repeated in the `WHERE` clause of the write itself so a row that
changed between the read and the write can't be clobbered.

`tools/audit/checks.js` holds the integrity checks — orphaned results, orphaned drafts,
impossible scores, duplicate ranks, ghost teams, fixtures pointing at deleted teams.
Each one found something real. Run `--check all` before and after any data work.

One lesson already encoded there: **a data check must not inner-join to the data it is
checking.** The `bad-totals` check reported 2 of 8 offending fixtures until it was
changed to a `LEFT JOIN`, because six of them reference teams that no longer exist.

## The local development database

`npm run dev` talks to a Postgres in Docker, not to production.

```bash
tools/local-db.sh up && tools/local-db.sh load   # ~5 seconds from nothing
tools/local-db.sh status                          # what is in it
tools/local-db.sh psql                            # a shell on it
tools/local-db.sh down                            # stop, keep the data
tools/local-db.sh nuke                            # stop and delete it
```

**Tools read PRODUCTION, not the local database.** `tools/lib/loadEnv.js` decides, and
every tool goes through it — `dbq`, `key-contract`, `dmarc`, `scorecard-photo-audit`,
`check-inbound-email`. `node tools/dbq.js --local "…"` asks for the development one
deliberately.

That is a one-place decision because it silently went wrong the day the local database
arrived: dotenv does not overwrite a variable that is already set, so whichever env file
loads FIRST wins, and every tool loaded `dev.env` first. Harmless while `dev.env` carried
the same connection string as `.env`; wrong the instant it did not. `dbq --check all` went
on running and printing counts — against a two-year-old local seed. It surfaced only
because a query returned "no rows" for drafts that plainly existed, and it could as easily
have been a data decision taken on the wrong numbers.
`__tests__/unit/tool-env-order.test.js` fails if a tool calls `dotenv` directly again.

**The write scripts under `scripts/` have the same shape and are gitignored**, so they are
not covered by that test. They load `dev.env` then `.env`, which now means a script
written to fix production data will target the LOCAL one. Cuts both ways — an accidental
run is now harmless — but check the top of any script before trusting what it reports.

`load` is destructive and idempotent: it drops the schema and rebuilds, because a
half-applied load is worse than none and throwing a local database away costs nothing.

- **Schema comes from `migrations/001_initial.sql`** (60 tables — 12 live, 48 season
  archives) plus the numbered migrations. Applied with `psql -f`, which is still the right
  tool for a bulk load. For a single migration use `node run-migration.js <file> [--local]`
  (repo root, not `tools/`). It used to split the file on `;` with `String.split`, so a
  semicolon in a comment was a statement boundary and the statement behind it never ran —
  fixed in HARD-18 by sharing `utils/sqlScan.js` with `pgify`, which had the identical bug
  one layer down. **`--local` is how you rehearse**; without it the runner targets
  production, like every other tool.
  Some migrations are no-ops replayed from nothing — 003 adds a column 002 now creates —
  so an "already exists" is reported and skipped while **any other error stops the load**.
- **Data comes from `migrations/data/002_data.sql`**, which is **gitignored**, so a fresh
  clone gets a schema and no rows. Its newest archive is 2024/25.
- **`tools/local-db/dev-fixtures.sql` supplies what that snapshot cannot**: outstanding
  fixtures in the current season (without them the scorecard form has nothing to match a
  result against), a draft carrying a `confirmToken`, and a messer draft. Six browser
  specs skip without them.
- **Contact details are replaced, never copied.** Every `playerEmail` becomes
  `bigcoops+firstnamelastname@gmail.com` and every `playerTel` an `07700 900xxx` number
  from Ofcom's reserved drama range, re-encrypted under a local `DB_PI_KEY`. A dev box
  should not hold the league's contact list, and the production ciphertext would not
  decrypt under a local key anyway.
- **Stored scorecard photographs are cleared too**, and for a stronger version of the same
  reason: `scorecardstore."scoresheet-url"` pointed at 1,479 real objects in the production
  bucket, and a scorecard photo is a picture of a team sheet carrying twelve players' names
  and both captains' signatures. It also meant the **browser suite read production storage
  on every run** — the populated-scorecard page renders `/scorecard-photo/:id`, the server
  fetched the object, and `read-only.js` was content because it is a same-origin GET.
  Nobody had noticed. Cleared rather than pointed at a placeholder: a draft with no photo is
  an ordinary state with a whole flow built for it, so NULL exercises a real path.
- **`ANALYZE` runs at the end of `load`.** Without statistics the planner sequential-scans
  a 35,000-row `game` table and pages take seconds, which reads as browser-test flakiness.

**`app.js` refuses to start a dev server against production** — `utils/devDatabaseGuard.js`,
wired inside `if (require.main === module)` so the 35 suites that require `app.js` are
unaffected. Override with `ALLOW_PRODUCTION_DB=i-know-what-i-am-doing`, which
`npm run prodlocal` sets because running production config locally is its whole purpose.

**The browser suite raises the sitewide rate limit for its own dev server**
(`GLOBAL_RATE_LIMIT=100000` in `playwright.config.js`). At the production budget of 600
per quarter hour, 89 specs from one address exhaust it partway through, and every page
after that is a 429 that renders without the elements the tests look for — so the failure
names a missing locator and says nothing about a rate limit. This has now bitten twice:
once when the limiter sat above the static handlers, and again simply because the suite
grew from 44 specs to 71, and again to 89.

## Asking production what is actually used

Cloud Run request logs are the only honest answer to "does anybody use this route", and
they go back **30 days, not four months**. Measured 14 Sep 2026: the `_Default` log bucket
has 30-day retention and the oldest request log was exactly 30 days old. The four-month
figure that used to be here came from reading the oldest entry for the service, which is a
Cloud **Audit** log — those live in `_Required` at 400 days and record admin activity like
deploys, not requests. Two buckets, two retentions, one `resource.type`.

That makes the rule below more important rather than less: a month is a short window to
conclude "nobody uses this" from, and a season that started three weeks ago is most of it.

**Always put a `timestamp>=` constraint in the filter:**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="league-site"
   AND httpRequest.requestUrl:"/some-route" AND timestamp>="2026-05-01T00:00:00Z"' \
  --project stockport-badminton-map --account stockport.badders.results@gmail.com \
  --limit=5 --format="value(timestamp,httpRequest.requestMethod,httpRequest.status)"
```

**`gcloud logging read` applies `--freshness=1d` unless the filter contains a timestamp
constraint.** Leave it out and an empty result means "nothing in the last 24 hours", which
reads exactly like "nothing, ever" — and it is the answer you get right before you delete
something. It happened here on 10 Sep: an audit of 31 routes reported the whole Messer
submission and approval flow as unused, when it had run a week earlier (Shell B v
Remnants A, 2 Sep, approved 4 Sep). Three routes were deleted in the same pass and
survived review only because the case for those rested on code evidence as well — nothing
referenced them and the page was linked from nowhere.

So: **never delete on log silence alone.** Corroborate with something that does not depend
on a time window — no references anywhere, unreachable by navigation, a table with no
rows. And note that the dev server writes to the production database while logging
nothing to Cloud Run, so a row can exist with no request behind it.

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

## Project-Specific Patterns

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
  is grandfathered open (HARD-03); publishing one is not. Reusing `mayOpenDraft` here
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

### The social result card's URL

`GET /resultImage/:homeTeam/:awayTeam/:homeScore/:awayScore/:division` renders the share
card with sharp, on demand — nothing stores the file, which is why Make.com fetches this
URL just before it posts rather than being handed an image.

**Build it with `resultImagePath()` from `utils/canonical.js`** (exposed to views as
`app.locals.resultImagePath`), never by interpolation. Every segment must be
percent-encoded: almost every team name in this league contains a space — "Tatton A",
"Mellor B" — as does every division name, and a raw space is not a legal URL character.

Make.com posts that URL straight to the Facebook Graph API, which fetches it server-side
and answered:

```
[400] Missing or invalid image file (324, OAuthException)
```

That reads as a problem with the image, the token, or Make. It was none of them — fetched
with the spaces encoded the endpoint returns 200 and a 1080x1350 JPEG in about a second.
Only the URL was malformed, and it was malformed by us, in `models/fixture.js`.

Two things worth keeping from it:

- **The URL was built in two places** — the webhook and `views/fixtures-results.ejs`
  (whose `data-img-url` the share button hands to the Web Share API). That is the same
  trap `eventPath()` exists to close, so it is one helper now.
- **`sendResultZap` is mocked in every suite that reaches it**, so what it posts had
  never been asserted by anything. `__tests__/unit/result-zap-url.test.js` asserts the
  payload itself. A function that is only ever mocked is untested, however many tests
  mention it.

### The weekly social images, and why they are on demand too

`GET /league-table-image/:division` and `GET /tournament-image/:poster` render the weekly
carousel's pictures per request and return the bytes. Build the URLs with
`leagueTableImagePath()` / `tournamentImagePath()` from `utils/canonical.js` (exposed to
views), never by interpolation — every division name bar Premier contains a space.

They were added Sep 2026 because the originals could not work, for two independent reasons
that had both been true since the weekly post was built:

- **They were PNG, and Instagram's publishing API accepts JPEG and nothing else.** Meta's
  documentation is explicit. The Make.com scenario hands Instagram `image_url` values
  ending `.png`, so that carousel has never been accepted. The Facebook branch of the same
  scenario is fine — Make fetches the bytes itself and uploads them as `data`, so it never
  meets the format check. **One platform posting and the other silently not is what a
  format constraint on the fetching side looks like.**
- **They were files in `static/beta/images/generated/`**, which is the *container's* disk.
  On Cloud Run it belongs to one instance, does not outlive it, and is invisible to every
  other instance. The scenario's sequence is generate → sleep → fetch by URL; Instagram's
  fetch is later still and comes from Meta's servers. Measured 15 Sep 2026: all four table
  URLs returned **404**.

**Anything Meta fetches must be public and unauthenticated**, because the fetch comes from
Meta, not from a logged-in browser. Both routes are, and both are pure functions of data
already public on the league tables page.

The file-writing routes (`/tables-social`, `/tournament-social`,
`/handicap-tournament-social`) are still there and still writing, deliberately: the live
Make scenario calls them and its Facebook half works. They now take their content from
`TOURNAMENT_POSTERS` in `socialController`, the same object the on-demand route reads, so
the two cannot drift. Remove them once the scenario is repointed.

**A broken link was hiding a broken picture.** The images had been unreachable for so long
that nobody had seen what they said — and what they said was `0 null null` for every team,
because `String(null)` is four characters and only the `avg` column was guarded. It
surfaced the moment the URL worked. When something has been unreachable, assume nothing
about its contents.

### The weekly fixtures post, and the case where a scheduled job must publish nothing

`POST /admin/social/weekly-fixtures` (Sunday 18:00, `sbl-weekly-fixtures-post`) posts the
coming week's matches — one **1080x1350** card per division, as a Facebook album and an
Instagram carousel. 4:5 rather than the tables post's square: it is what the result card
uses, so the two match, and Instagram gives a 4:5 image more of the feed. `controllers/weeklyFixturesController.js`, and it deliberately mirrors
`weeklyTablesController` next to it: same `publishEverywhere` call, same per-target
reporting, same gate, same caption rules. The card is drawn by
`GET /fixtures-image/:division`, built per request like the league tables are, for the same
reason — Meta fetches it from Meta's servers, so it must be public and it must not be a
file on a container's disk.

It is a new post rather than a ported one: Make's scenario only ever looked backwards.

Three things about it are not in the tables post, and each is the interesting half:

- **Its content can legitimately be empty, and then it must publish nothing.** The league
  plays September to April. A job that fires all year would spend the summer posting four
  cards headed "Fixtures this week" with nothing underneath. So the division list is built
  from the fixtures that exist, and an empty week answers **200 with `skipped` set and
  `posted: []`** — 200 because nothing went wrong and a scheduler retrying a 4xx every
  Sunday of the summer is noise, `skipped` because `ok: true` with nothing posted is
  otherwise indistinguishable from a post that went out. That is the same rule as
  `notificationFailed` on the publish page: **report which of the two happened.**
- **The cards are chosen, not fixed.** A division always has a table; it can easily have no
  fixtures in a given week while the other three do. The list is filtered through
  `weeklyTablesController`'s `DIVISIONS` rather than built from whatever `divisionName`
  values come back, so a friendly or a renamed division cannot quietly add a fifth card —
  Instagram's carousel limit is 10 and a runaway list fails the whole post.
- **Only the clubs playing are mentioned.** The tables post names every club with a stored
  handle, because all four tables name them anyway. Here a mention is a notification, and
  notifying a club about a week it is not playing in is how an account gets muted.

Two smaller things worth not rediscovering:

- **The card is drawn on the division's own artwork** — `social-Premier.png` and friends,
  the same files `resultImage` uses, so a fixtures post and a result post for the same
  division look like one league. `fixturesBackground()` is the single lookup and **falls
  back to the plain background rather than throwing**: a division name with no matching
  file is reachable (a rename, a friendly) and Meta is fetching this route.
  That artwork has a fade and the division's letter baked into the pixels, which constrains
  every layout drawn on it — **HARD-37**, blocked on clean source images.
- **The panel is DARK, and that is the second attempt.** A white panel was built first and
  does not work: to be legible over the busy backgrounds it has to be near-opaque, and at
  that point the artwork underneath may as well not be there — which defeats the only
  reason for using the artwork. Measured by rendering 0.93 / 0.97 / 1.0 and looking at
  them. `#0d0d0f` at 0.80 lets the colour read through while white text sits on it
  comfortably. **Don't "fix" a legibility complaint by raising the opacity**; that is the
  road back to a white rectangle with a picture behind it.
- **The accent colour is derived from the artwork, with a floor.** Sampled from the
  artwork's TOP strip and then forced to a fixed lightness and minimum saturation. Derived
  so it follows the artwork when HARD-37 lands rather than becoming four stale hex values;
  floored because the first version sampled `stats().dominant` over the *whole* image,
  which on these backgrounds is the bottom third's fade to near-white — producing an
  invisible accent, and in an earlier layout white text on a near-white bar. The tests
  assert every background yields something light enough to read **and** with chroma left in
  it, which is what catches the wash-out.
- **It names the league and the dates.** "Premier / Fixtures this week" tells someone who
  does not follow the league neither the sport nor the town nor which week, and a card gets
  seen by exactly those people. `fixtureDateRange` parses the range out of `dayLabel`
  rather than recomputing from a `Date`, so the heading cannot disagree with the rows.
- **`dayLabel` is formatted in SQL, with `to_char`.** `fixture.date` is `timestamp without
  time zone`, so Postgres prints exactly what is stored and no timezone is involved at any
  point. Formatting it from a JS `Date` works today *because* the container happens to be
  UTC, which is the shape of the BST off-by-one-day bug `localYmd` exists to apologise for.
- **The card caches for an hour, not the tables' day.** Its content is a function of
  `NOW()`, so a copy taken Sunday evening and served on Monday shows last week's window
  with nothing on it to say so.

**A preview page must show its own server's pictures.** Both preview pages build the card
URLs with `absoluteUrl()`, because that is what gets posted and Meta fetches it from Meta's
servers. Putting those same absolute URLs in the page's `<img src>` means the preview
always renders **production's** version of each card, whatever server you are looking at —
so a change to the renderer appears to do nothing locally. Found 16 Sep 2026 on the
fixtures preview, where it failed honestly (the route was not deployed, so the images were
simply missing while the page reported "2 of 4 divisions"). The tables preview had the
identical defect and **hid it**, because its routes *are* deployed and production's picture
loaded over the top of whatever the local code would have drawn. Both now use a same-origin
path for `src` and print the absolute URL beside it as text — the posted URL is information
the preview exists to give, it just must not be the thing rendered.

**The seven-day window is anchored to Europe/London's day, not the database's.** Supabase
runs UTC, so under BST `date_trunc('day', NOW())` is an hour behind the UK day: between
00:00 and 01:00 British time it truncates to *yesterday*. Measured 17 Sep 2026 at 00:03
BST — the UTC day was the 16th where the UK day was the 17th, and the card was showing a
night of fixtures already played while cutting the seventh day off the far end. **Both
boundaries were wrong at once**, which is what an off-by-one-day window looks like.
`fixture.date` holds UK local midnight as a naive timestamp, so `NOW() AT TIME ZONE
'Europe/London'` compares like with like.

`getUpcomingWeek` is **not** `getupComing`. The latter starts at `NOW() - 1 day` so the
homepage still shows a match being played tonight — right for a page someone is reading,
wrong for a post announcing what is still to come.

### Make.com is gone, and what it taught us on the way out

**Every scenario in the Make account is disabled as of 15 Sep 2026.** Both leagues post to
Facebook and Instagram from their own codebases, and the scheduled jobs that used to live
there are Cloud Scheduler jobs hitting our own gated routes. Nothing depends on Make any
more; the account is kept only so the disabled scenarios remain readable.

Three things from that migration are still load-bearing:

- **Neither results scenario needed editing to retire.** It was webhook-triggered and routed
  on whether `imgUrl` contained `stockport-badminton` or `tameside-badminton`, so each
  league's route went dormant the moment that league stopped sending. The lesson generalises:
  **a webhook-driven integration is retired by ceasing to call it**, and reaching into the
  automation to remove routes is work you can usually decline.
- **The weekly tables scenario was schedule-triggered**, so it fired every Saturday whatever
  the two sites did. That one needed an atomic cutover — disable it and enable the scheduler
  jobs the same day, or Saturday posts twice.
- **Two of its three routes were dead**, gated on a `tournament` variable hardcoded to
  `"false"`. Read an automation before reproducing it; a third of that scenario was features
  nobody used.

**The two leagues used to share one Instagram account**, because Meta refused a second one
when Tameside's was set up — which is why that scenario's Instagram module carried no league
filter, and why anyone tidying it up would have silently stopped Tameside appearing at all.
**That stopped being true on 15 Sep 2026**, when `tameside.badminton` was finally created.
The constraint it imposed — that two codebases posting to one account can double-post — is
gone with it. Recorded because the previous version of this section said the opposite in the
present tense, and a warning that has quietly inverted is worse than no warning.

### Posting to Meta directly: what was measured, Sep 2026

Establishing whether the league can post without Make.com. `META_APP_ID` / `META_APP_SECRET`
identify our own app; the durable credential is a **Page access token**, minted from a
long-lived user token via `GET /me/accounts`.

- **A Page access token does not expire.** Confirmed with `debug_token`: `type: PAGE`,
  `expires: never`. It dies only if the granting user changes their password or loses their
  role on the Page. The user token it came from lasts ~60 days and is then disposable.
- **Instagram publishing works from an app in Development mode, and the post is publicly
  visible.** Measured: published from a dev-mode app, then fetched **unauthenticated** at
  its permalink — HTTP 200, full `og:` tags, no login wall. Meta's "data created in
  Development mode is only visible to role users" rule did not apply. An Instagram post
  belongs to the *account*, not the app. That contradicts the plain reading of the docs, so
  re-measure rather than trusting this line if it ever matters.
- **Whether the same is true of Facebook Pages is UNKNOWN, and was briefly recorded here as
  a finding when it was not one.** The reasoning failed in a way worth keeping:

  A Page post published from the dev-mode app did not render when fetched logged out, while
  a post Make had published to the same page three days earlier did. That looked like a
  clean controlled comparison, and the conclusion — "Pages enforce the dev-mode
  restriction, Instagram does not" — was written up. **The post had been deleted.** Asking
  the API settled it: the id returns "Object does not exist" while a later post returns
  normally for the same token.

  **A negative observation needs its other causes ruled out; a positive one does not.** The
  Instagram result stands precisely because the post *rendered* — nothing but a live public
  post produces `og:` tags. The Facebook result was "nothing came back", which deletion,
  a login wall, caching and a genuine restriction all produce identically. The control
  ruled out one of those and was mistaken for ruling out all of them.
- **Facebook Page publishing works, with the app Live.** A multi-photo album posted with
  the app in Live mode rendered publicly on an unauthenticated fetch, `og:image` included.
- **Creating a media container is not publishing, which makes it a free test.**
  `POST /{ig-id}/media` asks Meta to fetch and validate the image and returns a
  `creation_id`; nothing is visible until `POST /{ig-id}/media_publish`. Containers expire
  on their own in 24 hours. Use this to check a URL is acceptable before posting anything —
  it is how the PNG diagnosis was proved from Meta's side:

  ```
  new .jpg URL  -> CONTAINER CREATED
  old .png URL  -> "The media could not be fetched from this URI"
  ```

- **`pages_manage_posts` and `pages_read_engagement` are gated behind a use case**, not just
  app type: without "Manage everything on your Page" added in the App Dashboard, the login
  dialog answers `Invalid Scopes` and the permission cannot be requested at all. Instagram
  is a separate use case again, even though Instagram publishing runs on a Page token.
  Once added, both came through and a **multi-photo album post worked first time**:
  `POST /{page-id}/photos` with `published=false` for each image, then one
  `POST /{page-id}/feed` carrying `attached_media[n]={"media_fbid":...}`.
- **`published=false` is Facebook's free test, the same way a container is Instagram's.**
  The photo uploads and nothing appears on the page until a feed post attaches it. Use it
  to check Meta will accept a URL before anything is visible. Both platforms refused the
  old PNGs and accepted the new JPEGs, in different words:

  ```
  Instagram : "The media could not be fetched from this URI"
  Facebook  : "Make sure that your Page post includes an image that can be used in an ad"
  ```
- **A privacy policy URL is required to switch an app to Live mode** and is unset on ours.
  `https://stockport-badminton.co.uk/privacy-policy` exists and answers 200.
- `GET /{ig-id}/content_publishing_limit` reports quota: 100 posts per rolling 24 hours, a
  carousel counting as one.

### What the bucket keeps, and for how long

Two lifecycle rules on `badmintontemp`, both expiry-only. Read them back with
`aws s3api get-bucket-lifecycle-configuration --bucket badmintontemp` rather than trusting
this list — `put-bucket-lifecycle-configuration` **replaces the whole configuration**, so
adding a rule means sending the existing ones again or silently deleting them.

| Prefix | Expires | Why |
|---|---|---|
| `inbound-email/` | 30 days | SES drops the raw message here for the forwarder |
| `scorecards/failed-analysis/` | **14 days** | An upload the reader could not use (HARD-36) |
| `scorecards/` (everything else) | never | The league's record of a result |

**It holds whatever arrived, not only images.** A pdf or docx that no image could be
extracted from is kept as the pdf or docx, because on that path there is no image — the
failure *is* that one could not be produced. `FAILED_UPLOAD_TYPES` in `utils/uploads.js` is
a separate list from `ALLOWED_TYPES` for that reason, and the two must stay separate:
`ALLOWED_TYPES` guards `/sign-s3`, where the content type is **attacker-chosen** and decides
what the bucket will later serve, so adding `application/pdf` there would be a security
change. Nothing kept under this prefix is attacker-chosen in that sense — the bytes are
already on the server, they arrived through multer behind `secured`, the object is private
and it is deleted in 14 days.

**A refusal is not an exception, and that is what the first version missed.** `HARD-36`
hung its store off `analyse_scorecard`'s `catch`; the 4xx refusals return from inside the
`try` and never reach it. On 17 Sep a captain's card was refused by
`POST /api/convert-scorecard-document` with a 400, and there was no log line, no Sentry
event and no object — on the endpoint the package had just been written to make
diagnosable. Every refusal now goes through `refuseUpload`, which keeps the file and names
the check that fired.

**The failed-analysis prefix is the interesting one.** Until Sep 2026,
`POST /api/analyse-scorecard` read the bytes and discarded them unless the analysis
*succeeded*, so a failure left a log line and a request size and nothing else. On 16 Sep a
captain's first two photos failed and the third worked, and diagnosing it meant working
from the only image that survived — the one that had, by definition, succeeded. That
cannot answer what was different about the two that did not.

The message now distinguishes *we refused it* from *it was not there*
(`cornerDetection.findAnchors`), and this is what makes that message checkable: a log line
saying `outside[yMax=0.45]` is only believable if somebody can look at the photo it
describes. The key is logged beside the failure so the two find each other.

**Retention is the whole reason it is a separate prefix.** A scorecard photograph carries
twelve players' names and both captains' signatures, which is why HARD-02b made every
object here private. Diagnostic scrap does not earn the same permanence, and an expiry
attached to the prefix means an object is expired *by virtue of being written there* —
retention that depends on somebody remembering is not retention.

**S3 versioning was considered and rejected**, because it is the obvious first thought: it
protects an object that exists from being overwritten, and here none was ever created. It
also retains *more*, indefinitely, unless a noncurrent-version expiry is added as well —
the opposite of what this data wants.

### Search / crawlability

**Load the `seo` skill** before touching `controllers/sitemapController.js`,
`utils/canonical.js`, `utils/structuredData.js`, `utils/socialLinks.js` or the club pages.
It holds the sitemap's exclusion rule, the URL helpers every page must build links with,
and why JSON-LD is never written in a template — all of which failed silently before.

### Spam and abuse controls

Five layers, deliberately independent, because each covers what the others can't:

| Layer | Where | Notes |
|---|---|---|
| reCAPTCHA | `validCaptcha` in `contactusController` | On `/contact-us` only. It works — a fake token is rejected |
| Rate limits | `middleware/rateLimit.js` | 12 public endpoints + sitewide backstop |
| Blocklists | `blocked_entry` table, `models/spamControls.js` | ip / email / phrase / word |
| Honeypot + timing | `views/spam-fields.ejs`, `utils/spamChecks.js` | Catches bots we've never seen |
| Submission log | `submission_log` table | The only way to tell whether any of it works |

**Blocking someone is a form submission, not a deploy** — `/admin/spam` (superadmin, in
the Admin nav). It used to be a source edit: 89 spammer addresses and ~180 phrases were
hardcoded in `contactusController.js` and three IPs in `app.js`. Don't put lists back in
code.

Rules worth not rediscovering:

- **Mount `globalLimiter` after the static handlers.** Above them it counts every
  stylesheet, script and image, so one page view is a dozen hits — the Playwright suite
  exhausted a 600-request budget partway through and only 23 of 44 specs ran.
- **A new public form must include `views/spam-fields.ejs`** inside its `<form>`, and its
  route must carry `spamGate()` and a limiter. The shared partial exists so the honeypot
  and the timing floor can't drift apart or be forgotten.
- **A rejection is deliberately indistinguishable from a success.** Naming the check that
  fired is how a spammer tunes a payload. The cost is that a false positive silently eats
  a real message — which is why only the two checks with negligible false-positive rates
  behave this way, and why every rejection is logged with a reason. **Watch the
  `validation` count on `/admin/spam`:** rising means real people failing the form.
- **A missing timing stamp is not spam.** Caches, autofill and any form rendered before
  the field existed would all be caught. Only the floor is enforced, so a stale tab still
  submits.
- **`models/spamControls` never fails closed.** A DB hiccup means empty lists, not
  rejecting every submission. The cache is warmed before `listen()` because the IP check
  reads it synchronously on every request.
- **Rate limiters keep counters in module state**, so `resetRateLimits()` runs before each
  test from `__tests__/setupAfterEnv.js`. It can't live in `setup.js` — that's a
  `setupFiles` entry and runs before `beforeEach` exists. A test that wants to see a limit
  bite must exhaust it within one case.

Anything unauthenticated that sends email must derive its recipients server-side.
`/fixture/reminder` took the address from the request body and was an open relay from our
own verified domain; the risk there is the domain's sending reputation, not spam arriving.

**`POST /fixture/rearrangement` is superadmin-only** (Sep 2026). It was unauthenticated
behind nothing but a rate limit: anyone who could POST could set a fixture to
`rearranged` and insert a replacement from `{homeTeam, awayTeam, date}`. The worry at
the time was that locking it down would change how captains request rearrangements —
it didn't, because the only client is the modal in `fixtures-results.ejs`, which has
always been inside `if (superadmin)`. Captains ask by email; they never had the form.

`Fixture.rearrangeByTeamNames` was tightened in the same pass, and the shape of what was
wrong is worth keeping:
- The INSERT resolved both teams inline with `(SELECT id FROM team WHERE name = ?)`, so
  a name matching nothing inserted a fixture with a **NULL team** instead of failing —
  a supply of exactly the rows `--check ghost-teams` keeps finding.
- The UPDATE and the INSERT were unrelated statements, so a pairing that archived
  nothing still created a replacement. One typo, one phantom fixture.
- No transaction, so a failure between them left a fixture `rearranged` with no
  replacement — invisible until a captain asked where their match had gone.

Both teams are resolved first, the fixture is found explicitly, and both writes share
one `db.withTransaction`. It answers JSON (`{ok, action, fixtureId, replacementId}`) and
passes its 4xx messages to the client; the modal shows them, because reporting only
success made a rejection look identical to an acceptance.

### Security response headers and the CSP

`helmet` is mounted at the very top of `app.js` — above the static handlers, the IP
blocklist and `/healthz` — because the requirement is every response. The policy itself
is in **`utils/securityHeaders.js`**, where every allowlist entry sits beside the
template that forces it. Read that file, not `app.js`, to understand the policy.

Two CSP headers go out, and the split is the design:

| Header | Holds | Why |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors`, `base-uri`, `object-src`, `form-action` | No resource allowlist at all, so it cannot blank a page that works today |
| `Content-Security-Policy-Report-Only` | the full `script-src`/`style-src`/`img-src`/… allowlist | This is the one that could break the scorecard modal, so it observes first |

- **Adding a CDN to a view means adding it to `OBSERVED`.** A test walks `views/**/*.ejs`
  for external `<script src>` / `<link href>` and fails if a host is missing, so this is
  caught rather than discovered when enforcement is flipped on.
- **Not everything is greppable.** Google Maps injects a `fonts.googleapis.com`
  stylesheet at runtime, and both the Facebook page plugin and reCAPTCHA create iframes
  that appear in no template. Grepping for `<iframe>` finds nothing and builds a policy
  that breaks both.
- **`script-src` keeps `'unsafe-inline'`**, because `views/` has 159 inline `onclick`
  attributes. Do not "improve" this by adding a nonce: a nonce makes the browser *ignore*
  `'unsafe-inline'`, and no nonce can be attached to an `onclick` at all, so it would
  break every one of them. Removing them is HARD-15.
- **`frame-ancestors` is ignored in a report-only header**, which is why the clickjacking
  protection had to go in the enforcing one to do anything.
- Violations POST to `/csp-report` (in `app.js`, above `globalLimiter` for the same reason
  `/healthz` is). Sentry does *not* collect these by default — that needs `report-uri`
  pointed at its security endpoint and the feature enabled, which was never set up.

### Team management (rosters)

**Load the `rosters` skill** before touching `rosterController.js`, `models/roster.js`,
`views/roster*.ejs`, `static/beta/js/roster-edit.js` or the `/api/teams`, `/api/players`
and `/api/roster` endpoints. Two things in it are easy to get wrong and expensive:
`player.rank` is the nominated order *and* the reserve flag (`>= 99`, never `=== 99`), and
club-scoped endpoints need `requireClubAccess` — `secured` alone only proves someone is
logged in.

### The league's registration forms

**Load the `registrations` skill** before touching `utils/teamRegistrationDoc.js`,
`documentsController`, `registrationController`, the `/forms/*` routes or
`/admin/registrations`. Three different documents are easy to confuse, the docx table
geometry has to be given DXA widths or it collapses, and the chase flow's status is keyed
by season on purpose.

### Emails, inbound mail and deliverability

**Load the `emails` skill** before touching `emails/`, `views/emails/`, `utils/mailer.js`,
`utils/ses.js`, `utils/dmarcReports.js`, `contactusController`'s `distribution_list`, or
the `/mail` and `/ses-events` routes. It covers the MJML build (three traps that all fail
silently), the `mailer.send` contract, the SES event feed that is the only honest answer to
"did our mail arrive", the forwarder's rate budget, and DMARC.

Three rules from it are general enough to stay here:

- **Every send goes through `mailer.send(...)`**, and its `text` and `whyReceiving`
  arguments are required with no default — both were missing everywhere before.
- **Anything unauthenticated that sends email must derive its recipients server-side.**
  `/fixture/reminder` took the address from the request body and was an open relay from our
  own verified domain.
- **`GetSendStatistics` does not answer "did our email arrive"** — it answers "is our
  reputation at risk". A transient bounce is invisible to it; eleven people once missed a
  fixture withdrawal notice for eight days behind that distinction.

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

Note also that Dependabot names **2.17.6** as the fix. That is wrong for us: the SVG/SMIL
advisory covers `<= 2.17.6`, so 2.17.6 closes one of the two and leaves the other. If this
is ever revisited, 2.17.7 is the floor.

## Environment Variables

Key vars (see `.env` for examples):
- `AUTH0_DOMAIN`, `AUTH0_CLIENTID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE` — Auth0 config
- `DATABASE_URL` — PostgreSQL connection string (Supabase)
- `SENDGRID_API_KEY` — Email sending
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — S3 access
- `NODE_ENV` — `'production'` or `'development'`
- `DEV_MODE` — `'true'` for local auth bypass (dev/test only)
- `PORT` — Server port (default 8080)
- `SESSION_SECRET` — Session encryption key
- `CSP_ENFORCE` — `'true'` promotes the Content-Security-Policy resource allowlist from
  report-only to enforcing. **Leave unset** until the prerequisites in
  `utils/securityHeaders.js` are met; a wrong policy blanks pages silently, and the
  scorecard wizard is the most likely casualty.
- `CSP_REPORT_URI` — where CSP violations are POSTed. Defaults to `/csp-report`, handled
  in `app.js` and logged to Cloud Logging. Set it to Sentry's security-header endpoint to
  send them there instead; set it to `''` to emit no reporting directives at all.
- `AUDIT_EMAIL_TO` — comma-separated recipients of the weekly data-integrity digest
  (HARD-07). **Unset means nothing is ever sent**, which is the safe default and is why
  it is unset locally: `dev.env` points at production, so a stray run would otherwise mail
  the real results secretary. The recipient never comes from the request — `/fixture/reminder`
  was an open relay from our own verified domain for exactly that reason.
- `AUDIT_EMAIL_FROM` — sender for that digest. Defaults to the results address.
- `AUDIT_CRON_TOKEN` — shared secret Cloud Scheduler presents as `X-Audit-Token` to
  `POST /admin/audit/run`. Compared with `timingSafeEqual` over SHA-256 of both sides;
  **unset closes the token path rather than opening it**. A superadmin session also works.
  `GET /admin/audit` previews the same email (Admin → Data Health).
- `REGISTRATION_EMAIL_TO` — comma-separated recipients of the **daily** player-registration
  reminder. Falls back to `AUDIT_EMAIL_TO`. **Unset means nothing is ever sent**, which is
  why it is unset locally — `dev.env` points at production, so a stray run would mail the
  real results secretary.
- `REGISTRATION_CRON_TOKEN` — shared secret Cloud Scheduler presents as `X-Registration-Token`
  to `POST /admin/registrations/run`, compared with `timingSafeEqual` over SHA-256 of both
  sides. **Unset closes the token path rather than opening it.** A superadmin session also
  works. `GET /admin/registrations/digest` previews the same email and sends nothing.
- `INVOICE_CRON_TOKEN` — shared secret the scheduled caller presents as `X-Invoice-Token`
  to `POST /league/sendInvoices`, compared with `timingSafeEqual` over SHA-256 of both
  sides. **Unset closes the token path rather than opening it.** A superadmin session also
  works, and `/admin/invoices` (Admin → Annual Invoices) is the button — there was no
  trigger anywhere in the app before HARD-23, so the recovery when the 2026 run failed was
  a `fetch()` typed into devtools. The gate is `middleware/requireCronCaller.js`, shared
  with the audit and registration tokens; it answers **403, never a redirect**, because
  `secured`'s 302 to `/login` is what Make.com recorded as a successful run while the
  invoices went unsent for a year.
- `LATE_SCORECARD_CRON_TOKEN` — shared secret Cloud Scheduler presents as
  `X-Late-Scorecard-Token` to `GET /fixture/outstanding`, the daily missing-scorecard
  reminder. Same gate, same `timingSafeEqual` over SHA-256 of both sides, and **unset
  closes the token path rather than opening it**. A superadmin session also works.
  Nothing in the app links to this route — it has no UI and never had one.
  **It was completely ungated until 15 Sep 2026**, and that is the interesting part: the
  handler sends mail, so anyone who knew the URL could make the league email itself at
  will. It was open because the thing calling it was a Make.com scenario whose single HTTP
  module cannot authenticate. **An automation that cannot present a credential is a reason
  an endpoint is open**, so auditing what the automation platform calls is also a way of
  finding ungated routes. The recipients were always derived server-side, which is what
  kept this a free send rather than the open relay `/fixture/reminder` was.
- `META_APP_ID` / `META_APP_SECRET` — the league's own Meta app, *Badminton Results App*.
  Only needed to mint or debug tokens; neither can publish anything on its own.
- `META_PAGE_TOKEN` / `META_TAMESIDE_PAGE_TOKEN` — **Page access tokens, and they do not
  expire.** `debug_token` reports `type: PAGE`, `expires: never`; a Page token has no clock
  of its own and dies only if the granting user changes their Facebook password or loses
  their role on the Page. Each can publish to that Page, and the Stockport one can publish
  to the league's Instagram account, so **these are the sharpest credentials in `.env`** —
  there is no sandbox Meta to point them at and no expiry to save us.
  `__tests__/setup.js` deletes every `META_*` variable and `utils/testEnvGuard.js` refuses
  the whole run if one survives, matching **both** by value (`EAA…`, which catches a token
  stored under a name nobody anticipated) and by name pattern (`META_*TOKEN`/`*SECRET`,
  which survives a variable being added). Demonstrated by planting a real one and watching
  the suite abort with `Tests: 0 total`.
- `META_PAGE_ID`, `META_TAMESIDE_PAGE_ID`, `META_IG_USER_ID` — ids, not secrets; they
  appear in page URLs and are deliberately *not* flagged by the guard. `META_IG_USER_ID` is
  recorded because discovering it needs `pages_read_engagement`, which the app cannot
  currently request.
- `META_USER_TOKEN` — short-lived, and spent. Only needed to mint replacement Page tokens:
  exchange it for a long-lived user token (`grant_type=fb_exchange_token`, ~60 days) then
  `GET /me/accounts`. Nothing reads it at runtime.
- `SOCIAL_CRON_TOKEN` — shared secret Cloud Scheduler presents as `X-Social-Token` to the
  two weekly social posts: `POST /admin/social/weekly-tables` (Saturday 13:00) and
  `POST /admin/social/weekly-fixtures` (Sunday 18:00). Same gate as the other four;
  **unset closes the token path**. A superadmin session also works, and the matching `GET`
  on each previews the images and both captions and sends nothing. `?dry=1` on either POST
  asks Meta whether it will accept the images and publishes nothing — worth running before
  a season's first real post, since a scheduled job nobody watches is exactly where a
  silent refusal hides.
  **One secret for both, deliberately.** They are the same job done by the same caller,
  both publishing content that is already public on the site. A sixth variable would mean
  the new route stays shut until somebody remembers to set it on the service — *unset
  closes the path* is a good default and a poor deployment plan, and the thing that gets
  forgotten is never the code.
- `SOCIAL_POST_DIRECT` — `'true'` makes `Fixture.sendResultZap` post the result to Meta
  itself rather than handing it to the Make.com webhook. **Unset keeps the Make path**, so
  a rollback is one environment variable rather than one deploy — this runs when a captain
  publishes a result, and a bad week is a week of missing posts nobody notices. Switching it
  on needs no change in Make: see *Two leagues, one Make account* above.
- `SENTRY_DSN` — Server-side Sentry DSN (the `node` project). If unset, Sentry is a no-op, so it's optional locally. Set it in Cloud Run for prod error reporting. Wired via `instrument.js` (loaded first in `app.js`); errors are captured in the central 500 handler in `routes/index.js`. Note: the **browser** Sentry is separate — hardcoded in `views/header.ejs` (the `javascript` project), not env-driven.

## Gotchas & Lessons Learned

1. **PostgreSQL column quoting**: Unquoted camelCase columns become lowercase. Always quote column names in SQL.
   This bites `AS` aliases too, not just column references: `AS teamCaptain` becomes
   `teamcaptain`, so `row.teamCaptain` is `undefined`. That silently blanked the
   captain and match secretary on every `/event/` page for as long as it existed, and
   `AS Man1` blanked every player column on `/fixture-players` and on the scorecard
   confirmation screen until Sep 2026. It renders as an empty cell, never an error.
   **But quote the alias and its references together.** `getMatchPlayerOrderDetails`
   aliases `homeTeam.club AS clubId` and the wrapper joins `club ON club.id = clubId`;
   quoting only the alias turns a blank column into `column "clubid" does not exist`.
   Where nothing in JavaScript reads a column, leaving it folded is the correct answer.
   **The rule, enforced by `__tests__/unit/sql-alias-quoting.test.js`: an alias is either
   quoted-and-camelCase, or written lowercase. Never camelCase-unquoted.** That third form
   is the only dangerous one, and it is dangerous because it LIES — the SQL says
   `AS clubSecEmail` and the row arrives as `clubsecemail`, so the mistake is invisible at
   the place you would look for it. 177 existing aliases were rewritten to lowercase to
   start the guard clean, which was provably inert (Postgres was already folding them):
   verified by snapshotting the output keys of 35 model functions against the real
   database before and after — 421 keys, none changed.
   **That guard cannot find a broken CONSUMER.** It compares SQL against itself and never
   sees what JavaScript reads, so it stops new instances and finds none of the existing
   ones. Neither will `npm test`: these failures are silent, most of these queries have no
   test, and a mock spelling the key camelCase passes against the bug. The only reliable
   method is to run the query and diff its real keys against what its consumers read —
   which is HARD-19, and belongs with `dbq --check` because it needs the database.
   `__tests__/unit/fixture-players-aliases.test.js` does that for one query pair.
   **`node tools/key-contract.js` is that check.** It runs every read-only model function,
   reads `Object.keys()` off a real row, and reports any camelCase property read in
   `views/` or `controllers/` whose lowercase form is a real output key while the camelCase
   form is not — the exact signature of a folded alias with a camelCase reader. It reports
   **suspects, not bugs**: it matches names, not producers, so confirm each by hand. Of the
   first nine it found, three were SCREAMING_CASE OCR constants and four were fed by a
   different function that quotes correctly; the two real ones were `/club-api` consumers
   and `homeClubName`. `--coverage` lists the functions it could not make return a row,
   which is the honest limit of any run.
   **And the folded name is sometimes the right thing to read.** `POST /contact-us` did
   `rows[0].clubSecEmail.indexOf(',')` against `Club.getContactDetailsById`, whose alias is
   `AS clubSecEmail` unquoted — so it was `undefined.indexOf`, the catch turned it into
   "Sorry something went wrong sending your email.", and the enquiry was lost. One member
   tried four times in five minutes on 7 Sep (Sentry NODE-12) and the league got nothing.
   The fix reads `clubsecemail`, because `controllers/clubController.js` and
   `views/club-contact.ejs` already read every column of that query in lowercase and work:
   quoting the alias would have fixed one caller and broken the club contact page.
1a. **`req.user.email` does not exist.** `req.user` is the raw passport-auth0 `Profile`,
   cached whole in the session by `passport.serializeUser`. It carries `displayName`, `id`,
   `emails: [{ value }]` and `_json` — and **no `email`**. The login strategy in `app.js`
   reads `profile.emails[0].value`, so the shape was never in doubt; the spelling just looks
   obvious. It fails in the worst available way: `undefined` is falsy, so every call site
   had a `||` fallback beside it and quietly took the other branch. Nothing threw, nothing
   logged, the feature simply did not exist — `rosterController` had been putting the
   requester in a transfer email's `replyTo` so the club could reply to them, and had
   always sent the league address alone; every `blocked_entry` row said `admin` rather than
   who added it. **Use `userEmail(req.user)` from `utils/sessionUser.js`**, which also has
   `userDisplayName` and `userLabel`. `__tests__/unit/session-user.test.js` fails if
   `.user.email` reappears in `controllers/`, `models/`, `utils/`, `routes/` or
   `middleware/` — it strips comments and strings first and self-tests that the stripper
   still works, because a desynchronised scanner under-reports and so fails in the
   direction that looks fine. It also builds a real `Profile` from the dependency and
   asserts `.email` is undefined, so the premise is checked against passport-auth0 rather
   than against this paragraph.
1b. **Never build a URL from `req.get('host')`.** Firebase Hosting rewrites `**` to
   Cloud Run and the Host header that arrives is the *Cloud Run* one — the requested
   host is passed separately, in `x-fh-requested-host`. Every canonical and `og:url`
   on the site pointed at `league-site-akvq7tsxuq-nw.a.run.app`, which serves the
   whole site publicly, so Google was told the authoritative copy of every page was
   on another hostname. Use `canonicalFor(req)` / `absoluteUrl(path)` from
   `utils/canonical.js` — including for links in emails. `SITE_ORIGIN` overrides the
   default for a staging deploy.
1bb. **`/healthz` never reaches the container, and a new endpoint gets curled in
   production.** Google's frontend intercepts that exact literal path in front of Cloud
   Run and answers its own `Error 404 (Not Found)!!1` page — no response headers of ours,
   so the request demonstrably never arrives. The health endpoint is therefore served at
   **`/health`** (both are registered; monitor `/health`). What makes this worth
   remembering is not the path: it passed Jest, it passed against a real local server,
   and it 404'd in production, because the thing that breaks it only exists once there is
   a Google frontend in front of the app. `/healthz/` and `/HEALTHZ` both answer 200,
   which is how it was pinned down — compare a path you know has no route (it should
   return *our* 404 page, with our headers) against the one you are debugging.
1c. **An INNER JOIN to something optional loses the whole page.**
   `__tests__/unit/optional-join-guard.test.js` now fails on the specific shape that has
   caused this three times: an inner join to `player` on a ROLE (`teamCaptain`,
   `clubSecretary`, `matchSecrertary`, `treasurer`, `otherComms`, `club."clubSec"`,
   `team.captain`). A role is optional by nature — six teams have no captain flagged — so
   joining one as an *attribute* of another row is always the mistake. The one permitted
   form is a statement that hardcodes the role as a literal in its own SELECT
   (`'club Sec' AS role`): then the join defines what the row IS, and INNER is right. It
   deliberately ignores the 27 inner joins to `venue`/`club`/`division`, which need
   judgement per query rather than a rule.
   Found by it: `getAnnualInvoices` inner-joined the club secretary, so **a club with
   nobody flagged would have been dropped from the invoice run entirely** — no error, no
   empty row, just absent. Latent only because all 18 clubs have one today. Fixing it
   surfaced that `No Club` (63) was being excluded *by the same accident*, so that is now
   excluded on purpose. `getFixtureEventById`
   joined the home team's captain, six teams have none flagged, and the 48 affected
   fixtures rendered as `HTTP 200` with a two-byte body. Two lessons: join optional
   things with `LEFT JOIN` (or a scalar subquery, which also makes the pick
   deterministic when there are duplicates), and never `res.send(err)` — an Error
   serialises to `{}` and goes out with the default **status 200**, so a crawler
   banks it as a real page. Use `next(err)`, or an explicit `res.status(404)`.
2. **Query placeholders**: Use `?`, not `$1`. The wrapper converts automatically.
2b. **There is no `insertId`.** The wrapper mimics mysql2's `[rows]` shape but cannot
   invent MySQL's `insertId`: Postgres reports nothing about an inserted row unless the
   statement says `RETURNING id`. Without it an INSERT resolves to an *empty rows
   array*, so `result.insertId` is `undefined` — silently, since nothing throws. Any
   INSERT whose id is needed must end `RETURNING id`, and the caller reads
   `result[0].id`. This bit three separate flows (submitted scorecards redirected to
   `/populated-scorecard-beta/undefined` and emailed that dead link for months; the
   add-player modal posted `NaN` as the new id). **When mocking such a model in a
   test, mock `[{ id: 42 }]`, never `{ insertId: 42 }`** — the invented shape is
   exactly what let the scorecard bug live behind a green test.
2c. **The `pg` Pool must keep its `'error'` listener.** `pg` emits `'error'` on the
   Pool when the backend hangs up on an **idle** client, and an EventEmitter `'error'`
   with no listener is an uncaught exception — so a connection Supabase reaped while
   nobody was using it killed the whole Cloud Run instance, in-flight requests
   included (Sentry NODE-X, 6 Aug). Nothing catches this for you: the pool works
   perfectly in dev, in tests, and under any load that keeps its connections busy, so
   the gap is invisible until it isn't. Only idle clients come through the handler —
   an error on an in-flight query rejects that query's promise and surfaces through
   the caller's `try`/`catch` and the central 500 handler. Swallowing is correct (pg
   has already discarded the client); it's captured to Sentry so the event stays
   visible as *handled*. If it starts arriving often, the real fix is the transaction
   pooler on 6543 — which is what `PG_POOL_MAX` exists for.
3. **Form repopulation on errors**: Must pass both submitted data AND team/player dropdowns with selected flags, or form appears empty to user.
4. **Session cookie name**: Must be `__session` for Cloud Run (Firebase requirement).
5. **DEV_MODE is safe**: Only works outside production; injects mock user for local testing without Auth0.
6. **Model exports are async**: Always await model calls — they return promises.
7. **Test setup**: `__tests__/setup.js` runs before any test, sets env vars (don't rely on .env in tests).

