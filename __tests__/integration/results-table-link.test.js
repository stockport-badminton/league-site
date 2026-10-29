const request = require('supertest');

// The results page's table icon. The nav's Tables link goes to all four tables, so a
// reader on one division's results had no direct way to that division's table.

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const app = require('../../app');

const ROW = {
  id: 7200, date: new Date('2026-10-28T00:00:00'), status: 'complete',
  homeTeam: 'Tatton A', awayTeam: 'Mellor B', homeScore: 10, awayScore: 8,
  homeClub: 'Tatton', homeClubId: 1, homeClubName: 'Tatton', awayTeamId: 2,
  division: 9, divisionName: 'Division 2', venueLink: 'https://maps.example/x',
};

beforeEach(() => {
  Fixture.getFixtureDetails.mockResolvedValue([ROW]);
});

it.each([
  ['/results/Division-2', '/tables/Division-2'],
  ['/results/Premier', '/tables/Premier'],
  ['/results/Division-2/20242025', '/tables/Division-2/20242025'],
  ['/results/All', '/tables/All'],
  ['/results-grid/Division-2', '/tables/Division-2'],
])('%s links to %s', async (page, table) => {
  const res = await request(app).get(page);
  expect(res.status).toBe(200);
  expect(res.text).toMatch(new RegExp(`<a [^>]*href="${table}"[^>]*aria-label="League table"`));
});

it('heads the Premier page "Premier", not "All"', async () => {
  // The division regex wanted a number after the name, so Premier fell through to All.
  const res = await request(app).get('/results/Premier');
  expect(res.text).toContain('<h1>Premier</h1>');
});
