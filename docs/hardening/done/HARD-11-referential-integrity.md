# HARD-11 — 2,132 fixtures point at teams that no longer exist

**Severity:** medium · **Wave:** B · **Blocked by:** nothing (but needs a decision from Neil first)
**Owns:** model queries across the app; no single file
**Sources:** found while building `tools/audit/checks.js`, 31 August 2026

## Why

There are **no foreign keys** on `fixture."homeTeam"` / `"awayTeam"`. 2,132 fixtures
reference team ids that are not in the `team` table, spread across every season:

```
2025: 32   2024: 52   2023: 69   2022: 119
2021: 40   2020: 142  2019: 237  2018: 233   …
```

This was found by accident: an integrity check written with `JOIN team` reported 2 of the
8 fixtures with impossible scores, because six of them reference deleted teams and the
inner join dropped them silently. That is precisely the failure CLAUDE.md documents as
"an INNER JOIN to something optional loses the whole page" — the bug that rendered 48
`/event/` pages as a two-byte body.

So the live question is not the orphan rows themselves. It is: **how many pages across
the site are silently dropping historical fixtures because they inner-join to `team`?**
Archive results, head-to-head records, player history and club pages are all candidates.

## What to do

1. **Survey first, fix second.** Find every query that joins `fixture` to `team` and
   classify it: does an orphaned reference drop a row the user should see?
   ```bash
   grep -rn 'JOIN team' models/ | grep -v 'LEFT JOIN'
   ```
2. Convert the ones that lose data to `LEFT JOIN` with a sensible fallback for the team
   name, the way `tools/audit/checks.js` does (`COALESCE(ht.name, '?#' || f."homeTeam")`).
3. **Then** decide what to do about the data, with Neil. The options are to resurrect the
   missing teams as withdrawn rows (keeps history readable), or accept the orphans and
   render them as "unknown team". Do not guess — 2,132 rows of league history is not a
   decision for an agent.
4. Once the data is settled, add the foreign key so it cannot recur. That will fail
   while orphans exist, which is the point.

## Acceptance criteria

- A written list of every affected query and whether it loses rows.
- Every query that loses rows converted, with a test proving a fixture with a missing
  team still renders.
- `node tools/dbq.js --check orphan-team-refs` unchanged by the code work (this package
  does not write data without a decision).

## Tests

For each converted query: a fixture whose `homeTeam` id does not exist still appears,
with a placeholder name rather than vanishing.

## Out of scope

- Writing to the fixture or team tables. That needs Neil's decision first.
- Adding foreign keys until the orphans are resolved.

---

# Survey and conversions, 14 Sep 2026 — steps 1 and 2 done, step 3 still open

## Step 1: every query that joins `fixture` to `team`, classified

Found with the grep this brief specifies. Seven sites. The question was *does an orphaned
reference drop a row the user should see*, and the answer turned out to be concentrated
almost entirely in one of them.

| Function | Serves | Loses rows? |
|---|---|---|
| `Player.getPlayerGameData` | a player's match history | **YES — 10,422 of 35,244 games, 677 of 904 players. Converted.** |
| `Fixture.getFixtureEventById` | `/event/:id` | Yes — the page returns no rows at all. **Left alone, see below** |
| `Fixture.getForSitemap` | `sitemap.xml` | 14 of 625 URLs in the 18-month window — but **correctly**, see below |
| `Fixture.getReminderRecipients` | fixture reminder emails | No — current season, and there are zero 2026 orphans |
| `Fixture.getFixturesForTeams` | resolving a submitted result | No — current season. Latent if a team is ever deleted mid-season |
| `Fixture.getMissingScorecardPhotos` | the photo chase list | No — recent drafts |
| `Fixture.listMesserScorecardsForApproval` | messer approvals | No — current |
| `Team.getMesser` | messer archive pages | No — joins `messer${season}` to `team${season}`, season-matched and self-consistent. Verified 0 orphans in both archives |

The orphans are entirely historical: 2025 is the newest year with any, and **2026 has
none**. The one known source that was still creating them — `rearrangeByTeamNames`
inserting fixtures with a NULL team — was closed in September. So every query over current
data is unaffected, and every query over history is not.

## Step 2: the conversion

`getPlayerGameData` only. Measured before and after against production:

```
Susan Forbes (id 623): played 716 rated games
  before: page showed 256
  after : page shows  716,  406 of them under a deleted team
```

`LEFT JOIN` on both sides with `COALESCE(…, 'Former team')` for the name. The team **rank**
is deliberately left NULL rather than coalesced: it feeds
`team.rank - teamrank AS "teamAdjustment"` and the view guards on `teamAdjustment > 0`, so
NULL renders no bracket. A substituted number would invent an adjustment that never
happened.

Guarded by `__tests__/unit/player-history-join.test.js` — a source check, because Jest has
no database here; the behavioural proof is the 256 → 716 above. Three of its four
assertions fail without the change.

**Half the deleted teams' names are still recoverable** from the season archives — 9 of the
19 orphaned team ids are in `team20212022`…`team20252026` (15 = Disley A, 21 = Bramhall
Village A, 34 = Macclesfield B). Not done, deliberately: reading them means hardcoding a
list of archive tables that goes stale the moment a new season is archived, with nothing to
catch it. Worth revisiting if a general "what was this team called" helper ever exists.

## Why the sitemap was left alone, and it is not an oversight

`getForSitemap` drops 14 URLs — and it is **right to**. Those fixtures' `/event/:id` pages
return no rows at all, because `getFixtureEventById` inner-joins both teams too. Fixing the
sitemap without fixing the event page would put 14 soft-404s into it, which the `seo` skill
forbids in terms: *only list URLs that answer 200 to an anonymous request*.

Making those pages render is a **decision, not a conversion**: should a fixture whose team
has been deleted have a public, indexable page? It renders with no venue, no division and
no club (all reached through `homeTeam`), which is thin content pointed at by a sitemap.
And it touches JSON-LD, which CLAUDE.md says to load the `seo` skill before going near.
That belongs with step 3.

## Steps 3 and 4 — still Neil's

Unchanged and still the blocking decision: resurrect the missing teams as withdrawn rows,
or accept the orphans and render them as "unknown team". Then the foreign key, which will
fail while orphans exist — the point of it.

`--check orphan-team-refs` is **2132, unchanged** — this pass wrote no fixture or team data,
as the acceptance criteria require.

**One related thing did get written**, and it is recorded in HARD-16: 34 players pointed at
a deleted team and were invisible to the player search. They are now parked on the No Club /
No Team sentinels. That is `player.team`, which this brief does not survey — it covers the
`fixture` side only.

---

# Steps 3 and 4, 14 Sep 2026 — **DONE**

## Step 3: the 19 teams reinstated

`--check orphan-team-refs`: **2132 → 0**.

Names: 9 recovered from the season archives, 9 identified by the league secretary from old
correspondence (Carrington A and B, CAP, GHAP, New Mills, Manor C, Bramhall Village B,
Disley D, Blue Triangle), and **58 left as "Unknown team"** — it ran 8 home fixtures across
2012-13 and has no game rows at all, so nothing names it.

The method that narrowed it is worth keeping: for each orphaned id, the players who turned
out for it and **which club those players belong to now**. It narrows but does not identify
— 11 and 17 looked like Shell because six of their players are at Shell today, and they
were Carrington.

Inserted as **withdrawn rows on club 63 with a NULL division** (HARD-10's convention, which
keeps them out of the league table and both audit checks, each of which JOINs division).
`venue = 0` matches the existing `No Team` sentinel; there is no venue with that id, so
`LEFT JOIN venue` yields NULL cleanly.

## Five queries had to learn about `withdrawn` first, and one was load-bearing

`findTeamIdsByName` builds `new Map(rows.map(r => [r.name, r.id]))`, which silently keeps
the **last** row for a duplicated key. Four of these names are already held by a live team,
because the club's team was deleted and re-created with a new id — Syddal Park B, Disley A,
Manor B, Mellor B. Without the filter, a rearrangement could resolve to the 2014 team and
write a fixture pointing at it: **a new orphan, created by the thing meant to stop them.**

The others: the roster's "Move to…" destination list (a captain could have moved a live
player onto a team that folded in 2014), the club picker's counts, the club page listing,
and `getReminderRecipients`. All latent before this — no team had `withdrawn` set, because
Parrswood C was withdrawn in real life rather than through the mechanism.

## Public pages: deliberately not granted

Owner's call. Reinstating would otherwise have given ~2,132 fixtures an `/event/` page,
rendering with no club, no division and no venue — all three reached through the team — and
put 14 of them in the sitemap. `getFixtureEventById` and `getForSitemap` both exclude
withdrawn teams, and **they have to agree**: a sitemap entry whose page does not render is a
soft 404. Verified after the write — `/event/` returns 0 rows for such a fixture, sitemap
holds 611 of 625.

## Step 4: the foreign keys

`migrations/017`, applied 14 Sep 2026. `fixture_home_team_fkey` and
`fixture_away_team_fkey`, both **NO ACTION**.

Not CASCADE, emphatically: that would delete the fixtures, and with them the game rows and
every player's record of having played them — far worse than the problem. SET NULL
recreates the same orphan under another name. **Failing is the behaviour that is wanted.**

Confirmed enforcing against production, inside a rolled-back transaction: deleting a team
that has fixtures now raises `violates foreign key constraint`. The loop is closed.

What that makes fail, deliberately: `DELETE /team/:id` (JWT-gated, `Team.deleteById`, no
usage in the whole retained log window). The correct action for a team that stops playing is
HARD-10's withdrawal flow, which keeps the row and therefore keeps the history readable.

## The rehearsals both earned their keep

- Migration 017 **failed locally, on purpose**: that seed still holds orphans, so the
  constraint refused. A database with orphans cannot take it — which is the rehearsal.
- The reinstatement script failed locally on `venue` being NOT NULL, because its column list
  had been written from the columns the query needed rather than the ones the table demands.
- And its in-transaction verification refused to commit against the local seed, which is two
  years old and holds two orphans production does not (56 and 57 are live there). The
  staleness guard working rather than papering over a partial fix.

## What this was actually worth

Not the 2,132 rows. `Player.getPlayerGameData` inner-joined both teams, so **10,422 of
35,244 game rows — 30% of everything ever recorded — were missing from players' history
pages**, across 677 of 904 players. One member had played 716 rated games and her page
showed 256. It now shows 716, every one with its real team name.

This sat in the backlog as "medium, dormant, suppressed by design" with a `TRACKED` baseline
collapsing it to one line in the weekly digest. That suppression was **correct about the
symptom and silent about the consequence**. Worth remembering the next time something is
tracked and stable: the baseline tracks the data, not what the data does to the pages.
