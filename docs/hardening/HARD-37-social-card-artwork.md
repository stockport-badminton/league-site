# HARD-37 — the social artwork constrains every card drawn on it

**Severity:** low, cosmetic · **Wave:** D · **Blocked by:** new source artwork (owner supplies)
**Owns:** `static/beta/images/bg/social-*.png`, `controllers/socialController.js`
(`createFixturesImage`, `resultImage`)
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

## What to do

1. **Get clean base images** — the four division artworks with no fade and no letter or
   number, full bleed. The owner has the originals. Same 1080x1350, PNG.
2. Keep the existing files until the new ones are proven. They are what `resultImage` uses
   today and that post runs every time a captain publishes a result.
3. Re-point `fixturesBackground()` in `socialController`. It is already the single place the
   fixtures card resolves artwork, and it already falls back to `social.png` for a division
   it has no file for, so this is one path change. `accentFor()` derives the card's accent
   from whatever that lookup returns, so the colours follow the new files on their own —
   but **re-run the accent tests**, which assert every background yields a colour that is
   light enough to read and still has chroma in it. They exist because the first version
   washed out to white.
4. **Then review the result card's design**, which is the actual reason to do this. It is
   the post that goes out weekly, it still uses the 2024 bottom-right layout that the fade
   was created to serve, and it carries **neither the league's name nor any indication of
   what competition it is** — the same outsider problem the fixtures card was just given the
   league name and URL to fix. Reviewing it needs the clean artwork first, which is why it
   is in this package rather than its own.
5. Re-render all four divisions and look at them. The images are the deliverable; a test
   can prove a JPEG came out and cannot prove it looks right.

## Acceptance criteria

- Four clean backgrounds in `static/beta/images/bg/`, no baked-in text, no fade.
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
  artwork at all, which is the fallback if the clean originals never materialise. Sketches
  were throwaway; the approach is recorded so it is not re-derived from nothing.

## Out of scope

- The weekly tables card, which is on the plain grey `social.png` and has no division
  artwork to inherit. Worth revisiting once these exist, separately.
- Anything about what the posts say. This is the pictures only.
