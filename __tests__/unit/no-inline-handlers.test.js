const fs = require('fs');
const path = require('path');

// Inline event handlers in views/ only ever go down (REARCH-07, absorbing HARD-15).
//
// An `onclick="…"` attribute is inline script, and while one is left `'unsafe-inline'` has
// to stay in script-src, which leaves the CSP constraining where scripts load from but not
// whether an injected one runs. The handlers outside the scorecard templates were moved
// out on 25 Nov 2026: confirm prompts and the team form's copy-from dropdown became data
// attributes read by static/beta/js/actions.js, and the rest delegated listeners.
//
// The three scorecard templates still hold theirs. They move off-season with the wizard
// (REARCH-07 step 4), so each has a ceiling here: lower it when you remove some, and it
// must reach zero before 'unsafe-inline' goes.

const VIEWS = path.join(__dirname, '..', '..', 'views');

const CEILING = {
  'index-scorecard.ejs': 52,
  'messer-scorecard.ejs': 26,
  'populated-scorecard.ejs': 24,
};

// An attribute named on… with a value, preceded by whitespace so `data-on` or text like
// "carry on=" mid-word is not counted.
const HANDLER = /\son[a-z]+\s*=/gi;

function templates(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) templates(full, out);
    else out.push(full);
  }
  return out;
}

const count = src => (src.match(HANDLER) || []).length;

describe('inline event handlers in views/', () => {
  const counts = Object.fromEntries(templates(VIEWS)
    .map(f => [path.relative(VIEWS, f).split(path.sep).join('/'), count(fs.readFileSync(f, 'utf8'))])
    .filter(([, n]) => n > 0));

  it('are gone from every template except the three scorecards', () => {
    const elsewhere = Object.entries(counts).filter(([f]) => !(f in CEILING));
    expect(elsewhere).toEqual([]);
  });

  it('do not grow in the scorecard templates', () => {
    for (const [file, ceiling] of Object.entries(CEILING)) {
      expect({ file, count: counts[file] || 0 }).toEqual({ file, count: expect.any(Number) });
      expect(counts[file] || 0).toBeLessThanOrEqual(ceiling);
    }
  });

  // A guard that has quietly stopped matching passes for the wrong reason.
  it('recognises a handler, and not a data attribute', () => {
    expect(count('<button onclick="x()">')).toBe(1);
    expect(count('<form method="post"\n  onsubmit="return confirm(1)">')).toBe(1);
    expect(count('<button data-confirm="Sure?">')).toBe(0);
    expect(count('<select data-navigate="/x?y=">')).toBe(0);
    expect(counts['index-scorecard.ejs']).toBeGreaterThan(0);
  });
});
