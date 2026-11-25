const fs = require('fs');
const path = require('path');

// Inline event handlers and inline <script> blocks in views/ only ever go down (REARCH-07,
// absorbing HARD-15).
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

// Step 5: inline <script> blocks move to files under static/beta/js/. A data block
// (`type="application/json"` or JSON-LD) is not script and is not counted; it is how a
// moved block gets server data without EJS inside the code. What is left, per template,
// is capped here: lower a number when a block goes, and delete the line at zero.
const BLOCK_CEILING = {
  'club-v2.ejs': 4,
  'datatables-stats.ejs': 1,
  'datatables.ejs': 1,
  'elo-chart.ejs': 1,
  'fixtures-results.ejs': 2,
  'header.ejs': 2,
  'index-scorecard.ejs': 2,
  'messer-result-detail.ejs': 1,
  'messer-scorecard.ejs': 1,
  'player-game-stats.ejs': 1,
  'populated-scorecard.ejs': 1,
  'shuttle-prices.ejs': 1,
};

const BLOCK = /<script\b(?![^>]*\bsrc\s*=)(?![^>]*application\/(?:ld\+)?json)[^>]*>/gi;
const blocks = src => (src.match(BLOCK) || []).length;

describe('inline <script> blocks in views/', () => {
  const counts = Object.fromEntries(templates(VIEWS)
    .map(f => [path.relative(VIEWS, f).split(path.sep).join('/'), f])
    // Emails are mailed HTML: no CSP of ours applies, and they carry no script.
    .filter(([rel]) => !rel.startsWith('emails/'))
    .map(([rel, f]) => [rel, blocks(fs.readFileSync(f, 'utf8'))])
    .filter(([, n]) => n > 0));

  it('are only in the templates that still have some, and no more of them', () => {
    const over = Object.entries(counts)
      .filter(([f, n]) => n > (BLOCK_CEILING[f] || 0))
      .map(([f, n]) => `${f}: ${n} (ceiling ${BLOCK_CEILING[f] || 0})`);
    expect(over).toEqual([]);
  });

  it('recognises a block, and not a script file or a data block', () => {
    expect(blocks('<script>x()</script>')).toBe(1);
    expect(blocks('<script type="text/javascript">x()</script>')).toBe(1);
    expect(blocks('<script defer src="/a.js"></script>')).toBe(0);
    expect(blocks('<script type="application/json" id="d">{}</script>')).toBe(0);
    expect(blocks('<script type="application/ld+json">{}</script>')).toBe(0);
    expect(counts['header.ejs']).toBeGreaterThan(0);
  });
});
