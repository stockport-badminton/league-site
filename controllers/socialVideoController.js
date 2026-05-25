const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execFileAsync = promisify(execFile);

/**
 * Generate weekly video from fixture results
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

    // Generate videos
    const videos = {};

    if (['16-9', 'both'].includes(aspect)) {
      const video16_9 = await createVideoWithFFmpeg(resultImages, duration, '1920:1080', outputDir, '16-9');
      videos['16-9'] = video16_9;
    }

    if (['1-1', 'both'].includes(aspect)) {
      const video1_1 = await createVideoWithFFmpeg(resultImages, duration, '1080:1080', outputDir, '1-1');
      videos['1-1'] = video1_1;
    }

    res.json({
      success: true,
      week: 'Nov 1-8, 2025',
      fixturesCount: fixtures.length,
      imagesCount: resultImages.length,
      duration,
      transition,
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
        f.id, f.date, ht.name as homeTeam, at.name as awayTeam, f."homeScore", f."awayScore", d.name as division
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
 * Create video with FFmpeg
 */
async function createVideoWithFFmpeg(imageFiles, duration, scale, outputDir, aspectLabel) {
  try {
    console.log(`Creating video (${aspectLabel}) with ${imageFiles.length} images...`);

    const outputFile = path.join(outputDir, `weekly-video-${aspectLabel.replace('-', '_')}.mp4`);

    // Build FFmpeg filter complex for image concatenation with fade transitions
    // Each image: scale, pad to target size, fade in/out
    const fadeDuration = 0.5; // fade duration in seconds
    const imageDuration = duration;

    // Create concat demux file
    const concatFile = path.join(outputDir, `concat-${aspectLabel}-${Date.now()}.txt`);
    const concatContent = imageFiles.map(img => `file '${path.resolve(img)}'`).join('\n');
    await fs.writeFile(concatFile, concatContent);

    // Build FFmpeg command
    // Use concat demux for simplicity, then add fade filter
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-vf', `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:black,fps=30,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${imageDuration - fadeDuration}:d=${fadeDuration}`,
      '-c:v', 'libx264',
      '-crf', '23',
      '-c:a', 'aac',
      '-t', `${imageFiles.length * imageDuration}`,
      outputFile,
    ];

    console.log(`FFmpeg command: ffmpeg ${args.join(' ')}`);

    await execFileAsync('ffmpeg', args);

    console.log(`Video created (${aspectLabel}): ${outputFile}`);

    // Clean up concat file
    try {
      await fs.unlink(concatFile);
    } catch (err) {
      console.warn(`Failed to clean concat file: ${err.message}`);
    }

    return outputFile;
  } catch (err) {
    console.error(`createVideoWithFFmpeg error (${aspectLabel}):`, err);
    throw err;
  }
}
