#!/usr/bin/env node
'use strict';

/**
 * compose.js — put a cut-out subject onto a background.
 *
 * This is the ONLY one of the three that is cheap enough to run per request, and the split
 * is deliberate. Making the assets is expensive and needs a human to look at the result;
 * putting two finished PNGs together is a resize and a composite.
 *
 *   polyart.js    photo -> polymerised subject     ~1s    once, offline, needs a cut-out
 *   lowpolybg.js  nothing -> background            ~130ms once per background, offline
 *   compose.js    subject + background -> card     ~40ms  per request, safely
 *
 * WHY THE BACKGROUND IS NOT GENERATED PER REQUEST, even though 130ms would nearly fit:
 * the generator is random. Generating at render time means the first person to see a given
 * background is the public, on a post that has already gone out — and a bad seed is a
 * genuinely bad picture, not a slightly-off one. The existing weekly posts are already
 * built on the rule that the images are the deliverable and a test cannot prove one looks
 * right (HARD-37). So: generate a handful, look at them, keep the good ones, compose those.
 *
 * Usage:
 *   node tools/artwork/compose.js bg.png subject.png out.png [options]
 *
 *   --width N --height N   output size            (default 1080x1350)
 *   --scale 0..1           subject height as a fraction of the card (default 0.78)
 *   --x 0..1               where the subject's CENTRE sits across   (default 0.62)
 *   --y 0..1               where the subject's FEET sit down the card (default 0.93)
 */

const sharp = require('sharp');

/**
 * Returns a PNG buffer. Exported so a route can call it directly rather than shelling out.
 *
 * `y` anchors the BOTTOM of the subject, not its centre, because a player stands on
 * something: anchoring the centre means every subject of a different height floats at a
 * different distance off the foot of the card.
 */
async function compose(backgroundPath, subjectPath, opts = {}) {
  const width = opts.width || 1080;
  const height = opts.height || 1350;
  const scale = opts.scale == null ? 0.78 : opts.scale;
  const x = opts.x == null ? 0.62 : opts.x;
  const y = opts.y == null ? 0.93 : opts.y;

  const targetH = Math.round(height * scale);
  // RAW, not .png(). Encoding the resized subject to PNG only to have sharp decode it
  // again on the next line cost about 30ms of the 77 this function used to take, for a
  // buffer that never leaves the process.
  const subj = await sharp(subjectPath)
    .rotate()
    .resize({ height: targetH, fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sw = subj.info.width, sh = subj.info.height;
  // Clamped, so a scale/x/y combination that would hang the subject off the edge pins it
  // to the edge instead of making sharp throw about a negative offset.
  const left = Math.max(0, Math.min(width - sw, Math.round(x * width - sw / 2)));
  const top = Math.max(0, Math.min(height - sh, Math.round(y * height - sh)));

  // Returns the PIPELINE, so a caller that wants to draw text on top and encode once can
  // do so without a round trip through an encoded image.
  return sharp(backgroundPath)
    .rotate()
    .resize(width, height, { fit: 'cover' })
    .composite([{
      input: subj.data, left, top,
      raw: { width: sw, height: sh, channels: subj.info.channels },
    }]);
}

/** The buffer form, for callers that just want the picture. */
async function composeToPng(backgroundPath, subjectPath, opts = {}) {
  return (await compose(backgroundPath, subjectPath, opts)).png().toBuffer();
}

async function main() {
  const argv = process.argv.slice(2);
  const o = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--width') o.width = +argv[++i];
    else if (a === '--height') o.height = +argv[++i];
    else if (a === '--scale') o.scale = +argv[++i];
    else if (a === '--x') o.x = +argv[++i];
    else if (a === '--y') o.y = +argv[++i];
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else rest.push(a);
  }
  if (rest.length < 3) throw new Error('usage: compose.js <bg.png> <subject.png> <out.png> [options]');
  const t = Date.now();
  const buf = await composeToPng(rest[0], rest[1], o);
  require('fs').writeFileSync(rest[2], buf);
  process.stderr.write(`  composed in ${Date.now() - t}ms -> ${rest[2]}\n`);
}

if (require.main === module) {
  main().catch(e => { process.stderr.write('compose: ' + e.message + '\n'); process.exit(1); });
}

module.exports = { compose, composeToPng };
