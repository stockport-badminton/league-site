// Perspective correction via coordinate transform.
// Detects 7 fixed-text anchors on the scorecard, computes a homography from
// the inferred quadrilateral corners to a destination rectangle, then applies
// that transform to the text-block coordinates — no image warping, no opencv.

const vision = require('@google-cloud/vision');
const sharp  = require('sharp');

const visionClient = new vision.ImageAnnotatorClient();

// ── Corner anchors (fixed printed text on the scorecard template) ─────────────

const CORNER_ANCHORS = {
  // yMax was 0.3 until 16 Sep 2026, and DATE was by a distance the tightest anchor on the
  // card: measured on a real photograph that PASSED, it sat at y=0.267 against that 0.3
  // bound — 0.033 of headroom, where STOCKPORT had 0.125, LEAGUE 0.157 and SIGNATURE 0.170.
  //
  // That is structural rather than bad luck. `DATE:` is printed below the title block, so
  // of the three anchors sharing the top band it is always the lowest, and `autoRotate`
  // grows the canvas by about a quarter with white padding on a sideways photo — so the
  // bound is measured against a padded frame rather than against the card.
  //
  // 0.45 costs nothing: exactly one word on the card matches this pattern, checked against
  // the full OCR output, so a wider band cannot pick the wrong thing. It is insurance on
  // the one anchor that had none, not a fix for a diagnosed failure — see the note on
  // findAnchors for why that morning's failure could not be diagnosed at all.
  DATE:      { pattern: /DATE\s*/i,       searchArea: { yMin: 0, yMax: 0.45 } },
  SIGNATURE: { pattern: /^Signature$/i,   searchArea: { yMin: 0.6, yMax: 1 } },
  STOCKPORT: { pattern: /^Stockport$/i,   searchArea: { yMin: 0, yMax: 0.3 } },
  LEAGUE:    { pattern: /^League$/i,      searchArea: { yMin: 0, yMax: 0.3, xMin: 0.5, xMax: 1 } },
  WON_BY:    { pattern: /WON\s+BY/i,     searchArea: { yMin: 0.1, yMax: 0.5, xMin: 0.6, xMax: 1 }, multiWord: true },
  RULE18:    { pattern: /Rule\s+18/i,     searchArea: { yMin: 0, yMax: 1 }, multiWord: true },
  PLEASE:    { pattern: /Please/i,        searchArea: { yMin: 0, yMax: 1 } },
};

const REQUIRED_ANCHORS = ['DATE', 'SIGNATURE', 'STOCKPORT', 'LEAGUE', 'WON_BY', 'RULE18', 'PLEASE'];

// ── Anchor search helpers ─────────────────────────────────────────────────────

function inSearchArea(block, area, imgW, imgH) {
  if (!area) return true;
  const ny = block.centerY / imgH;
  const nx = block.centerX / imgW;
  return (area.yMin === undefined || ny >= area.yMin)
      && (area.yMax === undefined || ny <= area.yMax)
      && (area.xMin === undefined || nx >= area.xMin)
      && (area.xMax === undefined || nx <= area.xMax);
}

function findMultiWordAnchor(blocks, anchor) {
  const WORD_SPACING = 150;
  const Y_TOL = 50;
  const candidates = blocks.filter(b => ['WON','BY','Rule','18'].includes(b.text));
  const sorted = [...candidates].sort((a, b) =>
    Math.abs(a.centerY - b.centerY) < Y_TOL ? a.centerX - b.centerX : a.centerY - b.centerY
  );
  for (let i = 0; i < sorted.length; i++) {
    let combined = sorted[i].text;
    let parts = [sorted[i]];
    let cur = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const nxt = sorted[j];
      const sameLine = Math.abs(nxt.centerY - cur.centerY) < Y_TOL;
      const gap = nxt.bounds[0].x - cur.bounds[1].x;
      if (sameLine && gap >= 0 && gap < WORD_SPACING) {
        combined += ' ' + nxt.text;
        parts.push(nxt);
        cur = nxt;
        if (anchor.pattern.test(combined)) {
          const first = parts[0], last = parts[parts.length - 1];
          return {
            text: combined,
            bounds: { 0: first.bounds[0], 1: last.bounds[1], 2: last.bounds[2], 3: first.bounds[3] },
            confidence: parts.reduce((s, b) => s + b.confidence, 0) / parts.length,
            centerX: (first.centerX + last.centerX) / 2,
            centerY: (first.centerY + last.centerY) / 2,
            width: last.bounds[1].x - first.bounds[0].x,
            height: last.bounds[2].y - first.bounds[0].y,
          };
        }
      } else { break; }
    }
  }
  return null;
}

// Look for one anchor among the blocks it is allowed to be in.
function matchIn(blocks, anchor) {
  return anchor.multiWord
    ? findMultiWordAnchor(blocks, anchor)
    : blocks.find(b => anchor.pattern.test(b.text) && b.text.length <= 20) || null;
}

/**
 * Locate every corner anchor, and say WHY each missing one is missing.
 *
 * The diagnostics half exists because "Missing corner anchors: DATE" is not enough to act
 * on. It conflates two failures that want opposite fixes:
 *
 *   no-text-matched     the words are not on the card at all — a bad photo, glare, a
 *                       crease, or an older version of the form. Nothing we can tune.
 *   outside-search-area the text IS there and we refused it for being in the wrong part of
 *                       the frame. That is our threshold being wrong, not the photo.
 *
 * On 16 Sep 2026 a captain's first two photos failed on DATE and the third worked, and
 * telling those two cases apart afterwards meant re-running the whole pipeline by hand
 * against a stored image that had, by definition, succeeded. The position is recorded
 * normalised (0-1) so it can be read straight against the search area beside it.
 */
function findAnchors(textBlocks, imgW, imgH) {
  const found = {};
  const diagnostics = {};

  for (const [name, anchor] of Object.entries(CORNER_ANCHORS)) {
    const inArea = textBlocks.filter(b => inSearchArea(b, anchor.searchArea, imgW, imgH));
    const m = matchIn(inArea, anchor);
    if (m) { found[name] = m; continue; }

    // Missing. Ask the cheaper question: is the text anywhere on the card at all?
    const anywhere = matchIn(textBlocks, anchor);
    diagnostics[name] = anywhere
      ? {
          reason: 'outside-search-area',
          text: anywhere.text,
          at: { x: +(anywhere.centerX / imgW).toFixed(3), y: +(anywhere.centerY / imgH).toFixed(3) },
          searchArea: anchor.searchArea,
        }
      : { reason: 'no-text-matched' };
  }

  return { found, diagnostics };
}

// One line per missing anchor, for the log. Deliberately terse: this ends up in Cloud
// Logging next to the request, where the useful thing is a number to compare with a bound.
function describeMissing(diagnostics, missing) {
  return missing.map(name => {
    const d = diagnostics[name];
    if (!d) return name;
    if (d.reason === 'no-text-matched') return `${name}=not-on-card`;
    const a = d.searchArea || {};
    const bounds = ['yMin', 'yMax', 'xMin', 'xMax']
      .filter(k => a[k] !== undefined).map(k => `${k}=${a[k]}`).join(',');
    return `${name}="${d.text}"@(${d.at.x},${d.at.y}) outside[${bounds}]`;
  }).join(' ');
}

// ── Cards the reader cannot line up, and knows it cannot ─────────────────────
//
// Two kinds of card come in that will never have the anchors, however they are
// photographed, and the generic message sends a captain the wrong way for both: it leads
// with "cropped or taken at an angle", so they retake the photo, fail identically, and
// give up. Measured over Sep 2026, these two were the only corner-anchor failures there
// were.
//
//   monkhouse  The old Monkhouse Intersport sponsor's print. Same grid, but no league
//              title and "a 7 day rule" where the current card says "(Rule 18)" — so
//              STOCKPORT, LEAGUE and RULE18 are all missing. Tatton 8 Sep, Manor 29 Sep.
//              Reading it is deliberately NOT supported: it is years out of date, and
//              the right outcome is that clubs stop using it.
//   tameside   The other league's card, uploaded by a captain who plays in both
//              (Aerospace, 30 Sep).
//   spreadsheet  The old Excel scoresheet, printed and filled in by hand — "Welcome to
//              your new scoresheet", XD pos. columns, a rubbers column and the
//              instructions down the right. A different layout entirely, with none of the
//              anchors. Racketeers A v B, 1 Oct. Not supported, for the Monkhouse reason.
//              Keyed on two of its printed words rather than one, because none of them is
//              as unmistakable as "Monkhouse" and the current card prints none of them.
//
// Only consulted once the anchors are already missing, so a player called Monkhouse on a
// card that reads fine changes nothing.
const CARD_MESSAGES = {
  monkhouse:
    'This is the old Monkhouse Intersport version of the scorecard, which the reader ' +
    'cannot fill in from — a clearer photo will not help. Carry on and fill the form in ' +
    'yourself; you can still attach this photo at the end. For future matches, please ' +
    'use the current league scorecard (Useful Links → Scorecard-print.pdf).',
  spreadsheet:
    'This is the old spreadsheet version of the scoresheet ("Welcome to your new ' +
    'scoresheet"), which the reader cannot fill in from — a clearer photo will not help. ' +
    'Carry on and fill the form in yourself; you can still attach this photo at the end. ' +
    'For future matches, please use the current league scorecard (Useful Links → ' +
    'Scorecard-print.pdf).',
  tameside:
    'This looks like a Tameside league scorecard. This form is for Stockport league ' +
    'results — check you have picked the right file and try again.',
};

function recogniseCard(textBlocks) {
  const has = re => textBlocks.some(b => re.test(b.text || ''));
  if (has(/monkhouse/i)) return 'monkhouse';
  if (has(/^tameside$/i)) return 'tameside';
  const SPREADSHEET_WORDS = [/^scoresheet\W*$/i, /^welcome$/i, /^calculating\W*$/i, /^rubbers$/i, /^XD$/];
  if (SPREADSHEET_WORDS.filter(has).length >= 2) return 'spreadsheet';
  return null;
}

// ── Geometry ──────────────────────────────────────────────────────────────────

function lineIntersection(p1, p2, p3, p4) {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

function quadCorners(sides) {
  return sides.map((s, i) => lineIntersection(s.p1, s.p2, sides[(i + 1) % 4].p1, sides[(i + 1) % 4].p2));
}

function destDimensions(corners) {
  const [tl, tr, br, bl] = corners;
  const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  return {
    width:  Math.round(Math.max(dist(tl, tr), dist(bl, br))),
    height: Math.round(Math.max(dist(tl, bl), dist(tr, br))),
  };
}

// ── Homography (pure JS) ──────────────────────────────────────────────────────
// Solves the 8-DOF projective transform from 4 point correspondences using
// Gaussian elimination with partial pivoting.

function solveHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: xp, y: yp } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -xp * x, -xp * y]); b.push(xp);
    A.push([0, 0, 0, x, y, 1, -yp * x, -yp * y]); b.push(yp);
  }
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }
  const h = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    h[i] = M[i][n] / M[i][i];
    for (let j = i + 1; j < n; j++) h[i] -= (M[i][j] / M[i][i]) * h[j];
  }
  return h; // [h00..h21], h22 = 1
}

function applyH(h, x, y) {
  const d = h[6] * x + h[7] * y + 1;
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
}

function transformBlocks(blocks, h) {
  return blocks.map(block => {
    const nb = [0, 1, 2, 3].map(i => {
      const v = block.bounds[i] || { x: 0, y: 0 };
      return applyH(h, v.x, v.y);
    });
    const xs = nb.map(v => v.x), ys = nb.map(v => v.y);
    return {
      ...block,
      bounds: nb,
      centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
      centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
      width:   Math.max(...xs) - Math.min(...xs),
      height:  Math.max(...ys) - Math.min(...ys),
    };
  });
}

// ── Vision call, with Google's capacity refusal retried ──────────────────────
//
// On 1 Oct 2026 Vision answered `code 8: Resource has been exhausted (e.g. check quota)`
// to roughly half of all calls, from every project, billing account, credential, region
// and feature Tameside tried, with successes interleaved. It was Google's capacity, not
// our quota — which the message implies and which we first believed.
//
// Two things made it invisible here. The refusal arrives as a PER-IMAGE error inside a
// successful batchAnnotate response (`result.error`, no `fullTextAnnotation`), so the call
// does not throw — `runOCR` reported it as "No text detected in image", blaming the photo,
// and `autoRotate` silently skipped. And the client library's own retry covers only
// DEADLINE_EXCEEDED and UNAVAILABLE, and could not see a per-image error anyway.
//
// So code 8 is retried here, in either shape. Delays total 7s per call and a card makes
// two calls; Firebase Hosting cuts requests at 60s (CLAUDE.md 1bc) and an analysis takes
// 2–7s, so the worst case still fits. Any other per-image error is NOT retried — a bad
// image stays bad — and is named rather than passed off as "no text".

const RESOURCE_EXHAUSTED = 8;
const VISION_RETRY_DELAYS_MS = [1000, 2000, 4000];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function visionBusyError(detail) {
  const err = new Error(
    "Google's card reader is busy right now, so it could not read this scorecard. " +
    'Try the photo again in a minute, or carry on and fill the form in yourself — you ' +
    'can still attach the photo at the end.'
  );
  // 503 rather than the 5xx catch-all: the controller passes this message through and
  // does not report it as an exception. It is Google's condition, not a fault of ours,
  // and reporting it as one is how a Sentry project stops being read.
  err.status = 503;
  err.visionBusy = true;
  err.detail = `Vision refused ${VISION_RETRY_DELAYS_MS.length + 1} times: ${detail}`;
  return err;
}

async function detectText(imageBuffer, delays = VISION_RETRY_DELAYS_MS) {
  for (let attempt = 0; ; attempt++) {
    let result, code, message;
    try {
      [result] = await visionClient.documentTextDetection(imageBuffer);
      code = result && result.error && result.error.code;
      message = code && result.error.message;
    } catch (err) {
      // The same refusal can also come back as a whole-call gRPC error.
      if (err.code !== RESOURCE_EXHAUSTED) throw err;
      code = err.code;
      message = err.details || err.message;
    }

    if (!code) return result;
    if (code !== RESOURCE_EXHAUSTED) {
      throw new Error(`Vision could not process the image (code ${code}): ${message}`);
    }
    if (attempt >= delays.length) throw visionBusyError(message);
    console.warn(`[ocr] Vision busy (code 8), retry ${attempt + 1} of ${delays.length}`);
    await sleep(delays[attempt]);
  }
}

// ── Auto-rotate ───────────────────────────────────────────────────────────────

async function autoRotate(imageBuffer) {
  try {
    const result = await detectText(imageBuffer);
    if (!result.fullTextAnnotation) return imageBuffer;
    let total = 0, count = 0;
    result.fullTextAnnotation.pages[0].blocks.forEach(block => {
      const v = block.boundingBox.vertices;
      if (v.length < 2) return;
      let angle = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x) * (180 / Math.PI);
      while (angle > 180) angle -= 360;
      while (angle < -180) angle += 360;
      total += angle; count++;
    });
    if (count === 0) return imageBuffer;
    const avg = total / count;
    if (Math.abs(avg) > 1)
      return sharp(imageBuffer).rotate(-avg, { background: { r: 255, g: 255, b: 255 } }).toBuffer();
    return imageBuffer;
  } catch (err) {
    // Rotation is optional, so anything else still falls through to an unrotated read.
    // A busy Vision is not: it has just refused this card four times, and spending
    // another 7s of the request on runOCR's identical call only delays the same answer.
    if (err.visionBusy) throw err;
    return imageBuffer;
  }
}

// ── OCR ───────────────────────────────────────────────────────────────────────

async function runOCR(imageBuffer) {
  // `.jpeg()` matters, and not for looks.
  //
  // sharp's `.toBuffer()` keeps the INPUT format, and greyscale png barely compresses: a
  // real 13.5MB png scorecard came out at 11.8MB, so almost the whole file went to Vision.
  // Encoded as jpeg the same image is 2.6MB — 4.6x smaller — and since it has already been
  // greyscaled, normalised and sharpened *for OCR*, jpeg artefacts are irrelevant to text
  // detection. Without this the 25MB upload cap is only safe for jpeg inputs and quietly
  // unsafe for png, which would arrive near Vision's ~20MB ceiling.
  //
  // The fallback is the second half. A genuine 11.9MB scorecard in the bucket
  // (Parrswood C-Dome B.jpeg) makes sharp throw `VipsJpeg: Invalid SOS parameters for
  // sequential JPEG` — malformed, not large — and with no catch here that was a 500 on the
  // one endpoint whose job is to be helpful. Vision is more tolerant than libvips, so hand
  // it the original bytes and let it try.
  let enhanced;
  try {
    enhanced = await sharp(imageBuffer)
      .greyscale().normalize().sharpen()
      .linear(1.2, -(128 * 0.2))
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (err) {
    console.warn('[ocr] enhance failed, sending the original to Vision:', err.message);
    enhanced = imageBuffer;
  }

  const result = await detectText(enhanced);
  if (!result.fullTextAnnotation) throw new Error('No text detected in image');

  const meta = await sharp(enhanced).metadata();
  const textBlocks = [];
  result.fullTextAnnotation.pages[0].blocks.forEach(block => {
    block.paragraphs.forEach(para => {
      para.words.forEach(word => {
        const text = word.symbols.map(s => s.text).join('').trim();
        const v = word.boundingBox.vertices;
        if (!text) return;
        textBlocks.push({
          text,
          bounds: v,
          confidence: word.confidence || block.confidence || 0,
          centerX: (v[0].x + v[2].x) / 2,
          centerY: (v[0].y + v[2].y) / 2,
          width:   v[2].x - v[0].x,
          height:  v[2].y - v[0].y,
        });
      });
    });
  });
  return { textBlocks, imgW: meta.width, imgH: meta.height };
}

// ── Main export ───────────────────────────────────────────────────────────────
// Returns text blocks in perspective-corrected coordinate space, ready for
// region-based extraction without any image re-processing.

async function analyseImage(imageBuffer) {
  const rotated = await autoRotate(imageBuffer);
  const { textBlocks, imgW, imgH } = await runOCR(rotated);

  const { found: anchors, diagnostics } = findAnchors(textBlocks, imgW, imgH);
  const missing = REQUIRED_ANCHORS.filter(a => !anchors[a]);
  if (missing.length > 0) {
    // Not a fault. The reader locates every field by these four printed anchors, so a
    // photo it cannot line up is one of: cropped, at an angle, or — the case that
    // actually happened — an older version of the scorecard that does not carry them.
    //
    // Carries `status` so the route answers 4xx rather than 500. It went out as a 500
    // with this raw message, and a captain who reads "Missing corner anchors:
    // STOCKPORT, LEAGUE, RULE18" learns nothing except that the site is broken; the one
    // it happened to abandoned the auto-fill and uploaded by hand. `detail` keeps the
    // anchor names for the log, where they are the useful half.
    const card = recogniseCard(textBlocks);
    const err = new Error(CARD_MESSAGES[card] ||
      'The reader could not line up this scorecard, so it cannot fill the form in for ' +
      'you. That usually means the photo is cropped or taken at an angle, or that the ' +
      'card is an older version of the form. Take a straight-on photo of the whole ' +
      'card and try again, or just carry on and fill the form in yourself — you can ' +
      'still attach the photo at the end.'
    );
    err.status = 422;
    err.detail = `Missing corner anchors: ${describeMissing(diagnostics, missing)}` +
      (card ? ` card=${card}` : '');
    err.card = card;
    err.anchorDiagnostics = diagnostics;
    throw err;
  }

  const a = anchors;
  const sides = [
    { p1: a.DATE.bounds[0],      p2: a.SIGNATURE.bounds[0] },
    { p1: a.STOCKPORT.bounds[0], p2: a.LEAGUE.bounds[1] },
    { p1: { x: a.WON_BY.bounds[1].x + a.WON_BY.width / 2, y: a.WON_BY.bounds[1].y },
      p2: { x: a.RULE18.bounds[2].x + a.RULE18.width,      y: a.RULE18.bounds[2].y } },
    { p1: a.PLEASE.bounds[3],    p2: a.RULE18.bounds[2] },
  ];

  const corners = quadCorners(sides);
  const { width, height } = destDimensions(corners);

  const h = solveHomography(corners, [
    { x: 0,     y: 0      },
    { x: width, y: 0      },
    { x: width, y: height },
    { x: 0,     y: height },
  ]);

  return {
    textBlocks: transformBlocks(textBlocks, h),
    imageWidth: width,
    imageHeight: height,
  };
}

// findAnchors, CORNER_ANCHORS and describeMissing are exported for the tests: the
// diagnostic logic is worth testing without a Vision call and a real photograph.
module.exports = {
  analyseImage, findAnchors, describeMissing, recogniseCard, CORNER_ANCHORS, REQUIRED_ANCHORS,
  detectText, VISION_RETRY_DELAYS_MS,
};
