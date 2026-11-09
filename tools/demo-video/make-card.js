// Builds the demo's "photo" of a filled-in scorecard: the league's own Scorecard-print.pdf, written
// on in a handwriting font from card-data.json, tilted and lit to look photographed. Fictional
// players, so no real captain's handwriting or team sheet appears in a public video.
//   node tools/demo-video/make-card.js      (needs ImageMagick and macOS's Bradley Hand font)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const D = __dirname, K = 2;
const PDF = path.join(D, '../../static/beta/docs/Scorecard-print.pdf');
const OUT = path.join(D, 'generated');
fs.mkdirSync(OUT, { recursive: true }); // coordinates below are at 100dpi; render at 200
const FONT = '/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf';
const card = require('./card-data.json');
const rowsY = [235,255,278,298,321,340,363,383,406,426,449,469,491,511,534,554,577,597];
const t = [];
let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5);
const w = (x, y, s, size = 15) => t.push('-pointsize', String(size * K * 1.7 + rnd() * 2),
  '-annotate', `${(rnd() * 3).toFixed(1)}x${(rnd() * 3).toFixed(1)}+${Math.round((x + rnd() * 3) * K)}+${Math.round((y - 4 + rnd() * 2) * K)}`, s);
w(90, 141, card.dateWritten, 16); w(410, 141, card.divisionWritten, 16);
w(92, 174, card.homeName, 16); w(375, 174, card.awayName, 16);
[[card.home.ladies, 255], [card.home.men, 340], [card.away.ladies, 469], [card.away.men, 554]].forEach(([names, y0]) =>
  names.forEach((n, i) => w(40, [y0, y0 + 22, y0 + 43][i], n, 14)));
let hp = 0, ap = 0, hw = 0, aw = 0;
card.games.forEach(([h, a, shown], i) => {
  const y = rowsY[i]; hp += h; ap += a;
  w(333, y, String(h)); w(398, y, String(shown ?? a));
  if (h > a) { hw++; w(465, y, String(h - a)); } else { aw++; w(530, y, String(a - h)); }
});
w(328, 628, String(hp)); w(393, 628, String(ap)); w(465, 628, String(hw)); w(530, 628, String(aw));
w(270, 658, card.homeSig, 15); w(450, 658, card.awaySig, 15);
execFileSync('magick', ['-density', String(100 * K), PDF,
  '-background', 'white', '-flatten', '-crop', `${585 * K}x${800 * K}+0+20`, '+repage', '-density', '72',
  '-font', FONT, '-fill', '#1d3a8a', ...t, `${OUT}/card-flat.png`]);
// Make it look photographed: warm paper, slight tilt and perspective, on a table, soft light.
const W = 585 * K, H = 800 * K;
execFileSync('magick', [`${OUT}/card-flat.png`, '-fill', '#f4efe2', '-colorize', '10%',
  '-bordercolor', '#f4efe2', '-border', '10',
  '-virtual-pixel', 'transparent', '-alpha', 'set', '-distort', 'Perspective',
  `0,0 30,40  ${W + 20},0 ${W - 30},14  ${W + 20},${H + 20} ${W + 5},${H + 5}  0,${H + 20} 0,${H + 30}`,
  '(', '+clone', '-background', 'black', '-shadow', '60x18+12+18', ')', '+swap',
  '-background', 'none', '-layers', 'merge', '+repage',
  '(', '-size', `${W + 260}x${H + 260}`, 'gradient:#8a6a4a-#5e4630', '-attenuate', '0.3', '+noise', 'Gaussian', ')',
  '+swap', '-gravity', 'center', '-geometry', '+0+0', '-composite',
  '(', '-size', `${W + 260}x${H + 260}`, 'radial-gradient:white-#c4c4c4', ')', '-compose', 'multiply', '-composite',
  '-rotate', '-1.5', '-gravity', 'center', '-crop', `${W + 160}x${H + 160}+0+0`, '+repage',
  '-resize', '1400x', '-quality', '86', `${OUT}/scorecard-photo.jpg`]);
