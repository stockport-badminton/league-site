# Calendar gap finder (cross-league)

Finds free nights and valid rearrangement dates for a club, combining **both**
leagues (Stockport + Tameside) into one view. A club's true availability is the
union of every fixture its teams play — home or away, in either league.

## Why it's needed

Clubs run multiple teams across both leagues and share players/venues, so finding
a night to move a rained-off or short-of-players match into means checking
commitments across two separate databases at once.

## Prerequisites

- Both connection strings in the repo-root `.env`: `DATABASE_URL` (Stockport) and
  `TAMESIDE_DATABASE_URL` (Tameside). Both read-only usage.
- Run from the repo root: `node tools/gap-finder/<script>.js`.

## Usage

```
node tools/gap-finder/dump.js          # pull + reconcile both DBs -> generated/data.json
node tools/gap-finder/gen-artifact.js  # build generated/gap-finder.html
```

Publish `generated/gap-finder.html` as a private Artifact (or open locally). It's a
read-only snapshot — re-run both scripts to refresh after fixtures change.

## How it works

- **Reconciliation:** clubs and venues are matched across the two leagues by
  normalised name (their numeric ids differ between the two Supabase projects).
- **Home night:** inferred per team from the most common weekday of its actual home
  fixtures (the free-text `matchDay` column is unreliable; Stockport has no
  structured night field).
- **Constraint model:**
  - **Hard (a date is invalid):** either team in the fixture is already playing that
    night, in either league.
  - **Soft (warnings, shown not blocked):** another team from the same club is out
    that night (common and usually fine — big clubs run several teams a night),
    an adjacent night (±1) has a club team out, the date isn't the home team's usual
    night, weekends, and holiday breaks (Xmas/Easter — dates approximate, not in DB).
- Candidate dates for a move centre on the home team's usual night (their venue
  booking); untick that filter in the UI to see other options.

## Two views

- **Move a match** — pick a club and one of its home matches, get a ranked list of
  valid alternative dates (clean first, then nearest to the original).
- **Club calendar** — mini month grids Sep–May showing every commitment across both
  leagues; blank nights are the gaps.

## Notes / possible phase 2

- Break periods are hard-coded approximations (no break table in either DB).
- Venue court-capacity is not enforced (data unreliable: `courtspace` is 1 for
  nearly every team; real court counts live in free-text `matchDay`).
- Snapshot only. A live in-app version (second read-only PG pool for Tameside) that
  ties into the existing `rearranging` fixture status would be the productionised
  form.
- `generated/` is git-ignored.
