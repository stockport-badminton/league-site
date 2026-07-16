# Fixture import (handwritten grids → live table)

Tooling to turn the season's handwritten round-robin grids into an editable/approvable
set of fixtures, then publish the approved dates to the live `fixture` table.

Built for the 2026/27 import (Premier + Div 1/2/3, 272 fixtures). The `transcription.js`
in this folder is the worked 2026/27 example — replace its contents each season.

## Prerequisites

- The season's fixtures already exist as **placeholder rows** in `fixture` (one per
  home/away pairing, any sentinel date). This tool **updates dates on existing rows** —
  it does not insert. Confirm the skeleton exists before starting.
- `DATABASE_URL` set in the repo-root `.env`.
- Run every command **from the repo root**: `node scripts/fixture-import/<script>.js`.

## Workflow

1. **Dump the skeleton** — pull every pairing + its fixture id from the DB:
   ```
   node scripts/fixture-import/dump-skeleton.js
   ```
   → writes `generated/skeleton.json`. Note the division ids it prints; the
   transcription and publish guard are scoped to those.

2. **Transcribe the grids** — edit `transcription.js`: one block per division with an
   ordered `teamIds` array and a home×away `grid` of dates.
   Cell values: `"YYYY-MM-DD"` (confident) · `"...?"` (low-confidence, flagged amber) ·
   `""` (unreadable, flagged red) · `null` (diagonal). Rows = HOME, cols = AWAY.

3. **Build + validate** — merge transcription with the skeleton and run the checks
   (coverage, season window, weekday, team double-booking, both-legs clashes):
   ```
   node scripts/fixture-import/build-review.js
   ```
   → writes `generated/review-data.json` and prints a flag report.

4. **Generate the review page**:
   ```
   node scripts/fixture-import/gen-artifact.js
   ```
   → writes `generated/fixtures-review.html`. Publish it as a private Artifact (or open
   locally). Correct cells against the paper — edits **autosave to the browser**. When
   clean, **Copy JSON** / **Download JSON** the approved `{ fixtureId: "YYYY-MM-DD" }`.

5. **Publish** — dry-run first (default), then apply. Refuses on any blank/clash/
   out-of-season date; backs up current dates to `generated/` before writing:
   ```
   node scripts/fixture-import/publish-fixtures.js approved.json            # dry run
   node scripts/fixture-import/publish-fixtures.js approved.json --apply     # write
   ```

## Restore

Every `--apply` writes `generated/fixture-dates-backup-<timestamp>.json` (id + wall-clock
`ts` per row). To roll back: `UPDATE fixture SET date = ts WHERE id = id` for each row.

## Notes

- `fixture.date` is a `TIMESTAMP` (no tz). The publish script writes dates as the string
  `'YYYY-MM-DD 00:00:00'` and reads/compares via `to_char(...)` — this avoids the
  off-by-one you get from reading the column into a JS `Date`.
- Everything under `generated/` is git-ignored (regenerated per run).
