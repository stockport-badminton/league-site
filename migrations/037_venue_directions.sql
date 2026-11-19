-- How to find a venue once you are there: which entrance, where to park, which building.
--
-- Until now this had nowhere to go but the address. Everybody Sport and Recreation's
-- address carried three sentences about the South site entrance, the overflow car park
-- and not being Mulberry's; Mulberry's carried a sat-nav postcode and the A34 traffic
-- lights. The notes matter (away teams use them), but in the address they were also fed
-- to the JSON-LD postal address, Google Maps links and /llms.txt. Shown under the address
-- as "Getting there"; edited at /admin/venues.
--
-- venue_season gets the column too, or tools/season-archive.js refuses to archive a
-- `venue` that has a column its history table lacks; and venue_at is re-created with it on
-- the end (CREATE OR REPLACE VIEW may only append columns).

ALTER TABLE venue ADD COLUMN IF NOT EXISTS directions TEXT;
ALTER TABLE venue_season ADD COLUMN IF NOT EXISTS directions TEXT;

CREATE OR REPLACE VIEW venue_at WITH (security_invoker = true) AS
  SELECT season, id, name, address, "gMapUrl", "Lat", "Lng", "placeId", directions
    FROM venue_season
   WHERE season IS DISTINCT FROM (SELECT name FROM season WHERE "startDate" <= now()
                                   ORDER BY "startDate" DESC LIMIT 1)
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1),
         id, name, address, "gMapUrl", "Lat", "Lng", "placeId", directions
    FROM venue;
