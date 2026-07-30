// Canonical (and og:url) construction for every rendered page.
//
// This used to be an expression copy-pasted into ~58 render calls across the
// controllers, in eight slightly different spellings, all of them variations on:
//
//   ("https://" + req.get("host") + req.originalUrl)
//     .replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
//
// The `.replace` chain is archaeology from the Heroku days, and one variant even
// searched for the literal string `www.'` (a stray quote), so it never matched
// anything. None of that mattered next to the real problem: `req.get('host')`.
//
// Firebase Hosting rewrites `**` to Cloud Run and the Host header that arrives is
// the *Cloud Run* one (the originally requested host is passed separately, in
// `x-fh-requested-host` — note it in the response `Vary`). So every page on the
// site declared its canonical URL to be on
// `league-site-akvq7tsxuq-nw.a.run.app`, which also serves the whole site
// publicly and un-noindexed. We were telling Google the authoritative copy of
// every page lived on a different hostname, and pointing og:url there too.
//
// The canonical host is a property of the site, not of the request, so it is not
// read from the request at all. SITE_ORIGIN exists so a staging deploy can
// declare itself rather than claim to be production.
const DEFAULT_ORIGIN = 'https://stockport-badminton.co.uk';

// Params that identify a click, not a page. Left in the canonical they split one
// page into many URLs; nothing on this site varies its content by them. Anything
// not listed is kept, because several pages do vary by query string.
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', 'ref', 'source',
];

function siteOrigin() {
  return (process.env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

// `req.originalUrl` is the raw request target, so it keeps the percent-encoding
// the client sent — which is what a canonical needs (event URLs carry team names
// with spaces).
function canonicalFor(req) {
  const raw = req.originalUrl || '/';
  const cut = raw.indexOf('?');
  if (cut === -1) return siteOrigin() + raw;

  const path = raw.slice(0, cut);
  const params = new URLSearchParams(raw.slice(cut + 1));
  for (const p of TRACKING_PARAMS) params.delete(p);
  const kept = params.toString();
  return siteOrigin() + path + (kept ? '?' + kept : '');
}

// For URLs built outside a request (sitemap entries, emailed links).
function absoluteUrl(pathname) {
  return siteOrigin() + (pathname.startsWith('/') ? pathname : '/' + pathname);
}

// Path for an event page: /event/:id/DDMMYYYY-HomeTeam-AwayTeam
//
// The route is `/event/:id/:date-:homeTeam-:awayTeam` but only `:id` is ever read,
// so the rest is decorative — which is exactly why it needs to be built in one
// place. homepage.ejs assembles it inline, and if the sitemap assembled it even
// slightly differently we would be submitting a second URL for a page that
// self-canonicalises, i.e. manufacturing duplicates. Same date arithmetic as the
// template (local-time getters, DD/MM/YYYY with the slashes stripped) so the two
// agree by construction.
//
// Spaces are percent-encoded here because a sitemap is XML and must carry a valid
// URI; the template's unencoded href resolves to the same thing once the browser
// encodes it.
function eventPath(fixture) {
  const { y, m, d } = localYmd(fixture.date);
  const slug = `${d}${m}${y}-${fixture.homeTeam}-${fixture.awayTeam}`;
  return `/event/${fixture.id}/${encodeURIComponent(slug).replace(/%2F/g, '-')}`;
}

// Club name -> URL slug. Punctuation is removed rather than turned into hyphens, so
// "G.H.A.P" is `ghap` and not `g-h-a-p`.
function clubSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

// A club's own public page. Same reasoning as eventPath: it is built in one place so
// the link on /info/clubs, the sitemap entry and the `url` in the club's SportsClub
// markup cannot disagree.
function clubPath(club) {
  return '/clubs/' + clubSlug(club && club.name);
}

// The calendar day a fixture falls on, as zero-padded strings, read with local-time
// getters. Shared so the URL slug, the sitemap's <lastmod> and the JSON-LD
// startDate all name the same day: fixture.date is stored as local midnight, so
// under BST the UTC rendering of that instant is the day before.
function localYmd(date) {
  const dt = new Date(date);
  return {
    y: String(dt.getFullYear()),
    m: ('0' + (dt.getMonth() + 1)).slice(-2),
    d: ('0' + dt.getDate()).slice(-2),
  };
}

module.exports = {
  canonicalFor, absoluteUrl, siteOrigin,
  eventPath, clubPath, clubSlug, localYmd,
  DEFAULT_ORIGIN,
};
