// The Messer Trophy score sheet, drawn as a PDF with the current season in its title.
//
// It used to be a static spreadsheet, static/beta/docs/Messer-Score-Sheet.xlsx, which
// still said "MESSER TROPHY 2023-2024" three seasons later and told captains to email
// the sheet to a Messer secretary. This replaces it with a layout taken from the
// league's printable card (static/beta/docs/Scorecard-print.pdf): A4 landscape, two
// copies side by side, the same header, DATE/HOME boxes, team blocks and totals row.
// Approved by the Messer admin, Nov 2026.
//
// What differs from the league card is the competition: each team block carries its
// handicap and adjusted handicap, and there are nine rubbers rather than nine pairs of
// games: six level doubles over two games and three mixed over one (6 x 2 + 3 = 15,
// Game1-Game15 in messer_scorecard). The mixed rubbers' second game is greyed out.
//
// Coordinates below are measured from the top of the page, as on the rendered card,
// and flipped to pdf-lib's bottom-left origin in the drawing helpers.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE = { width: 841.92, height: 595.32 };
const ROW = 15.4; // the league card's row height
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.82, 0.82, 0.82);

// In game order, matching the online form
const RUBBERS = [
  ['GENTS', '1 & 2'], ['LADIES', '1 & 2'], ['GENTS', '1 & 3'], ['LADIES', '1 & 3'],
  ['GENTS', '2 & 3'], ['LADIES', '2 & 3'], ['MIXED', '1ST'], ['MIXED', '2ND'], ['MIXED', '3RD'],
];

const INSTRUCTIONS = 'After each match the Captain of the winning team will be responsible for '
  + 'uploading the result onto the League Website.';
const DEADLINE = 'This must be done within seven days of the match having been played.';

// "20262027" -> "Messer Trophy 2026-2027", the form the sheet has always used
function seasonTitle(seasonName) {
  return `Messer Trophy ${seasonName.slice(0, 4)}-${seasonName.slice(4, 8)}`;
}

function wrap(text, width, size, font) {
  const lines = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current ? current + ' ' + word : word;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  return lines.concat(current);
}

async function buildMesserScoreSheet(seasonName) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Messer Score Sheet ${seasonTitle(seasonName).replace('Messer Trophy ', '')}`);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const H = PAGE.height;

  const line = (x1, y1, x2, y2, thickness = 0.75) =>
    page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness, color: BLACK });
  const box = (x, y, width, height, borderWidth = 0.75) =>
    page.drawRectangle({ x, y: H - y - height, width, height, borderWidth, borderColor: BLACK });
  const text = (s, x, y, size = 8, font = regular) =>
    page.drawText(s, { x, y: H - y, size, font, color: BLACK });
  const centre = (s, x, width, y, size = 8, font = bold) =>
    text(s, x + (width - font.widthOfTextAtSize(s, size)) / 2, y, size, font);

  const title = seasonTitle(seasonName);
  const footer = wrap(INSTRUCTIONS, 384, 8, regular).map(l => [l, regular])
    .concat(wrap(DEADLINE, 384, 8, bold).map(l => [l, bold]));

  for (const x0 of [15, 430]) {
    const W = 396;
    const xEnd = x0 + W;
    const xr = x0 + 145; // the rubbers table

    centre('Stockport & District Badminton League', x0, W, 47, 11.5);
    centre(title, x0, W, 64, 11.5);
    centre('www.stockport-badminton.co.uk', x0, W, 79, 7.5);

    box(x0, 93, W, 16);
    text('DATE:', x0 + 2, 105, 9, bold);
    text('SECTION:  A / B', x0 + 210, 105, 9, bold);
    box(x0, 117, W, 16);
    text('HOME', x0 + 2, 129, 9, bold);
    text('v AWAY', x0 + 210, 129, 9, bold);

    // Teams: heading, handicaps, ladies 1-3, gentlemen 1-3
    const top = 145;
    ['HOME TEAM', 'AWAY TEAM'].forEach((label, i) => {
      const y = top + i * (10 * ROW + 6);
      const w = 140;
      box(x0, y, w, 10 * ROW, 1);
      centre(label, x0, w, y + 11, 8.5);
      line(x0, y + ROW, x0 + w, y + ROW, 1);
      text('H/Cp', x0 + 2, y + ROW + 11);
      line(x0 + 26, y + 2 * ROW - 3, x0 + 62, y + 2 * ROW - 3, 0.5);
      text('Adj H/Cp', x0 + 68, y + ROW + 11);
      line(x0 + 104, y + 2 * ROW - 3, x0 + w - 4, y + 2 * ROW - 3, 0.5);
      line(x0, y + 2 * ROW, x0 + w, y + 2 * ROW, 1);
      ['LADIES', '1', '2', '3', 'GENTLEMEN', '1', '2', '3'].forEach((s, k) => {
        const ry = y + (2 + k) * ROW;
        text(s, x0 + 2, ry + 11);
        if (k) line(x0, ry, x0 + w, ry, k === 4 ? 1 : 0.5);
      });
    });

    // Rubbers: two heading rows, nine rubbers of two lines each, then totals.
    // Columns: couple | game 1 H A | game 2 H A | won by H A
    const cw = (xEnd - (xr + 60)) / 6;
    const cols = [xr];
    for (let c = 0; c <= 6; c++) cols.push(xr + 60 + c * cw);
    const bodyTop = top + 2 * ROW;
    const bodyHeight = RUBBERS.length * 2 * ROW;

    box(xr, top, xEnd - xr, 2 * ROW + bodyHeight, 1);
    centre('COUPLES', xr, 60, top + 18, 8.5);
    [['GAME 1', 1], ['GAME 2', 3], ['WON BY', 5]].forEach(([s, c]) => {
      centre(s, cols[c], 2 * cw, top + 11, 8.5);
      centre('H', cols[c], cw, top + ROW + 11);
      centre('A', cols[c + 1], cw, top + ROW + 11);
    });
    line(cols[1], top + ROW, xEnd, top + ROW, 0.5);
    line(xr, bodyTop, xEnd, bodyTop, 1);
    RUBBERS.forEach(([kind, pair], k) => {
      const y = bodyTop + k * 2 * ROW;
      if (kind === 'MIXED') {
        page.drawRectangle({ x: cols[3], y: H - y - 2 * ROW, width: 2 * cw, height: 2 * ROW, color: GREY });
      }
      text(kind, xr + 2, y + 11);
      text(pair, xr + 2, y + ROW + 11);
      line(xr, y + ROW, cols[1], y + ROW, 0.5);
      if (k) line(xr, y, xEnd, y, 1);
    });
    // H|A dividers are thin and start below the game heading; the rest are full height
    cols.slice(1).forEach((x, c) => line(x, top + (c % 2 ? ROW : 0), x, bodyTop + bodyHeight, c % 2 ? 0.5 : 1));

    const ty = bodyTop + bodyHeight + 5;
    box(xr, ty, xEnd - xr, ROW, 1.8);
    text('TOTALS', xr + 2, ty + 11, 9, bold);
    cols.slice(1, -1).forEach(x => line(x, ty, x, ty + ROW));

    const sy = ty + ROW + 8;
    box(x0, sy, W, 13);
    text('Signature of Captains', x0 + 2, sy + 10, 7.5);
    text('Home', x0 + 145, sy + 10, 7.5);
    text('Away', x0 + 275, sy + 10, 7.5);

    const iy = sy + 20;
    box(x0, iy, W, footer.length * 11 + 8);
    footer.forEach(([l, font], k) => centre(l, x0 + 6, W - 12, iy + 13 + k * 11, 8, font));
  }

  return Buffer.from(await doc.save());
}

module.exports = { buildMesserScoreSheet, seasonTitle, INSTRUCTIONS, DEADLINE };
