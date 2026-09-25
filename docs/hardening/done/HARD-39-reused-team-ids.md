# HARD-39 — ids that belong to two different teams, or two different people

**Severity:** low-medium, data · **Wave:** A · **Done 25 Sep 2026**
**Owns:** `scripts/hard39-player-116.js` (gitignored), `tools/local-db/seed-repairs.sql`
**Source:** found 25 Sep 2026 while fixing HARD-38. The local seed, which predates the reuse,
still had two of the fixtures below as orphans.

## What it looked like

Production's `fixture` table has 68 complete fixtures from 2012–14 whose `homeTeam` or
`awayTeam` is 56 or 57. Those ids are now **Manor B** and **Featherforce B**, two teams
formed for 2026/27. The fixtures were played by **Astrazeneca E** and **CAP B**. The May
MySQL→Postgres export ran `setval(..., MAX(id))`, which took the team sequence back to 55,
below ids that had already been used. The next two teams created were given 56 and 57.

## What it actually was

**Five team ids, not two, and the harm is none.** A gap check (a team whose fixtures stop
for two years or more, then start again) finds exactly these. The season archives name
both holders, and in every case the club changed too, so none is a rename:

| id | fixtures belong to | now |
|---|---|---|
| 51 | Alexandra (Alexandra), 2012–17 | Cheadle Hulme B (Cheadle Hulme) |
| 54 | Poynton B (Poynton), 2012–15 | College Green E (College Green) |
| 55 | Astrazeneca D (Alderley Park), 2012–14 | Featherforce A (Featherforce) |
| 56 | Astrazeneca E (Alderley Park), 2012–14 | Manor B (Manor) |
| 57 | CAP B (C.A.P.), 2012–14 | Featherforce B (Featherforce) |

51, 54 and 55 were reused **before** the May export, so the export is not the only cause.
The likely one is old InnoDB behaviour: before MySQL 8, AUTO_INCREMENT went back to MAX+1 on
every restart. Postgres sequences never go backwards, and the team sequence is now past
every historical id, so this cannot recur.

**Nothing was written for the teams, and nothing should be.** Past seasons are read through
the archive tables: `models/fixture.js` switches to `team${season}` for any season except
the current one, and so does `models/league.js`. Each archive holds the original team at the
old id (`team20122013` says 56 is Astrazeneca E). So every page for those seasons is correct
today. Pre-2018 fixtures have no game rows, so no player history goes through them either.

**The obvious fix would have broken that.** Moving the fixtures to new team ids drops them
out of the inner join to the archive, and those seasons' pages would lose them. The only
thing that reads them wrongly is a query that joins old fixtures to the *live* `team` table
with no date bound. If one is ever written, this table is the list of what it will
mislabel.

No gap check was added to `tools/audit/checks.js` either. It would report these five
accepted rows forever, and the thing it detects can no longer happen.

## The one that was real: player 116

The same kind of survey on players (every season archive against the live table) turned up
corrections and married names, and **one record that had become a different person**. In
2018/19, 116 was a second "John Paul" (Male, Disley D). By 2019/20 someone had edited that
record into **"Ellie Harper"** (Female, GHAP B), and its 48 men's and mixed games came with
it.

Games and fixture lineups are read through the **live** `player` table, archive pages
included (`models/fixture.js` joins `player homeMan1`). So those games were in Ellie
Harper's history and ELO, and she showed in eight 2018/19 lineups. She has another record,
839, with no games.

The owner identified who played them:

- **fixture 6** (Syddal Park A v B, 2 Dec 2018): **785 Rob Herriot**, 6 games
- **the other seven**, all Disley: **250 Jon Paul**, 42 games

**Applied to production 25 Sep 2026** by `scripts/hard39-player-116.js`, in one transaction,
after a local `--apply` rehearsal:

- 48 game cells and 8 lineup cells were updated.
- On re-reading, 116 has 0 games and 0 lineups, and no game holds one player twice.
- 250 went from 84 games to 126.
- `--check all` read 0 of 15 before and after.

The script refuses to run a second time, because the survey no longer matches.
`seed-repairs.sql` replays the same change, so a fresh local load agrees with production.

**Stored ELO was not recomputed**, by the owner's choice. `game.*Start` / `*End` for 116, 250
and 785, and for everyone they played afterwards, reflects the old attribution until the
next full backfill. See the `eloBackfillAll` note in the ELO memory: run it as a direct
script, not over HTTP.

## What was not done

- 116 is left as a duplicate Ellie Harper with no games. It is not merged with 839.
