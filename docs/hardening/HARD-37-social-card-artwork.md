# HARD-37 — the social artwork constrains every card drawn on it

**Severity:** low, cosmetic · **Wave:** D · **No longer blocked** — the artwork exists
(22 Sep 2026), see *Where this got to*
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

## What to do

1. ~~Get clean base images.~~ **Done** — see above.
2. Keep the existing files until the new ones are proven. They are what `resultImage` uses
   today and that post runs every time a captain publishes a result.
3. **Decide whether all four are regenerated.** The owner's intent is that they should be,
   so the set reads as one league: today two are recovered 2024 artwork and two are new,
   and a Premier that does not match makes the mismatch conspicuous. Regenerating all four
   is seconds of compute and the seeds make it repeatable — the cost is discarding two
   pieces of artwork that already work. **Look at all four together before choosing**; the
   recovered Division 3 has a noticeably different triangle scale and direction from the
   rest.
4. **Draw the division letter at render time, not into the pixels.** This is the whole
   point of clean backgrounds. A letter in the image fixes one layout for ever; a letter
   drawn by the renderer can move, resize, or be left off entirely for a card that already
   names the division in text — which the fixtures card does, and which is why it currently
   prints the same information twice a few hundred pixels apart.
5. **Make the text panels addable and removable per card.** Same reasoning. Legibility is a
   property of a particular background and a particular block of text, so it has to be a
   decision the renderer can take, not a fade baked into every background whether that
   card needs one or not.
6. Re-point `fixturesBackground()` in `socialController`. It is already the single place the
   fixtures card resolves artwork, and it already falls back to `social.png` for a division
   it has no file for, so this is one path change. `accentFor()` derives the card's accent
   from whatever that lookup returns, so the colours follow the new files on their own —
   but **re-run the accent tests**, which assert every background yields a colour that is
   light enough to read and still has chroma in it. They exist because the first version
   washed out to white. Note the new backgrounds have **no fade**, so the reason
   `accentFor()` samples only the top strip no longer applies to them — but it still does
   to `social.png`, so do not remove the restriction without checking what else uses it.
7. **Then review the result card's design**, which is the actual reason to do this. It is
   the post that goes out weekly, it still uses the 2024 bottom-right layout that the fade
   was created to serve, and it carries **neither the league's name nor any indication of
   what competition it is** — the same outsider problem the fixtures card was just given the
   league name and URL to fix.
8. Re-render all four divisions and look at them. The images are the deliverable; a test
   can prove a JPEG came out and cannot prove it looks right.

## Acceptance criteria

- Four clean backgrounds in `static/beta/images/bg/`, no baked-in text, no fade.
- The division letter is drawn by the renderer, and a card can be rendered without one.
- A text panel is something a card opts into, not something every background carries.
- `/fixtures-image/:division` renders on them for all four divisions, and still falls back
  rather than 500ing for a division with no file.
- The result card carries the league name and the site URL.
- `__tests__/integration/fixtures-image.test.js` still passes, including the artwork lookup
  tests — note those assert the **path chosen**, not the rendered bytes, because comparing
  two rendered cards proves nothing: the division name is printed on the picture, so two
  divisions differ in bytes whether or not their backgrounds do. A test that compared them
  passed against a version using one background for everything.

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

- The weekly tables card, which is on the plain grey `social.png` and has no division
  artwork to inherit. The clean backgrounds now exist, so this is worth revisiting — but
  separately, and note the tables card is square where these are 4:5.
- Anything about what the posts say. This is the pictures only.
