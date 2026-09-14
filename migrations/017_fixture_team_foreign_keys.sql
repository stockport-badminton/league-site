-- HARD-11 step 4: stop this happening again.
--
-- `fixture."homeTeam"` and `"awayTeam"` have never had foreign keys. The live `fixture`
-- table accumulates every season forever — 5,206 rows spanning 1900 to 2027 — while `team`
-- holds only the current season's 36. So every time a team folded or was renamed and its
-- row was deleted, its historical fixtures were orphaned, silently, with nothing to object.
--
-- 2,132 fixtures were in that state across every season since 2014. What it cost was not
-- the untidiness: `Player.getPlayerGameData` inner-joined both teams, so **10,422 of
-- 35,244 game rows — 30% of everything ever recorded — were missing from players' history
-- pages**, affecting 677 of 904 players. One member had played 716 rated games and her page
-- showed 256.
--
-- Step 3 reinstated the 19 deleted teams as withdrawn rows, so every fixture now resolves.
-- This is what keeps it that way. Verified satisfiable immediately before writing:
-- 5,206 fixtures, 0 NULL team ids, 0 unresolvable references.
--
-- ⚠️ WHAT THIS MAKES FAIL, deliberately: deleting a team that has fixtures. `DELETE /team/:id`
-- (JWT-gated, `Team.deleteById`) will now raise a foreign key violation rather than
-- quietly orphaning that team's history. There is no record of it being used in the whole
-- retained log window, and the correct action for a team that stops playing is the
-- withdrawal flow HARD-10 built — set `withdrawn`, NULL the division — which keeps the row
-- and therefore keeps the history readable.
--
-- NO ACTION rather than CASCADE, emphatically. CASCADE would delete the fixtures, and with
-- them the game rows and every player's record of having played them, which is a far worse
-- outcome than the one being fixed. SET NULL would recreate the same orphan under another
-- name. Failing is the behaviour that is wanted.
--
-- The columns stay NULLable: a foreign key permits NULL, and a fixture with no team at all
-- is a different finding (`--check ghost-teams`). `Fixture.rearrangeByTeamNames` was the
-- one path that inserted them and was fixed in September.
--
-- Safe to apply before or after a deploy — it constrains data, and no code change depends
-- on it. That is genuinely true here, unlike migration 015, where the same sentence was
-- wrong because the application writes the column.
--
--   node run-migration.js 017_fixture_team_foreign_keys.sql --local   # rehearse
--   node run-migration.js 017_fixture_team_foreign_keys.sql           # production
--
-- If either statement fails with "violates foreign key constraint", something has orphaned
-- a fixture since step 3 — run `node tools/dbq.js --check orphan-team-refs` to see what.

ALTER TABLE fixture
  ADD CONSTRAINT fixture_home_team_fkey
  FOREIGN KEY ("homeTeam") REFERENCES team (id);

ALTER TABLE fixture
  ADD CONSTRAINT fixture_away_team_fkey
  FOREIGN KEY ("awayTeam") REFERENCES team (id);
