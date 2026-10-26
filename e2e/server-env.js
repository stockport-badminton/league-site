// The environment the browser suite's dev server runs in.
//
// Preloaded with `node -r ./e2e/server-env.js app.js` from playwright.config.js, so it
// runs before app.js reads anything.
//
// Why this exists: HARD-26 made the Jest process incapable of reaching anything real, but
// nothing had done the same for the browser suite. It starts a REAL server, and that
// server was loading dev.env overlaid on .env — so it held a live AKIA key and the real
// bucket name. Measured 12 Sep 2026: HeadBucket on badmintontemp with those credentials
// returned 200.
//
// e2e/helpers/read-only.js does not cover this. It intercepts browser requests, so it
// stops a presigned PUT from the page and aborts anything cross-origin — but it cannot see
// a PUT made from inside the Node process, and POST /api/analyse-scorecard and
// POST /api/convert-scorecard-document both store their converted image exactly that way.
// A test would pass, the guard would report no writes, and the objects would be in the
// production bucket. That is how HARD-25's first Jest run put two real objects there.
//
// What this file does NOT touch is dev.env itself, so `npm run dev` is unaffected and
// still has working credentials for real local work.

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const root = path.join(__dirname, '..');

// ── 1–3. The environment, derived from config/schema.js ──────────────────────
//
// Each schema entry's `e2e` field decides it: 'fake' gets a value that resolves nowhere
// (the AWS block closes the SDK's fallback chain as well as the keys), 'unset' is deleted
// (an unset AUDIT_EMAIL_TO is what makes this server incapable of emailing the results
// secretary; an unset cron token closes that path), and 'local' comes from dev.env — the
// local Postgres and the key the sanitised contact details were re-encrypted under — then
// .env. Only declared variables are taken from those files, so nothing undeclared in .env
// reaches this server, and config/index.js skips its own dotenv call when E2E_SERVER is set.
const envFiles = ['dev.env', '.env'].map(file => {
  const at = path.join(root, file);
  return fs.existsSync(at) ? dotenv.parse(fs.readFileSync(at)) : {};
});
require('../config/testEnv').applyForE2E(process.env, envFiles);

// ── 4. Refuse to start if anything live survived ─────────────────────────────
const { liveCredentials, refusalMessage } = require('../utils/testEnvGuard');
const live = liveCredentials(process.env);
if (live.length) {
  console.error(refusalMessage(live));
  console.error('  This is the browser suite\'s dev server (e2e/server-env.js), not a test process.');
  process.exit(1);
}

// ── 5. Say so, for the benefit of a suite that did not start this server ─────
//
// playwright.config.js has reuseExistingServer, so the suite adopts whatever is already
// listening on the port — including an `npm run prodlocal` server, which loads .env and is
// pointed at the production database AND the production bucket. e2e/global-setup.js reads
// this marker back off /health and refuses to run without it. A production server can
// never emit it, because nothing there sets this.
process.env.E2E_SERVER = '1';
