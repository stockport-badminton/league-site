# HARD-18 — The migration runner splits on semicolons inside comments

**Severity:** low · **Wave:** A · **Blocked by:** nothing
**Owns:** `run-migration.js`
**Sources:** found while applying migration 011, 31 Aug 2026

## Why

`run-migration.js` executes a file by splitting it on semicolons:

```js
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0);
```

A semicolon inside a `--` comment is therefore a statement boundary. The chunk after it
begins with whatever prose followed the semicolon on that line — bare words, not a
comment, because the `--` that made it a comment is in the previous chunk. Postgres
rejects it.

That is not hypothetical. `migrations/011_scorecard_confirm_token.sql` had two semicolons
in its header comment, and the split produced this:

```
[1] "-- A per-draft secret for the scorecard confirmation link ... on the way\n-- in"
[2] "nothing changes for a captain, who still clicks the link ...   <- syntax error
[3] "a row with no token is treated as ... ALTER TABLE scorecardstore ADD COLUMN ..."
```

The `ALTER` is in chunk 3, behind chunk 2's syntax error, so **the column would never have
been created.** It was found by simulating the split before running the file, and fixed by
rewording the comment to remove the semicolons.

The failure is loud — the runner throws, prints the message, and exits 1 — so this is not
a silent-corruption bug. What makes it worth fixing is that it reads as a *broken
migration* rather than a broken runner. The next person will edit their SQL looking for a
mistake that is not there, and the more explanatory a migration's comments are, the more
likely they contain a semicolon.

There is precedent for exactly this bug one layer down: `db_connect.js`'s `pgify` had the
same shape — a naive scan that did not know what a string literal or a comment was — and
it was silently corrupting query output. Commit **`baf2215`** fixed it and **already
contains the scanner this package needs.**

## What to do

1. Read `pgify` in `db_connect.js` (commit `baf2215`). It walks a SQL string tracking
   `'literals'` with `''` escapes, `"identifiers"`, `$tag$` dollar quoting, `--` line
   comments and nestable `/* */` blocks. The statement splitter needs the same state
   machine with a different action at the boundary: split on `;` when outside all of them,
   ignore it otherwise.
2. Consider extracting that scanner so both callers share it rather than having two copies
   that can drift. `utils/` is the natural home. If you do, `db_connect.js` must keep
   working with no behaviour change — it is on the hot path for every query in the app.
3. A semicolon inside a **dollar-quoted function body** is the case that makes this more
   than cosmetic. Any future migration defining a trigger or function will contain several,
   and the current splitter would shred it into fragments. That is the scenario to test.
4. Keep the existing `already exists` tolerance in the runner. It is what makes a
   re-applied migration harmless.

## Acceptance criteria

- A migration file whose comments contain semicolons executes as one statement.
- A migration containing a `$$ ... $$` function body with internal semicolons executes as
  one statement.
- Multiple real statements separated by top-level semicolons still execute separately, in
  order.
- Applying `migrations/011_scorecard_confirm_token.sql` again is still a no-op (it is
  `ADD COLUMN IF NOT EXISTS`).
- `npm test` green.

## Tests

Unit tests on the splitter, in the shape of `__tests__/unit/pgify.test.js` — which is the
model for this, including the discipline of confirming each case fails against the old
implementation. Cases worth having:

- semicolon in a `--` comment before the only statement (the 011 case, verbatim)
- semicolon inside a `'string literal'`
- semicolon inside a `$$ ... $$` body
- semicolon inside a `/* */` block
- three genuine statements, still three
- empty file, comment-only file

No database is needed for any of it.

## Out of scope

- Migration tracking. There is no `schema_migrations` table and nothing records which
  migrations have run — that is a real gap and a bigger piece of work than this. Note it
  rather than building it here.
- Rewriting existing migration files. `011` has already been reworded; leave the rest.
