# HARD-45 — the results pages block on a third-party CDN, and the division view is slow to build

**Severity:** medium (performance) · **Wave:** P2 · **Blocked by:** nothing (it touches
DataTables tags, not the shell)
**Owns:** `views/datatables-css.ejs`, `views/datatables-scripts.ejs`, `views/datatables.ejs`,
`views/fixtures-results.ejs`, `fixture_detail_byDivision` in `controllers/fixtureController.js`
and `Fixture.getFixtureDetails`
**Source:** the performance review of 17 Oct 2026.

## Why

`/results/:division` and `/results/:division/:season` are the most-used content pages after
the homepage and the event pages (941 and 392 real visits in 18.8 days), and the slowest in
the lab: `/results/All` scored **65**, with **FCP 4.9 s**. Two independent problems.

### The browser: render-blocking from `cdn.datatables.net`

The DataTables stylesheet sits in the head and comes from another origin, so first paint
waits for a DNS lookup, a TLS handshake and a download from a host nothing else on the page
uses. Lighthouse puts datatables.min.css at **770 ms** of render-blocking. The 158 KB
bundle and two plug-ins then load as **synchronous** scripts in sequence, the second of
them over a protocol-relative URL (`//cdn.datatables.net/plug-ins/...`).

The table is rendered on the server, so the content is in the HTML. DataTables only adds
paging, sorting and the jump-to-today, so nothing needs to wait for it.

1. **Self-host DataTables** from `node_modules`, as Bootstrap and jQuery already are, so
   it shares the site's connection and HARD-42's caching. That also removes the CDN from
   the CSP allowlist.
2. **`defer` the scripts**, and initialise on `DOMContentLoaded` rather than
   `$(document).ready` inline.
3. Consider rendering the season's rows **already paginated** (first page visible, the
   rest `hidden`). Today the whole season (a few hundred rows) is laid out before
   DataTables collapses it to 20, which is wasted layout on a phone. Measure before doing
   this one, since it changes what crawlers see.

### The server: the per-season view has a long tail

| Route (non-bot) | p50 | p75 | p95 |
|---|---|---|---|
| `/results/:division` | 85 ms | 127 ms | 1.13 s |
| `/results/:division/:season` | 220 ms | **970 ms** | **1.83 s** |
| `/tables/:division/:season` | 95 ms | 394 ms | 1.49 s |

Past seasons read from the per-season archive tables. The handler runs
`Division.getIdByURLParam` and then `Fixture.getFixtureDetails` in sequence. Start with
`EXPLAIN ANALYZE` on the season query against production (through `dbq`, which is
read-only). An archive table with no index on the column the query filters on would
produce exactly this p75. Past seasons never change, so the result can also be cached in
memory indefinitely, keyed on season and division.

## Acceptance criteria

- No request to `cdn.datatables.net` on any page, and no render-blocking resource from
  another origin on `/results/*` in Lighthouse.
- The filter toolbar, date-jump and CSV button still work: `e2e/filter-toolbar.spec.js`
  passes.
- p75 for `/results/:division/:season` under 300 ms in the request logs a week after
  deploy, or a written explanation of why not.

## Out of scope

- The player-stats pages. They are `secured`, so real traffic is small, and they share the
  DataTables fix automatically.

## Field data (PostHog, added 17 Oct 2026)

Real-user web vitals from PostHog, Stockport host, 9–17 Oct (8 days). This is the
"before" baseline to re-measure against. **It disagrees with the lab numbers above, and
both are right**: Lighthouse simulates a cold cache on throttled 4G, while these are real
visitors, often returning, on real connections. PostHog also misses anyone with an ad
blocker (there is no reverse proxy) and all superadmins. The samples are small, so read
p75 as the number and treat p90 as indicative only. CLS is ~0 and INP p75 is under 80 ms
on every route, so this is a loading problem only, as the lab said.

**The results pages are already fast in the field**, which lowers this package's
priority:

| Route | LCP p75 | LCP p90 | FCP p75 | LCP samples |
|---|---|---|---|---|
| `/results/:division` | 610 ms | 1.06 s | 592 ms | 84 |
| `/results/:division/:season` | 440 ms | 714 ms | 413 ms | 52 |

The lab's 4.9 s FCP is a cold-cache, cross-origin DataTables fetch on throttled 4G, and
real visitors mostly do not pay it. Self-hosting is still right, for the CSP allowlist
and HARD-42's caching. The server-side p75 of 970 ms on past seasons does not show up
here as a slow FCP, though the sample is small.

## Outcome (17 Oct 2026)

**Browser:** DataTables is self-hosted in `static/vendor/datatables/`. The four files are
byte-for-byte what `cdn.datatables.net` served, not an npm install: the bundle is a builder
output (DataTables 1.10.20 + Buttons, ColVis, HTML5 export, FixedHeader, Responsive) and the
npm equivalent is ten packages at different versions, which would be an upgrade rather than
a move. Served through `asset()`, so HARD-42's immutable caching applies. All three scripts
are `defer`; document order is preserved, so the plug-ins still run after the bundle, and
jQuery's `ready` (which the inline initialisers use) fires on DOMContentLoaded, after
deferred scripts. The CDN is out of the CSP. The only other cross-origin tags in the head
are gtag (`async`) and the Sentry loader (`defer`).

**Server: deliberately unchanged, and this is the written explanation the third criterion
allows.** Measured on production:

- The past-season query (`/results/All/20242025`, 309 rows) runs in **30 ms warm, 90 ms
  cold**. Most of it is the `hasDraft` subplan (24k of 27k buffers), which is still small.
- Of 309 non-bot `/results/:division/:season` requests between 3 and 17 Oct, **296 came
  from Google IP ranges** (66.249.x, 142.250.x) under ordinary Chrome user agents: its
  renderer, fetching several seasons within the same 30 ms. They make up the whole tail
  (p75 1.08 s). The **13 from anyone else had p75 222 ms**, already under target.
- The 970 ms p75 in the table above is therefore Google's concurrency stacking requests on
  one instance, not a slow page. An in-memory cache would speed up a crawler, not a person.
  Revisit only if real-visitor latency moves. The bot filter used for "non-bot" was a
  user-agent regex, which is exactly what this traffic gets past. **When reading request
  latency, split by IP range as well as by user agent.**

Item 3 (render rows pre-paginated) was not done: field FCP p75 on past seasons is already
413 ms, and the brief asked for a measurement before changing what crawlers see.

Still to do after deploy: Lighthouse on `/results/All` to confirm the 770 ms of
render-blocking is gone.
