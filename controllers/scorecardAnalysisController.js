const multer   = require('multer');
const { distance } = require('fastest-levenshtein');
const { analyseImage }         = require('./cornerDetection');
const { extractScorecardData } = require('./scorecardExtraction');
const Team     = require('../models/teams');
const Player   = require('../models/players');
const Division = require('../models/division');

// ── Multer — memory storage, 10 MB limit ─────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/')
      ? cb(null, true)
      : cb(new Error('Only image files are accepted')),
});

exports.uploadMiddleware = upload.single('scorecard');

// ── Date normalisation ────────────────────────────────────────────────────────
// OCR produces dates in whatever the captain wrote. Try common UK formats and
// return an ISO YYYY-MM-DD string, or null if unparseable.

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function normaliseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (2 or 4 digit year)
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = '20' + y;
    const date = new Date(+y, +m - 1, +d);
    if (!isNaN(date)) return date.toISOString().slice(0, 10);
  }

  // "15 Jan 2026" or "15th January 2026" or "January 15 2026"
  const textDate = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\s+(\d{2,4})/);
  if (textDate) {
    const [, d, mon, y] = textDate;
    const m = MONTHS[mon.slice(0, 3).toLowerCase()];
    if (m) {
      const year = y.length === 2 ? '20' + y : y;
      const date = new Date(+year, m - 1, +d);
      if (!isNaN(date)) return date.toISOString().slice(0, 10);
    }
  }
  const textDate2 = s.match(/([A-Za-z]{3,})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/);
  if (textDate2) {
    const [, mon, d, y] = textDate2;
    const m = MONTHS[mon.slice(0, 3).toLowerCase()];
    if (m) {
      const year = y.length === 2 ? '20' + y : y;
      const date = new Date(+year, m - 1, +d);
      if (!isNaN(date)) return date.toISOString().slice(0, 10);
    }
  }

  return null;
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────

function similarity(a, b) {
  const norm = s => s.toLowerCase().trim();
  const na = norm(a), nb = norm(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - distance(na, nb) / maxLen;
}

function bestMatch(needle, haystack, keyFn, threshold = 0.6) {
  let best = null, bestScore = -1;
  for (const item of haystack) {
    const score = similarity(needle, keyFn(item));
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= threshold ? { item: best, score: bestScore } : null;
}

// ── Player assignment ─────────────────────────────────────────────────────────
// OCR gives a flat list of names; we fuzzy-match each against the eligible
// male and female player lists and assign to the form field slots in card order.

async function matchPlayers(ocrNames, teamId) {
  const [males, females] = await Promise.all([
    Player.findElgiblePlayersFromTeamId(teamId, 'Male'),
    Player.findElgiblePlayersFromTeamId(teamId, 'Female'),
  ]);

  const fullName = p => `${p.first_name} ${p.family_name}`;

  const men = [], ladies = [];
  for (const name of ocrNames) {
    const mMatch = bestMatch(name, males,   fullName);
    const fMatch = bestMatch(name, females, fullName);
    const mScore = mMatch?.score ?? -1;
    const fScore = fMatch?.score ?? -1;
    if (mScore <= 0.5 && fScore <= 0.5) continue;
    if (mScore >= fScore) { men.push(   { id: String(mMatch.item.id), name: fullName(mMatch.item), score: mScore }); }
    else                  { ladies.push({ id: String(fMatch.item.id), name: fullName(fMatch.item), score: fScore }); }
  }

  return { men: men.slice(0, 3), ladies: ladies.slice(0, 3) };
}

// ── Score pair → form field mapping ──────────────────────────────────────────
// pointsPairs come from extractPointsPairs() in Y order, which matches the
// printed scorecard layout: games 1-2 (1st Mens), 3-4 (1st Ladies), … 17-18 (3rd Mixed).

function mapScores(pointsPairs) {
  const scores = {};
  pointsPairs.slice(0, 18).forEach(({ homePoints, awayPoints }, i) => {
    const n = i + 1;
    if (homePoints != null) scores[`Game${n}homeScore`] = homePoints;
    if (awayPoints != null) scores[`Game${n}awayScore`] = awayPoints;
  });
  return scores;
}

// ── POST /api/analyse-scorecard ───────────────────────────────────────────────

exports.analyse_scorecard = async function(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    // Step 1: perspective-correct coordinates + OCR
    const { textBlocks, imageWidth, imageHeight } = await analyseImage(req.file.buffer);

    // Step 2: region-based extraction
    const { metadata, homePlayers, awayPlayers, pointsPairs } = await extractScorecardData({
      textBlocks, imageWidth, imageHeight,
    });

    // Step 3: fuzzy-match team names and division to IDs (parallel)
    const [allTeams, allDivisions] = await Promise.all([Team.getAll(), Division.getAll()]);

    const homeTeamMatch = bestMatch(metadata.homeTeam, allTeams, t => t.name, 0.5);
    const awayTeamMatch = bestMatch(metadata.awayTeam, allTeams, t => t.name, 0.5);
    const homeTeamId = homeTeamMatch ? String(homeTeamMatch.item.id) : null;
    const awayTeamId = awayTeamMatch ? String(awayTeamMatch.item.id) : null;

    // Division: fuzzy-match the extracted text against division names.
    // Also try stripping "Division " prefix and matching on the ordinal ("1", "2" etc.)
    const divMatch = bestMatch(metadata.division, allDivisions, d => d.name, 0.5)
                  || bestMatch(metadata.division.replace(/division\s*/i, ''), allDivisions, d => d.name, 0.5);
    const divisionId = divMatch ? String(divMatch.item.id) : null;

    // Step 4: fuzzy-match player names to IDs, constrained to each team's eligible players
    let playerFields = {};
    if (homeTeamId) {
      const { men, ladies } = await matchPlayers(homePlayers, homeTeamId);
      men.forEach(   (p, i) => { playerFields[`homeMan${i + 1}`]  = p.id; });
      ladies.forEach((p, i) => { playerFields[`homeLady${i + 1}`] = p.id; });
    }
    if (awayTeamId) {
      const { men, ladies } = await matchPlayers(awayPlayers, awayTeamId);
      men.forEach(   (p, i) => { playerFields[`awayMan${i + 1}`]  = p.id; });
      ladies.forEach((p, i) => { playerFields[`awayLady${i + 1}`] = p.id; });
    }

    // Step 5: build response in form-field format
    res.json({
      date:     normaliseDate(metadata.date),
      division: divisionId,
      homeTeam: homeTeamId,
      awayTeam: awayTeamId,
      ...playerFields,
      ...mapScores(pointsPairs),
      _meta: {
        dateRaw:            metadata.date,
        divisionRaw:        metadata.division,
        divisionConfidence: divMatch?.score ?? 0,
        homeTeamRaw:        metadata.homeTeam,
        awayTeamRaw:        metadata.awayTeam,
        homeTeamConfidence: homeTeamMatch?.score ?? 0,
        awayTeamConfidence: awayTeamMatch?.score ?? 0,
        scoresFound:        pointsPairs.filter(p => p.homePoints != null).length,
      },
    });
  } catch (err) {
    console.error('Scorecard analysis failed:', err.message);
    res.status(500).json({ error: err.message });
  }
};
