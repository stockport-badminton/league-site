// GET /admin/gap-finder: superadmin-only, data embedded safely, a linked fixture carried
// through, and a missing Tameside read said out loud.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../utils/gapFinder', () => ({ load: jest.fn() }));

const GapFinder = require('../../utils/gapFinder');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Results Secretary', _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' } };
const CLUB_ADMIN = { id: 'b', displayName: 'Club Admin', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Shell' } };

const DATA = {
  season: '20262027', today: '2026-11-15', tamesideStatus: 'ok',
  window: { start: '2026-06-20', end: '2027-07-30' }, playWindow: { start: '2026-09-01', end: '2027-04-30' },
  clubs: [{ key: 'shell', name: 'Shell', leagues: ['stockport'], teamKeys: ['S:1'] }],
  teams: [{ key: 'S:1', name: 'Shell A</script><script>alert(1)</script>', club: 'Shell', clubKey: 'shell', league: 'stockport', leagueLabel: 'Stockport', homeNight: 'Tue' }],
  fixtures: [],
};
const embedded = (html, id) => JSON.parse(html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`))[1]);

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  GapFinder.load.mockResolvedValue(DATA);
});

it('is superadmin-only', async () => {
  mockCurrentUser = CLUB_ADMIN;
  expect((await request(app).get('/admin/gap-finder')).status).toBe(403);
  expect(GapFinder.load).not.toHaveBeenCalled();
});

it('embeds the data so a name cannot close the script tag', async () => {
  const res = await request(app).get('/admin/gap-finder');
  expect(res.status).toBe(200);
  expect(res.text).not.toContain('Shell A</script>');
  expect(embedded(res.text, 'gf-data').teams[0].name).toBe(DATA.teams[0].name);
  expect(res.text).toContain('read live from\n    <strong>both leagues</strong>');
  expect(res.text).toMatch(/gap-finder-core\.js/);
});

it('carries a linked fixture through, and ignores anything that is not one', async () => {
  expect(embedded((await request(app).get('/admin/gap-finder?fixture=S-7300')).text, 'gf-fixture')).toBe('S-7300');
  expect(embedded((await request(app).get('/admin/gap-finder?fixture=S-1%22%3E')).text, 'gf-fixture')).toBeNull();
});

it('says when Tameside could not be read', async () => {
  GapFinder.load.mockResolvedValue({ ...DATA, tamesideStatus: 'failed' });
  const res = await request(app).get('/admin/gap-finder');
  expect(res.text).toContain('<strong>Stockport only</strong>');
  expect(res.text).toContain("Tameside's database could not be read just now");
});
