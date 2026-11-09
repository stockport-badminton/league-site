// Records the "how to enter a result" walkthrough on /email-scorecard, in a desktop (16:9) or
// phone (9:16) cut, against the LOCAL demo server. See README.md for the whole procedure.
//
//   node tools/demo-video/record.js desktop|mobile
//
// The photo analysis is stubbed so the auto-fill is identical every take (with one deliberate
// misread for the validation scene); everything else — the dropdowns, the score checks, the
// draft and the confirmation page — is the real app against the fictional teams in seed.sql.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');

const D = __dirname;
const ROOT = path.join(D, '../..');
const BASE = 'http://127.0.0.1:8080';
const mode = process.argv[2] === 'mobile' ? 'mobile' : 'desktop';
const mobile = mode === 'mobile';
const OUT = `${D}/generated/${mode}`;
const PHOTO = `${D}/generated/scorecard-photo.jpg`;
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(PHOTO)) throw new Error('No scorecard photo: run node tools/demo-video/make-card.js first');

const psql = sql => execFileSync('docker', ['exec', '-i', 'sdbl-local-db', 'psql', '-U', 'sdbl', '-d', 'sdbl', '-At', '-c', sql],
  { encoding: 'utf8' }).trim();

// The fictional fixture and its players, by name: ids differ between local databases.
const teamId = name => psql(`SELECT id FROM team WHERE name = '${name}'`);
const HOME = teamId('Larkhill A'), AWAY = teamId('Brookvale A');
if (!HOME || !AWAY) throw new Error('Demo teams missing: load tools/demo-video/seed.sql into the local database');
const card = require('./card-data.json');
const playerId = name => psql(`SELECT id FROM player WHERE first_name || ' ' || family_name = '${name}' AND team IN (${HOME}, ${AWAY})`);
const analysis = { date: '2026-11-05', division: psql(`SELECT division FROM team WHERE id = ${HOME}`), homeTeam: HOME, awayTeam: AWAY,
  photoUrl: 'https://badmintontemp.s3.eu-west-2.amazonaws.com/scorecards/demo-larkhill-brookvale.jpg', photoStored: true };
for (const side of ['home', 'away']) {
  card[side].men.forEach((n, i) => { analysis[`${side}Man${i + 1}`] = playerId(n); });
  card[side].ladies.forEach((n, i) => { analysis[`${side}Lady${i + 1}`] = playerId(n); });
}
card.games.forEach(([h, a], i) => { analysis[`Game${i + 1}homeScore`] = String(h); analysis[`Game${i + 1}awayScore`] = String(a); });
// The misread the video corrects: game 7's home "21" read as "2".
analysis.Game7homeScore = '2';

// A fresh take each time: the fixture can have only one draft.
psql(`DELETE FROM scorecardstore WHERE "homeTeam" = ${HOME} AND "awayTeam" = ${AWAY}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // Chrome's screencast (and so Playwright's recordVideo) delivers CSS pixels; only a
  // browser-wide forced scale factor makes it hand over device pixels.
  const viewport = mobile ? { width: 360, height: 640 } : { width: 1280, height: 720 };
  const scale = mobile ? 3 : 1.5;
  const browser = await chromium.launch({ channel: 'chromium', args: [`--force-device-scale-factor=${scale}`] });
  const { viewport: _v, deviceScaleFactor: _d, ...phone } = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...(mobile ? phone : {}), viewport, deviceScaleFactor: scale, bypassCSP: true });
  await ctx.addInitScript({ path: `${D}/overlay.js` });
  if (!mobile) await ctx.addInitScript(() => { window.__dmSide = true; });
  if (mobile) await ctx.addInitScript(() => { window.__dmPhone = true; });
  if (mobile) await ctx.addInitScript(() => {
    document.documentElement.style.setProperty('--cap-size', '19px');
    document.documentElement.style.setProperty('--cap-bottom', '13%');
    document.documentElement.style.setProperty('--card-h', '38px');
    document.documentElement.style.setProperty('--card-p', '19px');
    document.documentElement.style.setProperty('--card-k', '14px');
  });
  const page = await ctx.newPage();

  await page.route('**/api/analyse-scorecard', async r => { await sleep(3200); r.fulfill({ json: analysis }); });
  await page.route('**/scorecard-photo/**', r => r.fulfill({ path: PHOTO, contentType: 'image/jpeg' }));
  await page.route('**/__demo/card.jpg', r => r.fulfill({ path: PHOTO, contentType: 'image/jpeg' }));
  // The local server has no mail credentials; show the page a captain normally gets.
  await page.route('**/email-scorecard', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    const res = await r.fetch({ maxRedirects: 0 });
    const headers = { ...res.headers() };
    if (headers.location) headers.location = headers.location.replace('notified=0', 'notified=1');
    r.fulfill({ response: res, headers });
  });

  // Frame capture: every compositor frame to disk with its timestamp; ffmpeg makes it CFR later.
  const FR = `${OUT}/frames`; fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR);
  const cdp = await ctx.newCDPSession(page);
  const frames = []; let capturing = false;
  cdp.on('Page.screencastFrame', f => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!capturing) return;
    const file = `${FR}/${String(frames.length).padStart(6, '0')}.jpg`;
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
  });
  const W = Math.round(viewport.width * scale), H = Math.round(viewport.height * scale);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H });

  const demo = (fn, ...args) => page.evaluate(([fn, args]) => window.__demo[fn](...args), [fn, args]);
  const caption = (html, phone) => demo('caption', mobile && phone ? phone : html);
  const spot = (sel) => demo('spot', sel || null);
  const visible = sel => page.locator(sel).locator('visible=true').first();

  async function pointAt(locator) {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    await demo('pointer', b.x + b.width / 2, b.y + b.height / 2);
    await sleep(750);
  }
  async function press(locator, pause = 250) {
    await pointAt(locator);
    await demo('tapRing');
    await sleep(pause);
    await locator.click();
  }
  const contBtn = () => visible('#signupModal button.step:has-text("Continue")');
  // On a phone each step starts at the top of the wizard, as it does for a captain scrolling.
  const cont = () => ({ async scrollIntoViewIfNeeded() { await contBtn().scrollIntoViewIfNeeded(); },
    boundingBox: () => contBtn().boundingBox(),
    async click() { await contBtn().click(); if (mobile) await page.evaluate(() => { document.querySelector('#signupModal').scrollTop = 0; }); } });

  // ── Title ─────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/email-scorecard`);
  await demo('pointer', -80, -80);
  await demo('card', 'Stockport &amp; District Badminton League', 'Entering a result',
    'Photograph the signed scorecard, check what it read, submit.');
  await sleep(700);
  capturing = true;
  await sleep(3600);
  await demo('card', 'x', null);
  await sleep(700);

  // ── Getting there ─────────────────────────────────────────────────────────
  if (!mobile) {
    await caption('Find it under <b>Useful Links → Enter Result</b>');
    await press(page.locator('a.nav-link:has-text("Useful Links")'));
    await sleep(500);
    await pointAt(visible('.dropdown-menu a:has-text("Enter Result")'));
    await sleep(900);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 400);
  } else {
    await caption('Open the menu: <b>Useful Links → Enter Result</b>');
    await press(page.locator('.navbar-toggler'));
    await sleep(700);
    await press(visible('a.nav-link:has-text("Useful Links")'));
    await sleep(500);
    await pointAt(visible('.dropdown-menu a:has-text("Enter Result")'));
    await sleep(1000);
    await press(page.locator('.navbar-toggler'));
    await sleep(600);
  }
  await caption('Then press <b>Enter Result</b>');
  await sleep(600);
  await press(visible('a:has-text("Enter Result").btn'));
  await sleep(900);

  // ── The photo ─────────────────────────────────────────────────────────────
  await spot('#photoUploadCard');
  await caption('Start with a photo of the signed scorecard<small>A scan, PDF or Word file works too</small>');
  await sleep(2600);
  await press(visible('#photoUploadCard .custom-file'));
  await spot();
  await demo('photo', '/__demo/card.jpg', true);
  await caption('Snap it on your phone, or pick the file');
  await sleep(3000);
  await demo('photo', '', 'fly');
  await caption(null);
  await sleep(600);
  await page.locator('#scorecardPhoto').first().setInputFiles(PHOTO);
  await sleep(300);
  await spot('#photoUploadCard');
  await caption('Google Vision reads the handwriting…<small>…and matches it to the fixture and to the teams’ registered players</small>');
  await page.locator('#photoAnalysisResult').first().waitFor({ state: 'visible' });
  await sleep(1000);
  await spot(mobile ? '#photoAnalysisResult' : '#signupModal .modal-body.step-1');
  await caption('Date, division, teams, 12 players and 36 scores — <b>filled in for you</b>');
  await sleep(3800);
  await spot();
  await caption('It’s a good first draft, not gospel — <b>check each step against the card</b>',
    'A first draft — <b>check it against the card</b>');
  await sleep(2600);

  // ── Players ───────────────────────────────────────────────────────────────
  await press(cont());
  await caption('The home team’s players, matched by name', 'Players matched by name');
  await sleep(2200);
  if (mobile) { await caption(null); await sleep(1300); }
  await press(cont());
  await caption('…and the away team’s');
  await sleep(1800);
  if (mobile) { await caption(null); await sleep(1100); }

  // ── Scores ────────────────────────────────────────────────────────────────
  await press(cont());
  await sleep(300);
  await spot('#signupModal .modal-body.step-4 .form-row:has(.scoreInput)');
  await caption('Each pair of games, with every score checked as it goes in<small><b>✓ green</b> = a valid badminton score</small>',
    'Every score is checked<small><b>✓ green</b> = a valid score</small>');
  await sleep(4200);
  await spot();
  await caption('Look along the card as you go…');
  for (let i = 0; i < 2; i++) { await press(cont()); await sleep(1400); }
  await press(cont());
  await sleep(500);
  await spot('#signupModal .modal-body.step-7 .form-row:has(.scoreInput)');
  await caption('<i>Red means something’s wrong.</i> Game 7 was read as 2–19 — the card says 21–19',
    '<i>Red = a problem.</i> Game 7 was read as 2–19; the card says 21–19');
  await sleep(4200);
  await caption('Someone must reach 21 and win by 2 — or get to 30<small>Anything else is flagged straight away</small>',
    '21 to win, by 2 clear — or first to 30');
  await sleep(3800);
  await spot();
  await caption('…and <b>Continue</b> won’t move on until it’s fixed');
  await press(cont());
  await sleep(1500);
  const g7 = visible('#Game7homeScore');
  await press(g7, 150);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await sleep(250);
  await page.keyboard.type('21', { delay: 260 });
  await spot('#signupModal .modal-body.step-7 .form-row:has(.scoreInput)');
  await caption('Correct it, and it turns <b>green</b>');
  await sleep(2600);
  await spot();

  await caption('The rest match the card');
  for (let i = 0; i < 5; i++) { await press(cont()); await sleep(900); }
  await press(cont());
  await sleep(400);
  await caption('The photo is already attached — no need to upload it again', 'The photo’s already attached');
  await sleep(2600);

  // ── Summary and submit ────────────────────────────────────────────────────
  await press(cont());
  await sleep(400);
  await caption('One last look at the whole match');
  await sleep(1600);
  if (mobile) {
    const body = visible('#signupModal');
    for (let y = 0; y < 1600; y += 40) { await body.evaluate((e, y) => { e.scrollTop = y; }, y); await sleep(28); }
  }
  await spot('#finalScore');
  await caption('Larkhill A win <b>12–6</b> — then press <b>Submit</b>');
  await sleep(2600);
  await spot();
  const submitFrom = Date.now() / 1000;
  await press(visible('#signup'));
  await page.waitForLoadState('networkidle');
  const submitTo = Date.now() / 1000;
  // POST /email-scorecard is limited to ten an hour per address and the counters live in the
  // server's memory: an eleventh take records a "Steady on" page. Restart the server.
  const received = await page.getByRole('heading', { name: 'Scorecard received' }).isVisible();
  if (!received) {
    await browser.close();
    throw new Error(`Submit did not reach the confirmation page (${page.url()}) — rate limited? Restart the demo server.`);
  }
  await sleep(500);

  // ── Received ──────────────────────────────────────────────────────────────
  await caption('Done. The results secretary checks it and puts it on the website');
  await sleep(3400);
  await caption('This page shows what you sent, photo included<small>Spot a mistake? Email the address at the top</small>');
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= total; y += mobile ? 22 : 16) { await page.evaluate(y => scrollTo(0, y), y); await sleep(20); }
  await sleep(1800);
  await caption(null);

  await demo('card', 'That’s it', 'Photo in, check it, submit',
    'No photo? Fill the form in by hand — the same checks apply.<span class="mail">Problems? stockport.badders.results@gmail.com</span>');
  await sleep(4500);

  capturing = false;
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await browser.close();
  // dm-tick keeps frames coming, so a long gap means Chrome stalled and the scene froze on
  // screen while the script carried on (one take lost its title card and froze for 20s).
  // The submit is exempt: the local server spends seconds failing to send its notification
  // email (dead credentials) before it redirects. That wait is cut to 0.8s below.
  const inSubmit = t => t >= submitFrom - 1 && t <= submitTo + 1;
  const gaps = frames.slice(1).map((f, i) => ({ gap: inSubmit(frames[i].t) ? 0 : f.t - frames[i].t, at: frames[i].t - frames[0].t }));
  const worst = gaps.reduce((a, b) => (b.gap > a.gap ? b : a), { gap: 0, at: 0 });
  const slow = gaps.filter(g => g.gap > 0.5).map(g => `${g.gap.toFixed(1)}s at ${g.at.toFixed(1)}s`);
  if (slow.length) console.log('frame gaps:', slow.join(', '));
  if (worst.gap > 1) throw new Error(`Capture stalled for ${worst.gap.toFixed(1)}s at ${worst.at.toFixed(1)}s — record it again`);
  // Each frame is held until the next.
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.min(end, f.t + 6);
    const held = inSubmit(f.t) ? Math.min(next - f.t, 0.8) : next - f.t;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, held).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(`${OUT}/frames.ffconcat`, lines.join('\n') + '\n');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-safe', '0', '-f', 'concat', '-i', `${OUT}/frames.ffconcat`,
    '-vf', `fps=30,scale=${W - (W % 2)}:${H - (H % 2)}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', `${OUT}/take.mp4`]);
  // The published cut: small enough to serve from static/, and fast-start so it plays while
  // it downloads. The poster is the title card.
  const pub = path.join(ROOT, 'static/beta/video', `enter-result-${mode}`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${OUT}/take.mp4`, '-c:v', 'libx264', '-preset', 'veryslow',
    '-crf', '26', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-an', `${pub}.mp4`]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '2', '-i', `${OUT}/take.mp4`, '-frames:v', '1', '-q:v', '4', `${pub}.jpg`]);
  console.log(`${pub}.mp4 (${frames.length} frames)`);
})();
