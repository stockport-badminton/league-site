// utils/adminTools.js is the /admin hub, and since the Admin dropdown was cut to a
// shortlist it is the ONLY place most tools are linked from. A tool whose href has no
// route would be a dead card; a tool missing from the list would be unreachable.
const fs = require('fs');
const path = require('path');
const { GROUPS, NAV_SHORTLIST, shortlist } = require('../../utils/adminTools');

// Every routes/*.js: the routes are split by area since REARCH-04.
const ROUTES_DIR = path.join(__dirname, '../../routes');
const ROUTES = fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8')).join('\n');
const GET_PATHS = new Set([...ROUTES.matchAll(/router\.get\(\s*'([^']+)'/g)].map(m => m[1]));

describe('adminTools', () => {
  const tools = GROUPS.flatMap(g => g.tools);

  it.each(tools.map(t => [t.href]))('%s has a GET route', href => {
    expect(GET_PATHS.has(href)).toBe(true);
  });

  it('lists each tool once', () => {
    const hrefs = tools.map(t => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('builds the dropdown shortlist from tools that exist', () => {
    expect(shortlist()).toHaveLength(NAV_SHORTLIST.length);
    shortlist().forEach(t => expect(t && t.label).toBeTruthy());
  });

  it('has a route for the hub itself', () => {
    expect(GET_PATHS.has('/admin')).toBe(true);
  });
});
