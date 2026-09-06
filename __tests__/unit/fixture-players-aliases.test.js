// Every player column on /fixture-players — and on the scorecard confirmation screen —
// was blank, because `AS Man1` is folded to `man1` by Postgres and the views read
// `row['Man1']`. CLAUDE.md gotcha 1, in its alias form.
//
// It rendered as an empty cell rather than an error, which is why it survived: the page
// looked like a page, just an empty one. The same shape blanked the captain on every
// /event/ page for as long as that page existed (`AS teamCaptain`).
//
// Rather than assert the SQL contains particular strings, this derives the requirement:
// whatever the views read, the query must return under that exact name. So it keeps
// working when a column is added, and fails when an alias loses its quotes.
//
// This is a scoped instance of HARD-19, which proposes the same check across the codebase.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// The two views rendered from Fixture.getMatchPlayerOrderDetails.
const VIEWS = ['views/fixture-players.ejs', 'views/recentPlayerHistory.ejs'];

// The query, isolated from the rest of the model.
function queryText() {
  const src = read('models/fixture.js');
  const i = src.indexOf('exports.getMatchPlayerOrderDetails');
  const end = src.indexOf('\nexports.', i + 10);
  return src.slice(i, end === -1 ? undefined : end);
}

// Keys the views actually pull off a row.
function keysRead() {
  const keys = new Set();
  for (const v of VIEWS) {
    for (const m of read(v).matchAll(/row\['([A-Za-z0-9_]+)'\]/g)) keys.add(m[1]);
  }
  return [...keys];
}

describe('the fixture-players query returns what its views read', () => {
  it('finds the views and the query', () => {
    expect(keysRead().length).toBeGreaterThan(15);
    expect(queryText()).toMatch(/getMatchPlayerOrderDetails/);
  });

  // A key with a capital in it only survives Postgres if its alias is quoted. An
  // all-lowercase key (`date`, `name`) needs nothing.
  it('quotes every alias whose name has a capital in it', () => {
    const sql = queryText();
    const unquoted = keysRead()
      .filter(k => k !== k.toLowerCase())
      .filter(k => !sql.includes(`"${k}"`));

    expect(unquoted).toEqual([]);
  });

  // The counterpart, and the mistake made while fixing it: `teamId` and `clubId` are
  // aliased unquoted ON PURPOSE, because the wrapper joins `club ON club.id = clubId` and
  // that reference is unquoted too. Quoting the alias alone turns a blank column into
  // `column "clubid" does not exist` — which is what the first attempt did.
  it('leaves an alias folded when the SQL itself refers to it unfolded', () => {
    const sql = queryText();
    expect(sql).toMatch(/= clubId/);
    expect(sql).not.toMatch(/as "clubId"/);
    // And nothing reads it, which is what makes that safe.
    expect(keysRead()).not.toContain('clubId');
  });
});
