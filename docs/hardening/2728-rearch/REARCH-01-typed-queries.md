# REARCH-01 — a typed query layer replaces the MySQL wrapper

**Size:** L · **Window:** in-season OK, except the functions on the publish path
**Blocked by:** REARCH-08's snapshot harness (step 0 below). Soft: HARD-41 (Node 24), only
if the `.ts` route is chosen in decision 1.
**Owns:** `db_connect.js`, a new `db/` (Kysely instance, generated types), `tsconfig.json`,
`models/**` **except the 14 season-switched functions listed in the folder README** — those
belong to REARCH-02.
**Source:** the 24 Oct 2026 "build it from scratch" review.

## Why

`db_connect.js` makes Postgres look like mysql2: `?` placeholders, a `[rows]` tuple,
`affectedRows` hung off the array. Every query is a string, and nothing checks a string
against the schema or the code that reads its result. The bugs that has produced are
spread across `CLAUDE.md`, and they are one kind of bug:

| What happened | Where it is recorded | What would have caught it |
|---|---|---|
| `AS teamCaptain` folds to `teamcaptain`; the reader gets `undefined`; a blank cell on every `/event/` page | Gotcha 1 | The builder quotes every identifier, so no folding; the result type names the key |
| `result.insertId` is `undefined`; scorecards emailed `/populated-scorecard-beta/undefined` for months | Gotcha 2b | `.returning('id')` is how an insert says what it returns, and the type says so |
| `const [, info]` is always `undefined`; a script reported "0 of 4 cleared" after clearing 4 | Gotcha 2d | `executeTakeFirst().numUpdatedRows` is a typed field |
| `DB_PI_KEY` concatenated into SQL and logged | HARD-27 | An `encrypted()` helper that can only bind the key |
| `rows[0].clubSecEmail.indexOf` on a row whose key is `clubsecemail`; enquiries lost | Gotcha 1, NODE-12 | The row type has no `clubSecEmail` key, so this does not compile |

Three guards exist because of these: `sql-alias-quoting.test.js`, `no-secrets-in-sql.test.js`
and `tools/key-contract.js`. CLAUDE.md is candid about their limit: the alias guard
*"cannot find a broken CONSUMER"*, and key-contract *"reports suspects, not bugs"*. A typed
builder checks producer and consumer against each other at the point where you write them.

Measured 24 Oct 2026: 265 `.query(` call sites, 253 of them in `models/`, across ~266
exported model functions in 23 files. 37 test files mock `db_connect`.

## Decisions to take first

1. **TypeScript, and how.** Two routes, both with no runtime change:
   - **JS with JSDoc, checked by `tsc --noEmit --checkJs`.** Files stay `.js`, Node and Jest
     run them exactly as now, the Dockerfile does not change. Kysely's types flow through
     its method chains under `checkJs` without annotations on every line.
   - **`.ts` files run by Node's type stripping.** Needs Node 24 (HARD-41) to run unflagged,
     and Jest needs a transform for `.ts` (Jest does not use Node's stripping).

   **Recommended: the JSDoc route.** It is the one that changes nothing about how the app
   is built, tested or deployed, and it can be switched later file by file. The CI cost is
   one `tsc` step of seconds.
2. **Kysely, not an ORM.** Kysely is a query *builder*: the SQL you would have written, with
   types. It takes the existing `pg` Pool through `PostgresDialect`, so `PG_POOL_MAX`, the
   pool's `'error'` listener (gotcha 2c) and the Supabase connection are unchanged. An ORM
   (Prisma, TypeORM) brings its own connection management and query engine, and Prisma a
   binary in the image — both changes to how the database is reached.
3. **Types generated from the local database, never production.** `kysely-codegen` against
   a database built by `tools/local-db.sh load`, which is the migrations replayed. Generated
   into `db/schema.d.ts` and committed. A CI step regenerates and diffs, so a migration that
   is not reflected in the types fails the build. (That needs a Postgres in CI —
   REARCH-08.)
4. **Column names stay as they are.** The camelCase columns stay quoted camelCase; Kysely
   quotes every identifier, which is what removes the folding. No `CamelCasePlugin` — it
   assumes a snake_case schema. Renaming columns is not this package.

## What to do

**Step 0 — the safety net (REARCH-08).** `tools/query-snapshot.js`: given a model function
and a list of argument sets, run it against the local database and write the result —
keys, values *and* order — to a file. Run before converting a function, run after,
compare. This is the method that proved HARD-19's 177 alias rewrites inert (421 keys
snapshotted before and after), extended from keys to values. A conversion is done when the
snapshots are identical. "Tests pass" is not the criterion: 37 suites mock the database and
cannot see a query change at all.

**Step 1 — infrastructure, one PR.**

- `db/index.js`: one `Kysely<DB>` over the *existing* Pool from `db_connect.js`.
- **A transaction bridge.** `db.withTransaction(fn)` hands `fn` a client that old code calls
  as `conn.query(sql, params)`. During the conversion a transaction will contain both old and
  converted functions, so the same checked-out client must also be reachable as a Kysely
  instance. Build it once: a Kysely over a single-connection driver wrapping that client,
  passed alongside `conn`. Without this, converting one function inside a transaction would
  silently move it onto a different connection — outside the transaction. **Test this with
  a rollback**: write through both, throw, confirm neither write survives.
- `db/encrypted.js`: `encrypt(value)` / `decrypt(column)` expressions that bind `DB_PI_KEY`
  as a parameter and cannot do otherwise. Every `pgp_sym_*` call (7 model files) goes
  through these. This replaces the job `no-secrets-in-sql.test.js` does by inspection.
- A lint rule (or a small test, matching this repo's style) that fails on `sql.raw(` and on
  a `sql` template whose result is not typed (`sql<Row>`), outside an allowlist. `sql.raw` is
  how string-built SQL gets back in.
- `tsc --noEmit --checkJs` in `cloudbuild.yaml`, scoped to `db/` and converted files.

**Step 2 — convert, a model file per PR.** Smallest and simplest first, to settle the
idioms before the hard ones: `auth`, `season` (except `getAll`), `siteSettings`, `venue`,
`division`, `emailEvent`, `invoiceRun`, `socialToken`, `socialResultPost`,
`threadsResultPost`, `homepageContent`, `spamControls`, `registrationRequest`, `club`,
`teams`, `game`, `liveScorecard`, `roster`, `clubRegistration`, `league`, then `players`
and `fixture` last — the biggest, with the most dynamically assembled SQL.

For each function:

1. Snapshot it (step 0) over argument sets that reach every branch. A function that builds
   its `WHERE` from a filter object (`getFixtureDetails`, `getAllFixtureDetails`) needs a set
   per filter.
2. Rewrite with Kysely. Dynamic filters become `.$if(cond, qb => qb.where(…))` — this is
   where the conversion buys the most: today they push SQL fragments onto an array.
3. **Return the same shape, folded keys included.** If a function returns `clubsecemail`
   today, the converted one aliases to `clubsecemail`. Callers do not change in this
   package. Fixing a name is a separate, later commit — with the caveat below.
4. Snapshot again; identical or it is not done.
5. Where the old function had a mocked unit test, add a database test (REARCH-08) and keep
   the mock test only if it tests something other than the SQL.

**Step 3 — remove the wrapper.** When no model calls `conn.query` with a string, delete
`pgify`, `pgQuery` and the `[rows]` shim. `utils/sqlScan.js` stays (the migration runner
uses it). The three guards are then either still meaningful or retired *with a note saying
what replaced them* — not silently deleted.

## The limit, stated up front

**Types reach JavaScript, not EJS.** A controller reading `row.clubSecEmail` stops
compiling; a template doing `<%= row.clubSecEmail %>` does not. Most of this codebase's
blank-cell bugs were in templates. So:

- `tools/key-contract.js` stays, because it reads `views/`.
- Before renaming any returned key, render the pages that use it and compare
  (CLAUDE.md's *— real render* pattern), or type the view's locals at the controller with a
  JSDoc `@typedef` so at least the hand-off is checked.

## Window

In-season OK: every conversion is proven identical on real data and reverted by one
deploy. **Except** the functions `full_fixture_post` and `email-scorecard` call
(`Fixture` writes, `scorecardstore` writes) — leave those to the off-season, where a mistake
does not cost a Tuesday night's results.

## Acceptance criteria

- Every model function outside REARCH-02's 14 goes through Kysely or a typed `sql<Row>`.
- `pgify` / `pgQuery` deleted; `grep -rn "\.query(\`" models` finds nothing.
- A snapshot pair on file for every converted function, identical.
- `tsc --noEmit --checkJs` passes in CI over `db/` and `models/`.
- The transaction bridge has a rollback test that fails if the bridge is removed.
- `node tools/key-contract.js` reports no new suspects; `--check all` unchanged.
- Cost: no runtime change (one dependency, no network); CI gains a `tsc` step.

## Out of scope

- The 14 season-switched functions (REARCH-02).
- Renaming columns or returned keys (REARCH-03 does the one that matters).
- Controllers and views, beyond what a changed import requires.
- `tools/` and `scripts/` — they can adopt the builder later; `dbq.js` takes free SQL by
  design.
