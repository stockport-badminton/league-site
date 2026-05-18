const sharp = require('sharp');
const { getAllLeagueTables } = require('../models/league');

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgOverlay(width, height, elements) {
  const els = elements.map(({ text, x, y, size, weight = 'normal', fill = '#000', anchor = 'middle' }) =>
    `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(text)}</text>`
  ).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${els}</svg>`);
}

exports.resultImage = async function(req, res, next) {
  try {
    const { homeTeam, awayTeam, homeScore, awayScore, division } = req.params;
    const bgPath = `static/beta/images/bg/social-${division.replace(/\s+/g, '-')}.png`;
    const fileBase = `static/beta/images/generated/${homeTeam.replace(/\s+/g, '+')}+${awayTeam.replace(/\s+/g, '+')}`;

    const makeElements = (width, height) => {
      const x = width - 100;
      const y = Math.floor(2 * height / 3) + 50;
      return [
        { text: homeTeam,                              x, y,       size: 60, weight: 'bold',   fill: 'black', anchor: 'end' },
        { text: 'vs',                                  x, y: y+60,  size: 50,                  fill: 'black', anchor: 'end' },
        { text: awayTeam,                              x, y: y+140, size: 60, weight: 'bold',   fill: 'black', anchor: 'end' },
        { text: `${homeScore} - ${awayScore}`,         x, y: y+240, size: 80, weight: 'bold',   fill: 'black', anchor: 'end' },
        { text: '#stockport #badminton #sdbl #result', x, y: y+320, size: 30,                  fill: 'black', anchor: 'end' },
        { text: 'https://stockport-badminton.co.uk',   x, y: y+365, size: 30,                  fill: 'black', anchor: 'end' },
      ];
    };

    const postBuffer = await sharp(bgPath)
      .resize(1080, 1350, { fit: 'cover' })
      .composite([{ input: svgOverlay(1080, 1350, makeElements(1080, 1350)) }])
      .jpeg({ quality: 90 })
      .toBuffer();

    await Promise.all([
      sharp(postBuffer).toFile(`${fileBase}.jpg`),
      sharp(bgPath)
        .resize(1080, 1920, { fit: 'cover' })
        .composite([{ input: svgOverlay(1080, 1920, makeElements(1080, 1920)) }])
        .jpeg({ quality: 90 })
        .toFile(`${fileBase}-Ig.jpg`),
    ]);

    res.type('image/jpeg');
    res.send(postBuffer);
  } catch (err) {
    next(err);
  }
};

async function createDivisionTableImage(bgPath, divisionName, rows) {
  const W = 1080, H = 1080;
  const elements = [
    { text: divisionName, x: 230, y: 120, size: 65, weight: 'bold' },
    { text: 'P',    x: 530, y: 120, size: 65, weight: 'bold' },
    { text: 'W',    x: 680, y: 120, size: 65, weight: 'bold' },
    { text: 'L',    x: 830, y: 120, size: 65, weight: 'bold' },
    { text: 'Avg.', x: 980, y: 120, size: 65, weight: 'bold' },
  ];

  let posY = 220;
  for (const row of rows) {
    const avg = row.played > 0 ? Math.max(0, row['pointsFor'] / row.played).toFixed(1) : '0';
    elements.push({ text: row.name,                    x: 230, y: posY, size: 55 });
    elements.push({ text: String(row.played),          x: 530, y: posY, size: 55 });
    elements.push({ text: String(row['pointsFor']),    x: 680, y: posY, size: 55 });
    elements.push({ text: String(row['pointsAgainst']),x: 830, y: posY, size: 55 });
    elements.push({ text: avg,                         x: 980, y: posY, size: 55 });
    posY += 90;
  }

  return sharp(bgPath)
    .resize(W, H, { fit: 'cover' })
    .composite([{ input: svgOverlay(W, H, elements) }])
    .png()
    .toBuffer();
}

exports.tablesSocial = async function(req, res, next) {
  try {
    const result = await getAllLeagueTables(req.params.season);
    const divIds = [7, 8, 9, 10];
    const bgPath = 'static/beta/images/bg/social.png';

    const divisionImages = (await Promise.all(
      divIds.map(async (divId) => {
        const rows = result.filter(row => row.division == divId);
        if (!rows.length) return null;
        const buf = await createDivisionTableImage(bgPath, rows[0]['divisionName'], rows);
        await sharp(buf).toFile(`static/beta/images/generated/league-table-${rows[0]['divisionName']}.png`);
        return buf;
      })
    )).filter(Boolean);

    if (divisionImages.length) {
      await sharp({
        create: { width: 1080, height: 1080 * divisionImages.length, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
      })
        .composite(divisionImages.map((buf, i) => ({ input: buf, top: 1080 * i, left: 0 })))
        .png()
        .toFile('static/beta/images/generated/league-table-merged.png');
    }

    res.render('beta/league-table-social', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: 'Table Social Images',
      pageDescription: 'Table Social Images',
      query: req.query,
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
    });
  } catch (err) {
    next(err);
  }
};

async function drawTournamentImage(title, lines, filename) {
  const W = 1080, H = 1080;
  const elements = [{ text: title, x: 540, y: 120, size: 65, weight: 'bold' }];
  let posY = 120;
  for (const line of lines) {
    posY += line.gap || 100;
    elements.push({ text: line.text, x: 540, y: posY, size: 40, weight: line.bold ? 'bold' : 'normal' });
  }
  await sharp('static/beta/images/bg/social.png')
    .resize(W, H, { fit: 'cover' })
    .composite([{ input: svgOverlay(W, H, elements) }])
    .png()
    .toFile(`static/beta/images/generated/${filename}`);
}

exports.tournamentSocial = async function(req, res, next) {
  try {
    await Promise.all([
      drawTournamentImage('Open Tournament', [
        { text: '11th November', bold: true },
        { text: 'Mens & Womens Doubles', bold: false },
        { text: '18th November', bold: true },
        { text: 'Mens & Womens Singles', bold: false },
        { text: 'Mixed Doubles', bold: false, gap: 50 },
        { text: 'Entry form and details on the website', bold: false },
        { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
      ], 'open-tournament-social.png'),
      drawTournamentImage('`B` Tournament', [
        { text: '11th November', bold: true },
        { text: 'Mens & Womens Doubles', bold: false },
        { text: '18th November', bold: true },
        { text: 'Singles', bold: false },
        { text: 'Mixed Doubles', bold: false, gap: 50 },
        { text: 'Entry form and details on the website', bold: false },
        { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
      ], 'B-tournament-social.png'),
      drawTournamentImage('`C` Tournament', [
        { text: '11th November', bold: true },
        { text: 'Mens & Womens Doubles', bold: false },
        { text: '18th November', bold: true },
        { text: 'Mixed Doubles', bold: false },
        { text: 'Entry form and details on the website', bold: false },
        { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
      ], 'c-tournament-social.png'),
      drawTournamentImage('Supervet Tournament', [
        { text: '11th November', bold: true },
        { text: 'Mixed Doubles', bold: false },
        { text: '18th November', bold: true },
        { text: 'Mens Doubles', bold: false },
        { text: 'Womens Doubles', bold: false, gap: 50 },
        { text: 'Entry form and details on the website', bold: false },
        { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
      ], 'supervet-tournament-social.png'),
    ]);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
};

exports.handicapTournamentSocial = async function(req, res, next) {
  try {
    await drawTournamentImage('Handicap Tournaments', [
      { text: 'Didsbury High School', bold: false },
      { text: '4 The Avenue, Didsbury, M20 2ET', bold: false, gap: 50 },
      { text: '2nd March', bold: true },
      { text: 'Handicap Mens & Womens Singles', bold: false, gap: 50 },
      { text: 'Handicap Mixed Doubles', bold: false, gap: 50 },
      { text: 'Veteran Mens & Womens Doubles', bold: false, gap: 50 },
      { text: '9th March', bold: true },
      { text: 'Handicap Mens & Womens Doubles', bold: false, gap: 50 },
      { text: 'Veteran Singles', bold: false, gap: 50 },
      { text: 'Entry form and details on the website', bold: false },
      { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
    ], 'handicap-tournament-social.png');
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
};
