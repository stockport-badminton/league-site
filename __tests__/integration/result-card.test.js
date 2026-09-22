// The result card, redrawn for HARD-37.
//
// This file exists because of the specific way the old card would have broken. It wrote
// BLACK text into the bottom-right corner, and that was only legible because the 2024
// artwork faded to near-white exactly there. The clean backgrounds have no fade — so
// swapping the artwork underneath the old layout produces a card that renders perfectly,
// returns 200, is a valid JPEG of the right size, and cannot be read.
//
// Every assertion available at the time would have passed. So the test here is not "did a
// JPEG come out"; it is **is there enough contrast under the text to read it**, measured
// off the rendered pixels.

process.env.NODE_ENV = 'test';

const sharp = require('sharp');
const social = require('../../controllers/socialController');
const { divisionLetter } = require('../../utils/socialCard');

const W = 1080, H = 1350;
// The panel, as createResultCard lays it out: x 56, width 968, y from 0.66H to 0.94H. It
// is a shallow band across the foot of the card, not a box filling the frame — the player
// is composited above it and needs the room.
const PANEL_TOP = 0.66;
const PANEL_BOTTOM = 0.94;
const panelRegion = (w, h) => ({
  left: 56,
  top: Math.round(h * PANEL_TOP),
  width: w - 112,
  height: Math.round(h * PANEL_BOTTOM) - Math.round(h * PANEL_TOP),
});

// WCAG relative luminance, so the assertion states the requirement rather than a number
// somebody would later "fix" by nudging.
const toLinear = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const relLuminance = ({ r, g, b }) =>
  0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
const contrastWithWhite = rgb => 1.05 / (relLuminance(rgb) + 0.05);

// The extract is materialised to a buffer BEFORE stats(), and that is not a style choice.
// `sharp(buf).extract(region).stats()` computes statistics from the INPUT image and ignores
// everything queued in the pipeline, so it silently returns whole-image means — every
// region of the card reads identically. It fooled an earlier version of this file: the
// panel then covered 74% of the frame, so whole-image means really did differ between card
// and background, and the assertions passed while measuring the wrong thing entirely. It
// only surfaced when the panel shrank to a band across the foot and the difference vanished.
async function meanOf(buf, region) {
  const cropped = await sharp(buf).extract(region).toBuffer();
  const { channels } = await sharp(cropped).stats();
  return { r: channels[0].mean, g: channels[1].mean, b: channels[2].mean };
}

const MATCH = {
  division: 'Premier', homeTeam: 'Tatton A', awayTeam: 'Mellor B',
  homeScore: 12, awayScore: 6,
};

const render = async (division = 'Premier', opts = {}, w = W, h = H) => {
  const bg = await social.fixturesBackground(division);
  const accent = await social.accentFor(bg);
  return social.createResultCard(bg, { ...MATCH, division }, w, h, accent, opts);
};

const DIVISIONS = ['Premier', 'Division 1', 'Division 2', 'Division 3'];

describe('the result card', () => {
  it('renders a JPEG at the post size', async () => {
    const meta = await sharp(await render()).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([W, H]);
  });

  // The one that matters. White text on the panel has to clear WCAG AA for large text
  // (3:1); it comfortably clears the 4.5:1 body-text bar, so that is what is asserted.
  // Remove the panel from createResultCard and this fails on every division.
  it.each(DIVISIONS)('puts enough contrast under the text to read it: %s', async division => {
    const card = await render(division);
    const contrast = contrastWithWhite(await meanOf(card, panelRegion(W, H)));
    expect(contrast).toBeGreaterThan(4.5);
  });

  // ...and specifically that the contrast comes from something DRAWN, not from the artwork
  // happening to be dark. The 2024 fade would satisfy an absolute threshold while the clean
  // artwork does not, which is the whole failure this file is about.
  it.each(DIVISIONS)('darkens the artwork rather than relying on it: %s', async division => {
    const bg = await social.fixturesBackground(division);
    const bare = await sharp(bg).resize(W, H, { fit: 'cover' }).jpeg().toBuffer();
    const region = panelRegion(W, H);

    const lit = relLuminance(await meanOf(bare, region));
    const drawn = relLuminance(await meanOf(await render(division), region));

    expect(drawn).toBeLessThan(lit * 0.7);
  });

  it('holds the same contrast in the 1080x1920 story size', async () => {
    const card = await render('Premier', {}, 1080, 1920);
    const meta = await sharp(card).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);

    const contrast = contrastWithWhite(await meanOf(card, panelRegion(1080, 1920)));
    expect(contrast).toBeGreaterThan(4.5);
  });
});

describe('the division letter', () => {
  // Drawn at render time rather than baked into the artwork — the point of HARD-37. A card
  // that names its division in words does not ask for one, so it is off by default.
  it('is not drawn unless the caller asks', async () => {
    const without = await render('Premier');
    const with_ = await render('Premier', { letter: 'P' });
    expect(Buffer.compare(without, with_)).not.toBe(0);
  });

  it.each([
    ['Premier', 'P'],
    ['Division 1', '1'],
    ['Division 3', '3'],
  ])('%s is marked %s', (name, letter) => {
    expect(divisionLetter(name)).toBe(letter);
  });

  // Guessing a letter for a name that never had one is how "M" ends up on a Messer card.
  it.each(['Messer Knockout', 'Handicap', '', null, undefined])
    ('draws nothing for %s', name => expect(divisionLetter(name)).toBeNull());
});

// Every team name goes into an SVG, and this league has a club called G.H.A.P and another
// with an apostrophe. A name carrying XML metacharacters must not be able to break the
// document — sharp rejects malformed SVG outright, so a broken escape is a 500 on the route
// Meta fetches rather than a cosmetic problem.
describe('team names are escaped into the SVG', () => {
  it.each([
    '<script>alert(1)</script>',
    'Mulberry\'s & Sons',
    'Tatton "A"',
    'A < B > C',
  ])('renders with a name containing %s', async name => {
    const bg = await social.fixturesBackground('Premier');
    const accent = await social.accentFor(bg);
    const card = await social.createResultCard(
      bg, { ...MATCH, homeTeam: name, awayTeam: name }, W, H, accent);
    expect((await sharp(card).metadata()).format).toBe('jpeg');
  });
});
