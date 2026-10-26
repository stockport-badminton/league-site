// @ts-check
// Which clubs have sent their player registration form in, and who still needs chasing.
//
// One row per (season, club) in `club_registration`, created lazily. Absence means
// "nothing received, nothing chased", which is what makes the season rollover free —
// see migrations/013_club_registration.sql.

const config = require('../config');
const db = require('../db_connect.js');
const seasonModel = require('./season');
const { kysely } = require('../db');

// REARCH-01: the three writes are on the typed query layer. getStatus and getDigest belong
// to REARCH-02 and are left as they are.

// A club with no fixtures at all this season cannot have a deadline, and `No Club` (63)
// is the sentinel a released player parks on — never a real club to chase.
const NO_CLUB_ID = 63;

// Officers are the people to chase. Both roles are read because the club secretary is
// the addressee and the match secretary is the one who usually has the team lists.
//
// `matchSecrertary` is spelt that way in the schema. It is not a typo here.
//
// The email is `pgp_sym_encrypt`'d, so the key is BOUND AS A PARAMETER and never
// interpolated — one query in this codebase had it as a string literal until Aug 2026.
// A blank is sometimes NULL and sometimes an encrypted empty string, so the emptiness
// test has to decrypt rather than check IS NOT NULL.
const OFFICER_SQL = `
  SELECT t.club AS "clubId",
         trim(p.first_name || ' ' || p.family_name) AS name,
         NULLIF(TRIM(pgp_sym_decrypt(p."playerEmail", ?)::text), '') AS email,
         CASE WHEN p."clubSecretary" = 1 THEN 'club secretary'
              ELSE 'match secretary' END AS role
  FROM player p
  JOIN team t ON p.team = t.id
  WHERE (p."clubSecretary" = 1 OR p."matchSecrertary" = 1)
    AND t.club <> ?
  ORDER BY t.club, CASE WHEN p."clubSecretary" = 1 THEN 0 ELSE 1 END, p.id`;

// Each club's first fixture of the season, with whatever registration status it has.
//
// The season window comes from the `season` table and is applied as a plain date range,
// NOT as a join to it. Joining `season ON fixture.date BETWEEN ...` is what silently
// dropped 48 fixtures from getFixtureEventById — an INNER JOIN to something the SELECT
// list never touches removes rows for free. See models/fixture.js.
//
// `fixture.date` is a `timestamp without time zone` holding local midnight
// (`2026-09-03 00:00:00`), so it is compared to CURRENT_DATE directly. Do not convert it
// AT TIME ZONE 'Europe/London' — that shifts every match a day earlier and puts league
// nights on a Sunday. (Note `tools/dbq.js` PRINTS these an hour early, because it renders
// through a JS Date; ask SQL for `to_char(...)` if you need to be sure what is stored.)
const STATUS_SQL = `
  WITH season_window AS (   -- not plain "window": reserved, for the WINDOW clause
    SELECT "startDate", "endDate" FROM season WHERE name = ?
  ),
  first_fixture AS (
    SELECT t.club AS club, MIN(f.date)::date AS first_date, COUNT(DISTINCT t.id) AS teams
    FROM team t
    JOIN fixture f ON (f."homeTeam" = t.id OR f."awayTeam" = t.id)
    CROSS JOIN season_window w
    WHERE f.date >= w."startDate" AND f.date <= w."endDate"
      -- A match that has been moved, or is being moved, does not set the deadline: the
      -- club is not playing that night, so registrations are not due by it. Same pair
      -- models/fixture.js excludes from the outstanding-results lists.
      --
      -- Written to KEEP a fixture with no status rather than a plain status NOT IN (...), which
      -- evaluates to NULL for a NULL status and drops the row. Every current-season
      -- fixture has one today and nothing enforces that, and the failure would be a club
      -- silently losing its earliest fixture and so its deadline -- which is the one
      -- outcome this whole page exists to prevent.
      AND (f.status IS NULL OR f.status NOT IN ('rearranged', 'rearranging'))
    GROUP BY t.club
  )
  SELECT c.id, c.name,
         ff.first_date AS "firstFixture",
         ff.teams,
         (ff.first_date - CURRENT_DATE) AS "daysAway",
         r.received_at AS "receivedAt",
         r.chased_at   AS "chasedAt",
         COALESCE(r.chase_count, 0) AS "chaseCount",
         r.note,
         r.updated_by  AS "updatedBy"
  FROM club c
  JOIN first_fixture ff ON ff.club = c.id
  LEFT JOIN club_registration r ON r.club = c.id AND r.season = ?
  WHERE c.id <> ?
  ORDER BY ff.first_date, c.name`;

async function conn() { return db.otherConnect(); }

// Every club with a fixture this season, each with its deadline and status.
/** @param {string} [season] @returns {Promise<any[]>} */
exports.getStatus = async function(season) {
  const name = seasonModel.assertName(season || seasonModel.current());
  const c = await conn();

  const [clubs] = await c.query(STATUS_SQL, [name, name, NO_CLUB_ID]);
  const [officers] = await c.query(OFFICER_SQL, [config.DB_PI_KEY, NO_CLUB_ID]);

  const byClub = new Map();
  officers.forEach((/** @type {any} */ o) => {
    if (!byClub.has(o.clubId)) byClub.set(o.clubId, []);
    byClub.get(o.clubId).push({ name: o.name, email: o.email, role: o.role });
  });

  return clubs.map((/** @type {any} */ row) => ({
    ...row,
    season: name,
    received: !!row.receivedAt,
    chased: !!row.chasedAt,
    officers: byClub.get(row.id) || [],
  }));
};

// Everything the daily reminder needs, in the two groups it reports.
//
// `dueWithin` is deliberately inclusive of clubs whose first fixture has already gone:
// a deadline that has passed is more urgent than one three days out, not less, and
// dropping it the morning it expires is how a club plays a match unregistered.
/** @param {string} [season] @param {number} [withinDays] */
exports.getDigest = async function(season, withinDays = 3) {
  const clubs = await exports.getStatus(season);
  const outstanding = clubs.filter(c => !c.received);
  return {
    season: clubs.length ? clubs[0].season : seasonModel.assertName(season || seasonModel.current()),
    withinDays,
    dueSoon:  outstanding.filter(c => c.daysAway <= withinDays),
    chased:   outstanding.filter(c => c.daysAway > withinDays && c.chased),
    received: clubs.filter(c => c.received).length,
    total:    clubs.length,
  };
};

// The upserts. All three target the (season, club) unique index, so a club with no row
// gets one on its first event and nothing has to pre-populate the table.
//
// `values` is what a first event inserts; `onConflict` is what a later one sets, given the
// expression builder so it can say now() or chase_count + 1.
/**
 * @param {string} season @param {number | string} clubId @param {string | null | undefined} updatedBy
 * @param {import('kysely').Insertable<import('../db/schema').ClubRegistration>} values
 * @param {(eb: import('kysely').ExpressionBuilder<import('../db/schema').DB, 'club_registration'>) => import('kysely').UpdateObject<import('../db/schema').DB, 'club_registration'>} onConflict
 */
async function upsert(season, clubId, updatedBy, values, onConflict) {
  const name = seasonModel.assertName(season);
  const row = await kysely.insertInto('club_registration')
    .values({ ...values, season: name, club: Number(clubId), updated_by: updatedBy || null })
    .onConflict(oc => oc.columns(['season', 'club']).doUpdateSet(eb => ({
      ...onConflict(eb),
      updated_by: eb.ref('excluded.updated_by'),
      updated_at: eb.fn('now'),
    })))
    .returning('id')
    .executeTakeFirst();
  return row && row.id;
}

/** @param {string} season @param {number | string} clubId @param {string | null} [updatedBy] */
exports.markReceived = (season, clubId, updatedBy) =>
  upsert(season, clubId, updatedBy, /** @type {any} */ ({ received_at: new Date() }),
    eb => ({ received_at: eb.fn('now') }));

/** @param {string} season @param {number | string} clubId @param {string | null} [updatedBy] */
exports.markNotReceived = (season, clubId, updatedBy) =>
  upsert(season, clubId, updatedBy, /** @type {any} */ ({ received_at: null }),
    () => ({ received_at: null }));

// chase_count increments rather than being set, so "chased twice" is visible. A first
// chase inserts 1.
/** @param {string} season @param {number | string} clubId @param {string | null} [updatedBy] */
exports.recordChase = (season, clubId, updatedBy) =>
  upsert(season, clubId, updatedBy, /** @type {any} */ ({ chased_at: new Date(), chase_count: 1 }),
    eb => ({ chased_at: eb.fn('now'), chase_count: eb('club_registration.chase_count', '+', 1) }));

exports.NO_CLUB_ID = NO_CLUB_ID;
