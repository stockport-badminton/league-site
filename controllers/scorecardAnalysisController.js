const multer   = require('multer');
const Sentry   = require('@sentry/node');
const { extractEmbeddedImage, isRefusedArchive } = require('../utils/documentImage');
const { storeImage } = require('../utils/uploads');
const { distance } = require('fastest-levenshtein');
const { analyseImage }         = require('./cornerDetection');
const { extractScorecardData } = require('./scorecardExtraction');
const Team     = require('../models/teams');
const Player   = require('../models/players');
const Division = require('../models/division');

// ── Multer — memory storage, 10 MB limit ─────────────────────────────────────

// 25MB, up from 10.
//
// Only 5 of 1,494 objects in the bucket exceed 10MB, and THREE of those are genuine
// scorecards a captain filed: a 20.3MB pdf, a 13.5MB png and an 11.9MB jpeg. So the old
// cap was refusing real cards, and had been for two seasons. The largest legitimate one is
// 20.3MB; 25MB clears it and still refuses the 25.2MB zip, which is the only object above
// that and was never a supported scorecard.
//
// Size is not the safety mechanism — a 20MB jpeg is an ordinary phone photo while a 20MB
// pdf can declare a 20,000x20,000 image, and no byte count separates those. The shape
// checks in utils/documentImage.js do that. This cap is only here to refuse the absurd.
const MAX_BYTES = 25 * 1024 * 1024;

// A rejected upload is a captain making an ordinary mistake, not a fault.
//
// A logged-in captain hit this on 4 Sep 2026 (Sentry NODE-Z) and tried twice, a minute
// apart, with two different files of 144KB and 94KB — a desktop, so not phone photos.
// Both were refused by the `image/*` test, and because multer's fileFilter error went
// straight to the central HTML error handler they arrived as a **500**. The uploader reads
// `xhr.responseJSON.error`, which an HTML 500 does not carry, so all they saw was "Could
// not read the scorecard. Please fill in manually." Nothing said the FILE TYPE was the
// problem — which is why they tried a second file rather than converting the first.
//
// So the type gate stays, and the message earns its keep instead.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    // A zip was never a supported scorecard — the one in the bucket has no row pointing at
    // it, so nothing ever displayed it — and unpacking arbitrary archives from an
    // unauthenticated endpoint is a different risk class. Refused by name, before anything
    // reads a byte of it.
    if (isRefusedArchive(file.originalname)) {
      const err = new Error('Archives are not accepted');
      err.code = 'REFUSED_ARCHIVE';
      return cb(err);
    }
    // Word and pdf scorecards are accepted now and converted below — they are 7% of the
    // cards on record, so sending one is ordinary behaviour.
    if (/\.(pdf|docx)$/i.test(file.originalname || '') ||
        /pdf|wordprocessingml/i.test(file.mimetype || '')) {
      return cb(null, true);
    }
    // Some browsers hand a HEIC or an unusual camera format over as
    // application/octet-stream, so fall back to the extension rather than refusing a
    // photo for the sake of a bad content type.
    if (/\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.originalname || '')) {
      return cb(null, true);
    }
    const err = new Error('Only image files are accepted');
    err.code = 'UNSUPPORTED_FILE_TYPE';
    err.mimetype = file.mimetype;
    err.originalname = file.originalname;
    cb(err);
  },
});

const single = upload.single('scorecard');

// Wraps the multer middleware so a refusal answers 400 JSON, in the shape the uploader
// already displays, rather than falling through to the HTML 500 page.
exports.uploadMiddleware = function (req, res, next) {
  single(req, res, err => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      // Reachable with an ordinary phone photo: a modern camera JPEG can exceed 10MB.
      return res.status(400).json({
        error: 'That photo is larger than 25MB. Try again with a smaller one — ' +
               'most phones can send a reduced-size copy.',
      });
    }

    if (err.code === 'REFUSED_ARCHIVE') {
      return res.status(400).json({
        error: 'Zip files are not accepted. Send the photo or the document itself.',
      });
    }

    if (err.code === 'UNSUPPORTED_FILE_TYPE') {
      // No PDF branch here any more: pdf and docx now pass the filter and are converted
      // in the handler, so a refusal reaching this point is a format nothing here reads.
      // An unconvertible pdf is refused later, with its own message.
      return res.status(400).json({
        error: 'That file is not a photo the reader can use. Send a JPEG, PNG or HEIC ' +
               'image of the card, or a photo pasted into a Word document.',
      });
    }

    return next(err);
  });
};

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

    // Step 0: a document scorecard is a photo with a wrapper around it — pull the photo
    // out and carry on as if that is what arrived.
    //
    // Every document scorecard on record is one embedded image and no text at all (0
    // words, 0 fonts, measured over the corpus), so this is a byte copy, not a render, and
    // needs no Ghostscript or pdf.js. See utils/documentImage.js.
    //
    // Extraction handles ~65% of the real corpus — every docx, and the pdfs whose image is
    // a jpeg. The rest (office-scanner CCITT, raw pixel data) return null and are refused
    // BELOW rather than crashing: about three cards a season, and telling the captain
    // plainly beats a 500.
    let imageBuffer = req.file.buffer;
    // Set when a document's image has been stored, so it is still reported if the OCR
    // below throws. The photo is the record; reading it is a bonus.
    let storedPhoto = null;
    const isDocument = /\.(pdf|docx)$/i.test(req.file.originalname || '') ||
                       /pdf|wordprocessingml/i.test(req.file.mimetype || '');
    if (isDocument) {
      const extracted = extractEmbeddedImage(req.file.buffer, req.file.originalname);
      if (!extracted) {
        // Do NOT offer to attach the document instead. `/sign-s3` accepts jpeg, png,
        // webp and heic only (utils/uploads.js), so there is no path that stores a pdf
        // or a docx — the ones in the bucket predate that check. An earlier version of
        // this message said the file "can still be attached to the scorecard", which
        // was untrue and would have sent a captain round a loop that cannot close.
        return res.status(400).json({
          error: 'The photo could not be pulled out of that file. Take a photo of the ' +
                 'card with your phone and upload that instead.',
        });
      }
      imageBuffer = extracted.buffer;
      // So a caller can reach the image rather than the wrapper.
      res.locals.convertedImage = extracted;

      // Store the extracted image, not the document. `/sign-s3` accepts images only, so
      // this is the ONLY way a document scorecard's photo gets into the bucket — and the
      // right way round: what lands is an ordinary jpeg, so the photo proxy serves it,
      // the browser shows it inline, and next season's OCR can read it again. Keeping
      // the pdf instead would preserve the thing captains find annoying to open.
      //
      // Before the OCR, deliberately. If Vision or the extraction throws, the captain
      // still gets their photo back rather than losing it to an error further down.
      //
      // A failure here must not fail the request: the OCR is still worth having, and the
      // response says `photoStored: false` so the page can tell them to attach a photo
      // the usual way rather than assuming it worked.
      try {
        storedPhoto = await storeImage({
          buffer: extracted.buffer,
          contentType: extracted.contentType,
          hint: req.file.originalname,
        });
      } catch (err) {
        console.error('analyse-scorecard: storing the extracted photo failed:', err.message);
        Sentry.captureException(err);
      }
    }

    // Step 1: perspective-correct coordinates + OCR
    const { textBlocks, imageWidth, imageHeight } = await analyseImage(imageBuffer);

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
      // Only present for a document upload: the URL of the image pulled out of it, for
      // the page to drop into its `scoresheet-url` field. An image upload does its own
      // presigned PUT and does not need this.
      ...(isDocument ? {
        photoUrl: storedPhoto ? storedPhoto.url : null,
        photoStored: !!storedPhoto,
      } : {}),
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
