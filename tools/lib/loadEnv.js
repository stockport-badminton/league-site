// Which database a tool talks to, decided in one place.
//
// dotenv does not overwrite a variable that is already set, so whichever env file loads
// FIRST wins. Every tool here used to load dev.env first and .env second. That was
// harmless for as long as dev.env carried the same connection string as .env — and wrong
// the instant HARD-13 pointed dev.env at a local Postgres.
//
// The failure was silent and, for an audit tool, the worst available: `dbq --check all`
// kept running and kept printing counts, against a two-year-old local seed rather than
// production. It surfaced only because a query returned "no rows" for drafts that plainly
// existed.
//
// So the order is no longer a thing each tool gets right or wrong. Production is the
// default, because that is what these tools are for; asking for the development database
// is explicit.
const path = require('path');

//
// `localOnly` is for a tool that must never see production at all — query-snapshot.js
// calls model functions, and some model functions write. `local` still loads .env second,
// which fills in every live credential dev.env does not override; `localOnly` never reads
// .env, so nothing production-shaped is even in the process.
/**
 * @param {{ local?: boolean, localOnly?: boolean }} [opts] local: true loads the
 *   development database first; localOnly: true loads dev.env and nothing else.
 */
function loadEnv(opts) {
  const local = !!(opts && opts.local);
  const at = name => path.join(__dirname, '..', '..', name);
  if (opts && opts.localOnly) {
    require('dotenv').config({ path: at('dev.env') });
    return { local: true };
  }
  const order = local ? ['dev.env', '.env'] : ['.env', 'dev.env'];
  for (const file of order) require('dotenv').config({ path: at(file) });
  return { local };
}

module.exports = { loadEnv };
