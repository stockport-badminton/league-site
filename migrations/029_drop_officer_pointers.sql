-- REARCH-03 part A step 3: an officer is recorded one way, by the flag on the player.
--
-- club."matchSec", club."clubSec" and team.captain were a second record of the same
-- officers, a player id on the club or team. They never checked where that player now
-- was, which kept someone who had left a club on its division's distribution list until
-- her mailbox bounced (18 Sep 2026). Every pointer was cleared in production on 25 Oct
-- 2026 (backup: scripts/officer-pointers-backup-2026-10-25T12-54-37-487Z.json), and
-- since 435020e nothing reads them.
--
-- Checked in production on 27 Oct 2026 before writing this: every value NULL, and no
-- view, index, constraint, policy or function in `public` refers to them.
--
-- The season archives (club20252026, team20252026, …) keep their own copies of these
-- columns. They are snapshots, and REARCH-02 replaces them; this does not touch them.

ALTER TABLE club DROP COLUMN IF EXISTS "matchSec";
ALTER TABLE club DROP COLUMN IF EXISTS "clubSec";
ALTER TABLE team DROP COLUMN IF EXISTS captain;
