const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { getAllLeagueTables } = require('../models/league');
const Fixture = require('../models/fixture');
const { canonicalFor } = require('../utils/canonical');

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgOverlay(width, height, elements) {
  const els = elements.map(({ text, x, y, size, weight = 'normal', fill = '#000', anchor = 'middle' }) =>
    `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(text)}</text>`
  ).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${els}</svg>`);
}

// `/league-table-image/Division 1.jpg` and `/league-table-image/Division 1` are the same
// picture. The extension exists so the URL says what it serves — see the note beside
// leagueTableImagePath in utils/canonical.js — and is stripped here rather than being part
// of the lookup, so an old link without it keeps working.
function stripImageExt(v) {
  return String(v || '').replace(/\.jpe?g$/i, '');
}

exports.resultImage = async function(req, res, next) {
  try {
    const generatedDir = 'static/beta/images/generated';
    await fs.mkdir(generatedDir, { recursive: true });

    const { homeTeam, awayTeam, homeScore, awayScore } = req.params;
    // The trailing `.jpg` is optional and must come off before the division name is used —
    // it picks the background file, so `Division 1.jpg` would look for
    // `social-Division-1.jpg.png` and fail. Same reasoning as the tables route: the URL is
    // self-describing so `metaPublisher`'s JPEG guard can stay strict, and links filed
    // before the extension existed keep working.
    const division = stripImageExt(req.params.division);
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

// ---------------------------------------------------------------------------
// The weekly social images, served on demand
// ---------------------------------------------------------------------------
//
// The originals are written to `static/beta/images/generated/` and fetched back by URL.
// That is a Cloud Run container's own disk: it belongs to one instance, does not outlive
// it, and is invisible to every other instance. Measured 15 Sep 2026 — every one of those
// URLs answered 404, which means the weekly Instagram carousel has been posting nothing.
//
// These routes generate the same picture per request and return the bytes, exactly as
// `resultImage` already does, so there is no file to go missing and no instance to hit.
// **JPEG, not PNG**: Instagram's publishing API accepts JPEG and nothing else, and Meta
// fetches `image_url` itself, server-side, minutes after the container that could have
// served a temp file has gone.
//
// The file-writing routes are deliberately left alone. The live Make.com scenario still
// calls them, and removing them before it is repointed would break the weekly post on the
// Facebook side, which does currently work.

// The division ids the weekly post covers, in the order they should read.
const SOCIAL_DIVISION_IDS = [7, 8, 9, 10];

// The tournament posters, lifted out of the two handlers that had them inline so a route
// can render any one by name. Content unchanged.
const TOURNAMENT_POSTERS = {
  open: { file: 'open-tournament-social.png', title: 'Open Tournament', lines: [
    { text: '11th November', bold: true },
    { text: 'Mens & Womens Doubles', bold: false },
    { text: '18th November', bold: true },
    { text: 'Mens & Womens Singles', bold: false },
    { text: 'Mixed Doubles', bold: false, gap: 50 },
    { text: 'Entry form and details on the website', bold: false },
    { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
  ] },
  b: { file: 'B-tournament-social.png', title: '`B` Tournament', lines: [
    { text: '11th November', bold: true },
    { text: 'Mens & Womens Doubles', bold: false },
    { text: '18th November', bold: true },
    { text: 'Singles', bold: false },
    { text: 'Mixed Doubles', bold: false, gap: 50 },
    { text: 'Entry form and details on the website', bold: false },
    { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
  ] },
  c: { file: 'c-tournament-social.png', title: '`C` Tournament', lines: [
    { text: '11th November', bold: true },
    { text: 'Mens & Womens Doubles', bold: false },
    { text: '18th November', bold: true },
    { text: 'Mixed Doubles', bold: false },
    { text: 'Entry form and details on the website', bold: false },
    { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
  ] },
  supervet: { file: 'supervet-tournament-social.png', title: 'Supervet Tournament', lines: [
    { text: '11th November', bold: true },
    { text: 'Mixed Doubles', bold: false },
    { text: '18th November', bold: true },
    { text: 'Mens Doubles', bold: false },
    { text: 'Womens Doubles', bold: false, gap: 50 },
    { text: 'Entry form and details on the website', bold: false },
    { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 },
  ] },
  handicap: { file: 'handicap-tournament-social.png', title: 'Handicap Tournaments', lines: [
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
  ] },
};

exports.TOURNAMENT_POSTERS = TOURNAMENT_POSTERS;

// A day of caching. The tables change when a result is published, and the weekly post is
// the only automated consumer — but Meta may fetch the same URL several times while
// building a carousel, and regenerating a 1080x1080 composite each time is pure waste.
const SOCIAL_IMAGE_CACHE_CONTROL = 'public, max-age=86400';

// A 404 from these routes must NOT be cached, and saying so is not belt-and-braces.
//
// Firebase Hosting applies its own `max-age=600` to any response that does not set
// Cache-Control, so a miss sticks for ten minutes — measured 15 Sep 2026, when three URLs
// requested minutes before a deploy went on answering 404 after it while a fourth, which
// nobody had asked for yet, returned 200. The same URL with a cache-buster worked.
//
// That is worse than untidy here. **Meta fetches these URLs itself and retries**, so a
// transient 404 — a deploy in flight, a division renamed mid-season — gets cached and the
// retry hits the cache rather than the fixed route. The window outlives the fault.
const SOCIAL_IMAGE_MISS_CACHE_CONTROL = 'no-store';

// GET /league-table-image/:division — one division's table, as a JPEG, built now.
exports.leagueTableImage = async function (req, res, next) {
  try {
    const wanted = stripImageExt(req.params.division).trim().toLowerCase();
    const result = await getAllLeagueTables(req.params.season);

    // Matched on the division's NAME, not its id, so the URL says what it shows and stays
    // readable in a Make scenario or a caption. Names carry spaces, hence the helper in
    // utils/canonical.js that percent-encodes them.
    const rows = result.filter(r => SOCIAL_DIVISION_IDS.includes(Number(r.division)))
      .filter(r => String(r.divisionName || '').trim().toLowerCase() === wanted);

    if (!rows.length) {
      // 404, explicitly. `res.send(err)` serialises an Error to `{}` and goes out as 200,
      // which a crawler banks as a real page — gotcha 1c.
      return res.status(404).set('Cache-Control', SOCIAL_IMAGE_MISS_CACHE_CONTROL).type('text/plain').send('No league table for that division');
    }

    const buf = await createDivisionTableImage(
      'static/beta/images/bg/social.png', rows[0].divisionName, rows, 'jpeg');

    res.type('image/jpeg').set('Cache-Control', SOCIAL_IMAGE_CACHE_CONTROL).send(buf);
  } catch (err) {
    next(err);
  }
};

// GET /tournament-image/:poster — one tournament poster, as a JPEG, built now.
exports.tournamentImage = async function (req, res, next) {
  try {
    const key = stripImageExt(req.params.poster).trim().toLowerCase();
    const poster = Object.prototype.hasOwnProperty.call(TOURNAMENT_POSTERS, key)
      ? TOURNAMENT_POSTERS[key]
      : null;

    if (!poster) {
      return res.status(404).set('Cache-Control', SOCIAL_IMAGE_MISS_CACHE_CONTROL).type('text/plain').send(
        'No such tournament poster. Known: ' + Object.keys(TOURNAMENT_POSTERS).join(', '));
    }

    const buf = await drawTournamentBuffer(poster.title, poster.lines, 'jpeg');
    res.type('image/jpeg').set('Cache-Control', SOCIAL_IMAGE_CACHE_CONTROL).send(buf);
  } catch (err) {
    next(err);
  }
};

// One table row's four numbers, as the strings the picture prints. Exported so the guard
// tests what the image actually draws rather than a copy of this arithmetic — a test that
// restates the implementation passes against the bug just as happily.
//
// `String(null)` is the four characters "null", and before a team's first result of the
// season `pointsFor` and `pointsAgainst` come back NULL rather than 0. `avg` was already
// guarded on `played > 0`; the other three were not, so at the start of every season the
// picture read "0 null null" down the page.
//
// Found on a real published Instagram post, 15 Sep 2026 — the first time anyone had looked
// at what this image says, because the URL serving it had 404'd for as long as the weekly
// post had existed. **A broken link was hiding a broken picture**, and fixing the link is
// what exposed it.
//
// Note W and L are GAMES won and lost, not league points: this league ranks on games, all
// 18 of a fixture counting, which is why a team with 6 played shows 60 and 48. The database
// columns say "points" and mean games.
function tableRowValues(row) {
  const played = Number(row.played) || 0;
  const won = Number(row['pointsFor']) || 0;
  const lost = Number(row['pointsAgainst']) || 0;
  return {
    played: String(played),
    won: String(won),
    lost: String(lost),
    avg: played > 0 ? Math.max(0, won / played).toFixed(1) : '0',
  };
}

exports.tableRowValues = tableRowValues;

async function createDivisionTableImage(bgPath, divisionName, rows, format = 'png') {
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
    const { played, won, lost, avg } = tableRowValues(row);
    elements.push({ text: row.name, x: 230, y: posY, size: 55 });
    elements.push({ text: played,   x: 530, y: posY, size: 55 });
    elements.push({ text: won,      x: 680, y: posY, size: 55 });
    elements.push({ text: lost,     x: 830, y: posY, size: 55 });
    elements.push({ text: avg,                         x: 980, y: posY, size: 55 });
    posY += 90;
  }

  const pipeline = sharp(bgPath)
    .resize(W, H, { fit: 'cover' })
    .composite([{ input: svgOverlay(W, H, elements) }]);

  return (format === 'jpeg' ? pipeline.jpeg({ quality: 90 }) : pipeline.png()).toBuffer();
}

exports.tablesSocial = async function(req, res, next) {
  try {
    const generatedDir = 'static/beta/images/generated';
    await fs.mkdir(generatedDir, { recursive: true });

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

    res.render('league-table-social', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: 'Table Social Images',
      pageDescription: 'Table Social Images',
      query: req.query,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

// The drawing, with no opinion about where it goes. Split out so the on-demand route and
// the file-writing route cannot drift into producing two different posters.
async function drawTournamentBuffer(title, lines, format = 'png') {
  const W = 1080, H = 1080;
  const elements = [{ text: title, x: 540, y: 120, size: 65, weight: 'bold' }];
  let posY = 120;
  for (const line of lines) {
    posY += line.gap || 100;
    elements.push({ text: line.text, x: 540, y: posY, size: 40, weight: line.bold ? 'bold' : 'normal' });
  }

  const pipeline = sharp('static/beta/images/bg/social.png')
    .resize(W, H, { fit: 'cover' })
    .composite([{ input: svgOverlay(W, H, elements) }]);

  return (format === 'jpeg' ? pipeline.jpeg({ quality: 90 }) : pipeline.png()).toBuffer();
}

async function drawTournamentImage(title, lines, filename) {
  const generatedDir = 'static/beta/images/generated';
  await fs.mkdir(generatedDir, { recursive: true });
  const buf = await drawTournamentBuffer(title, lines, 'png');
  await fs.writeFile(`static/beta/images/generated/${filename}`, buf);
}

exports.tournamentSocial = async function(req, res, next) {
  try {
    // Content comes from TOURNAMENT_POSTERS, the same object GET /tournament-image reads,
    // so the file on disk and the image served on demand cannot say different things.
    await Promise.all(
      ['open', 'b', 'c', 'supervet'].map(key => {
        const p = TOURNAMENT_POSTERS[key];
        return drawTournamentImage(p.title, p.lines, p.file);
      })
    );
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
};

exports.handicapTournamentSocial = async function(req, res, next) {
  try {
    const p = TOURNAMENT_POSTERS.handicap;
    await drawTournamentImage(p.title, p.lines, p.file);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
};



