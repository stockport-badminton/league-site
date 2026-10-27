// @ts-check
const { kysely } = require('../db');

/**
 * The columns the admin form writes. Every detail but the name is optional.
 * @typedef {{ name: string, venue: number | null, venue_note: string | null,
 *   session_times: string | null, fees: string | null, contact_email: string | null,
 *   website: string | null, notes: string | null, active: boolean }} JuniorClubData
 */

// The public list: active clubs with their venue's address and map link. LEFT JOIN, as
// the venue is optional (gotcha 1c).
//
// Not the email address, only whether there is one: enquiries go through /contact-us,
// which looks the address up itself, so the page never has it to publish.
exports.getActive = async function() {
  return kysely.selectFrom('junior_club as j')
    .leftJoin('venue as v', 'v.id', 'j.venue')
    .select(eb => ['j.id', 'j.name', 'j.venue_note', 'j.session_times', 'j.fees',
      eb('j.contact_email', 'is not', null).as('has_email'),
      'j.website', 'j.notes', 'v.name as venueName', 'v.address as venueAddress', 'v.gMapUrl'])
    .where('j.active', '=', true)
    .orderBy('j.name', 'asc')
    .execute();
};

// The junior clubs the contact form can reach: shown, and with an address to send to.
exports.getContactable = async function() {
  return kysely.selectFrom('junior_club').select(['id', 'name'])
    .where('active', '=', true)
    .where('contact_email', 'is not', null)
    .orderBy('name', 'asc')
    .execute();
};

exports.getAll = async function() {
  return kysely.selectFrom('junior_club as j')
    .leftJoin('venue as v', 'v.id', 'j.venue')
    .selectAll('j')
    .select('v.name as venueName')
    .orderBy('j.name', 'asc')
    .execute();
};

/** @param {number} id */
exports.getById = async function(id) {
  return kysely.selectFrom('junior_club').selectAll().where('id', '=', id).executeTakeFirst();
};

/** @param {JuniorClubData} data */
exports.create = async function(data) {
  const row = await kysely.insertInto('junior_club').values(data).returning('id').executeTakeFirstOrThrow();
  return row.id;
};

/** @param {number} id @param {JuniorClubData} data */
exports.updateById = async function(id, data) {
  await kysely.updateTable('junior_club').set(eb => ({ ...data, updated_at: eb.fn('now') }))
    .where('id', '=', id).execute();
};

/** @param {number} id */
exports.deleteById = async function(id) {
  await kysely.deleteFrom('junior_club').where('id', '=', id).execute();
};
