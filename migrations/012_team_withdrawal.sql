-- HARD-10 -- withdrawing a team mid-season.
--
-- A team that folds had nowhere to go. /admin/teams could create, edit, promote and
-- relegate a team but not withdraw one, so a defunct team stayed in its division,
-- rendered in the league table as a row of zeros, and stayed on the annual invoice
-- until somebody remembered. Parrswood C was in exactly that state in August 2026 and
-- was withdrawn by hand, by moving its players onto the No Club / No Team sentinels.
--
-- Deleting the team row is not an option. `fixture` has no foreign keys and 2,132 rows
-- already point at team ids that no longer exist (HARD-11), so a delete would add to
-- that number. The team row stays and its division is cleared instead.
--
-- `division` therefore loses NOT NULL. Clearing it is what removes the team from the
-- league table and from the ghost-teams and short-squads integrity checks, all three of
-- which INNER JOIN division.
ALTER TABLE team ALTER COLUMN division DROP NOT NULL;

-- What makes the operation reversible. "withdrawnDivision" is where the team came from,
-- so Reinstate can put it back, and "withdrawnFixtures" is the exact set of fixture ids
-- this withdrawal voided -- without it, Reinstate could not tell them apart from the 114
-- fixtures voided for unrelated reasons during HARD-09 and would resurrect those too.
ALTER TABLE team ADD COLUMN IF NOT EXISTS withdrawn TIMESTAMP;
ALTER TABLE team ADD COLUMN IF NOT EXISTS "withdrawnDivision" INTEGER;
ALTER TABLE team ADD COLUMN IF NOT EXISTS "withdrawnReason" TEXT;
ALTER TABLE team ADD COLUMN IF NOT EXISTS "withdrawnFixtures" INTEGER[];
