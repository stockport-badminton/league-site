// Records the "how to turn on notifications" walkthrough of /notifications, phone cut (9:16),
// against the LOCAL demo server. See README.md for the server and the seed.
//
//   node tools/demo-video/record-notifications.js
//
// Real: the homepage, the menu and the /notifications page with the fictional Larkhill club
// from seed.sql. Stubbed, because a headless browser has no push service and draws no browser
// UI: the subscription itself (PushManager and /api/push/*, so nothing is written), the
// "Allow notifications?" prompt and the notifications arriving (overlay.js `prompt`/`notify`).
//
// The frame capture and encode are the same as record.js's (copied rather than shared, so the
// result videos' recorder is untouched by this one).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');

const D = __dirname;
const ROOT = path.join(D, '../..');
const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:8080';
const OUT = `${D}/generated/notifications`;
fs.mkdirSync(OUT, { recursive: true });

const psql = sql => execFileSync('docker', ['exec', '-i', 'sdbl-local-db', 'psql', '-U', 'sdbl', '-d', 'sdbl', '-At', '-c', sql],
  { encoding: 'utf8' }).trim();
const TEAM = psql("SELECT id FROM team WHERE name = 'Larkhill A'");
if (!TEAM) throw new Error('Demo teams missing: load tools/demo-video/seed.sql into the local database');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const viewport = { width: 360, height: 640 };
  const scale = 3;
  const browser = await chromium.launch({ channel: 'chromium', args: [`--force-device-scale-factor=${scale}`] });
  const { viewport: _v, deviceScaleFactor: _d, ...phone } = devices['Pixel 7'];
  const ctx = await browser.newContext({ ...phone, viewport, deviceScaleFactor: scale, bypassCSP: true, permissions: ['notifications'] });
  // No push service in headless Chromium: hand the page a subscription that looks real. Its
  // own script, first, so nothing else in an init script can stop it being installed.
  await ctx.addInitScript(() => {
    if (window.PushManager) {
      let sub = null;
      const fake = { endpoint: 'https://fcm.googleapis.com/fcm/send/demo-video',
        toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'demo', auth: 'demo' } }; },
        unsubscribe: async () => { sub = null; return true; } };
      PushManager.prototype.getSubscription = async () => sub;
      PushManager.prototype.subscribe = async () => (sub = fake);
    }
  });
  await ctx.addInitScript({ path: `${D}/overlay.js` });
  await ctx.addInitScript(() => {
    window.__dmPhone = true;
    document.documentElement.style.setProperty('--cap-size', '19px');
    document.documentElement.style.setProperty('--cap-bottom', '13%');
    document.documentElement.style.setProperty('--card-h', '36px');
    document.documentElement.style.setProperty('--card-p', '18px');
    document.documentElement.style.setProperty('--card-k', '14px');
  });
  // The worker precaches /static/generated/venues-map.png, which the local server can only 404
  // (it is read from S3), and one failed precache aborts the install: no worker, no push. The
  // context route also catches the worker's own requests.
  await ctx.route('**/static/generated/venues-map.png', r => r.fulfill({ path: path.join(ROOT, 'rootfiles/touch-icon-192x192.png'), contentType: 'image/png' }));
  const page = await ctx.newPage();
  await page.route('**/api/push/subscription', r => r.fulfill({ json: { ok: true, subscribed: false } }));
  await page.route('**/api/push/subscribe', r => r.fulfill({ json: { ok: true, teams: [Number(TEAM)], types: ['results', 'reminders'] } }));

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
  const W = viewport.width * scale, H = viewport.height * scale;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H });

  const demo = (fn, ...args) => page.evaluate(([fn, args]) => window.__demo[fn](...args), [fn, args]);
  const caption = html => demo('caption', html);
  const spot = sel => demo('spot', sel || null);
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

  // ── Title, and the iPhone step that has to come first ─────────────────────
  await page.goto(`${BASE}/`);
  await demo('pointer', -80, -80);
  await demo('card', 'Stockport &amp; District Badminton League', 'Notifications on your phone',
    'Your team’s results as they’re published, and a reminder before every match.');
  await sleep(700);
  capturing = true;
  await sleep(4200);
  await demo('card', 'On an iPhone or iPad?', 'Add the site to your Home Screen first',
    'In Safari tap <b>Share</b> → <b>Add to Home Screen</b>, then open the site from its new icon.<br><br>On Android, carry straight on in Chrome.');
  await sleep(6500);
  await demo('card', 'x', null);
  await sleep(800);

  // ── Getting there ─────────────────────────────────────────────────────────
  await caption('Open the menu: <b>Useful Links → Notifications</b>');
  await press(page.locator('.navbar-toggler'));
  await sleep(700);
  await press(visible('a.nav-link:has-text("Useful Links")'));
  await sleep(500);
  await press(visible('.dropdown-menu a:has-text("Notifications")'));
  await page.waitForURL('**/notifications');
  await page.locator('[data-state="ready"]').waitFor({ state: 'visible' });
  await caption(null);
  await sleep(900);

  // ── Teams ─────────────────────────────────────────────────────────────────
  await caption('Find your club…');
  const club = visible('summary:has-text("Larkhill")');
  await pointAt(club);
  await sleep(500);
  await press(club);
  await sleep(700);
  await caption('…and tick your team<small>Tick as many teams as you like</small>');
  await press(visible(`label[for="team-${TEAM}"]`));
  await sleep(2400);

  // ── Types ─────────────────────────────────────────────────────────────────
  const types = visible('fieldset:has(input[name="push-type"])');
  await types.scrollIntoViewIfNeeded();
  await sleep(400);
  await spot('fieldset:has(input[name="push-type"])');
  await caption('Results, match reminders, or both<small>Reminders come at 6pm the evening before and 5pm on the day</small>');
  await sleep(4200);
  await spot();

  // ── Turning on ────────────────────────────────────────────────────────────
  const on = visible('[data-action="subscribe"]');
  await caption('Then press <b>Turn on notifications</b>');
  await pointAt(on);
  await sleep(500);
  await demo('tapRing');
  await sleep(400);
  await caption(null);
  await demo('prompt', 'stockport-badminton.co.uk');
  await sleep(900);
  await caption('Your phone asks first — tap <b>Allow</b>');
  await sleep(1800);
  await pointAt(page.locator('#dm-prompt .allow'));
  await demo('tapRing');
  await sleep(500);
  await demo('prompt', null);
  await caption(null);
  await on.click();
  await page.locator('[data-role="status"]:has-text("Notifications are on")').waitFor({ timeout: 8000 }).catch(async e => {
    throw new Error('Turning on failed; the page says: ' + await page.locator('[data-role="status"]').textContent());
  });
  await sleep(500);
  await spot('[data-role="status"]');
  await caption('That’s it — <b>notifications are on</b> for this phone');
  await sleep(3400);
  await spot('#push-panel [data-state="ready"] .btn');
  await caption('Come back any time to change teams (<b>Save settings</b>) or to stop them (<b>Turn off</b>)',);
  await sleep(4400);
  await spot();
  await caption(null);
  await demo('pointer', -80, -80);
  await sleep(600);

  // ── What arrives ──────────────────────────────────────────────────────────
  await caption('The evening before a match…', null);
  await demo('notify', 'Tomorrow: Larkhill A v Brookvale A', '7:30pm · Larkhill Leisure Centre · Division 2');
  await sleep(3800);
  await caption('…on the day…');
  await demo('notify', 'Tonight: Larkhill A v Brookvale A', '7:30pm · Larkhill Leisure Centre · Division 2');
  await sleep(3600);
  await caption('…and the result, as soon as it’s on the website');
  await demo('notify', 'Larkhill A 12–6 Brookvale A', 'Result · Division 2');
  await sleep(3800);
  await caption('Tap one to open the match page');
  await sleep(2800);
  await demo('notify', null);
  await caption(null);
  await sleep(500);

  await demo('card', 'That’s it', 'Pick teams, turn on, Allow',
    'Notifications are per device — do it on each phone you use.<br>Every club page has a 🔔 beside each team.');
  await sleep(5000);

  capturing = false;
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await browser.close();

  const gaps = frames.slice(1).map((f, i) => ({ gap: f.t - frames[i].t, at: frames[i].t - frames[0].t }));
  const worst = gaps.reduce((a, b) => (b.gap > a.gap ? b : a), { gap: 0, at: 0 });
  // The navigation to /notifications is allowed a longer gap: the page is loading.
  if (worst.gap > 1.5) throw new Error(`Capture stalled for ${worst.gap.toFixed(1)}s at ${worst.at.toFixed(1)}s — record it again`);
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.min(end, f.t + 6);
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(`${OUT}/frames.ffconcat`, lines.join('\n') + '\n');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-safe', '0', '-f', 'concat', '-i', `${OUT}/frames.ffconcat`,
    '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', `${OUT}/take.mp4`]);
  const pub = path.join(ROOT, 'static/beta/video', 'notifications-mobile');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${OUT}/take.mp4`, '-c:v', 'libx264', '-preset', 'veryslow',
    '-crf', '26', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-an', `${pub}.mp4`]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '2', '-i', `${OUT}/take.mp4`, '-frames:v', '1', '-q:v', '4', `${pub}.jpg`]);
  console.log(`${pub}.mp4 (${frames.length} frames, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)}s)`);
})().catch(e => { console.error(e); process.exit(1); });
