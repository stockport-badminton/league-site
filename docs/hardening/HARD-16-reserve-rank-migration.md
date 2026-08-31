# HARD-16 — Finish the reserve-rank migration

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `scripts/` (gitignored) and the database. **No application code.**
**Sources:** residual from HARD-09

## Why

`player.rank` encodes two things at once, per `(team, gender)`:

```
rank 1..N   nominated, in strength order
rank >= 99  reserve, in order (99 = first reserve, 100 = second, ...)
NULL        treated as nominated; gets a real rank on the next save
```

The sequential-reserve convention arrived with the July 2026 roster rewrite. Before it,
**every** reserve was written a flat `rank = 99`, which meant a captain could drag her
reserves into the right order and the save would appear to work and change nothing —
because there was no distinct rank to write. The rewrite fixed the code. It did not
migrate the data, because a team is normalised as a side effect of its next save
(`Roster.renumberGender`), and most teams have not been saved since.

As of 31 Aug 2026, after HARD-09's narrow pass:

```
162 players  on a shared rank = 99
 25 (team, gender) lists affected
```

Nothing looks wrong. Display position is recomputed from list order, so those teams read
1, 2, 3 in the editor exactly as they should. The bug only appears when a captain tries to
*reorder* her reserves — which is a thing she is invited to do, and which will silently
fail for 25 of the league's lists.

**`duplicate-ranks` cannot see this.** That check counts nominated collisions only, by
design, so `node tools/dbq.js --check all` reports zero while all 162 are sitting there.
That is worth knowing before trusting a green check as proof this is done.

## What to do

The work is one line of SQL widening and a re-run of a script that already exists.

1. `scripts/hard09-normalise-ranks.js` does exactly this job. Its `HAVING` clause was
   deliberately narrowed to nominated collisions and nulls:

   ```sql
   HAVING count(*) FILTER (WHERE p.rank IS NULL) > 0
       OR count(DISTINCT p.rank) FILTER (WHERE p.rank < ?)
            <> count(p.rank) FILTER (WHERE p.rank < ?)
   ```

   Drop the two `FILTER (WHERE p.rank < ?)` clauses and it covers reserves too. Read that
   script's header first — it explains why passing an empty `wanted` payload to
   `Roster.renumberGender` is safe *here specifically* and would not be in a save that
   changes someone's section.

2. Dry run. Expect roughly 25 lists and ~195 rows including the reserve sequencing.
3. `node tools/dbq.js --check all` before and after, pasted into the commit message.
4. Apply.

**Do not hand-write the UPDATE.** `Roster.renumberGender` is the code path the editor
uses and the one with tests behind it. Renumbering partially or client-side is what left
teams ranked 1, 2, 4, 6 in the first place.

## Acceptance criteria

- `SELECT count(*) FROM player p WHERE p.rank = 99 AND p.team <> 52 AND EXISTS (SELECT 1
  FROM player q WHERE q.team = p.team AND q.gender = p.gender AND q.rank = 99 AND q.id <>
  p.id)` returns **0**.
- No player changes section. A player nominated before the run is nominated after it, and
  the same is true of reserves — the run only sequences within a section.
- Nominated order within each list is unchanged.
- `--check all` no worse than before on every check.
- No application code changed.

## Tests

`models/roster.js` already has coverage for `renumberGender`; this package adds no code, so
there is nothing new to unit-test. The verification is the before/after query above plus
the dry run's own output, which prints every proposed change per player.

Worth doing once by hand as well: pick one affected team, open
`/manage-players/club-:club/edit`, drag a reserve up, save, refresh, and confirm the order
sticks. That is the behaviour this package exists to restore and no query proves it.

## Out of scope

- The nominated/reserve convention itself. It is documented in CLAUDE.md and is not in
  question here.
- Anything that changes who is nominated. This is a renumbering, not a selection.

## A caution about timing

Production data moves while you work: during HARD-09 the `duplicate-ranks` count went from
7 to 0 between two runs because the owner opened a roster and saved it, which normalised
that team exactly as designed. Re-read at apply time and keep the guard in the `WHERE`
clause of the write, so a list somebody has just saved is left alone rather than rewritten
from a stale read.
