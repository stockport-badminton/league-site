-- A Messer match that was conceded, rather than played: which side conceded it.
--
-- Concessions used to be filed as a full fifteen-game card of 21-0s with no players, then
-- approved like any result. Now the messer admin concedes from the draw page, which writes
-- the draw row the way those cards always ended up (15-0 to the other side, winningTeam,
-- winner advanced) and marks it here, so the page can label it and offer an undo.
--
-- On the draw row itself rather than found through messer_result, because draw ids restart
-- every season: a messer_result.messer_id does not say which season's match it was.
--
-- messer_season gets the column too, or tools/season-archive.js refuses to archive a
-- `messer` that has a column its history table lacks; and messer_at is re-created with it
-- on the end (CREATE OR REPLACE VIEW may only append columns).

ALTER TABLE messer ADD COLUMN IF NOT EXISTS "concededBy" VARCHAR(4)
  CHECK ("concededBy" IN ('home', 'away'));
ALTER TABLE messer_season ADD COLUMN IF NOT EXISTS "concededBy" VARCHAR(4)
  CHECK ("concededBy" IN ('home', 'away'));

CREATE OR REPLACE VIEW messer_at WITH (security_invoker = true) AS
  SELECT season, id, "homeTeam", "awayTeam", "homeScore", "awayScore", "winningTeam",
         section, "drawPos", round, "nextDrawPos", "nextSlot", "concededBy"
    FROM messer_season
   WHERE season IS DISTINCT FROM (SELECT name FROM season WHERE "startDate" <= now()
                                   ORDER BY "startDate" DESC LIMIT 1)
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1),
         id, "homeTeam", "awayTeam", "homeScore", "awayScore", "winningTeam",
         section, "drawPos", round, "nextDrawPos", "nextSlot", "concededBy"
    FROM messer;
