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
