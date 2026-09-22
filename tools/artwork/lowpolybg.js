#!/usr/bin/env node
'use strict';

/**
 * lowpolybg.js — generate a low-poly gradient background.
 *
 * THE BACKGROUND IS NOT THE PHOTOGRAPH, and that is the whole point of this file.
 *
 * It looked like one. The first read of the division artwork assumed the whole frame was a
 * triangulated photo with the player masked out of it. Comparing social-Division-2.png
 * against the photograph it was made from settles it, and the evidence is worth keeping
 * because it is the kind that is easy to look straight past:
 *
 *   - the photo has a hard horizontal line where the breeze-block wall meets the floor, a
 *     blue pillar right of centre, and a row of chairs. NONE of it survives into the card;
 *   - the triangles directly behind the player are the SAME SIZE as the ones in the
 *     corners. A mesh built from a photograph puts its small triangles where the detail
 *     is, so a uniform mesh cannot have come from one;
 *   - the card's colours (green top-right, yellow, blue mid-left, orange far-left) do not
 *     correspond to anything in the frame, which is tan wall over pale wood.
 *
 * So subject and background were always separable, and separating them is what lets the
 * final card be composed at render time: the player can move, and the background can vary,
 * without either being re-derived from a photograph nobody kept.
 *
 * Usage:
 *   node tools/artwork/lowpolybg.js out.png [options]
 *
 *   --width N --height N  output size                     (default 1080x1350)
 *   --cell N              approximate triangle size       (default 130)
 *   --jitter 0..1         how far vertices leave the grid (default 0.5)
 *   --palette a,b,c       hex colours for the field       (default: a stock set)
 *   --from image.png      sample the palette from an image instead
 *   --poles N             colour centres in the field     (default 5)
 *   --falloff N           how tightly a pole holds its colour (default 2.4)
 *   --stroke 0..1         darkness of the triangle edges  (default 0.18)
 *   --seed N              fix it to get the same background twice
 *   --variants N          write N numbered files instead of one
 *
 * Deliberately NO fade and NO division glyph: both are layout decisions belonging to
 * whatever is drawn on top, and baking them in is what made the 2024 artwork impossible to
 * compose with. That is HARD-37's whole complaint.
 */

const sharp = require('sharp');
const { rng, delaunay, strokeTriangles } = require('./polyart.js');

const PALETTES = {
  // Read off the existing cards, so a new background sits in the same family as the four
  // that are already posting every week.
  court:   ['#3f8ecb', '#8ad0e8', '#f2e06a', '#7ecb55', '#e8a13f'],
  dusk:    ['#2f3a8f', '#7b4fa8', '#d9527a', '#f29a4b', '#ffd98a'],
  pitch:   ['#1d6b45', '#4fae6d', '#c9dd67', '#f0e9a8', '#2f8f8f'],
  slate:   ['#2b3b52', '#4f6b8f', '#8fa8c4', '#c8d4e0', '#6b7f99'],
  ember:   ['#7a1f3d', '#c2402f', '#e87a35', '#f2be54', '#f7e6a8'],
};

function parseArgs(argv) {
  const o = {
    width: 1080, height: 1350, cell: 130, jitter: 0.5, poles: 5, falloff: 2.4,
    stroke: 0.18, seed: 1, variants: 1, palette: null, from: null, saturate: 1.25,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--width': o.width = +next(); break;
      case '--height': o.height = +next(); break;
      case '--cell': o.cell = +next(); break;
      case '--jitter': o.jitter = +next(); break;
      case '--poles': o.poles = +next(); break;
      case '--falloff': o.falloff = +next(); break;
      case '--stroke': o.stroke = +next(); break;
      case '--saturate': o.saturate = +next(); break;
      case '--seed': o.seed = +next(); break;
      case '--variants': o.variants = +next(); break;
      case '--palette': o.palette = next(); break;
      case '--from': o.from = next(); break;
      default:
        if (a.startsWith('--')) throw new Error('unknown option ' + a);
        rest.push(a);
    }
  }
  if (!rest.length) throw new Error('usage: lowpolybg.js <out.png> [options]');
  o.output = rest[0];
  return o;
}

const hexToRgb = (h) => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

/**
 * Sample a palette out of an image: shrink hard, then keep the most colourful cells.
 *
 * ONLY THE TOP 55%. The existing artwork fades to near-white across its bottom third, so a
 * palette sampled from the whole frame is dominated by that wash and comes back grey. This
 * is the same trap the fixtures card's accent colour hit — stats().dominant over the whole
 * image returned the fade — and it is worth stating twice because the symptom is not an
 * error, it is a picture that is quietly duller than the one you sampled from.
 */
async function paletteFrom(file, want) {
  const side = 6;
  const meta = await sharp(file).metadata();
  // EXIF orientation swaps the axes, so the raw metadata width/height are the wrong way
  // round for an extract on a rotated photo — which silently crops a vertical strip of the
  // side instead of a horizontal strip of the top.
  const turned = meta.orientation >= 5;
  const mw = turned ? meta.height : meta.width;
  const mh = turned ? meta.width : meta.height;
  const { data } = await sharp(file)
    .rotate()
    .extract({ left: 0, top: 0, width: mw, height: Math.round(mh * 0.55) })
    .resize(side, side, { fit: 'cover' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cells = [];
  for (let i = 0; i < side * side; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    cells.push({ rgb: [r, g, b], chroma: mx - mn });
  }
  // Spread, not just colourful. Taking the top N by chroma picks N shades of the SAME
  // colour on a picture with one dominant hue — sampling Premier's artwork that way gave
  // five yellows and a background with no gradient in it at all. Greedy farthest-point
  // selection over the colourful cells keeps the palette spread across the hues present.
  cells.sort((a, b) => b.chroma - a.chroma);
  const pool = cells.slice(0, 18);
  const picked = [pool.shift()];
  while (picked.length < want && pool.length) {
    let best = 0, bestD = -1;
    for (let i = 0; i < pool.length; i++) {
      let nearest = Infinity;
      for (const p of picked) {
        const d = (pool[i].rgb[0] - p.rgb[0]) ** 2 + (pool[i].rgb[1] - p.rgb[1]) ** 2
                + (pool[i].rgb[2] - p.rgb[2]) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestD) { bestD = nearest; best = i; }
    }
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked.map(c => c.rgb);
}

/**
 * A jittered grid, not a random scatter. Random points give wildly uneven triangles with
 * long thin slivers; a jittered grid gives the even, calm mesh the real artwork has.
 * Points are generated one cell OUTSIDE the canvas on every side, so the mesh's convex
 * hull comfortably covers the frame and no corner is left unfilled.
 */
function jitteredGrid(w, h, cell, jitter, rand) {
  const pts = [];
  const cols = Math.ceil(w / cell) + 2;
  const rows = Math.ceil(h / cell) + 2;
  for (let r = -1; r <= rows; r++) {
    for (let c = -1; c <= cols; c++) {
      pts.push([
        c * cell + (rand() - 0.5) * cell * jitter * 2,
        r * cell + (rand() - 0.5) * cell * jitter * 2,
      ]);
    }
  }
  return pts;
}

// Spread anchor positions. Placing poles at random lets several land together, and a
// field whose colour centres are all in one corner is a flat wash with a tint — which is
// what "the palette looks right but the background looks monochrome" turns out to mean.
const ANCHORS = [
  [0.16, 0.14], [0.84, 0.14], [0.16, 0.86], [0.84, 0.86],
  [0.50, 0.50], [0.50, 0.10], [0.50, 0.90], [0.10, 0.50], [0.90, 0.50],
];

/** Inverse-distance-weighted colour poles: smooth multi-colour field, no banding. */
function makeField(w, h, colours, n, falloff, rand) {
  const shuffle = (a) => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  const spots = shuffle(ANCHORS).slice(0, Math.min(n, ANCHORS.length));
  // Colours are dealt round-robin from a shuffled palette, so neighbouring poles are as
  // likely to differ as not — drawing each independently at random repeats colours.
  const deck = shuffle(colours);
  const poles = spots.map((s, i) => ({
    x: (s[0] + (rand() - 0.5) * 0.12) * w,
    y: (s[1] + (rand() - 0.5) * 0.12) * h,
    c: deck[i % deck.length],
  }));
  return (x, y) => {
    let wr = 0, wg = 0, wb = 0, sum = 0;
    for (const p of poles) {
      const dx = x - p.x, dy = y - p.y;
      const d = Math.pow(Math.sqrt(dx * dx + dy * dy) + 1, falloff);
      const wgt = 1 / d;
      wr += p.c[0] * wgt; wg += p.c[1] * wgt; wb += p.c[2] * wgt;
      sum += wgt;
    }
    return [wr / sum, wg / sum, wb / sum];
  };
}

/** Flat-fill each triangle from the field, sampled once at the centroid. */
function fillField(tris, pts, w, h, field) {
  const out = Buffer.alloc(w * h * 3);
  for (const [ia, ib, ic] of tris) {
    const [ax, ay] = pts[ia], [bx, by] = pts[ib], [cx, cy] = pts[ic];
    const [r, g, b] = field((ax + bx + cx) / 3, (ay + by + cy) / 3);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        if (l1 < -0.0001 || l2 < -0.0001 || 1 - l1 - l2 < -0.0001) continue;
        const p = (y * w + x) * 3;
        out[p] = r; out[p + 1] = g; out[p + 2] = b;
      }
    }
  }
  return out;
}

async function render(o, colours, seed, file) {
  const { width: w, height: h } = o;
  const rand = rng(seed);
  const pts = jitteredGrid(w, h, o.cell, o.jitter, rand);
  const tris = delaunay(pts);
  const field = makeField(w, h, colours, o.poles, o.falloff, rand);
  const buf = strokeTriangles(fillField(tris, pts, w, h, field), tris, pts, w, h, o.stroke);
  // A saturation lift at the end, because inverse-distance blending between poles of
  // opposite hue passes through grey on the way — so the midpoints come out muddier than
  // either colour that made them, and the whole field reads flatter than the palette.
  let pipe = sharp(buf, { raw: { width: w, height: h, channels: 3 } });
  if (o.saturate !== 1) pipe = pipe.modulate({ saturation: o.saturate });
  await pipe.png().toFile(file);
  return tris.length;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));

  let colours;
  if (o.from) colours = await paletteFrom(o.from, 5);
  else if (o.palette && PALETTES[o.palette]) colours = PALETTES[o.palette].map(hexToRgb);
  else if (o.palette) colours = o.palette.split(',').map(s => hexToRgb(s.trim()));
  else colours = PALETTES.court.map(hexToRgb);

  if (o.variants <= 1) {
    const n = await render(o, colours, o.seed, o.output);
    process.stderr.write(`  ${n} triangles -> ${o.output}\n`);
    return;
  }
  const stem = o.output.replace(/\.png$/i, '');
  for (let i = 1; i <= o.variants; i++) {
    const f = `${stem}-${i}.png`;
    await render(o, colours, o.seed + i * 7919, f);
    process.stderr.write(`  -> ${f}\n`);
  }
}

main().catch(e => { process.stderr.write('lowpolybg: ' + e.message + '\n'); process.exit(1); });
