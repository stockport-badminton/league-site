// models/gapFinder.js against a real Postgres. The same readCalendar runs against
// Tameside's database in production, through a READ ONLY transaction on its own pool.
const db = require('../../db_connect');
const GapFinder = require('../../models/gapFinder');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

// A window far from any real fixture, so only this test's rows are in it.
const WINDOW = { start: '2099-09-01', end: '2100-06-01' };
const H = 1001, A = 1002;

let CLUB, VENUE;
beforeEach(async () => {
  const [club] = await run('SELECT id, name, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
  CLUB = club; VENUE = club.venue;
  await run(`INSERT INTO team (id, name, club, venue, rank, division) VALUES
    (${H}, 'Scratch A', ${CLUB.id}, ${VENUE}, 1, NULL), (${A}, 'Scratch B', ${CLUB.id}, ${VENUE}, 2, NULL)`);
  const fx = (id, date, status) => run(`INSERT INTO fixture (id, date, "homeTeam", "awayTeam", status) VALUES (?, ?, ${H}, ${A}, ?)`,
    [id, date, status]);
  await fx(900001, '2099-10-05 00:00:00', 'outstanding');
  await fx(900002, '2099-10-12 00:00:00', 'rearranging');
  await fx(900003, '2099-10-19 00:00:00', 'rearranged');
  await fx(900004, '2099-10-26 00:00:00', 'void');
  await fx(900005, '2099-11-02 00:00:00', 'complete');
  await fx(900006, '2099-08-31 00:00:00', 'outstanding'); // before the window
  await fx(900007, '2100-06-01 00:00:00', 'outstanding'); // the window's end is exclusive
});

describe('readCalendar', () => {
  it('returns fixtures in the window as plain dates, leaving out rearranged and void', async () => {
    const { fixtures } = await GapFinder.stockport(WINDOW);
    expect(fixtures).toEqual([
      { id: 900001, homeTeam: H, awayTeam: A, status: 'outstanding', day: '2099-10-05' },
      { id: 900002, homeTeam: H, awayTeam: A, status: 'rearranging', day: '2099-10-12' },
      { id: 900005, homeTeam: H, awayTeam: A, status: 'complete', day: '2099-11-02' },
    ]);
  });

  it('names each team\'s club, and keeps a team with no division', async () => {
    const { teams } = await GapFinder.stockport(WINDOW);
    expect(teams.filter(t => t.id === H || t.id === A)).toEqual([
      { id: H, name: 'Scratch A', club: CLUB.name, division: null },
      { id: A, name: 'Scratch B', club: CLUB.name, division: null },
    ]);
  });
});

describe('seasonWindow', () => {
  it('gives the season\'s dates as YYYY-MM-DD, and undefined for an unknown season', async () => {
    await run(`INSERT INTO season (name, "startDate", "endDate") VALUES ('20992100', '2099-07-01 00:00:00', '2100-07-31 00:00:00')`);
    expect(await GapFinder.seasonWindow('20992100')).toEqual({ start: '2099-07-01', end: '2100-07-31' });
    expect(await GapFinder.seasonWindow('19001901')).toBeUndefined();
  });
});

describe('tameside', () => {
  it('is null when TAMESIDE_DATABASE_URL is not set, as in every test', async () => {
    expect(await GapFinder.tameside(WINDOW)).toBeNull();
  });
});
