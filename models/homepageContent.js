// @ts-check
const { kysely } = require('../db');

/**
 * @typedef {{ title: string, teaser_html: string, modal_body_html: string | null,
 *   image_url: string | null, show_gallery_link: boolean, sort_order: number,
 *   active: boolean }} Announcement
 */

exports.getActive = async function() {
  return kysely.selectFrom('homepage_announcement').selectAll()
    .where('active', '=', true).orderBy('sort_order', 'asc').orderBy('id', 'asc').execute();
};

exports.getAll = async function() {
  return kysely.selectFrom('homepage_announcement').selectAll()
    .orderBy('sort_order', 'asc').orderBy('id', 'asc').execute();
};

/** @param {number} id */
exports.getById = async function(id) {
  return kysely.selectFrom('homepage_announcement').selectAll().where('id', '=', id).executeTakeFirst();
};

// The three writes return nothing. They used to return the wrapper's rows array, and
// homepageContentController, their only caller, never read it.

/** @param {Announcement} data */
exports.create = async function(data) {
  await kysely.insertInto('homepage_announcement').values({
    title: data.title, teaser_html: data.teaser_html, modal_body_html: data.modal_body_html,
    image_url: data.image_url, show_gallery_link: data.show_gallery_link,
    sort_order: data.sort_order, active: data.active,
  }).execute();
};

/** @param {number} id @param {Announcement} data */
exports.updateById = async function(id, data) {
  await kysely.updateTable('homepage_announcement').set(eb => ({
    title: data.title, teaser_html: data.teaser_html, modal_body_html: data.modal_body_html,
    image_url: data.image_url, show_gallery_link: data.show_gallery_link,
    sort_order: data.sort_order, active: data.active, updated_at: eb.fn('now'),
  })).where('id', '=', id).execute();
};

/** @param {number} id */
exports.deleteById = async function(id) {
  await kysely.deleteFrom('homepage_announcement').where('id', '=', id).execute();
};
