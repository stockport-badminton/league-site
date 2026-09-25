# HARD-39 — 68 fixtures from 2012–14 belong to two teams formed this season

**Severity:** low-medium, data · **Wave:** A · **Blocked by:** nothing
**Owns:** a reviewed write script under `scripts/`, `tools/audit/checks.js`,
`tools/local-db/seed-repairs.sql`
**Source:** found 25 Sep 2026 while fixing HARD-38. The local seed, which predates the reuse,
still had these fixtures as orphans.

## Why

Production's `fixture` table has **68 complete fixtures, 5 Oct 2012 – 23 Apr 2014**, whose
`homeTeam`/`awayTeam` is **56 or 57**. Those ids are now **Manor B** (club 55, division 10)
and **Featherforce B** (club 64, division 8), two live teams created for 2026/27. The
fixtures were played by **Astrazeneca E** (56) and **CAP B** (57), as the `team20122013` and
`team20132014` archives record.

So any page that lists a team's fixtures without a date bound credits Manor B and
Featherforce B with a season and a half of 2012 results, against clubs that may not exist
any more.

**How it happened.** Both teams were deleted before May 2026, which left their fixtures
orphaned. The MySQL→Postgres export (`migrations/data/002_data.sql`, 16 May) ran
`setval(pg_get_serial_sequence('"team"','id'), MAX(id))`. The highest surviving id was 55,
so the sequence went back **below ids that had already been used**. The next two teams
created were issued 56 and 57.

**Why nothing noticed.** HARD-11 surveyed orphans, and a reused id is not an orphan: every
fixture resolves, just to the wrong team. HARD-11 step 3 reports "0 unresolvable
references" and the migration 017 foreign key is satisfied, and both are true.
`--check orphan-team-refs` and `ghost-teams` cannot see it either. The HARD-11 survey
reinstated 58, the other id above 55, because it was still orphaned then; production's
sequence (`last_value` 59) had not reached it.

## Scope, measured 25 Sep 2026

- **Only teams.** On the May seed, no `game` player id, `game.fixture`, `player.team`,
  `player.club`, `team.club`, `team.venue` or `scorecardstore` team exceeds its table's
  `MAX(id)`, so none of those sequences could have re-issued a used id. The team sequence is
  now past every historical id, so **this cannot recur**.
- **No game rows** hang off the 68 fixtures (per-game records start later), so no player's
  history is affected. This is fixture and team history only.
- 56 and 57 also have 31 fixtures in 2026–27. Those are the real Manor B and Featherforce B,
  and they must not move.

## What to do

1. Insert Astrazeneca E and CAP B as **withdrawn** rows with new ids (HARD-11's convention:
   club 63, venue 0, NULL division, `withdrawnReason` naming this package).
2. Repoint the 68 fixtures: `homeTeam`/`awayTeam` 56 → new Astrazeneca E id, 57 → new CAP B
   id, **`WHERE date < '2015-01-01'`** in the write itself, so the 31 live fixtures cannot be
   touched. One transaction. Dry by default, `--apply` to write, and re-read the counts at
   the end (gotcha 2d).
3. Add a check to `tools/audit/checks.js` for a team whose fixtures span a gap of several
   seasons with nothing in between. A reused id looks like that, and it is the only signal
   left once the ids resolve.
4. Update `tools/local-db/seed-repairs.sql`, which gives 56/57 their 2012 names locally
   because the seed has neither new team, to use the ids production ends up with.

## Acceptance

- The 68 fixtures resolve to Astrazeneca E and CAP B, and Manor B / Featherforce B show
  2026–27 fixtures only.
- `--check all` is unchanged before and after, apart from the new check reading 0.
- `tools/local-db.sh load` still completes from nothing.

## Out of scope

- The `setval` pattern in other exports. There will not be another MySQL export, and the
  sequences are all past their historical ids.
