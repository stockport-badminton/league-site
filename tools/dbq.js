#!/usr/bin/env node
// Read-only query runner for the league database.
//
//   node tools/dbq.js "SELECT id, name FROM team LIMIT 5"
//   node tools/dbq.js --json "SELECT ..."          machine-readable
//   node tools/dbq.js --file q.sql                 query from a file
//   node tools/dbq.js --schema player              columns of one table
//   node tools/dbq.js --check                      list the audit checks
//   node tools/dbq.js --check orphan-results       run one (see tools/audit/checks.js)
//
// Why this exists: every diagnostic session re-wrote the same twenty lines of
// dotenv + db.connect() + otherConnect() boilerplate, in a temp file that had to
// live in the project root because that is where dotenv looks. That is a lot of
// tokens to spend on saying "SELECT".
//
// **DATABASE_URL is production.** dev.env carries the same connection string as
// .env, so there is no local copy to practise on. This tool therefore refuses
// anything that is not a single read: no INSERT/UPDATE/DELETE, no DDL, no
// multiple statements. Writes belong in a reviewed script under scripts/, with a
// dry run, the way scripts/backfill-contact-emails.js does it.

require('dotenv').config({ path: require('path').join(__dirname, '../dev.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const db = require('../db_connect.js');

// A read is SELECT, or a WITH whose body is a SELECT. Everything else is refused
// before it reaches the server — a guard here is cheaper than a restore.
const READ_ONLY = /^\s*(select|with|explain|show)\b/i;
const FORBIDDEN = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|copy|vacuum)\b/i;

function assertReadOnly(sql) {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  // A `--` comment can legitimately contain a semicolon, and one in an audit check's
  // explanatory comment used to be rejected as "multiple statements". Same blind spot
  // HARD-18 records for run-migration.js, which splits on `;` with no regard for comments.
  //
  // Only the multi-statement test looks at the stripped text. Everything below still runs
  // against the WHOLE query, so a write keyword hidden after a comment is still caught —
  // and stripping comments can only reveal more of the statement to those tests, never
  // less.
  const withoutComments = trimmed.replace(/--[^\n]*/g, '');
  if (withoutComments.includes(';')) {
    throw new Error('multiple statements are not allowed — run one query at a time');
  }
  if (!READ_ONLY.test(trimmed)) {
    throw new Error('only SELECT / WITH / EXPLAIN / SHOW are allowed here.\n' +
      'A write belongs in a reviewed script under scripts/ with a dry run — see scripts/backfill-contact-emails.js.');
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new Error('query contains a write keyword; refusing to run it against production');
  }
  return trimmed;
}

// Column widths from the data, so output stays readable without a formatter.
function renderTable(rows) {
  if (!rows.length) return '(no rows)';
  const cols = Object.keys(rows[0]);
  const show = v => v === null ? 'NULL'
    : v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ')
    : Buffer.isBuffer(v) ? `<${v.length} bytes>`
    : typeof v === 'object' ? JSON.stringify(v)
    : String(v);
  const w = {};
  cols.forEach(c => {
    w[c] = Math.min(48, Math.max(c.length, ...rows.map(r => show(r[c]).length)));
  });
  const line = cols.map(c => '─'.repeat(w[c])).join('─┼─');
  const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  const out = [
    cols.map(c => pad(c, w[c])).join(' │ '),
    line,
    ...rows.map(r => cols.map(c => pad(show(r[c]), w[c])).join(' │ '))
  ];
  return out.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const rest = argv.filter(a => a !== '--json');

  db.connect();
  const conn = await db.otherConnect();

  let sql;
  let label = null;

  if (rest[0] === '--schema') {
    sql = `SELECT column_name, data_type, is_nullable FROM information_schema.columns
           WHERE table_name = '${String(rest[1] || '').replace(/[^a-zA-Z0-9_]/g, '')}'
           ORDER BY ordinal_position`;
  } else if (rest[0] === '--check') {
    const checks = require('./audit/checks.js');
    if (!rest[1]) {
      console.log('Checks available (node tools/dbq.js --check <name>):\n');
      checks.all().forEach(c => console.log(`  ${c.name.padEnd(22)} ${c.description}`));
      console.log('\n  --check all            run every check and summarise');
      process.exit(0);
    }
    if (rest[1] === 'all') {
      const results = await checks.runAll(conn);
      if (json) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }
      results.forEach(r => {
        const flag = r.rows.length ? '!' : '·';
        console.log(`${flag} ${r.name.padEnd(22)} ${String(r.rows.length).padStart(5)}  ${r.description}`);
      });
      const bad = results.filter(r => r.rows.length).length;
      console.log(`\n${bad} of ${results.length} checks found something. ` +
        `Run one by name to see the rows.`);
      process.exit(0);
    }
    const check = checks.get(rest[1]);
    if (!check) throw new Error(`no such check: ${rest[1]}`);
    sql = check.sql;
    label = check.description;
  } else if (rest[0] === '--file') {
    sql = fs.readFileSync(rest[1], 'utf8');
  } else {
    sql = rest.join(' ');
  }

  if (!sql || !sql.trim()) {
    console.error(fs.readFileSync(__filename, 'utf8').split('\n')
      .slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(1);
  }

  const [rows] = await conn.query(assertReadOnly(sql));
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    if (label) console.log(`${label}\n`);
    console.log(renderTable(rows));
    console.log(`\n(${rows.length} row${rows.length === 1 ? '' : 's'})`);
  }
  process.exit(0);
}

// The guard is the only thing between a typo and production data, so it is exported and
// tested directly (__tests__/unit/dbq-guard.test.js) rather than trusted. `require.main`
// keeps the CLI behaviour identical: importing this file must not run a query.
if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { assertReadOnly };
