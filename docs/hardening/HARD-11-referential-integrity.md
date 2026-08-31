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
