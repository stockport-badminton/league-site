-- Companion to 008_player_auth_roles.sql. Auth0's login email is frequently
-- NOT the same as a player's registered "playerEmail" (that's precisely why
-- ~2/3 of role-holders needed manual linking during backfill rather than an
-- automatic email match) — so role lookup at login can't rely on playerEmail
-- alone. This is a second, equally encrypted column dedicated to "the email
-- this row's Auth0 identity logs in with", populated only for rows where it
-- differs from playerEmail. Still never plaintext, same as playerEmail.
ALTER TABLE player ADD COLUMN IF NOT EXISTS "authEmail" BYTEA;
