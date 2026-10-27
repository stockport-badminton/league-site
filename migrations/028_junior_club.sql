-- Junior clubs, listed on /info/junior-clubs and kept in /admin/junior-clubs.
--
-- Not rows in `club`: a junior club plays in no division, has no teams or players, and
-- `club` feeds the clubs page, the sitemap's club pages, invoices and registrations, all
-- of which would have to learn to skip it.
--
-- What each club publishes differs (one gives an email, another only its website, one
-- states fees), so every detail is optional and the page shows only what is set.
-- `venue` reuses the league's venue rows for the address and map link; `venue_note` is
-- shown beside it for the name the club itself uses ("Club Cheadle Hulme" is Woods Lane
-- Sports Centre) or a room. ON DELETE SET NULL: losing a venue must not lose the club.

CREATE TABLE IF NOT EXISTS junior_club (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  venue         INTEGER NULL REFERENCES venue(id) ON DELETE SET NULL,
  venue_note    VARCHAR(200) NULL,
  session_times VARCHAR(200) NULL,
  fees          VARCHAR(200) NULL,
  contact_email VARCHAR(200) NULL,
  website       VARCHAR(300) NULL,
  notes         TEXT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on and no policy, as social_result_post: the app's role has BYPASSRLS, and a
-- `TO postgres` policy would stop `tools/local-db.sh load`, whose database has no such role.
ALTER TABLE junior_club ENABLE ROW LEVEL SECURITY;
