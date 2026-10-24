# HARD-43 — the homepage waits on Cloudinary, on every request

**Severity:** high (performance and availability) · **Wave:** P1 · **Blocked by:** nothing
**Owns:** `fixture_get_summary` in `controllers/fixtureController.js`,
`views/generatedTournamentGallery.ejs`, the Sentry uptime monitor's URL (Sentry, not repo)
**Source:** the performance review of 17 Oct 2026.

## Why

`/` is the slowest common page on the site by a wide margin. In the request logs (non-bot,
18.8 days): p50 **450 ms**, against 40–100 ms for every other content page. The rest of the
handler is fine: its five database reads run under one `Promise.all`. What follows is the
problem:

```js
const response = await axios.get('https://…@api.cloudinary.com/v1_1/hvunsveuh/resources/image/tags/…');
```

That is a call to Cloudinary's **Admin API**, made **on every homepage request**, with
**no timeout**, and it must finish before the page can start rendering. Three consequences,
all measured:

1. **It sets the homepage's floor.** About 180 ms of TTFB that no other page pays
   (curl, five samples: 390–660 ms for `/` against 215–270 ms for the other pages).
2. **When Cloudinary is slow, the homepage is slow, and nothing else is.** 16 Oct, 20:25 to
   21:30: `/` reached **19.4 s** while every other route stayed under 1.2 s, and the log
   shows `Cloudinary fetch failed: Request failed with status code 500` in that hour. The
   catch already renders the page without the gallery when the call fails. A timeout is
   all that is missing for a *slow* call to get the same treatment.
3. **Most of those calls are a robot's.** 27,044 of the 32,896 requests to `/` in the
   window came from `SentryUptimeBot`, about one a minute. That is roughly 1,440 Admin API
   calls a day to show the uptime monitor a carousel nobody sees. The Admin API is
   rate-limited per hour, and this is the same budget the real visitors' gallery depends on.

Then, in the browser, the result is rendered as a **hidden** Bootstrap modal holding up to
30 `<img>` tags with no `loading="lazy"`. Hidden does not stop an image downloading:
Lighthouse recorded the gallery as **10 requests / 425 KB** on a page whose own HTML, CSS
and JavaScript total about 160 KB. On a phone those bytes compete with the page's real
content for the same connection.

## What to do

1. **Cache the tag listing in memory** for around 10 minutes, keyed on the tag. A new
   gallery tag set in `/admin` should take effect immediately, so clear the entry when
   that setting is saved, or include the tag in the key (it already is). Serve the stale
   copy if a refresh fails.
2. **Give the call a timeout** of about 1.5 s (`axios` `timeout`), and do not block the
   render on a refresh: return the cached copy and refresh in the background.
3. **Load the gallery images only when the modal opens.** Put the URLs in `data-src` and
   set `src` on the modal's `show.bs.modal` event, or at minimum add `loading="lazy"` plus
   real `width`/`height`. The first is the reliable one: lazy loading inside a
   `display:none` container is browser-dependent.
4. **Point the Sentry uptime monitor at `/health`**, which exists for exactly this (see
   gotcha 1bb in CLAUDE.md: `/health`, never `/healthz`). It still proves the container
   answers. It also stops the monitor reporting Cloudinary's latency as ours.
   Note: that once-a-minute probe is also what keeps an instance warm, since `minScale` is
   unset. Moving it to `/health` keeps that effect.

## Acceptance criteria

- Two homepage requests in a row make at most one Cloudinary call (a unit test with the
  HTTP call mocked and counted).
- A Cloudinary call that never answers produces a homepage in under 2 s without the
  gallery. Test it with a mock that hangs. That test must fail with the timeout removed.
- A Lighthouse run on `/` shows no gallery image requests until the modal is opened.
- Non-bot p50 for `/` in the request logs falls into line with the other pages
  (under ~150 ms), measured a week after deploy.

## Out of scope

- Replacing the Cloudinary gallery. It is the Messer photo feature and it works.

## Field data (PostHog, added 17 Oct 2026)

Real-user web vitals from PostHog, Stockport host, 9–17 Oct (8 days). This is the
"before" baseline to re-measure against. **It disagrees with the lab numbers above, and
both are right**: Lighthouse simulates a cold cache on throttled 4G, while these are real
visitors, often returning, on real connections. PostHog also misses anyone with an ad
blocker (there is no reverse proxy) and all superadmins. The samples are small, so read
p75 as the number and treat p90 as indicative only. CLS is ~0 and INP p75 is under 80 ms
on every route, so this is a loading problem only, as the lab said.

**`/` is the slowest content page in the field too, which makes this the package the data
supports best.**

| Route | LCP p75 | LCP p90 | FCP p75 | FCP p90 | LCP samples |
|---|---|---|---|---|---|
| `/` | **1.18 s** | **2.35 s** | **1.21 s** | **2.21 s** | 81 |
| `/` desktop only | 2.20 s | 2.79 s | 1.83 s | — | 16 |
| `/results/:division` | 610 ms | 1.06 s | 592 ms | 1.08 s | 84 |
| `/tables/*` | 482 ms | 785 ms | 428 ms | 685 ms | 52 |

The homepage's FCP is about twice that of the other pages, and FCP comes before any
image, so the gap is in the document and not the gallery. That matches the ~180 ms of
extra TTFB measured above, plus the tail when Cloudinary is slow. Acceptance should
add this: homepage FCP p75 within ~200 ms of `/results/:division`'s.

## Outcome (measured 24 Oct 2026)

**Request logs, the acceptance criterion.** `GET /`, status 200, bots excluded by user
agent (SentryUptimeBot, facebookexternalhit, Google's preview/inspection agents, …):

| Window | Requests | p50 | p75 | p90 |
|---|---|---|---|---|
| 26 Sep – 17 Oct (before) | 2,706 | 450 ms | 495 ms | 590 ms |
| 18 – 24 Oct (after) | 1,017 | **106 ms** | 127 ms | 212 ms |
| `/results/*`, after | 572 | 98 ms | 151 ms | 327 ms |
| `/tables/*`, after | 284 | 65 ms | 108 ms | 290 ms |

Under 150 ms and level with the other pages: **met.**

**PostHog field data**, 18–24 Oct against the baseline above:

| | LCP p75 | LCP p90 | FCP p75 |
|---|---|---|---|
| `/` desktop | 2.20 → **1.33 s** | 2.79 → 2.19 s | 1.83 → 1.23 s |
| `/` mobile | 1.08 s → **764 ms** | 2.03 → 2.01 s | 1.18 s → 732 ms |
| `/results/*` mobile | 521 → 455 ms | 958 → 771 ms | 514 → 438 ms |

The added "FCP within ~200 ms of `/results`" is **not quite met** (mobile 732 against
438 ms), and the gap is not in the app. With web-vitals attribution on, the browser's TTFB
for `/` is p75 **1.1 s** against ~280 ms for `/results` and `/tables`, while Cloud Run
answers `/` in 127 ms at p75. 86 of 102 `/` loads are landings (external or direct), which
pay DNS, TLS and the Firebase hop on a cold connection where an in-site navigation does
not. Landing loads elsewhere come in at p75 481 ms, so that explains much of the gap but
not all of it, and the sample is too small to go further. The LCP element on `/` is now
almost always the lead text paragraph, not the background, so the image is no longer the
cost.
