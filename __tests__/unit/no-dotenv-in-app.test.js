// Only config/index.js loads .env, and never under NODE_ENV=test (REARCH-06).
//
// clubController and contactusController each called require('dotenv').config() as they
// loaded. dotenv fills only variables that are not already set, and __tests__/setup.js
// deletes every live credential, so any test that loaded app.js had them all put back from
// the developer's .env: cron tokens, AWS keys, TAMESIDE_DATABASE_URL. Found 30 Oct 2026 when
// the team-strength import test read Tameside's production database. CI has no .env, which
// is why nothing failed there.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP_DIRS = ['controllers', 'routes', 'models', 'utils', 'middleware', 'db', 'config'];
const ALLOWED = new Set(['config/index.js']);

function files(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}

it('no app code loads .env except config/index.js', () => {
  const offenders = [...APP_DIRS.flatMap(files), 'app.js', 'db_connect.js']
    .filter(f => !ALLOWED.has(f))
    .filter(f => /require\(\s*['"]dotenv['"]\s*\)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^\s*\/\/.*$/gm, '')));
  expect(offenders).toEqual([]);
});

it('loading the app leaves the test environment without live credentials', () => {
  expect(process.env.TAMESIDE_DATABASE_URL).toBeUndefined();
  require('../../app');
  expect(process.env.TAMESIDE_DATABASE_URL).toBeUndefined();
  expect(process.env.AUDIT_CRON_TOKEN).toBeUndefined();
});
