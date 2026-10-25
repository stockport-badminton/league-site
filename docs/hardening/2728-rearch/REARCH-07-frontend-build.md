# REARCH-07 — inline scripts out, and a bundler for code shared with the server

**Size:** M · **Window:** the scorecard templates off-season only; everything else
in-season OK
**Blocked by:** REARCH-03 part B step 1 (the shared rules module) for the wizard part.
**Absorbs:** **HARD-15** (inline scripts), whose brief stays the reference for the method.
Close HARD-15 into this package rather than running both.
**Owns:** inline handlers and `<script>` blocks in `views/**/*.ejs`, `static/beta/js/`, a
build step for browser modules, `OBSERVED['script-src']` in `utils/securityHeaders.js`.
**Source:** the 24 Oct 2026 "build it from scratch" review.

## Why

Two separate reasons, which happen to need the same piece of work.

**1. The CSP cannot stop an injected script while `'unsafe-inline'` is in `script-src`,**
and it cannot leave while inline handlers exist (HARD-15 has the full argument, including
why a nonce makes it worse, not better, until the attributes are gone).

The count has moved since HARD-15 was written, and the shape of the job with it. Measured
24 Oct 2026, `onclick=` occurrences in `views/`:

| Template | `onclick=` |
|---|---|
| `views/index-scorecard.ejs` | 52 |
| `views/messer-scorecard.ejs.backup` | 52 |
| `views/messer-scorecard.ejs` | 26 |
| `views/populated-scorecard.ejs` | 24 |
| `views/partials/debugPanel.ejs` | 3 |
| `views/elo-backfill.ejs` | 2 |

So: **a third of HARD-15's 159 is a `.backup` file** sitting in `views/`, and of the real
107, **102 are in the three scorecard templates.** HARD-15 read as a long tail across the
site; it is actually the scorecard wizard, which is exactly the code REARCH-03 part B
rewrites around a shared rules module. Doing them separately means rewriting the wizard
twice.

**2. The scorecard rules must run in the browser and on the server from one file**
(REARCH-03 part B). Today the browser has its own copy of the score rules inside the
template. Sharing one CommonJS module with the browser needs a bundler.

## Design

- **esbuild**, one dev dependency, building `static/beta/js/src/*.js` →
  `static/beta/js/dist/*.js`. Entry points: `scorecard-wizard`, `messer-wizard`,
  `populated-scorecard`, and anything else that wants to import shared code.
- **Where it builds — a decision.** Either commit `dist/` (the Dockerfile and deploy do not
  change at all; a test fails if `dist/` is stale against `src/`), or build in the Docker
  image (one `RUN` line, no committed output). **Recommended: commit `dist/`** — it keeps
  hosting and the build pipeline literally unchanged, which is one of the three
  constraints, and the staleness test is cheap. Revisit if the bundles get large.
- **`asset()` already does the cache-busting** (HARD-42: content hash in `?v=`, a year's
  `immutable`). Bundles go through it like any other file. No hashed filenames, no
  manifest.
- **Icons are done** (HARD-44's `icon()`), and so are the MJML emails
  (`tools/build-emails.js`). This package does not touch either.
- **No framework.** Event delegation off a container with `data-action` attributes, the
  pattern `roster-edit.js` already uses. The wizard is a few hundred lines of DOM; a
  framework would be more code than it replaces.

## What to do

1. **Delete `views/messer-scorecard.ejs.backup`** after checking nothing renders it
   (`grep -rn "messer-scorecard.ejs.backup\|messer-scorecard.ejs\\.backup"`; Express
   resolves `.ejs`, so a `.backup` file should be unreachable — confirm, then delete). One
   commit, takes the count from 159 to 107.
2. The two small ones (`debugPanel`, `elo-backfill`) in-season, following HARD-15's method.
3. esbuild and the staleness test.
4. **Off-season, with REARCH-03 part B:** move the three scorecard templates' handlers and
   inline scripts into `src/` entry points that import `scorecard/rules.js`. The e2e specs
   (`scorecard-*`, `messer-*`, `populated-scorecard`, `form-contract`, `scorecard-phone`)
   are the safety net and must pass unchanged at every step.
5. The remaining inline `<script>` blocks (22 templates have one; the largest are
   `elo-chart`, `header`, `club-v2`, `filtersJs`) move to files. `header.ejs`'s third-party
   configuration (gtag, Sentry, PostHog) last, and HARD-44 item 3's analytics decision
   first, since it may remove one of them.
6. Drop `'unsafe-inline'` from the **report-only** `script-src`, watch `/csp-report` for a
   week of real traffic, then decide on `CSP_ENFORCE` for the resource policy (HARD-15's
   acceptance criteria, unchanged).

## Acceptance criteria

- Zero inline event-handler attributes in `views/`; a guard test holds it at zero.
- `script-src` has no `'unsafe-inline'` in the report-only header, and a week of
  `/csp-report` shows no violations from real pages.
- The browser and server score rules are the same file (a test imports the bundle's
  source and the server module and asserts they are the same module, or the wizard spec
  exercises a rule that only exists in the shared file).
- Every e2e spec passes unchanged.
- Cost: none. esbuild is a dev dependency; the bundles replace inline bytes the pages
  already download.

## Out of scope

- `style-src 'unsafe-inline'` (HARD-15's reasoning stands).
- Rewriting pages that do not share code with the server.
- A design refresh. Pixel-for-pixel the same pages.
