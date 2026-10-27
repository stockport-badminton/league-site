# Database: Supabase, RLS, querying and the local database

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.

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


## Querying the database

**Don't hand-write dotenv/db.connect boilerplate for a one-off query.** Use:

```bash
# The local database without --prod; add it for the live one.
node tools/dbq.js --prod "SELECT id, name FROM team LIMIT 5"
node tools/dbq.js --prod --schema player        # columns and types
node tools/dbq.js --prod --check all            # data-integrity checks
node tools/dbq.js --prod --check orphan-results # the offending rows
node tools/dbq.js --json "SELECT ..."           # machine-readable, local
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
Each one found something real. Run
`--check all` before and after any data work.

**An officer is recorded one way: the flag on the player.** It used to be two. The old way was a
pointer on the club or team — `club."matchSec"`, `club."clubSec"`, `team.captain` — and
the new way is a flag on the player (`matchSecrertary`, `clubSecretary`, `teamCaptain`)
read with that player's own club or team. `Player.getEmails` matched on **either**, per
UNION branch, and the pointer side never looked at where the player actually was. So a
pointer left behind when somebody changed club kept them on that club's distribution
lists for every division it plays in. Found 18 Sep 2026 from a permanent bounce on
`division1@`: the recipient's record read "No Club / No Team" and she was still
`club."matchSec"` for a club whose B team plays that division. It surfaced only because her
mailbox had been disabled.

**Every pointer is NULL as of 25 Oct 2026; the flags are the one record.** The last 25
were 21 that agreed with a flag, 3 on the No Club / No Team placeholders (pointing at
player 0, `No Player`) and 1 on the withdrawn Parrswood C. They were cleared by
`scripts/null-all-officer-pointers.js` (gitignored; it refuses to clear a pointer that is
the only record of an officer on a live team, and the values are in
`scripts/officer-pointers-backup-2026-10-25T12-54-37-487Z.json`). Every reader was
snapshotted before and after: all division and real-club lists identical; only No Club's
own views changed. On 27 Oct 2026 the readers became flag-only (`435020e`, proved identical
by snapshot) and migration 029 dropped the three columns; `__tests__/db/club.test.js` fails
if one comes back. The season archives (`club20252026`…) still have them, as snapshots,
until REARCH-02 replaces the archives. **A player who leaves a club keeps their flags**
(Neil, 25 Oct 2026); a flagged player at No Club is not an error.

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
tools/local-db.sh sync [--apply]                  # production's current season on top
```

**Tools read the local database unless given `--prod`.** `tools/lib/loadEnv.js` decides,
and every tool goes through it: `dbq`, `key-contract`, `dmarc`, `scorecard-photo-audit`,
`check-inbound-email`, `run-migration.js`, `fixture-import/` and `gap-finder/`. Local reads
`dev.env` alone and `--prod` reads `.env` alone, and each run prints which on stderr. Tools
that only make sense against production say so and refuse without the flag. Until
26 Oct 2026 production was the default and `--local` the opt-in. It was flipped so that
forgetting a flag costs a confusing local answer, not a live write. `--local` is still
accepted and does nothing.

That is a one-place decision because it silently went wrong the day the local database
arrived: dotenv does not overwrite a variable that is already set, so whichever env file
loads FIRST wins, and every tool loaded `dev.env` first. Harmless while `dev.env` carried
the same connection string as `.env`; wrong the instant it did not. `dbq --check all` went
on running and printing counts — against a two-year-old local seed. It surfaced only
because a query returned "no rows" for drafts that plainly existed, and it could as easily
have been a data decision taken on the wrong numbers.
`__tests__/unit/tool-env-order.test.js` fails if a tool calls `dotenv` directly again.

**The write scripts under `scripts/` are gitignored**, so that test does not cover them.
The newer ones go through `loadEnv`, which ignores whatever they pass and decides only
from `--prod`/`--production`. The older ones load `dev.env` then `.env`, so they target the
local database. Check the top of any script before trusting what it reports.

`load` is destructive and idempotent: it drops the schema and rebuilds, because a
half-applied load is worse than none and throwing a local database away costs nothing.

- **Schema comes from `migrations/001_initial.sql`** (60 tables — 12 live, 48 season
  archives) plus the numbered migrations. Applied with `psql -f`, which is still the right
  tool for a bulk load. For a single migration use `node run-migration.js <file> [--prod]`
  (repo root, not `tools/`). It used to split the file on `;` with `String.split`, so a
  semicolon in a comment was a statement boundary and the statement behind it never ran —
  fixed in HARD-18 by sharing `utils/sqlScan.js` with `pgify`, which had the identical bug
  one layer down. Without `--prod` it rehearses against the local database, like every
  other tool.
  **`node run-migration.js --status --prod` answers "has this run against production yet?"**
  (HARD-32). Every file the runner applies is recorded in `schema_migrations` with a hash
  of its bytes; applying it again is a recorded no-op, and a file **edited after it ran is
  refused** — write a new migration for the difference. `load` records its replay as
  `replayed`; production's 001–024 were recorded as `backfilled` on schema evidence.
  Some migrations are no-ops replayed from nothing — 003 adds a column 002 now creates —
  so an "already exists" is reported and skipped while **any other error stops the load**.
- **Data comes from `migrations/data/002_data.sql`**, which is **gitignored**, so a fresh
  clone gets a schema and no rows. Its newest archive is 2024/25.
- **The snapshot is older than the constraints replayed ahead of it**, so it is loaded
  with foreign keys suspended and `tools/local-db/seed-repairs.sql` then replays the
  production repairs it predates and **re-validates every foreign key**. Migration 017's
  `fixture`→`team` keys went on in production only after HARD-11 reinstated the deleted
  teams, and a seed from before that step broke the load (HARD-38). **A new data-repair
  script that production needs before a constraint also belongs in that file**, or the
  next constraint migration breaks the load the same way. The re-validation is what stops
  the file being a way to hide orphans: a violation still stops the load and names the key.
- **`tools/local-db/dev-fixtures.sql` supplies what that snapshot cannot**: outstanding
  fixtures in the current season (without them the scorecard form has nothing to match a
  result against), a draft carrying a `confirmToken`, and a messer draft. Six browser
  specs skip without them.
- **Contact details are replaced, never copied.** Every `playerEmail` becomes
  `bigcoops+firstnamelastname@gmail.com` and every `playerTel` an `07700 900xxx` number
  from Ofcom's reserved drama range, re-encrypted under a local `DB_PI_KEY`. A dev box
  should not hold the league's contact list, and the production ciphertext would not
  decrypt under a local key anyway.
  **The draft tables' `email` is plaintext**, so the encrypted-column loop never saw it:
  the seed carried 107 real submitter addresses until 4 Oct 2026. They become
  `bigcoops+draft<id>@gmail.com` now. A new contact column needs its own line in
  `sanitise.sql`, whatever type it is.
- **`sync` brings production's current season in without its contact details**
  (`tools/local-db/sync.js`, dry unless `--apply`). Fixtures and games for the season,
  plus season/division/venue/club/team and players in full — the seed is two seasons old,
  so this season's teams are not in it. Player contact columns are never read: the alias
  is rebuilt locally from the name, only where production has a value. Games are
  *replaced* per fixture, because a republished result has new game rows and an upsert
  would double them. Draft tokens are replaced, since a production token can publish that
  draft live. **An unknown `bytea` column stops it** — a new encrypted column is a new
  contact detail until somebody says otherwise. Rows match by id, so a row written
  locally can be overwritten when production later uses that id.
  Two columns production had and a migrations-built database did not are restored by
  026 (`season."clubFee"`) and 027 (`messer_scorecard."scoresheet-url"`), Oct 2026. The
  second WAS in a migration — 003's last statement — but 003's first now hits "already
  exists" and the replay rule ends the file there, so nothing after it ran. **A migration
  that a replay may stop early must not carry anything else**; restate it in a new one.
  **It also creates any season archive (`team20252026` and the other five) that production
  has and the local database does not.** The first sync of a new season makes last season
  "previous", and every page for it reads those tables — which the rollover creates in
  production and nothing created locally, so after syncing 2026/27 every 2025/26 page was a
  500 and seven browser tests failed on it. An archive already present is left alone; they
  are frozen once the season ends.
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
- **`gamesWon` / `gamesLost` are GAMES won and lost, not league points.** The league
  ranks on games, not on a win/draw/loss table — every one of the 18 games in a fixture
  counts towards the standing, which is why a team with 6 matches played shows 60 and 48.
  The league table image captions the columns `P / W / L / Avg.` and is correct: P is
  matches played, W and L are games. The keys were `pointsFor` / `pointsAgainst` until
  REARCH-03 part C (27 Oct 2026), and read as though a team had won 60 of 6 matches. The
  inner columns of the table SQL still say `pointsfor`; only the returned keys changed.
- **division**: `id, name, league (int)`
- **scorecardstore**: Draft submissions — `(id, date, homeTeam, awayTeam, Game1homeScore, ..., Game18awayScore, homeMan1, homeMan2, ...)`
- **messer_scorecard**: Messer knockout draft submissions — similar schema but Game1-Game15 (15 games, not 18)
- **player**: `id, name, gender ('Male'/'Female'), team (int)`

**JOIN Pattern**: Always quote both column names:
```sql
LEFT JOIN team ht ON f."homeTeam" = ht.id
LEFT JOIN division d ON ht."division" = d.id
```

