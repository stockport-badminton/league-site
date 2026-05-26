const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execFileAsync = promisify(execFile);

/**
 * Generate weekly video from fixture results
 * Uses ImageMagick to create smooth fade transitions between result images,
 * then encodes the full frame sequence as video with precise duration control
 * GET /api/social/generate-weekly-video
 * Query params:
 *   - duration: seconds per image (default: 3)
 *   - aspect: '16-9', '1-1', or 'both' (default: both)
 *   - transition: 'fade' (default: fade) - for MVP, only fade is supported
 */
exports.generateWeeklyVideo = async function(req, res, next) {
  try {
    const duration = parseInt(req.query.duration) || 3;
    const aspect = req.query.aspect || 'both';
    const transition = req.query.transition || 'fade';
    const transitionDuration = 0.5; // Fade transition duration in seconds
    const framerate = 25;

    // Validate inputs
    if (!['16-9', '1-1', 'both'].includes(aspect)) {
      return res.status(400).json({ error: 'aspect must be 16-9, 1-1, or both' });
    }
    if (transition !== 'fade') {
      return res.status(400).json({ error: 'For MVP, only fade transition is supported' });
    }

    // Query fixtures from Nov 1-8, 2025
    const fixtures = await queryFixturesWithResults();
    console.log(`Found ${fixtures.length} fixtures with results`);

    if (fixtures.length === 0) {
      return res.status(404).json({ error: 'No fixtures with results found for Nov 1-8, 2025' });
    }

    // Generate result images for each fixture
    const resultImages = await generateResultImages(fixtures);
    console.log(`Generated ${resultImages.length} result images`);

    if (resultImages.length === 0) {
      return res.status(500).json({ error: 'Failed to generate any result images' });
    }

    // Create output directory
    const outputDir = 'static/beta/videos/generated';
    await fs.mkdir(outputDir, { recursive: true });

    // Generate videos for each aspect ratio
    const videos = {};
    const totalDuration = calculateTotalDuration(resultImages.length, duration, transitionDuration);

    if (['16-9', 'both'].includes(aspect)) {
      console.log('Creating 16:9 video...');
      const video16_9 = await createVideoFromImageSequence(
        resultImages, duration, transitionDuration, framerate, '1920:1080', outputDir, '16-9'
      );
      videos['16-9'] = `static/beta/videos/generated/${path.basename(video16_9)}`;
    }

    if (['1-1', 'both'].includes(aspect)) {
      console.log('Creating 1:1 video...');
      const video1_1 = await createVideoFromImageSequence(
        resultImages, duration, transitionDuration, framerate, '1080:1080', outputDir, '1-1'
      );
      videos['1-1'] = `static/beta/videos/generated/${path.basename(video1_1)}`;
    }

    res.json({
      success: true,
      week: 'Nov 1-8, 2025',
      fixturesCount: fixtures.length,
      slidesCount: resultImages.length,
      totalDuration: totalDuration.toFixed(1) + ' seconds',
      transitionDuration,
      videos,
    });
  } catch (err) {
    console.error('generateWeeklyVideo error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Query fixtures from database with results (Nov 1-8, 2025)
 */
async function queryFixturesWithResults() {
  try {
    const startDate = new Date('2025-11-01');
    const endDate = new Date('2025-11-08');

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
 * Generate result images for each fixture
 */
async function generateResultImages(fixtures) {
  const generatedDir = 'static/beta/images/generated';
  await fs.mkdir(generatedDir, { recursive: true });

  const images = [];
  const sharp = require('sharp');

  for (const fixture of fixtures) {
    try {
      const { homeTeam, awayTeam, homeScore, awayScore, division } = fixture;
      const bgPath = `static/beta/images/bg/social-${division.replace(/\s+/g, '-')}.png`;

      // Check if bg exists
      try {
        await fs.access(bgPath);
      } catch {
        console.warn(`Background image not found: ${bgPath}, skipping fixture`);
        continue;
      }

      const fileBase = `${generatedDir}/${homeTeam.replace(/\s+/g, '+')}+${awayTeam.replace(/\s+/g, '+')}`;

      // SVG overlay helper
      const svgOverlay = (width, height, elements) => {
        const escapeXml = (str) => String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

        const els = elements.map(({ text, x, y, size, weight = 'normal', fill = '#000', anchor = 'middle' }) =>
          `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(text)}</text>`
        ).join('');
        return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${els}</svg>`);
      };

      const makeElements = (width, height) => {
        const x = width - 100;
        const y = Math.floor(2 * height / 3) + 50;
        return [
          { text: homeTeam, x, y, size: 60, weight: 'bold', fill: 'black', anchor: 'end' },
          { text: 'vs', x, y: y + 60, size: 50, fill: 'black', anchor: 'end' },
          { text: awayTeam, x, y: y + 140, size: 60, weight: 'bold', fill: 'black', anchor: 'end' },
          { text: `${homeScore} - ${awayScore}`, x, y: y + 240, size: 80, weight: 'bold', fill: 'black', anchor: 'end' },
        ];
      };

      const postBuffer = await sharp(bgPath)
        .resize(1080, 1350, { fit: 'cover' })
        .composite([{ input: svgOverlay(1080, 1350, makeElements(1080, 1350)) }])
        .jpeg({ quality: 90 })
        .toBuffer();

      await sharp(postBuffer).toFile(`${fileBase}.jpg`);
      images.push(`${fileBase}.jpg`);

      console.log(`Generated image: ${fileBase}.jpg`);
    } catch (err) {
      console.error(`Error generating image for ${fixture.homeTeam} vs ${fixture.awayTeam}:`, err);
    }
  }

  return images;
}

/**
 * Create video from image sequence with fade transitions
 * Uses ImageMagick to create smooth fade frames between images
 */
async function createVideoFromImageSequence(imageFiles, duration, transitionDuration, framerate, scale, outputDir, aspectLabel) {
  const tempSeqDir = path.join(outputDir, `temp-seq-${Date.now()}-${aspectLabel}`);
  const [width, height] = scale.split(':').map(Number);

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
      await execFileAsync('convert', [
        imageFiles[i],
        '-resize', scale,
        '-extent', scale,
        '-gravity', 'center',
        '-background', 'black',
        resizedPath
      ]);
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
