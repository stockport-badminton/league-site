const request = require('supertest');

jest.mock('../../models/club');
jest.mock('../../models/venue');
jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/season');
jest.mock('../../models/roster');
jest.mock('../../models/auth.js');
jest.mock('axios');

const Club = require('../../models/club');
const Roster = require('../../models/roster');
const app = require('../../app');

// The sentinel ids the real model exports; the mock has to supply them because the
// controller filters on them.
Roster.NO_CLUB_ID = 63;
Roster.NO_TEAM_ID = 52;

const CLUBS = [
  {
    id: 57, name: 'Parrs Wood',
    clubNight: 'Tue', clubNightText: 'Tuesday 8pm', clubNightCourts: 2,
    matchNightText: 'Tuesday 8pm 2 courts',
    clubWebsite: 'https://www.parrswoodbadminton.co.uk/',
    facebook: null, instagram: null, twitter: null,
    venueName: 'Parrswood Sports Centre',
    venueAddress: 'Parrswood Sports Centre, Parrswood High School, Wilmslow Road, East Didsbury, M20 5PG',
    gMapUrl: 'https://goo.gl/maps/x', Lat: 53.4093, Lng: -2.21972, placeId: 'p',
  },
  {
    id: 53, name: 'G.H.A.P',
    clubNight: 'Wed', clubNightText: 'Wedsnesday 6pm - 9pm', clubNightCourts: 4,
    matchNightText: 'Tuesday 7.30pm 2 courts', clubWebsite: null,
    venueName: 'Old Trafford Sports Barn',
    venueAddress: 'Old Trafford Sports Barn, Seymour Park, Carver Street, Manchester, M16 9PQ',
    gMapUrl: null, Lat: 53.4603, Lng: -2.27558, placeId: null,
  },
];

const TEAMS = [
  { id: 1, name: 'Parrswood A', matchDay: 'Tuesday 8pm', startTime: '20:00',
    divisionName: 'Division 1', venueName: 'Parrswood Sports Centre',
    venueAddress: '...', gMapUrl: 'https://goo.gl/maps/x' },
];

beforeEach(() => {
  jest.clearAllMocks();
  Club.getPublicClubs.mockResolvedValue(CLUBS);
  Club.getTeamsForClub.mockResolvedValue(TEAMS);
});

function ldFrom(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => JSON.parse(m[1]));
}

// These pages exist because Search Console showed "badminton club near me" at
// position 24.5 with all 18 clubs sharing the single /info/clubs URL. The things
// worth locking down are the ones that make a page rankable for a *local* query:
// its own URL, the town in the title, and machine-readable address + coordinates.
describe('GET /clubs/:slug', () => {
  it('renders a club on its own URL', async () => {
    const res = await request(app).get('/clubs/parrs-wood');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Parrs Wood Badminton Club');
    expect(res.text).toContain('Parrswood Sports Centre');
  });

  it('puts the town in the title and description', async () => {
    const res = await request(app).get('/clubs/parrs-wood');
    expect(res.text).toMatch(/<title>[^<]*Parrs Wood Badminton Club, East Didsbury[^<]*<\/title>/);
    expect(res.text).toMatch(/name="description" content="[^"]*East Didsbury/);
  });

  it('self-canonicalises to the club page', async () => {
    const res = await request(app).get('/clubs/parrs-wood');
    expect(res.text).toMatch(/rel="canonical"\s*href="https:\/\/stockport-badminton\.co\.uk\/clubs\/parrs-wood"/);
  });

  it('slugs punctuation away rather than into hyphens', async () => {
    const res = await request(app).get('/clubs/ghap');
    expect(res.status).toBe(200);
    expect(res.text).toContain('G.H.A.P Badminton Club');
  });

  it('404s an unknown club', async () => {
    const res = await request(app).get('/clubs/nonesuch');
    expect(res.status).toBe(404);
  });

  it('404s the No Club sentinel', async () => {
    // getPublicClubs excludes it, so there is nothing to match.
    const res = await request(app).get('/clubs/no-club');
    expect(res.status).toBe(404);
  });

  it('lists the teams with links to their division tables', async () => {
    const res = await request(app).get('/clubs/parrs-wood');
    expect(res.text).toContain('Parrswood A');
    expect(res.text).toContain('href="/tables/Division-1"');
  });

  it('links out to the club website and to the league contact form', async () => {
    const res = await request(app).get('/clubs/parrs-wood');
    expect(res.text).toContain('https://www.parrswoodbadminton.co.uk/');
    expect(res.text).toContain('/contact-us?club=57');
  });

  it('publishes no captain or secretary details', async () => {
    // Explicitly out of scope for these pages — they are indexable, and those are
    // volunteers' personal details.
    const res = await request(app).get('/clubs/parrs-wood');
    expect(res.text).not.toMatch(/Team Captain/i);
    expect(res.text).not.toMatch(/Match Secretary/i);
  });

  it('copes with a club that has no website and no map link', async () => {
    const res = await request(app).get('/clubs/ghap');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('href="null"');
    expect(res.text).not.toContain('undefined');
  });

  describe('JSON-LD', () => {
    it('emits SportsClub with address, coordinates and opening hours', async () => {
      const ld = ldFrom((await request(app).get('/clubs/parrs-wood')).text);
      const club = ld.find(o => o['@type'] === 'SportsClub');
      expect(club.url).toBe('https://stockport-badminton.co.uk/clubs/parrs-wood');
      expect(club.address.addressLocality).toBe('East Didsbury');
      expect(club.address.postalCode).toBe('M20 5PG');
      expect(club.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 53.4093, longitude: -2.21972 });
      expect(club.openingHoursSpecification[0].dayOfWeek).toBe('https://schema.org/Tuesday');
      expect(club.sameAs).toContain('https://www.parrswoodbadminton.co.uk/');
    });

    it('emits a breadcrumb trail', async () => {
      const ld = ldFrom((await request(app).get('/clubs/parrs-wood')).text);
      const bc = ld.find(o => o['@type'] === 'BreadcrumbList');
      expect(bc.itemListElement.map(i => i.name))
        .toEqual(['Home', 'Clubs', 'Parrs Wood Badminton Club']);
      expect(bc.itemListElement[2].item).toBe('https://stockport-badminton.co.uk/clubs/parrs-wood');
    });
  });
});

describe('GET /info/clubs — the hub', () => {
  const Venue = require('../../models/venue');

  beforeEach(() => {
    // clubDetail() fans out over teams; the controller regroups it.
    Club.clubDetail.mockResolvedValue([
      { clubId: 57, name: 'Parrs Wood', teamName: 'Parrswood A', matchDay: 'Tuesday',
        clubvenue: 'Parrswood Sports Centre', clubgmap: 'https://goo.gl/maps/x',
        clubaddress: 'Parrswood Sports Centre, Wilmslow Road, East Didsbury, M20 5PG',
        clubLat: 53.4093, clubLng: -2.21972, clubNight: 'Tue',
        matchNightText: 'Tuesday 8pm', clubNightText: 'Tuesday 8pm',
        clubWebsite: 'https://www.parrswoodbadminton.co.uk/',
        facebook: null, instagram: null, twitter: null,
        teammatchvenue: 'Parrswood Sports Centre', teamgmap: 'https://goo.gl/maps/x',
        teamaddress: 'Wilmslow Road' },
    ]);
    Venue.getVenueClubs.mockResolvedValue([]);
  });

  it('links each club to its own page, so the pages are not orphans', async () => {
    // A sitemap entry alone is weak; the pages need an inbound link, and /info/clubs
    // is in the sitewide nav.
    const res = await request(app).get('/info/clubs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/clubs/parrs-wood"');
  });

  it('keeps the outbound link to the club\'s own website', async () => {
    const res = await request(app).get('/info/clubs');
    expect(res.text).toContain('https://www.parrswoodbadminton.co.uk/');
  });

  it('points its SportsClub markup at the club page, not an anchor', async () => {
    const res = await request(app).get('/info/clubs');
    const ld = ldFrom(res.text);
    expect(ld[0].url).toBe('https://stockport-badminton.co.uk/clubs/parrs-wood');
    expect(ld[0].url).not.toContain('#club-');
  });
});
