// @ts-check
const { kysely } = require('../db');

/** @param {string} key */
exports.get = async function(key) {
  const row = await kysely.selectFrom('site_setting').select('value')
    .where('key', '=', key).executeTakeFirst();
  return row ? row.value : undefined;
};

exports.getAll = async function() {
  return kysely.selectFrom('site_setting').select(['key', 'value'])
    .orderBy('key', 'asc').execute();
};

// Returns nothing. It used to return the wrapper's rows array — empty, with
// affectedRows hung off it — and its one caller (siteSettingsController.update) never
// read it.
/** @param {string} key @param {string} value */
exports.set = async function(key, value) {
  await kysely.insertInto('site_setting').values({ key, value })
    .onConflict(oc => oc.column('key').doUpdateSet({ value: eb => eb.ref('excluded.value') }))
    .execute();
};
