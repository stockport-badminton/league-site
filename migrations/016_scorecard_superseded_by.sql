-- A later submission replaces an earlier one (HARD-17, second item).
--
-- 140 of 1,373 matches have more than one draft in `scorecardstore`, and nothing has ever
-- said which of them is current. Every consumer that needed to know guessed — by date, by
-- id order, or by taking whatever the planner returned first.
--
-- They are not a data error. A captain who mistypes a score files the scorecard again;
-- that is the correction route the site has always had, and it works. What was missing is
-- any record that the second filing *replaces* the first, so both sat there looking
-- equally authoritative, and the confirmation link for the stale one still published.
--
-- Decided 14 Sep 2026 with the league secretary: the later submission wins.
--
-- NULL means "this is the current draft for its match". A value is the id of the draft
-- that replaced it — always the newest one, not the immediate successor, so finding the
-- current record is one hop from any draft in a chain rather than a walk. Nothing is
-- deleted: the superseded rows are the audit trail of what a captain actually filed and
-- when, which is the whole reason `scorecardstore` is kept.
--
-- No foreign key, for the reason given in 015: this codebase has none anywhere, and
-- referential integrity is HARD-11's decision rather than a side effect of this one.
--
-- ⚠️ Apply BEFORE deploying the code that writes it. `Fixture.createScorecard` builds its
-- INSERT from the object's keys and the supersede UPDATE names the column directly, so
-- without it a captain filing a scorecard gets `column "supersededBy" does not exist` and
-- the 500 page — on the one path where that message is worst, because what a captain does
-- about "nothing was recorded" is file it again.
--
--   node run-migration.js 016_scorecard_superseded_by.sql --local   # rehearse
--   node run-migration.js 016_scorecard_superseded_by.sql           # production
--
-- Quoted, because an unquoted camelCase identifier folds to lowercase and
-- `row.supersededBy` would be undefined — CLAUDE.md gotcha 1.

ALTER TABLE scorecardstore ADD COLUMN IF NOT EXISTS "supersededBy" INTEGER;

-- The question asked of this column is "is this draft still the current one", which is
-- answered by the NULLs. Partial the other way round from 015's index: here the interesting
-- rows are the ones WITHOUT a value, and they are the overwhelming majority, so the index
-- is on the few that have one — for "what did this draft replace" and for the audit check
-- that counts duplicates.
CREATE INDEX IF NOT EXISTS scorecardstore_superseded_by_idx
  ON scorecardstore ("supersededBy")
  WHERE "supersededBy" IS NOT NULL;
