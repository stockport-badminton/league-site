-- Site-wide role (superadmin/admin) and messer-admin now live on the player
-- table instead of Auth0 app_metadata custom claims, matching how every other
-- club role (teamCaptain, clubSecretary, matchSecrertary, treasurer,
-- otherComms) already works. Auth0 remains pure authentication; Postgres is
-- the single source of truth for authorization.
--
--   role         'admin' (scoped to this row's own club) or 'superadmin'
--                (sees every club); NULL means no site-wide role, same as an
--                absent Auth0 claim today.
--   messerAdmin  SMALLINT 0/1, matching the existing boolean-flag convention
--                on this table rather than introducing a real BOOLEAN type.
--
-- Deliberately no new email column: the login lookup (models/players.js
-- getAuthRoleByEmail) reuses the existing encrypted "playerEmail" rather than
-- adding a plaintext lookup column, which would have undone the point of
-- encrypting it in the first place for exactly the highest-privilege rows.

ALTER TABLE player ADD COLUMN IF NOT EXISTS role TEXT
  CHECK (role IN ('admin', 'superadmin'));
ALTER TABLE player ADD COLUMN IF NOT EXISTS "messerAdmin" SMALLINT DEFAULT 0;
