-- Add explicit bracket-linkage columns to the messer draw so that approving a
-- result can auto-advance the winner into its next-round slot, instead of the
-- bracket being wired up implicitly by the view geometry and filled by hand.
--
--   round        1 = first round, 2, 3, ... (final = highest round in the section)
--   nextDrawPos  the drawPos (within the same section) the winner feeds into;
--                NULL for a section final (nobody to advance to)
--   nextSlot     'H' or 'A' — which side of the next match the winner becomes
--
-- These are populated per season via the admin "wire up the bracket" screen
-- (/admin/messer-bracket). Frozen seasonal snapshots (messer20232024, ...) are
-- intentionally left untouched.

ALTER TABLE messer ADD COLUMN IF NOT EXISTS "round"       INTEGER;
ALTER TABLE messer ADD COLUMN IF NOT EXISTS "nextDrawPos" INTEGER;
ALTER TABLE messer ADD COLUMN IF NOT EXISTS "nextSlot"    VARCHAR(1)
  CHECK ("nextSlot" IN ('H', 'A'));
