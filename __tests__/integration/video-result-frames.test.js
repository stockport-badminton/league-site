// The weekly video's frames.
//
// This file exists because the video used to carry its OWN copy of the result card — its
// own svgOverlay, its own escaping, its own background lookup and black text written into
// the bottom-right corner. That copy was invisible to every change made to the real card,
// so HARD-37 could redraw the result post and leave the video posting the 2024 design on
// artwork that no longer fades to white underneath it. Nothing would have failed; the video
// would simply have gone out with unreadable frames.
//
// So the assertions here are about the two properties a duplicate would break: the frames
// are legible, and no result is silently missing from them.

process.env.NODE_ENV = 'test';

const fs = require('fs').promises;
const sharp = require('sharp');
const video = require('../../controllers/socialVideoController');

const W = 1080, H = 1350;
const PANEL_TOP = 0.66, PANEL_BOTTOM = 0.94;
const panelRegion = {
  left: 56,
  top: Math.round(H * PANEL_TOP),
  width: W - 112,
  height: Math.round(H * PANEL_BOTTOM) - Math.round(H * PANEL_TOP),
};

const toLinear = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const relLuminance = ({ r, g, b }) =>
  0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);

// Materialised before stats(): sharp computes statistics from the INPUT image and ignores
// the pipeline, so extract().stats() silently returns whole-image means.
async function meanOf(file, region) {
  const cropped = await sharp(file).extract(region).toBuffer();
  const { channels } = await sharp(cropped).stats();
  return { r: channels[0].mean, g: channels[1].mean, b: channels[2].mean };
}

const fixture = (homeTeam, awayTeam, division) =>
  ({ homeTeam, awayTeam, division, homeScore: 12, awayScore: 6 });

describe('the weekly video frames', () => {
  it('draws one frame per result', async () => {
    const images = await video.generateResultImages([
      fixture('Tatton A', 'Mellor B', 'Premier'),
      fixture('Shell A', 'Manor C', 'Division 2'),
    ]);
    expect(images).toHaveLength(2);
    for (const f of images) await expect(fs.access(f)).resolves.toBeUndefined();
  });

  // A division with no CLEAN artwork still renders, on the fallback. Division 4 has 2024
  // artwork and no clean version, so this is exercised by real files rather than a mock —
  // and it is the case a new or renamed division would land in.
  it('renders a division that has no clean artwork of its own', async () => {
    const images = await video.generateResultImages([
      fixture('Tatton A', 'Mellor B', 'Division 4'),
    ]);
    expect(images).toHaveLength(1);
  });

  // ...but a fixture with NO division is skipped, and this is the important one.
  //
  // `division` comes from a LEFT JOIN through the home team and is null whenever that team
  // has none: 1,318 completed fixtures, six of them in 2026. The old code skipped these by
  // accident, because `division.replace(...)` threw. Replacing that with a lookup that
  // always answers rendered a card reading "null" in 68px white type and published it.
  it.each([null, undefined, '', '   '])
    ('skips a fixture whose division is %p rather than printing it', async division => {
      const images = await video.generateResultImages([
        fixture('Tatton A', 'Mellor B', division),
      ]);
      expect(images).toEqual([]);
    });

  // The property a duplicated renderer would have lost: text drawn on something dark
  // enough to read. The old copy wrote black text where the artwork used to fade white.
  it('renders frames with enough contrast to read', async () => {
    const [frame] = await video.generateResultImages([
      fixture('Tatton A', 'Mellor B', 'Premier'),
    ]);
    const contrast = 1.05 / (relLuminance(await meanOf(frame, panelRegion)) + 0.05);
    expect(contrast).toBeGreaterThan(4.5);
  });

  // The frames are the post's card at the post's size, not a second layout that happens to
  // look similar.
  it('renders at the card size', async () => {
    const [frame] = await video.generateResultImages([
      fixture('Tatton A', 'Mellor B', 'Premier'),
    ]);
    const meta = await sharp(frame).metadata();
    expect([meta.width, meta.height]).toEqual([W, H]);
  });
});

// A guard, because the failure this file is about is a COPY quietly drifting rather than
// anything throwing. If a second card renderer reappears in the video controller, the
// contrast assertions above will keep passing against it right up until somebody changes
// the real card and not the copy.
describe('the video controller does not reimplement the card', () => {
  const fsSync = require('fs');
  const source = fsSync.readFileSync(
    require.resolve('../../controllers/socialVideoController'), 'utf8');

  // Comments mention the old copy by name on purpose, so they are stripped first.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('builds no SVG of its own', () => {
    expect(code).not.toMatch(/<svg/);
    expect(code).not.toMatch(/svgOverlay\s*=/);
  });

  it('does not resolve division artwork by hand', () => {
    expect(code).not.toMatch(/images\/bg\/social-/);
  });

  it('uses the shared renderer', () => {
    expect(code).toMatch(/createResultCard/);
  });
});
