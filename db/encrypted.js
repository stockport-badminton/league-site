// @ts-check
// The only way a Kysely query touches an encrypted column.
//
// `player."playerEmail"`, `"playerTel"`, `"authEmail"` and `social_token.token` are
// pgp_sym_encrypt'd bytea under DB_PI_KEY. HARD-27 found the key pasted into SQL text in
// three functions, one of them with `console.log(sql)` above it, so the key went to Cloud
// Logging on every distribution-list send. `no-secrets-in-sql.test.js` guards the string
// queries by reading them; these helpers make the mistake unwritable instead — the key
// goes in as a bound parameter because there is no other way to give it to them.
//
//   kysely.selectFrom('player as p')
//     .select(eb => decrypt(eb.ref('p.playerEmail')).as('playerEmail'))
//
// Both read the key when the query is BUILT, not when the module loads, so a test that
// sets DB_PI_KEY in setup.js is honoured, and a process without one fails at the query
// that needed it rather than quietly decrypting to NULL.
const { sql } = require('kysely');

function key() {
  const k = process.env.DB_PI_KEY;
  if (!k) throw new Error('DB_PI_KEY is not set: cannot read or write an encrypted column');
  return k;
}

/**
 * `pgp_sym_encrypt(value, key)`, for an INSERT or UPDATE of an encrypted column.
 * @param {string | null} value
 * @returns {import('kysely').RawBuilder<Buffer>}
 */
function encrypt(value) {
  return sql`pgp_sym_encrypt(${value}, ${key()})`;
}

/**
 * `pgp_sym_decrypt(column, key)::text`. Takes a column EXPRESSION (`eb.ref('p.playerEmail')`),
 * not a name, so the column is checked against the schema types like any other.
 *
 * The `::text` is what every string query writes today. It changes nothing —
 * pgp_sym_decrypt already returns text — and is kept so a converted query compiles to the
 * same SQL as the one it replaces.
 *
 * @param {import('kysely').Expression<Buffer | null>} column
 * @returns {import('kysely').RawBuilder<string | null>}
 */
function decrypt(column) {
  return sql`pgp_sym_decrypt(${column}, ${key()})::text`;
}

module.exports = { encrypt, decrypt };
