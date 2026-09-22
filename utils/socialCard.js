'use strict';

/**
 * The pieces every social card is drawn from.
 *
 * Shared because the fixtures card and the result card are posts about the same league and
 * had drifted into two unrelated layouts — one with a dark panel and the league's name, the
 * other writing black text into the corner of the artwork. They now take their background,
 * their panel and their division letter from here.
 *
 * HARD-37. The division backgrounds used to carry two layout decisions in their pixels: a
 * fade to near-white across the bottom third, and the division's letter. Both are now drawn
 * at render time instead, which is the whole point of the clean artwork:
 *
 *   - **the letter can move, resize or be left off.** A card that already names the division
 *     in words does not want it, and the fixtures card was printing the same information
 *     twice a few hundred pixels apart because the artwork gave it no choice;
 *   - **the panel is opt-in.** Legibility is a property of one background against one block
 *     of text, so it has to be a decision the renderer takes per card — not a fade every
 *     background carries whether that card needs one or not.
 */

const fs = require('fs').promises;
const sharp = require('sharp');

const LEAGUE_NAME = 'Stockport & District Badminton League';
const SITE_HOST = 'stockport-badminton.co.uk';

const CLEAN_DIR = 'static/beta/images/bg/divisions';
const SUBJECT_DIR = 'static/beta/images/bg/divisions/subjects';
const LEGACY_DIR = 'static/beta/images/bg';
const PLAIN_BACKGROUND = 'static/beta/images/bg/social.png';

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One `<text>`. `spacing` is what makes an all-caps line read as a label rather than a shout. */
function text(value, x, y, size, opts = {}) {
  const { weight = 'normal', fill = '#000', anchor = 'middle', spacing = 0, opacity = 1 } = opts;
  return `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" font-weight="${weight}"` +
         ` fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}" opacity="${opacity}">${escapeXml(value)}</text>`;
}

// A DARK panel at 0.80, and that is the second attempt. A white one was tried at 0.93, 0.97
// and 1.0: to be legible it has to be near-opaque, and at that point the artwork underneath
// may as well not be there, which defeats the only reason for using artwork. Do not answer a
// legibility complaint by raising this — that is the road back to a white rectangle with a
// picture behind it.
const PANEL_FILL = '#0d0d0f';
const PANEL_OPACITY = 0.80;

function panel({ x, y, width, height, radius = 34, fill = PANEL_FILL, opacity = PANEL_OPACITY }) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"` +
         ` fill="${fill}" opacity="${opacity}"/>`;
}

/**
 * The single character that stood for a division in the 2024 artwork: P, 1, 2, 3.
 *
 * Returns null for anything else — the Messer knockout, a friendly, a renamed division —
 * because a card for those should simply not draw one. Guessing a letter from an unknown
 * name is how you print "M" on a card nobody expected to have a marker at all.
 */
function divisionLetter(divisionName) {
  const name = String(divisionName || '').trim();
  if (/^premier$/i.test(name)) return 'P';
  const m = name.match(/^division\s+(\d+)$/i);
  return m ? m[1] : null;
}

/**
 * The big letter, top-left, as the artwork used to have it — drawn, so a layout can move it.
 *
 * Dark and semi-transparent rather than a solid colour: it sits directly on the artwork with
 * no panel behind it, and the backgrounds are bright. It reads as a watermark, which is what
 * the baked-in one did.
 */
// An SVG `y` is the BASELINE, not the top of the glyph, so a caller thinking in "distance
// from the top of the card" loses the whole cap height — about 0.72 of the font size — off
// the top of the frame. `top` is therefore what callers give, and the baseline is derived.
const CAP_HEIGHT = 0.72;

function glyph(letter, { x = 78, top = 34, size = 300, fill = '#0d0d0f', opacity = 0.42 } = {}) {
  if (!letter) return '';
  return text(letter, x, Math.round(top + size * CAP_HEIGHT), size,
    { weight: 'bold', fill, anchor: 'start', opacity });
}

/**
 * Which artwork a division's card is drawn on.
 *
 * Three steps, and the middle one is why this is not a one-liner. The clean backgrounds
 * (HARD-37) are preferred; the 2024 files are still there and still used for any division
 * that has no clean version, because they are what shipped and a missing file must not
 * become a 500 on a route Meta is fetching; and the plain grey background catches everything
 * else.
 *
 * Exported and tested on the PATH CHOSEN rather than the rendered bytes. Comparing two
 * rendered cards proves nothing here: the division name is printed on the picture, so two
 * divisions differ in bytes whether or not their backgrounds do, and a test that compared
 * them passed happily against a version using one background for everything.
 */
async function backgroundFor(divisionName) {
  const slug = String(divisionName).trim().replace(/\s+/g, '-');
  for (const candidate of [`${CLEAN_DIR}/${slug}.png`, `${LEGACY_DIR}/social-${slug}.png`]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* try the next one */ }
  }
  return PLAIN_BACKGROUND;
}

/**
 * The player.
 *
 * This is the layer the whole de-identification exercise was FOR. The 2024 cards are a
 * background with a player composited onto it, and taking the player out leaves a coloured
 * mesh with a box of text on it — which is what the first pass at HARD-37 shipped, because
 * separating the layers made it easy to forget to put one of them back.
 *
 * The files are the polymerised cut-outs: abstracted so the individual is not identifiable,
 * which is the point of the treatment and not a stylistic choice. See
 * tools/artwork/polyart.js before regenerating one.
 *
 * Returns null for a division with no subject, and the card then draws without one — a
 * friendly or a renamed division must still render, on a route Meta is fetching.
 */
async function subjectFor(divisionName) {
  const slug = String(divisionName).trim().replace(/\s+/g, '-');
  const candidate = `${SUBJECT_DIR}/${slug}.png`;
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * A sharp composite entry for the player, scaled and placed.
 *
 * `bottom` anchors the FEET rather than the centre, because a player stands on something:
 * anchoring the middle leaves every subject of a different aspect floating at a different
 * height off the foot of the card. `maxWidth` matters more than it looks — Division 1's
 * subject is a PAIR of players and is nearly twice as wide as it is tall, so a height-only
 * fit would run it off both edges.
 */
async function subjectLayer(subjectPath, opts = {}) {
  // Defaults sized for a card whose panel starts at 0.56H: the player fills the space above
  // it and their feet run a little way behind the panel's top edge, which is what the 2024
  // fade did to the legs. Fractions rather than pixels, so the same numbers place the
  // subject correctly at 1080x1350 and at 1080x1920.
  const { W, H, height = 0.74, x = 0.60, bottom = 0.79, maxWidth = 1.0 } = opts;
  const targetH = Math.round(H * height);
  const { data, info } = await sharp(subjectPath)
    .resize({
      height: targetH,
      width: Math.round(W * maxWidth),
      fit: 'inside',
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // A WIDE subject comes out short, and a short subject anchored by its feet sinks.
  //
  // Division 1's is a PAIR of players — 1.71:1, where the others are about 0.43:1 — so
  // `fit: inside` sizes it by WIDTH and it lands at roughly 0.47H instead of 0.74H. Anchored
  // at the same `bottom` as a full-height player that puts it in the bottom third, which on
  // the result card is behind the panel: the one division whose artwork has two players in
  // it was the one where you could not see them.
  //
  // So a subject that misses its target height is lifted by most of the shortfall, which
  // leaves it sitting in the open space above the panel instead of on the floor. Most, not
  // all: a little sink keeps it anchored to the foot of the card rather than floating in the
  // middle of it.
  const lift = Math.round(Math.max(0, targetH - info.height) * 0.55);

  return {
    input: data,
    raw: { width: info.width, height: info.height, channels: info.channels },
    left: clamp(Math.round(x * W - info.width / 2), 0, Math.max(0, W - info.width)),
    top: clamp(Math.round(bottom * H - info.height) - lift, 0, Math.max(0, H - info.height)),
  };
}

module.exports = {
  LEAGUE_NAME, SITE_HOST,
  CLEAN_DIR, LEGACY_DIR, SUBJECT_DIR, PLAIN_BACKGROUND,
  PANEL_FILL, PANEL_OPACITY,
  escapeXml, text, panel, divisionLetter, glyph, backgroundFor, subjectFor, subjectLayer,
};
