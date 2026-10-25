#!/usr/bin/env node
// Regenerates db/schema.d.ts, the types the typed query layer checks against (REARCH-01).
//
//   npm run db:types              rewrite db/schema.d.ts
//   npm run db:types -- --verify  fail if it is out of date (CI)
//
// From `sdbl_test` — the database `npm run test:db` builds by replaying migrations/ — and
// never from production or the development database. Production is not where the schema
// is defined; migrations are. And `sdbl` picks up whatever `tools/local-db.sh sync` brings
// in (the season archives it creates), so types generated from it would differ between
// one laptop and the next. Run `npm run test:db` first; it rebuilds sdbl_test.
//
// The season archives (team20252026 and the other 52) are left out: a table named by
// splicing in a season cannot be named in a typed query anyway, and REARCH-02 replaces
// them with one history table per entity.
const { spawnSync } = require('child_process');
const path = require('path');
const { testDatabaseUrl } = require('../__tests__/db/helpers/testDatabase');

const root = path.join(__dirname, '..');
const args = [
  'kysely-codegen',
  '--dialect', 'postgres',
  '--url', testDatabaseUrl(),
  '--out-file', path.join(root, 'db', 'schema.d.ts'),
  '--exclude-pattern', 'public.*[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]',
  ...process.argv.slice(2),
];
const run = spawnSync('npx', args, { cwd: root, stdio: 'inherit' });
if (run.status !== 0 && process.argv.includes('--verify')) {
  console.error('\ndb/schema.d.ts does not match the migrations. Run `npm run test:db && npm run db:types` and commit the result.');
}
process.exit(run.status === null ? 1 : run.status);
