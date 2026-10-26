// Filing a league result: uploads, drafts, publishing, the photo read path, the live scorecard.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const scorecard_controller = require('../controllers/scorecardController');
const scorecard_analysis_controller = require('../controllers/scorecardAnalysisController');
const live_scorecard_controller = require('../controllers/liveScorecardController');
const { buildUploadKey, objectUrl } = require('../utils/uploads');
// The read path for a scorecard photo (HARD-02b) — see GET /scorecard-photo/:id below.
const { sendPhoto } = require('../utils/scorecardPhoto');
const { mayOpenDraft } = require('../utils/scorecardLinks');
const Fixture = require('../models/fixture');
const { publicFormLimiter, mediaLimiter } = require('../middleware/rateLimit');

// S3 signed URL for scorecard uploads
// Presigned upload for a scorecard photo.
//
// This took `file-name` and `file-type` straight from the query string and returned a
// presigned PUT with `ACL: public-read`. Both were attacker-chosen, so any anonymous
// caller could overwrite any object in the bucket by naming it — including the venues
// map and the generated weekly videos, which live in the same bucket — and could have
// the bucket serve HTML or an executable from our own storage by picking the type.
//
// The key is now generated server-side under a fixed `scorecards/` prefix and the
// content type has to be an image we recognise (see utils/uploads.js), so neither is
// reachable. `file-name` survives only as an advisory hint, sanitised down to letters
// and digits, so the results secretary can still tell photos apart in the bucket.
//
// **No `ACL: 'public-read'` any more** (HARD-02b). It was there because scorecard photos
// were rendered directly from the bucket by `<img src>` and by links already stored in
// `scorecardstore."scoresheet-url"`, so dropping it without a read path would have
// blanked every photo on the site, including on archived seasons. `GET
// /scorecard-photo/:id` above is that read path, and it serves the historical URL shapes
// as well as new keys, so the signer no longer asks for one.
//
// **What this does and does not do.** It stops a *new* object being made public by its
// own ACL. It does not touch objects already in the bucket, which keep the ACL they were
// written with, and it is overridden by a bucket policy granting public read. Both of
// those live on the bucket rather than in this repo — see the runbook in
// docs/hardening/HARD-02b-private-scorecard-photos.md for the order to do them in and
// how to reverse each. Until they are done, photos are still publicly readable; nothing
// here breaks either way, because the read path does not depend on the object being
// private or public.
//
// Residual, unchanged: an anonymous caller can still upload a JPEG under a random name
// in `scorecards/`. That is a storage-cost nuisance, the endpoint carries
// publicFormLimiter, and a lifecycle rule on the prefix is the answer rather than more
// code. Still deliberately out of scope, as is deleting what is already there.
router.get('/sign-s3', access.public, publicFormLimiter, async (req, res, next) => {
  try {
    const { key } = buildUploadKey(req.query['file-type'], req.query['file-name']);
    const s3 = new S3Client({ region: 'eu-west-1' });
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      ContentType: String(req.query['file-type']).toLowerCase().trim()
    });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    // objectUrl, not a literal: `storeImage` hands the same shape to the OCR uploader
    // and normalisePhotoUrl has to accept both, so there is one definition of it.
    const url = objectUrl(key);
    // `signedUrl` for the two scorecard views, `signedRequest`/`url` for
    // views/scorecard-upload.ejs, which has always read those names and so has never
    // worked against this endpoint. Same values, three keys, no caller left broken.
    res.json({ signedUrl, signedRequest: signedUrl, url, key });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('sign-s3 failed:', err.message);
    next(err);
  }
});

// Scorecard routes
// The gate goes BEFORE validation so an unauthorized caller is refused without the
// fixture lookups that validation and resolution would otherwise run. See
// middleware/requirePublishAuthority.js for who may publish and why `secured` is not it.
router.post('/scorecard-beta', access.publish, publicFormLimiter, scorecard_controller.validateScorecard, scorecard_controller.full_fixture_post);
// Public, and on the list for review (REARCH-04 step 2): GET /email-scorecard is `secured`,
// this POST that files the draft and emails the results secretary is not. Gating it would
// risk losing a captain's result to a session expiring mid-form, so it is a decision for
// the owner rather than an omission. See the brief.
router.post('/email-scorecard', access.public, publicFormLimiter, scorecard_controller.validateScorecard, scorecard_controller.fixture_populate_scorecard_errors);
router.post('/add-scorecard-photo/:id', access.token('draft link'), publicFormLimiter, scorecard_controller.add_scorecard_photo);
router.post('/submit-form', access.public, publicFormLimiter, (req, res, next) => {
  scorecard_controller.fixture_populate_scorecard(req.body, req, res, next);
});
router.get('/populated-scorecard-beta/:id', access.token('draft link'), (req, res, next) => {
  scorecard_controller.fixture_populate_scorecard_fromId(req, res, next);
});

// GET /scorecard-photo/:id — the only way a scorecard photo is read (HARD-02b).
//
// Scorecard photos were `ACL: public-read` and rendered straight out of the bucket, with
// the URL stored in `scorecardstore."scoresheet-url"` and emailed to the results
// secretary. So the authorization on a photo of a match was "know the URL", forever, for
// anyone the email was ever forwarded to; and the objects could not be made private
// without blanking every photo the site has, including on archived seasons.
//
// **This route is keyed by draft id, never by object key.** That is the whole design.
// Every part of the object's identity comes from the row:
//
//   - the draft must exist, and must have a photo (404 otherwise);
//   - **who may see it is exactly who may see the draft** — `mayOpenDraft`, the same
//     per-draft token as the confirmation page (HARD-03), including the same
//     grandfather clause for links filed before migration 011. There is deliberately
//     not a second authorization model for photos: a photo of a scorecard is the
//     scorecard;
//   - the key comes from `photoKeyFromStored`, which accepts only an object in our own
//     bucket and refuses the prefixes belonging to the venues map and the weekly videos
//     (a row could name one — `POST /add-scorecard-photo/:id` accepted any string for
//     years before HARD-03);
//   - the content type is one we recognise as an image or the answer is 404. Objects
//     predating HARD-02 were uploaded with a caller-chosen type, and echoing that back
//     would make this a way to serve HTML from our *own origin*, which is worse than
//     from the bucket because here it is same-origin with the session cookie.
//
// Modelled on the venues-map proxy in app.js, which does the same thing for a public
// object. `Cache-Control: private` because the token in the query string is the
// authorization, so a shared cache must not hold the answer.
router.get('/scorecard-photo/:id', access.token('draft link'), mediaLimiter, async (req, res, next) => {
  try {
    const rows = await Fixture.getScorecardById(req.params.id);
    if (!rows || !rows.length) return res.status(404).end();
    const draft = rows[0];

    if (!mayOpenDraft(draft.confirmToken, req.query.t)) return res.status(403).end();

    return await sendPhoto(res, draft['scoresheet-url']);
  } catch (err) {
    next(err);
  }
});

router.post('/api/analyse-scorecard', access.member,
  scorecard_analysis_controller.uploadMiddleware,
  scorecard_analysis_controller.analyse_scorecard);
// Convert a document scorecard to a stored image, WITHOUT reading it. The form keeps two
// upload boxes on purpose — the auto-fill one reads the card, the plain photo one does
// not — so a captain who would rather no machine read their card still has a route for a
// scanner PDF. Documents only; an image goes straight to S3 on a presigned PUT.
router.post('/api/convert-scorecard-document', access.member,
  scorecard_analysis_controller.uploadMiddleware,
  scorecard_analysis_controller.convert_scorecard_document);
router.get('/scorecard-beta', access.member, scorecard_controller.scorecard_beta);
router.get('/email-scorecard', access.member, scorecard_controller.email_scorecard);

// Live scorecard (proof of concept) — filled in at the match from players' phones, signed
// off by both captains, filed as an ordinary draft. Starting one needs a login; using one
// needs only its link, which is the point. The poll, GET /api/live-scorecard/:id/state, is
// mounted in app.js. See controllers/liveScorecardController.js.
router.get('/live-scorecard', access.member, live_scorecard_controller.start);
router.post('/live-scorecard', access.member, publicFormLimiter, live_scorecard_controller.create);
router.get('/live-scorecard/:id/share', access.member, live_scorecard_controller.share);
router.get('/live-scorecard/:id', access.token('live-scorecard link'), live_scorecard_controller.card);
router.post('/api/live-scorecard/:id/players', access.token('live-scorecard link'), live_scorecard_controller.setPlayer);
router.post('/api/live-scorecard/:id/games/:n', access.token('live-scorecard link'), live_scorecard_controller.setGame);
router.post('/api/live-scorecard/:id/sign', access.token('live-scorecard link'), live_scorecard_controller.sign);

module.exports = router;
