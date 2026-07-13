var db = require('../db_connect.js');

exports.getActive = async function() {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT * FROM homepage_announcement WHERE active = true ORDER BY sort_order ASC, id ASC'
  );
  return rows;
};

exports.getAll = async function() {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT * FROM homepage_announcement ORDER BY sort_order ASC, id ASC'
  );
  return rows;
};

exports.getById = async function(id) {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT * FROM homepage_announcement WHERE id = ?', [id]
  );
  return rows[0];
};

exports.create = async function(data) {
  const [result] = await (await db.otherConnect()).query(
    `INSERT INTO homepage_announcement
      (title, teaser_html, modal_body_html, image_url, show_gallery_link, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.title, data.teaser_html, data.modal_body_html, data.image_url, data.show_gallery_link, data.sort_order, data.active]
  );
  return result;
};

exports.updateById = async function(id, data) {
  const [result] = await (await db.otherConnect()).query(
    `UPDATE homepage_announcement SET
      title = ?, teaser_html = ?, modal_body_html = ?, image_url = ?,
      show_gallery_link = ?, sort_order = ?, active = ?, updated_at = now()
     WHERE id = ?`,
    [data.title, data.teaser_html, data.modal_body_html, data.image_url, data.show_gallery_link, data.sort_order, data.active, id]
  );
  return result;
};

exports.deleteById = async function(id) {
  const [result] = await (await db.otherConnect()).query(
    'DELETE FROM homepage_announcement WHERE id = ?', [id]
  );
  return result;
};
