// models/season.js (init) and models/siteSettings.js on the typed query layer (REARCH-01).
//
// season.init needs a test of its own because its snapshot cannot fail: when the query
// throws, init catches it and falls back to a date rule that, in 2026/27, gives the same
// two names the query does. So the season inserted here is one the date rule cannot
// produce.
const db = require('../../db_connect');
const Season = require('../../models/season');
const SiteSettings = require('../../models/siteSettings');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params));

describe('season.init reads the season table', () => {
  afterEach(() => jest.restoreAllMocks());

  it('takes the newest season that has started, and the one before it', async () => {
    const [[latest]] = await run(
      'SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1');
    await run(`INSERT INTO season (id, name, "startDate", "endDate", label) VALUES
      (1001, '20982099', now() - interval '1 hour', now() + interval '1 year', 'started'),
      (1002, '20992100', now() + interval '1 day', now() + interval '1 year', 'not yet')`);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await Season.init()).toEqual({ current: '20982099', previous: latest.name });
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('siteSettings', () => {
  it('set inserts a key, then updates it in place', async () => {
    await SiteSettings.set('rearch01_test', 'one');
    expect(await SiteSettings.get('rearch01_test')).toBe('one');
    await SiteSettings.set('rearch01_test', 'two');
    expect(await SiteSettings.get('rearch01_test')).toBe('two');
    const [rows] = await run("SELECT count(*)::int AS n FROM site_setting WHERE key = 'rearch01_test'");
    expect(rows[0].n).toBe(1);
  });

  it('get answers undefined for a key that is not there', async () => {
    expect(await SiteSettings.get('rearch01_absent')).toBeUndefined();
  });

  it('getAll is ordered by key', async () => {
    await SiteSettings.set('aaa_rearch01', 'x');
    await SiteSettings.set('zzz_rearch01', 'y');
    const keys = (await SiteSettings.getAll()).map(r => r.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(expect.arrayContaining(['aaa_rearch01', 'zzz_rearch01']));
  });
});
