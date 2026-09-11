# HARD-12 — helmet and a content security policy

**Severity:** medium · **Wave:** C · **Blocked by:** HARD-04 (same file)
**Owns:** `app.js`
**Sources:** SEC-5

## Why

`helmet` is not installed and no security headers are set by hand: no
Content-Security-Policy, no HSTS, no `X-Content-Type-Options`, no frame protection.

Nothing is broken by this on its own. It removes the second line of defence — the site
can be framed, and any future markup bug that lets a script through has nothing stopping
it running. It is also the first thing a buyer's technical reviewer checks.

## What to do

1. Add `helmet` and enable the uncontroversial headers.
2. Build the CSP from what the pages actually load. Known external sources: jQuery,
   Bootstrap, DataTables, the Sentry browser CDN (`js-de.sentry-cdn.com`, hardcoded in
   `views/header.ejs`), Google Fonts, and the S3 bucket for scorecard photos and
   generated media. Grep the views rather than assuming.
3. **Ship it in report-only mode for a week first.** Sentry will collect the violations.
   A CSP that silently breaks the scorecard modal on a Tuesday night is worse than no
   CSP — and the scorecard forms are heavily inline-scripted, so expect work there.
4. Then enforce.

## Acceptance criteria

- Headers present on every response.
- A week of report-only with no violations from legitimate pages before enforcing.
- `npm run test:e2e` passes with the policy enforced — 48 specs including the scorecard
  modal, which is the part most likely to break.

## Tests

- integration: assert the headers on a representative page
- e2e: full suite green with the policy on

## Out of scope

- Removing inline scripts from the views. That is what makes a strict CSP hard here, and
  it is a much larger piece of work — nonces or hashes are the pragmatic middle path.

## Report-only findings, 2 Sep 2026 — the flip is blocked on two real things

Live since 31 Aug (Mon). **94 reports in 2 days**, so prerequisite 1 is satisfied: the
collector works. Five distinct violations:

| directive | blocked | n | what it is |
|---|---|---|---|
| `connect-src` | `stats.g.doubleclick.net` | 48 | Google Analytics |
| `connect-src` | `www.google.co.uk` | 22 | GA audiences (`/ads/ga-audiences`) |
| `connect-src` | `connect.facebook.net` | 18 | Facebook SDK config fetch |
| **`script-src`** | **`eval`** | 4 | `/email-scorecard` only |
| **`worker-src`** | **`blob`** | 2 | `/email-scorecard` only |

### Prerequisite 4 fails, and it fails functionally

`CSP_ENFORCE=true npx playwright test` → **43 passed, 5 failed**. Every failure is a
scorecard page, and two of them are not cosmetic:

```
scorecard.spec.js  › picking a division populates the team dropdowns     (10.9s timeout)
scorecard.spec.js  › picking a home team populates its player dropdowns  (10.9s timeout)
scorecard.spec.js  › loads without console or page errors
messer-scorecard.spec.js › loads without console or page errors
populated-scorecard.spec.js › loads without console or page errors
```

> pageerror: Evaluating a string as JavaScript violates the following Content Security
> Policy directive because 'unsafe-eval' is not an allowed source of script

The dropdowns do not populate. **Enforcing today would stop captains filing results** —
precisely the casualty this package predicted, now measured rather than feared.

### What actually needs `unsafe-eval`, and why it is a decision not a fix

**`views/index-scorecard.ejs` loads `/scripts/ejs/ejs.js` — EJS in the browser.** EJS
compiles a template by building a function from a string, i.e. `new Function`, which is
what `unsafe-eval` gates. That is why the violation is confined to the scorecard pages
and appears nowhere else on the site.

So there are two ways forward and they are not equivalent:

- **Add `'unsafe-eval'` to `script-src`.** One line, and it unblocks the flip. But
  combined with the `'unsafe-inline'` that already has to stay (159 `onclick`
  attributes, HARD-15), `script-src` would then permit both inline script and string
  evaluation — which is most of what the directive exists to prevent. The honest
  description at that point is that `script-src` constrains *where scripts load from*
  and nothing else.
- **Stop templating in the browser.** The scorecard wizard is the only page doing it.
  Removing it is real work but it is the only option that leaves `script-src` meaning
  something, and it overlaps with HARD-15.

`worker-src blob:` is the easier of the two: it is Sentry Replay's compression worker,
which is path-gated by `REPLAY_PATHS` (hence scorecard-only), and allowing `blob:` for
workers is a narrow concession rather than a general one.

The three `connect-src` hosts are straightforwardly missing from `OBSERVED` and should be
added regardless — none of them is a surprise, and all three are already trusted in
`script-src`.

### Prerequisite 3 is entirely unmet

None of the pages that need a human to visit them has reported at all. Two days of real
traffic has covered `/`, the scorecard, results/tables, the roster editor and
`/playerStats/:id` — but **not one** of:

```
/admin          Quill
/player-stats   DataTables + Chart.js     (note: distinct from /playerStats/:id, which HAS reported)
/pair-stats     DataTables + Chart.js
/file-upload    SheetJS from unpkg
/event/…        Google Maps
/clubs/…        Google Maps
/contact-us     reCAPTCHA
```

So the allowlist for six third-party libraries is still entirely untested. A quiet week
would say nothing about them, which is the trap prerequisite 3 exists to name.

### Status of the four prerequisites

| | | |
|---|---|---|
| 1 | Reports being received | **met** — 94 in 2 days |
| 2 | A full week incl. Tue + Wed | **partial** — 2 days, but has covered a Tue and a Wed, and the scorecard did report |
| 3 | The seven pages visited | **not met** — none of them |
| 4 | e2e passes enforcing | **met, 2 Sep** — see below |

**It is not a waiting game.** Prerequisite 2 is the only one that time alone satisfies.

## Update, later on 2 Sep: prerequisites 1 and 4 are met

**The three `connect-src` hosts and `worker-src blob:` are in** (`eb87d4f`), which cleared
90 of the first 94 violations. With those alone the enforcing run was unchanged at 5
failures and `'unsafe-eval'` was the only violation type left — so the additions were
complete for their part.

**The `unsafe-eval` requirement is gone** (`9e6f2df`). Client-side EJS was replaced with
`static/beta/js/form-options.js`, which builds the `<option>` lists with DOM calls. The
two templates it replaced were four and six lines and did nothing but produce options, so
nothing was lost. `CSP_ENFORCE=true npx playwright test` now gives **48 passed, 1 skipped,
zero CSP violations**, up from 43/5.

**`script-src` therefore no longer needs `'unsafe-eval'`, and it never had it** — the
policy was already right; the *site* was wrong. Worth stating plainly because the tempting
fix was to add the directive, which alongside the `'unsafe-inline'` that must stay for
HARD-15 would have left `script-src` constraining only where scripts load from.

### What is still outstanding

Only prerequisites **2** (a full week, for coverage rather than correctness) and **3** (the
seven pages nobody has visited: `/admin`, `/player-stats`, `/pair-stats`, `/file-upload`,
an `/event/`, a `/clubs/`, `/contact-us`). Prerequisite 3 is the one that matters — six
third-party libraries have produced no reports at all, and a quiet week says nothing about
any of them. **Visiting those seven pages once, while report-only is still on, is the
remaining work**, and it is minutes rather than days.

## Update, 3 Sep: prerequisite 3 walked, and it found four things

Report volume fell from 94 in two days to **5 in twenty-four hours** once the first batch
was allowlisted. All five were new, and two are functional breaks that no amount of
waiting would have surfaced:

| blocked | page | consequence if enforced |
|---|---|---|
| `badmintontemp.s3….amazonaws.com` | `/messer-scorecard-beta` | **scorecard photo upload fails** — the presigned PUT from `/sign-s3` goes straight to the bucket |
| `places.googleapis.com` | `/event/…` | Places lookups fail; only `maps.googleapis.com` was listed |
| `www.google.com` | `/contact-us` | **reCAPTCHA fails** — it was trusted in `script-src` and `frame-src`, but `connect-src` is a separate list |
| `www.google.ie` | results pages | analytics only — a beacon, not a feature |

All four are now in `OBSERVED`. The bucket host is **derived from `S3_BUCKET_NAME`** rather
than hardcoded, so it follows the bucket instead of going stale.

### Silence is ambiguous — separate "clean" from "unvisited"

A page with no reports may be clean or may simply never have been opened, and the two look
identical. Cross-checking the access log against the report log separates them:

| route | requests / 24h | verdict |
|---|---|---|
| `/clubs/<slug>` | 50 | **clean** — Google Maps fine |
| `/contact-us` | 50 | violation found and fixed |
| `/event/<id>/<slug>` | 50 | violation found and fixed |
| `/player-stats` | 3 | **clean** — DataTables + Chart.js verified |
| `/pair-stats` | 2 | **clean** |
| `/upload-scoresheet` | **0** | **still unknown** — SheetJS from unpkg untested |
| `/admin/homepage-content/create` | **0** | **still unknown** — Quill untested |

### The two that are still unknown, and why they were missed

Because this file told someone to visit **`/admin`** and **`/file-upload`**, which are the
*view* names. Neither is a route. The pages are `/admin/homepage-content/create` (Quill)
and `/upload-scoresheet` (SheetJS) — the latter public, no login needed. The list above is
corrected in `utils/securityHeaders.js`.

**Remaining work for prerequisite 3 is those two pages.** Open each once while report-only
is on. `/upload-scoresheet` is the more interesting: SheetJS is loaded from unpkg, and the
page is the one route in this set that an anonymous visitor could reach yet apparently
none has.

## Update, 3 Sep (later): prerequisite 3 complete, and the last page found a redirect trap

The Quill page was the last of the seven, and it reported:

```
style-src-elem  blocked=https://cdn.quilljs.com/1.3.6/quill.snow.css
                page=/admin/homepage-content/3
```

**Naming a host that was already in `style-src`.** The cause is worth knowing, because it
makes a correct allowlist look broken:

> **`cdn.quilljs.com` 301s to `cdn.jsdelivr.net`, and CSP checks every hop of a redirect.**
> The initial request passes; the redirect target is evaluated separately and
> `cdn.jsdelivr.net` was only in `script-src`. The browser then reports the
> *pre-redirect* URL, because leaking the chain would be an information leak — so the
> violation names the host you allowed rather than the host that was blocked.

Quill's **script** was unaffected purely by luck: it redirects too, and jsdelivr was
already in `script-src` for Chart.js. Of the CDNs in this policy, quilljs is the only one
that redirects — `cdn.datatables.net`, `cdn.jsdelivr.net` and `browser.sentry-cdn.com` all
serve directly, checked the same day.

Fixed by adding `https://cdn.jsdelivr.net` to `style-src`. The tidier end state would be to
point the view at the post-redirect URL and drop `cdn.quilljs.com` entirely, since both its
assets now come from jsdelivr — a small change to a working admin page, not done here.

### Prerequisite 3 status: complete

| route | verdict |
|---|---|
| `/clubs/<slug>` | clean |
| `/player-stats`, `/pair-stats` | clean |
| `/contact-us` | fixed — reCAPTCHA needed `www.google.com` in `connect-src` |
| `/event/<id>/<slug>` | fixed — needed `places.googleapis.com` |
| `/admin/homepage-content/:id` | fixed — the redirect above |
| `/upload-scoresheet` | **deleted** — dead for over a year, and the only thing pulling `unpkg.com` into `script-src` |

All four prerequisites are now met bar the calendar half of 2 (a full week of traffic,
which is coverage rather than correctness).

### The one thing still untested, and it is the one that matters

Every violation found so far came from *loading* a page. **The most consequential find — the
presigned S3 upload on the scorecard — is a write**, and writes only happen when someone
completes a workflow. The read-only Playwright suite cannot do it by design, and neither
can browsing.

Matches restarted 3 Sep, so the next real scorecard filed by a captain — ideally one with a
photo — is the missing test. Watch `/csp-report` for `connect-src` violations naming the
bucket after the first one lands. **Do not flip `CSP_ENFORCE` before that**: a blocked
upload would fail on the page captains use, at the one moment of the week they use it.
