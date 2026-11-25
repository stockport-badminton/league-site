// The venue map on /event/:id/:slug, in a real browser (HARD-46).
//
// Google Maps used to start on load: the JS API, then the maps, places and marker
// libraries, a Place.fetchFields call and the tiles — 30 requests and ~800 KB, and the
// page's LCP at 8.3 s in Lighthouse. It now waits for "Show map". Only a browser can see
// that, because the requests are made by the page's own script.
//
// **The real Maps API is not loaded.** The e2e server may carry a real local key
// (config/schema.js, GMAPSAPIKEY `e2e: 'local'`), but a spec that needed Google to pass
// would fail on a train. Instead the API script is answered with a
// stub that implements just what the page calls (importLibrary → Map, AdvancedMarkerElement)
// and records the arguments, which is enough to prove the press loads the API and centres
// the map on the venue.
//
// Read-only: the page is a GET. See e2e/helpers/read-only.js.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

const STUB = `
  google.maps.importLibrary = async function (name) {
    return {
      maps: { Map: function (el, opts) { window.__evMap = opts; el.setAttribute('data-stub-map', '1'); } },
      marker: { AdvancedMarkerElement: function (opts) { window.__evMarker = opts; } },
    }[name];
  };
`;

function isMaps(url) {
  return /(^|\.)(googleapis|gstatic)\.com$/.test(new URL(url).hostname);
}

// An event page whose venue has coordinates, taken from the local sitemap.
async function eventWithMap(page) {
  const xml = await (await page.request.get('/sitemap.xml')).text();
  const paths = [...xml.matchAll(/<loc>https?:\/\/[^/<]+(\/event\/[^<]+)<\/loc>/g)].map(m => m[1]);
  for (const p of paths.slice(0, 20)) {
    const html = await (await page.request.get(p)).text();
    if (html.includes('id="eventMap"')) return p;
  }
  return null;
}

test.describe('the event page map', function () {
  test('loads nothing from Google until asked, then shows the venue', async function ({ page, baseURL }) {
    await readOnly(page, baseURL);
    const path = await eventWithMap(page);
    test.skip(!path, 'no event page in this database has a venue with coordinates');

    const mapsRequests = [];
    page.on('request', r => { if (isMaps(r.url())) mapsRequests.push(r.url()); });

    // Registered after readOnly(), so it is consulted first.
    await page.route(/^https:\/\/maps\.googleapis\.com\/maps\/api\/js/, function (route) {
      const callback = new URL(route.request().url()).searchParams.get('callback');
      return route.fulfill({ contentType: 'text/javascript', body: STUB + `\n${callback}();` });
    });

    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(mapsRequests).toEqual([]);

    const box = page.locator('#eventMap');
    const before = await box.boundingBox();

    await page.getByRole('button', { name: 'Show map' }).click();
    await expect(box).toHaveAttribute('data-stub-map', '1');
    expect(mapsRequests.length).toBe(1);
    expect(mapsRequests[0]).toMatch(/maps\.googleapis\.com\/maps\/api\/js/);

    // Centred on the venue, with a pin on it, and no Places lookup.
    const center = await page.evaluate(() => window.__evMap.center);
    expect(typeof center.lat).toBe('number');
    expect(typeof center.lng).toBe('number');
    expect(await page.evaluate(() => window.__evMarker.position)).toEqual(center);
    expect(new URL(mapsRequests[0]).searchParams.get('libraries')).not.toContain('places');

    // The box was already its final size: the map arriving resized nothing. (Position is
    // viewport-relative and the click scrolls, so compare the size only.)
    const after = await box.boundingBox();
    expect([after.width, after.height]).toEqual([before.width, before.height]);
  });

  test('says so, and keeps the link, when the API cannot load', async function ({ page, baseURL }) {
    await readOnly(page, baseURL);
    const path = await eventWithMap(page);
    test.skip(!path, 'no event page in this database has a venue with coordinates');
    // readOnly() lets cross-origin GETs through, so fail the API script as an outage would.
    await page.route(/^https:\/\/maps\.googleapis\.com\//, route => route.abort());

    await page.goto(path);
    await page.getByRole('button', { name: 'Show map' }).click();
    await expect(page.locator('#eventMap')).toContainText('could not be loaded');
  });
});
