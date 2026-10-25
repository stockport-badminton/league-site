// @ts-check
// The typed query layer (REARCH-01). A converted model function does
//
//   const { kysely } = require('../db');
//   const rows = await kysely.selectFrom('team').select(['id', 'name']).execute();
//
// instead of `(await db.otherConnect()).query(string, params)`. Inside db.withTransaction
// it uses the second argument instead — see db/kysely.js for why that matters.
//
// The types in db/schema.d.ts are generated from a database built by replaying
// migrations/ — never from production — by `npm run db:types`. CI regenerates them and
// fails if they differ, so a migration and its types land together.
const connection = require('../db_connect');
const { overPool } = require('./kysely');
const { encrypt, decrypt } = require('./encrypted');

const kysely = overPool(connection.pool);

module.exports = { kysely, encrypt, decrypt };
