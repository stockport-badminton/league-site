# Handover from Tameside: Vision "Resource has been exhausted", and the Maps key

**From:** tameside-site, 1 Oct 2026
**For:** league-site
**Asks:** two changes on this side, in priority order: (1) handle Vision's capacity
refusal in `controllers/cornerDetection.js`, and (2) restrict `GMAPSAPIKEY`. Nothing here
needs Tameside to act first.

## TL;DR

- **The "Resource has been exhausted (e.g. check quota)" error on 1 Oct was Google's
  capacity, not our config.** Changing the billing/quota project here most likely
  coincided with Vision recovering, rather than fixing it.
- **This codebase can't see that error at the moment.** It comes back as a *per-image*
  error inside a successful response, so `runOCR` reports it as `No text detected in
  image` and `autoRotate` silently skips. The client library doesn't retry it either.
- **`GMAPSAPIKEY` is Stockport's, unrestricted, and printed into public pages.** Tameside
  borrowed it for Vision until today. It has moved off it, so the key can now be locked
  down to Maps.

## 1. The Vision error was Google-side

Tameside's OCR started failing with `code 8 RESOURCE_EXHAUSTED` the same day this site
did. The same message showed up from every angle we tried, all with a 1×1 png (the
image doesn't matter) and later a small real text image:

| Calls made with | Refused |
|---|---|
| `GMAPSAPIKEY` (project `stockport-badminton-map`) | 10 / 10 |
| A **new** Vision-only key in Tameside's project, on a **different billing account** | 7 / 10 |
| The same new key, `vision` / `eu-vision` / `us-vision` endpoints | 8, 5, 10 / 10 |
| The same new key, `DOCUMENT_TEXT_DETECTION` / `TEXT_DETECTION` / `LABEL_DETECTION` | 8, 5, 6 / 8 |
| **OAuth** user token with `x-goog-user-project` (no API key at all) | 7 / 10 |

Meanwhile:

- `stockport-badminton-map` had Vision enabled, its billing account open, and every
  Vision quota at the defaults (1,800 a minute, no overrides).
- status.cloud.google.com showed no open incident.

So the refusal didn't depend on project, billing account, credential type, region or
feature. It's capacity, and Google's message is misleading: it suggests a quota problem
when there isn't one. Successful calls came **interleaved** with refusals, which is what
makes retrying worthwhile.

What changed "the billing project" here isn't recorded in this repo: no commit or `.env`
change since 28 Sep touches it. If it was a quota project on the service-account
credentials, it's harmless, but don't count on it as the fix. **Diagnostic rule for next
time:** before blaming config, repeat the call from a second project. If both fail, it's
Google.

## 2. This codebase can't see the refusal (by reading the code, not tested here)

`visionClient.documentTextDetection()` → `helpers.js` → `batchAnnotateImages`. A
per-image error doesn't make the call fail. The helper returns `r.responses[0]` as a
**success**, with `.error = { code: 8, … }` and no `fullTextAnnotation`
(`node_modules/@google-cloud/vision/build/src/helpers.js` ~L193-201). The library's own
retry is configured for `DEADLINE_EXCEEDED` and `UNAVAILABLE` only (`retry_codes:
idempotent` in `v1/image_annotator_client_config.json`), and wouldn't see a per-image
error even if it covered code 8.

So in `controllers/cornerDetection.js`:

- **`autoRotate` (~L277)** sees no `fullTextAnnotation` and returns the unrotated image.
  It's silent, and anything thrown is also swallowed by its bare `catch`.
- **`runOCR` (~L326)** throws **`No text detected in image`**. That message blames the
  photo when the photo is fine. Worth checking whether the "name the card it cannot read"
  path (`d64d228`) turns that into a verdict on the card.
- **Each card costs two Vision calls** (`autoRotate` then `runOCR`, ~L358). With Google
  refusing about half of all calls, both have to get through for a good result.

### What Tameside shipped (commit `27f14d69` in tameside-site)

`utils/scorecardVision.js`:

- Retries `code 8` (and HTTP 429/503) **three times, 1s/2s/4s**, sized for Tameside's 60s
  Cloud Run request timeout. Use your own timeout when choosing delays.
- Once the retries run out, throws "Google's card reader is busy right now…" instead of
  passing on the quota wording, which reads to a captain as though the site has broken.
- **Doesn't retry other per-image errors** (e.g. code 3, bad image).
- Measured live while the problem was happening: 4 of 5 cards read, against about 3 in 10
  without the retry.

The suggested equivalent here is a small wrapper round `documentTextDetection` that:

1. checks `result.error`;
2. retries on `code === 8` with backoff;
3. throws a distinct error (not `No text detected`) when the retries run out.

Use it from both `autoRotate` and `runOCR`. `autoRotate` could also be skipped after a
refusal, rather than spending a second call. Tameside has no `autoRotate`: it corrects
orientation from the same single response's text-block coordinates, so it makes one call
per card.

## 3. `GMAPSAPIKEY`: restrict it

| | |
|---|---|
| Key | `9407c937-129b-48c9-9dfd-cbbfdd987466`, display name "API key" |
| Project | `stockport-badminton-map` (#1062639760188) |
| Created | 2019-02-22, never updated |
| `restrictions` | **null**: no API restriction and no referrer restriction |
| Rendered into | here: `views/club-v2.ejs:230`, `views/viewEventDetails.ejs:49`. Tameside: `views/club.ejs:253`, `views/viewEventDetails.ejs:43` |

Anyone who views source on a club page can call **any API enabled on that project** with
it, Vision included, billed to Stockport.

**Tameside no longer needs it for anything server-side.** Until today its OCR called
Vision with `GMAPSAPIKEY`. It now uses its own `VISION_API_KEY` in its own project
(`avid-compound-429108-g9`), restricted to `vision.googleapis.com`. `VISION_API_KEY` was
set on Tameside's Cloud Run service and deployed on 1 Oct 2026. The code still names
`GMAPSAPIKEY` as a fallback, but with `VISION_API_KEY` set it's never reached, so
restricting the key doesn't affect Tameside's OCR.

The suggested restriction is:

1. **API targets** limited to what the browser actually loads. Both sites load the Maps
   JavaScript API with `libraries=marker` (`maps-backend.googleapis.com`). Check for
   Places/Geocoding use in the browser before leaving those out. This step alone closes
   the Vision exposure.
2. **HTTP referrers** for both sites' domains, *plus* whatever origin each site is really
   served from. Tameside's Firebase Hosting rewrites the Host header, so check what
   `Referer` the browser actually sends from each site before restricting. A wrong
   referrer list breaks the club maps on both sites at once.

API targets first: they can't break anything that's only using Maps. Referrers are the
riskier half.

The venues map generator here already uses a separate server-only key
(`GMAPS_STATIC_API_KEY`, "venues-map-generator (server-only, Static Maps API)"), so it's
unaffected.

## Useful trick

To find which project owns an API key without any credentials, call an API the project
*hasn't* enabled (e.g. Translation). The error names `consumer: projects/<number>`. That's
how this key was traced to Stockport.
