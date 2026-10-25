// Builds the `db` project's database from nothing, once per run: drop it, create it,
// replay every migration, load the synthetic seed.
//
// Replayed from Node, not with psql, because CI's node:22 image has no psql. The rule is
// tools/local-db.sh's, kept identical so the two cannot disagree about whether the
// migrations load: statements run one at a time; an "already exists" is a migration that
// is a no-op against a freshly built schema (003 adds a column 002 now creates) and ends
// that file, as psql's ON_ERROR_STOP does; any other error stops the run.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { splitStatements } = require('../../utils/sqlScan');
const { testDatabaseUrl, withDatabase } = require('./helpers/testDatabase');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const SEED = path.join(ROOT, 'tools', 'local-db', 'test-seed.sql');

function migrationFiles() {
  const rest = fs.readdirSync(MIGRATIONS)
    .filter(f => /^0\d.*\.sql$/.test(f) && f !== '001_initial.sql')
    .sort();
  return ['001_initial.sql', ...rest];
}

async function replay(client, file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  for (const statement of splitStatements(sql)) {
    try {
      await client.query(statement);
    } catch (err) {
      if (/already exists/i.test(err.message)) return `no-op: ${err.message}`;
      err.message = `${file}: ${err.message}`;
      throw err;
    }
  }
  return null;
}

module.exports = async function globalSetup() {
  // The declared test environment, for DB_PI_KEY: the seed must encrypt under the key the
  // test workers will decrypt with. globalSetup runs before any setupFiles.
  require('../setup.js');
  const url = testDatabaseUrl();
  const name = new URL(url).pathname.slice(1);
  const started = Date.now();

  const admin = new Client({ connectionString: withDatabase(url, 'postgres') });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`db suite: cannot reach ${new URL(url).host} (${err.message}). ` +
      'Locally: tools/local-db.sh up. Or set TEST_DATABASE_URL.');
  }
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const noops = [];
    for (const file of migrationFiles()) {
      const noop = await replay(client, file);
      if (noop) noops.push(`${file} (${noop})`);
    }
    await client.query("SELECT set_config('sdbl.test_key', $1, false)", [process.env.DB_PI_KEY]);
    // One simple-protocol query: the seed is all-or-nothing.
    await client.query(fs.readFileSync(SEED, 'utf8'));
    if (process.env.DB_SUITE_VERBOSE) {
      console.log(`\n${name} built in ${Date.now() - started}ms; no-op migrations: ${noops.join('; ') || 'none'}`);
    }
  } finally {
    await client.end();
  }
};

module.exports.migrationFiles = migrationFiles;
