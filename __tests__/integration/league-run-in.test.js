// GET /admin/league-run-in: this season's tables with the top two and bottom two marked.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/league');

const League = require('../../models/league');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Results Secretary', _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' } };
const CLUB_ADMIN = { id: 'b', displayName: 'Club Admin', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Dome' } };

const row = (division, rank, name, gamesWon, remaining) => ({
  division, divisionName: rank === 1 ? 'Premier' : `Division ${rank - 1}`, divisionRank: rank,
  id: name, name, played: 10, remaining, gamesWon, gamesLost: 0, divRank: 1,
});

// Division 1 is settled at the top and bottom; the Premier is not settled at all.
const ROWS = [
  row(1, 1, 'Premier Leader', 100, 2), row(1, 1, 'Premier Second', 95, 2),
  row(1, 1, 'Premier Third', 90, 2), row(1, 1, 'Premier Fourth', 85, 2), row(1, 1, 'Premier Fifth', 80, 2),
  row(2, 2, 'Runaway A', 200, 1), row(2, 2, 'Safe Second A', 150, 1), row(2, 2, 'Middling A', 100, 1),
  row(2, 2, 'Sinking A', 40, 1), row(2, 2, 'Sunk A', 30, 1),
  // The lowest division, so Division 1 has somewhere to relegate to.
  row(3, 3, 'Bottom Leader', 50, 2), row(3, 3, 'Bottom Second', 40, 2), row(3, 3, 'Bottom Last', 30, 2),
];

// Each team's row: its zone and the label it carries.
const rows = html => [...html.matchAll(/<tr class="[^"]*" data-zone="([a-z]*)">([\s\S]*?)<\/tr>/g)]
  .map(([, zone, cells]) => ({
    name: cells.match(/<td>[^<]*<\/td>\s*<td>([^<]*)<\/td>/)[1],
    zone,
    label: (cells.match(/<span class="badge[^"]*"[^>]*>([^<]*)<\/span>/) || [])[1] || '',
  }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  League.getRunIn.mockResolvedValue(ROWS);
});

it('is superadmin-only', async () => {
  mockCurrentUser = CLUB_ADMIN;
  expect((await request(app).get('/admin/league-run-in')).status).toBe(403);
});

it('marks the winner, second and bottom two, and says which places are certain', async () => {
  const res = await request(app).get('/admin/league-run-in');
  expect(res.status).toBe(200);
  expect(rows(res.text)).toEqual([
    { name: 'Premier Leader', zone: 'winner', label: 'Winner' },
    { name: 'Premier Second', zone: '', label: '' },
    { name: 'Premier Third', zone: '', label: '' },
    { name: 'Premier Fourth', zone: 'down', label: 'Down' },
    { name: 'Premier Fifth', zone: 'down', label: 'Down' },
    { name: 'Runaway A', zone: 'winner', label: 'Winner, certain' },
    { name: 'Safe Second A', zone: 'up', label: 'Up, certain' },
    { name: 'Middling A', zone: '', label: '' },
    { name: 'Sinking A', zone: 'down', label: 'Down, certain' },
    { name: 'Sunk A', zone: 'down', label: 'Down, certain' },
    // Nobody is relegated from the lowest division.
    { name: 'Bottom Leader', zone: 'winner', label: 'Winner' },
    { name: 'Bottom Second', zone: 'up', label: 'Up' },
    { name: 'Bottom Last', zone: '', label: '' },
  ]);
});

it('says so when nothing has been played', async () => {
  League.getRunIn.mockResolvedValue([]);
  const res = await request(app).get('/admin/league-run-in');
  expect(res.status).toBe(200);
  expect(res.text).toContain('No results recorded this season yet.');
});
