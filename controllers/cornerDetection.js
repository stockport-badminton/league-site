// Perspective correction via coordinate transform.
// Detects 7 fixed-text anchors on the scorecard, computes a homography from
// the inferred quadrilateral corners to a destination rectangle, then applies
// that transform to the text-block coordinates — no image warping, no opencv.

const vision = require('@google-cloud/vision');
const sharp  = require('sharp');

const visionClient = new vision.ImageAnnotatorClient();

// ── Corner anchors (fixed printed text on the scorecard template) ─────────────

const CORNER_ANCHORS = {
  DATE:      { pattern: /DATE\s*/i,       searchArea: { yMin: 0, yMax: 0.3 } },
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

function findAnchors(textBlocks, imgW, imgH) {
  const found = {};
  for (const [name, anchor] of Object.entries(CORNER_ANCHORS)) {
    const candidates = textBlocks.filter(b => inSearchArea(b, anchor.searchArea, imgW, imgH));
    if (anchor.multiWord) {
      const m = findMultiWordAnchor(candidates, anchor);
      if (m) found[name] = m;
    } else {
      const m = candidates.find(b => anchor.pattern.test(b.text) && b.text.length <= 20);
      if (m) found[name] = m;
    }
  }
  return found;
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

// ── Auto-rotate ───────────────────────────────────────────────────────────────

async function autoRotate(imageBuffer) {
  try {
    const [result] = await visionClient.documentTextDetection(imageBuffer);
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
  } catch { return imageBuffer; }
}

// ── OCR ───────────────────────────────────────────────────────────────────────

async function runOCR(imageBuffer) {
  const enhanced = await sharp(imageBuffer)
    .greyscale().normalize().sharpen()
    .linear(1.2, -(128 * 0.2))
    .toBuffer();

  const [result] = await visionClient.documentTextDetection(enhanced);
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

  const anchors = findAnchors(textBlocks, imgW, imgH);
  const missing = REQUIRED_ANCHORS.filter(a => !anchors[a]);
  if (missing.length > 0) throw new Error(`Missing corner anchors: ${missing.join(', ')}`);

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

module.exports = { analyseImage };
