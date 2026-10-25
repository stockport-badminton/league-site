# 2027/28 re-architecture

Nine packages that change the *shape* of the code rather than fixing one defect each. They
came out of asking, on 24 Oct 2026, how this site would be built from scratch **without
changing**:

1. any feature or behaviour a member, captain or officer can see;
2. the database or hosting configuration — Supabase Postgres over a plain `pg` pool, Cloud
   Run behind Firebase Hosting, S3, SES, Auth0, Cloud Scheduler, Sentry;
3. the cost profile.

The answer was not a rewrite. Most of `CLAUDE.md` is a record of the same few *kinds* of
bug, each caught one instance at a time, with a guard test added behind it. Each package
here removes one kind by construction, so the guard stops being the only thing between the
code and the bug.

**Read [`../README.md`](../README.md) first.** Its rules of engagement apply here unchanged
— one package per agent, a test that fails without the fix, `--check all` before and after
any data work, take test counts from the run.

## Timing: none of this lands mid-season

The league plays September to April. The 2026/27 season row runs to 29 Jul 2027, and the
next rollover (the point at which this season's archives are taken) is **June/July 2027**.
Every package says which window it needs:

- **In-season OK** — provably inert (old and new compared on real data), touches nothing a
  captain uses on a Tuesday night, and can be reverted by one deploy.
- **Off-season only** — changes a path a captain uses every week (filing, publishing, the
  wizard), or changes stored data in a way that is not reverted by a deploy.

The target is that **the 2027/28 season starts on the new shape**, and that the June 2027
rollover is the first one done the new way (REARCH-02).

## Does doing 1 and then 2 mean writing the queries twice?

**No — but only because of how REARCH-02 is designed, and the reason is worth knowing.**

The obvious version of "season as data" is to make `team`, `club`, `division`, `player`,
`venue` and `messer` hold every season, with a `season` column. That *would* touch nearly
every query in the codebase: every read of the current season would need a season filter
it does not have today. Done after REARCH-01, it would rewrite most of what REARCH-01 had
just converted. That is the version not to build.

What the archives actually are matters here. **`fixture`, `game` and `scorecardstore`
already hold every season** — a page for a past season finds its fixtures by date range.
The 48+ archive tables (`team20242025` and friends) are something narrower: a **snapshot of
the dimension tables at season end** — what a team was called, which club and division it
was in, which team a player played for. That snapshot is the *right* idea; HARD-39 showed it
is the only reason team ids 51 and 54–57, each reused by a different team, render correctly
on old pages. What is wrong is only the representation: one table per season, reached by
splicing the season into the table name.

So REARCH-02 keeps the live tables exactly as they are and replaces the archives with one
history table per entity, `team_season (season, id, …)`. Measured on 24 Oct 2026:

| | |
|---|---|
| Exported model functions | ~266 across 23 files |
| `.query(` call sites | 265, of which 253 in `models/` |
| Functions that touch an archive table | **14**, in 7 files |

The 14: `club.existsInSeason`, `clubRegistration.getDigest` / `getStatus`,
`fixture.getClubFixtureDetails` / `getMatchPlayerOrderDetails`, `league.getAllLeagueTables`
/ `getAllLeagueTablesWithTopBottomDetails` / `getLeagueTable`, `players.getNamesClubsTeams` /
`getSeasonRanks` / `newGetPairStats` / `newGetPlayerStats`, `season.getAll`,
`teams.getMesser`.

**Those 14 are also exactly the functions a typed query builder cannot type.** A table
name built as `` `team${season}` `` can only be expressed through an untyped escape hatch.
So the split falls out naturally:

- **REARCH-01 converts the other ~250 and explicitly skips the 14.** It can start before
  REARCH-02 and does not wait for it.
- **REARCH-02 rewrites the 14** against the history table — once, and typed if REARCH-01's
  infrastructure has landed by then.
- REARCH-02 does not touch the live tables, so nothing REARCH-01 converted is reopened.
  **One addition, decided 25 Oct 2026:** a player's game history shows each game's team as
  it was that season, so `players.getPlayerGameData` belongs to REARCH-02 as a fifteenth
  function and REARCH-01 skips it too. Done early the same day on the current shape: it reads
  every season's `team`/`player` snapshot through a union discovered from the schema, so
  REARCH-02's job there is the same snapshot-identical move as for the other 14.

The real dependency between them is **infrastructure, not queries**: REARCH-02 wants
REARCH-01's typed query builder and REARCH-08's snapshot harness to prove the 14 rewrites
inert. It does not want REARCH-01 to be *finished*.

## The packages

| | Package | Size | Window |
|---|---|---|---|
| [REARCH-01](REARCH-01-typed-queries.md) | A typed query layer replaces the MySQL wrapper | L | In-season OK, except the publish path |
| [REARCH-02](REARCH-02-season-history.md) | Season archives become one history table per entity | M | Additive steps any time; the drop is off-season, after the 2027 rollover |
| [REARCH-03](REARCH-03-one-record-per-fact.md) | One record per fact: officers, drafts, names | M | Officers in-season OK; drafts off-season only |
| [REARCH-04](REARCH-04-route-access.md) | Every route declares who may call it | M | In-season OK |
| [REARCH-05](REARCH-05-outbox.md) | One outbox for every side effect | M | Off-season only |
| [REARCH-06](REARCH-06-config-schema.md) | Environment variables declared in one place | S | In-season OK |
| [REARCH-07](REARCH-07-frontend-build.md) | Inline scripts out, a bundler for shared code | M | Wizard off-season; other pages in-season OK |
| [REARCH-08](REARCH-08-real-database-tests.md) | Tests that run against a real Postgres | M | In-season OK |
| [REARCH-09](REARCH-09-small-defaults.md) | Small defaults: session user, logging, draft tokens | S each | Mixed; see the package |

## Dependencies

```
HARD-32 (migration tracking) ──────────────┐
                                           ▼
REARCH-08 harness ──► REARCH-01 infra ──► REARCH-02 ──► (June 2027 rollover, new way)
        │                    │
        │                    ├──► REARCH-01 bulk conversion (parallel with 02)
        │                    │
        └────────────────────┴──► REARCH-03 ──► REARCH-07 (wizard shares the rules)
                                       │
HARD-47 settled (≥ ~Dec 2026) ────────►REARCH-05 ◄── REARCH-03 drafts (same write path)

REARCH-04, REARCH-06, REARCH-09: independent; any time.
HARD-15 is absorbed by REARCH-07. HARD-41 (Node 24) is optional for REARCH-01.
```

*Blocked by* in each package names what must land first. A soft dependency ("better
after") is written as such and does not block.

## Conflict map

Same rule as the main backlog: packages that own disjoint files can run in parallel. Where
two packages own the same file, the later one rebases on the earlier.

| Package | Owns | Blocked by | Conflicts with |
|---|---|---|---|
| REARCH-08 | `__tests__/db/` (new), `tools/query-snapshot.js` (new), `cloudbuild.yaml` (a Postgres step), a synthetic seed | — | HARD-32 (both touch the local load) |
| REARCH-01 | `models/**` (all but the 14), `db_connect.js`, `db/` (new: Kysely instance, generated types), `tsconfig.json` (new) | REARCH-08 harness | Every package that edits a model. Convert a model file in one PR so the conflict window is short |
| REARCH-02 | the 14 functions, `models/season.js`, `tools/local-db/sync.js`, a migration, `tools/season-archive.js` (new), one audit check | REARCH-01 infra (soft), REARCH-08 harness, HARD-32 (soft) | REARCH-01 on those 7 model files — agree that 01 never touches the 14 |
| REARCH-03 | officer columns + `players.getEmails`; `scorecardstore` / `messer_scorecard` and both scorecard controllers; `league.js` aliases | REARCH-01 for the models it touches | REARCH-05 and REARCH-07 (same controllers and wizard) |
| REARCH-04 | `routes/index.js` → `routes/*.js`, `middleware/access.js` (new) | — | Anything that adds a route: do 04's split early so later packages append to small files |
| REARCH-05 | `utils/afterCommit.js`, `social_result_post` / `threads_result_post`, the drain route, scheduler jobs | HARD-47 measured and stable | REARCH-03 drafts, HARD-47 |
| REARCH-06 | `config/` (new), `app.js` env reads, `__tests__/setup.js`, `e2e/server-env.js`, `utils/testEnvGuard.js`, `tools/lib/loadEnv.js` | — | Any package adding an env var |
| REARCH-07 | `views/**/*.ejs` inline handlers, `static/beta/js/`, a build step | REARCH-03 (rules module) for the wizard part | **HARD-15 — absorbed**; HARD-44 item 3 |
| REARCH-09 | `utils/sessionUser.js`, passport (de)serialise in `app.js`, logging, `utils/scorecardLinks.js` | — | REARCH-06 on `app.js` |

## Suggested calendar

| When | What |
|---|---|
| Nov 2026 – Feb 2027 (in-season) | REARCH-06, REARCH-08 harness, REARCH-04 steps 1–2, REARCH-01 infrastructure and the first small models |
| Feb – Apr 2027 (in-season) | REARCH-01 bulk conversion; REARCH-02 additive steps (history tables, backfill, read switch) |
| May – Aug 2027 (off-season) | REARCH-03 drafts, REARCH-05, REARCH-07 wizard, REARCH-09 session user. **June/July: the rollover, by `tools/season-archive.js`** |
| Sep 2027 | 2027/28 starts on the new shape. Archive tables dropped after a season of being unread |

## What was considered and left out

- **A move to Fastify.** The first draft of this list had it, for `app.inject()` (tests
  without sockets) and schema validation. The socket problem is already solved by binding
  `127.0.0.1` (`__tests__/setupAfterEnv.js`), and the rest would mean replacing the
  session store, passport, multer, helmet, rate limiting and express-validator to gain
  little a route-access declaration (REARCH-04) does not. Not worth it at this size.
- **A single-page app, Redis, a managed queue, leaving Auth0.** Each changes hosting or
  cost. Postgres is already the queue.
- **One `team` table across all seasons.** See *Does doing 1 and then 2…* above.
