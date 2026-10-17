// HARD-44 item 2: the page background (`main.respBgImg`) is the LCP element on most pages,
// and it was a PNG with no format negotiation — 114 KB at w_1920, against 4.6 KB of AVIF for
// the same URL with f_auto,q_auto (measured 17 Oct 2026; 20.7 KB -> 2.2 KB at w_300).
// Every Cloudinary background in custom.css must ask for the format the browser accepts.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../static/beta/css/custom.css'), 'utf8');
const cloudinaryUrls = [...css.matchAll(/url\(["']?(https:\/\/res\.cloudinary\.com\/[^"')]+)["']?\)/g)].map(m => m[1]);

test('custom.css still has the responsive backgrounds this guards', () => {
  // If this drops to 0 the guard below passes vacuously; fix the pattern, not the count.
  expect(cloudinaryUrls.length).toBeGreaterThanOrEqual(6);
});

test('every Cloudinary background in custom.css negotiates its format', () => {
  const missing = cloudinaryUrls.filter(u => !/\/f_auto,q_auto\//.test(u));
  expect(missing).toEqual([]);
});
