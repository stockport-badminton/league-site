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

---

# Done, 14 Sep 2026

`scripts/hard16-normalise-reserve-ranks.js` (gitignored, so recorded here) — a copy of
HARD-09's script rather than an edit of it, so that package's deliberately narrow scope
stays on the record.

## Result

```
10 (team, gender) lists, 54 player ranks written

rows actually changed             : 54  ✓ matches what the run reported
players changing section          : 0   ✓
lists whose nominated order moved : 0   ✓
reserves still sharing rank 99    : 0   ✓ acceptance query, was 63
players left unranked             : 0
--check all                       : identical before and after
```

Verified against a full before/after snapshot of every ranked player, not just the
acceptance query — "no player changes section" and "nominated order unchanged" are
assertions about 582 rows and needed checking as such.

## The numbers in this brief were stale, and that is the expected behaviour

It said 162 players across 25 lists (31 Aug). It was **63 across 10** by the time this ran.
Nothing went wrong: a list normalises as a side effect of its next save, the season started,
and captains have been saving rosters. The brief's own *caution about timing* predicted
exactly this. Re-measure before quoting a figure from a package that has been sitting.

## It was two lines of SQL, not one

The brief said the work was "one line of SQL widening". Dropping the two
`FILTER (WHERE p.rank < 99)` clauses was the first. The second was not in the brief and the
package could not have been completed without it:

**The selection query inner-joined `team`.** 34 players point at a team id that no longer
exists, 20 of them on a shared rank 99 — so the inner join dropped them silently and the
acceptance query, which does not exclude deleted teams, could never have reached zero.
HARD-09's original had the same join and skipped them for the same reason. `club` was
already a `LEFT JOIN`, so it was an inconsistency as much as a bug. This is CLAUDE.md
gotcha 1c in a script rather than in a page, and `__tests__/unit/optional-join-guard.test.js`
cannot see it because `scripts/` is gitignored.

Found by rehearsing on the local database and checking the acceptance query afterwards
rather than trusting the run's own "54 written". The run was honest; the selection was not
complete.

## New finding, recorded rather than fixed

Those 34 players are **invisible to the player search**. `models/players.js:317` builds it
as `player JOIN team ON team.id = player.team` — inner — so for the three deleted teams
(34, 21, 15, holding 19 / 8 / 7 players) the search returns nothing. Demonstrated:
`SELECT count(*) FROM player JOIN team ON team.id = player.team WHERE player.team = 34`
returns **0** while the players plainly exist.

That is HARD-11's family — orphaned references with no foreign key — but for `player.team`
rather than `fixture."homeTeam"`, and HARD-11's brief only surveys the fixture side. Left
alone here per this package's *Out of scope*.

## Still worth doing by hand

The brief asks for it and no query proves it: open an affected club's
`/manage-players/club-:club/edit`, drag a reserve up, save, refresh, confirm the order
sticks. Affected clubs were Alderley Park, Disley, Dome, Macclesfield, Mellor and
Parrs Wood.

## Follow-on, same day: the 34 orphaned players were parked

The finding above did not stay a finding. Owner's call: move them onto the
**No Club / No Team sentinels** rather than chase the deleted teams.

`scripts/hard16b-park-orphaned-players.js` (gitignored), through `Roster.releasePlayer` —
the editor's own path, one transaction per player. It survives a deleted team because
`getPlayerOwner` uses `LEFT JOIN team`; that was checked rather than assumed, since an
inner join there would have thrown "No such player" for all 34.

```
all 34 now on club 63 / team 52 : ✓
players still on a deleted team : 0   ✓
those 34 found by the search now: 34  ✓ (was 0)
--check all                     : unchanged
```

**Fixing the search was the better half.** The tidying is cosmetic; 34 players being
absent from a search that says it lists players is not. Team 52 exists, so the inner join
reaches them.

Given up deliberately: the club association (Macclesfield for 19, Disley for 7 — team 21's
were already NULL) and 14 nominated ranks, all now reserves on the sentinel. That is what
"released" means here.

The cause — no foreign key on `player.team` — is untouched, and is HARD-11's.
