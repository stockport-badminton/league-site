const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { S3Client, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const execFileAsync = promisify(execFile);

const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { absoluteUrl, socialVideoPath } = require('../utils/canonical');
const sharp = require('sharp');
// The video's frames are the RESULT CARD, drawn by the same code the result post uses.
// Required at the top, not inside the function: there is no cycle to dodge here, and a
// lazy require is a deploy-time bug that waits — `sendResultZap` did `require('canvas')`
// inside a function and threw on every result submitted for four months.
const { createResultCard, accentFor } = require('./socialController');
const { backgroundFor, subjectFor, subjectLayer } = require('../utils/socialCard');

const s3 = new S3Client({ region: 'eu-west-1' });
const S3_PREFIX = 'social-videos';

// The aspects, and the only keys this file will ever read or write.
//
// Defined once because two things need them — the generator and the read path below — and
// a read path that resolved its own key could drift from the writer without anything
// failing until the day somebody looked. **`aspect` is a lookup into this object, never a
// path fragment**: nothing a caller sends reaches `Key`.
//
// **4:5, not 16:9.** The slides are 1080x1350 result cards, so a 4:5 frame carries them
// with NO letterboxing at all — every pixel is content. 16:9 was a landscape frame around
// portrait content and spent most of its width on black bars; it is gone. Instagram Reels
// accepts 0.8 comfortably (measured 20 Sep 2026, HARD-21 phase 2, along with the fact that
// a silent audio track is fine). `VIDEO_SIZES` is the render geometry for the same keys,
// in ImageMagick's `WxH` form — a colon there is an aspect RATIO and distorts, which is
// what made the old 16:9 output 1080x608 with every word stretched.
const VIDEO_KEYS = {
  '4-5': `${S3_PREFIX}/weekly-video-4_5.mp4`,
  '1-1': `${S3_PREFIX}/weekly-video-1_1.mp4`,
};
const VIDEO_SIZES = { '4-5': '1080x1350', '1-1': '1080x1080' };
const LOCK_KEY = `${S3_PREFIX}/.generating`;

exports.VIDEO_KEYS = VIDEO_KEYS;
exports.VIDEO_SIZES = VIDEO_SIZES;

/**
 * Generate weekly video from fixture results
 * Uses ImageMagick to create smooth fade transitions between result images,
 * then encodes the full frame sequence as video with precise duration control
 * GET /api/social/generate-weekly-video
 * Query params:
 *   - duration: seconds per image (default: 3)
 *   - aspect: '4-5', '1-1', or 'both' (default: both)
 *   - transition: 'fade' (default: fade) - for MVP, only fade is supported
 */
// GET /social-video/:aspect — stream one of the two weekly videos.
//
// The objects are private and stay that way. `uploadVideoToS3` sets no ACL and no bucket
// policy grants public read, so the bucket URL the generate endpoint used to hand out
// answered 403 to everyone who tried it (HARD-21). **Do not "fix" that by making the
// objects public** — this is the read path instead, the third instance of a pattern
// already in `app.js` (the venues map) and `/scorecard-photo/:id`.
//
// Unauthenticated on purpose, like the league-table and fixtures images: **Meta fetches
// `video_url` from Meta's own servers**, so anything gated here cannot be posted. It shows
// nothing that is not already on the results page.
//
// `aspect` is looked up in VIDEO_KEYS and is never used to build a key. An unknown one is
// a 404 rather than a lookup miss further down.
exports.serveWeeklyVideo = async function(req, res, next) {
  try {
    const key = Object.prototype.hasOwnProperty.call(VIDEO_KEYS, req.params.aspect)
      ? VIDEO_KEYS[req.params.aspect]
      : null;

    // `no-store` on the miss, and that is not tidiness. Firebase Hosting applies its own
    // max-age to a response that sets no Cache-Control, and **Meta retries** — so a
    // transient 404, a deploy in flight, a video not generated yet, gets cached and the
    // retry hits the cache rather than the fixed route. The window outlives the fault.
    // Same reasoning as the social images in socialController.
    if (!key) {
      return res.status(404).set('Cache-Control', 'no-store').type('text/plain')
        .send('No such aspect. Known: ' + Object.keys(VIDEO_KEYS).join(', '));
    }

    let obj;
    try {
      obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }));
    } catch (err) {
      // Not generated yet is a 404, not a 500 — and must not be cached either.
      return res.status(404).set('Cache-Control', 'no-store').type('text/plain')
        .send('That video has not been generated yet');
    }

    res.set('Content-Type', 'video/mp4');
    res.set('X-Content-Type-Options', 'nosniff');
    // `public`, unlike the scorecard photo beside it: there is nothing private here, it is
    // about to be posted publicly. Short, because the video is regenerated weekly and on
    // demand, so a long-lived copy could outlast the results it shows.
    res.set('Cache-Control', 'public, max-age=300');
    if (obj.ContentLength) res.set('Content-Length', String(obj.ContentLength));

    // The stream needs its own 'error' listener or a mid-transfer failure is an unhandled
    // 'error' on an EventEmitter, which takes the instance down — gotcha 2c, and the same
    // thing /scorecard-photo/:id does. The venues-map route omits it; do not copy that one.
    // Headers are already sent by this point, so all that is left is to stop talking.
    obj.Body.on('error', () => res.destroy());
    obj.Body.pipe(res);
  } catch (err) {
    next(err);
  }
};

exports.generateWeeklyVideo = async function(req, res, next) {
  try {
    const duration = parseInt(req.query.duration) || 3;
    const aspect = req.query.aspect || 'both';
    const transition = req.query.transition || 'fade';
    const transitionDuration = 0.5; // Fade transition duration in seconds
    const framerate = 25;

    // Calculate date range: last 7 days from today
    const today = new Date();
    const endDate = new Date(today);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 7);
    const weekLabel = `${startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} - ${endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    // Validate inputs
    if (![...Object.keys(VIDEO_KEYS), 'both'].includes(aspect)) {
      return res.status(400).json({ error: `aspect must be ${Object.keys(VIDEO_KEYS).join(', ')}, or both` });
    }
    if (transition !== 'fade') {
      return res.status(400).json({ error: 'For MVP, only fade transition is supported' });
    }

    // Deduplication: use S3 lock file + video timestamps to prevent concurrent generation
    const dedupeWindow = 65000; // 65 seconds (slightly longer than generation time)
    const lockTimeout = 120000; // 120 seconds (timeout for stale locks)
    const s3Keys = { ...VIDEO_KEYS, lock: LOCK_KEY };

    // Try to acquire lock and check for recent videos (retry once if lock is active)
    console.log(`[DEDUP] Attempt 0: checking for recent videos and lock...`);
    for (let attempt = 0; attempt < 2; attempt++) {
      console.log(`[DEDUP] Attempt ${attempt}: starting dedup check`);
      try {
        // Check if videos exist and are recent
        console.log(`[DEDUP] Checking if videos exist in S3...`);
        const head4_5 = await s3.send(new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: s3Keys['4-5']
        }));
        const head1_1 = await s3.send(new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: s3Keys['1-1']
        }));

        const now = Date.now();
        const age4_5 = now - head4_5.LastModified.getTime();
        const age1_1 = now - head1_1.LastModified.getTime();

        console.log(`[DEDUP] Videos exist: 4-5 age=${Math.round(age4_5 / 1000)}s, 1-1 age=${Math.round(age1_1 / 1000)}s (dedupeWindow=${dedupeWindow / 1000}s)`);

        if (age4_5 < dedupeWindow && age1_1 < dedupeWindow) {
          console.log(`[DEDUP] Videos are recent! Returning cached URLs.`);
          return res.json({
            success: true,
            week: weekLabel,
            cached: true,
            videos: {
              '4-5': absoluteUrl(socialVideoPath('4-5')),
              '1-1': absoluteUrl(socialVideoPath('1-1'))
            }
          });
        }
        console.log(`[DEDUP] Videos exist but are stale (older than ${dedupeWindow / 1000}s), proceeding to check lock...`);
      } catch (err) {
        console.log(`[DEDUP] Videos don't exist yet (${err.Code || err.message}), proceeding to check lock...`);
      }

      // Check if another instance is generating
      try {
        console.log(`[DEDUP] Checking if lock file exists...`);
        const lockStat = await s3.send(new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: s3Keys['lock']
        }));

        const now = Date.now();
        const lockAge = now - lockStat.LastModified.getTime();

        console.log(`[DEDUP] Lock file exists! Age=${Math.round(lockAge / 1000)}s (lockTimeout=${lockTimeout / 1000}s)`);

        if (lockAge < lockTimeout) {
          // Lock is active - another instance is generating
          if (attempt === 0) {
            console.log(`[DEDUP] Lock is active, waiting 30s before retry...`);
            await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s and retry
            continue; // Retry from top (check for videos again)
          } else {
            // Second attempt, lock still active - return error
            console.log(`[DEDUP] Second attempt and lock still active, returning 202 Accepted`);
            return res.status(202).json({
              success: false,
              message: 'Video generation in progress, please retry in 30 seconds'
            });
          }
        } else {
          // Recognising a stale lock is not enough — it has to be DELETED.
          //
          // The atomic create below uses `IfNoneMatch: '*'`, which fails if the object
          // exists at all, stale or not. So this branch used to log "proceeding with
          // generation", fall through, and then be refused by S3 with PreconditionFailed —
          // reported to the caller as "in progress by another instance", naming a
          // concurrent run that did not exist.
          //
          // The effect is that ONE interrupted run kills the feature permanently. A lock
          // orphaned on 27 May 2026 — a crash, a scale-down, a deploy mid-encode; the
          // encode takes ~36s on Cloud Run so any of those is likely — left this endpoint
          // answering 202 for 115 days. Verified 19 Sep 2026 by reading the [DEDUP] trace:
          // "Lock file is stale (9963441s > 120s), proceeding with generation" followed
          // immediately by "Lock file already created by another instance".
          console.log(`[DEDUP] Lock file is stale (${Math.round(lockAge / 1000)}s > ${lockTimeout / 1000}s), removing it`);
          await s3.send(new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: s3Keys['lock'],
          }));
        }
      } catch (err) {
        console.log(`[DEDUP] No lock file found (${err.Code || err.message}), safe to proceed with generation`);
      }

      // No recent videos, lock not active → we can generate
      console.log(`[DEDUP] Proceeding with generation (breaking loop)`);
      break;
    }

    // Create lock file atomically before starting generation
    // IfNoneMatch: '*' ensures only we create it if it doesn't exist (prevents race condition)
    console.log(`[DEDUP] Creating lock file to signal other instances...`);
    try {
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Keys['lock'],
        Body: Buffer.from(''),
        ContentType: 'text/plain',
        IfNoneMatch: '*'  // Only create if lock doesn't exist
      }));
      console.log(`[DEDUP] Lock file created successfully (atomic)`);
    } catch (err) {
      // If PreconditionFailed, another instance created the lock - check for new videos
      if (err.Code === 'PreconditionFailed' || err.name === 'PreconditionFailed') {
        console.log(`[DEDUP] Lock file already created by another instance, checking for new videos...`);
        // Re-check from the top (another instance might have finished by now)
        return res.status(202).json({
          success: false,
          message: 'Video generation in progress by another instance, please retry in 30 seconds'
        });
      }
      // Other errors are real failures
      console.error(`[DEDUP] Failed to create lock file: ${err.message}`);
      return res.status(500).json({ error: `Failed to create lock file: ${err.message}` });
    }

    const outputDir = 'static/beta/videos/generated';

    // Query fixtures from last 7 days
    const fixtures = await queryFixturesWithResults(startDate, endDate);
    console.log(`Found ${fixtures.length} fixtures with results for week: ${weekLabel}`);

    if (fixtures.length === 0) {
      return res.status(404).json({ error: `No fixtures with results found for ${weekLabel}` });
    }

    // Generate result images for each fixture
    const resultImages = await generateResultImages(fixtures);
    console.log(`Generated ${resultImages.length} result images`);

    if (resultImages.length === 0) {
      return res.status(500).json({ error: 'Failed to generate any result images' });
    }

    // Create output directory (already declared in dedup check above)
    await fs.mkdir(outputDir, { recursive: true });

    // Generate videos for each aspect ratio
    const videos = {};
    const totalDuration = calculateTotalDuration(resultImages.length, duration, transitionDuration);

    if (['4-5', 'both'].includes(aspect)) {
      console.log('Creating 16:9 video...');
      const video4_5 = await createVideoFromImageSequence(
        resultImages, duration, transitionDuration, framerate, VIDEO_SIZES['4-5'], outputDir, '4-5'
      );
      // Upload to S3
      await uploadVideoToS3(video4_5, s3Keys['4-5']);
      videos['4-5'] = absoluteUrl(socialVideoPath('4-5'));
    }

    if (['1-1', 'both'].includes(aspect)) {
      console.log('Creating 1:1 video...');
      const video1_1 = await createVideoFromImageSequence(
        resultImages, duration, transitionDuration, framerate, VIDEO_SIZES['1-1'], outputDir, '1-1'
      );
      // Upload to S3
      await uploadVideoToS3(video1_1, s3Keys['1-1']);
      videos['1-1'] = absoluteUrl(socialVideoPath('1-1'));
    }

    // Delete lock file to signal other instances
    console.log(`[DEDUP] Videos uploaded, deleting lock file...`);
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Keys['lock']
      }));
      console.log(`[DEDUP] Lock file deleted successfully`);
    } catch (err) {
      console.warn(`[DEDUP] Warning: failed to delete lock file: ${err.message}`);
      // Don't fail the response if cleanup fails
    }

    res.json({
      success: true,
      week: weekLabel,
      fixturesCount: fixtures.length,
      slidesCount: resultImages.length,
      totalDuration: totalDuration.toFixed(1) + ' seconds',
      transitionDuration,
      videos,
    });
  } catch (err) {
    console.error('generateWeeklyVideo error:', err);

    // Try to clean up lock file on error too
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `${S3_PREFIX}/.generating`
      }));
      console.log(`[DEDUP] Lock file cleaned up after error`);
    } catch (cleanupErr) {
      console.warn(`[DEDUP] Could not clean lock file after error: ${cleanupErr.message}`);
    }

    res.status(500).json({ error: err.message });
  }
};

/**
 * Query fixtures from database with results for a date range
 */
async function queryFixturesWithResults(startDate, endDate) {
  try {
    const [results] = await (await require('../db_connect').otherConnect()).query(`
      SELECT
        f.id, f.date, ht.name as "homeTeam", at.name as "awayTeam", f."homeScore", f."awayScore", d.name as "division"
      FROM fixture f
      LEFT JOIN team ht ON f."homeTeam" = ht.id
      LEFT JOIN team at ON f."awayTeam" = at.id
      LEFT JOIN division d ON ht."division" = d.id
      WHERE f.date >= ? AND f.date <= ? AND f.status IN ('complete', 'conceded')
      ORDER BY f.date
    `, [startDate, endDate]);
    return results || [];
  } catch (err) {
    console.error('queryFixturesWithResults error:', err);
    throw err;
  }
}

/**
 * One frame per result, for the weekly video.
 *
 * It draws the SAME card the result post uses — `createResultCard` — rather than its own.
 * It used to carry a full copy of the 2024 layout: its own `svgOverlay`, its own escaping,
 * its own background lookup, and black text written into the bottom-right corner. That copy
 * was invisible to every change made to the real card, so HARD-37 fixed the result post and
 * left the video posting the old design with black text on artwork that no longer fades to
 * white underneath it. A duplicated renderer is a renderer nobody remembers to update.
 *
 * It also **silently dropped results**. The old lookup `continue`d past any fixture whose
 * division had no artwork file, so a friendly or a renamed division simply did not appear in
 * the week's video and nothing said so. `backgroundFor` always answers, falling back through
 * the 2024 artwork to the plain background, so every result gets a frame.
 */
async function generateResultImages(fixtures) {
  const generatedDir = 'static/beta/images/generated';
  await fs.mkdir(generatedDir, { recursive: true });

  const images = [];
  // The artwork, accent and player are per DIVISION, not per fixture, and a week's video is
  // mostly one division repeated — so they are resolved once each rather than once a frame.
  const perDivision = new Map();

  for (const fixture of fixtures) {
    try {
      const { homeTeam, awayTeam, homeScore, awayScore, division } = fixture;

      if (!perDivision.has(division)) {
        const bgPath = await backgroundFor(division);
        const subjectPath = await subjectFor(division);
        perDivision.set(division, {
          bgPath,
          accent: await accentFor(bgPath),
          subject: subjectPath ? await subjectLayer(subjectPath, { W: 1080, H: 1350 }) : null,
        });
      }
      const { bgPath, accent, subject } = perDivision.get(division);

      const buf = await createResultCard(
        bgPath,
        { division, homeTeam, awayTeam, homeScore, awayScore },
        1080, 1350, accent,
        { subject });

      const fileBase = `${generatedDir}/${homeTeam.replace(/\s+/g, '+')}+${awayTeam.replace(/\s+/g, '+')}`;
      await sharp(buf).toFile(`${fileBase}.jpg`);
      images.push(`${fileBase}.jpg`);

      console.log(`Generated image: ${fileBase}.jpg`);
    } catch (err) {
      console.error(`Error generating image for ${fixture.homeTeam} vs ${fixture.awayTeam}:`, err);
    }
  }

  return images;
}

// Fit a slide inside the target frame and pad the remainder — a letterbox, not a squash.
//
// Two faults lived in this one command, and **they hid each other**, which is why fixing
// only the obvious one makes the output worse rather than better.
//
//   -resize 1920:1080   a colon is an ASPECT RATIO in ImageMagick geometry, not a size.
//                       It forces the image to 16:9 by distorting it: a 1080x1350 card
//                       came out 1080x608 with every word visibly stretched. Measured
//                       19 Sep 2026 against the live output. The `x` form fits inside the
//                       box and preserves the aspect, which is what was wanted.
//
//   -extent before      -gravity and -background only affect operators that come AFTER
//   -gravity/-background them. Written in this order they applied to nothing, so the pad
//                       used the defaults: NorthWest and WHITE. Invisible until now,
//                       because `-resize` with a ratio had already forced the exact target
//                       aspect and left `-extent` nothing to pad.
//
// So the 1:1 output looked fine by coincidence — ratio 1:1 of a 1080-wide image is
// 1080x1080, the size that was asked for — while 16:9 was a third of the intended pixels
// and stretched. Correct the colon alone and the card lands top-left on white bars.
function letterboxArgs(src, dest, scale) {
  return [
    src,
    '-resize', scale,        // WxH: fit inside, preserve aspect
    '-background', 'black',  // both must precede -extent to apply to it
    '-gravity', 'center',
    '-extent', scale,        // pad the remainder
    dest,
  ];
}

// Exported for testing. The frame renderer is where this file's copy of the result card
// used to live, and the thing worth asserting is that it no longer has one.
exports.generateResultImages = generateResultImages;

exports.letterboxArgs = letterboxArgs;

/**
 * Create video from image sequence with fade transitions
 * Uses ImageMagick to create smooth fade frames between images
 */
async function createVideoFromImageSequence(imageFiles, duration, transitionDuration, framerate, scale, outputDir, aspectLabel) {
  const tempSeqDir = path.join(outputDir, `temp-seq-${Date.now()}-${aspectLabel}`);

  try {
    console.log(`Building frame sequence for ${aspectLabel}...`);
    await fs.mkdir(tempSeqDir, { recursive: true });

    const framesPerSlide = Math.round(duration * framerate);
    const transitionFrames = Math.round(transitionDuration * framerate);
    let frameNum = 1;

    // Step 1a: Pre-resize all images once (major optimization)
    console.log('Pre-resizing images...');
    const resizedImages = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const resizedPath = path.join(tempSeqDir, `resized-${i}.jpg`);
      await execFileAsync('convert', letterboxArgs(imageFiles[i], resizedPath, scale));
      resizedImages.push(resizedPath);
      console.log(`  Resized image ${i + 1}/${imageFiles.length}`);
    }

    // Step 1b: Interleave slide frames and transitions
    console.log('Creating slide frames and transitions...');
    for (let slideIdx = 0; slideIdx < resizedImages.length; slideIdx++) {
      // Create slide frames
      console.log(`  Slide ${slideIdx + 1}/${resizedImages.length} (${framesPerSlide} frames)...`);
      const resizedImg = resizedImages[slideIdx];
      const imgBuffer = await fs.readFile(resizedImg);

      for (let f = 0; f < framesPerSlide; f++) {
        const outputFrame = path.join(tempSeqDir, `frame-${String(frameNum).padStart(6, '0')}.jpg`);
        await fs.writeFile(outputFrame, imgBuffer);
        frameNum++;
      }

      // Create transition frames to next slide (if not last slide)
      if (slideIdx < resizedImages.length - 1) {
        console.log(`    Transition ${slideIdx + 1}->${slideIdx + 2} (${transitionFrames} frames)...`);
        const currentImg = resizedImages[slideIdx];
        const nextImg = resizedImages[slideIdx + 1];

        for (let t = transitionFrames; t >= 1; t--) {
          const blendPercent = (t / transitionFrames) * 100;
          const outputFrame = path.join(tempSeqDir, `frame-${String(frameNum).padStart(6, '0')}.jpg`);

          // Use ImageMagick to blend between current and next image
          await execFileAsync('convert', [
            currentImg,
            nextImg,
            '-compose', 'blend',
            '-define', `compose:args=${100 - blendPercent}x${blendPercent}`,
            '-composite',
            outputFrame
          ]);
          frameNum++;
        }
      }
    }

    // Step 2: Encode frame sequence as video
    const outputFile = path.join(outputDir, `weekly-video-${aspectLabel.replace('-', '_')}.mp4`);
    const sequencePattern = path.join(tempSeqDir, 'frame-%06d.jpg');
    const totalDuration = calculateTotalDuration(imageFiles.length, duration, transitionDuration);

    console.log(`Encoding ${frameNum - 1} frames as video (${totalDuration.toFixed(1)}s)...`);
    await execFileAsync('ffmpeg', [
      '-y',
      '-framerate', framerate.toString(),
      '-i', sequencePattern,
      '-c:v', 'libx264',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      outputFile
    ]);

    console.log(`Video created (${aspectLabel}): ${outputFile}`);
    return outputFile;
  } catch (err) {
    console.error(`createVideoFromImageSequence error (${aspectLabel}):`, err);
    throw err;
  } finally {
    // Clean up temp directory
    try {
      const files = await fs.readdir(tempSeqDir);
      for (const file of files) {
        await fs.unlink(path.join(tempSeqDir, file));
      }
      await fs.rmdir(tempSeqDir);
    } catch (err) {
      console.warn(`Failed to clean temp sequence directory: ${err.message}`);
    }
  }
}

/**
 * Calculate total video duration
 */
function calculateTotalDuration(numSlides, slideDuration, transitionDuration) {
  return numSlides * slideDuration + (numSlides - 1) * transitionDuration;
}

/**
 * Upload video to S3
 */
async function uploadVideoToS3(localFilePath, s3Key) {
  try {
    const fileContent = await fs.readFile(localFilePath);
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'video/mp4'
    }));
    console.log(`Uploaded ${s3Key} to S3`);
  } catch (err) {
    console.error(`Error uploading ${s3Key} to S3:`, err);
    throw err;
  }
}
