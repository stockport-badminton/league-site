var db = require('../db_connect.js');

exports.get = async function(key) {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT value FROM site_setting WHERE key = ?', [key]
  );
  return rows[0] ? rows[0].value : undefined;
};

exports.getAll = async function() {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT key, value FROM site_setting ORDER BY key ASC'
  );
  return rows;
};

exports.set = async function(key, value) {
  const [result] = await (await db.otherConnect()).query(
    `INSERT INTO site_setting (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
  return result;
};
