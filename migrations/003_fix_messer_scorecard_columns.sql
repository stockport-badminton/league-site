-- Add missing columns to messer_scorecard
-- Messer format uses 3 men and 3 women per side, not 2 and 2
-- Also add scoresheet_url to store uploaded scoresheet image

ALTER TABLE messer_scorecard
ADD COLUMN "homeMan3" INTEGER;

ALTER TABLE messer_scorecard
ADD COLUMN "homeLady3" INTEGER;

ALTER TABLE messer_scorecard
ADD COLUMN "awayMan3" INTEGER;

ALTER TABLE messer_scorecard
ADD COLUMN "awayLady3" INTEGER;

ALTER TABLE messer_scorecard
ADD COLUMN "scoresheet-url" VARCHAR(256);
