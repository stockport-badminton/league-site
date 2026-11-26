const fs = require('fs');
const path = require('path');

// Bootstrap 4 names only ever go down (HARD-50).
//
// The site moves from Bootstrap 4.6 to 5.3 in the 2027 off-season. Until then templates
// carry both versions' names side by side — `data-toggle="modal" data-bs-toggle="modal"`,
// `ml-2 ms-2`, `sr-only visually-hidden` — so the markup is ready and nothing visible
// changes; whichever version is not loaded ignores the other's name. This test holds that
// line: a Bootstrap 4 name on its own is a thing the cutover would break, and new work
// that adds one makes the cutover bigger (it grew by a third between 29 Oct and 25 Nov 2026,
// all of it from new pages).
//
// The files still to convert each have a ceiling below. Lower it as you convert; delete
// the line at zero. Everything else must be at zero already.
//
// NOT checked here, because doubling them up does not work and they change at the cutover
// itself (HARD-50 step 5): `form-control` → `form-select` on a <select> (under 5 the two
// fight), `close` → `btn-close` (the inner &times; would show), `input-group-append`,
// `custom-control`. At the cutover this test becomes the strict guard of step 7, which
// fails on the Bootstrap 4 name whether or not its partner is there.

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['views', 'static/beta/js'];

const CEILING = {
  'views/club-contact.ejs': 1,
  'views/club-officers-index.ejs': 1,
  'views/club-officers.ejs': 8,
  'views/index-scorecard.ejs': 7,
  'views/junior-clubs.ejs': 1,
  'views/live-scorecard-share.ejs': 1,
  'views/messer-draw-a-section.ejs': 4,
  'views/messer-result-detail.ejs': 11,
  'views/messer-results-list.ejs': 1,
  'views/messer-scorecard.ejs': 4,
  'views/missed-three-notice.ejs': 1,
  'views/notifications-video.ejs': 1,
  'views/notifications.ejs': 4,
  'views/partials/messer-concede.ejs': 2,
  'views/partials/messer-draw-match.ejs': 1,
  'views/player-stats.ejs': 1,
  'views/populated-scorecard.ejs': 5,
  'views/privacy.ejs': 1,
  'views/roster-clubs.ejs': 5,
  'views/roster-row.ejs': 2,
  'views/viewScorecard.ejs': 4,
};

const BP = '((?:sm|md|lg|xl)-)?';
const COLOURS = 'primary|secondary|success|danger|warning|info|light|dark';

// Bootstrap 4 class → its Bootstrap 5 partner, or null where there is no name to put
// alongside and the markup is rewritten instead (`btn-block` → `d-block w-100`,
// `jumbotron` → utilities). `form-inline`, `form-group` and `form-row` are not here: they
// are kept, with their rules in static/beta/css/custom.css.
const CLASS_RULES = [
  [new RegExp(`^([mp])([lr])-${BP}(n?[0-5]|auto)$`), (m, mp, lr, bp = '', n) => `${mp}${lr === 'l' ? 's' : 'e'}-${bp}${n}`],
  [new RegExp(`^(text|float)-${BP}(left|right)$`), (m, what, bp = '', side) => `${what}-${bp}${side === 'left' ? 'start' : 'end'}`],
  [/^(border|rounded)-(left|right)(-0)?$/, (m, what, side, zero = '') => `${what}-${side === 'left' ? 'start' : 'end'}${zero}`],
  [new RegExp(`^badge-(${COLOURS})$`), (m, c) => `text-bg-${c}`],
  [/^badge-pill$/, () => 'rounded-pill'],
  // A colour filled in by EJS — class="badge badge-<%= colour %>" — tokenises to `badge-`;
  // it needs `text-bg-<%= colour %>` beside it (team-strength.ejs, 26 Nov 2026).
  [/^badge-$/, () => 'text-bg-'],
  [/^sr-only(-focusable)?$/, (m, f = '') => `visually-hidden${f}`],
  [/^font-weight-(bold|bolder|normal|light|lighter)$/, (m, w) => `fw-${w}`],
  [/^font-italic$/, () => 'fst-italic'],
  [/^text-monospace$/, () => 'font-monospace'],
  [/^no-gutters$/, () => 'g-0'],
  [new RegExp(`^dropdown-menu-${BP}(left|right)$`), (m, bp = '', side) => `dropdown-menu-${bp}${side === 'left' ? 'start' : 'end'}`],
  [/^(btn-block|jumbotron|custom-select|card-deck|card-columns|embed-responsive)$/, () => null],
];

// Bootstrap's own data attributes. Others the site uses (data-content, data-placement…)
// are its own and are left alone.
const DATA_ATTRS = ['toggle', 'target', 'dismiss', 'slide', 'slide-to', 'ride', 'parent', 'backdrop', 'keyboard'];

// A class list in markup or a JS-built string: class="…", class='…', class=\"…\" inside a
// JS string, or `className: '…'` / `className = '…'`.
const CLASS_LIST = /\bclass(?:Name)?\s*[=:]\s*\\?(["'])([\s\S]*?)\\?\1/g;
// In a .js file, any string literal: classes reach the DOM through helpers as well as
// through className — `el('p', 'small mb-1 font-weight-bold', …)` in player-request.js.
// Only exact Bootstrap 4 tokens count, so ordinary text does not trip it.
const STRING = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
// A tag, in a template or a JS string. `%>` does not end one, so EJS inside a tag is kept.
const TAG = /<[a-zA-Z][\s\S]*?(?<!%)>/g;

// In a template, the code blocks too (`<% … %>`, not `<%=`/`<%-` output or `<%#` comments):
// a class kept in a variable there — `var badge = { up: 'badge-success' }[zone]` in
// league-run-in.ejs — reaches the page without ever being in a class="…" of its own.
const SCRIPTLET = /<%(?![=\-#])([\s\S]*?)%>/g;
const classLists = (src, js) => js
  ? [...src.matchAll(STRING)].map(m => m[2])
  : [...src.matchAll(CLASS_LIST)].map(m => m[2])
    .concat([...src.matchAll(SCRIPTLET)].flatMap(([, code]) => [...code.matchAll(STRING)].map(m => m[2])));

function unpaired(src, { js = false } = {}) {
  const found = [];
  for (const list of classLists(src, js)) {
    // Tokens, so a class inside an EJS conditional — class="<%= x ? 'text-right' : '' %>" —
    // is still seen. Its partner has to be in the same class list.
    const tokens = new Set(list.split(/[^a-zA-Z0-9-]+/).filter(Boolean));
    for (const token of tokens) {
      for (const [re, partner] of CLASS_RULES) {
        const m = token.match(re);
        if (!m) continue;
        const want = partner(...m);
        if (want === null || !tokens.has(want)) found.push(want ? `${token} without ${want}` : token);
        break;
      }
    }
  }
  for (const [tag] of src.matchAll(TAG)) {
    for (const attr of DATA_ATTRS) {
      if (new RegExp(`\\sdata-${attr}\\s*=`).test(tag) && !new RegExp(`\\sdata-bs-${attr}\\s*=`).test(tag)) {
        found.push(`data-${attr} without data-bs-${attr}`);
      }
    }
  }
  // A selector on a Bootstrap 4 attribute stops matching when the cutover deletes it.
  // Select on a class or id of the page's own instead (fixture-date-edit.js, 25 Nov 2026).
  for (const [sel] of src.matchAll(/\[data-(?:toggle|target|dismiss)\b/g)) found.push(`selector ${sel}`);
  return found;
}

function files(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, out);
    else if (/\.(ejs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const counts = Object.fromEntries(DIRS
  .flatMap(d => files(path.join(ROOT, d)))
  .map(f => path.relative(ROOT, f).split(path.sep).join('/'))
  // Emails are mailed HTML built from their own styles; Bootstrap is never loaded there.
  .filter(rel => !rel.startsWith('views/emails/'))
  .map(rel => [rel, unpaired(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { js: rel.endsWith('.js') })])
  .filter(([, found]) => found.length > 0));

describe('Bootstrap 4 names without their Bootstrap 5 partner (HARD-50)', () => {
  it('are only in the files still to convert, and no more of them', () => {
    const over = Object.entries(counts)
      .filter(([f, found]) => found.length > (CEILING[f] || 0))
      .map(([f, found]) => `${f}: ${found.length} (ceiling ${CEILING[f] || 0}) — ${[...new Set(found)].join(', ')}`);
    expect(over).toEqual([]);
  });

  // The list is the to-do list for the cutover, so it says exactly what is left.
  it('have ceilings that match what is left: lower one when you convert', () => {
    const under = Object.entries(CEILING)
      .filter(([f, ceiling]) => (counts[f] || []).length < ceiling)
      .map(([f, ceiling]) => `${f}: ${(counts[f] || []).length} (ceiling ${ceiling})`);
    expect(under).toEqual([]);
  });

  // A guard that has quietly stopped matching passes for the wrong reason.
  it('recognises an unpaired name, and accepts a paired one', () => {
    expect(unpaired('<a href="#m" data-toggle="modal" data-target="#m">')).toEqual(
      ['data-toggle without data-bs-toggle', 'data-target without data-bs-target']);
    expect(unpaired('<a href="#m" data-toggle="modal" data-bs-toggle="modal" data-target="#m" data-bs-target="#m">')).toEqual([]);
    expect(unpaired('<button type="button"\n  class="close" data-dismiss="modal">')).toEqual(['data-dismiss without data-bs-dismiss']);
    expect(unpaired('<td class="text-right">')).toEqual(['text-right without text-end']);
    expect(unpaired('<td class="text-right text-end">')).toEqual([]);
    expect(unpaired('<div class="text-md-left">')).toEqual(['text-md-left without text-md-start']);
    expect(unpaired('<i class="ml-2 mr-auto ms-2 me-auto pl-md-3 ps-md-3">')).toEqual([]);
    expect(unpaired('<i class="ml-n1">')).toEqual(['ml-n1 without ms-n1']);
    expect(unpaired('<span class="badge badge-warning">')).toEqual(['badge-warning without text-bg-warning']);
    expect(unpaired('<span class="badge badge-warning text-bg-warning">')).toEqual([]);
    expect(unpaired('<span class="sr-only">')).toEqual(['sr-only without visually-hidden']);
    expect(unpaired('<div class="row no-gutters g-0">')).toEqual([]);
    expect(unpaired('<button class="btn btn-block">')).toEqual(['btn-block']);
    expect(unpaired('<button class="btn d-block w-100">')).toEqual([]);
    expect(unpaired(`<td class="<%= x ? 'text-right' : '' %>">`)).toEqual(['text-right without text-end']);
    expect(unpaired(`var s = '<span class="badge badge-info">';`)).toEqual(['badge-info without text-bg-info']);
    expect(unpaired(`el('button', { className: 'btn btn-block' })`, { js: true })).toEqual(['btn-block']);
    expect(unpaired(`el('p', 'small font-weight-bold', 'Already on file?')`, { js: true })).toEqual(['font-weight-bold without fw-bold']);
    expect(unpaired(`el('p', 'small font-weight-bold fw-bold', 'Text-right is fine')`, { js: true })).toEqual([]);
    expect(unpaired(`$x.attr('title', "don't").text('a')`, { js: true })).toEqual([]);
    expect(unpaired('<div data-toggle="<%= a > b ? 1 : 2 %>">')).toEqual(['data-toggle without data-bs-toggle']);
    expect(unpaired(`$('a[data-target="#exampleModal"]').click(f)`, { js: true })).toEqual(['selector [data-target']);
    expect(unpaired(`$('a.js-rearrange-link').click(f)`, { js: true })).toEqual([]);
    expect(unpaired('<span class="badge badge-<%= colour %>">')).toEqual(['badge- without text-bg-']);
    expect(unpaired('<span class="badge badge-<%= colour %> text-bg-<%= colour %>">')).toEqual([]);
    expect(unpaired(`<% var badge = { up: 'badge-success', down: 'badge-danger text-bg-danger' }[z]; %>`))
      .toEqual(['badge-success without text-bg-success']);
    expect(unpaired(`<%# a comment naming 'badge-success' %><%= 'text-right' %>`)).toEqual([]);
    // The site's own data attributes and bootstrap-5-only names pass.
    expect(unpaired('<a data-content="x" data-placement="top" data-fixture-id="3" class="ms-2 text-end">')).toEqual([]);
    // Not a class list: CSS in a style attribute, and words in text.
    expect(unpaired('<p style="text-align: right; border-left: 0">text-right is a class</p>')).toEqual([]);
  });
});
