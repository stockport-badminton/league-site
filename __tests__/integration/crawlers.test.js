// robots.txt, llms.txt, X-Robots-Tag and the absolute og:image (Nov 2026; the same change
// Tameside made in 78caf40).
//
// The rule being protected: nothing that needs a login is crawlable or indexable, and
// everything public is. robots.txt is derived from the route table, so these tests check it
// against the REAL router in both directions — a hand-written expected list would just be a
// second copy of the thing that drifts.

const fs = require('fs');
const path = require('path');
const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/season');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/auth.js');
jest.mock('../../models/homepageContent');
jest.mock('../../models/siteSettings');
jest.mock('../../models/club');
jest.mock('../../models/roster');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const Division = require('../../models/division');
const Season = require('../../models/season');
const Club = require('../../models/club');
const Roster = require('../../models/roster');
const app = require('../../app');
const { routeTable, sampleUrlsFor } = require('../../utils/routeTable');
const robots = require('../../utils/robots');

Roster.NO_CLUB_ID = 63;
const SITE = 'https://stockport-badminton.co.uk';
const rules = robots.disallowRules(app);
const extras = robots.EXTRA_DISALLOW.map(([p]) => p);
const getRoutes = routeTable(app).filter(r => r.method === 'GET');

beforeEach(() => jest.clearAllMocks());

describe('robots.txt is derived from the route access declarations', () => {
  it('disallows every GET route that is not public', () => {
    const open = [];
    for (const r of getRoutes.filter(r => r.access !== 'public')) {
      const urls = sampleUrlsFor(app, r);
      if (urls.length === 0) open.push(`${r.path} (${r.access}): no sample URL to check`);
      for (const url of urls) {
        if (!robots.isDisallowed(rules, url)) open.push(`${r.path} (${r.access}): ${url}`);
      }
    }
    expect(open).toEqual([]);
  });

  it('disallows no public GET route, apart from the listed extras', () => {
    const blocked = [];
    for (const r of getRoutes.filter(r => r.access === 'public')) {
      for (const url of sampleUrlsFor(app, r)) {
        if (robots.isDisallowed(rules, url) && !robots.isDisallowed(extras, url)) {
          blocked.push(`${r.path}: ${url}`);
        }
      }
    }
    expect(blocked).toEqual([]);
  });

  it('does not let a shared literal prefix hide a public page', () => {
    expect(robots.isDisallowed(rules, '/player/7/update')).toBe(true);
    expect(robots.isDisallowed(rules, '/club/7')).toBe(true);
    expect(robots.isDisallowed(rules, '/admin/clubs')).toBe(true);
    expect(robots.isDisallowed(rules, '/playerStats/7/Dave-Lee')).toBe(false);
    expect(robots.isDisallowed(rules, '/clubs/ghap')).toBe(false);
    expect(robots.isDisallowed(rules, '/info/clubs')).toBe(false);
    expect(robots.isDisallowed(rules, '/forms/team-registration')).toBe(false);
    expect(robots.isDisallowed(rules, '/event/7313/03092026-Mellor%20A-Aerospace%20A')).toBe(false);
  });

  it('turns parameters into wildcards and drops trailing ones', () => {
    expect(robots.ruleFor('/missed-three/:playerId(\\d+)/notice')).toBe('/missed-three/*/notice');
    expect(robots.ruleFor('/club/:id')).toBe('/club/');
    expect(robots.ruleFor('/admin/results/*')).toBe('/admin/results/');
    expect(robots.ruleFor('/players/club-:club?')).toBe('/players/club-');
    expect(robots.ruleFor('/admin')).toBe('/admin');
  });

  it('is served as text, welcomes the AI crawlers by name and names the sitemap', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    for (const ua of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'CCBot', '*']) {
      expect(res.text).toContain('User-agent: ' + ua + '\n');
    }
    // One group: no bot may be told `Disallow: /`.
    expect(res.text).not.toMatch(/^Disallow: \/\s*$/m);
    expect(res.text).toContain(`Sitemap: ${SITE}/sitemap.xml\n`);
  });

  it('is not shadowed by a file in rootfiles/ (mounted before the router)', () => {
    for (const f of ['robots.txt', 'llms.txt', 'sitemap.xml']) {
      expect(fs.existsSync(path.join(__dirname, '../../rootfiles', f))).toBe(false);
    }
  });
});

describe('X-Robots-Tag', () => {
  it('marks a login-gated route noindex, even on its redirect to /login', async () => {
    const res = await request(app).get('/email-scorecard');
    expect(res.status).toBe(302);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('leaves a public page alone', async () => {
    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });
});

describe('og:image', () => {
  it('is absolute, on the configured domain', async () => {
    const res = await request(app).get('/rules');
    expect(res.text).toMatch(new RegExp(
      `<meta property="og:image" content="${SITE}/static/beta/images/SDBLLogo\\.png(\\?v=[^"]+)?">`));
  });
});

describe('llms.txt', () => {
  beforeEach(() => {
    Season.current.mockReturnValue('20262027');
    Division.getAll.mockResolvedValue([{ name: 'Premier' }, { name: 'Division 1' }]);
    Club.getPublicClubs.mockResolvedValue([
      { id: 57, name: 'Parrs Wood', clubNightText: 'Tuesday\n 8pm', venueName: 'Parrs Wood Centre',
        venueAddress: 'Wilmslow Road, Didsbury M20 5PG', clubWebsite: 'https://example.com/' },
      { id: 12, name: 'G.H.A.P', clubNightText: null },
    ]);
  });

  it('describes the league from the club and division data', async () => {
    const res = await request(app).get('/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.text.startsWith('# Stockport & District Badminton League\n')).toBe(true);
    expect(res.text).toContain('The 2026/27 season has 2 divisions (Premier, Division 1) and 2 member clubs.');
    expect(res.text).toContain(`- [Parrs Wood](${SITE}/clubs/parrs-wood): club night Tuesday 8pm at `
      + 'Parrs Wood Centre (Wilmslow Road, Didsbury M20 5PG). Website: https://example.com/');
    expect(res.text).toContain(`- [G.H.A.P](${SITE}/clubs/ghap)\n`);
    expect(res.text).toContain(`(${SITE}/tables/Premier)`);
    expect(Club.getPublicClubs).toHaveBeenCalledWith(63);
  });

  it('links only to URLs robots.txt allows', async () => {
    const res = await request(app).get('/llms.txt');
    const paths = [...res.text.matchAll(/https:\/\/stockport-badminton\.co\.uk(\/[^)\s]*)/g)]
      .map(m => m[1].replace(/\.$/, ''));
    expect(paths.length).toBeGreaterThan(10);
    expect(paths.filter(p => robots.isDisallowed(rules, p))).toEqual([]);
  });
});

describe('sitemap.xml', () => {
  it('lists only URLs robots.txt allows', async () => {
    Fixture.getForSitemap.mockResolvedValue([
      { id: 7313, date: new Date(2026, 8, 3), status: 'complete', homeTeam: 'Mellor A', awayTeam: 'Aerospace A' },
    ]);
    Division.getAll.mockResolvedValue([{ name: 'Premier' }]);
    Season.getAll.mockResolvedValue([{ name: '20252026' }]);
    Club.getPublicClubs.mockResolvedValue([{ id: 57, name: 'Parrs Wood' }]);
    const res = await request(app).get('/sitemap.xml');
    const paths = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].slice(SITE.length));
    expect(paths.length).toBeGreaterThan(10);
    expect(paths.filter(p => robots.isDisallowed(rules, p))).toEqual([]);
  });
});
