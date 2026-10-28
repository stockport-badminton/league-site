# REARCH-02 — season archives become one history table per entity

**Size:** M · **Window:** additive steps any time; dropping the old tables is off-season,
after the June/July 2027 rollover
**Blocked by:** REARCH-08's snapshot harness. Soft: REARCH-01's infrastructure (so the 14
rewrites are typed), HARD-32 (so it is recorded which databases have the new tables).
**Owns:** the 14 season-switched model functions (listed in the folder README),
`models/season.js` (`getAll`, `isServable`, `loadServable`), `tools/local-db/sync.js`'s
archive handling, one migration, a new `tools/season-archive.js`, one audit check.
**Source:** the 24 Oct 2026 "build it from scratch" review.

## What the archives are

Read this before designing anything, because the obvious reading is wrong.

**`fixture`, `game` and `scorecardstore` already hold every season.** A past season's page
finds its fixtures by joining `season` on a date range. Nothing about results is archived.

What is archived is the **dimension tables**: `team`, `club`, `division`, `player`, `venue`
and `messer` (the draw). At the end of each season a copy of each is taken as
`<table><season>` — `team20252026`, `player20242025`. A page for a past season joins its
fixtures to *that season's* copy, so it shows the team names, clubs, divisions and squads as
they were.

That is correct, and HARD-39 shows it is load-bearing: team ids 51, 54, 55, 56 and 57 each
belong to one team in 2012–17 and a different one now, and the old pages are right only
because they read the archive. **Keep the idea; change the representation.**

Current-season queries read the live tables directly. Not changed here.

**Past-season lineups are the exception, and this package changes them.** They are read
from the *live* `player` table even on archive pages (`models/fixture.js` joins
`player homeMan1`). HARD-39 described that as deliberate. It was not: Neil confirmed on
25 Oct 2026 that it is how the first rollover happened to be written. It is wrong in a way
you can measure — see *Part 2* below.

## Why

The one-table-per-season representation costs, each recorded somewhere already:

- **The season is spliced into SQL as a table name** — about 60 interpolations in the 14
  functions. A table name cannot be a bound parameter, so the only defence is
  `season.assertName` (11 call sites). Before it existed,
  `/tables/All/20252026%20AS%20team%20WHERE%20false%20--` reached the parser as SQL.
- **Every one of the 14 branches** on "current season → live table, else archive". Two code
  paths per page, the past-season one exercised mostly by Google (HARD-45: 296 of 309
  requests).
- **Which seasons exist is answered from `information_schema`** (`season.getAll`), and a
  well-formed season with no archive used to 500 as `relation "team20252027" does not exist`
  (NODE-Q) until `isServable` was added.
- **Local sync has to create tables.** The first sync of 2026/27 made 2025/26 "previous",
  and seven browser tests failed because nothing locally had created its archives
  (22 Oct 2026). `sync.js` now reads DDL from production to make them.
- **HARD-11 left 19 orphaned team ids unresolved** because resolving them "means hardcoding
  a list of archive tables that goes stale the moment a new season is archived".
- **Archives drift from the live schema.** Each is a copy of the columns that existed that
  year; nothing keeps them in step.
- **The player archives hold contact details.** `player20252026` has 1,094 rows with
  encrypted `playerEmail` and `playerTel`, and so do the other player archives back to
  2018/19. Nothing found reads them (checked 24 Oct 2026). They are contact details kept
  for years for no purpose, and they would also need re-encrypting in any `DB_PI_KEY`
  rotation (HARD-31).
- **The rollover itself is not in the repository.** It is a function stored in production,
  `public.clone_season`, which is run by hand. See *How the rollover is done today*,
  below.
- **The archives have no primary key and no indexes.** `CREATE TABLE … AS TABLE` copies
  columns and rows and nothing else. `team` has `team_pkey` and a check constraint;
  `team20252026` has neither, and the same is true of `player20252026`. Every past-season
  join is to an unindexed table. HARD-45 measured that as fast enough at this size, but
  nothing would stop a duplicate id.
- **A typed query builder cannot type `` `team${season}` ``** (the link to REARCH-01).

## How the rollover is done today

Recorded 25 Oct 2026, from Neil and read back from production with `dbq`.

`public.clone_season(p_suffix text, p_tables text[] DEFAULT ARRAY['club', 'division',
'messer', 'player', 'team', 'venue'])` is a plpgsql function that lives in the database,
not the repository. It is run by hand with the new suffix (`select
clone_season('20252026')`). For each table it:

1. runs `create table public.<table><suffix> as table public.<table>` **only if the
   archive does not exist yet**;
2. turns on RLS on the archive if the source has it;
3. drops every policy on the archive and recreates the source's policies verbatim from
   `pg_policies`.

What follows from that, for the replacement:

- **A second run does not refresh the data.** If the archive already exists, the function
  prints `table % exists, syncing RLS only` and copies no rows. So the snapshot is whatever
  the live tables held at the moment of the *first* run. If that run comes after anyone has
  begun editing teams and divisions for the new season, the old season's pages show the
  new season's names forever. Nothing records when it ran. The replacement keeps the
  refuse-if-exists guard, and also writes the time it ran and the row counts somewhere the
  audit check can read them.
- **Half the function exists to copy RLS policies onto each new table.** With one history
  table per entity, created once by a migration with its policy, that half has nothing to
  do.
- **The archives get no keys or indexes** (above). History tables get `PRIMARY KEY (season,
  id)` from the migration.
- **`EXECUTE` is granted to `PUBLIC`, `anon` and `authenticated`.** It is `SECURITY
  INVOKER` and the Data API is off, so nothing can reach it today. But it is a function that
  creates tables, in the schema PostgREST would expose, granted to the roles the CLAUDE.md
  RLS section says should hold nothing. Drop it at step 8. If it is kept, revoke those
  grants.
- **The table list is a default argument**, which is why `venue` archives start in 2021/22
  and `messer` in 2023/24: the list grew over time. A history table backfilled from those
  starts at the same seasons.

## Design

**One history table per archived entity, keyed by `(season, id)`:**

```
team_season     (season, id, name, club, division, … )      PK (season, id)
club_season     (season, id, name, "matchSec", … )
division_season (season, id, name, league, … )
player_season   (season, id, first_name, family_name, gender, team, club, rank, … )
venue_season    (season, id, … )
messer_season   (season, id, "homeTeam", "awayTeam", "homeScore", … )
```

- Columns are the union of what the archives hold. A column an older archive lacks is NULL
  there.
- **`season` is the season name** (`20242025`), a foreign key to `season.name`, so
  "which seasons have history" is a plain query.
- **No contact columns in `player_season`.** `playerEmail`, `playerTel` and `authEmail`
  are not copied. This is the one deliberate content change, and it is invisible: nothing
  reads them. Confirm that again at step 4 before relying on it.
- **Live tables untouched.** `team` is still "teams now", and every current-season query
  stays exactly as it is.

**One view per entity that also labels the live rows with the current season:**

```sql
CREATE VIEW team_at AS
  SELECT season, id, name, club, division, … FROM team_season
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now()
          ORDER BY "startDate" DESC LIMIT 1), id, name, club, division, … FROM team;
```

With that, every season-aware query has **one shape** whatever the season:

```sql
JOIN team_at t ON t.id = f."homeTeam" AND t.season = ?
```

The current/past branch disappears from all 14 functions, the season is a bound parameter,
and `assertName` stops guarding SQL text (it can remain as input validation: a malformed
season is still a 404). Postgres pushes the `season = ?` predicate into both arms of a
`UNION ALL`, so a past-season query does not scan `team`; check with `EXPLAIN` on the
heaviest function (`newGetPairStats`) before relying on it.

**A skew to know about:** `season.current()` is cached per process from startup
(`season.init`). For a few hours after a rollover, an instance started before it can
disagree with the view about which season is "current". The same skew exists today. Passing
the season explicitly from the controller everywhere means a query never asks the view
"which season is current" implicitly.

## Part 2 — past-season lineups read the season they were played in

> **Closed 28 Oct 2026. Names stay live (Neil's call).** Team and rank already read
> history (HARD-48, then step 4 on `player_at`, proved identical). In production no
> past-season lineup fixture is dropped any more: every season, 2018/19 to 2025/26, has all
> 12 players and both teams for every lineup. That leaves names, measured on production the
> same day. Of the lineup slots whose name in history differs from today's, most differ
> only by spacing or case (777 in 2025/26, 670 in 2024/25). The real changes are 6–20
> players a season (182 slots at most, in 2018/19), and they are mostly
> *corrections*: "Wahab Siddiqui" → "Siddiqi", "Aneiron Ankers" → "Aneirin Ankrett",
> "M. Isaacs" → "Marion Isaacs", "Jason H" → "Jason Hanford". Married names are already in
> today's record as "Lisa Shaw (nee Hunter)". Reading history would put the typos back on
> old pages, so the name-trimming below is moot too.
> One change was made: the lineup query's inner joins to the live `player` became LEFT
> joins, with history's name used when the live row is gone (deleted or merged). Today
> that rescues nothing in production. On the local database it brought back 52 fixtures
> whose players the seed lacks, and lost none; 26 of 31 snapshot cases were identical, and
> one was tied rows in another order. A fixture with an empty slot still stays off the page.
> Tests are in `season-history-readers.test.js`. The *Design* and *Proof* below are kept
> as the record of what was planned.

> **Mostly done early, as [HARD-48](../done/HARD-48-past-season-lineups.md) (25 Oct 2026).**
> `getMatchPlayerOrderDetails` now reads rank and team from `player${season}`, with a
> live fallback and LEFT joins. What is left here is **names**, plus moving that
> function from `player${season}` to `player_at`. That move should now be a pure,
> snapshot-identical refactor like the rest of step 4. Watch for two archive quirks HARD-48
> found and coded around: `player20182019` has no `rank` column, and `player20192020`
> leaves 587 of 876 ranks blank. The reader must keep HARD-48's rule (an archive
> ranking fewer than half its registered players keeps the live rank), computed over
> `player_season`, or the move will not be identical. The backfill copies ranks as they
> are (decided 28 Oct 2026; see step 3).

### What is wrong today — measured 25 Oct 2026, 2024/25 fixtures against `player20242025`

| | Lineup slots (of 2,993) | |
|---|---|---|
| The player's **team now** differs from their team that season | **1,168** | `/fixture-players/:season` flags a player as playing for a team other than their own using the team they are on **now**. So past seasons show "played up/down" notes that were never true, and miss ones that were |
| The player's team now **does not exist** in that season's archive | **85**, in 60 fixtures | `getMatchPlayerOrderDetails` **inner-joins** that id to `team${season}`, so those fixtures drop off the page with no error (gotcha 1c) |
| A real name change (spelling or married name; ignoring case and whitespace) | 69, for 6 players | A past lineup shows the name used now |
| The player is not in that season's archive at all | 3 players | Added or merged later; has to fall back to live |

There is also one person-shaped error: HARD-39's player 116, whose 2018/19 games appear in
another person's lineups.

### Design

On a page that is **about a season** (`/results/:division/:season`,
`/fixture-players/:season`, `/tables/…/:season`, and the per-season player and pair stats),
a player is resolved through `player_at` for that season. That gives their name **and
their team as they were then**:

```sql
LEFT JOIN player_at h ON h.id = f."homeMan1" AND h.season = ?
LEFT JOIN player     p ON p.id = f."homeMan1"
-- name: COALESCE(h.first_name, p.first_name) …   team: COALESCE(h.team, p.team)
```

- **`LEFT JOIN` with a fall back to live**, because of the 3 players with no history row.
  An inner join here is the gotcha 1c bug again.
- **Trim names, in this part rather than the backfill.** The live table was cleaned (3
  untrimmed names left), but the 2024/25 archive still has **298**. Reading them as they
  are would bring stray-space names back onto every old page. The backfill copies them
  exactly (step 3), so the trim is one of the differences this part explains.
- **A page about a person keeps the person's name live, but not the team.**
  `getPlayerGameData` and `getPlayerEloTimeSeries` show one person across every season, so
  their name is what they are called now. **Decided 25 Oct 2026:** a game-history row
  shows that game's team as it was that season. So `getPlayerGameData` is in this
  package's set (a fifteenth function) and REARCH-01 skips it.
  **Done early, the same day, on the current shape.** It matches each fixture to a season
  by date and reads that season's `team${season}` / `player${season}` through a
  `UNION ALL` built from `information_schema` (not a list), falling back to live and then
  to 'Former team'; the "(+N)" bracket compares the player's own team that season. On
  production 15,152 of 141,212 history rows changed team name and the bracket went from
  40,778 rows to 11,778; nothing was lost and the current season was identical. What is
  left here is replacing those two unions with `team_season` / `player_at`, which should
  be snapshot-identical. Pinned by `__tests__/unit/player-history-season.test.js`.
- Draft scorecards (`getScorecardDataById`, `getMesserScorecardById`) are viewed within the
  season they are filed in. They are not changed.

### Proof

Unlike the rest of this package, this part **changes output on purpose**, so "snapshot
identical" is not the test. Instead:

- Snapshot every affected function for every season, before and after.
- **Every difference must be explained** by one of the four rows in the table above. A
  script classifies each difference and reports any it cannot classify. An unclassified
  difference is a bug.
- `/fixture-players/20242025` renders the 60 fixtures it drops today.

## What to do

1. ~~Write the rollover down first~~ — done 25 Oct 2026; see *How the rollover is done
   today*. **Run `clone_season` for 2026/27 as normal**: the June/July 2027 rollover is the
   last one by the old method if step 6 is not ready, and the backfill picks it up either
   way.
2. **Migration: create the six history tables and the six views.** Additive. Follow the
   RLS convention every table has (`enable-rls-policies.sql`, migrations 023/024), or the
   Supabase advisor starts reporting again.
   **Written 28 Oct 2026: migration 030.** Each history table holds the union of the
   archives' columns *and* the live table's, in the live types. Without the live columns,
   the next rollover would drop `team.withdrawn*` and messer's bracket links. The
   exceptions are contact and login details, plus `player.role`/`messerAdmin`. The
   archive-only officer pointers are kept as history. The views take the current season
   from the live table and ignore history rows for it. That way, a snapshot taken before
   the next season's `startDate` cannot appear twice.
   A unique index on `season.name` carries the reference. `__tests__/db/season-history.test.js`
   fails when a new live column is in neither the history table nor its exclusion list.
3. **Backfill: a script, not the migration.** `tools/local-db.sh load` applies every
   migration *before* it loads `002_data.sql`, so a backfill written into the migration
   would copy empty archives on every local load. A reviewed script in the shape
   CLAUDE.md asks for: dry by default, `--apply` to write, one transaction, and **verified
   by `EXCEPT` both ways per archive** (archive minus history, history minus archive, both
   zero rows, excluding the contact columns), printing counts per table. Run it locally,
   then production. The local load gains the same step after `seed-repairs.sql`.
   **Written 28 Oct 2026: `tools/season-history-backfill.js`.** It lives in `tools/`, not
   `scripts/`, because the local load runs it. Production dry run, 28 Oct: all 54
   archives exact, 7,647 rows.
   **It is a faithful copy, and that departs from this brief.** Two things the brief
   asked the backfill to do now belong to the readers:
   - **HARD-48's rank rule.** Baking the live rank in would record today's rank as
     2019/20's, and the copy could no longer be proved exact. Step 4's reader applies the
     rule over `player_season`, which still has the 2018/19 NULLs and the 2019/20 blanks
     to count.
   - **Trimming names.** That is a visible change, so it goes in Part 2's commit, with
     the other differences explained there.

   The load also had to learn something new. The seed still `INSERT`s the officer
   pointers migration 029 dropped, so `load` had failed since 27 Oct. It now adds the
   three columns back for the seed and drops them after `seed-repairs.sql`.
   ~~Until step 5, a `sync` that creates a new archive leaves its history empty.~~ Since
   step 5 the sync copies history rows itself.
4. **Switch the 14 functions one at a time**, each proven identical with the snapshot
   harness (REARCH-08) **for every season that has history**, not a sample — the data is
   the same, so the output must be. Then render `/tables/:division/:season` and
   `/results/:division/:season` for every season before and after, and compare the HTML.
   **Keep this step and Part 2 in separate commits.** First move each function to history
   with identical output, then change the lineup resolution with explained differences.
   Done in one commit, a regression cannot be told apart from an intended change.
   **Done 28 Oct 2026.** There were 13 functions, not 14 (the fourteenth was
   `season.getAll`, which is step 5). Two of them had no caller. `getClubFixtureDetails`
   was deleted. `getAllLeagueTablesWithTopBottomDetails` had never been called since it
   arrived in May 2026; at Neil's call it became `League.getRunIn` (current season only)
   plus `utils/leagueRunIn.js`, behind a new superadmin page, `/admin/league-run-in`. That
   page marks the top two and bottom two of each division and says which places are already
   certain.
   `getMesser`, `existsInSeason` and `getSeasonRanks` are on Kysely now. The rest stay
   string queries with the season bound, through `WITH teamThen AS (SELECT * FROM team_at
   WHERE season = ?)`-style CTEs. HARD-48's rank rule is now counted over `player_at`.
   Every reader uses the views for the current season too, so the current/past branch is
   gone. The withdrawn filter now keys on "the season is the current one", not on "no
   season was passed".
   **Proof.** All eleven survivors were snapshotted on the local database, before and
   after, against every season with history, plus 20202021, the current season by name and
   the current season by omission: 438 cases. The argument files are in
   `rearch-02-snapshots/`. The results (37 MB) are gitignored, and the folder's README
   says how to retake them. Every case is one of four things:
   - **Identical.**
   - **The same rows in another order, where the order was never defined.** Teams tied on
     games won (`/tables`, in 2015/16, 2017/18, 2018/19 and 2019/20 locally); one team's
     two fixtures on the same night (`/fixture-players`); tied pair stats; and the messer
     draw, which had no `ORDER BY` and is now ordered by id (the page keys rows by
     `drawPos`, and no draw has a duplicate, locally or in production). Neil's call, 28 Oct:
     ship as is, with no tie-break rules.
   - **The unread `string_agg` column** of `newGetPlayerStats`, in another order.
   - **An error that is now a result**, each because history has a row or a column the
     archive lacked. Messer before 2023/24 is now an empty draw. Player and pair stats
     before 2018/19 are now empty. 2018/19 now gets a NULL rank in `getNamesClubsTeams`,
     where the `rank` column was missing. `junior` filters work on old seasons. 2020/21 now
     gives no rows. The current season requested by name, which said `relation
     "team20262027" does not exist`, now gives the live rows.
   Rendered HTML was compared too: a server from HEAD against one from the working tree,
   245 URLs (`/tables`, `/results`, `/results-grid`, `/fixture-players`, player and pair
   stats, messer draws, and the table image, for every season). The only status changes
   were 500 → 200, the ones above. Every body difference was a timestamp, or the same lines
   in another order. Speed: with JIT off, as in production, past-season pair stats take
   22 ms both before and after. The local Postgres has JIT on, which adds about 115 ms
   to the new plan and made it look slower than it is.
   **Tests.** Behaviour is in `__tests__/db/season-history-readers.test.js` (18 tests;
   breaking the current-season exclusion fails it). The mocked tests that read table
   names out of SQL went: `unit/fixture-players-season`, the table half of
   `unit/league-withdrawal`, and parts of three others. `unit/no-season-table-names.test.js`
   covers `models/` and `controllers/`. `tools/` joins it at steps 5 and 8.
5. **Switch the readers of "which seasons exist":** `season.getAll` and `loadServable` query
   `team_season`; `sync.js` copies history rows instead of creating tables (and stops
   reading DDL from production).
   **Done 28 Oct 2026.** `getAll` is a Kysely query: seasons with a `team_season` row,
   newest first. `loadServable` builds on it, and so it follows. `season.js` no longer
   reads `information_schema` and no longer needs `db_connect`. Production gives the
   same 13 seasons either way (2020/21 and the current season have neither archive nor
   history), so the History nav, the season filter, the sitemap and the 404 guard are
   unchanged. `sync.js` now treats the six history tables like any other table: it upserts
   every row on `(season, id)` (7,647 in production) and creates no tables. Archives
   already present locally are left alone, since only the backfill reads them. That ends
   the step 3 caveat: after a sync, the backfill does not need re-running.
   `tools/local-db/` joins `no-season-table-names.test.js`. The test in
   `__tests__/db/season-history-readers.test.js` deletes one season's history and drops
   another's archive, and it fails against the old `getAll`.
6. **`tools/season-archive.js` — the rollover, in the repository.** `INSERT INTO
   team_season SELECT '<season>', … FROM team` for all six, in one transaction. Dry by
   default; refuses if that season already has rows; ends by re-reading the counts it
   wrote (gotcha 2d). Add an audit check, `season-history`: if the previous season has no
   history rows a week after the current season starts, the digest says so — a rollover
   that did not happen raises no error otherwise, the HARD-35 lesson.
   **Done 28 Oct 2026.** `node tools/season-archive.js <season> [--apply] [--prod]`.
   The season is named, not worked out. It must be the current season, because only that
   season's rows are in the live tables. Once the next season has started it refuses
   unless given `--late`, since by then the live tables may already hold the next
   season's teams. It refuses if the season already has a run recorded, or any history
   row (the backfilled seasons). It also refuses if a live column has no place in its
   history table and is not in the backfill's `NOT_KEPT`. It warns, but does not refuse,
   when the season still has unplayed fixtures. The column list is the live table's minus
   `NOT_KEPT`, so there is no hand-kept list. Each table is verified by `EXCEPT` both ways
   and by count.
   **The record of a run is a new table, `season_archive_run`** (migration 031:
   season PK → `season.name`, `ran_at`, `ran_by`, `row_counts` jsonb). It is written in
   the same transaction, so a second run of a season fails on the key too. Neil asked
   about `schema_migrations` for this. It isn't used, because that table is keyed by
   migration filename and hash, its `how` CHECK allows three values, and `--status` would
   report each rollover as a missing file. The `season-history` check reads history rows,
   not run rows: the backfilled seasons have history but no run row. It is quiet in
   production today. Tests: `__tests__/db/season-archive.test.js` (11), with every guard
   broken in turn to see its test fail.
7. **The June/July 2027 rollover is done with the script.** For one season, also take the
   old-style archive by hand, so that if anything is wrong there is the familiar copy to
   compare against.
8. **Drop the archive tables** in a later migration, after one season in which nothing has
   read them. The irreversible step, so it is last. Local load: `001_initial.sql` still
   creates them and `002_data.sql` fills them; the drop migration runs after both only if
   the load order is changed, so either keep the archives locally until the seed is
   regenerated from history, or have the backfill step drop them. Decide when you get
   there.

## Window

Steps 1–3 any time; additive and unread. Step 4 is in-season OK — inert by proof, and the
pages concerned are past seasons. Step 6 must exist **before the 2027 rollover**. Step 8 is
off-season and not before Sep 2028 by the one-season rule.

## Acceptance criteria

- No table name is built from a season anywhere in `models/`, `controllers/` or `tools/`;
  a test fails if one reappears (match `` `(team|club|division|player|venue|messer)${ ``).
- `information_schema` is not read by `season.js`.
- Snapshot pairs identical for all 14 functions over every season; rendered HTML identical
  for the tables and results pages of every season.
- `sync.js` creates no tables.
- The rollover is `tools/season-archive.js`, and the `season-history` check fails when it
  has not been run (a test that removes the rows and sees the finding).
- No contact column in any history table.
- ~~Part 2: every before/after difference in a past-season lineup is classified by the
  script, with none unclassified, and `/fixture-players/20242025` shows the 60 fixtures it
  drops today.~~ Closed with names live; the 60 fixtures show since HARD-48.
- `clone_season` dropped, or its grants to `PUBLIC`/`anon`/`authenticated` revoked.
- `--check all` the same before and after.
- Cost: none. The same rows in fewer tables; views cost nothing.

## Out of scope

- Making team identity persistent across reused ids (HARD-39 decided the archives handle
  it, and history inherits that).
- Re-attributing player 116's 2018/19 games (HARD-39). Part 2 will show the 2018/19 name in
  that season's lineups, but the game rows are not moved.
- The 19 orphaned ids HARD-11 left. Worth revisiting once history exists, since the reason
  it was refused goes away; a separate package.
- One `team` table across all seasons — see the folder README for why not.
