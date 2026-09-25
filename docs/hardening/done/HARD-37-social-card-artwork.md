# HARD-37 — the social artwork constrains every card drawn on it

**Severity:** low, cosmetic · **Wave:** D · **Closed 25 Sep 2026** — landed 22 Sep; the one
open decision (step 3) was left with the owner rather than held open here
**Owns:** `static/beta/images/bg/social-*.png`, `controllers/socialController.js`
(`createFixturesImage`, `resultImage`), `tools/artwork/`
**Source:** building the weekly fixtures post, 16 Sep 2026 — raised by the owner while
looking at the first rendered cards

## Why

The four division backgrounds (`social-Premier.png`, `social-Division-1/2/3.png`) are not
plain artwork. Each has **two design decisions already baked into the pixels**, and both
now fight the things being drawn on top:

- **A fade to near-white across the bottom third.** It exists because `resultImage` writes
  its text there, bottom-right-aligned, and needed a light area to sit on. Any other layout
  inherits it: the division's colour dies off down the picture and the bottom of the frame
  is grey whatever division it is. It also poisons anything *sampled* from the artwork —
  the fixtures card's accent colour had to be restricted to the top strip, because
  `stats().dominant` over the whole image returns that fade.
- **The division marker — `P`, `1`, `2`, `3` — is part of the image.** So a card that also
  *names* the division prints the same information twice, a few hundred pixels apart, in
  two different visual languages. The fixtures card does exactly this, and the panel clips
  the marker on some divisions.

Neither is a bug. Both are a 2024 layout's requirements, frozen into the only copy of the
artwork we have, and inherited by everything drawn since.

**The cost is that the artwork cannot be composed with.** A background that is uniform
edge-to-edge and carries no text can take any layout — panel high or low, full bleed,
banner crop, a division label wherever the design wants it. The current files can take one.

## Where this got to, 22 Sep 2026

**The blocker is gone.** Four clean backgrounds now exist in
`tools/artwork/assets/backgrounds/` — no fade, no division letter, full bleed, 1080x1350.
Two were recovered and two generated:

| | Provenance |
|---|---|
| `division-2-clean.png`, `division-3-clean.png` | **recovered** from `social-Premier.xcf`, which holds them as standalone layers |
| `premier-clean.png`, `division-1-clean.png` | **generated**, because their layers are unusable — `div 1 background` has the white footer fade baked in and `Prem background` has the player baked in too |

The generated pair are reproducible: `tools/artwork/backgrounds.sh` carries the exact
palettes and **seeds**, which is the only thing that makes a chosen random render
recoverable rather than a lucky one nobody can get back.

**The premise of this package was half wrong, and the correction is the useful part.** It
assumed the backgrounds were photographs the artwork had been built on top of. They are
not, and never were. Comparing the finished Division 2 card against the photograph it was
made from: none of that frame's structure survives — no wall/floor line, no pillar, no row
of chairs — and the triangles *behind the player* are the same size as the ones in the
corners, where a mesh built from a photograph puts its small triangles on the detail. The
background is a generated low-poly gradient with its own colour poles.

So **subject, background, letter and fade were always four separate things**, welded
together only at export. That is what makes the rest of this tractable.

`tools/artwork/` has the three tools and a README. Two further findings live in
`polyart.js`'s header and are worth reading before touching any of it: the subject filter
is quantise-then-smooth-the-labelling rather than Kuwahara (measured against the 2024
originals, which had both the input and output of that step on disk), and **the abstraction
is de-identification rather than styling**, which inverts how it is tuned.

## The layer that was nearly lost

**The cards are a background with a PLAYER composited onto it.** The first pass at this
package delivered the clean backgrounds, the panel and the text, and no player — a coloured
mesh with a box of text on it. The owner caught it: *"you've taken the people off… we've
just been through the work to de-id the people so that they could be layered on as they
were originally."*

Worth recording because of *why* it happened. Separating a composite into layers makes each
one easy to reason about and makes exactly one mistake easy to make: putting back fewer
layers than you took apart. Nothing failed. Every test passed, the route returned 200, the
cards looked deliberate. The missing layer was the one the whole preceding piece of work —
cutting the players out and abstracting them — had existed to produce.

The subjects live in `static/beta/images/bg/divisions/subjects/`, resolved by
`subjectFor()`. They are the **polymerised** cut-outs: abstracted so the individual is not
identifiable, which is the point of the treatment and not a style. `tools/artwork/` has the
tools and the measured settings.

## What to do

1. ~~Get clean base images.~~ **Done.**
2. ~~Keep the existing files until the new ones are proven.~~ **Still true and still done:**
   `backgroundFor()` falls back to the 2024 artwork for any division with no clean version,
   which Division 4 exercises with real files.
3. **Decide whether all four backgrounds are regenerated.** *Closed without regenerating,
   25 Sep 2026*: the owner closed the package with the mixed set in place. It is taste rather
   than a fault and nothing waits on it; `tools/artwork/backgrounds.sh` holds the palettes
   and seeds if it is ever done. The intent had been that they should be, so the set reads as one league: two are recovered 2024 artwork
   and two are new. **Look at all four together before choosing**; the recovered Division 3
   has a noticeably different triangle scale and direction from the rest.
4. ~~Draw the division letter at render time.~~ **Done** — `glyph()` in `utils/socialCard.js`,
   off by default, drawn by the result card. Note its argument is `top`, not `y`: an SVG `y`
   is the baseline, so a caller thinking in "distance from the top of the card" loses the
   cap height off the top of the frame. That is not hypothetical; it shipped that way for
   one render and the letters were visibly guillotined.
5. ~~Make the text panels addable and removable per card.~~ **Done** — `panel()` is a call
   the renderer makes, and each card sizes its own. The fixtures panel now grows *upward*
   from the foot of the card according to how many lines it has, so a quiet week leaves the
   player visible and a busy one takes the room it needs.
6. ~~Re-point the background lookup.~~ **Done**, and it moved into `utils/socialCard.js` as
   `backgroundFor()` so both cards share it. `accentFor()` still samples only the top strip:
   the clean backgrounds have no fade so they no longer need that restriction, but
   `social.png` does, and the accent tests now cover both sets.
7. ~~Review the result card's design.~~ **Done, and it was not optional.** See below.
8. ~~Re-render all four and look at them.~~ **Done**, repeatedly, and every adjustment in
   this package came from looking rather than from a test.

**Re-pointing the background and redesigning the result card were never two jobs.** The old
card wrote BLACK text into the bottom-right corner, which was legible only because the 2024
artwork faded to near-white exactly there. Put a clean background under that layout and it
renders perfectly, returns 200, is a valid JPEG of the right size, and cannot be read. Doing
step 6 without step 7 would have shipped that.

## Acceptance criteria

- ✅ Four clean backgrounds, no baked-in text, no fade — in
  `static/beta/images/bg/divisions/`.
- ✅ The division letter is drawn by the renderer, and a card renders without one.
- ✅ A text panel is something a card opts into.
- ✅ The player is composited back on, per division, and is visible rather than buried.
- ✅ The weekly VIDEO draws the same card. It carried its own copy of the 2024 layout —
  own SVG, own escaping, own artwork lookup, black text in the corner — which no change to
  the real card ever reached. `__tests__/integration/video-result-frames.test.js` asserts
  the frames are legible and adds a guard that fails if a second renderer reappears there,
  because a drifting copy breaks nothing until somebody edits the original and not the copy.
- ✅ A division with no CLEAN artwork still renders, on the fallback.
- ✅ A fixture with NO division is SKIPPED, on purpose. `division` comes from a LEFT JOIN
  through the home team and is null whenever that team has none — 1,318 completed fixtures,
  six of them in 2026, so this reaches a live video window. The old code skipped them by
  accident, because `division.replace(...)` threw a TypeError the catch swallowed. Replacing
  that with a lookup that always answers turned an accidental skip into a card reading
  "null" in 68px white type, published to Facebook and Instagram — the `String(null)` trap
  that once put "0 null null" on every league-table image. **A missing result is invisible;
  a card saying "null" is not.** Caught only because the owner asked what the fabricated
  "Messer Knockout" frame in the test was supposed to be — there is no such division, and
  the invented example had been used to justify the change.
- ✅ `/fixtures-image/:division` renders for all four and still falls back rather than
  500ing for a division with no artwork.
- ✅ The result card carries the league name, the division in words, and the site URL.
- ✅ `__tests__/integration/fixtures-image.test.js` passes — the artwork tests assert the
  **path chosen**, not the rendered bytes, because the division name is printed on the
  picture so two divisions differ in bytes whether or not their backgrounds do.

**`__tests__/integration/result-card.test.js` is the new one, and it asserts a property no
earlier test could have caught**: the WCAG contrast between white text and whatever is
underneath it, measured off the rendered pixels. Remove the panel and it fails on every
division at 1.8–4.0 against a 4.5 bar.

It also carries a trap worth knowing before writing any test that measures part of a
rendered image. **`sharp(buf).extract(region).stats()` computes statistics from the INPUT
image and ignores the pipeline**, so it silently returns whole-image means and every region
reads identically. The first version of this file did exactly that and passed — because the
panel then covered 74% of the frame, so whole-image means really did differ. It survived a
mutation test for the same wrong reason. It only surfaced when the panel shrank to a band
across the foot. Materialise the crop with `.toBuffer()` before calling `.stats()`.

## What the fixtures card already settled

Worth knowing before redesigning anything on top of the new artwork:

- **A white panel over this artwork does not work.** Tried at 0.93, 0.97 and 1.0. To be
  legible it has to be near-opaque, and then the artwork is decoration around a white
  rectangle. The card uses a **dark** panel (`#0d0d0f` at 0.80) with white text, which lets
  the colour through and reads cleanly. The same is likely true of the result card.
- **Four from-scratch designs were prototyped and rejected in favour of keeping the
  artwork** — a to-scale badminton court as texture, a net-textured header band, a
  shuttlecock motif, and the dark panel that won. The court and band versions needed no
  artwork at all. That was recorded as the fallback if clean originals never materialised;
  they have since, so it is now an alternative rather than a contingency. Sketches were
  throwaway; the approach is recorded so it is not re-derived from nothing.

## Out of scope

- **The weekly tables card stays on the plain grey `social.png`, by decision (22 Sep 2026).**
  It was the obvious next thing to re-point and that would have been a mistake: its rows are
  drawn in BLACK, which reads on a light greyscale background and would be illegible on the
  colourful division artwork — the same trap the result card was rescued from. The light
  background is doing a job there rather than waiting to be replaced. It is also square
  where these are 4:5.
- Anything about what the posts say. This is the pictures only.
