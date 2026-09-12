// Refuse to run the browser suite against a server we did not configure.
//
// playwright.config.js sets `reuseExistingServer: !process.env.CI`, which is a real
// convenience — it makes the suite fast to re-run against a server you already have up.
// It also means the suite adopts WHATEVER is listening on 8080. `npm run prodlocal` loads
// .env, so running the browser tests while that is up silently points all 71 specs at the
// production database and the production bucket, and nothing would say so.
//
// e2e/server-env.js sets E2E_SERVER, and /health reports it. Checking for the marker
// rather than for something bad is deliberate: a production server cannot emit it, so the
// check fails closed. Looking for evidence of production instead would need this file to
// know every shape production can take, which is the denylist mistake HARD-26 was about.

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:8080';

module.exports = async () => {
  let body;
  try {
    const res = await fetch(`${BASE_URL}/health`);
    body = await res.json();
  } catch (err) {
    throw new Error(
      `Could not reach ${BASE_URL}/health to check what server this is: ${err.message}`);
  }

  if (body && body.e2e === true) return;

  throw new Error([
    '',
    '════════════════════════════════════════════════════════════════════════',
    `  The server on ${BASE_URL} was not started by e2e/server-env.js.`,
    '',
    '  Playwright reuses a server that is already running, and this one is not',
    '  ours — so it may be pointed at the PRODUCTION database and bucket.',
    '  `npm run prodlocal` is the usual culprit.',
    '',
    '  Stop it and let the suite start its own, or start one with:',
    '    DEV_MODE=true NODE_ENV=development node -r ./e2e/server-env.js app.js',
    '════════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n'));
};
