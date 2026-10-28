// @ts-check
var db = require('../db_connect.js');
var seasonModel = require('./season');
const { sql } = require('kysely');
const { kysely, decrypt } = require('../db');

// On the typed query layer (REARCH-01, and existsInSeason by REARCH-02).
//
// Several keys below are lowercase on purpose (clubvenue, matchsecemail, clubid, …): they
// are what the string queries returned, because Postgres folded their unquoted aliases,
// and the views read them that way. Renaming one is a separate change with the views.

// Whether a club of exactly this name existed in a season: club_at, which for the current
// season (or no season) is the live table. The stats pages ask this of a `club-` filter,
// which can legitimately name a club that has since folded or been renamed (Canute in
// 2024/25, Remnants now) and so must not be checked against the live table alone.
/** @param {string} name @param {string} season */
exports.existsInSeason = async function(name, season) {
  const row = await kysely.selectFrom('club_at').select('id')
    .where('season', '=', seasonModel.assertName(season) || seasonModel.current())
    .where('name', '=', name)
    .limit(1)
    .executeTakeFirst()
  return row !== undefined
}

// Constant strings are written with sql.lit, as literals in the statement, the way the
// string queries had them. As bound parameters (eb.val) they break: CONCAT takes "any",
// so Postgres cannot infer a parameter's type there and refuses the statement.

/**
 * `first_name family_name`, as CONCAT gives it: a missing person is ' ', not NULL.
 * @param {import('kysely').ExpressionBuilder<any, any>} eb @param {string} who a table alias
 */
const fullName = (eb, who) =>
  eb.fn('concat', [eb.ref(`${who}.first_name`), sql.lit(' '), eb.ref(`${who}.family_name`)]);

exports.getAll = async function() {
  return kysely.selectFrom('club').selectAll().orderBy('name', 'asc').execute()
}

// Every club that has a public page, one row each — the source for /clubs/:slug, the
// club links on /info/clubs and the sitemap's club entries.
//
// Deliberately one row per club, unlike clubDetail() which fans out over teams and
// leaves the caller to regroup. `excludeClubId` is the `No Club` sentinel that
// released players are parked on; it has no page.
/** @param {number} excludeClubId */
exports.getPublicClubs = async function(excludeClubId) {
  return kysely.selectFrom('club as cl')
    .leftJoin('venue as v', 'cl.venue', 'v.id')
    .select(['cl.id', 'cl.name', 'cl.clubNight', 'cl.clubNightText', 'cl.clubNightCourts',
      'cl.matchNightText', 'cl.clubWebsite', 'cl.facebook', 'cl.instagram', 'cl.twitter',
      'v.name as venueName', 'v.address as venueAddress', 'v.gMapUrl', 'v.Lat', 'v.Lng', 'v.placeId'])
    .where('cl.id', '<>', excludeClubId)
    .orderBy('cl.name', 'asc')
    .execute()
}

// A club's teams, with the division and the venue each one plays its home matches at
// (which is not always the club's own venue). `excludeTeamId` is the `No Team`
// sentinel.
/** @param {number} clubId @param {number} excludeTeamId */
exports.getTeamsForClub = async function(clubId, excludeTeamId) {
  return kysely.selectFrom('team as t')
    .leftJoin('division as d', 't.division', 'd.id')
    .leftJoin('venue as v', 't.venue', 'v.id')
    .select(['t.id', 't.name', 't.matchDay', 't.starttime as startTime', 'd.name as divisionName',
      'v.name as venueName', 'v.address as venueAddress', 'v.gMapUrl'])
    .where('t.club', '=', clubId).where('t.id', '<>', excludeTeamId).where('t.withdrawn', 'is', null)
    .orderBy('t.name', 'asc')
    .execute()
}

// Coordinates and the club-night day/time feed the SportsClub JSON-LD (geo +
// openingHoursSpecification), which is what a "badminton clubs near me" query reads.
exports.clubDetail = async function() {
  return kysely.selectFrom('club')
    .innerJoin('team', 'team.club', 'club.id')
    .innerJoin('venue', 'venue.id', 'club.venue')
    .innerJoin('venue as teamvenue', 'teamvenue.id', 'team.venue')
    .select(['club.id as clubId', 'club.name', 'team.name as teamName', 'team.matchDay as matchDay',
      'venue.name as clubvenue', 'venue.gMapUrl as clubgmap', 'venue.address as clubaddress',
      'venue.Lat as clubLat', 'venue.Lng as clubLng',
      'club.clubNight', 'club.clubNightCourts', 'club.facebook', 'club.instagram', 'club.twitter',
      'club.matchNightText', 'club.clubNightText', 'club.clubWebsite', 'club.matchVenue',
      'teamvenue.name as teammatchvenue', 'teamvenue.gMapUrl as teamgmap', 'teamvenue.address as teamaddress'])
    .orderBy('name').orderBy('teamName')
    .execute()
}

/** @param {number} clubId */
exports.clubDetailbyId = async function(clubId) {
  return kysely
    .selectFrom(eb => eb.selectFrom('club').innerJoin('venue', 'venue.id', 'club.venue')
      .select(['club.id as clubid', 'club.name', 'venue.name as venue', 'venue.gMapUrl', 'venue.address',
        'club.matchNightText', 'club.clubNightText', 'club.clubWebsite', 'club.matchVenue'])
      .as('a'))
    .innerJoin('venue', 'a.matchVenue', 'venue.id')
    .select(['a.clubid', 'a.name', 'a.venue', 'a.address', 'a.gMapUrl as clubvenueurl',
      'a.matchNightText', 'a.clubNightText', 'a.clubWebsite',
      'venue.name as matchvenuename', 'venue.gMapUrl as matchvenueurl', 'venue.Lat', 'venue.Lng'])
    .where('a.clubid', '=', clubId)
    .orderBy('a.name')
    .execute()
}

// Every club secretary and match secretary of the given clubs who has a contact
// email, for the missed-three notice. All of them, not one: College Green has two
// of each and both should hear about it.
//
// An officer is the role flag on a player at that club. (The club row's old pointers,
// "clubSec" and "matchSec", were dropped by REARCH-03: one left behind when somebody moved
// on is how a former secretary ended up on another club's mail.)
// INNER is right here, and the role literal says so to optional-join-guard: the join
// defines what each row is, and a club with no officers should return no rows.
/** @param {Array<number | string> | null | undefined} clubIds */
exports.getOfficerEmails = async function(clubIds) {
  if (!clubIds || !clubIds.length) return []
  return kysely.selectFrom('club')
    .innerJoin('player as p', join => join.onRef('p.club', '=', 'club.id').on(eb => eb.or([
      eb('p.clubSecretary', '=', 1), eb('p.matchSecrertary', '=', 1),
    ])))
    .distinct()
    .select(eb => ['club.id as clubId', 'club.name as clubName', 'p.id as playerId',
      sql.lit('club officer').as('role'),
      fullName(eb, 'p').as('name'),
      eb.fn('trim', [decrypt(eb.ref('p.playerEmail'))]).as('email')])
    .where('club.id', 'in', clubIds.map(Number))
    .where('p.playerEmail', 'is not', null)
    .where(eb => eb(eb.fn.coalesce(eb.fn('nullif', [eb.fn('trim', [decrypt(eb.ref('p.playerEmail'))]), sql.lit('')]), sql.lit('')), '<>', ''))
    .orderBy('club.id').orderBy('p.id')
    .execute()
}

exports.getContactDetailsById = async function(/** @type {number} */ clubId) {
  return kysely.selectFrom('club')
    .innerJoin('team', 'team.club', 'club.id')
    .innerJoin('venue', 'club.venue', 'venue.id')
    .innerJoin('venue as matchVenue', 'club.matchVenue', 'matchVenue.id')
    // The two club officers are joined as *scalar subqueries*, one row each.
    //
    // They used to be plain joins, and a club with more than one person flagged for a
    // role multiplied every other row by that count: College Green has two match
    // secretaries and two club secretaries, so its five teams came back as twenty rows
    // and the page listed each captain four times. Nothing in the club table stops a
    // second person being flagged, and several clubs have one.
    //
    // These are club-level facts, not per-team ones, and the view has always read them
    // from clubrow[0] — so the extra rows never showed a second secretary, they only
    // duplicated the captains. LIMIT 1 with an explicit ORDER BY also makes the pick
    // deterministic; without it, which of the two secretaries appeared was down to
    // whatever order Postgres happened to return.
    .leftJoinLateral(eb => eb.selectFrom('player as p').selectAll('p')
      .whereRef('p.club', '=', 'club.id').where('p.matchSecrertary', '=', 1)
      .orderBy('p.id').limit(1).as('matchSec'), join => join.onTrue())
    .leftJoinLateral(eb => eb.selectFrom('player as p').selectAll('p')
      .whereRef('p.club', '=', 'club.id').where('p.clubSecretary', '=', 1)
      .orderBy('p.id').limit(1).as('clubSec'), join => join.onTrue())
    // Likewise one captain per team, and LEFT so a team without one still lists.
    // This was an inner join, which meant a single team with no captain flagged removed
    // that team from the page entirely — the same trap as gotcha 1c.
    .leftJoinLateral(eb => eb.selectFrom('player as p').selectAll('p')
      .whereRef('p.team', '=', 'team.id').where('p.teamCaptain', '=', 1)
      .orderBy('p.id').limit(1).as('teamCaptain'), join => join.onTrue())
    .select(eb => ['club.name as clubname', 'team.name as teamname',
      'venue.id as venueId', 'venue.name as venuename', 'venue.address as address',
      'matchVenue.id as matchvenueid', 'matchVenue.name as matchvenuename', 'matchVenue.address as matchvenueaddress',
      'club.matchNightText as matchnight',
      fullName(eb, 'matchSec').as('matchsecretary'),
      decrypt(eb.ref('matchSec.playerTel')).as('matchsectel'),
      decrypt(eb.ref('matchSec.playerEmail')).as('matchsecemail'),
      fullName(eb, 'clubSec').as('clubsecretary'),
      decrypt(eb.ref('clubSec.playerTel')).as('clubsectel'),
      decrypt(eb.ref('clubSec.playerEmail')).as('clubsecemail'),
      fullName(eb, 'teamCaptain').as('teamcaptain'),
      decrypt(eb.ref('teamCaptain.playerTel')).as('teamcaptaintel'),
      decrypt(eb.ref('teamCaptain.playerEmail')).as('teamcaptainemail')])
    .where('club.id', '=', clubId)
    // No GROUP BY. It was there to collapse the duplicate rows the old joins produced,
    // and it could not: grouping by the captain's own columns keeps one row per distinct
    // (captain, match sec, club sec) combination, which is exactly the fan-out. The
    // subqueries above remove the cause, so there is nothing left to collapse.
    .orderBy('team.name')
    .execute()
}

// `NULLIF(TRIM(first family), '')`: NULL for nobody, rather than CONCAT's ' '.
/** @param {import('kysely').ExpressionBuilder<any, any>} eb @param {string} who */
const nameOrNull = (eb, who) => eb.fn('nullif', [eb.fn('trim', [fullName(eb, who)]), sql.lit('')])

// Lenient data source for the club registration form prefill. Unlike
// getContactDetailsById (all-INNER-JOINs, returns nothing unless a match sec,
// club sec and every team captain exist), this LEFT-JOINs everything so a club
// with partial data still prefills what it has and leaves the rest blank for
// the captain to complete. Keyed by club name to match the club claim on
// req.user and the team-registration form's convention. DISTINCT ON collapses
// the duplicate rows a club with two players flagged as secretary/captain would
// otherwise produce.
/** @param {string} clubName */
exports.getClubRegistration = async function(clubName) {
  const core = await kysely.selectFrom('club')
    .leftJoin('venue', 'club.venue', 'venue.id')
    .leftJoin('player as cs', join => join.onRef('cs.club', '=', 'club.id').on('cs.clubSecretary', '=', 1))
    .leftJoin('player as ms', join => join.onRef('ms.club', '=', 'club.id').on('ms.matchSecrertary', '=', 1))
    .distinctOn('club.id')
    .select(eb => ['club.id', 'club.name as clubName',
      'club.clubWebsite', 'club.contactUs as clubEmail',
      'club.matchNightText', 'club.clubNightText', 'club.clubNight', 'club.clubNightCourts',
      'venue.name as venueName', 'venue.address as venueAddress',
      nameOrNull(eb, 'cs').as('clubSecName'),
      decrypt(eb.ref('cs.playerTel')).as('clubSecTel'),
      decrypt(eb.ref('cs.playerEmail')).as('clubSecEmail'),
      nameOrNull(eb, 'ms').as('matchSecName'),
      decrypt(eb.ref('ms.playerTel')).as('matchSecTel'),
      decrypt(eb.ref('ms.playerEmail')).as('matchSecEmail')])
    .where('club.name', '=', clubName)
    // The officer ids break ties, so which of two flagged people is shown does not
    // depend on the plan Postgres picks.
    .orderBy('club.id').orderBy('cs.id').orderBy('ms.id')
    .execute()
  if (!core.length) return null

  const teams = await kysely.selectFrom('team')
    .innerJoin('club', 'team.club', 'club.id')
    .leftJoin('player as cap', join => join.onRef('cap.team', '=', 'team.id').on('cap.teamCaptain', '=', 1))
    .distinctOn('team.id')
    .select(eb => ['team.id', 'team.name as teamName',
      nameOrNull(eb, 'cap').as('captainName'),
      decrypt(eb.ref('cap.playerTel')).as('captainTel'),
      decrypt(eb.ref('cap.playerEmail')).as('captainEmail')])
    .where('club.name', '=', clubName)
    .orderBy('team.id').orderBy('cap.id')
    .execute()
  teams.sort((a, b) => a.teamName.localeCompare(b.teamName))

  return { core: core[0], teams }
}

/** @param {number} clubId */
exports.getById = async function(clubId) {
  return kysely.selectFrom('club').selectAll().where('id', '=', clubId).execute()
}

// Insert or update a club from an object of {column: value} pairs; only the provided keys
// are written. Kysely quotes every column, which is what the hand-built version did by
// wrapping each key in double quotes. One difference to know about: a key whose value is
// `undefined` is left out, where the string version wrote NULL. Its only caller,
// clubController's buildClubObj, sets every key it includes to a value or to null.
// Both return nothing; that caller never read the old rows array.
/** @param {import('kysely').Insertable<import('../db/schema').Club>} clubObj */
exports.createFull = async function(clubObj) {
  if (!db.isObject(clubObj)) throw new Error('not valid object')
  await kysely.insertInto('club').values(clubObj).execute()
}

/** @param {import('kysely').Updateable<import('../db/schema').Club>} clubObj @param {number} clubId */
exports.updateFull = async function(clubObj, clubId) {
  if (!db.isObject(clubObj)) throw new Error('not valid object')
  await kysely.updateTable('club').set(clubObj).where('id', '=', clubId).execute()
}
// The clubs whose Instagram handle we hold, for mentioning in a caption.
//
// Instagram turns a bare `@handle` in a caption into a real mention, so this is the one
// place a mention costs nothing — Facebook page mentions need the Pages API and a reviewed
// app, which is why `sendResultZap` has never carried any.
//
// Built from the database rather than written into the post, because the hardcoded list in
// the Make.com scenario had drifted: it mentioned `@manor_badminton_club` where the club's
// stored handle is `manorbadmintonclubwilmslow`, and `@collegegreenbadmintonclub` for a club
// with no Instagram handle at all. A wrong handle either mentions a stranger or nothing, and
// nobody would ever notice. Adding a handle in /admin/clubs now changes the next post.
//
// `socialUrl` in utils/socialLinks.js is the same idea for links, and shares the rule that
// anything not handle-shaped is dropped rather than guessed at.
exports.getInstagramHandles = async function() {
  const rows = await kysely.selectFrom('club').select(['name', 'instagram'])
    .where('instagram', 'is not', null)
    .where(eb => eb(eb.fn('trim', ['instagram']), '<>', ''))
    .orderBy('name')
    .execute();
  return rows
    .map(r => ({ name: r.name, handle: String(r.instagram).trim().replace(/^@+/, '') }))
    .filter(r => /^[A-Za-z0-9._]+$/.test(r.handle));
};
