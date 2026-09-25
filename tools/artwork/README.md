# Division artwork

Three local tools that rebuild the effect behind `static/beta/images/bg/social-*.png`.
None of them is wired into the app, and none adds a dependency — `sharp` was already here
for the social cards, and the triangulation, edge detection and quantisation are written
out rather than pulled in.

They were built for **HARD-37** (done), which needed clean base artwork.

```bash
# 1. a photo (or better, a hand cut-out) -> a de-identified subject
node tools/artwork/polyart.js source/IMG_0932-cutout.png subject.png \
  --preset subject --width 1680 --height 2520

# 2. a background, from nothing
node tools/artwork/lowpolybg.js bg.png --palette court --cell 170 --variants 6

# ...or regenerate the chosen ones
./tools/artwork/backgrounds.sh

# 3. put them together
node tools/artwork/compose.js bg.png subject.png card.png --scale 0.78 --x 0.62 --y 0.93
```

## The thing that took longest to see

**The background was never the photograph.** It looks like a triangulated photo with the
player masked out of it, and it is not: `social-Premier.xcf` holds `div 1/2/3 background`
as standalone layers with no player in them, and comparing the finished Division 2 card
against the photo it was made from shows none of that frame's structure surviving — no
wall/floor line, no pillar, no chairs — while the triangles behind the player are the same
size as the ones in the corners. A mesh built from a photograph puts its small triangles
where the detail is.

So subject and background were always separable. That is what lets a card be composed at
render time instead of exported flat.

## Cost, and why only one of these runs per request

| | | |
|---|---|---|
| `polyart.js` | photo → subject | ~2.3s at full size |
| `lowpolybg.js` | → background | ~130ms |
| `compose.js` | subject + background → card | **~40ms** |

Composing per request is *cheaper* than what the app does today (63ms to load
`social-Division-2.png` and draw text on it), because a generated background is a far
simpler PNG than a photo-derived one.

**Backgrounds are not generated per request**, though 130ms would fit. The generator is
random, so generating at render time means the first person to see a given background is
the public, on a post that has already gone out. Generate a handful, look at them, keep the
good ones. Same rule HARD-37 already states: the images are the deliverable and no test can
prove one looks right.

## The abstraction is de-identification, not styling

Read the note in `polyart.js` before changing `--colours` or `--smooth-regions`. Briefly:
more colours and less smoothing give a sharper, prettier, **more identifiable** picture, so
the obvious direction of improvement is the wrong one. `--preset subject` (20/10) and
`--preset subject-soft` (16/14) are the two settings that were chosen by looking at them.

## What is here

- `assets/backgrounds/` — four clean backgrounds, 1080x1350, no fade and no division
  letter. Divisions 2 and 3 are **recovered** from the GIMP document, which holds them as
  standalone layers. Premier and Division 1 are **generated**, because their layers are
  unusable: `div 1 background` has the white footer fade baked in and `Prem background`
  has the player baked in too.
- `backgrounds.sh` — regenerates the generated pair. The `--seed` values in it are the
  point: the generator is random, so a seed is what makes a chosen render recoverable
  rather than a lucky one nobody can get back.
- `source/` — **gitignored**, see `.gitignore` for why. The originals, the hand cut-outs,
  the polymerised subjects and the `.xcf`.
