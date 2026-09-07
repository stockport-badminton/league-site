// No query may be logged while it still carries a secret.
//
// `models/players.js:getEmails` interpolates DB_PI_KEY as a string literal — five times,
// once per UNION branch — and had `console.log(sql)` on the line above the query. So the
// key that encrypts every player's email and phone number was written to Cloud Logging on
// every distribution-list send.
//
// It surfaced by printing thirteen times into a terminal during an audit on 7 Sep 2026,
// which is the only reason anyone noticed. HARD-27 is to bind the key properly; until
// then, not logging the statement is what keeps it out of the logs.
//
// The check is deliberately about the COMBINATION, not about logging in general: a query
// built without secrets is fine to log, and this codebase logs plenty usefully.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function sources() {
  const out = [];
  for (const d of ['models', 'controllers', 'utils', 'routes', 'middleware']) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(dir, f));
    }
  }
  return out;
}

// Comments explaining why not to log are not themselves logging. Four scanners in this
// repo have been caught by comments they did not strip.
const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

describe('secrets and logging', () => {
  it('never logs a variable holding SQL in a file that interpolates a secret', () => {
    const offenders = [];
    for (const file of sources()) {
      const src = strip(fs.readFileSync(file, 'utf8'));
      // Does this file build SQL with a secret pasted in rather than bound?
      const interpolates = /\+\s*process\.env\.DB_PI_KEY|\$\{\s*process\.env\.DB_PI_KEY\s*\}/.test(src);
      if (!interpolates) continue;
      // ...and does it then print a statement?
      for (const m of src.matchAll(/console\.(log|info|warn|error)\s*\(\s*(sql|query|statement)\s*\)/g)) {
        offenders.push(`${path.relative(root, file)}: console.${m[1]}(${m[2]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The guard has to be looking at the file that actually has the problem, or it proves
  // nothing. getEmails is expected to keep interpolating until HARD-27 lands; when that
  // happens this assertion should be deleted along with the one above.
  it('is still watching getEmails, which still interpolates the key', () => {
    const src = strip(fs.readFileSync(path.join(root, 'models', 'players.js'), 'utf8'));
    expect(src).toMatch(/\+\s*process\.env\.DB_PI_KEY/);
  });
});
