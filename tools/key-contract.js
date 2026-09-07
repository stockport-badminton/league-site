#!/usr/bin/env node
// Do the consumers read the keys the queries actually return?
//
//   node tools/key-contract.js            report suspects
//   node tools/key-contract.js --json      machine-readable
//   node tools/key-contract.js --coverage  also list functions that returned no rows
//
// WHY THIS CANNOT BE A UNIT TEST
//
// `__tests__/unit/sql-alias-quoting.test.js` stops a new camelCase-unquoted alias being
// written. It cannot find a broken CONSUMER, because it compares SQL against itself and
// never sees what JavaScript reads. Neither can the Jest suite: these failures are silent
// (a blank cell, an always-false comparison), most of these queries have no test at all,
// and a test whose mock spells the key camelCase PASSES against the bug — the same trap
// CLAUDE.md records for mocking `{ insertId: 42 }`.
//
// The only reliable source of truth is the database's own reply. So this runs each
// read-only model function and reads `Object.keys()` off a real row.
//
// THE SIGNATURE it looks for: a property read somewhere in views/ or controllers/ whose
// LOWERCASE form is a real output key but whose camelCase form is not. That is exactly
// what a folded alias plus a camelCase reader looks like, and a name that belongs to some
// unrelated object matches nothing, so ordinary JavaScript does not generate noise.
//
// IT REPORTS SUSPECTS, NOT BUGS. It matches on names, not on which query feeds which
// view, so a name that one query folds and another quotes will be flagged even where the
// reader is fed by the second. Every hit needs the producer confirmed by hand — of the
// nine it first reported, three were OCR constants and four were fed by a different
// function that quotes properly. Two were real:
//   - /club-api consumers reading teamName/matchSecEmail/teamCaptainEmail (fixed)
//   - fixtures-results.ejs reading homeClubName (recorded; the links it guards are dead)
//
// Read-only. It calls nothing whose name suggests a write, because DATABASE_URL is
// production. Model stdout is silenced: models/players.js logs its SQL and that SQL has
// DB_PI_KEY interpolated as a literal (HARD-27), so running it would print the key.
require('dotenv').config({ path: require('path').join(__dirname, '../dev.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db_connect.js');
const season = require('../models/season');

const ROOT = path.join(__dirname, '..');
const JSON_OUT = process.argv.includes('--json');
const COVERAGE = process.argv.includes('--coverage');

const MODELS = fs.readdirSync(path.join(ROOT, 'models'))
  .filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''))
  .filter(n => !['userInViews', 'auth', 'spamControls'].includes(n));

const READ  = /^(get|find|search|list|count|all|recent)/i;
const NEVER = /(create|update|delete|remove|insert|set[A-Z]|save|send|write|add|batch|zap|rearrange|withdraw|release|move|attach|transfer|record|renumber|log)/i;

// Argument shapes worth trying. The first that yields a row wins — this is about the
// SHAPE of the result, so any row will do.
const ARGS = [
  [], [{}], [{ status: 'outstanding' }], [{ status: 'complete' }],
  [{ season: '20262027' }], ['20262027'],
  [39], ['39'], [1], [8], [29], [24], [7313],
  [{ team: 29 }], [{ club: 39 }], [{ division: 8 }], [{ teamid: 29 }], [{ clubid: 39 }],
  ['Mellor'], ['Mellor A'], [{ limit: 2 }], [{ gender: 'Male' }], [29, 'Male'],
];

const silence = () => {
  const log = console.log;
  console.log = () => {};
  return () => { console.log = log; };
};

async function outputKeys() {
  const keys = {};
  const noRows = [];
  for (const name of MODELS) {
    let mod;
    try { mod = require(path.join(ROOT, 'models', name)); } catch (e) { continue; }
    for (const fn of Object.keys(mod)) {
      if (typeof mod[fn] !== 'function' || !READ.test(fn) || NEVER.test(fn)) continue;
      let got = false;
      for (const args of ARGS) {
        const restore = silence();
        try {
          const out = await mod[fn](...args);
          restore();
          // Rows, or a plain object, or one nesting objects — getClubRegistration
          // returns { core, teams }, and leaving its keys out of the picture is what made
          // documentsController's four correct camelCase reads look like bugs.
          const collected = new Set();
          const harvest = (v, depth) => {
            if (!v || typeof v !== 'object' || depth > 2) return;
            if (Array.isArray(v)) { harvest(v[0], depth + 1); return; }
            Object.keys(v).forEach(k => collected.add(k));
            Object.values(v).forEach(x => harvest(x, depth + 1));
          };
          harvest(out, 0);
          if (collected.size) {
            keys[`${name}.${fn}`] = [...collected].sort();
            got = true;
            break;
          }
        } catch (e) { restore(); }
      }
      if (!got) noRows.push(`${name}.${fn}`);
    }
  }
  return { keys, noRows };
}

// Comments are stripped first. Without it, the comment written to explain a fix reports
// the fix as a bug: this tool flagged `matchSecEmail` in views/fixtures-results.ejs from
// the note saying not to use it. Four scanners in this repo have now been caught by
// comments they did not strip — run-migration.js (HARD-18), tools/dbq.js, the
// runtime-requires guard, and this.
function stripComments(src) {
  return src
    .replace(/<%#[\s\S]*?%>/g, '')        // EJS comment
    .replace(/\/\*[\s\S]*?\*\//g, '')     // block comment
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1'); // line comment, sparing a URL's //
}

function camelCaseReads() {
  // A Map, not an object: a property name like `constructor` or `toString` resolves
  // through Object.prototype, so `if (!reads[n])` is skipped and `.add` is not a
  // function. Every read name here comes from source text, so any of them can appear.
  const reads = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(ejs|js)$/.test(entry.name)) continue;
      const src = stripComments(fs.readFileSync(p, 'utf8'));
      const re = /\.([A-Za-z_][A-Za-z0-9_]*)\b|\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\]/g;
      let m;
      while ((m = re.exec(src))) {
        const n = m[1] || m[2];
        // SCREAMING_CASE is a constant by JS convention, not a database field: the OCR
        // code's DATE/DIVISION/LEAGUE region names matched `date`/`division`/`league`
        // purely by spelling.
        if (n === n.toUpperCase()) continue;
        if (n !== n.toLowerCase()) {
          if (!reads.has(n)) reads.set(n, new Set());
          reads.get(n).add(path.relative(ROOT, p));
        }
      }
    }
  };
  walk(path.join(ROOT, 'views'));
  walk(path.join(ROOT, 'controllers'));
  return reads;
}

(async () => {
  db.connect();
  await season.init();
  const { keys, noRows } = await outputKeys();

  const all = new Set();
  Object.values(keys).forEach(ks => ks.forEach(k => all.add(k)));
  const foldedOnly = new Set([...all].map(k => k.toLowerCase()));

  const reads = camelCaseReads();
  const suspects = [];
  for (const [name, files] of reads) {
    const low = name.toLowerCase();
    if (foldedOnly.has(low) && !all.has(name)) {
      suspects.push({
        read: name,
        returnedAs: low,
        producers: Object.keys(keys).filter(q => keys[q].includes(low)),
        files: [...files].sort(),
      });
    }
  }
  suspects.sort((a, b) => a.read.localeCompare(b.read));

  if (JSON_OUT) {
    console.log(JSON.stringify({ suspects, queries: Object.keys(keys).length,
                                 distinctKeys: all.size, noRows }, null, 2));
    process.exit(0);
  }

  console.log(`${Object.keys(keys).length} read functions returned a row; ` +
              `${all.size} distinct output keys.`);
  console.log(`${reads.size} camelCase names read in views/ and controllers/.\n`);
  if (!suspects.length) {
    console.log('No suspects: every camelCase read has a matching output key.');
  } else {
    console.log(`${suspects.length} suspect(s) — confirm the producer of each by hand:\n`);
    for (const s of suspects) {
      console.log(`  ${s.read}  <- returned as '${s.returnedAs}'`);
      console.log(`      by:   ${s.producers.slice(0, 4).join(', ')}` +
                  (s.producers.length > 4 ? ' ...' : ''));
      s.files.forEach(f => console.log(`      read: ${f}`));
      console.log('');
    }
  }
  if (COVERAGE) {
    console.log(`\n${noRows.length} read function(s) returned no rows, so are unchecked:`);
    noRows.forEach(f => console.log('   ' + f));
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
