#!/usr/bin/env node
'use strict';

/**
 * polyart.js — rebuild the division-artwork effect from a photograph.
 *
 * The four division backgrounds (static/beta/images/bg/social-*.png) were made by hand in
 * GIMP in 2024 and only some of the source photos survive. This reproduces the effect so
 * new artwork can be generated from any photo — see HARD-37, which is blocked on clean
 * base images with no fade and no baked-in division letter.
 *
 * It is a LOCAL TOOL. Nothing in the app requires it, and it deliberately adds no
 * dependency: sharp is already here for the social cards, and the triangulation, the
 * edge detection and the painterly filter are all written out below rather than pulled in.
 *
 * WHAT THE EFFECT ACTUALLY IS — measured off the existing artwork at 600% zoom, because
 * it is two filters and not one, and that is the whole reason the tool is shaped this way:
 *
 *   background : Delaunay low-poly. Perfectly flat triangles with a thin dark stroke on
 *                every edge — and NOT derived from the photo at all. See lowpolybg.js.
 *   subject    : quantise to a small palette, then smooth the LABELLING. Flat regions with
 *                CURVED boundaries, which is how you can tell it is not triangulated: no
 *                triangle makes a curve. Kuwahara runs first as a PRE-PASS only. On its
 *                own it was wrong — measured against the 2024 originals it gives blocky,
 *                axis-aligned regions, its own staircase artefact.
 *
 * So the player is not a finely-triangulated background; it is a separate treatment
 * composited over one. The mask between them is the part a human did, and still the part
 * a human does — see --mask.
 *
 * WHAT THE ABSTRACTION IS FOR, WHICH IS NOT WHAT IT LOOKS LIKE
 * -----------------------------------------------------------
 * It is DE-IDENTIFICATION, not styling. The artwork is built from photographs of real
 * players, and the brief was "as faceless as possible without looking weirdly faceless".
 * Some people still worked out who they were.
 *
 * THAT INVERTS HOW YOU TUNE IT. More colours and a smaller smoothing radius give a
 * sharper, prettier, MORE identifiable picture — so the obvious direction of improvement
 * is the wrong one, and anyone adjusting this by eye for quality will tune straight past
 * the point of the filter. Measured on IMG_0932 at --radius 5 --passes 2:
 *
 *   --colours 28 --smooth-regions 8    eye clearly readable. Too identifiable.
 *   --colours 20 --smooth-regions 10   THE CHOSEN SETTING — see --preset subject.
 *   --colours 16 --smooth-regions 14   features generalised, still comfortably a person.
 *   --colours 12 --smooth-regions 18   at the limit.
 *   --colours 10 --smooth-regions 24   the eye has gone. Weirdly faceless, which ATTRACTS
 *                                      attention rather than deflecting it.
 *
 * The usable band is about 16–20 colours; below roughly 12 it fails in the one direction
 * the brief rules out.

 *
 * Usage:
 *   node tools/artwork/polyart.js in.jpg out.png [options]
 *
 *   --width N --height N   output size            (default 1080x1350, the card size)
 *   --points N             triangle vertices      (default 1200)
 *   --edge-bias 0..1       how hard vertices cluster on detail (default 0.75)
 *   --stroke 0..1          darkness of triangle edges          (default 0.22)
 *   --saturate N           background saturation multiplier    (default 1.0)
 *   --hue DEG              background hue rotation             (default 0)
 *   --mask file            greyscale: WHITE keeps the subject (Kuwahara), BLACK is
 *                          background (low-poly). Without one the whole frame is low-poly.
 *   --radius N             Kuwahara radius for the subject     (default 7)
 *   --passes N             Kuwahara iterations                 (default 2)
 *   --gravity G            crop gravity for --width/--height   (default centre)
 *   --auto-mask            derive the mask from edge density instead of supplying one
 *   --auto-mask-radius N   how far detail spreads into the mask (default 26)
 *   --auto-mask-pivot 0..1 edge density that counts as subject  (default 0.16)
 *   --auto-mask-steep N    how hard the mask edge is            (default 26)
 *   --levels N             posterise the subject. DEFAULT 0, AND LEAVE IT THERE — it
 *                          reintroduces the banding that iterating the Kuwahara removes.
 *   --preset NAME          'subject' (the chosen de-identification setting) or
 *                          'subject-soft' (more abstract). Later flags override it.
 *   --colours N            palette size for the subject. SEE THE NOTE ABOVE before raising.
 *   --smooth-regions N     boundary smoothing radius. Lower is sharper AND more identifiable.
 *   --seed N               vertex placement is random; fix it to get the same art twice
 *   --lowpoly-only         skip the subject pass entirely
 *   --cutout-only          skip the triangulation entirely
 */

const sharp = require('sharp');
const fs = require('fs');

// ---------------------------------------------------------------------------- args

// Named settings, so the de-identification decision above survives as a flag rather than
// as four numbers somebody has to remember and would otherwise re-derive by eye — badly,
// for the reason the header gives. Flags after --preset override it.
const PRESETS = {
  subject: { radius: 5, passes: 2, colours: 20, smoothRegions: 10, cutoutOnly: true },
  'subject-soft': { radius: 5, passes: 2, colours: 16, smoothRegions: 14, cutoutOnly: true },
};

function parseArgs(argv) {
  const o = {
    width: 1080, height: 1350, points: 1200, edgeBias: 0.75, stroke: 0.22,
    saturate: 1.0, hue: 0, mask: null, radius: 7, levels: 0, seed: 1, passes: 2, gravity: 'centre', fit: 'cover', matte: null,
    colours: 0, smoothRegions: 0,
    autoMask: false, autoMaskRadius: 26, autoMaskPivot: 0.16, autoMaskSteep: 26,
    lowpolyOnly: false, cutoutOnly: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--width': o.width = +next(); break;
      case '--height': o.height = +next(); break;
      case '--points': o.points = +next(); break;
      case '--edge-bias': o.edgeBias = +next(); break;
      case '--stroke': o.stroke = +next(); break;
      case '--saturate': o.saturate = +next(); break;
      case '--hue': o.hue = +next(); break;
      case '--mask': o.mask = next(); break;
      case '--radius': o.radius = +next(); break;
      case '--passes': o.passes = +next(); break;
      case '--colours': case '--colors': o.colours = +next(); break;
      case '--preset': {
        const name = next();
        if (!PRESETS[name]) throw new Error('unknown preset ' + name);
        Object.assign(o, PRESETS[name]);
        break;
      }
      case '--smooth-regions': o.smoothRegions = +next(); break;
      case '--gravity': o.gravity = next(); break;
      case '--fit': o.fit = next(); break;
      case '--matte': o.matte = next(); break;
      case '--auto-mask': o.autoMask = true; break;
      case '--auto-mask-radius': o.autoMaskRadius = +next(); break;
      case '--auto-mask-pivot': o.autoMaskPivot = +next(); break;
      case '--auto-mask-steep': o.autoMaskSteep = +next(); break;
      case '--levels': o.levels = +next(); break;
      case '--seed': o.seed = +next(); break;
      case '--lowpoly-only': o.lowpolyOnly = true; break;
      case '--cutout-only': o.cutoutOnly = true; break;
      default:
        if (a.startsWith('--')) throw new Error('unknown option ' + a);
        rest.push(a);
    }
  }
  if (rest.length < 2) throw new Error('usage: polyart.js <in> <out> [options]');
  o.input = rest[0];
  o.output = rest[1];
  return o;
}

// A seeded PRNG, so a run can be repeated. Vertex placement is random and "render it
// again" is a thing you want when one of four came out badly.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------- pixels

/**
 * Loads the photo, and KEEPS ITS ALPHA if it has any.
 *
 * That matters because the intended workflow is now: hand-cut the player to a transparent
 * PNG once, then polymerise THAT. An earlier version called removeAlpha() and silently
 * flattened a cut-out back onto black, which is the one input this tool most needs to
 * handle.
 *
 * Note the caveat: Kuwahara averages a neighbourhood, so near the cut edge it mixes in
 * whatever RGB sits under the transparent pixels. A cut-out matted onto WHITE processes
 * cleanly; one matted onto black gets a dark fringe. --matte fills before processing.
 */
async function loadRGB(file, width, height, position, fit, matte) {
  const meta = await sharp(file).metadata();
  // .rotate() with no argument applies the EXIF orientation. Two of the four source
  // photographs carry orientation 6 (rotate 90 CW) and sharp does NOT honour it unless
  // asked, so without this the artwork comes out on its side — and a 3504x2336 photo that
  // should be 2336x3504 is obvious ONLY if you look at the picture, never at the code.
  let pipe = sharp(file).rotate();
  if (matte) pipe = pipe.flatten({ background: matte });
  pipe = pipe.resize(width, height, {
    fit, position,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  const n = width * height;
  if (!meta.hasAlpha || matte) {
    const { data } = await pipe.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { rgb: data, alpha: null };
  }

  const { data } = await pipe.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgb = Buffer.alloc(n * 3);
  const alpha = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2];
    alpha[i] = data[i * 4 + 3];
  }
  return { rgb, alpha };
}

function luma(rgb, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 3) {
    g[i] = 0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2];
  }
  return g;
}

// Sobel magnitude, normalised to 0..1. This is what decides where the triangles get small.
function sobel(g, w, h) {
  const out = new Float32Array(w * h);
  let max = 1e-6;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = g[i - w - 1], tc = g[i - w], tr = g[i - w + 1];
      const ml = g[i - 1],                    mr = g[i + 1];
      const bl = g[i + w - 1], bc = g[i + w], br = g[i + w + 1];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      const m = Math.hypot(gx, gy);
      out[i] = m;
      if (m > max) max = m;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

// ---------------------------------------------------------------------------- vertices

/**
 * Vertices are rejection-sampled against the edge map, so detail attracts them and flat
 * areas get big lazy triangles. Two things are deliberate:
 *
 *  - a uniform FLOOR, or a photo with one busy corner triangulates that corner and leaves
 *    the rest as four enormous triangles;
 *  - explicit BORDER and CORNER points, or the mesh's convex hull stops short of the frame
 *    and the edges of the picture are left unfilled.
 */
function samplePoints(edge, w, h, count, bias, rand) {
  const pts = [];
  const floor = 1 - Math.max(0, Math.min(1, bias));

  pts.push([0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]);
  const perSide = Math.max(4, Math.round(Math.sqrt(count)));
  for (let i = 1; i < perSide; i++) {
    const t = i / perSide;
    pts.push([Math.round(t * (w - 1)), 0], [Math.round(t * (w - 1)), h - 1]);
    pts.push([0, Math.round(t * (h - 1))], [w - 1, Math.round(t * (h - 1))]);
  }

  let tries = 0;
  const cap = count * 400;
  while (pts.length < count && tries++ < cap) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const e = edge[y * w + x];
    if (rand() < floor + (1 - floor) * Math.sqrt(e)) pts.push([x, y]);
  }
  return pts;
}

// ---------------------------------------------------------------------------- delaunay

/** Bowyer-Watson. Naive scan per point: n is ~1200 here, so this is well under a second. */
function delaunay(points) {
  const n = points.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const dmax = Math.max(maxX - minX, maxY - minY) || 1;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;

  const pts = points.slice();
  pts.push([mx - 20 * dmax, my - dmax], [mx, my + 20 * dmax], [mx + 20 * dmax, my - dmax]);

  const circum = (a, b, c) => {
    const [ax, ay] = pts[a], [bx, by] = pts[b], [cx, cy] = pts[c];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    const dx = ax - ux, dy = ay - uy;
    return { x: ux, y: uy, r2: dx * dx + dy * dy };
  };

  let tris = [];
  const push = (a, b, c) => { const cc = circum(a, b, c); if (cc) tris.push({ a, b, c, cc }); };
  push(n, n + 1, n + 2);

  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i];
    const edges = [];
    const kept = [];
    for (const t of tris) {
      const dx = px - t.cc.x, dy = py - t.cc.y;
      if (dx * dx + dy * dy <= t.cc.r2) {
        edges.push([t.a, t.b], [t.b, t.c], [t.c, t.a]);
      } else {
        kept.push(t);
      }
    }
    tris = kept;
    // An edge shared by two removed triangles is interior to the cavity, so it goes.
    for (let e = 0; e < edges.length; e++) {
      if (!edges[e]) continue;
      let shared = false;
      for (let f = e + 1; f < edges.length; f++) {
        if (!edges[f]) continue;
        if ((edges[e][0] === edges[f][1] && edges[e][1] === edges[f][0]) ||
            (edges[e][0] === edges[f][0] && edges[e][1] === edges[f][1])) {
          edges[f] = null; shared = true;
        }
      }
      if (!shared) push(edges[e][0], edges[e][1], i);
    }
  }

  // Drop anything still touching the super-triangle.
  return tris.filter(t => t.a < n && t.b < n && t.c < n).map(t => [t.a, t.b, t.c]);
}

// ---------------------------------------------------------------------------- raster

/**
 * Fill each triangle with the MEAN colour of the photo under it — not the colour at its
 * centroid, which picks up whatever single pixel happens to sit there and makes a mesh
 * full of speckle wherever the photo has noise.
 */
function fillTriangles(src, tris, pts, w, h) {
  const out = Buffer.alloc(w * h * 3);
  for (const [ia, ib, ic] of tris) {
    const [ax, ay] = pts[ia], [bx, by] = pts[ib], [cx, cy] = pts[ic];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;

    const inside = [];
    let r = 0, g = 0, b = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -0.0001 || l2 < -0.0001 || l3 < -0.0001) continue;
        const p = (y * w + x) * 3;
        inside.push(p);
        r += src[p]; g += src[p + 1]; b += src[p + 2];
      }
    }
    if (!inside.length) continue;
    const n = inside.length;
    const R = r / n, G = g / n, B = b / n;
    for (const p of inside) { out[p] = R; out[p + 1] = G; out[p + 2] = B; }
  }
  return out;
}

/** The thin dark line on every triangle edge. It is what stops the mesh reading as mush. */
function strokeTriangles(buf, tris, pts, w, h, amount) {
  if (amount <= 0) return buf;
  const line = (x0, y0, x1, y1) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) {
        const p = (y0 * w + x0) * 3;
        buf[p] *= (1 - amount); buf[p + 1] *= (1 - amount); buf[p + 2] *= (1 - amount);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  for (const [ia, ib, ic] of tris) {
    line(pts[ia][0], pts[ia][1], pts[ib][0], pts[ib][1]);
    line(pts[ib][0], pts[ib][1], pts[ic][0], pts[ic][1]);
    line(pts[ic][0], pts[ic][1], pts[ia][0], pts[ia][1]);
  }
  return buf;
}

// ---------------------------------------------------------------------------- kuwahara

/**
 * Kuwahara: for each pixel look at four overlapping quadrants, take the mean of whichever
 * has the LOWEST variance. Flat areas flatten, edges stay put — which is the curved-border
 * poster-paint look on the players in the existing artwork.
 *
 * Done with summed-area tables so the radius is free. The naive form is four windows of
 * (r+1)^2 samples per pixel, which at r=7 and 1080x1350 is ~370M reads and takes minutes.
 */
function kuwahara(src, w, h, radius) {
  const N = w * h;
  const sum = [new Float64Array((w + 1) * (h + 1)), new Float64Array((w + 1) * (h + 1)), new Float64Array((w + 1) * (h + 1))];
  const sqL = new Float64Array((w + 1) * (h + 1));
  const sumL = new Float64Array((w + 1) * (h + 1));
  const W = w + 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 3;
      const r = src[p], g = src[p + 1], b = src[p + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const i = (y + 1) * W + (x + 1);
      const up = i - W, left = i - 1, ul = i - W - 1;
      sum[0][i] = r + sum[0][up] + sum[0][left] - sum[0][ul];
      sum[1][i] = g + sum[1][up] + sum[1][left] - sum[1][ul];
      sum[2][i] = b + sum[2][up] + sum[2][left] - sum[2][ul];
      sumL[i] = l + sumL[up] + sumL[left] - sumL[ul];
      sqL[i] = l * l + sqL[up] + sqL[left] - sqL[ul];
    }
  }
  const area = (t, x0, y0, x1, y1) =>
    t[(y1 + 1) * W + (x1 + 1)] - t[y0 * W + (x1 + 1)] - t[(y1 + 1) * W + x0] + t[y0 * W + x0];

  const out = Buffer.alloc(N * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity, br = 0, bg = 0, bb = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = Math.max(0, q & 1 ? x : x - radius);
        const x1 = Math.min(w - 1, q & 1 ? x + radius : x);
        const y0 = Math.max(0, q & 2 ? y : y - radius);
        const y1 = Math.min(h - 1, q & 2 ? y + radius : y);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        if (n <= 0) continue;
        const sl = area(sumL, x0, y0, x1, y1);
        const variance = area(sqL, x0, y0, x1, y1) / n - (sl / n) * (sl / n);
        if (variance < best) {
          best = variance;
          br = area(sum[0], x0, y0, x1, y1) / n;
          bg = area(sum[1], x0, y0, x1, y1) / n;
          bb = area(sum[2], x0, y0, x1, y1) / n;
        }
      }
      const p = (y * w + x) * 3;
      out[p] = br; out[p + 1] = bg; out[p + 2] = bb;
    }
  }
  return out;
}

function posterize(buf, levels) {
  if (!levels || levels < 2) return buf;
  const step = 255 / (levels - 1);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(Math.round(buf[i] / step) * step);
  return buf;
}


/**
 * The mask, derived from the picture itself.
 *
 * The existing artwork was masked BY HAND in GIMP, and that is still the best answer for a
 * hero image. But a heavily blurred edge map is a decent stand-in: a player is the detailed
 * part of a badminton photograph and the hall behind them is the flat part, so "where is
 * the detail" and "where is the subject" mostly agree. Where they disagree — a busy crowd,
 * a line-marked floor — it produces triangles over the player, and you want a real mask.
 *
 * Chroma keying was tried first and is worse: the two automatic keys against a plain green
 * curtain both lost a navy shirt or filled with speckle, because a threshold on colour has
 * no idea what a person is.
 */
function autoMask(edge, w, h, radius, pivot, steep) {
  const W = w + 1;
  const sat = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + 1) * W + (x + 1);
      sat[i] = edge[y * w + x] + sat[i - W] + sat[i - 1] - sat[i - W - 1];
    }
  }
  const tmp = new Float32Array(w * h);
  let max = 1e-6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
      const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const v = (sat[(y1 + 1) * W + (x1 + 1)] - sat[y0 * W + (x1 + 1)]
               - sat[(y1 + 1) * W + x0] + sat[y0 * W + x0]) / n;
      tmp[y * w + x] = v;
      if (v > max) max = v;
    }
  }
  // A HARD mask with a soft edge. The first version used a gamma curve and left most of
  // the frame mid-grey, so the subject composited SEMI-TRANSPARENTLY over the mesh and the
  // whole picture went ghostly. The real artwork is an opaque player over flat triangles,
  // not a blend of the two — a mask that is mostly neither is the one thing it must not be.
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < out.length; i++) {
    const v = Math.min(1, tmp[i] / max);
    out[i] = Math.round(255 / (1 + Math.exp(-(v - pivot) * steep)));
  }
  return out;
}


/**
 * Colour quantisation and REGION SMOOTHING — the step that Kuwahara alone does not give.
 *
 * Measured against ground truth: IMG_0932-bg.png~ (the hand cut-out) and IMG_0932-bg.png
 * (the same file after the 2024 treatment), which are the input and output of the one step
 * that had been guesswork. Kuwahara at every radius and pass count produces BLOCKY,
 * axis-aligned regions — its own staircase artefact. The real artwork has large regions
 * with smooth CURVED boundaries, which is what a vector trace gives you.
 *
 * Reproduced without vectorising: quantise to a small palette, then smooth the LABELLING
 * rather than the pixels. Each label's indicator is box-blurred and every pixel takes
 * whichever label wins the vote in its neighbourhood. Blurring a partition and taking the
 * argmax rounds the staircases off into curves, and because the output is still a label
 * per pixel the fills stay perfectly flat — which blurring the colours would destroy.
 */
function quantise(rgb, w, h, k, rand, alpha) {
  const n = w * h;
  const cents = [];
  for (let i = 0; i < k; i++) {
    const p = Math.floor(rand() * n) * 3;
    cents.push([rgb[p], rgb[p + 1], rgb[p + 2]]);
  }
  const nearest = (p) => {
    let bi = 0, bd = Infinity;
    for (let c = 0; c < k; c++) {
      const dr = rgb[p] - cents[c][0], dg = rgb[p + 1] - cents[c][1], db = rgb[p + 2] - cents[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; bi = c; }
    }
    return bi;
  };
  // Fit on a subsample: k-means converges on the colour DISTRIBUTION, and reading every
  // pixel of a 4-megapixel photo twelve times over to learn eight colours is waste.
  //
  // FIT ONLY ON OPAQUE PIXELS. A cut-out is mostly matte, so fitting over the whole frame
  // spends several of the k entries describing the background and leaves the skin tones
  // sharing one — the palette comes back flat and nothing in the output says why. Same
  // shape as sampling a background palette from the faded third of a card.
  const step = Math.max(1, Math.floor(n / 60000));
  for (let iter = 0; iter < 12; iter++) {
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i += step) {
      if (alpha && alpha[i] < 128) continue;
      const p = i * 3, s = sum[nearest(p)];
      s[0] += rgb[p]; s[1] += rgb[p + 1]; s[2] += rgb[p + 2]; s[3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sum[c][3]) cents[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
    }
  }
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) labels[i] = nearest(i * 3);
  return { labels, palette: cents };
}

/** Box-blur each label's indicator and take the argmax: staircases become curves. */
function smoothLabels(labels, w, h, k, radius) {
  const n = w * h, W = w + 1;
  const sat = new Float64Array(W * (h + 1));
  const best = new Float32Array(n).fill(-1);
  const out = new Uint8Array(n);
  for (let L = 0; L < k; L++) {
    sat.fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y + 1) * W + (x + 1);
        sat[i] = (labels[y * w + x] === L ? 1 : 0) + sat[i - W] + sat[i - 1] - sat[i - W - 1];
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
        const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        const v = (sat[(y1 + 1) * W + (x1 + 1)] - sat[y0 * W + (x1 + 1)]
                 - sat[(y1 + 1) * W + x0] + sat[y0 * W + x0]) / cnt;
        const i = y * w + x;
        if (v > best[i]) { best[i] = v; out[i] = L; }
      }
    }
  }
  return out;
}

function paint(labels, palette, w, h) {
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < labels.length; i++) {
    const c = palette[labels[i]];
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
}

// ---------------------------------------------------------------------------- main

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(o.input)) throw new Error('no such input: ' + o.input);
  const { width: w, height: h } = o;
  const rand = rng(o.seed);

  const { rgb: src, alpha } = await loadRGB(o.input, w, h, o.gravity, o.fit, o.matte);

  const edge = sobel(luma(src, w, h), w, h);

  let lowpoly = null;
  if (!o.cutoutOnly) {
    const pts = samplePoints(edge, w, h, o.points, o.edgeBias, rand);
    const tris = delaunay(pts);
    lowpoly = strokeTriangles(fillTriangles(src, tris, pts, w, h), tris, pts, w, h, o.stroke);
    process.stderr.write(`  ${pts.length} vertices, ${tris.length} triangles\n`);
  }

  let subject = null;
  if (!o.lowpolyOnly) {
    // Iterated: one pass still carries the photo's noise, and posterising THAT gives
    // ragged banding rather than the clean curved borders the real artwork has.
    let k = src;
    for (let i = 0; i < o.passes; i++) k = kuwahara(k, w, h, o.radius);
    if (o.colours) {
      const q = quantise(k, w, h, o.colours, rng(o.seed), alpha);
      const labels = o.smoothRegions
        ? smoothLabels(q.labels, w, h, o.colours, o.smoothRegions)
        : q.labels;
      k = paint(labels, q.palette, w, h);
    }
    subject = posterize(k, o.levels);
  }

  const raw = { raw: { width: w, height: h, channels: 3 } };
  let base;

  if (o.cutoutOnly) {
    base = sharp(subject, raw);
    // Put the cut-out's own transparency back. Without this, polymerising a hand-cut
    // subject returns an opaque rectangle and the separated-asset workflow falls over.
    if (alpha) base = base.joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } });
  } else if (o.lowpolyOnly || (!o.mask && !o.autoMask)) {
    base = sharp(lowpoly, raw);
    if (o.saturate !== 1 || o.hue !== 0) base = base.modulate({ saturation: o.saturate, hue: o.hue });
  } else {
    // Background gets the colour treatment; the subject must NOT, or the player's skin
    // goes the same lurid colour as the mesh and the whole thing reads as one flat poster.
    let bg = sharp(lowpoly, raw);
    if (o.saturate !== 1 || o.hue !== 0) bg = bg.modulate({ saturation: o.saturate, hue: o.hue });
    const bgPng = await bg.png().toBuffer();

    const maskRaw = o.mask
      ? await sharp(o.mask).resize(w, h, { fit: 'cover', position: o.gravity })
          .toColourspace('b-w').raw().toBuffer()
      : autoMask(edge, w, h, o.autoMaskRadius, o.autoMaskPivot, o.autoMaskSteep);

    // NO ensureAlpha here: subject is 3-channel and joinChannel supplies the 4th.
    // Doing both makes a five-channel image. White in the mask keeps the subject.
    const cut = await sharp(subject, raw)
      .joinChannel(maskRaw, { raw: { width: w, height: h, channels: 1 } })
      .png()
      .toBuffer();

    base = sharp(bgPng).composite([{ input: cut, blend: 'over' }]);
  }

  await base.png().toFile(o.output);
  process.stderr.write(`  wrote ${o.output}\n`);
}

if (require.main === module) {
  main().catch(e => { process.stderr.write('polyart: ' + e.message + '\n'); process.exit(1); });
}

// Exported so the background generator can share the mesh code rather than copy it.
module.exports = { rng, luma, sobel, samplePoints, delaunay, fillTriangles, strokeTriangles, kuwahara };
