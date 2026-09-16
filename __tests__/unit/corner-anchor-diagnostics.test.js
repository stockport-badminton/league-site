// When the scorecard reader cannot line a card up, it must say WHY.
//
// On 16 Sep 2026 a captain's first two photos of a card failed and the third worked. All
// three logged the same sentence:
//
//     Scorecard analysis failed: Missing corner anchors: DATE
//
// That sentence conflates two failures which want opposite responses:
//
//   - the words are not on the card at all — glare, a crease, a cropped photo, an older
//     version of the form. Nothing we can tune, and the captain's own retry is the fix;
//   - the text IS there and we refused it for sitting in the wrong part of the frame.
//     That is our threshold being wrong, and no amount of retaking will help.
//
// Telling those apart after the event meant re-running the whole pipeline by hand against
// a stored image which had, by definition, succeeded — the failing uploads are discarded.
// It cost an hour and still did not settle it.
//
// So the tests below are about the diagnostic, not the detection. They run on synthetic
// text blocks: no Vision call, no photograph, and no dependency on what Google returns
// today, which is not stable — the same image gave 185, 186 and 187 words on three
// consecutive runs.

const {
  findAnchors, describeMissing, CORNER_ANCHORS, REQUIRED_ANCHORS,
} = require('../../controllers/cornerDetection');

const IMG_W = 1000;
const IMG_H = 1000;

// A word as the OCR layer hands it over: normalised position in, pixel bounds out.
function word(text, nx, ny, w = 0.05, h = 0.02) {
  const x = nx * IMG_W, y = ny * IMG_H, pw = w * IMG_W, ph = h * IMG_H;
  return {
    text,
    bounds: [
      { x: x - pw / 2, y: y - ph / 2 }, { x: x + pw / 2, y: y - ph / 2 },
      { x: x + pw / 2, y: y + ph / 2 }, { x: x - pw / 2, y: y + ph / 2 },
    ],
    confidence: 0.9,
    centerX: x, centerY: y, width: pw, height: ph,
  };
}

// Every anchor in a plausible place, so a test can remove exactly one thing.
const goodCard = () => [
  word('Stockport', 0.2, 0.10),
  word('League', 0.7, 0.10),
  word('DATE', 0.2, 0.26),
  word('WON', 0.75, 0.30), word('BY', 0.80, 0.30),
  word('Please', 0.5, 0.90),
  word('Rule', 0.70, 0.92), word('18', 0.75, 0.92),
  word('Signature', 0.3, 0.80),
];

describe('a card where everything is where it should be', () => {
  it('finds every required anchor and reports no diagnostics', () => {
    const { found, diagnostics } = findAnchors(goodCard(), IMG_W, IMG_H);
    expect(REQUIRED_ANCHORS.filter(a => !found[a])).toEqual([]);
    expect(diagnostics).toEqual({});
  });
});

describe('an anchor whose text is not on the card at all', () => {
  it('says so, rather than just naming the anchor', () => {
    const blocks = goodCard().filter(b => b.text !== 'DATE');
    const { found, diagnostics } = findAnchors(blocks, IMG_W, IMG_H);

    expect(found.DATE).toBeUndefined();
    expect(diagnostics.DATE).toEqual({ reason: 'no-text-matched' });
    expect(describeMissing(diagnostics, ['DATE'])).toBe('DATE=not-on-card');
  });
});

describe('an anchor that is present but out of bounds', () => {
  // The case that is ours to fix rather than the captain's, and the one the old message
  // could not distinguish.
  it('reports where it actually was, and the bound it broke', () => {
    const blocks = goodCard().map(b => (b.text === 'DATE' ? word('DATE', 0.2, 0.62) : b));
    const { found, diagnostics } = findAnchors(blocks, IMG_W, IMG_H);

    expect(found.DATE).toBeUndefined();
    expect(diagnostics.DATE).toMatchObject({
      reason: 'outside-search-area',
      text: 'DATE',
      at: { x: 0.2, y: 0.62 },
    });

    const line = describeMissing(diagnostics, ['DATE']);
    expect(line).toContain('"DATE"');
    expect(line).toContain('(0.2,0.62)');
    expect(line).toContain('yMax=0.45');   // the number to compare 0.62 against
  });

  it('describes several missing anchors in one line, each with its own reason', () => {
    const blocks = goodCard()
      .filter(b => b.text !== 'Signature')
      .map(b => (b.text === 'DATE' ? word('DATE', 0.2, 0.62) : b));
    const { diagnostics } = findAnchors(blocks, IMG_W, IMG_H);
    const line = describeMissing(diagnostics, ['DATE', 'SIGNATURE']);

    expect(line).toMatch(/DATE=?"?DATE"?@?\(0\.2,0\.62\)/);
    expect(line).toContain('SIGNATURE=not-on-card');
  });
});

describe('the DATE band, widened 16 Sep 2026', () => {
  // It was 0.3, and on a real photograph that PASSED, DATE sat at 0.267 — 0.033 of
  // headroom where STOCKPORT had 0.125, LEAGUE 0.157 and SIGNATURE 0.170. Structural
  // rather than unlucky: `DATE:` is printed below the title block, so of the three anchors
  // sharing the top band it is always the lowest.
  it('accepts a DATE further down the frame than the old bound allowed', () => {
    expect(CORNER_ANCHORS.DATE.searchArea.yMax).toBe(0.45);

    const blocks = goodCard().map(b => (b.text === 'DATE' ? word('DATE', 0.2, 0.35) : b));
    const { found } = findAnchors(blocks, IMG_W, IMG_H);
    expect(found.DATE).toBeDefined();          // 0.35 was outside the old 0.3
  });

  it('still has a bound — a DATE in the bottom half is not the printed label', () => {
    const blocks = goodCard().map(b => (b.text === 'DATE' ? word('DATE', 0.2, 0.80) : b));
    const { found } = findAnchors(blocks, IMG_W, IMG_H);
    expect(found.DATE).toBeUndefined();
  });

  // Widening is only safe because there is exactly one thing on the card matching the
  // pattern — verified against the full OCR output of a real card. If a second ever
  // appears, the wider band is what lets the wrong one be picked, and `.find()` takes
  // whichever comes first.
  it('picks the first match, so a second one in range would be ambiguous', () => {
    const blocks = [word('DATE', 0.2, 0.26), word('DATE', 0.6, 0.40), ...goodCard().filter(b => b.text !== 'DATE')];
    const { found } = findAnchors(blocks, IMG_W, IMG_H);
    expect(found.DATE.centerY / IMG_H).toBeCloseTo(0.26);
  });
});
