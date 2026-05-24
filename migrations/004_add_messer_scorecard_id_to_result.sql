-- Add messer_scorecard_id foreign key to messer_result
-- This links rejection/approval records back to the original submission

ALTER TABLE messer_result
ADD COLUMN "messer_scorecard_id" INTEGER,
ADD FOREIGN KEY ("messer_scorecard_id") REFERENCES messer_scorecard(id);

CREATE INDEX idx_messer_result_scorecard_id ON messer_result("messer_scorecard_id");
