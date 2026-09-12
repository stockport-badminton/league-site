---
name: seo
description: How search and crawlability work on this site — the generated sitemap, canonical/event/club URL helpers, the per-club landing pages, and the JSON-LD structured-data rules. Use when touching sitemapController, utils/canonical.js, utils/structuredData.js, utils/socialLinks.js, club pages, or anything about how the site appears in Google.
---

# Search / crawlability

Moved out of CLAUDE.md so it loads when it is relevant rather than in every session. Every
rule here exists because something shipped broken and could not error.

`GET /sitemap.xml` is **generated per request** by `controllers/sitemapController.js`
(~718 URLs: public static pages, tables/results per division, the archived seasons'
All views, and the last 18 months of `/event/` pages). It replaced a hand-written
`rootfiles/sitemap.xml` from 2018. Two things to keep in mind:

- `express.static('rootfiles')` is mounted in `app.js` **well before** the router, so
  re-adding a `rootfiles/sitemap.xml` would silently shadow the route. Same trap as
  `/sw.js`, which is registered early for this reason.
- Only list URLs that answer 200 to an anonymous request. Anything behind `secured`
  (`/player-stats`, `/pair-stats`, `/messer-results`, `/manage-players`,
  `/shuttle-prices`, all of `/admin`) must stay out — a login redirect in a sitemap
  reads as a soft 404. There's a test asserting this.

Event-page URLs come from `eventPath()` in `utils/canonical.js`, exposed to views as
`app.locals.eventPath`. `homepage.ejs` and the sitemap both call it: only `:id` is
read from `/event/:id/:date-:homeTeam-:awayTeam`, so a second spelling of the
decorative part would be a duplicate URL for a page that self-canonicalises. Club
pages work the same way through `clubPath()` / `app.locals.clubPath`.

**Club pages** — `/clubs/:slug` (`club_public_page`, view `club-page.ejs`), matched
by name slug against `Club.getPublicClubs()`, with `clubSlug()` dropping punctuation
rather than hyphenating it so "G.H.A.P" is `ghap`. They exist because Search Console
showed `badminton club near me` at position 24.5 on 1,387 impressions with all 18
clubs sharing the single `/info/clubs` URL — one page cannot rank for 18 local
intents. What makes them work is the town in the `<title>` plus machine-readable
address and coordinates, so keep those.

**The social columns hold bare handles, not URLs** — `ghapbadminton`, `ManorBadminton`,
and one Facebook page id, `61576463475674`. Build links with `socialLinksFor()` /
`socialUrl()` from `utils/socialLinks.js` (exposed to views as `app.locals.socialLinksFor`),
never by testing the stored value for `^https?://`. Both consumers did exactly that — the
visible links on the club page and the schema.org `sameAs` — which is correct, defensive
and completely vacuous: it dropped every handle, so no club ever rendered a social link
and `sameAs` never carried a profile. The helper still refuses anything that is not
handle-shaped, because guessing a URL out of "ask us on facebook" gives a confident link
to a page that does not exist. `sameAs` is the half that matters: it is how a search
engine connects the club page to that club's own accounts.

Two constraints on that page:
- **No captain or secretary names or contact details.** It is indexable and they are
  volunteers; enquiries go via `/contact-us?club=<id>` (which preselects the club) or
  the club's own site. There's a test asserting this.
- It must stay linked from `/info/clubs`, which is in the sitewide nav. A sitemap
  entry alone is weak — before this, the club names on that page linked straight out
  to the clubs' own websites, so nothing on the site linked to our own club pages at
  all. The outbound link is still there, just beside rather than instead.

**Structured data (JSON-LD) is built in `utils/structuredData.js`, never in a
template.** Controllers pass a `jsonLd` local — an array of already-serialised
blocks — and `header.ejs` emits them with `<%- %>`. To add markup to a page, build
an object there and pass it; do not write JSON into an EJS file.

That rule exists because the previous approach failed in two ways that could not
error: escaped-output tags escape for HTML, not JSON (a club called Mulberry's
shipped as `Mulberry&#39;s`, and a double quote would have broken the block), and
several property names were not schema.org at all — `competitor: [{"@type":
"SportsTeam", "homeTeam": "..."}]`, `"type"` instead of `"@type"` on the address,
`Lat`/`Lng` instead of `geo` — so the team names, the whole postal address and the
coordinates were silently discarded. Invalid JSON-LD is ignored, not reported.

Notes on the helpers:
- `parseUkAddress` recovers streetAddress/locality/postcode from the single freetext
  `venue.address` column by splitting on the postcode. It replaced a regex against a
  hardcoded town list that emitted match *arrays*
  (`"addressLocality": "Cheadle Hulme,Cheadle Hulme"`) and picked "Manchester" out of
  "Manchester Road". `addressRegion` is deliberately omitted — it was hardcoded
  "Cheshire" for every club including the Greater Manchester ones.
- `geoOf` drops coordinates outside a bounding box for the league's catchment,
  because one venue is stored ~110km north of it. A wrong location is worse than
  none for a "near me" query.
- `londonOffset` asks `Intl` for the offset instead of `getTimezoneOffset()`, which
  is 0 on Cloud Run — so production used to emit `startDate` with no offset at all.
- Times come from `to24h`. Check am/pm **before** treating `H:MM` as 24-hour, or
  "7:30pm" reads as 07:30.

## Related, and still in CLAUDE.md

Gotcha 1b — **never build a URL from `req.get('host')`**. Behind Firebase the Host header
is the Cloud Run one, so every canonical and `og:url` pointed at the `run.app` hostname.
`canonicalFor(req)` / `absoluteUrl(path)` from `utils/canonical.js`. That one stays in the
always-loaded file because it applies to any URL anyone builds, not just to search.
