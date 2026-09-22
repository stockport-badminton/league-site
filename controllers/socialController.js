const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { getAllLeagueTables } = require('../models/league');
const Fixture = require('../models/fixture');
const { canonicalFor } = require('../utils/canonical');
// The shared card chrome — background lookup, dark panel, division letter, and the
// league's name and host. See utils/socialCard.js for why the letter and the panel are
// drawn rather than baked into the artwork (HARD-37).
const {
  LEAGUE_NAME, SITE_HOST, escapeXml, text, panel, divisionLetter, glyph,
  backgroundFor, subjectFor, subjectLayer,
} = require('../utils/socialCard');

function svgOverlay(width, height, elements) {
  // `text:` is aliased because the shared helper of that name is imported at the top, and a
  // destructured parameter would shadow it — harmless here, a trap for the next edit.
  const els = elements.map(({ text: value, x, y, size, weight = 'normal', fill = '#000', anchor = 'middle' }) =>
    `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`
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

/**
 * The result card.
 *
 * Redesigned as part of HARD-37, and it had to be: the old layout wrote BLACK text into the
 * bottom-right corner, which only worked because the artwork faded to near-white exactly
 * there. Take the fade away and the card is black-on-colour and unreadable — so re-pointing
 * the background and redesigning this were never two jobs, whatever the package's step list
 * implied.
 *
 * It is now a sibling of the fixtures card rather than an unrelated layout: same dark panel,
 * same league name, same host line, same derived accent. Two posts about the same league
 * looked like two different leagues.
 *
 * What it gained, both from HARD-37's acceptance criteria:
 *   - the LEAGUE'S NAME. The card carried the URL and nothing saying what competition this
 *     is, which is the outsider problem the fixtures card was given a name and URL to fix;
 *   - the DIVISION, in words. It used to be readable only as the letter baked into the
 *     artwork, so a reader had to already know that "P" meant Premier.
 */
function createResultCard(bgPath, data, W, H, accent, { letter = null, subject = null } = {}) {
  const { division, homeTeam, awayTeam, homeScore, awayScore } = data;

  // A SHALLOW panel across the BOTTOM, not one filling the frame.
  //
  // The first version filled it, and that buried the player — which defeats the point of
  // compositing one. The 2024 cards put their text on a fade across the bottom third
  // precisely so the player had the rest of the frame, and that composition is the reason
  // the artwork was ever worth using; a full-height panel turns the card into a coloured
  // mesh with a box on it.
  //
  // Shallow because this card only ever says two team names and a score. It began at 0.56
  // and was still mostly empty space, and every pixel the panel gives back is player.
  const bottom = Math.round(H * 0.94);
  const top = Math.round(H * 0.66);

  // Centred in the panel with the host line pinned to its foot, rather than a stack of
  // fixed offsets from the top: the story is 1080x1920 and the same panel is 40% taller
  // there, so fixed offsets leave the text high with a hole beneath it.
  const centre = Math.round((top + (bottom - 74)) / 2);

  // The letter sits in the free space above the panel. `top:` not `y:` — see glyph(); an
  // SVG baseline placed at "distance from the top of the card" loses the cap height off the
  // top of the frame, which is exactly what it did here.
  const body = `
    ${letter ? glyph(letter, { x: 70, top: Math.round(H * 0.035), size: Math.round(H * 0.20) }) : ''}
    ${panel({ x: 56, y: top, width: 968, height: bottom - top })}
    ${text(LEAGUE_NAME.toUpperCase(), 540, centre - 124, 22, { fill: '#ffffff', spacing: 2.5, weight: 'bold', opacity: 0.7 })}
    ${text(division, 540, centre - 70, 44, { weight: 'bold', fill: '#ffffff' })}
    <line x1="360" y1="${centre - 40}" x2="720" y2="${centre - 40}" stroke="#ffffff" stroke-width="2" opacity="0.2"/>
    ${text(homeTeam, 540, centre + 10, 40, { weight: 'bold', fill: '#ffffff' })}
    ${text(`${homeScore} - ${awayScore}`, 540, centre + 86, 72, { weight: 'bold', fill: accent })}
    ${text(awayTeam, 540, centre + 140, 40, { weight: 'bold', fill: '#ffffff' })}
    ${text(SITE_HOST, 540, bottom - 26, 24, { fill: '#ffffff', weight: 'bold', opacity: 0.6 })}`;

  // Background, then the PLAYER, then the panel and the text. The order is the design: the
  // panel is translucent, so it darkens whatever it covers rather than hiding it, and the
  // player reads through the lower half exactly as they did under the 2024 fade.
  const layers = [];
  if (subject) layers.push(subject);
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`) });

  return sharp(bgPath)
    .resize(W, H, { fit: 'cover' })
    .composite(layers)
    .jpeg({ quality: 90 })
    .toBuffer();
}

// Exported so a design change can be looked at without standing up a request. A test can
// prove a JPEG came out; it cannot prove the thing reads.
exports.createResultCard = createResultCard;

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
    const bgPath = await backgroundFor(division);
    const accent = await accentFor(bgPath);
    const data = { division, homeTeam, awayTeam, homeScore, awayScore };
    const fileBase = `static/beta/images/generated/${homeTeam.replace(/\s+/g, '+')}+${awayTeam.replace(/\s+/g, '+')}`;

    // The subject is scaled per size rather than once, because the story is a different
    // aspect and a layer placed for 4:5 lands in the wrong half of a 9:16 frame.
    const subjectPath = await subjectFor(division);
    const layerFor = (W, H) => subjectPath ? subjectLayer(subjectPath, { W, H }) : null;

    const postBuffer = await createResultCard(bgPath, data, 1080, 1350, accent,
      { subject: await layerFor(1080, 1350) });

    await Promise.all([
      sharp(postBuffer).toFile(`${fileBase}.jpg`),
      (async () => {
        const story = await createResultCard(bgPath, data, 1080, 1920, accent,
          { subject: await layerFor(1080, 1920) });
        return sharp(story).toFile(`${fileBase}-Ig.jpg`);
      })(),
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
//
// `no-store` only protects the 404s this file emits. **The dangerous one is a request made
// before the route existed at all**, which Express answers with its default HTML 404 page —
// carrying no Cache-Control, so Firebase applies `max-age=600` and the miss sticks for ten
// minutes after the deploy that fixed it. Demonstrated 16 Sep 2026 on `/fixtures-image`:
// the URL curled before deploying went on answering 404 afterwards while a sibling that
// nobody had asked for returned 200, and the same URL with a cache-buster returned 200.
//
// So: **do not request a new public route before deploying it**, and if a route looks dead
// after a deploy, tell the two apart before debugging the code — ours is `text/plain`, tens
// of bytes, `no-store`, `x-cache: MISS`; the stale one is `text/html`, ~14KB, `max-age=600`,
// `x-cache: HIT`.
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

// A day is right for a league table, which only changes when a result is published. It is
// wrong here: this card's content is a function of NOW(), so a copy cached on Sunday
// evening and served on Monday shows last week's window with nothing to say it is stale.
// An hour bounds that and still spares us regenerating the composite for each of Meta's
// repeat fetches, which is all the caching was ever for.
const FIXTURES_IMAGE_CACHE_CONTROL = 'public, max-age=3600';

// The lines the fixtures card prints, in order, grouped by the night each match is played.
//
// Grouped by night rather than listed flat because that is how a player reads a fixture
// list — "am I out on Tuesday" before "who are Tatton A playing". Exported so the test can
// assert on what the picture actually says rather than on a restatement of this arithmetic:
// a test that re-implements the layout passes against the bug just as happily, which is the
// lesson `tableRowValues` below exists to encode.
//
// Relies on the rows arriving in date order, which `getUpcomingWeek` guarantees with an
// ORDER BY. Without one the planner's order is arbitrary and a night would repeat.
function fixtureCardLines(fixtures) {
  const lines = [];
  let night = null;
  for (const f of fixtures) {
    const label = String(f.dayLabel || '').trim();
    if (label !== night) {
      night = label;
      lines.push({ kind: 'date', text: label });
    }
    lines.push({
      kind: 'fixture',
      home: String(f.homeTeam || ''),
      away: String(f.awayTeam || ''),
    });
  }
  return lines;
}

exports.fixtureCardLines = fixtureCardLines;

// The date range a card covers, from the SQL-formatted `dayLabel` ("Wed 16 Sep").
//
// Parsed out of that string rather than recomputed from `date`, for the same reason the
// label is formatted in SQL: no JS Date, no timezone, no chance of the heading disagreeing
// with the rows underneath it. Exported so the test reads what the card prints.
//
// It exists because **"Fixtures this week" means nothing to someone who finds the post
// later**, or who does not follow the league and has no idea which week is being referred
// to. The card has to stand on its own.
function fixtureDateRange(fixtures) {
  const parts = fixtures
    .map(f => String(f.dayLabel || '').trim().split(/\s+/).slice(1).join(' '))
    .filter(Boolean);
  if (!parts.length) return '';

  const first = parts[0], last = parts[parts.length - 1];
  if (first === last) return first;

  // "16 – 22 Sep" within a month, "28 Sep – 4 Oct" across one.
  const [, firstMonth] = first.split(' ');
  const [lastDay, lastMonth] = last.split(' ');
  return firstMonth === lastMonth
    ? `${first.split(' ')[0]} \u2013 ${lastDay} ${lastMonth}`
    : `${first} \u2013 ${last}`;
}

exports.fixtureDateRange = fixtureDateRange;
exports.fixturesBackground = (d) => fixturesBackground(d);

// Each division has its own artwork, and it is the artwork the RESULT card already uses —
// so a fixtures post and a result post for the same division look like the same league.
// Falls back to the plain background rather than throwing: a division whose name has no
// matching file (a rename, a new division, a friendly) should produce a duller card, not a
// 500 on a route Meta is fetching.
// Exported so the lookup can be tested directly. Comparing two RENDERED cards does not
// work: the division name is printed on the picture, so Premier and Division 1 differ in
// bytes whether or not their backgrounds do — a test that compared them passed happily
// against a version that used one background for everything.
async function fixturesBackground(divisionName) {
  return backgroundFor(divisionName);
}

// The accent colour for a division's card, taken from that division's own artwork.
//
// Derived rather than hardcoded so it follows the artwork: swap the background files
// (HARD-37) and the accent moves with them instead of becoming four stale hex values in a
// controller. Sampled from the TOP strip, because these images fade to near-white across
// the bottom third and `stats().dominant` over the whole picture returns that fade — which
// is how an earlier draft of this produced white text on a near-white bar.
//
// The sample is then forced to a fixed lightness and a minimum saturation. The hue carries
// the division's identity; the lightness is what makes it legible on the dark panel, and it
// must not be left to whatever the artwork happens to average out at.
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0))
          : max === g ? (b - r) / d + 2
          : (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = t => {
    t = (t + 1) % 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return { r: Math.round(hue(h + 1/3) * 255), g: Math.round(hue(h) * 255), b: Math.round(hue(h - 1/3) * 255) };
}

// Bright enough to read as a highlight on #0d0d0f at 80%, saturated enough to still say
// which division it is.
const ACCENT_LIGHTNESS = 0.72;
const ACCENT_MIN_SATURATION = 0.55;

async function accentFor(bgPath) {
  const strip = await sharp(bgPath)
    .resize(1080, 1350, { fit: 'cover' })
    .extract({ left: 0, top: 0, width: 1080, height: 330 })
    .toBuffer();
  const { dominant } = await sharp(strip).stats();
  const { h, s } = rgbToHsl(dominant.r, dominant.g, dominant.b);
  const { r, g, b } = hslToRgb(h, Math.max(s, ACCENT_MIN_SATURATION), ACCENT_LIGHTNESS);
  return `rgb(${r},${g},${b})`;
}

exports.accentFor = (p) => accentFor(p);

async function createFixturesImage(bgPath, divisionName, fixtures, format = 'png', accent = '#cccccc', { subject = null } = {}) {
  // 1080x1350, not the tables' square. It is what the result card uses, so the two posts
  // match; Instagram gives a 4:5 image more of the feed than a 1:1; and a list of fixtures
  // wants the vertical room.
  const W = 1080, H = 1350;
  const lines = fixtureCardLines(fixtures);

  // A DARK panel, at 0.80. A white one was tried first and does not work: to be legible it
  // has to be near-opaque, and at that point the division artwork underneath it may as well
  // not be there — which defeats the only reason for using the artwork. Dark lets the
  // colour read through while white text sits on it comfortably, so the picture keeps its
  // division identity and the fixtures stay readable.
  const PANEL_FILL = '#0d0d0f';
  const PANEL_OPACITY = 0.80;
  const PANEL_BOTTOM = 1270;

  // The panel GROWS UPWARD from the foot of the card, sized to its content, so a quiet week
  // leaves the player visible above it and a busy one takes the room it needs. It used to be
  // pinned near the top at a fixed height, which was fine when the artwork behind it was
  // scenery — but the player is composited now, and a panel that always fills the frame
  // buries them, which is the whole reason the artwork is there. The worst week this league
  // has had is about six fixtures in one division: eleven lines with the night headings.
  const HEADER = 340;   // league name down to the rule
  const FOOT = 95;      // the host line
  const MAX_STEP = 66;
  const MIN_PANEL_TOP = 180;

  const wanted = PANEL_BOTTOM - FOOT - lines.length * MAX_STEP - HEADER;
  const panelTop = Math.max(MIN_PANEL_TOP, wanted);
  const listTop = panelTop + HEADER;
  const listBottom = PANEL_BOTTOM - FOOT;

  // Recomputed after the clamp: once the panel has hit its ceiling, the only room left to
  // find is in the line spacing.
  const step = lines.length
    ? Math.min(MAX_STEP, Math.floor((listBottom - listTop) / lines.length))
    : 0;
  const rowSize = Math.max(22, Math.min(46, Math.round(step * 0.58)));
  const dateSize = Math.max(20, Math.round(rowSize * 0.80));

  // Home right-aligned, away left-aligned, the "v" pinned to the centre — so the column of
  // v's lines up and the eye runs down it. The widest pairing this league can produce is
  // "Bramhall Village B v Altrincham Central"; at 46px each half clears the panel edge.
  let y = listTop + Math.max(0, Math.round((listBottom - listTop - lines.length * step) / 2));
  let rows = '';
  for (const line of lines) {
    if (line.kind === 'date') {
      rows += text(line.text, 540, y, dateSize, { weight: 'bold', fill: accent, spacing: 2.2 });
    } else {
      rows += text(line.home, 515, y, rowSize, { anchor: 'end', fill: '#ffffff' });
      rows += text('v', 540, y, rowSize, { fill: '#ffffff', opacity: 0.35 });
      rows += text(line.away, 565, y, rowSize, { anchor: 'start', fill: '#ffffff' });
    }
    y += step;
  }

  const range = fixtureDateRange(fixtures);
  const body = `
    <rect x="56" y="${panelTop}" width="968" height="${PANEL_BOTTOM - panelTop}" rx="34"
          fill="${PANEL_FILL}" opacity="${PANEL_OPACITY}"/>
    ${text(LEAGUE_NAME.toUpperCase(), 540, panelTop + 74, 25, { fill: '#ffffff', spacing: 2.5, weight: 'bold', opacity: 0.7 })}
    ${text(divisionName, 540, panelTop + 160, 68, { weight: 'bold', fill: '#ffffff' })}
    ${text('Fixtures this week', 540, panelTop + 214, 36, { fill: accent })}
    ${range ? text(range, 540, panelTop + 260, 29, { fill: '#ffffff', opacity: 0.55 }) : ''}
    <line x1="340" y1="${panelTop + 302}" x2="740" y2="${panelTop + 302}" stroke="#ffffff" stroke-width="2" opacity="0.2"/>
    ${rows}
    ${text(SITE_HOST, 540, PANEL_BOTTOM - 42, 29, { fill: '#ffffff', weight: 'bold', opacity: 0.6 })}`;

  // Background, then the PLAYER, then the panel and the text — same order as the result
  // card. The panel is translucent, so whatever it covers is darkened rather than hidden.
  const layers = [];
  if (subject) layers.push(subject);
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`) });

  const pipeline = sharp(bgPath).resize(W, H, { fit: 'cover' }).composite(layers);

  return (format === 'jpeg' ? pipeline.jpeg({ quality: 90 }) : pipeline.png()).toBuffer();
}
// Exported for rendering a card outside a request — previewing a design change means
// looking at the picture, and a test can prove a JPEG came out but not that it reads.
exports.createFixturesImage = createFixturesImage;

// GET /fixtures-image/:division — one division's coming week, as a JPEG, built now.
//
// Public and unauthenticated, like the league table and tournament images and for the same
// reason: Meta fetches it from Meta's servers, not from a logged-in browser. It shows
// nothing that is not already on the fixtures page.
exports.fixturesImage = async function (req, res, next) {
  try {
    const wanted = stripImageExt(req.params.division).trim().toLowerCase();
    const rows = await Fixture.getUpcomingWeek();
    const mine = rows.filter(r => String(r.divisionName || '').trim().toLowerCase() === wanted);

    // A division with no matches this week is a 404 and NOT a blank card. The caller builds
    // its carousel from the divisions that have fixtures, so it should never ask for one
    // that does not — but if it does, an empty picture posted to Instagram is the failure
    // that nobody notices, and a 404 is the one that shows up in the post's own report.
    if (!mine.length) {
      return res.status(404).set('Cache-Control', SOCIAL_IMAGE_MISS_CACHE_CONTROL)
        .type('text/plain').send('No fixtures this week for that division');
    }

    const bg = await fixturesBackground(mine[0].divisionName);
    const subjectPath = await subjectFor(mine[0].divisionName);
    const buf = await createFixturesImage(bg, mine[0].divisionName, mine, 'jpeg', await accentFor(bg),
      { subject: subjectPath ? await subjectLayer(subjectPath, { W: 1080, H: 1350 }) : null });

    res.type('image/jpeg').set('Cache-Control', FIXTURES_IMAGE_CACHE_CONTROL).send(buf);
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



