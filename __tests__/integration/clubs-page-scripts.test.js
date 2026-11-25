// The venue map's scripts on /info/clubs, and what a free-text address can do to them.
//
// The venue rows are embedded in the page, and **the browser finds the end of a script
// element before anything inside it is parsed**. So an address containing a closing script
// tag ends the element early: the rest renders as markup, and the map has no data. Since
// REARCH-07 step 5 the rows are a JSON data block (#venue-data) and the code is
// static/beta/js/venue-map.js; the block can still be ended early, which is why
// jsonForScript escapes it.
//
// That is not hypothetical for these fields. This database already holds
// `Mulberry's Sports Complex` in a venue address and two `&`s in match-night text, all of
// it typed by an admin.
//
// Ported from the Tameside site alongside the popup rewrite.

process.env.NODE_ENV = 'test';

jest.mock('../../models/club');
jest.mock('../../models/venue');
jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/season');
jest.mock('../../models/roster');
jest.mock('../../models/auth.js');
jest.mock('axios');

const request = require('supertest');
const vm = require('vm');
const Club = require('../../models/club');
const Venue = require('../../models/venue');
const Roster = require('../../models/roster');
const app = require('../../app');

const fs = require('fs');
const path = require('path');

const CLOSER = '</' + 'script>';
const JS = name => fs.readFileSync(path.join(__dirname, '../../static/beta/js', name), 'utf8');

// Every inline block on the page that is script rather than data, in order.
function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)(?![^>]*application\/(?:ld\+)?json)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

// The page's venue rows, as the browser will read them.
function venueData(html) {
  const m = html.match(/<script type="application\/json" id="venue-data">([\s\S]*?)<\/script>/);
  return m && JSON.parse(m[1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  Roster.NO_CLUB_ID = 63;
  Club.clubDetail.mockResolvedValue([]);
  Venue.getVenueClubs.mockResolvedValue([{
    venueName: 'Woods Lane Sports Centre',
    Lat: 53.3638, Lng: -2.18831,
    address: "Mulberry's Sports Complex, Cheadle",
    gMapUrl: 'https://maps.example/x',
    matchTeams: [
      { club: 'Featherforce', website: 'https://ff.example', team: 'Featherforce A', matchDay: 'Thursday 8pm 2 courts' },
      { club: 'Featherforce', website: 'https://ff.example', team: 'Featherforce B', matchDay: 'Wednesday 8pm 2 courts' },
    ],
    clubNights: [{ club: 'Featherforce', website: 'https://ff.example', clubNightText: 'Weds & Thurs 8pm' }],
  }]);
});

describe('GET /info/clubs venue map scripts', () => {
  it('has no inline script left, and the files it loads all parse', async () => {
    const res = await request(app).get('/info/clubs');
    expect(res.status).toBe(200);
    expect(inlineScripts(res.text)).toEqual([]);
    for (const name of ['venue-popup.js', 'venue-map.js', 'club-contact.js']) {
      expect(res.text).toContain(`/static/beta/js/${name}?v=`);
      // `new vm.Script` parses without running; the page's JS needs Maps to run.
      expect(() => new vm.Script(JS(name))).not.toThrow();
    }
  });

  it('defines initMap at the top level, where the Maps callback finds it by name', () => {
    expect(JS('venue-map.js')).toMatch(/^function\s+initMap\s*\(/m);
  });

  // The reason jsonForScript exists.
  it('survives a venue address that contains a closing script tag', async () => {
    Venue.getVenueClubs.mockResolvedValue([{
      venueName: 'Nasty', Lat: 53.4, Lng: -2.2,
      address: 'Somewhere' + CLOSER + '<b>pwned</b>',
      gMapUrl: 'https://maps.example/x', matchTeams: [], clubNights: [],
    }]);

    const res = await request(app).get('/info/clubs');
    // The literal tag must not reach the page, or the data block ends there.
    expect(res.text).not.toContain('Somewhere' + CLOSER);
    expect(venueData(res.text)[0].address).toBe('Somewhere' + CLOSER + '<b>pwned</b>');
  });

  // Racketeer, Remnants and David Lloyd hold "NA": they have no club night of their own.
  it('blanks a placeholder club night in the table and the map data', async () => {
    Club.clubDetail.mockResolvedValue([{
      clubId: 59, name: 'Racketeer', teamName: 'Racketeer A', clubvenue: 'David Lloyd Leisure',
      clubaddress: 'Royal Crescent, Cheadle Hulme, SK8 3FL', teammatchvenue: 'David Lloyd Leisure',
      matchDay: 'Monday', matchNightText: 'Monday 8pm 2 courts', clubNightText: 'NA',
    }]);
    Venue.getVenueClubs.mockResolvedValue([{
      venueName: 'David Lloyd Leisure', Lat: 53.37, Lng: -2.2, address: 'Royal Crescent',
      gMapUrl: 'https://maps.example/x', matchTeams: [],
      clubNights: [{ club: 'Racketeer', website: null, clubNightText: 'NA' }],
    }]);

    const res = await request(app).get('/info/clubs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Racketeer');
    expect(res.text).not.toMatch(/<td>\s*NA\s*<\/td>/);
    expect(venueData(res.text)[0].clubNights[0].clubNightText).toBeNull();
  });

  it('embeds the venue data so it parses back to what the model returned', async () => {
    const res = await request(app).get('/info/clubs');
    const data = venueData(res.text);
    expect(data).toHaveLength(1);
    expect(data[0].address).toBe("Mulberry's Sports Complex, Cheadle");
    // Per-team, not the club's combined summary — the bug this whole change is about.
    expect(data[0].matchTeams.map(t => t.matchDay))
      .toEqual(['Thursday 8pm 2 courts', 'Wednesday 8pm 2 courts']);
  });

  // The popup builder has to be on the page before the Maps callback runs, or
  // `VenuePopup` is undefined inside initMap. venue-map.js is what loads Maps.
  it('loads the popup builder as a blocking script before the one that loads Maps', async () => {
    const res = await request(app).get('/info/clubs');
    const popupAt = res.text.indexOf('venue-popup.js');
    const mapAt = res.text.indexOf('venue-map.js');
    expect(popupAt).toBeGreaterThan(-1);
    expect(popupAt).toBeLessThan(mapAt);
    expect(JS('venue-map.js')).toContain('maps.googleapis.com/maps/api/js');
    expect(res.text).toMatch(/<div id="map" data-maps-key="[^"]*"><\/div>/);
  });
});
