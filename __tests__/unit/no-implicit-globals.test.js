const fs = require('fs');
const path = require('path');

// `for (row of result)` with no const/let/var assigns a GLOBAL `row` (these files are not
// strict mode), and it outlives the request. EJS resolves a name a template does not get
// in its locals against the globals, so a template guarded by `typeof row !== 'undefined'`
// then believes it was handed one.
//
// That is what broke /player/create (Nov 2026): /info/clubs leaked `row` (a club object)
// from clubController, and from then on every render of player_form on that instance took
// the "Player Created!" branch and threw on row[0].playerId — a 500 until the instance
// recycled. fixtureController leaked `filter` the same way, which is the very name the
// filter-toolbar templates test. Found by e2e/moved-scripts.spec.js under a parallel run.

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['controllers', 'utils', 'models', 'routes', 'middleware', 'db', 'config'];

function sources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// `for (name of|in` straight after the parenthesis: a declared loop variable has
// const/let/var in between, so only the undeclared form matches.
const UNDECLARED_LOOP = /\bfor\s*\(\s*([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g;
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

describe('server code declares its loop variables', () => {
  it('has no `for (x of …)` or `for (x in …)` without const/let/var', () => {
    const files = [...DIRS.flatMap(d => sources(path.join(ROOT, d))), path.join(ROOT, 'app.js')];
    const offences = [];
    for (const file of files) {
      const src = strip(fs.readFileSync(file, 'utf8'));
      for (const m of src.matchAll(UNDECLARED_LOOP)) {
        offences.push(`${path.relative(ROOT, file)}: for (${m[1]} …`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('recognises the undeclared form and only that', () => {
    const hits = s => [...s.matchAll(UNDECLARED_LOOP)].length;
    expect(hits('for (row of result) {}')).toBe(1);
    expect(hits('for(k in obj){}')).toBe(1);
    expect(hits('for (const row of result) {}')).toBe(0);
    expect(hits('for (let i = 0; i < n; i++) {}')).toBe(0);
    expect(hits('for (var k in obj) {}')).toBe(0);
  });
});
