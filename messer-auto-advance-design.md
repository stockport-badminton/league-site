# Design: Messer draw auto-advance

**Goal:** when a messer result is approved, automatically place the winning team into
its next-round slot in the draw, instead of Neil editing the bracket by hand.

## 1. Where we are today

- The `messer` table stores one row per bracket slot:
  `id, "homeTeam", "awayTeam", "homeScore", "awayScore", "winningTeam", section, "drawPos"`.
- There is **no round / parent / next-match linkage** in the schema. The bracket
  *shape* lives entirely in the view geometry
  ([`views/messer-draw-a-section.ejs`](views/messer-draw-a-section.ejs)), which maps
  `drawPos` to a column using power-of-two math.
- Empty future-round slots are stored as real rows with both teams set to the
  **"No Team" placeholder (team id 52)** and are filled in **manually**.
- On approval, [`messer_result_approve`](controllers/messer-scorecard-controller.js)
  calls `updateMesserTable(messerId, {homeScore, awayScore, winningTeam})` — it records
  the score/winner of the match that was **just played**, but does nothing to the
  **next** round.

### Why we can't just compute the next slot from `drawPos`

The template lays a section's 16 slots out as columns of **2 / 8 / 4 / 2** matches,
which is not a clean single-elimination bracket, and the live data is irregular
(Alderley Park A currently appears in both `drawPos 2` and `drawPos 7`). Deriving
"winner of slot X goes to slot Y, home/away" from `drawPos` arithmetic would couple
advancement logic to a fragile view detail and would not survive a hand-seeded draw.
**We should store the bracket edges explicitly.**

## 2. Proposed schema change

Add three columns to `messer` (live season table only; frozen seasonal snapshots
like `messer20232024` stay as-is):

```sql
ALTER TABLE messer ADD COLUMN "round"       INTEGER;      -- 1 = first round, 2, 3, ... final
ALTER TABLE messer ADD COLUMN "nextDrawPos" INTEGER;      -- drawPos of the slot the winner feeds
ALTER TABLE messer ADD COLUMN "nextSlot"    VARCHAR(1);   -- 'H' or 'A' — which side of that slot
```

- A match with `nextDrawPos = NULL` is a **final** (nobody to advance to).
- `nextSlot` says whether this match's winner becomes the `homeTeam` or `awayTeam`
  of the downstream match.
- `round` is not strictly required for advancement, but makes the draw renderable
  and orderable without relying on template math, and lets us show "Round 2" labels.

This is self-documenting, works for any hand-seeded draw, and makes advancement a
one-line UPDATE.

## 3. Advancement flow

Hook into the existing approve path, right after `updateMesserTable(...)`:

```
on approve(match):
  winner = winningTeam                      # already computed
  if match.nextDrawPos is not null:
    next = SELECT * FROM messer
           WHERE section = match.section AND "drawPos" = match.nextDrawPos
    slotCol = match.nextSlot == 'H' ? "homeTeam" : "awayTeam"
    # only fill if empty/placeholder, unless it's a re-approval correcting the same slot
    UPDATE messer SET {slotCol} = winner WHERE id = next.id
```

New model method, e.g. `Fixture.advanceMesserWinner(match, winningTeam)`, keeps the
controller thin and mirrors the existing `updateMesserTable` style.

### Edge cases to decide

1. **Byes** — a match against "No Team" (52). Options: (a) auto-resolve byes at draw
   creation so the real team is pre-placed in the next round, or (b) leave as-is and
   let the results flow handle it. Recommend (a) — byes have no scorecard to approve.
2. **Corrections / re-approval** — if a result is later rejected or edited, the winner
   we pushed downstream may be wrong. Recommend: advancement **overwrites** the target
   slot with the current winner, but **refuses to overwrite** a slot whose downstream
   match already has an approved result (guard against clobbering a played next round;
   surface a warning to the admin instead).
3. **Handicaps auto-recompute** — good news: the view derives adjusted handicaps live
   from each team's static `team.handicap`, so simply writing the winning team id into
   the next slot is enough; nothing extra to store.
4. **Grand final (A winner vs B winner)** — **decided: manual for v1.** Auto-advance
   stays within each section; the A-vs-B final continues to be filled by hand (the
   hard-coded `99999` "Messer Finals" rows). Easy future extension: point each section
   final's `nextDrawPos` at a shared final row.

## 4. Populating the linkage — **decided: small admin UI**

The columns are easy; the real work is filling `round` / `nextDrawPos` / `nextSlot`
for each season's draw. **Decision: build a small admin "wire up the bracket" screen.**

Rationale: the draw is set up **once a year** (both A and B sections run
simultaneously), and Neil already hand-populates the slots each season, so a UI to set
each slot's parent fits the existing workflow and avoids re-deriving fragile geometry.

Design notes for the UI:

- Scope: per section (A and B), both edited in the same season setup.
- For each slot (`drawPos`), let the admin pick its **next slot** (dropdown of the
  section's later-round `drawPos` values) and **which side** ('H'/'A') the winner lands.
  `round` can be set explicitly or inferred from the chosen edges.
- Validation worth having: each downstream slot should be fed by exactly two upstream
  matches (one 'H', one 'A'); flag orphans and double-assignments so a mis-wire is
  caught at setup, not at approval time.
- Pair with the byes auto-resolve from §3.1 so "No Team" slots don't need a scorecard.
- Reuse the existing admin auth pattern (`superadmin` / `messeradmin`), same as the
  results-approval pages.

## 5. Rollout

1. Migration `007`: add the three columns (nullable, no constraint churn).
2. Backfill the **current** season's edges (via the chosen §4 option) and verify the
   existing irregular slots.
3. Add `Fixture.advanceMesserWinner()` and call it from `messer_result_approve`,
   behind the same idempotency guard we just added (so re-approval is a no-op).
4. Test end-to-end on one section before the next real result comes in.

## Open questions for Neil

1. Is each section a clean 16-slot single-elim bracket this season, or are there
   irregular byes/seedings I should treat as one-offs?
2. Do you want the **grand final** (A vs B winner) wired up too, or keep that manual?
3. Populate the bracket links via a **seed script** (B) or a small **admin UI** (A)?
