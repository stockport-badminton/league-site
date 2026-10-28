// No table name is built from a season (REARCH-02).
//
// Each season's teams, clubs, divisions and squads used to be a table of their own,
// `team20242025` and so on, and a page for a past season spliced the season from its URL
// into the statement as a table name. A table name cannot be a bound parameter, so
// season.assertName was the only thing between the URL and the SQL text; before it existed
// /tables/All/20252026%20AS%20team%20WHERE%20false%20-- reached the parser. The readers now
// join the <entity>_at views with the season bound (`t.season = ?`), and this keeps it so.
//
// Not the rest of tools/ yet: tools/season-history-backfill.js reads the archives by name
// until they are dropped (step 8), and joins this list then. tools/local-db/sync.js joined
// at step 5, when it stopped creating them.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const DIRS = ['models', 'controllers', 'tools/local-db'];

function sources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Comments explaining the rule are not breaches of it (see no-secrets-in-sql.test.js).
const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

// Both spellings: `team${season}`, and a string ending in the name with something added
// to it ('team' + season, '… FROM player' + season).
const ENTITY = '(?:team|club|division|player|venue|messer)';
const BUILT = new RegExp(`\\b${ENTITY}\\$\\{|\\b${ENTITY}['"]\\s*\\+`);

describe('season table names', () => {
  it('are never built from a season in models/, controllers/ or tools/local-db/', () => {
    const offenders = [];
    for (const dir of DIRS) {
      for (const file of sources(path.join(root, dir))) {
        strip(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
          if (BUILT.test(line)) offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  // A guard that has stopped matching passes for the wrong reason.
  it('recognises both spellings, so it cannot pass by failing to look', () => {
    expect(BUILT.test('JOIN team${season} t ON t.id = f."homeTeam"')).toBe(true);
    expect(BUILT.test('JOIN player${ season } p')).toBe(true);
    expect(BUILT.test("'SELECT * FROM player' + season + ' player'")).toBe(true);
    expect(BUILT.test("JOIN ${'club' + season} c")).toBe(true);
    expect(BUILT.test('JOIN team_at t ON t.id = f."homeTeam" AND t.season = ?')).toBe(false);
  });
});
