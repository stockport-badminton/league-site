// The venue map's inline scripts on /info/clubs, and what a free-text address can do to
// them.
//
// The venue rows are embedded in an inline `<script>` block, and **the browser finds the
// end of a script element before any JavaScript is parsed**. So an address containing a
// closing script tag ends the block early: everything after it becomes page content, the
// rest of the JS renders as markup, and `initMap` is never defined — the Maps callback
// then reports `initMap is not a function` and the map is simply blank.
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

const CLOSER = '</' + 'script>';

// Every inline block on the page, in order.
function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
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

describe('GET /info/clubs inline scripts', () => {
  it('all parse as JavaScript', async () => {
    const res = await request(app).get('/info/clubs');
    expect(res.status).toBe(200);

    const blocks = inlineScripts(res.text);
    expect(blocks.length).toBeGreaterThan(0);
    for (const src of blocks) {
      // `new vm.Script` parses without running, which is what is being asserted — the
      // page's JS never executes here and does not need Maps.
      expect(() => new vm.Script(src)).not.toThrow();
    }
  });

  it('still define initMap, which the Maps callback names', async () => {
    const res = await request(app).get('/info/clubs');
    expect(inlineScripts(res.text).join('\n')).toMatch(/function\s+initMap\s*\(/);
  });

  // The reason jsonForScript exists.
  it('survive a venue address that contains a closing script tag', async () => {
    Venue.getVenueClubs.mockResolvedValue([{
      venueName: 'Nasty', Lat: 53.4, Lng: -2.2,
      address: 'Somewhere' + CLOSER + '<b>pwned</b>',
      gMapUrl: 'https://maps.example/x', matchTeams: [], clubNights: [],
    }]);

    const res = await request(app).get('/info/clubs');
    const blocks = inlineScripts(res.text);

    for (const src of blocks) expect(() => new vm.Script(src)).not.toThrow();
    // The literal tag must not reach the page, or the block ends there.
    expect(res.text).not.toContain('Somewhere' + CLOSER);
    expect(inlineScripts(res.text).join('\n')).toMatch(/function\s+initMap\s*\(/);
  });

  it('embed the venue data so it still parses back to what the model returned', async () => {
    const res = await request(app).get('/info/clubs');
    const block = inlineScripts(res.text).find(b => b.includes('var data ='));
    expect(block).toBeDefined();

    const json = block.match(/var data = ([\s\S]*?);\n/)[1];
    const data = JSON.parse(json);
    expect(data).toHaveLength(1);
    expect(data[0].address).toBe("Mulberry's Sports Complex, Cheadle");
    // Per-team, not the club's combined summary — the bug this whole change is about.
    expect(data[0].matchTeams.map(t => t.matchDay))
      .toEqual(['Thursday 8pm 2 courts', 'Wednesday 8pm 2 courts']);
  });

  // The popup builder has to be on the page before the Maps callback runs, or
  // `VenuePopup` is undefined inside initMap.
  it('load the popup builder as a blocking script before the Maps API', async () => {
    const res = await request(app).get('/info/clubs');
    const popupAt = res.text.indexOf('venue-popup.js');
    const mapsAt = res.text.indexOf('maps.googleapis.com/maps/api/js');

    expect(popupAt).toBeGreaterThan(-1);
    expect(mapsAt).toBeGreaterThan(-1);
    expect(popupAt).toBeLessThan(mapsAt);
  });
});
