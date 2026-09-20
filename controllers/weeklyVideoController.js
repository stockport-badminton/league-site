// The weekly results video post — the third of the scheduled social posts.
//
// It borrows the shape of `weeklyTablesController` and `weeklyFixturesController`
// deliberately: same `targets()`, same per-target reporting, same gate, same `?dry=1`,
// same 200/207/502. The differences are all about video.
//
// ── Why this one needs a generate step the others do not ────────────────────
//
// The tables and fixtures cards are rendered per request by a route Meta fetches directly.
// A video cannot be: encoding takes ~36 seconds, far longer than Meta will wait on a
// fetch, so it is built ahead of time, stored in S3, and served from
// `GET /social-video/:aspect`. This handler makes sure a fresh one exists before handing
// Meta the URL.
//
// ── What HARD-21 found, which is why this is written the way it is ──────────
//
// The feature had never worked, in three independent ways, none visible without running
// it: a stale lock file deadlocked generation for 115 days, the slides were stretched
// rather than letterboxed, and the URL it handed out was a private bucket object that
// 403'd. All three are fixed; this is the part that posts.
//
// **4:5 goes to both platforms.** The slides are 1080x1350 result cards, so 4:5 carries
// them with no bars at all. Measured 20 Sep 2026: Instagram Reels accepts it, and a silent
// audio track is not a problem — but `FINISHED` from Meta means *it will publish*, not
// *it looks good*, and only the first of those is answerable from an API.

const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { canonicalFor, absoluteUrl, socialVideoPath } = require('../utils/canonical');
const meta = require('../utils/metaPublisher');
const { VIDEO_KEYS } = require('./socialVideoController');

const s3 = new S3Client({ region: 'eu-west-1' });

// How old the stored video may be and still be "this week's results".
//
// The handler posts whatever is in the bucket, and the bucket keeps the last render for
// ever. Without this, a generation that did not happen — the endpoint refused, the encode
// crashed, the scheduler misfired — means **last week's results are published as this
// week's**, with a caption saying so. That is worse than posting nothing, and it is
// exactly the class of silent wrongness this feature has already produced twice.
//
// Two days rather than seven: the post runs weekly, so anything older than a couple of
// days means the generation step did not run this cycle.
const MAX_VIDEO_AGE_MS = 2 * 24 * 60 * 60 * 1000;

const SITE = 'https://stockport-badminton.co.uk';
const HASHTAGS = '#badmintonresults #stockport #badminton #sdbl #bulutangkis';

// The aspect posted to both platforms. An enum key, never a path fragment.
const POST_ASPECT = '4-5';

function videoUrl() {
  return absoluteUrl(socialVideoPath(POST_ASPECT));
}

/**
 * Captions.
 *
 * No @-mentions on either. Instagram would take them, but a results video names every club
 * that played and mentioning all of them reads as spam rather than courtesy — the weekly
 * tables post makes the opposite call because its mentions are the whole point. Facebook
 * page mentions are not `@`-syntax at all and need a feature we do not hold; see
 * docs/plans/social-mentions.md before adding any.
 */
function captions(weekLabel) {
  const week = weekLabel ? ` — ${weekLabel}` : '';
  return {
    facebook: `This week's results${week}. Full tables at ${SITE}\n\n${HASHTAGS}`,
    instagram: `This week's results${week}. Full tables at ${SITE}\n\n${HASHTAGS}`,
  };
}

/**
 * Is the stored video recent enough to be this week's?
 *
 * Read from S3 rather than trusted: the generate step and the post step are separate
 * calls, and nothing else would notice if the first had not happened.
 */
async function videoFreshness(now = Date.now()) {
  try {
    const head = await s3.send(new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME, Key: VIDEO_KEYS[POST_ASPECT],
    }));
    const ageMs = now - head.LastModified.getTime();
    if (ageMs > MAX_VIDEO_AGE_MS) {
      return { ok: false, ageMs, reason: `The stored video is ${Math.round(ageMs / 86400000)} days old, so it is not this week's results.` };
    }
    return { ok: true, ageMs };
  } catch (err) {
    return { ok: false, ageMs: null, reason: 'No video has been generated yet.' };
  }
}

function configuredTargets() {
  const t = meta.targets();
  return [
    t.stockportPage && { ...t.stockportPage, name: 'Stockport page', kind: 'page' },
    t.instagram && { ...t.instagram, name: 'Instagram', kind: 'instagram' },
  ].filter(Boolean);
}

/**
 * POST /admin/social/weekly-video — publish it.
 *
 * `?dry=1` asks Meta to fetch and transcode the video and publishes nothing; the container
 * expires on its own in 24 hours. Worth running before a season's first real post, because
 * a scheduled job nobody watches is exactly where a silent refusal hides — which is how
 * the Instagram carousel on the tables post managed never to work for as long as it
 * existed.
 */
exports.run = async function (req, res, next) {
  try {
    const dry = req.query.dry === '1' || req.body?.dry === '1';
    const url = videoUrl();
    const configured = configuredTargets();

    // Same rule as the other two posts: a switch whose halves live in different places
    // must fail loudly when only one is set. Posting nowhere is not a quiet success.
    if (!configured.length) {
      return res.status(500).json({
        ok: false,
        error: 'No Meta credentials configured, so this would have posted nowhere. ' +
               'Set META_PAGE_ID, META_PAGE_TOKEN and META_IG_USER_ID on the service.',
      });
    }

    // Refuse a stale video rather than publish last week's results as this week's. A
    // missing one is refused too: better a loud 409 than Meta fetching a 404 and the job
    // reporting a cheerful failure.
    const freshness = await videoFreshness();
    if (!freshness.ok) {
      return res.status(409).json({
        ok: false, video: url, aspect: POST_ASPECT,
        error: freshness.reason + ' Generate it first: GET /api/social/generate-weekly-video.',
        posted: [], failed: [],
      });
    }

    const t = meta.targets();
    if (dry) {
      const check = await meta.validateVideo(t.instagram.id, t.instagram.token, url);
      return res.json({ ok: check.ok, dry: true, video: url, aspect: POST_ASPECT, refused: check.refused });
    }

    const text = captions(req.query.week || req.body?.week);
    const out = await meta.publishVideoEverywhere(configured, {
      videoUrl: url, message: text.facebook, caption: text.instagram,
    });

    for (const f of out.failed) console.error(`weekly video -> ${f.target} failed:`, f.error.message);
    if (out.posted.length) console.log('weekly video posted to', out.posted.map(p => p.target).join(', '));

    // 207 when some targets took it and some did not. Reporting only success would make a
    // half failure indistinguishable from a whole one.
    return res.status(out.ok ? 200 : (out.posted.length ? 207 : 502)).json({
      ok: out.ok,
      video: url,
      aspect: POST_ASPECT,
      posted: out.posted,
      failed: out.failed.map(f => ({ target: f.target, error: f.error.message })),
      caller: req.socialCaller,
    });
  } catch (err) {
    next(err);
  }
};

/** GET /admin/social/weekly-video — what would be posted, sending nothing. */
exports.preview = async function (req, res, next) {
  try {
    res.render('admin/weekly-video-preview', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: 'Weekly video post',
      pageDescription: 'What the weekly results video post will contain',
      canonical: canonicalFor(req),
      // Same-origin for the <video> element so the page shows THIS server's file; the
      // absolute URL below it is what Meta will fetch. The tables and fixtures previews
      // had this wrong and rendered production's images whatever server they ran on.
      videoPath: socialVideoPath(POST_ASPECT),
      videoUrl: videoUrl(),
      aspect: POST_ASPECT,
      aspects: Object.keys(VIDEO_KEYS),
      captions: captions(),
      targetsConfigured: configuredTargets().length,
    });
  } catch (err) {
    next(err);
  }
};

exports.videoFreshness = videoFreshness;
exports.MAX_VIDEO_AGE_MS = MAX_VIDEO_AGE_MS;
exports.captions = captions;
exports.videoUrl = videoUrl;
exports.POST_ASPECT = POST_ASPECT;
