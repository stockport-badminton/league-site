// An alias must be either quoted-and-camelCase, or written lowercase. Never
// camelCase-unquoted.
//
// That third form is the only dangerous one, and it is dangerous because it LIES: the SQL
// says `AS clubSecEmail` and the row arrives as `clubsecemail`, so the mistake is
// invisible at the place you would look for it. The other two forms tell the truth about
// what comes back.
//
// The cost of the lie, over one week:
//   - every player column on /fixture-players and the scorecard confirmation screen blank
//     (`AS Man1`)
//   - /contact-us losing club enquiries; one member tried four times (`AS clubSecEmail`)
//   - the Enter link on /fixtures hidden from every captain (`homeClubName`)
//   - the league tables' points columns blank, fixed May 2026 (`AS pointsFor`)
//   - the captain and match secretary blank on every /event/ page, for as long as that
//     page existed (`AS teamCaptain`)
//
// 177 existing aliases were rewritten to lowercase to make this guard start clean, which
// was provably inert: Postgres was already folding them, so the output keys are identical.
// Verified by snapshotting the keys of 35 model functions against the real database
// before and after — 421 keys, none changed. That is why there is no suppression list
// here, which HARD-19 rightly refuses to accept.
//
// This guard cannot find a BROKEN CONSUMER. It compares SQL against itself and never sees
// what JavaScript reads, so it stops new instances and finds none of the existing ones.
// That needs a query-to-consumer key diff against a live database, which is the audit
// check HARD-19 describes.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const DIRS = ['models', 'controllers', 'utils', 'routes', 'middleware'];

function sources() {
  const out = [];
  for (const d of DIRS) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(dir, f));
    }
  }
  return out;
}

// Only string literals that look like SQL, and within them only the code — a `--` comment
// is free to mention `AS teamCaptain` while explaining why it must not be written that
// way. Three separate scanners in this repo have been caught by comments they did not
// strip (run-migration.js, tools/dbq.js, and the require guard next door).
function sqlBodies(src) {
  const bodies = [];
  const strings = src.match(/`[^`]*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
  for (const s of strings) {
    if (!/\bSELECT\b/i.test(s)) continue;
    bodies.push(s.split('\n').map(l => l.split('--')[0]).join('\n'));
  }
  return bodies;
}

function offenders() {
  const found = [];
  for (const file of sources()) {
    const src = fs.readFileSync(file, 'utf8');
    for (const body of sqlBodies(src)) {
      for (const m of body.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        const alias = m[1];
        if (alias !== alias.toLowerCase()) {
          found.push(`${path.relative(root, file)}: AS ${alias}`);
        }
      }
    }
  }
  return found;
}

describe('SQL aliases', () => {
  it('is looking at the queries at all', () => {
    const bodies = sources().reduce((n, f) => n + sqlBodies(fs.readFileSync(f, 'utf8')).length, 0);
    expect(bodies).toBeGreaterThan(40);
  });

  it('never aliases with a capital unless the alias is quoted', () => {
    expect(offenders()).toEqual([]);
  });

  // The guard has to see through a template literal, because that is how every large
  // query in this codebase is written.
  it('would catch one in a template literal', () => {
    const bad = 'const q = `SELECT club.name AS clubSecEmail FROM club`';
    const bodies = sqlBodies(bad);
    const hits = bodies.flatMap(b => [...b.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g)])
      .map(m => m[1]).filter(a => a !== a.toLowerCase());
    expect(hits).toEqual(['clubSecEmail']);
  });

  // ...and must not fire on the two honest forms.
  it('accepts a quoted alias and a lowercase one', () => {
    const ok = 'const q = `SELECT a AS "clubSecEmail", b AS clubsecemail FROM t`';
    const hits = sqlBodies(ok).flatMap(b => [...b.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g)])
      .map(m => m[1]).filter(a => a !== a.toLowerCase());
    expect(hits).toEqual([]);
  });
});
