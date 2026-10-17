# HARD-44 — the page shell outweighs the pages

**Severity:** medium-high (performance) · **Wave:** P2 · **Blocked by:** HARD-42 (both edit
the asset tags in `views/header.ejs`)
**Owns:** `views/header.ejs`, `views/footer.ejs`, `static/beta/css/custom.css`
**Source:** the performance review of 17 Oct 2026.

## Why

Lighthouse, mobile profile, against production. Every page carries the same baggage, and
on most pages it is the larger part of what is downloaded:

| Page | The page's own HTML/CSS/JS | Analytics (GA + PostHog) | Icon fonts |
|---|---|---|---|
| `/` | ~164 KB | 280 KB | 118 KB |
| `/tables/All` | ~123 KB | 280 KB | 118 KB |
| `/results/All` | ~182 KB | 280 KB | 274 KB |

Lab results (single runs, simulated mid-range phone on 4G, so read as direction rather than
exact values):

| Page | Score | FCP | LCP | LCP element |
|---|---|---|---|---|
| `/` | 76 | 2.3 s | 5.6 s | a news paragraph |
| `/tables/All` | 85 | 2.5 s | 3.9 s | `main.respBgImg` background |
| `/results/All` | 65 | 4.9 s | 6.6 s | `main.respBgImg` background |
| `/results/Premier` | 79 | 3.0 s | 4.5 s | `main.respBgImg` background |
| event page | 71 | 2.3 s | 8.3 s | the Google map (HARD-46) |

Total Blocking Time and CLS are close to zero everywhere. This is entirely a **loading**
problem, not a JavaScript-execution one, and it breaks down into four separate issues.

### 1. Font Awesome: about 300 KB of fonts for about 33 icons

`header.ejs` loads Font Awesome 6's all.css (25 KB, render-blocking), which declares
every webfont. The footer's three brand icons pull in `fa-brands-400.woff2` (**118 KB**) on
every page. Any solid icon pulls in `fa-solid-900.woff2` (**158 KB**). All are
`font-display: block`. A grep of `views/` and `static/beta/js` finds **about 33 distinct
icons** in use, of roughly 2,000.

Replace them with an SVG sprite built from just those icons. The
`@fortawesome/free-solid-svg-icons` and `free-brands-svg-icons` packages ship each icon as
path data, so a short build step can emit one sprite of a few KB with no font and no
render-blocking CSS. Templates change from `<i class="fa-solid fa-trophy">` to
`<svg class="icon"><use href="#trophy"/></svg>`, behind an EJS helper so the change is
mechanical. Do two or three templates first, then the rest, as with any bulk template edit.
The icon class names in `static/beta/js` (built dynamically) need the same treatment, and a
test that fails on any `fa-` class left in `views/` keeps them from creeping back.

A cheaper intermediate step: subset the two woff2 files to the used glyphs. It keeps the
markup but needs a tool in the build.

### 2. The background image is the LCP, and it is a PNG found late

On three of the five pages, the largest element is `<main class="container respBgImg">`,
which has a Cloudinary background image declared in `custom.css`. Two problems:

- **It is a PNG with no format negotiation.** At desktop width the `w_1920` variant is
  **114 KB**. The same URL with `f_auto,q_auto` serves **4.6 KB of AVIF**. Mobile `w_300`:
  20.7 KB → 2.2 KB. That is a one-token change on each of the six rules in `custom.css`.
- **The browser cannot find it until `custom.css` has arrived and been parsed**, which
  shows up as Lighthouse's "resource load delay" (190–850 ms). A
  `<link rel="preload" as="image" imagesrcset=… imagesizes=…>` in the head lets the
  download start with the HTML.

### 3. Analytics is 280 KB of every page, and two products do one job

gtag.js is 168 KB and PostHog's array.js 104 KB. Both are async, so neither blocks
rendering. But on a 4G phone they share the connection with the stylesheets and the LCP
image, and they are the two largest downloads on every page.

- **Decide GA versus PostHog** (already planned for about November). Dropping one saves
  100–170 KB on every page view. This is the largest single byte saving available, and it
  needs no code beyond deleting a block.
- Whichever stays, **start it after the `load` event** (or in `requestIdleCallback`). Page
  views are still counted. What changes is that analytics stops competing with the content.
  Keep session recording on the scorecard pages loading early, since it exists to see the
  start of the session.

### 4. Smaller items in the same files

- The Sentry loader is a **synchronous** `<script>` in the head for logged-in users. Use
  the loader's lazy mode, or add `defer`.
- `pwa-head.ejs` registers the service worker immediately. On first install it precaches
  seven HTML pages and nine assets **while the first page is still loading**. Register
  inside `window.addEventListener('load', …)`.
- `header.ejs` has a stray `</script>` after the logged-out gtag block, and `footer.ejs`
  opens with a stray `</div>`. They are harmless to the browser, but worth removing while
  the files are open.

## Acceptance criteria

- Lighthouse mobile on `/`, `/tables/All` and `/results/Premier` records no font requests
  on pages that show no icons other than the footer's, and transfers under 300 KB on
  `/tables/All` (from 542 KB).
- The background image request is AVIF or WebP in a browser that accepts it, and starts
  before `custom.css` has finished (visible in the waterfall).
- A test fails if a Font Awesome class reappears in `views/`, or if the `respBgImg` URLs
  lose `f_auto`.
- `e2e/admin-nav.spec.js` and the roster specs still pass. Both lean on icon-only buttons.

## Out of scope

- Replacing Bootstrap 4 or jQuery. They are 85 KB together, cached once HARD-42 lands, and
  the scorecard wizard depends on both.

## Field data (PostHog, added 17 Oct 2026)

Real-user web vitals from PostHog, Stockport host, 9–17 Oct (8 days). This is the
"before" baseline to re-measure against. **It disagrees with the lab numbers above, and
both are right**: Lighthouse simulates a cold cache on throttled 4G, while these are real
visitors, often returning, on real connections. PostHog also misses anyone with an ad
blocker (there is no reverse proxy) and all superadmins. The samples are small, so read
p75 as the number and treat p90 as indicative only. CLS is ~0 and INP p75 is under 80 ms
on every route, so this is a loading problem only, as the lab said.

Every route is *good* at p75 (LCP 440 ms–1.18 s, FCP 413 ms–1.21 s; per-route table in
HARD-43). One finding bears on item 2 here: **desktop is slower than mobile on every
route** (all pages: LCP p75 1.14 s desktop vs 721 ms mobile), which is the opposite of what
connection quality would predict. The `w_1920` background PNG (114 KB, against 20.7 KB at
`w_300`) is the obvious candidate for a desktop-only cost. That makes `f_auto,q_auto` a
better bet than it looked in a mobile-only lab run. Check by splitting desktop LCP before
and after.
