// GET /sitemap.xml — generated per request from the database.
//
// It replaces rootfiles/sitemap.xml, which was a hand-written file last touched in
// October 2018: 27 URLs, all on `http://`, every `lastmod` seven years old, and it
// still advertised /results/Division-4 (there are four divisions now, Premier and
// 1–3, so that URL is gone). Not one of the 5,214 /event/ pages was in it, and
// robots.txt never pointed at it, so the only route into an event page was the
// homepage's rolling "Upcoming Fixtures" list — which is empty out of season. The
// whole fixture list was effectively undiscoverable.
//
// Generated rather than built at deploy time because the interesting URLs change
// with the data, not with the code: fixtures get rearranged mid-season and a
// deploy-time file would go stale between releases.
//
// Only public pages belong here. Anything behind `secured` (/player-stats,
// /pair-stats, /messer-results, /manage-players, /shuttle-prices, the whole of
// /admin) is omitted — submitting a URL that answers a login redirect is a wasted
// crawl and reads as a soft 404.
const Fixture = require('../models/fixture');
const Division = require('../models/division');
const Season = require('../models/season');
const { absoluteUrl, eventPath } = require('../utils/canonical');

// Pages that exist regardless of the data.
const STATIC_PATHS = [
  '/',
  '/info/clubs',
  '/venues',
  '/tables/All',
  '/results/All',
  '/rules',
  '/messer-rules',
  '/history',
  '/gallery',
  '/contact-us',
];

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// <lastmod> only, no <changefreq>/<priority>: Google ignores the latter two, and
// the old file's "weekly"/"0.8" claims were guesses. An omitted lastmod is better
// than an invented one, so entries with nothing real to report carry none.
function urlEntry(loc, lastmod) {
  const parts = ['  <url>', `    <loc>${xmlEscape(absoluteUrl(loc))}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  parts.push('  </url>');
  return parts.join('\n');
}

// YYYY-MM-DD in the same calendar frame `eventPath` uses.
//
// Not `toISOString().slice(0,10)`: fixture dates are stored as local midnight, so
// during BST that instant is 23:00Z the day before and the UTC rendering reports
// the fixture a day early. Local getters keep <lastmod> and the date in the URL
// referring to the same day.
function localDay(date) {
  const d = new Date(date);
  if (isNaN(d)) return null;
  return d.getFullYear()
    + '-' + ('0' + (d.getMonth() + 1)).slice(-2)
    + '-' + ('0' + d.getDate()).slice(-2);
}

exports.sitemap = async function(req, res, next) {
  try {
    const [fixtures, divisions, archivedSeasons] = await Promise.all([
      Fixture.getForSitemap(),
      Division.getAll(),
      Season.getAll(),
    ]);

    const entries = STATIC_PATHS.map(function(p) { return urlEntry(p); });

    // Current-season tables and results, one per division. `getIdByURLParam`
    // turns "Division-1" back into "Division 1", so the URL form is the name with
    // spaces hyphenated.
    divisions.forEach(function(d) {
      const slug = String(d.name).replace(/ /g, '-');
      entries.push(urlEntry('/tables/' + slug));
      entries.push(urlEntry('/results/' + slug));
    });

    // Archived seasons: the All view only. Divisions have been renamed and
    // renumbered over thirteen seasons, so /tables/Division-3/20132014 is not
    // reliably a page that exists — and Season.getAll() already returns only the
    // seasons with a real snapshot table behind them.
    archivedSeasons.forEach(function(s) {
      entries.push(urlEntry('/tables/All/' + s.name));
      entries.push(urlEntry('/results/All/' + s.name));
    });

    // Event pages. A played fixture's page stops changing once the result is in,
    // so its date is an honest lastmod; an upcoming one has no meaningful
    // modification date and gets none.
    fixtures.forEach(function(f) {
      const played = f.status === 'complete' || f.status === 'conceded';
      entries.push(urlEntry(eventPath(f), played ? localDay(f.date) : null));
    });

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + entries.join('\n') + '\n</urlset>\n';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    // Cheap to build but pointless to rebuild per crawl hit; a day is well inside
    // how fast fixture changes need to be picked up.
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(xml);
  } catch (err) {
    next(err);
  }
};
