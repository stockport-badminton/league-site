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
jest.mock('../../models/teamStrength');
jest.mock('../../models/league');
jest.mock('axios');
// Who is signed in, for the scorecard link's visibility. devMode is the app-wide middleware
// that sets req.user locally; here it sets whoever the test names, or nobody.
let mockUser = null;
jest.mock('../../middleware/devMode', () => (req, res, next) => { if (mockUser) req.user = mockUser; next(); });
const userFor = (role, club) => ({ id: 'auth0|t', _json: { 'https://my-app.example.com/role': role, 'https://my-app.example.com/club': club } });

const Fixture = require('../../models/fixture');
const Division = require('../../models/division');
const Season = require('../../models/season');
const Club = require('../../models/club');
const Roster = require('../../models/roster');
const app = require('../../app');

Roster.NO_CLUB_ID = 63;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
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
    expect(withCaptain.text).toContain('<dt>Team Captain</dt><dd>Lesley Beale</dd>');
    expect(withCaptain.text).toContain('<dt>Match Secretary</dt><dd>Claire Inglis</dd>');

    Fixture.getFixtureEventById.mockResolvedValue([eventRow({ teamCaptain: null })]);
    const without = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
    expect(without.text).not.toContain('Team Captain');
    expect(without.text).toContain('<dt>Match Secretary</dt><dd>Claire Inglis</dd>');
  });

  // The away team is who needs the home venue's entrance and parking notes.
  it("shows the home venue's Getting there notes, escaped, and nothing when there are none", async () => {
    Fixture.getFixtureEventById.mockResolvedValue([eventRow({ venueDirections: 'Use the South site entrance & overflow car park.' })]);
    const res = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
    expect(res.text).toMatch(/<dt>Getting there<\/dt><dd[^>]*>Use the South site entrance &amp; overflow car park.<\/dd>/);

    Fixture.getFixtureEventById.mockResolvedValue([eventRow({ venueDirections: null })]);
    const without = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
    expect(without.status).toBe(200);
    expect(without.text).not.toContain('Getting there');
  });

  // HARD-46. That Maps is not REQUESTED before the press is proved in the browser
  // (e2e/event-map.spec.js); this pins the markup the button and script hang off.
  it('offers the map behind a button, centred on the venue coordinates, with no Places lookup', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([eventRow()]);
    const res = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
    expect(res.text).toContain('id="eventMapShow"');
    // The coordinates are data attributes and the code is static/beta/js/event-map.js
    // since REARCH-07 step 5, so the "no Places lookup" checks read the file.
    expect(res.text).toContain('data-lat="53.3261" data-lng="-2.22766"');
    expect(res.text).toMatch(/<script src="\/static\/beta\/js\/event-map\.js\?v=[0-9a-f]+"><\/script>/);
    const script = require('fs').readFileSync(require('path').join(__dirname, '../../static/beta/js/event-map.js'), 'utf8');
    expect(script).toContain('importLibrary("maps")');
    expect(script).not.toContain('fetchFields');
    expect(script).not.toContain('importLibrary("places")');

    Fixture.getFixtureEventById.mockResolvedValue([eventRow({ Lat: null, Lng: null })]);
    const without = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
    expect(without.status).toBe(200);
    expect(without.text).not.toContain('id="eventMap"');
    expect(without.text).not.toContain('event-map.js');
    expect(without.text).not.toContain('importLibrary');
  });

  it('404s a fixture id that does not exist', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([]);
    const res = await request(app).get('/event/999999/01012027-A-B');
    expect(res.status).toBe(404);
  });

  // A headless crawler opens every page in a fresh browser, so a 404 that registered the
  // service worker precached ~11 pages per dead link it followed: ~7,000 of the 16,700
  // requests in the Nov 2026 crawl.
  it('does not register the service worker from a 404, and still does from a page', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([]);
    const missing = await request(app).get('/event/999999/01012027-A-B');
    expect(missing.status).toBe(404);
    expect(missing.text).toContain('<link rel="manifest" href="/manifest.json">'); // the same head
    // The registration is a file since REARCH-07 step 5 (static/beta/js/sw-register.js).
    expect(missing.text).not.toContain('sw-register.js');
    expect(missing.text).not.toContain('serviceWorker.register');

    Fixture.getFixtureEventById.mockResolvedValue([eventRow()]);
    const found = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
    expect(found.status).toBe(200);
    expect(found.text).toMatch(/<script defer src="\/static\/beta\/js\/sw-register\.js\?v=[0-9a-f]+"><\/script>/);
    expect(require('fs').readFileSync(require('path').join(__dirname, '../../static/beta/js/sw-register.js'), 'utf8'))
      .toContain("navigator.serviceWorker.register('/sw.js'");
  });

  it('never answers 200 with an empty body', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([]);
    const res = await request(app).get('/event/999999/01012027-A-B');
    expect(res.status).not.toBe(200);
    expect(res.text.trim()).not.toBe('{}');
  });

  // Assert on the JSON-LD that actually reaches the HTML, parsed. The old markup was
  // a template string, so nothing checked that what shipped was even valid JSON —
  // and invalid JSON-LD is silently ignored rather than erroring.
  describe('JSON-LD', () => {
    function ldFrom(html) {
      return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
        .map(m => JSON.parse(m[1]));
    }

    it('emits one valid SportsEvent with usable teams, address and coordinates', async () => {
      Fixture.getFixtureEventById.mockResolvedValue([eventRow({ teamCaptain: 'X Y' })]);
      const res = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
      const ld = ldFrom(res.text);

      expect(ld.map(b => b['@type'])).toEqual(['SportsEvent', 'BreadcrumbList']);
      const e = ld[0];
      expect(e['@context']).toBe('https://schema.org');
      expect(e['@type']).toBe('SportsEvent');
      expect(e.homeTeam.name).toBe('Manor B');
      expect(e.awayTeam.name).toBe('Parrswood C');
      expect(e.location.address['@type']).toBe('PostalAddress');
      expect(e.location.address.postalCode).toBe('SK9 1BU');
      expect(e.location.geo['@type']).toBe('GeoCoordinates');
      expect(e.startDate).toMatch(/^2026-09-01T19:00:00(\+01:00|Z)$/);
    });

    it('carries none of the invented properties the old markup used', async () => {
      Fixture.getFixtureEventById.mockResolvedValue([eventRow()]);
      const res = await request(app).get('/event/7388/01092026-Manor%20B-Parrswood%20C');
      const raw = JSON.stringify(ldFrom(res.text)[0]);
      expect(raw).not.toContain('"Lat"');
      expect(raw).not.toContain('"Lng"');
      expect(raw).not.toContain('"competitor"');
      expect(raw).not.toContain('"type":"PostalAddress"');
      expect(raw).not.toContain('http://schema.org');
    });

    it('does not HTML-escape into the JSON', async () => {
      Fixture.getFixtureEventById.mockResolvedValue([eventRow({ homeTeam: "Mulberry's A" })]);
      const res = await request(app).get('/event/7388/x-y-z');
      const e = ldFrom(res.text)[0];
      expect(e.homeTeam.name).toBe("Mulberry's A");
      // The league name contains an ampersand; it must survive as one.
      expect(e.organizer.name).toContain('&');
      expect(JSON.stringify(e)).not.toContain('&#39;');
    });
  });
});

// The preview, the prediction and the match report (utils/fixturePreview.js), from the
// nightly run's public block (TeamStrength.forecastFor) and the fixtures around this one.
describe('GET /event/:id — preview, prediction and report', () => {
  const TeamStrength = require('../../models/teamStrength');
  const League = require('../../models/league');
  const { captureLog } = require('../helpers/captureLog');
  const URL = '/event/7388/01092026-Manor%20B-Parrswood%20C';

  const row = over => eventRow({ homeTeamId: 11, awayTeamId: 22, teamCaptain: 'Lesley Beale', ...over });
  const forecast = {
    ran_at: '2026-08-31T02:30:00Z',
    fixture: { pHome: 0.71, pDraw: 0.08, pAway: 0.21, expected: 10.9, likely: { home: 11, away: 7 },
      edges: { mens: 4.2, ladies: 2.1, mixed: 3.1 } },
    home: { teams: 8, men: 1, ladies: 5, overall: 2, fixtures: 4, settled: 0.9, last: 6,
      projection: { teams: 8, expected: 1.8, pWinner: 0.41, pUp: 0.7, pDown: 0 } },
    away: { teams: 8, men: 6, ladies: 7, overall: 7, fixtures: 4, settled: 0.5, last: 4,
      projection: { teams: 8, expected: 6.9, pWinner: 0, pUp: 0, pDown: 0.55 } },
  };
  const played = (id, home, away, hs, as, date) => ({ id, date, homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as,
    homeName: home === 11 ? 'Manor B' : home === 22 ? 'Parrswood C' : 'Other A', awayName: away === 11 ? 'Manor B' : away === 22 ? 'Parrswood C' : 'Other A' });
  const context = {
    season: '20262027',
    form: [played(901, 11, 33, 12, 6, '2026-08-25'), played(902, 33, 22, 10, 8, '2026-08-24'), played(903, 11, 33, 13, 5, '2026-08-18')],
    meetings: [played(800, 22, 11, 7, 11, '2026-03-02')],
    games: [],
  };

  beforeEach(() => {
    Season.current.mockReturnValue('20262027');
    Fixture.getMatchContext.mockResolvedValue(context);
    TeamStrength.forecastFor.mockResolvedValue(forecast);
    League.getRunIn.mockResolvedValue([
      { id: 11, divisionName: 'Division 3', gamesWon: 25, gamesLost: 11, played: 2 },
      { id: 22, divisionName: 'Division 3', gamesWon: 8, gamesLost: 10, played: 1 },
      { id: 44, divisionName: 'Division 2', gamesWon: 30, gamesLost: 6, played: 2 },
    ]);
  });

  it('writes a preview with the forecast, form and table places, and names no player', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([row()]);
    const res = await request(app).get(URL);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Match preview');
    expect(res.text).toContain('Manor B host Parrswood C in Division 3');
    expect(res.text).toContain('Manor B are 1st of 2'); // the table filtered to this division
    expect(res.text).toMatch(/Manor B are (clear )?favourites/);
    expect(res.text).toContain('Most likely score: <strong>11–7</strong>');
    expect(res.text).toContain('should have the edge in the men’s doubles');
    expect(res.text).toContain('Head to head');
    expect(res.text).toContain('Manor B won the last meeting 11–7');
    // Form chips link to those fixtures' own pages, spelt as eventPath spells them.
    expect(res.text).toContain('href="/event/901/');
    // The only person named anywhere is the officer the page has always shown.
    expect(res.text).not.toMatch(/Lesley Beale[^<]*(favourite|form|line-up)/);
  });

  // A fixture against a withdrawn team has no page of its own (HARD-11), so neither its form
  // chip nor a previous meeting may link to it. They did: a scraper followed over a thousand
  // such links to 404s in Nov 2026.
  it('shows a result that has no page of its own, but does not link to it', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([row()]);
    Fixture.getMatchContext.mockResolvedValue({ ...context,
      form: [{ ...played(901, 11, 33, 12, 6, '2026-08-25'), hasPage: false }, ...context.form.slice(1)],
      meetings: [{ ...played(800, 22, 11, 7, 11, '2026-03-02'), hasPage: false }],
    });
    const res = await request(app).get(URL);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('href="/event/901/');
    expect(res.text).not.toContain('href="/event/800/');
    expect(res.text).toMatch(/<span class="ev-chip ev-W" title="Won 12–6 v Other A, [^"]+">W<small>12–6<\/small><\/span>/);
    expect(res.text).toContain('<time datetime="2026-03-02">'); // the meeting is still listed
    expect(res.text).toContain('href="/event/903/'); // a result that has a page still links
  });

  it('leads the title and description with the matchup, and leaves the logo as the image', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([row()]);
    const res = await request(app).get(URL);
    expect(res.text).toMatch(/<title>Manor B vs Parrswood C – Division 3 preview &amp; prediction, 1 Sept? 2026 \| Stockport &amp; District Badminton League<\/title>/);
    expect(res.text).toMatch(/<meta name="description" content="Manor B vs Parrswood C, Division 3 badminton, Tuesday,? 1 September 2026. Preview and prediction: Manor B 71% favourites.">/);
    expect(res.text).toContain('SDBLLogo.png');
  });

  it('reports a result, with the games by type and the result card as the image', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([row({ status: 'complete', homeScore: 13, awayScore: 5 })]);
    Fixture.getMatchContext.mockResolvedValue({ ...context, games: [
      ...Array(6).fill({ gameType: 'FirstMens', homeScore: 21, awayScore: 10 }),
      ...Array(6).fill(null).map((_, i) => ({ gameType: 'FirstLadies', homeScore: i < 2 ? 21 : 15, awayScore: i < 2 ? 18 : 21 })),
      ...Array(6).fill(null).map((_, i) => ({ gameType: 'SecondMixed', homeScore: i < 5 ? 21 : 19, awayScore: i < 5 ? 17 : 21 })),
    ] });
    const res = await request(app).get(URL);
    expect(res.text).toContain('Match report');
    // 13–5 is a comfortable win, which has two phrasings; the fixture id picks one.
    expect(res.text).toMatch(/Manor B beat Parrswood C comfortably in Division 3, winning 13–5|A convincing 13–5 win for Manor B over Parrswood C in Division 3/);
    expect(res.text).toContain('Manor B took the men’s doubles 6–0, Parrswood C took the ladies’ doubles 4–2 and Manor B took the mixed 5–1.');
    // Signed out: the report, but no way into the scorecard.
    expect(res.text).not.toContain('/scorecard/fixture/');
    expect(res.text).toContain('<meta property="og:image" content="https://stockport-badminton.co.uk/resultImage/Manor%20B/Parrswood%20C/13/5/Division%203.jpg">');
    // No prediction once the result is in, and no table: it describes the wrong moment.
    expect(res.text).not.toContain('Most likely score');
    expect(League.getRunIn).not.toHaveBeenCalled();
  });

  // Who played is a club's business (the results page shows its Details link to admins only):
  // a superadmin, or someone signed in for either club, gets the link; nobody else does.
  it.each([
    ['a superadmin', userFor('superadmin', 'All'), true],
    ['the home club', userFor('admin', 'Manor'), true],
    ['the away club', userFor('admin', 'Parrswood'), true],
    ['another club', userFor('admin', 'Mellor'), false],
    ['a signed-in user with no club', userFor(undefined, undefined), false],
  ])('links the scorecard of a played match for %s: %s', async (who, user, shown) => {
    mockUser = user;
    Fixture.getFixtureEventById.mockResolvedValue([row({ status: 'complete', homeScore: 13, awayScore: 5 })]);
    const res = await request(app).get(URL);
    expect(res.status).toBe(200);
    expect(res.text.includes('href="/scorecard/fixture/7388"')).toBe(shown);
    // A page carrying the link belongs to that viewer alone.
    if (shown) expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('marks a rearranged fixture as postponed in its markup', async () => {
    Fixture.getFixtureEventById.mockResolvedValue([row({ status: 'rearranged' })]);
    const res = await request(app).get(URL);
    const ld = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    expect(ld[0].eventStatus).toBe('https://schema.org/EventPostponed');
    expect(res.text).not.toContain('Most likely score');
  });

  it('still renders the fixture when the forecast and context cannot be read, and says why in the log', async () => {
    const log = captureLog(['error']);
    Fixture.getFixtureEventById.mockResolvedValue([row()]);
    Fixture.getMatchContext.mockRejectedValue(new Error('context down'));
    TeamStrength.forecastFor.mockRejectedValue(new Error('no strength_run'));
    const res = await request(app).get(URL);
    const logged = log.text();
    log.restore();
    expect(res.status).toBe(200);
    expect(res.text).toContain('Wilmslow Leisure Centre');
    expect(res.text).not.toContain('Most likely score');
    expect(logged).toContain('[event] forecast unavailable');
    expect(logged).toContain('[event] match context unavailable');
  });
});

describe('GET / — sitewide identity and upcoming fixtures', () => {
  const HomepageContent = require('../../models/homepageContent');
  const SiteSettings = require('../../models/siteSettings');

  function ldFrom(html) {
    return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(m => JSON.parse(m[1]));
  }

  beforeEach(() => {
    Fixture.getOutstandingScorecards.mockResolvedValue([]);
    Fixture.getRecent.mockResolvedValue([]);
    Fixture.getupComing.mockResolvedValue([]);
    HomepageContent.getActive.mockResolvedValue([]);
    SiteSettings.get.mockResolvedValue('messer2026');
  });

  it('always states who the site belongs to', async () => {
    const res = await request(app).get('/');
    const ld = ldFrom(res.text);
    expect(ld).toHaveLength(1);
    const types = ld[0]['@graph'].map(n => n['@type']);
    expect(types).toContain('SportsOrganization');
    expect(types).toContain('WebSite');
  });

  it('adds a SportsEvent per upcoming fixture', async () => {
    Fixture.getupComing.mockResolvedValue([
      { id: 1, date: '2026-09-03T00:00:00', homeTeam: 'Mellor A', awayTeam: 'Aerospace A',
        venueName: 'Mellor', venueAddress: 'Mellor Sports Club, Mellor SK6 5PN',
        Lat: 53.3935, Lng: -2.0397, startTime: '19:00', endTime: '23:00', divisionName: 'Division 2' },
    ]);
    const res = await request(app).get('/');
    const ld = ldFrom(res.text);
    expect(ld).toHaveLength(2);
    expect(ld[1]['@type']).toBe('SportsEvent');
    expect(ld[1].url).toBe('https://stockport-badminton.co.uk/event/1/03092026-Mellor%20A-Aerospace%20A');
  });

  it('emits only the identity block out of season', async () => {
    const res = await request(app).get('/');
    expect(ldFrom(res.text)).toHaveLength(1);
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
    Club.getPublicClubs.mockResolvedValue([{ id: 57, name: 'Parrs Wood' }]);
  });

  it('includes a page per club', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('<loc>https://stockport-badminton.co.uk/clubs/parrs-wood</loc>');
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
