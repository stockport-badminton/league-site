# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It holds the rules most tasks need. The reasoning, the history and the subsystem detail
are in `docs/claude/`. **Read the matching file before touching its area:**

| File | Read before touching |
|---|---|
| [docs/claude/database.md](docs/claude/database.md) | Supabase settings, RLS, the `player` email columns, officer pointers, `dbq`, the local database and `sync` |
| [docs/claude/testing.md](docs/claude/testing.md) | `__tests__/setup.js`, the supertest binding, `npm run test:db`, anything under `e2e/` |
| [docs/claude/patterns.md](docs/claude/patterns.md) | admin tools, `asset()`, `icon()`, scorecard links and the photo endpoint, `afterCommit`, Messer, lazy requires, the `sanitize-html` pin, auth and dev mode, the hardening backlog |
| [docs/claude/social.md](docs/claude/social.md) | result cards, weekly tables/fixtures posts, Meta, Threads, anything that was on Make.com |
| [docs/claude/storage.md](docs/claude/storage.md) | the `badmintontemp` bucket, its lifecycle rules, failed-analysis uploads |
| [docs/claude/security.md](docs/claude/security.md) | spam controls, rate limits, `/fixture/rearrangement`, helmet and the CSP |
| [docs/claude/env-vars.md](docs/claude/env-vars.md) | any environment variable, cron token or `META_*` credential |
| [docs/claude/production-logs.md](docs/claude/production-logs.md) | deciding whether a route is used, before deleting anything |
| [docs/claude/gotchas.md](docs/claude/gotchas.md) | the full story behind each numbered gotcha below |

Skills: load `seo`, `rosters`, `registrations`, `emails` or `hardening` before touching
their areas (each skill's description names the files).

## Database

PostgreSQL (Supabase) behind a MySQL-looking wrapper in `db_connect.js`:

- **Use `?` placeholders**; the wrapper converts to `$1, $2, …`.
- **Quote camelCase columns and aliases**: `f."homeTeam"`, `AS "homeTeam"`. Unquoted
  identifiers fold to lowercase and the JS key is silently `undefined`. An alias is
  quoted-and-camelCase or written lowercase, never camelCase-unquoted
  (`sql-alias-quoting.test.js`). Quote an alias and its references together.
- **`const [rows] = await (await db.otherConnect()).query(sql, params)`** — the tuple has
  one element. `rows.affectedRows` holds the count; `[, info]` is always `undefined`.
- **No `insertId`.** An INSERT whose id you need ends `RETURNING id`; read `rows[0].id`.
  Mock it as `[{ id: 42 }]`, never `{ insertId: 42 }`.
- **Join optional things (any role: captain, secretary…) with `LEFT JOIN`.**
- **`DB_PI_KEY` is always a bound `?` parameter**, never inlined
  (`no-secrets-in-sql.test.js`).
- **`player` has two encrypted email columns:** `authEmail` is the login identity,
  `playerEmail` the contact address. A blank is `NULL` or `pgp_sym_encrypt('')`.
- **Officers are recorded by the player flags** (`teamCaptain`, `clubSecretary`,
  `matchSecrertary`); the club/team pointer columns are all NULL and nothing writes them.

### The typed query layer (REARCH-01, in progress)

`db/` holds Kysely over the same Pool (`const { kysely, encrypt, decrypt } = require('../db')`),
with types in `db/schema.d.ts`. Converted model files move to it one at a time.

- **A file using it starts `// @ts-check`**; `npm run typecheck` checks it. The guard
  (`__tests__/unit/typed-sql-guard.test.js`) fails without the line, and on `sql.raw` or an
  uncast `sql` template.
- **Inside `db.withTransaction(async (conn, trx) => …)`, use `trx`**, never the
  module-level `kysely`, which runs outside the transaction.
- **A migration needs `npm run test:db && npm run db:types`** in the same commit.
- **Kysely stays on 0.28.x** (0.29 is ESM-only; Jest on Node 22 cannot load it).

### Tables

- **fixture**: `id, date, homeTeam (int), awayTeam (int), homeScore, awayScore, status`
- **team**: `id, name, division (int)` · **division**: `id, name, league (int)`
- **player**: `id, name, gender ('Male'/'Female'), team (int)`
- **scorecardstore**: drafts, Game1–Game18 · **messer_scorecard**: Messer drafts, Game1–Game15
- **`pointsFor` / `pointsAgainst` are GAMES won and lost, not league points.**

### Querying and migrations

- One-off reads: `node tools/dbq.js "SELECT …"` (`--schema t`, `--check all`, `--json`).
  It refuses writes.
- **Tools read PRODUCTION**; `--local` asks for the development database. Never call
  `dotenv` directly in a tool (`tool-env-order.test.js`).
- Writes to production data go in a gitignored `scripts/` file: dry by default, `--apply`
  to write, guard repeated in the write's `WHERE`, and it ends by re-reading what it
  changed. **Check the top of any script** — they load `dev.env` first and so target the
  local database.
- Single migration: `node run-migration.js <file> [--local]`; `--status` says what
  production has run. An edited, already-applied migration is refused; write a new one.
  Supabase/host configuration does not belong in `migrations/`.
- Local database: `tools/local-db.sh up && tools/local-db.sh load`. `npm run dev` uses it;
  `app.js` refuses to start a dev server against production.

## Auth

- Session cookie must be `__session` (Firebase).
- **Every route's first middleware is exactly one `access.*`** (`middleware/access.js`):
  `public`, `member`, `superadmin`, `messerAdmin`, `clubScoped`, `cron(gate)`, `publish`,
  `sns`, `devOnly`, `token(what)`. A limiter goes after it. Then
  `UPDATE_ROUTE_TABLE=1 npx jest route-access` and read the `docs/routes.md` diff.
- A role check stays in a handler only when a superadmin sees *more* there; use
  `isSuperAdmin` from `middleware/requireClubAccess.js`, never a new copy.
- `DEV_MODE=true` with `NODE_ENV≠production` injects a mock superadmin/messeradmin user.
- **`req.user.email` does not exist.** Use `userEmail(req.user)` from `utils/sessionUser.js`.
- Role: `req.user._json['https://my-app.example.com/role']`; Messer admin:
  `_json['https://my-app.example.com/messeradmin']`.

## Testing

- `npm test` (Jest), `npm run test:db` (model SQL against a real Postgres; needs
  `tools/local-db.sh up`), `npm run test:e2e` (Playwright). Use Node 22.
- **`__tests__/setup.js` declares the whole test environment**; a variable a test needs is
  stated there. `testEnvGuard` refuses the run if anything live is present.
- **A model function's SQL is tested in `__tests__/db/`, or not at all.** Mocked-database
  tests of models prove nothing.
- **A fix needs a test that fails without it**, verified by removing the fix.
- **Assert on rendered HTML, not the view name.**
- Don't simplify supertest's `127.0.0.1` binding in `setupAfterEnv.js` back to
  `app.listen(0)`. A status-only assertion can pass on a foreign process's response.
- A Jest `Exceeded timeout` on a busy machine: re-run it alone before believing it.
- Playwright: one run at a time. Writing specs declare `allowWrites`; never widen
  `READ_ONLY_POSTS`.

## Delegate the mechanical work to subagents

**This section is the authorisation** to use the Agent tool. Delegate the reading, keep
the deciding.

| Delegate | To |
|---|---|
| Running `npm test` / a single suite | `test-runner` |
| Searching Cloud Logging, or any large log | `log-trawler` |
| "Where is X used", "what calls Y" | `Explore` |
| "How does subsystem X work end to end" | `code-cartographer` |

Pass `model: 'haiku'` for mechanical runs and searches, `model: 'sonnet'` when relevance
needs judgement.

**Never delegate:** judging whether a test proves anything (run the before-and-after
yourself), deciding what a failure means, or anything that writes.

- **`npm test` inside a git worktree collects nothing and exits 0.** Use
  `npx jest --testPathIgnorePatterns=/node_modules/` there.
- **Never run Playwright in two places at once.**

## Project rules

- **New admin tool**: add it to `GROUPS` in `utils/adminTools.js`, not the nav.
- **Asset URLs**: `asset('/static/…')`, never by hand.
- **Icons**: `<%- icon('name') %>` (Font Awesome 6 names). An `fa-` class renders nothing.
- **URLs**: build with `utils/canonical.js` helpers (`canonicalFor`, `absoluteUrl`,
  `resultImagePath`, …), never from `req.get('host')` or by interpolation.
- **Scorecard tokens and links**: only through `utils/scorecardLinks.js`.
  Publishing uses `mayPublishDraft`, not `mayOpenDraft`.
- **Anything after a commit** (email, webhook, extra data) goes through
  `utils/afterCommit.js`, and the page says whether the notification happened.
- **Email**: every send through `mailer.send(...)` with `text` and `whyReceiving`;
  hand-built HTML escapes with `utils/html.js`; unauthenticated senders derive recipients
  server-side.
- **Form validation errors** re-render with `data: req.body` *and* the dropdown rows with
  selected flags (`controllers/scorecardController.js`).
- **A new public form** includes `views/spam-fields.ejs` and its route carries `spamGate()`
  and a limiter. Blocklists live in `/admin/spam`, never in code.
- **A new CDN in a view** goes in `OBSERVED` in `utils/securityHeaders.js`. Keep
  `'unsafe-inline'` in `script-src`; never add a nonce.
- **Every runtime `require()` names a production dependency.**
- **`sanitize-html` stays pinned at exactly 2.17.5** until HARD-41 (Node 24.9+).
- **Anything that publishes to Meta and can exceed 60s** is called on the Cloud Run URL
  and has no retries (gotcha 1bc).
- **Never delete a route on log silence alone**; log queries need a `timestamp>=`
  constraint.
- Hardening work packages: `docs/hardening/README.md`; landed ones move to `done/`.

## Gotchas & Lessons Learned

Code comments cite these numbers; the full account of each is in
[docs/claude/gotchas.md](docs/claude/gotchas.md).

1. **Quote camelCase columns and aliases.** Folding is silent; `node tools/key-contract.js`
   finds folded aliases with camelCase readers. Sometimes the folded name is the right one
   to read.
1a. **`req.user.email` does not exist.** Use `userEmail(req.user)`.
1b. **Never build a URL from `req.get('host')`.** Use `utils/canonical.js`.
1bb. **`/healthz` never reaches the container**; health is `/health`. Curl a new endpoint
   in production.
1bc. **Firebase Hosting gives up after 60 seconds while Cloud Run carries on.** A slow
   request looks like a failure and is a success; a retry double-posts.
1c. **An INNER JOIN to something optional loses the whole page.** Never `res.send(err)`;
   use `next(err)`.
2. **Query placeholders**: `?`, not `$1`.
2b. **There is no `insertId`**; use `RETURNING id`.
2c. **The `pg` Pool must keep its `'error'` listener.**
2d. **The query tuple has ONE element**; read `rows.affectedRows`.
3. **Form repopulation on errors** needs submitted data and dropdowns with selected flags.
4. **Session cookie name** must be `__session`.
5. **DEV_MODE is safe**: only outside production.
6. **Model exports are async**: always await them.
7. **Test setup**: `__tests__/setup.js` sets env vars; don't rely on `.env` in tests.
