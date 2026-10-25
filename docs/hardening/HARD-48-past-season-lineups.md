# HARD-48 — past-season lineups judged by where everyone plays now

**Severity:** medium (wrong information on a public page; fixtures missing from it) ·
**Wave:** A · **Blocked by:** nothing
**Owns:** `Fixture.getMatchPlayerOrderDetails` (`models/fixture.js`), the team notes in
`views/fixture-players.ejs` and `views/recentPlayerHistory.ejs`
**Source:** REARCH-02 (24–25 Oct 2026). Neil confirmed the live-player read was never a
design decision, and it was pulled forward from the 2027 re-architecture so that
REARCH-02 can be a pure refactor.

## Why

`/fixture-players/:season` shows who played in each fixture, in order, and colours a
player who turned out for a team other than their own (amber, with the team named) or who
had no rank (red). For a past season it joined fixtures to that season's team archive, but
took each player's **rank and team from the live `player` table**. So a past season was
judged by where everyone plays **now**.

Measured on production, 2024/25 fixtures against `player20242025`:

| | Lineup slots, of 2,993 |
|---|---|
| Player's team now differs from their team that season | **1,168** |
| Player's current team did not exist that season | **85, in 60 fixtures** |

The second row is worse than a wrong note. `Man1Team` and the rest were **inner joins**, so
when a player's current team id was not in that season's team archive, the fixture
vanished from the page without an error (gotcha 1c). In 2018/19 that removed almost the
whole season: 17 rows were shown, out of 724.

## What was done

- **Rank and team from the season's player archive**, falling back to the live row only
  for a player the archive does not hold (added or merged later — 3 in 2024/25). The
  current season is untouched: there, the "archive" is the live table.
- **The player-team joins are `LEFT JOIN`s.** A team that cannot be found leaves a blank,
  not a missing fixture. Both views now print `no team` there; before, that case could not
  reach them, and the string concatenation would have printed `null`.
- **Two archives needed exceptions, found by the snapshots and not by reading:**
  - `player20182019` has **no `rank` column** (the archives copy whatever columns `player`
    had that year). It gets its team from the archive and keeps the live rank, as before.
  - `player20192020` has the column but **587 of its 876 registered players are blank**,
    against 11 of 998 in 2021/22. Ranks were not really kept that season. A blank rank
    renders red ("not nominated"), so reading it would have turned 549 slots red for a
    record nobody kept. The rule is data-driven: an archive that ranks fewer than half its
    registered players keeps the live rank. The archives are frozen once their season ends,
    so the rule cannot drift.
- **Names stay live** — a corrected spelling or a married name shows everywhere. Whether
  past lineups should show the name used that season is left to REARCH-02 (6 players in
  2024/25, and the archives carry 298 untrimmed names that would need trimming first).

## How it was proved

Jest cannot run this SQL, so it was proved by snapshotting the function for **every
season** on production and on the local database, before and after, and classifying each
difference (scripts kept with the session, not in the repo):

| Season | Rows before → after | Rows changed | Of those, changes outside team/rank |
|---|---|---|---|
| 2018/19 | 17 → 724 | 9 | 0 |
| 2019/20 | 467 → 556 | 460 | 0 |
| 2021/22 | 509 → 587 | 503 | 0 |
| 2022/23 | 434 → 500 | 433 | 0 |
| 2023/24 | 412 → 481 | 404 | 0 |
| 2024/25 | 429 → 483 | 417 | 0 |
| 2025/26 | 434 → 466 | 414 | 0 |
| **2026/27 (current)** | **80 → 80** | **0** | **0 — identical** |

No row was lost, and every changed field was a player's team name or rank. (A row is one
fixture from one side, so a fixture has two.) The same held on the local database.

What a reader sees change, on production:

| Season | False off-team notes removed | Notes added | Ranks newly blank |
|---|---|---|---|
| 2019/20 | 1,873 | 47 | 0 |
| 2024/25 | 845 | 27 | 40 |
| 2025/26 | 514 | 39 | 37 |

The added notes are players who really did turn out for another team that season. The
newly blank ranks are players with no rank that season, which is what red is for.

## Tests

- `__tests__/unit/fixture-players-season.test.js` — which source the query is built to
  read for each shape of archive production actually holds: rank recorded, no rank column
  (2018/19), rank mostly blank (2019/20), no archive, current season. LEFT JOIN for each
  slot. **6 of 6 fail with the fix stashed.**
- `__tests__/integration/fixture-players-no-team.test.js` — real render of
  `/fixture-players/20242025` with a blank team: the row is kept and says `no team`, not
  `null`. **1 of 2 fails with the fix stashed.** The other (naming another team) is
  unchanged behaviour, kept as the control.

## Out of scope

- Names as they were that season (REARCH-02).
- The other inner joins in the same query: `JOIN player homeMan1` drops a fixture whose
  lineup has a missing player id, in every season, current included. Not measured here;
  worth its own look.
- `newGetPlayerStats` / `newGetPairStats` already read `player${season}`. They inner-join
  it, so the 3 players a season's archive lacks drop out of that season's stats. Small,
  and REARCH-02's history tables are where it belongs.
