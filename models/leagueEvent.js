// @ts-check
const { sql } = require('kysely');
const { kysely } = require('../db');

// Dates in the fixtures list that are not fixtures: the Messer finals and the like
// (migrations/040_league_event.sql). Kept at /admin/league-events.

/**
 * The columns the admin form writes. `date` is YYYY-MM-DD.
 * @typedef {{ date: string, title: string, detail: string | null, venue: number | null }} LeagueEventData
 */

// The day as YYYY-MM-DD. A DATE read as a JS Date is midnight in the server's zone, so the
// day depends on where the server runs; the text does not.
const day = /** @type {import('kysely').RawBuilder<string>} */ (sql`to_char(e.date, 'YYYY-MM-DD')`);

// One season's events, in date order, with the venue's address and map link. "In a
// season" as for fixtures: strictly between its start and end. LEFT JOIN, as the venue
// is optional (gotcha 1c).
/** @param {string} seasonName */
exports.getForSeason = async function(seasonName) {
  return kysely.selectFrom('league_event as e')
    .innerJoin('season as s', join => join
      .on('s.name', '=', seasonName)
      .onRef('e.date', '>', 's.startDate')
      .onRef('e.date', '<', 's.endDate'))
    .leftJoin('venue as v', 'v.id', 'e.venue')
    .select(['e.id', day.as('day'), 'e.title', 'e.detail',
      'v.name as venueName', 'v.address as venueAddress', 'v.gMapUrl'])
    .orderBy('e.date', 'asc')
    .orderBy('e.id', 'asc')
    .execute();
};

// Every event, newest first, with its venue's name and the season it falls in (null when
// none does: such an event is on no fixtures list, and the admin page says so).
exports.getAll = async function() {
  return kysely.selectFrom('league_event as e')
    .leftJoin('venue as v', 'v.id', 'e.venue')
    .leftJoin('season as s', join => join
      .onRef('e.date', '>', 's.startDate')
      .onRef('e.date', '<', 's.endDate'))
    .select(['e.id', day.as('day'), 'e.title', 'e.detail', 'e.venue',
      'v.name as venueName', 's.name as season'])
    .orderBy('e.date', 'desc')
    .orderBy('e.id', 'desc')
    .execute();
};

/** @param {number} id */
exports.getById = async function(id) {
  return kysely.selectFrom('league_event as e')
    .select(['e.id', day.as('day'), 'e.title', 'e.detail', 'e.venue'])
    .where('e.id', '=', id)
    .executeTakeFirst();
};

// The season a date falls in, or undefined: an event outside every season would be saved
// and then shown nowhere.
/** @param {string} ymd */
exports.seasonOf = async function(ymd) {
  const at = /** @type {import('kysely').RawBuilder<Date>} */ (sql`${ymd}::date`);
  const row = await kysely.selectFrom('season')
    .select('name')
    .where('startDate', '<', at)
    .where('endDate', '>', at)
    .orderBy('startDate', 'desc')
    .executeTakeFirst();
  return row && row.name;
};

/** @param {LeagueEventData} data */
exports.create = async function(data) {
  const row = await kysely.insertInto('league_event').values(data).returning('id').executeTakeFirstOrThrow();
  return row.id;
};

/** @param {number} id @param {LeagueEventData} data */
exports.updateById = async function(id, data) {
  await kysely.updateTable('league_event').set(eb => ({ ...data, updated_at: eb.fn('now') }))
    .where('id', '=', id).execute();
};

/** @param {number} id */
exports.deleteById = async function(id) {
  await kysely.deleteFrom('league_event').where('id', '=', id).execute();
};
