-- Widen messer_scorecard.status to cover the full submission lifecycle.
-- Previously the check constraint only allowed ('draft', 'submitted'), which
-- silently prevented the approve/reject flow from marking a draft as processed.
-- As a result approved scorecards never left the pending-approval list and could
-- be approved repeatedly, creating duplicate messer_result rows.

ALTER TABLE messer_scorecard
  DROP CONSTRAINT IF EXISTS messer_scorecard_status_check;

ALTER TABLE messer_scorecard
  ADD CONSTRAINT messer_scorecard_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'));
