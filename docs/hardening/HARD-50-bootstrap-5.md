# HARD-50 — Bootstrap 4 is out of support

**Severity:** low (maintenance) · **Wave:** off-season 2027 for the cutover; the preparation
is in-season OK · **Blocked by:** REARCH-07 step 4 and REARCH-03 part B for the three
scorecard templates (same files, same off-season); nothing for the rest
**Owns:** the Bootstrap asset tags in `views/header.ejs` / `views/footer.ejs` / `views/sw.ejs`,
`package.json` (`bootstrap`, popper.js), Bootstrap class names and `data-*` attributes in
`views/**/*.ejs` and `static/beta/js/`, the Bootstrap overrides in `static/beta/css/custom.css`,
`static/vendor/datatables/` if step 6 needs it
**Source:** a deprecation warning in the build log, 29 Oct 2026, and the conversation that
followed it.

## Why

The site runs **Bootstrap 4.6.2** (`package.json` says `^4.1.1`; 4.6.2 is the last 4.x).
Bootstrap 4 reached end of life on 1 Jan 2023 and npm now flags it as deprecated, as it does
popper.js v1. Nothing in 4.x will be fixed again.

**There is no known vulnerability behind this, and that is why it is low.** The one CVE
raised against 4.x since then, CVE-2024-6531 (an XSS through a carousel control's `href`),
was withdrawn by GitHub and rejected by its CNA in 2025: Bootstrap does not sanitise HTML the
page gives it, so the fault is in a page that puts untrusted input there. Ours do not — the
carousel controls are fixed anchors (`views/generatedTournamentGallery.ejs:37`). The site's
XSS defences are its own escaping, `sanitize-html` and the CSP, none of which is Bootstrap.

The reason to move anyway is that the gap only widens: a future fault would have no fix,
plugins (DataTables' styling among them) are moving to 5, and the Popper v1 dependency goes
with it.

## Bootstrap, or something else?

Asked on 29 Oct 2026, since the re-architecture was a chance to revisit an old choice. The
answer was **stay on Bootstrap, move to 5**:

- The site is what Bootstrap is for: server-rendered forms (the scorecards above all),
  tables, a navbar, modals and dropdowns, used on phones, kept by one person, with no build
  step for most pages.
- Its weight is not the problem. HARD-44 measured Bootstrap and jQuery at 85 KB together,
  cached since HARD-42, and found the page weight elsewhere.
- Every alternative is a rewrite of ~190 templates with nothing new for a member to see,
  which is against the rule the re-architecture set itself. Tailwind needs a build for every
  page and brings no modals or dropdowns; Pico/Simple.css are weak on dense forms; Bulma,
  Foundation and UIkit are sideways moves; hand-written CSS on `<dialog>` / `<details>` means
  owning a design system, and cannot be done a page at a time while Bootstrap's base styles
  apply to every page.

**What changes for new work:** a new component is built the way the Messer draw is
(`static/beta/css/messer-draw.css`): its own stylesheet using the `--sdbl-*` brand tokens,
and native `<dialog>` / `<details>` rather than Bootstrap's JavaScript components. That
shrinks what depends on Bootstrap, so a later redesign — Tailwind or anything else — has
less to unpick. Not a rule to retrofit; a default for what is new.

## The size of it

Measured 29 Oct 2026 across `views/` and `static/beta/js/`. **Re-measure before starting**;
these move.

| Bootstrap 4 name | Bootstrap 5 | Uses | Breaks if missed |
|---|---|---|---|
| `<select class="form-control">` | `form-select` | 239 in 17 files | the select loses its arrow |
| `data-toggle` / `data-target` / `data-dismiss` | `data-bs-*` | 21 / 9 / 21 | **modals, dropdowns and the collapse stop working** |
| `data-slide` / `data-ride` | `data-bs-*` | 3, one file | the carousel stops |
| `ml-`/`mr-`/`pl-`/`pr-` | `ms-`/`me-`/`ps-`/`pe-` | ~19 | spacing |
| `text-left` / `text-right` | `text-start` / `text-end` | 41 in 15 files | alignment |
| `badge-<colour>`, `badge-pill` | `text-bg-<colour>`, `rounded-pill` | 26, 2 | badge colour |
| `sr-only` | `visually-hidden` | 9 in 5 files | **screen-reader text appears on the page** |
| `close` buttons | `btn-close` (no inner `&times;`) | 15 in 11 files | the ×'s look |
| `font-weight-*`, `btn-block`, `no-gutters`, `form-inline`, `dropdown-menu-right`, `jumbotron`, `border-left/right` | `fw-*`, `w-100`/`d-grid`, `g-0`, grid, `dropdown-menu-end`, utilities | ~28 | looks |
| `form-group`, `form-row` | removed | **412, 191** | spacing only — see step 3 |
| `$(…).modal('show')` etc. | `bootstrap.Modal.getOrCreateInstance(…)` | 6, all in `roster-edit.js` | still works while jQuery is loaded (Bootstrap 5 registers its jQuery plugins when it finds jQuery), so optional |
| `.on('hidden.bs.modal')` / `.one('show.bs.modal')` | unchanged | 5 | still fires through jQuery |

Where it sits: **the three scorecard templates hold most of it** (`index-scorecard` 183
matches, `populated-scorecard` and `messer-scorecard` 91 each; the 171 in
`messer-scorecard.ejs.backup` go when REARCH-07 step 1 deletes it). After them, no template
has more than 13.

Two Bootstrap 5 names are already in the markup and inert under 4 — `ms-`/`me-` (2) and
`form-select` (4 in one file). They start applying at the cutover; look at those pages.

**Re-measured 25 Nov 2026** (`__tests__/unit/bootstrap5-names.test.js` now keeps the count):
it had grown by about a third, all from pages added since — `data-toggle` 28, `data-dismiss`
23, `text-left`/`text-right` 66, `ml-`/`mr-`/`pl-`/`pr-` 42, `badge-<colour>` 32, `sr-only` 12,
`close` 17, `<select class="form-control">` 248. Missed by the table above: `custom-control`
(3), `input-group-append` (1), `border-left/right` (4), and two jQuery selectors on
`a[data-target="#…"]` in `static/beta/js/fixture-date-edit.js`, which would have stopped
matching at the cutover with nothing in the console (now `.js-rearrange-link` /
`.js-reminder-link`). `fixture-date-edit.js` also calls `.modal('show')`, not only
`roster-edit.js`. The scorecard templates are down to 7, 5 and 4 unpaired names once
`form-group` and `form-control` are set aside.

## What to do

1. **Pick the version** — the newest 5.3.x at the time — and load
   bootstrap.bundle.min.js, which carries Popper 2. Remove popper.js from `package.json`.
   **jQuery stays**: DataTables needs it and the site makes ~800 jQuery calls of its own.
   Removing it is a separate question, not this package.

2. **In-season: carry both names, one template at a time.** A template can hold the old and
   new name side by side — `data-toggle="modal" data-bs-toggle="modal"`, `ml-2 ms-2`,
   `sr-only visually-hidden`, `badge-warning text-bg-warning` — and whichever version is not
   loaded ignores the other's. So the bulk of the work lands during the season with nothing
   visibly changing, each commit revertible on its own. Do two or three templates, check
   them in a browser, then the rest. **Exceptions:** do not double up `form-control` with
   `form-select` on a select (under 5 the two fight), and leave the scorecard templates to
   step 5.

   **Pilot done 26 Nov 2026:** `nav.ejs`, `roster-edit.ejs` and `generatedTournamentGallery.ejs`.
   Checked by swapping Bootstrap 5.3.8's css and bundle in for 4's at the network layer
   (Playwright `page.route`; nothing in the repo changes), against the same pages with the
   change stashed as a control. With both names: under 4 the screenshots are byte-identical;
   under 5 the nav dropdowns, the right-aligned Admin menu, the phone menu, the roster modals
   (opened by `roster-edit.js`'s jQuery `.modal('show')`, closed by `data-bs-dismiss`), the
   gallery carousel's controls and the hidden screen-reader text all work. Without them,
   under 5, the dropdowns and the phone menu do nothing. Repeat that check
   for each batch (`npm pack bootstrap@5.3.x` for the files). The bundle registers its jQuery plugins and fires the `.bs.modal` events
   through jQuery, as the table above expects.

   **Step 2 done 26 Nov 2026** for everything except the three scorecard templates (16
   names between them, step 5): the pilot, then the public pages, the admin pages and the
   member/Messer pages, each batch checked the same way and committed on its own. What the
   checks say Bootstrap 5 will change by itself at the cutover, none of it from the markup:
   grid gutters 30px → 24px, more padding on badges, dropdown items and card bodies, a
   darker `bg-dark`, the navbar container (step 5), and the History menu's `me-3`, which
   starts to apply. One trap found on the way: `no-gutters` on a **column**
   (`viewScorecard.ejs`) did nothing to the column under 4 but zeroed its `col-*` children's
   padding; `g-0` there would have zeroed the column's own padding under 5. It is now
   `px-0` on the three child rows, which means the same under both.

3. **Done 25 Nov 2026.** **Keep `form-group`, `form-row` and `form-inline` with rules in
   `custom.css`** rather than editing 600 uses. `form-inline` was going to become
   `d-flex flex-wrap align-items-center` with `w-auto` on the fields; a phone screenshot showed
   that loses its below-576px behaviour (fields full width, stacked), which no utility in
   either version gives, so the name stays with its own rule. The first three:
   ```css
   /* Bootstrap 4 names, kept after the move to 5 (HARD-50): spacing only. */
   .form-group { margin-bottom: 1rem; }
   .form-row { display: flex; flex-wrap: wrap; margin-right: -5px; margin-left: -5px; }
   .form-row > .col, .form-row > [class*="col-"] { padding-right: 5px; padding-left: 5px; }
   ```
   `__tests__/integration/contact-us-junior.test.js` asserts on `form-group`; it keeps passing.

4. **Review `custom.css`'s Bootstrap overrides.** Bootstrap 5 sets button, navbar, dropdown
   and pagination colours through CSS variables (`--bs-btn-bg` and friends), so an override
   of `background-color` can win at rest and lose on hover or focus. The purple
   `.btn-primary` override and the `.navbar .dropdown-menu` rule are the ones to check first.
   Set brand colours through the variables where they exist.

5. **Off-season, the cutover**, one commit:
   - swap the asset tags in `header.ejs` / `footer.ejs` and the precache list in `sw.ejs`;
   - `form-control` → `form-select` on every `<select>`;
   - the scorecard templates' markup, after REARCH-07 has moved their scripts, with the e2e
     specs as the net;
   - delete the Bootstrap 4 names that step 2 left alongside.
   - wrap the contents of the `<nav class="navbar">` in `views/nav.ejs` in a
     `<div class="container-fluid">`. Bootstrap 5's navbar takes its side padding from that
     container, so without it the brand and the phone menu items sit against the left edge
     (seen with 5.3.8 swapped in, 26 Nov 2026). It cannot go in early: under 4 a container
     inside the navbar adds its own padding to the navbar's.

6. **DataTables.** The bundle in `static/vendor/datatables/` is the **bs4** build of
   DataTables 1.10.20 (`datatables.min.js` names the builder URL). Its classes mostly exist
   in 5, so check the results and tables pages after the cutover before rebuilding; if the
   paging or buttons look wrong, rebuild the same plugin set with bs5 styling (HARD-45 has
   why the files are copies and how they were made). That probably means DataTables 1.13 or
   2.x, which is its own small upgrade.

7. **A guard test.** Its in-season half landed 25 Nov 2026:
   `__tests__/unit/bootstrap5-names.test.js` fails on a Bootstrap 4 name **without** its
   Bootstrap 5 partner on the same element (or a name with no partner — `btn-block`,
   `jumbotron` — or a selector on `[data-toggle|target|dismiss`), in `views/` or
   `static/beta/js/`. Each file still to convert has a ceiling; it is the to-do list for
   step 2, and stops new pages adding to it. Since batch 2 (26 Nov) it also reads class
   strings kept in `<% … %>` code and colours filled in by EJS (`badge-<%= c %>` needs
   `text-bg-<%= c %>`): three admin badges were built that way and would have lost their
   colour at the cutover with the guard green. At step 5 it becomes strict: fail on the
   Bootstrap 4 name whether or not its partner is there, and add a `<select>` with
   `form-control` and `class="close"`, which cannot be doubled up and so are not checked
   in-season.

## Acceptance criteria

- `package.json` has Bootstrap 5.3.x and no popper.js; `npm install` and the build log
  carry no Bootstrap or Popper deprecation warning.
- The guard test, in its strict step-5 form, passes, and fails when a `data-toggle=` is put
  back.
- **Every e2e spec passes.** `e2e/scorecard.spec.js`'s first test ("opens the scorecard
  modal") is the canary — its comment already says it is the assertion most exposed to this
  upgrade. The roster specs cover the modals in `roster-edit.js`.
- `__tests__/unit/nav-club-links.test.js` is updated for the new badge markup
  (`badge badge-warning` today).
- A browser check of each kind of page, phone and desktop: homepage, a results page and a
  tables page (DataTables), a fixture page, the scorecard wizard (both kinds) and the
  populated scorecard, the roster pages, an admin form, the gallery carousel, the nav
  dropdowns on a phone. Before-and-after screenshots side by side, as with any change people
  look at.
- Cost: none.

## Out of scope

- Removing jQuery (DataTables, and ~800 of the site's own calls).
- A redesign. The pages look the same, give or take Bootstrap 5's own defaults.
- Converting existing modals to `<dialog>`. That is the default for new work (above), not a
  retrofit.
