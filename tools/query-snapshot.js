#!/usr/bin/env node
// Record what a model function returns against the local database, and say whether a
// later run returns the same.
//
//   node tools/query-snapshot.js club.getContactDetailsById --args args.json --out before.json
//   ...change the query...
//   node tools/query-snapshot.js club.getContactDetailsById --args args.json --compare before.json
//
//   --args FILE      argument sets: [[39], [29]] or {"mellor": [39], "tatton": [29]}.
//                    Omitted, the function is called once with no arguments.
//   --out FILE       write the snapshot
//   --compare FILE   diff against an earlier snapshot; exit 1 on any difference
//   --unordered      with --compare, the same rows in a different order is not a difference
//
// WHY: this is the method that proved HARD-19's 177 alias rewrites inert (421 keys
// snapshotted before and after), made repeatable and extended from keys to values and row
// order. It is how REARCH-01 and REARCH-02 prove a rewrite changes nothing. Argument files
// belong beside the package doing the conversion: they are its evidence.
//
// LOCAL ONLY, the opposite of every other tool here. It calls model functions, and some
// model functions write, so it reads dev.env and never .env, refuses any host that is not
// this machine, and opens every session read-only (default_transaction_read_only) so a
// write function fails rather than writes. Writes are tested in __tests__/db/, inside a
// rolled-back transaction.
//
// An error is a result too: a rewrite that starts throwing is recorded as {$error} and
// compares unequal. A function whose answer depends on NOW() will differ between days;
// snapshot and compare in the same sitting.
const fs = require('fs');
const path = require('path');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function usage(msg) {
  if (msg) console.error(msg + '\n');
  console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 14)
    .map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(2);
}

function parseArgv(argv) {
  const opts = { unordered: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--args') opts.args = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--compare') opts.compare = argv[++i];
    else if (a === '--unordered') opts.unordered = true;
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else if (!opts.target) opts.target = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!opts.target || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_$]+$/.test(opts.target)) usage('name a function as <model>.<function>');
  return opts;
}

// The connection string, checked and made read-only. Exported for its test.
function localReadOnlyUrl(raw) {
  if (!raw) throw new Error('DATABASE_URL is not set (dev.env should point at tools/local-db.sh url)');
  const url = new URL(raw);
  if (/supabase/i.test(url.hostname) || !LOOPBACK.has(url.hostname)) {
    throw new Error(`refusing ${url.hostname}: this tool runs against the local database only`);
  }
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  return url.toString();
}

function loadCases(file) {
  if (!file) return [{ label: '0', args: [] }];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed.map((a, i) => [String(i), a]) : Object.entries(parsed);
  for (const [label, args] of entries) {
    if (!Array.isArray(args)) throw new Error(`case ${label}: each argument set must be an array, e.g. [39]`);
  }
  return entries.map(([label, args]) => ({ label, args }));
}

// JSON cannot tell a Date from a string or keep a Buffer or an undefined key, and each of
// those is a difference worth seeing, so they are tagged rather than flattened.
function normalise(v) {
  if (v === undefined) return { $undefined: true };
  if (v === null || typeof v !== 'object') return typeof v === 'bigint' ? { $bigint: String(v) } : v;
  if (v instanceof Date) return { $date: isNaN(v) ? 'Invalid Date' : v.toISOString() };
  if (Buffer.isBuffer(v)) return { $bytes: v.toString('base64') };
  if (Array.isArray(v)) return v.map(normalise);
  const out = {};
  for (const k of Object.keys(v)) out[k] = normalise(v[k]);
  return out;
}

// Key order is not significant (a consumer reads by name); key SET is.
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Walks two results in parallel. Paths inside arrays are kept, but key differences are
// reported once per shape ([] for any index): a folded alias is the same finding on every
// row, and 400 copies of it would bury everything else.
function diff(before, after, opts) {
  const keyDiffs = new Map();
  const others = [];

  const walk = (a, b, p, shape) => {
    if (canonical(a) === canonical(b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        others.push(`${p || '(result)'}: ${a.length} rows before, ${b.length} after`);
      } else if (canonical([...a].map(canonical).sort()) === canonical([...b].map(canonical).sort())) {
        if (!opts.unordered) others.push(`${p || '(result)'}: same ${a.length} rows, different order`);
        return;
      }
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) walk(a[i], b[i], `${p}[${i}]`, `${shape}[]`);
      return;
    }
    if (isPlain(a) && isPlain(b)) {
      const ka = Object.keys(a), kb = Object.keys(b);
      const gone = ka.filter(k => !(k in b)), added = kb.filter(k => !(k in a));
      if (gone.length || added.length) {
        const key = `${shape || '(result)'}|${gone}|${added}`;
        if (!keyDiffs.has(key)) keyDiffs.set(key, { shape: shape || '(result)', gone, added, count: 0 });
        keyDiffs.get(key).count++;
      }
      for (const k of ka.filter(k => k in b)) walk(a[k], b[k], `${p}.${k}`, `${shape}.${k}`);
      return;
    }
    others.push(`${p || '(result)'}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  };

  walk(before, after, '', '');
  const lines = [];
  for (const d of keyDiffs.values()) {
    const where = d.count > 1 ? `${d.shape} (${d.count} objects)` : d.shape;
    if (d.gone.length) lines.push(`${where}: keys only before: ${d.gone.join(', ')}`);
    if (d.added.length) lines.push(`${where}: keys only after:  ${d.added.join(', ')}`);
  }
  return lines.concat(others);
}

// What a result looks like, for the console: how many rows, which keys.
function describe(result) {
  if (isPlain(result) && result.$error) return `ERROR ${result.$error}`;
  if (Array.isArray(result)) {
    const keys = isPlain(result[0]) ? Object.keys(result[0]) : [];
    return `${result.length} rows` + (keys.length ? `; keys: ${keys.join(', ')}` : '');
  }
  if (isPlain(result)) return `object; keys: ${Object.keys(result).join(', ')}`;
  return JSON.stringify(result);
}

async function snapshot(target, cases) {
  const [model, fn] = target.split('.');
  const file = path.join(__dirname, '..', 'models', model + '.js');
  if (!fs.existsSync(file)) throw new Error(`no such model: models/${model}.js`);
  const mod = require(file);
  if (typeof mod[fn] !== 'function') throw new Error(`models/${model}.js exports no function ${fn}`);

  const out = [];
  for (const c of cases) {
    // Some models print their SQL; that is noise here, and it once carried DB_PI_KEY.
    const log = console.log;
    console.log = () => {};
    let result;
    try {
      result = normalise(await mod[fn](...c.args));
    } catch (err) {
      result = { $error: err.message };
    } finally {
      console.log = log;
    }
    out.push({ label: c.label, args: c.args, result });
  }
  return out;
}

async function main() {
  // Here rather than at the top, so requiring this file for its test loads no env file.
  require('./lib/loadEnv').loadEnv({ localOnly: true });
  const opts = parseArgv(process.argv.slice(2));
  let cases;
  try {
    process.env.DATABASE_URL = localReadOnlyUrl(process.env.DATABASE_URL);
    cases = loadCases(opts.args);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const db = require('../db_connect.js');
  db.connect();
  let results;
  try {
    results = await snapshot(opts.target, cases);
  } catch (err) {
    console.error(err.message);
    await db.end();
    process.exit(2);
  }
  await db.end();

  const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
  for (const r of results) console.log(`  ${r.label}: ${describe(r.result)}`);

  if (opts.out) {
    const snap = { function: opts.target, database: dbName, taken: new Date().toISOString(), cases: results };
    fs.writeFileSync(opts.out, JSON.stringify(snap, null, 2) + '\n');
    console.log(`snapshot written: ${opts.out}`);
  }

  if (opts.compare) {
    const before = JSON.parse(fs.readFileSync(opts.compare, 'utf8'));
    if (before.function !== opts.target) {
      console.error(`${opts.compare} is a snapshot of ${before.function}, not ${opts.target}`);
      process.exit(2);
    }
    const now = new Map(results.map(r => [r.label, r]));
    const then = new Map(before.cases.map(r => [r.label, r]));
    let differences = 0;
    for (const label of new Set([...then.keys(), ...now.keys()])) {
      const a = then.get(label), b = now.get(label);
      const lines = !a ? ['case only in this run']
        : !b ? ['case only in the snapshot']
        : canonical(a.args) !== canonical(b.args) ? [`arguments differ: ${JSON.stringify(a.args)} → ${JSON.stringify(b.args)}`]
        : diff(a.result, b.result, opts);
      if (!lines.length) continue;
      differences += lines.length;
      console.log(`\n✗ case ${label} ${JSON.stringify((a || b).args)}`);
      for (const l of lines.slice(0, 25)) console.log(`    ${l}`);
      if (lines.length > 25) console.log(`    …and ${lines.length - 25} more`);
    }
    if (differences) {
      console.log(`\nDIFFERENT from ${opts.compare} (taken ${before.taken})`);
      process.exit(1);
    }
    console.log(`identical to ${opts.compare}: ${results.length} case(s)${opts.unordered ? ', row order ignored' : ''}`);
  }
}

if (require.main === module) main();

module.exports = { localReadOnlyUrl, normalise, diff, canonical };
