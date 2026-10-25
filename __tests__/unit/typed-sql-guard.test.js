// The typed query layer stays typed (REARCH-01).
//
// Kysely checks a query against db/schema.d.ts only where the query is written with the
// builder. It has two escape hatches, and either one turns a converted function back into
// the thing it replaced:
//
// - `sql.raw(string)` pastes a string into the statement. It is how string-built SQL, and
//   with it a pasted DB_PI_KEY (HARD-27), gets back in.
// - a `sql` template without a type is `RawBuilder<unknown>`: legal SQL, unchecked result.
//   In JavaScript a template cannot take a type argument, so typing one means a JSDoc
//   cast: `/** @type {import('kysely').RawBuilder<number>} */ (sql`count(*)::int`)`.
//   The cast is an assertion nothing verifies; its value is that the type is stated where
//   a reviewer sees it, instead of an `unknown` spreading silently into the caller.
//
// And a file is only checked at all if it opts in with `// @ts-check` (tsconfig.json
// says why checkJs is off), so a converted model that forgets the line is unchecked
// while looking converted. Every file that uses the layer must carry it.
//
// The 14 season-switched functions REARCH-02 owns are what an untyped template is for —
// a table name built from a season cannot be typed. They will be the allowlist's entries
// if they are ever written against this layer before REARCH-02 replaces the archives.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const DIRS = ['db', 'models', 'controllers', 'utils', 'routes', 'middleware'];

// File (repo-relative) → why it may build an untyped `sql` template.
const UNTYPED_ALLOWED = {
  // Each helper declares its result with @returns. That is a DECLARATION, not a check —
  // tsc infers the template's type from whatever @returns says (tried: RawBuilder<number>
  // on encrypt() passes). So are the casts the rule below asks for, and so is `sql<Row>`
  // in TypeScript. What the rule buys is that every unchecked type is written down where
  // a reviewer reads it, which is why this list should stay short.
  'db/encrypted.js': 'two helpers, types declared by @returns',
};

function sources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const CAST = '__JSDOC_CAST__';
// A JSDoc type cast is a comment that carries meaning here, so it survives as a token;
// every other comment goes. Five scanners in this repo were caught out by comment text.
const strip = src => src
  .replace(/\/\*\*\s*@type\s*\{[\s\S]*?\}\s*\*\//g, CAST)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

const USES_LAYER = /require\(\s*['"](kysely|(?:\.\.?\/)+db(?:\/\w+)?)['"]\s*\)/;
const RAW = /\bsql\s*\.\s*raw\s*\(/;

function untypedTemplates(src) {
  const out = [];
  const re = /\bsql\s*`/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(0, m.index);
    if (!new RegExp(`${CAST}\\s*\\(\\s*$`).test(before)) {
      out.push(before.split('\n').length);
    }
  }
  return out;
}

const rel = f => path.relative(root, f).split(path.sep).join('/');
const files = DIRS.flatMap(d => sources(path.join(root, d)));
const inLayer = file => rel(file).startsWith('db/') || USES_LAYER.test(strip(fs.readFileSync(file, 'utf8')));

describe('the typed query layer stays typed', () => {
  it('every file that uses it opts in to type checking', () => {
    const missing = files.filter(inLayer)
      .filter(f => !/^\/\/ @ts-check\s*$/m.test(fs.readFileSync(f, 'utf8').split('\n')[0]))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it('nothing pastes a string into a statement with sql.raw', () => {
    const offenders = files.filter(f => RAW.test(strip(fs.readFileSync(f, 'utf8')))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('every sql template outside the allowlist has a type', () => {
    const offenders = [];
    for (const f of files) {
      if (UNTYPED_ALLOWED[rel(f)]) continue;
      for (const line of untypedTemplates(strip(fs.readFileSync(f, 'utf8')))) {
        offenders.push(`${rel(f)}:~${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A guard that has quietly stopped matching passes for the wrong reason.
  it('recognises what it is looking for, so it cannot pass by failing to look', () => {
    expect(RAW.test(strip('q.where(sql.raw(`name = \'${x}\'`))'))).toBe(true);
    expect(RAW.test(strip('// never sql.raw(x)\nconst a = 1;'))).toBe(false);

    expect(untypedTemplates(strip('const n = sql`count(*)`;'))).toEqual([1]);
    expect(untypedTemplates(strip(
      "const n = /** @type {import('kysely').RawBuilder<number>} */ (sql`count(*)::int`);"))).toEqual([]);
    // An ordinary comment in front is not a cast.
    expect(untypedTemplates(strip('const n = /* count */ (sql`count(*)`);'))).toEqual([1]);

    expect(USES_LAYER.test("const { kysely } = require('../db');")).toBe(true);
    expect(USES_LAYER.test("const { sql } = require('kysely');")).toBe(true);
    expect(USES_LAYER.test("const db = require('../db_connect');")).toBe(false);
  });

  it('scans the files that matter', () => {
    expect(files.map(rel)).toEqual(expect.arrayContaining(['db/index.js', 'db/kysely.js', 'models/players.js']));
    expect(files.filter(inLayer).map(rel)).toEqual(expect.arrayContaining(['db/index.js']));
  });
});
