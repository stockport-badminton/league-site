// DB_PI_KEY must never be pasted into a statement. It is bound, always.
//
// History: `models/players.js:getEmails` interpolated it as a string literal five times,
// once per UNION branch, with `console.log(sql)` on the line above — so the key that
// encrypts every player's email and phone number was written to Cloud Logging on every
// distribution-list send. It surfaced only by printing thirteen times into a terminal
// during an audit on 7 Sep 2026. The log line went that day; HARD-27 bound the key.
//
// This file used to hold the weaker rule that was possible while the key was still being
// pasted in: "do not log a statement in a file that interpolates a secret". That guard had
// to be deleted once the interpolation went, and it carried a second assertion whose whole
// job was to confirm the bug still existed — a test that fails when you fix something.
//
// The rule here is the stronger one and does not expire: the key is never interpolated at
// all. It also catches what the old one could not — `updateBulk` pasted the key into a
// TEMPLATE literal, so `+ process.env.DB_PI_KEY` never matched it, and the old guard read
// models/players.js as clean on that count for as long as it existed.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const DIRS = ['models', 'controllers', 'utils', 'routes', 'middleware', 'tools'];

function sources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Comments explaining the rule are not breaches of it. Five scanners in this repo have
// been caught by text they did not strip, one of which reported the very file it was
// hunting as clean.
const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

// Both spellings: string concatenation and template interpolation.
const PASTED = /\+\s*process\.env\.DB_PI_KEY|\$\{\s*process\.env\.DB_PI_KEY\s*\}/;

describe('the PI key is never pasted into a statement', () => {
  it('is bound as a parameter everywhere it is used', () => {
    const offenders = [];
    for (const dir of DIRS) {
      for (const file of sources(path.join(root, dir))) {
        if (PASTED.test(strip(fs.readFileSync(file, 'utf8')))) {
          offenders.push(path.relative(root, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // A guard that has quietly stopped matching passes for the wrong reason, which is how
  // this codebase has lost time before. Prove it still recognises both spellings.
  it('recognises both spellings, so it cannot pass by failing to look', () => {
    expect(PASTED.test(`sql = "... pgp_sym_decrypt(x, '" + process.env.DB_PI_KEY + "')"`)).toBe(true);
    expect(PASTED.test('sql = `... pgp_sym_encrypt(?, \'${process.env.DB_PI_KEY}\')`')).toBe(true);
    expect(PASTED.test('const params = [process.env.DB_PI_KEY, email]')).toBe(false);
    expect(strip("// '\" + process.env.DB_PI_KEY + \"'\n")).not.toMatch(PASTED);
  });

  it('scans the files that matter', () => {
    const files = DIRS.flatMap(d => sources(path.join(root, d)));
    expect(files.some(f => f.endsWith(path.join('models', 'players.js')))).toBe(true);
    expect(files.length).toBeGreaterThan(50);
  });
});
