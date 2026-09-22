// The venue map on /info/clubs, in a real browser.
//
// This is the layer Jest cannot reach: it renders the route with supertest and never runs
// the page's JavaScript. The Jest tests beside this one PARSE the inline blocks and assert
// the embedded JSON round-trips — neither of which proves the code executes.
//
// It matters here because the popup content used to be built in SQL with `concat` and
// handed over as ready-made HTML. It is now assembled in the browser by
// `static/beta/js/venue-popup.js`, from `matchTeams` (per TEAM, with that team's
// `matchDay`) and `clubNights` (per CLUB) — because `club.matchNightText` is a
// hand-written summary that lumps every team into one string and cannot say which team
// plays when.
//
// **The Google Maps API is not expected to load here.** `e2e/server-env.js` assigns dead
// credentials, so the key is a fake and the page falls back to a static image — which is
// the behaviour `showMapFallback()` exists for. That is deliberate: the popup builder is
// a plain script and is testable without Maps, and a spec that needed a live third-party
// API to pass would be a spec that fails on a train.
//
// Read-only: the page is a GET. See e2e/helpers/read-only.js.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

test.describe('the venue map', function () {
  test.beforeEach(async function ({ page, baseURL }) {
    await readOnly(page, baseURL);
  });

  test('loads the popup builder and the venue data', async function ({ page }) {
    await page.goto('/info/clubs');

    // Defined by the time the page has settled, and before the Maps callback would run.
    expect(await page.evaluate(() => typeof window.VenuePopup)).toBe('object');
    expect(await page.evaluate(() => typeof window.VenuePopup.popupHtml)).toBe('function');
  });

  // The inline block embeds the rows with jsonForScript(). If that ever regressed to a
  // bare JSON.stringify, an address containing a closing script tag would end the block
  // early and initMap would never be defined — so assert it IS.
  test('defines initMap, which the Maps callback names', async function ({ page }) {
    await page.goto('/info/clubs');
    expect(await page.evaluate(() => typeof window.initMap)).toBe('function');
  });

  test('builds a pin from the real data, per team rather than per club', async function ({ page }) {
    await page.goto('/info/clubs');

    // `data` is function-scoped inside the page's own script block and cannot be read from
    // outside it, so fetch the same page again and render every venue through the same
    // function the page uses. That keeps the rows the server's, not the test's.
    const html = await page.evaluate(async () => {
      const res = await fetch('/info/clubs');
      const text = await res.text();
      const m = text.match(/var data = ([\s\S]*?);\n/);
      const rows = JSON.parse(m[1]);
      return rows.map(v => window.VenuePopup.popupHtml(v));
    });

    expect(html.length).toBeGreaterThan(0);
    for (const one of html) {
      expect(one).toContain('map-popup');
      // The club-level summary must never be the thing a pin prints as a match night.
      expect(one).not.toMatch(/Match Night:/);
      // Built, not concatenated in SQL — the old markup had these ids.
      expect(one).not.toContain('firstHeading');
      expect(one).not.toContain('bodyContent');
    }
  });

  // A venue where two teams of the same club play on different nights is the whole reason
  // for the change. Whichever venue that is in this database, its pin must name both.
  test('names each team and its own night where they differ', async function ({ page }) {
    await page.goto('/info/clubs');

    const found = await page.evaluate(async () => {
      const res = await fetch('/info/clubs');
      const m = (await res.text()).match(/var data = ([\s\S]*?);\n/);
      const rows = JSON.parse(m[1]);
      for (const v of rows) {
        const days = new Set((v.matchTeams || []).map(t => t.matchDay));
        if (days.size > 1) {
          return { venue: v.venueName, days: [...days], html: window.VenuePopup.popupHtml(v) };
        }
      }
      return null;
    });

    test.skip(!found, 'no venue in this database has teams on differing nights');
    for (const day of found.days) expect(found.html).toContain(day);
  });

  test('escapes what it prints, and raises no uncaught errors', async function ({ page }) {
    // `pageerror` only — an UNCAUGHT JavaScript exception, which is what a broken inline
    // block or a missing VenuePopup would produce.
    //
    // Console errors are deliberately not asserted, because three appear here for reasons
    // that are nothing to do with this page's code and would make the spec fail on a
    // correct build: `/static/generated/venues-map.png` 404s (the map's fallback image is
    // generated into S3 and is simply absent locally), the Cross-Origin-Opener-Policy
    // header is ignored because the test server is http, and a cross-origin request is
    // aborted by e2e/helpers/read-only.js on purpose. A test that fails for reasons the
    // code cannot fix is one people learn to ignore.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/info/clubs');

    const escaped = await page.evaluate(() => {
      const venue = {
        venueName: 'V', address: "Mulberry's", gMapUrl: 'https://x.example',
        matchTeams: [{ club: '<img onerror=alert(1)>', website: 'javascript:alert(1)', team: 'T', matchDay: 'Mon & Tue' }],
        clubNights: [],
      };
      return window.VenuePopup.popupHtml(venue);
    });

    expect(escaped).not.toContain('<img');
    expect(escaped).not.toContain('javascript:');
    expect(escaped).toContain('Mon &amp; Tue');

    // The Maps API cannot load with a dead key, and its own failures are not this page's
    // JavaScript — filter to exceptions the page itself raised.
    const ours = errors.filter(e => !/maps|google|ApiNotActivated|InvalidKey|RefererNotAllowed/i.test(e));
    expect(ours).toEqual([]);
  });
});
