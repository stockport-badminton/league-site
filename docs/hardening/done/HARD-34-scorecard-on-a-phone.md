# HARD-34 — Filing a result on a phone

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `e2e/` (a new mobile spec), `views/index-scorecard.ejs`, `views/messer-scorecard.ejs`
**Source:** HARD-28, gap 6 — the one gap in that brief's list that its acceptance criteria
did not cover, left open deliberately rather than quietly dropped.

## Why

**Captains file results on a phone, standing in a sports hall at ten o'clock at night.**
That is the primary device for this flow, and nothing tests it.

`roster-edit.spec.js` does test a phone: stacking, real touch drag, and horizontal
overflow at 390px. It was written because the roster editor had bound `dragstart`/`drop`,
which mobile browsers never fire from touch — so **nothing on that page worked on a phone
and no test could see it**. The scorecard wizard has had no equivalent pass, and it is a
harder target: fourteen steps inside a Bootstrap modal, thirty-six number inputs, twelve
dropdowns, and a file picker that on a phone opens the camera.

HARD-28 closed what the form submits and what the captain is told. Both were asserted at
desktop width only, so "the captain is told" is really "the captain would be told, on a
1280px window".

## What to check

- **The modal fits.** No horizontal scroll at 390px on any of the fourteen steps, and the
  Continue/Back buttons reachable without the keyboard covering them. The score steps are
  the risk: two games, four number inputs, in `col-6` pairs.
- **The number inputs bring up a numeric keypad**, and entering a score does not scroll
  the step out from under the finger.
- **The file input takes a camera photo.** `accept="image/*,application/pdf,…"` is what
  decides whether iOS offers Camera at all; a test can at least assert `capture` handling
  and that the accept list has not narrowed (see `scorecard.spec.js`, which asserts the
  desktop half of this).
- **The step gate's feedback is visible where the finger is.** `#gameFeedbackN` is
  inserted after the score row; on a narrow screen it may land below the fold, which makes
  a blocked Continue look like a dead button — the failure mode is "nothing happens",
  which is the worst one.
- **Messer too**, now that it has a gate of its own (HARD-28).

## Acceptance criteria

- A mobile spec at 390px, modelled on `roster-edit.spec.js`'s phone describe, walking the
  wizard to a submitted draft.
- No horizontal page overflow at any step.
- A blocked Continue leaves its reason on screen without scrolling.
- Anything found is fixed or recorded here; a spec that only documents a broken page is
  `test.fail()`-annotated per the convention in CLAUDE.md.

## Out of scope

- Real-device testing. Playwright's emulation is what the roster page's touch coverage
  uses and it caught a real bug there.
- Redesigning the wizard. If the fourteen-step modal turns out to be the wrong shape for a
  phone, that is a finding for its own package, not this one.

## Outcome (25 Sep 2026)

`e2e/scorecard-phone.spec.js` — 12 tests at 390px with `hasTouch`/`isMobile`, everything
tapped and typed rather than clicked and filled.

- **The wizard fits.** Both cards walked through all fourteen steps with no sideways scroll
  of the page, the modal, or any control past the screen edge. The league walk ends in a
  filed draft read back from `scorecardstore` — so this is the second spec that writes, one
  row, declared through `allowWrites` exactly as `scorecard-submit.spec.js` is. The messer
  walk stops at the summary.
- **The gate's reason is on screen**, at 390x844, 375x667 and 390x500 (the phone with its
  keyboard up — emulation cannot raise a keyboard, so the viewport is shrunk to what is
  left). That is true **by layout and by nothing else**: the score row is the last thing in
  every score step, so `#gameFeedbackN` sits directly above the footer. Move it, or put
  anything between it and the footer, and the tests say so.
- **Fixed: the digit pad.** The league inputs were `type="number"` alone, which on iOS opens
  the full keyboard in its numbers layout. All 72 (the modal and its error-path copy) now
  carry `inputmode="numeric"`.
- **Messer deliberately keeps plain `type="number"`.** iOS's `numeric` and `decimal` pads
  have no minus key and messer scores go to −10, so copying the fix across would have made a
  handicapped score untypeable on an iPhone while every desktop test passed. A test pins it.
- **The file pickers** carry `image/*` and no `capture` — `capture` would force the camera
  and hide the photo library, and the usual order is photograph now, file later.

Every assertion was shown to fail: the keypad test with the view fix stashed, the overflow
test against a planted 600px-wide block, and the gate tests against a 400px spacer between
reason and footer. The last one also showed that Playwright's `toBeInViewport()` passes on
a one-pixel sliver, so the reason is asserted with `ratio: 1`.

**Left open, recorded rather than fixed:**

- With the keyboard up, revealing the reason adds a line of text above the footer, so
  Continue moves ~46px down *after* the tap and ends half below the fold. The reason itself
  is wholly visible. Reserving the feedback's height would stop the jump; that is a layout
  change for whoever next touches the wizard, not a failure of this package's criterion.
- `views/populated-scorecard.ejs` has the same league score inputs without `inputmode`.
  Not this package's file.
- `GET /messer-scorecard-beta/test` serves the dev debug panel in production — HARD-40.
