// @ts-check
const { kysely } = require('../db');
const { jsonBuildObject } = require('kysely/helpers/postgres');

exports.getAll = async function() {
  return kysely.selectFrom('venue').selectAll().execute()
}

/**
 * The columns /admin/venues writes. placeId is left alone: nothing in the admin sets it,
 * and the event page's map falls back to the coordinates without it.
 * @typedef {{ name: string, address: string, gMapUrl: string, directions: string | null,
 *   Lat: number | null, Lng: number | null }} VenueData
 */

// Every venue for /admin/venues, with how many clubs and current teams use it, so the
// list can say which are in use (there is no delete; see venueController.js).
exports.getAllWithUse = async function() {
  return kysely.selectFrom('venue')
    .selectAll('venue')
    .select(eb => [
      eb.selectFrom('club').select(eb.fn.countAll().as('n'))
        .where(eb => eb.or([eb('club.venue', '=', eb.ref('venue.id')), eb('club.matchVenue', '=', eb.ref('venue.id'))]))
        .as('clubs'),
      eb.selectFrom('team').select(eb.fn.countAll().as('n'))
        .whereRef('team.venue', '=', 'venue.id').where('team.withdrawn', 'is', null)
        .as('teams'),
    ])
    .orderBy('venue.name')
    .execute()
}

/** @param {number} id */
exports.getById = async function(id) {
  return kysely.selectFrom('venue').selectAll().where('id', '=', id).executeTakeFirst()
}

/** @param {VenueData} data */
exports.create = async function(data) {
  const row = await kysely.insertInto('venue').values(data).returning('id').executeTakeFirstOrThrow()
  return row.id
}

/** @param {number} id @param {VenueData} data */
exports.updateById = async function(id, data) {
  await kysely.updateTable('venue').set(data).where('id', '=', id).execute()
}

/**
 * Every venue anything happens at, with what happens there.
 *
 * ── The red herring, which is what made this wrong ───────────────────────────
 *
 * `club."matchNightText"` and `club."matchVenue"` look like the answer to "where and when
 * does this club play". **They are not.** `matchNightText` is a hand-written summary that
 * lumps every team into one string — Featherforce's reads *"Weds & Thurs 8pm 2 courts"* —
 * and `matchVenue` can only name one place, so neither can describe a club whose teams
 * play on different nights or in different places.
 *
 * **The truth is per team**, in `team."matchDay"` and each team's own `team."venue"`.
 * Featherforce proves it here: Featherforce A plays Thursday and Featherforce B plays
 * Wednesday, and the club string tells a visitor neither of those things — only that the
 * club is out on both nights. Tameside had the sharper version of the same bug, where
 * G.H.A.P's two teams are at two different venues and both pins showed the same combined
 * sentence; that is what was reported and what prompted this.
 *
 * So this returns two separate things per venue, from the two places that actually know:
 *
 *   matchTeams  — from `team.venue`, one entry per TEAM, with that team's `matchDay`
 *   clubNights  — from `club.venue`, one entry per CLUB, with its `clubNightText`
 *
 * A venue can have either, or both.
 *
 * ── And why it returns data rather than HTML ─────────────────────────────────
 *
 * This used to build the popup markup in SQL with `concat`, interpolating the club name,
 * its website into an `href`, and the venue address — none of them escaped. The data
 * already contains `Mulberry's Sports Complex` and two `&`s; a `"` in a website would have
 * broken out of its attribute and a `<` anywhere would have broken the markup. The markup
 * now lives in `static/beta/js/venue-popup.js`, where it can be escaped and tested.
 *
 * Ported from the Tameside site (`Build the clubs map from teams, not from the club's
 * match-night summary`).
 */
exports.getVenueClubs = async function() {
  // json_agg directly, not kysely's jsonArrayFrom helper: that wraps the aggregate in
  // coalesce(…, '[]'), and a venue with no teams has always come back with
  // matchTeams: null. venue-popup.js reads both shapes today; a conversion keeps the one
  // it had.
  return kysely.selectFrom('venue')
    .select(eb => [
      'venue.name as venueName',
      'venue.Lat',
      'venue.Lng',
      'venue.address as address',
      'venue.gMapUrl as gMapUrl',
      'venue.directions as directions',
      eb.selectFrom('team')
        .innerJoin('club', 'club.id', 'team.club')
        .select(eb => eb.fn.agg('json_agg', [jsonBuildObject({
          club: eb.ref('club.name'),
          website: eb.ref('club.clubWebsite'),
          team: eb.ref('team.name'),
          matchDay: eb.ref('team.matchDay'),
        })]).orderBy('club.name').orderBy('team.name').as('agg'))
        .whereRef('team.venue', '=', 'venue.id')
        .where('team.withdrawn', 'is', null)
        .as('matchTeams'),
      eb.selectFrom('club')
        .select(eb => eb.fn.agg('json_agg', [jsonBuildObject({
          club: eb.ref('club.name'),
          website: eb.ref('club.clubWebsite'),
          clubNightText: eb.ref('club.clubNightText'),
        })]).orderBy('club.name').as('agg'))
        .whereRef('club.venue', '=', 'venue.id')
        .as('clubNights'),
    ])
    .where(eb => eb.or([
      eb.exists(eb.selectFrom('team').select(eb.lit(1).as('one'))
        .whereRef('team.venue', '=', 'venue.id').where('team.withdrawn', 'is', null)),
      eb.exists(eb.selectFrom('club').select(eb.lit(1).as('one'))
        .whereRef('club.venue', '=', 'venue.id')),
    ]))
    .orderBy('venue.name')
    .execute()
}
