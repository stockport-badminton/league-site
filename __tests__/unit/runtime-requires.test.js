// Every module the running app requires must be a production dependency.
//
// `models/fixture.js` did `require('canvas')` inside `sendResultZap` for nearly four
// months after `e25436f` removed canvas from package.json. That commit converted
// socialController.js to sharp and touched three files; this call site was not one of
// them. Nothing caught it because the require is LAZY — inside a function, on a path that
// only runs when a result is submitted — so the app booted fine, the tests passed, and it
// threw `Cannot find module 'canvas'` on every submitted result instead.
//
// The check is against `dependencies` only, not devDependencies: the Dockerfile runs
// `npm ci --omit=dev`, so a devDependency required at runtime is exactly as missing in
// production as one that was never installed.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(pkg.dependencies || {}));

// What the container actually runs. Deliberately not tools/ or scripts/, which are run by
// hand on a machine with devDependencies present.
const DIRS = ['controllers', 'models', 'utils', 'routes', 'middleware'];
const FILES = ['app.js', 'instrument.js', 'db_connect.js'];

function sources() {
  const out = FILES.map(f => path.join(root, f)).filter(fs.existsSync);
  for (const d of DIRS) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(dir, f));
    }
  }
  return out;
}

// `require('x')` and `require('x/y')` — bare specifiers only. Relative paths are the
// app's own files and node: builtins need nothing declared.
// Comments are stripped first. Without it this guard reported `models/fixture.js requires
// 'canvas'` because the comment explaining the removal quotes `require('canvas')` — the
// same comment-blindness that made run-migration.js split on a semicolon in a comment
// (HARD-18) and made tools/dbq.js reject an audit check for the same reason.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

function requiresIn(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const found = new Set();
  for (const m of src.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    // A scoped package keeps two segments, everything else one.
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (Module.builtinModules.includes(name)) continue;
    found.add(name);
  }
  return [...found];
}

describe('runtime requires are declared as production dependencies', () => {
  it('has found the source files and the manifest', () => {
    expect(sources().length).toBeGreaterThan(20);
    expect(declared.size).toBeGreaterThan(10);
  });

  it('requires nothing that npm ci --omit=dev would not install', () => {
    const missing = [];
    for (const file of sources()) {
      for (const name of requiresIn(file)) {
        if (!declared.has(name)) {
          missing.push(`${path.relative(root, file)} requires '${name}'`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
