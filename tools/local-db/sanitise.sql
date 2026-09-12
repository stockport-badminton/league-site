-- Replace every real contact detail in the local database.
--
-- The seed is a snapshot of production, so it carries real members' email addresses and
-- phone numbers, encrypted with the PRODUCTION DB_PI_KEY. Two problems with leaving that
-- alone: a dev box should not hold the league's contact list, and the ciphertext will not
-- decrypt under a local key anyway, so every page that reads a contact detail would error.
--
-- So they are re-encrypted under the LOCAL key with values that are safe and useful:
--
--   email -> bigcoops+firstnamelastname@gmail.com   a plus-alias, so anything a dev run
--                                                   actually sends lands in one inbox and
--                                                   says who it was meant for
--   phone -> 07700 900xxx                           Ofcom reserves 07700 900000-900999
--                                                   for exactly this; it can never ring a
--                                                   real person
--
-- :key is bound by tools/local-db.sh from LOCAL_DB_PI_KEY. It is not a secret and must
-- never be the production one — the whole point is that this database cannot decrypt
-- production data and production cannot decrypt this.
DO $$
DECLARE
  t   text;
  n   bigint;
  key text := current_setting('sdbl.local_key');
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'playerEmail'
     GROUP BY c.table_name
  LOOP
    -- Only where the name columns exist to build an alias from.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=t AND column_name='first_name') THEN
      EXECUTE format($f$
        UPDATE %I SET
          "playerEmail" = pgp_sym_encrypt(
            'bigcoops+' ||
            lower(regexp_replace(coalesce(first_name,'') || coalesce(family_name,''), '[^a-zA-Z0-9]', '', 'g')) ||
            '@gmail.com', %L),
          "playerTel" = pgp_sym_encrypt('07700 900' || lpad((floor(random()*1000))::int::text, 3, '0'), %L)
      $f$, t, key, key);
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'sanitised % (% rows)', t, n;
    END IF;
  END LOOP;

  -- authEmail is the login identity and only exists on the live table.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='player' AND column_name='authEmail') THEN
    EXECUTE format($f$
      UPDATE player SET "authEmail" = pgp_sym_encrypt(
        'bigcoops+' ||
        lower(regexp_replace(coalesce(first_name,'') || coalesce(family_name,''), '[^a-zA-Z0-9]', '', 'g')) ||
        '@gmail.com', %L)
      WHERE "authEmail" IS NOT NULL
    $f$, key);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'sanitised player.authEmail (% rows)', n;
  END IF;
END $$;

-- ── Stored scorecard photographs ────────────────────────────────────────────────────
--
-- `scorecardstore."scoresheet-url"` holds an https URL to an object in the PRODUCTION
-- bucket, and the seed carries 1,479 of them. They are not contact details, but the same
-- argument applies more strongly: a scorecard photograph is a picture of a team sheet
-- carrying twelve players' names and both captains' signatures (HARD-25 found this out by
-- nearly committing one as a test fixture).
--
-- Leaving them also made the BROWSER SUITE read production storage on every run. The
-- populated-scorecard page renders GET /scorecard-photo/:id, the server fetches the object
-- with whatever AWS credentials it has, and `e2e/helpers/read-only.js` is content because
-- it is a same-origin GET. Nothing said this was happening. Found 12 Sep 2026 while doing
-- HARD-33, when the credentials went dead and the fetch started 404ing.
--
-- Cleared rather than rewritten to a local placeholder: a draft with no photo is an
-- ordinary, well-supported state — the whole "add a photo later" flow exists for it — so
-- NULL exercises a real path, while a made-up URL would exercise a path that cannot work.
UPDATE scorecardstore SET "scoresheet-url" = NULL WHERE "scoresheet-url" IS NOT NULL;
