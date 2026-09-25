// No render may switch the dev debug panel on unconditionally (HARD-40).
//
// views/partials/debugPanel.ejs shows the form's state and a log, and is meant for a dev
// server only. Every render decides `devMode` from the environment — except that
// `messer_scorecard_beta_test` passed `devMode: true`, so production served the panel to
// any logged-in member on GET /messer-scorecard-beta/test. The route is now devOnly as
// well; this stops the literal coming back on some other render.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const DIRS = ['controllers', 'routes', 'utils', 'middleware'];
const LITERAL = /\bdevMode\s*:\s*(true|1|'true'|"true")\b/;

function offenders() {
  const out = [];
  for (const d of DIRS) {
    for (const f of fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js'))) {
      fs.readFileSync(path.join(root, d, f), 'utf8').split('\n').forEach((line, i) => {
        if (LITERAL.test(line)) out.push(`${d}/${f}:${i + 1}`);
      });
    }
  }
  return out;
}

describe('the dev debug panel', () => {
  it('is never switched on by a literal', () => {
    expect(offenders()).toEqual([]);
  });

  // A pattern that matched nothing would pass forever.
  it('the pattern still recognises the shape it guards against', () => {
    expect(LITERAL.test("      devMode: true,")).toBe(true);
    expect(LITERAL.test("devMode: process.env.DEV_MODE === 'true'")).toBe(false);
  });
});
