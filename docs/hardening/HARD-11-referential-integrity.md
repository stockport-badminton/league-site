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
