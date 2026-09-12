// The environment the browser suite's dev server runs in.
//
// Preloaded with `node -r ./e2e/server-env.js app.js` from playwright.config.js, so it
// runs before app.js and therefore before app.js's own dotenv.config().
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
//
// Load order matters and is the same trick tools/lib/loadEnv.js relies on: dotenv never
// overwrites a variable that is already set, so assigning the dead credentials FIRST means
// neither dev.env nor .env can put the real ones back.

const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');

// ── 1. Dead credentials, assigned before anything is loaded ──────────────────
//
// Same shapes as __tests__/setup.js. The AWS block closes the fallback chain as well as
// the keys: without it the SDK would look at ~/.aws/credentials and the EC2 metadata
// service and could still find something that works.
process.env.AWS_ACCESS_KEY_ID = 'e2e-access-key-id';
process.env.AWS_SECRET_ACCESS_KEY = 'e2e-secret-access-key';
process.env.AWS_SESSION_TOKEN = '';
process.env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null/no-such-credentials';
process.env.AWS_CONFIG_FILE = '/dev/null/no-such-config';
process.env.AWS_EC2_METADATA_DISABLED = 'true';
process.env.AWS_PROFILE = '';

process.env.AUTH0_CLIENT_SECRET = 'e2e-auth0-client-secret';
process.env.RECAPTCHA_SECRET = 'e2e-recaptcha-secret';
process.env.CLOUDINARY_KEY = 'e2e-cloudinary-key';
process.env.CLOUDINARY_SECRET = 'e2e-cloudinary-secret';
process.env.GMAPS_STATIC_API_KEY = 'e2e-gmaps-static-key';
process.env.SESSION_SECRET = 'e2e-session-secret';
process.env.TAMESIDE_DATABASE_URL = 'postgresql://e2e:e2e@127.0.0.1:1/nowhere';

// ── 2. The real local configuration ──────────────────────────────────────────
//
// dev.env supplies DATABASE_URL (the local Postgres) and DB_PI_KEY (the local key the
// sanitised contact details were re-encrypted under). Neither may be faked: the pages
// under test read real rows and decrypt real columns.
//
// .env is then loaded for the remainder, so that app.js's own dotenv.config() finds
// everything already set and is a no-op. That matters — it means the guard below sees
// exactly the environment app.js will run in, rather than a snapshot taken before .env
// had its say.
for (const file of ['dev.env', '.env']) {
  const at = path.join(root, file);
  if (fs.existsSync(at)) require('dotenv').config({ path: at });
}

// ── 3. Variables that are safe BECAUSE they are absent ───────────────────────
//
// Deleted after loading, since .env sets several of them. An unset AUDIT_EMAIL_TO is what
// makes the server incapable of emailing the results secretary; an unset cron token CLOSES
// that path rather than opening it. Setting a fake would arm the thing, not secure it —
// the mistake that broke three tests when HARD-26 was written.
delete process.env.AUDIT_EMAIL_TO;
delete process.env.REGISTRATION_EMAIL_TO;
delete process.env.AUDIT_CRON_TOKEN;
delete process.env.REGISTRATION_CRON_TOKEN;
delete process.env.SENTRY_DSN;
delete process.env.SNS_TOPIC_ARN;
delete process.env.CSP_ENFORCE;
delete process.env.K_SERVICE;
delete process.env.K_REVISION;

// S3_BUCKET_NAME keeps its real value for HARD-26's reason: normalisePhotoUrl checks a
// photo's host against it, so renaming the bucket makes the page wrong rather than safer.
// The dead credentials above are what make it unreachable.

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
