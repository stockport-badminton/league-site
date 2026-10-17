# HARD-46 — the event page loads 800 KB of Google Maps before anyone asks for a map

**Severity:** low-medium (performance) · **Wave:** P3 · **Blocked by:** nothing
**Owns:** `views/viewEventDetails.ejs`, the map container style in `views/header.ejs` (one
rule, coordinate with HARD-44)
**Source:** the performance review of 17 Oct 2026.

## Why

`/event/:id/:slug`, the page each fixture's "details" link and the sitemap point at, starts
Google Maps on load: the JS API, then the `maps`, `places` and `marker` libraries, then a
`Place.fetchFields` call, then the map. In Lighthouse (mobile) that is **30 requests and
804 KB**, against about 200 KB for everything else on the page. The map tile ends up as the
page's LCP at **8.3 s**, the worst on the site.

Each page load also costs Maps JavaScript and Places API usage on the league's key, whether
or not anyone scrolls to the map.

Traffic tempers the priority: of 9,843 requests in 18.8 days, 8,434 were bots and
1,409 real people. Bots do not run the map, so the API spend is mostly real visitors. But
1,409 real people a fortnight is real.

## What to do

1. **Show the venue as a link, not a live map, until asked.** Render the address and a
   "Show map" button, or a plain link to
   `https://www.google.com/maps/search/?api=1&query=…`, which opens the Maps app on a phone,
   and is what most people want from a venue anyway. Load the JS API on the button press,
   or when the container scrolls into view (`IntersectionObserver`).
2. **Give the map container a real height** (an `aspect-ratio` rule) so that, when it does
   load, nothing moves.
3. A **static map image** would be the obvious middle ground, but the Static Maps API is
   not on `GMAPSAPIKEY`'s allowed list (restricted 1 Oct, see CLAUDE.md). Adding it is a
   key change in GCP, not just a code change. Prefer option 1.
4. Remove the `console.log(place.location)` left in the page.

## Acceptance criteria

- Lighthouse mobile on an event page: no `maps.googleapis.com` requests before
  interaction, LCP under 2.5 s.
- The map still appears, and still shows the venue, after the button press. That needs a
  browser test, since nothing server-side can see it.
- `--check all` is irrelevant here, but the CSP allowlist is not: the Maps hosts stay
  allowed, because the map still loads on demand.

## Field data (PostHog, added 17 Oct 2026)

Real-user web vitals from PostHog, Stockport host, 9–17 Oct (8 days). This is the
"before" baseline to re-measure against. **It disagrees with the lab numbers above, and
both are right**: Lighthouse simulates a cold cache on throttled 4G, while these are real
visitors, often returning, on real connections. PostHog also misses anyone with an ad
blocker (there is no reverse proxy) and all superadmins. The samples are small, so read
p75 as the number and treat p90 as indicative only. CLS is ~0 and INP p75 is under 80 ms
on every route, so this is a loading problem only, as the lab said.

**PostHog recorded 4 pageviews of `/event/*` in 8 days**, and 2 web-vitals samples with
no LCP among them. Over the same days, `/results/:division` had 171. The Cloud Run logs'
"1,409 real people in 18.8 days" would predict ~600. Event pages load PostHog like every
other page (`header.ejs`), so the gap is not a missing tag. It means that almost all of
what the logs counted as people were crawlers with browser user agents, which also do not
run the map. For the other content pages, PostHog sees roughly 40% of the log count. For
`/event/*` it sees under 1%.

**So this package has almost no real users behind it. Defer it** below everything else
in this wave, unless the Maps bill says otherwise. That bill would have to come from those
same crawlers, and only if they execute JavaScript.
