-- Dates that are not fixtures but belong in the fixtures list: the Messer section finals
-- and finals night. Kept at /admin/league-events, which a Messer admin can edit.
--
-- They were three hard-coded rows pushed onto the result of Fixture.getFixtureDetails,
-- edited by hand (and deployed) every season. Being in the model they reached every
-- caller: the ELO code had to filter them back out by their fake id 99999, and they were
-- on every club's, team's and past season's fixture list. They are now added by the
-- fixtures controller, for the season being viewed (the season whose dates contain
-- them, as for fixtures) and not on a club's or team's list.
--
-- `date` is a DATE, not a TIMESTAMP like fixture.date: there is no time to shift, and
-- the model reads it with to_char, so it is the same day wherever the server runs.
-- `detail` is shown in the away-team column ("@ Ladybridge Park Residents Club").
-- ON DELETE SET NULL: losing a venue must not lose the date.

CREATE TABLE IF NOT EXISTS league_event (
  id          SERIAL PRIMARY KEY,
  date        DATE NOT NULL,
  title       VARCHAR(100) NOT NULL,
  detail      VARCHAR(100) NULL,
  venue       INTEGER NULL REFERENCES venue(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS league_event_date ON league_event (date);

-- RLS on and no policy, as the other tables only the app reads (030–039).
ALTER TABLE league_event ENABLE ROW LEVEL SECURITY;

-- This season's three, as production showed them (the server runs in UTC, so the
-- hard-coded '2027-04-13T23:00:00.000Z' was displayed as 13/04/2027). The venue is
-- looked up by name so a database without it (the test one) gets NULL, not an error.
INSERT INTO league_event (date, title, detail, venue)
SELECT v.date, v.title, v.detail, (SELECT id FROM venue WHERE name = 'Ladybridge Park Residents Club' LIMIT 1)
  FROM (VALUES
    (DATE '2027-04-13', 'Messer A Section Final', NULL),
    (DATE '2027-04-20', 'Messer B Section Final', NULL),
    (DATE '2027-05-05', 'Messer Finals', '@ Ladybridge Park Residents Club')
  ) AS v(date, title, detail)
 WHERE NOT EXISTS (SELECT 1 FROM league_event);
