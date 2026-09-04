#!/usr/bin/env node
/**
 * Render the compiled email templates with sample data, for looking at.
 *
 *   node tools/preview-emails.js [outDir]     # default: /tmp/email-preview
 *
 * A preview is not proof: it renders in a browser, and an email renders in Outlook,
 * which lays out through Word. It is enough to check hierarchy, spacing and colour
 * before sending a real one, and nothing more than that.
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const OUT = process.argv[2] || '/tmp/email-preview';
const TEMPLATES = path.join(__dirname, '..', 'views', 'emails');
const logoUrl = 'https://stockport-badminton.co.uk/touch-icon-192x192.png';

const SAMPLES = {
  'scorecard-received': {
    logoUrl,
    whyReceiving: 'Sent to the results secretary whenever a captain files a scorecard.',
    homeTeamName: 'Mellor A', awayTeamName: 'Aerospace A',
    divisionName: 'Division 1', matchDate: 'Thursday 3 September',
    confirmUrl: 'https://stockport-badminton.co.uk/populated-scorecard-beta/2435?t=abc123',
    photoUrl: 'https://stockport-badminton.co.uk/scorecard-photo/2435?t=abc123',
    photoLine: 'A scorecard has been entered, with a photo attached.',
  },
  'website-updated': {
    logoUrl,
    whyReceiving: 'Sent when a result you filed is published on the website.',
    homeTeamName: 'Mellor A', awayTeamName: 'Aerospace A', divisionName: 'Division 1',
    homeScore: 13, awayScore: 5,
    matchStats: [
      { name: 'Chris Petty',  teamName: 'Mellor A',    gamesWon: 4, avgPtsFor: 21, avgPtsAgainst: 14 },
      { name: 'Jo Hilliard',  teamName: 'Mellor A',    gamesWon: 3, avgPtsFor: 19, avgPtsAgainst: 16 },
      { name: 'Molly McMackay', teamName: 'Aerospace A', gamesWon: 1, avgPtsFor: 15, avgPtsAgainst: 21 },
    ],
    resultImageUrl: '',
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, data] of Object.entries(SAMPLES)) {
    const html = await ejs.renderFile(path.join(TEMPLATES, name + '.ejs'), data);
    const out = path.join(OUT, name + '.html');
    fs.writeFileSync(out, html);
    console.log(`  ${out}  (${html.length} bytes)`);
  }
  // The no-photo and no-stats variants, since those are the mj-raw conditionals.
  const variants = {
    'scorecard-received-no-photo': ['scorecard-received',
      Object.assign({}, SAMPLES['scorecard-received'], {
        photoUrl: '', photoLine: 'A scorecard has been entered, with no photo attached.' })],
    'website-updated-no-stats': ['website-updated',
      Object.assign({}, SAMPLES['website-updated'], { matchStats: [] })],
  };
  for (const [label, [tpl, data]] of Object.entries(variants)) {
    const html = await ejs.renderFile(path.join(TEMPLATES, tpl + '.ejs'), data);
    fs.writeFileSync(path.join(OUT, label + '.html'), html);
    console.log(`  ${path.join(OUT, label + '.html')}  (variant)`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
