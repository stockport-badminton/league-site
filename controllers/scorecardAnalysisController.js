const multer   = require('multer');
const Sentry   = require('@sentry/node');
const { extractEmbeddedImage, isRefusedArchive } = require('../utils/documentImage');
const { storeImage, FAILED_PREFIX, FAILED_UPLOAD_TYPES } = require('../utils/uploads');
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

// ── Turning a document into a stored image ────────────────────────────────────
//
// Shared by both endpoints below, because the *rules* must not differ between them: the
// same 25MB cap, the same archive refusal, the same extraction, the same allowlist on the
// way into the bucket. Two copies of "what may be uploaded" is how one of them drifts.

const isDocumentUpload = file =>
  /\.(pdf|docx)$/i.test(file.originalname || '') ||
  /pdf|wordprocessingml/i.test(file.mimetype || '');

// The message a captain sees when Phase 1 cannot read their file. Deliberately does NOT
// offer to attach the document: `/sign-s3` accepts jpeg, png, webp and heic only
// (utils/uploads.js), so there is no path that stores a pdf or a docx — the ones in the
// bucket predate that check. An earlier version of this said the file "can still be
// attached to the scorecard", which was untrue and sent captains round a loop that
// cannot close.
const CANNOT_EXTRACT =
  'The photo could not be pulled out of that file. Take a photo of the card with your ' +
  'phone and upload that instead.';

// Extract, then store the IMAGE — never the wrapper. Storing the pdf would preserve
// exactly what captains find annoying about it: a file the browser will not open inline.
//
// Returns { extracted, stored } where `stored` is null if the PUT failed. A store failure
// is reported, not thrown, because the caller may still have something worth returning
// (the OCR prefill) and losing that as well helps nobody.
async function convertDocument(file) {
  const extracted = extractEmbeddedImage(file.buffer, file.originalname);
  if (!extracted) return { extracted: null, stored: null };

  let stored = null;
  try {
    stored = await storeImage({
      buffer: extracted.buffer,
      contentType: extracted.contentType,
      hint: file.originalname,
    });
  } catch (err) {
    console.error('scorecard document: storing the extracted photo failed:', err.message);
    Sentry.captureException(err);
  }
  return { extracted, stored };
}

// ── POST /api/convert-scorecard-document ──────────────────────────────────────
//
// Convert a document scorecard to a stored image and hand back its URL. **No OCR.**
//
// That is the whole reason it is a separate endpoint rather than a flag on the analysis
// one. The scorecard form keeps two upload boxes on purpose: the auto-fill box, which
// reads the card, and the plain photo box, which does not. Some captains would rather
// their card were not read by a machine, and until the OCR has a season behind it that is
// a preference worth honouring rather than designing away. It is also cheaper — no Vision
// units — but that is not the argument.
//
// Documents only. An image belongs on the presigned PUT from `/sign-s3`, which does not
// pass the bytes through the server at all.
// Keep whatever was uploaded, when we are about to refuse it.
//
// Wider than `storeFailedImage` below in two ways, and both matter. It keeps the file as
// it ARRIVED — the pdf or docx, not an image pulled out of it — because on this path
// there is no image: the failure IS that one could not be extracted. And it runs on the
// **4xx refusals**, which return early and never reach the catch block, so nothing the
// catch does could ever have covered them.
//
// Never throws and never changes what the captain sees. Their problem is the upload did
// not work; "we also could not save your file" is not theirs to act on.
async function keepUnreadableUpload(req) {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) return null;
  try {
    const { key } = await storeImage({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      hint: req.file.originalname,
      prefix: FAILED_PREFIX,
      types: FAILED_UPLOAD_TYPES,
    });
    return key;
  } catch (storeErr) {
    console.warn('Could not keep the unreadable upload:', storeErr.message);
    return null;
  }
}

// Refuse an upload, keep it, and say which check refused it.
//
// Every one of these branches used to `return res.status(400).json(...)` and log nothing
// at all, so a refusal left a status code in the request log and no other trace: not which
// of the three checks fired, not the file. Measured 17 Sep 2026 — a captain's Aerospace
// card was refused by this endpoint and there was no way to tell which branch did it, on
// the very endpoint HARD-36 had just been written to make diagnosable.
//
// `reason` is for us and never reaches the captain; `error` is the captain's message and
// is unchanged by any of this.
//
// `keep` is false where the file would tell us nothing. A refusal about ROUTING — an image
// posted to the document endpoint — is completely explained by the content type, which is
// in the log line; keeping the bytes would add nothing and a scorecard photo carries twelve
// players' names and both captains' signatures. Only a refusal about CONTENT, where the
// complaint is that we could not read the thing, needs the thing.
async function refuseUpload(req, res, status, error, reason, { keep = true } = {}) {
  const key = keep ? await keepUnreadableUpload(req) : null;
  console.error(
    'Scorecard upload refused:', reason,
    key ? `[file: ${key}]` : keep ? '[file: not stored]' : '[file: not kept, nothing to learn from it]');
  return res.status(status).json({ error });
}

exports.convert_scorecard_document = async function(req, res) {
  try {
    if (!req.file) {
      console.error('Scorecard upload refused: no file on the request [file: not stored]');
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!isDocumentUpload(req.file)) {
      return refuseUpload(req, res, 400,
        'That is not a PDF or Word file. A photo does not need converting — ' +
        'upload it directly.',
        `not a document (${req.file.mimetype})`,
        { keep: false });
    }

    const { extracted, stored } = await convertDocument(req.file);
    if (!extracted) {
      // The case this whole helper exists for. No image came out, so there is nothing
      // under the ordinary prefix and the wrapper is the only evidence there will ever be.
      return refuseUpload(req, res, 400, CANNOT_EXTRACT,
        `no image could be extracted (${req.file.mimetype})`);
    }
    if (!stored) {
      // Nothing else to fall back on here: unlike the analysis endpoint there is no
      // prefill to return, so a failed store IS the failure.
      return refuseUpload(req, res, 502,
        'The photo was read out of your file but could not be saved. Please try ' +
        'again, or upload a photo of the card instead.',
        'the extracted image could not be stored');
    }

    res.json({ url: stored.url, contentType: extracted.contentType });
  } catch (err) {
    console.error('convert-scorecard-document failed:', err.message);
    Sentry.captureException(err);
    res.status(500).json({ error: 'Could not convert that file.' });
  }
};

// ── POST /api/analyse-scorecard ───────────────────────────────────────────────

// Store the image an analysis could not read, and never let that failure matter.
//
// Returns the key, or null. A failed store must not change what the captain sees: their
// problem is that the auto-fill did not work, and "we also could not save your photo"
// helps nobody and is not theirs to act on. Same rule `convertDocument` already follows
// for the document path, and the same rule `utils/afterCommit.js` states at length.
//
// A document upload is skipped, and that is still right — but only because it is now
// narrower than it looks. By the time this runs, extraction SUCCEEDED and `convertDocument`
// has already stored the image under the ordinary prefix, so a second copy here would keep
// the same photo twice under two different retentions. The case where extraction FAILED
// never gets here at all: it returns 4xx from inside the try, and is kept by
// `refuseUpload` above instead.
async function storeFailedImage(req, isDocument) {
  if (isDocument) return null;
  if (!req.file || !req.file.buffer || !req.file.buffer.length) return null;
  try {
    const { key } = await storeImage({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      hint: req.file.originalname,
      prefix: FAILED_PREFIX,
    });
    return key;
  } catch (storeErr) {
    // Deliberately not Sentry: the analysis failure is the event worth seeing, and a
    // second exception beside every one of them is how a project stops being read.
    console.warn('Could not keep the unreadable scorecard image:', storeErr.message);
    return null;
  }
}

exports.analyse_scorecard = async function(req, res) {
  // Declared out here because the catch needs it: a document's image is already stored by
  // convertDocument, before the OCR, so the failure path must not store a second copy of
  // the same photo under a different retention. Scoped inside the try, it was simply not
  // defined where it was read — a ReferenceError on every failure, which is the one path
  // that had no test until this one.
  let isDocument = false;
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
    isDocument = isDocumentUpload(req.file);
    if (isDocument) {
      const { extracted, stored } = await convertDocument(req.file);
      if (!extracted) {
        // Same hole as the convert endpoint had, for the same reason: this returns from
        // inside the try, so the catch below — and `storeFailedImage` with it — never runs.
        return refuseUpload(req, res, 400, CANNOT_EXTRACT,
          `no image could be extracted (${req.file.mimetype})`);
      }
      imageBuffer = extracted.buffer;
      storedPhoto = stored;
      // So a caller can reach the image rather than the wrapper.
      res.locals.convertedImage = extracted;
      // convertDocument has already stored it — before the OCR, deliberately, so that if
      // Vision throws the captain still gets their photo back rather than losing it to an
      // error further down. A failed store does not fail this request: the prefill is
      // still worth having, and `photoStored: false` tells the page to say so.
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
      // the page to drop into its `scoresheet-url` field.
      //
      // An image upload gets nothing here — this endpoint reads the bytes and discards
      // them. **Storing it is then the page's job, and the page must actually do it.**
      // This used to say "an image upload does its own presigned PUT and does not need
      // this", which was true of the step-13 photo box and not of the auto-fill box that
      // posts here: they are different inputs, and choosing a file in one does not
      // populate the other. So an image auto-filled at step 1 was analysed and thrown
      // away — no object in the bucket, nothing in scoresheet-url, and the draft filed
      // with no photo, while the form told the captain it had one (draft 2439, 9 Sep).
      // e2e/scorecard.spec.js 'the auto-fill box' now holds that end up.
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
    // Expected failures carry a `status` — see analyseImage in cornerDetection.js. A
    // scorecard the reader cannot line up is the caller's condition, not ours, and every
    // one used to come back as a 500 carrying its internal message. Two costs: the
    // captain reads a crash where the honest answer is "we cannot read this one", and
    // CLAUDE.md's rule for /api/ routes — pass 4xx messages through, never 5xx ones,
    // since those can carry SQL — was being broken on every unexpected throw.
    const status = err.status || 500;

    // Keep the image that could not be read (HARD-36).
    //
    // Until now this endpoint discarded the bytes unless the analysis SUCCEEDED, so a
    // failure left only a log line and a request size. On 16 Sep a captain's first two
    // photos failed and the third worked, and diagnosing it meant working from the one
    // image that had, by definition, succeeded — which cannot answer what was different
    // about the two that did not.
    //
    // The message already distinguishes "we refused it" from "it was not there"; this is
    // what makes that message checkable, because `outside[yMax=0.45]` is only believable
    // if somebody can look at the photo it describes.
    //
    // Its own prefix, carrying a 14-day S3 lifecycle expiry. A scorecard photo is the
    // league's record of a result and is kept; this is diagnostic scrap with twelve
    // players' names on it and is not.
    const failedKey = await storeFailedImage(req, isDocument);
    console.error(
      'Scorecard analysis failed:', err.detail || err.message,
      failedKey ? `[image: ${failedKey}]` : '[image: not stored]');

    if (status >= 500) {
      // Only the genuine faults. Reporting a photo of the wrong scorecard as an
      // exception is how a Sentry project stops being read.
      Sentry.captureException(err, { tags: { stage: 'scorecard-analysis' } });
      return res.status(500).json({
        error: 'Something went wrong reading that scorecard. Fill the form in yourself ' +
               'and attach the photo at the end — nothing is lost.',
      });
    }

    res.status(status).json({ error: err.message });
  }
};
