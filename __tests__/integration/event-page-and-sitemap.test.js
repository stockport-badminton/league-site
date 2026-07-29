const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/season');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/auth.js');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const Division = require('../../models/division');
const Season = require('../../models/season');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
});

// A row shaped like getFixtureEventById returns. `teamCaptain` is deliberately
// nullable — six teams have nobody flagged as captain.
function eventRow(over = {}) {
  return {
    id: 7388,
    date: '2026-09-01T00:00:00',
    homeTeam: 'Manor B',
    awayTeam: 'Parrswood C',
    homeClub: 'Manor',
    clubWebsite: 'https://example.com',
    awayClub: 'Parrswood',
    divisionName: 'Division 3',
    venueName: 'Wilmslow Leisure Centre',
    venueAddress: 'Rectory Fields, Wilmslow SK9 1BU',
    venueLink: 'https://goo.gl/maps/x',
    Lat: 53.3261,
    Lng: -2.22766,
    placeId: 'abc',
    startTime: '19:00',
    endTime: '23:00',
    status: 'outstanding',
    homeScore: null,
    awayScore: null,
    teamCaptain: null,
    teamCaptainId: null,
    matchSecretary: 'Claire Inglis',
    matchSecretaryId: 99,
    ...over,
  };
}

// These assert on rendered HTML rather than which view was chosen. The whole point
// is that the page had a 200 status and no content — a test that checked the view
// name would have passed throughout.
describe('GET /event/:id/:date-:homeTeam-:awayTeam', () => {
  it('renders a fixture whose home team has no captain flagged', async () => {
    // Regression: this used to be 48 of the 272 fixtures in the 2026/27 season.
    // getFixtureEventById INNER JOINed the captain, the controller read row[0] of an
    // empty result, and `res.send(err)` serialised the TypeError to `{}` — at status
    // 200. Googlebot got a valid, empty, two-byte page.
    Fixture.getFixtureEventById.mockResolvedValue([eventRow()]);
    const res = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Manor B vs Parrswood C');
    expect(res.text).toContain('Wilmslow Leisure Centre');
    expect(res.text.length).toBeGreaterThan(1000);
    expect(res.text.trim()).not.toBe('{}');
  });

  it('shows the captain when there is one, and no dangling label when there is not', async () => {
    // The aliases were `AS teamCaptain` unquoted, so Postgres folded them to
    // `teamcaptain` while the template read `.teamCaptain`: both lines rendered
    // blank on every event page that did render.
    Fixture.getFixtureEventById.mockResolvedValue([eventRow({ teamCaptain: 'Lesley Beale' })]);
    const withCaptain = await request(app).get('/event/7313/03092026-Mellor%20A-Aerospace%20A');
    expect(withCaptain.text).toContain('Team Captain: Lesley Beale');
    expect(withCaptain.text).toContain('Match Secretary: Claire Inglis');

    Fixture.getFixtureEventById.mockResolvedValue([eventRow({ teamCaptain: null })]);
    const without = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
    expect(without.text).not.toContain('Team Captain:');
    expect(without.text).toContain('Match Secretary: Claire Inglis');
  });

  it('404s a fixture id that does not exist', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([]);
    const res = await request(app).get('/event/999999/01012027-A-B');
    expect(res.status).toBe(404);
  });

  it('never answers 200 with an empty body', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([]);
    const res = await request(app).get('/event/999999/01012027-A-B');
    expect(res.status).not.toBe(200);
    expect(res.text.trim()).not.toBe('{}');
  });
});

describe('GET /sitemap.xml', () => {
  beforeEach(() => {
    Fixture.getForSitemap.mockResolvedValue([
      { id: 7313, date: '2026-09-03T00:00:00', status: 'outstanding', homeTeam: 'Mellor A', awayTeam: 'Aerospace A' },
      { id: 6564, date: '2026-05-06T00:00:00', status: 'complete', homeTeam: 'Featherforce A', awayTeam: 'Dome A' },
    ]);
    Division.getAll.mockResolvedValue([{ name: 'Premier' }, { name: 'Division 1' }]);
    Season.getAll.mockResolvedValue([{ name: '20252026', label: '2025/26' }]);
  });

  it('serves XML', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it('lists every URL on the canonical domain, never the Cloud Run host', async () => {
    const res = await request(app).get('/sitemap.xml');
    const locs = [...res.text.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc.startsWith('https://stockport-badminton.co.uk/')).toBe(true);
    }
    expect(res.text).not.toContain('run.app');
    expect(res.text).not.toContain('http://stockport-badminton');
  });

  it('includes event pages, built with the same helper the homepage links use', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('<loc>https://stockport-badminton.co.uk/event/7313/03092026-Mellor%20A-Aerospace%20A</loc>');
  });

  it('hyphenates division names into their URL form', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('<loc>https://stockport-badminton.co.uk/tables/Division-1</loc>');
    expect(res.text).toContain('<loc>https://stockport-badminton.co.uk/results/Premier</loc>');
  });

  it('only claims a lastmod for fixtures that have been played', async () => {
    const res = await request(app).get('/sitemap.xml');
    const played = res.text.match(/<url>\s*<loc>[^<]*event\/6564[^<]*<\/loc>\s*<lastmod>([^<]*)<\/lastmod>/);
    expect(played).not.toBeNull();
    expect(played[1]).toBe('2026-05-06');
    // The upcoming one has no meaningful modification date, so it carries none.
    const upcoming = res.text.match(/<url>\s*<loc>[^<]*event\/7313[^<]*<\/loc>\s*<\/url>/);
    expect(upcoming).not.toBeNull();
  });

  it('lists no URL that sits behind the login', async () => {
    const res = await request(app).get('/sitemap.xml');
    for (const gated of ['/player-stats', '/pair-stats', '/messer-results', '/manage-players', '/admin', '/shuttle-prices']) {
      expect(res.text).not.toContain('.co.uk' + gated);
    }
  });
});
