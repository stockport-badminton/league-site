# HARD-42 — nothing the site serves is cacheable

**Severity:** high (performance) · **Wave:** P1 · **Blocked by:** nothing
**Owns:** the three `express.static` mounts in `app.js`, the asset URLs in `views/header.ejs`
and `views/footer.ejs`, `firebase.json`
**Source:** the performance review of 17 Oct 2026 (Lighthouse on production plus 18.8 days
of Cloud Run request logs).

## Why

Every asset the site serves goes out as `Cache-Control: public, max-age=0`. That is
Express's default, because `app.js` mounts `/static`, `/scripts` and the root files with
`express.static(dir)` and no options. Measured on production:

```
GET /scripts/bootstrap/dist/css/bootstrap.min.css
cache-control: public, max-age=0
x-cache: MISS
```

`max-age=0` means a browser must ask the server again before reusing a file, and the
Firebase CDN in front of Cloud Run will not hold it either. So every page view, from every
visitor, goes all the way to the container for the same five files. In the request logs:

| Asset | Requests in 18.8 days | 200 | 304 |
|---|---|---|---|
| `custom.css` | 6,059 | 6,054 | 5 |
| bootstrap.min.css | 6,016 | 6,013 | 3 |
| jquery.min.js | 5,948 | 5,946 | 2 |
| popper.min.js | 5,912 | 5,909 | 3 |
| bootstrap.min.js | 5,823 | 5,821 | 2 |

Fewer than 0.1% are 304s. In practice browsers are re-downloading the full file rather than
even revalidating it. Three of those five are render-blocking stylesheets in the head, so
on a phone, each of those requests sits directly in front of First Contentful Paint.

The service worker hides some of this. It serves `/scripts/` and `/static/` cache-first
after the first visit. But its cache is keyed on `K_REVISION`, so it is thrown away on
every deploy, and there were 58 deploy rollouts in the last 30 days. A visitor who comes
back once a week almost always meets an empty cache.

## What to do

1. **Long-lived, immutable caching for anything with a versioned URL.** The safe pattern
   is to put a version in the URL and then cache that URL for a year. Two ways:
   - prefix the asset paths with the revision (for example `/v/<K_REVISION>/scripts/...`,
     stripped by a small middleware before `express.static`); or
   - append `?v=<hash>` and have `express.static` set `maxAge: '1y', immutable: true` only
     when the query is present.

   The revision is simpler and is already what the service worker keys on. Content hashes
   would survive deploys that did not touch the file, which matters at this deploy rate.
   A per-file hash computed once at boot is cheap (about 10 files) and is the better answer.
2. **Expose one helper to views**, for example `asset('/scripts/jquery/dist/jquery.min.js')`,
   the same way `resultImagePath()` is exposed. That way no template builds an asset URL by
   hand, and a forgotten one stays on the uncached path rather than becoming stale.
3. **Unversioned URLs get a short cache, not zero.** Something like `max-age=3600` for
   `/static/` images, so the CDN can hold them. `/sw.js` and `/manifest.json` keep their
   current treatment: the service worker script must stay `no-cache`.
4. **Stop serving all of `node_modules` at `/scripts`.** It exposes every installed
   package's files, not just the four the pages use. While the mount is being changed
   anyway, serve an explicit list.

## Acceptance criteria

- Production `curl -sI` on each shell asset shows a `max-age` of at least 30 days with
  `immutable`, and a second request shows `x-cache: HIT`.
- A deploy that changes `custom.css` is visible to a returning visitor straight away,
  because the URL changed. A test asserts that the rendered `<link>` carries a version that
  changes when the file's contents do.
- `/sw.js` is still `no-cache`. That is easy to break with a blanket rule, and a cached
  service worker can pin users to an old site.
- The service worker's precache list uses the same versioned URLs, or it precaches files
  the page never asks for.

## Out of scope

- Moving assets to a separate CDN. Firebase Hosting is already a CDN once the headers
  allow it.

## Field data (PostHog, added 17 Oct 2026)

Real-user web vitals from PostHog, Stockport host, 9–17 Oct (8 days). This is the
"before" baseline to re-measure against. **It disagrees with the lab numbers above, and
both are right**: Lighthouse simulates a cold cache on throttled 4G, while these are real
visitors, often returning, on real connections. PostHog also misses anyone with an ad
blocker (there is no reverse proxy) and all superadmins. The samples are small, so read
p75 as the number and treat p90 as indicative only. CLS is ~0 and INP p75 is under 80 ms
on every route, so this is a loading problem only, as the lab said.

| | LCP p75 | LCP p90 | FCP p75 | FCP p90 | LCP samples |
|---|---|---|---|---|---|
| Mobile, all pages | 721 ms | 1.30 s | 600 ms | 1.22 s | 273 |
| Desktop, all pages | 1.14 s | 2.99 s | 933 ms | 1.89 s | 93 |

Every route is in Google's *good* band at p75. Caching is still worth doing for the
first visit after each deploy (58 a month) and for the CDN load, but it will move the
**p90 more than the p75**, so measure the effect there.
