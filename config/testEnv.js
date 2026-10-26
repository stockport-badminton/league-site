// The Jest and Playwright environments, derived from config/schema.js (REARCH-06).
//
// These used to be two hand-written lists, __tests__/setup.js and e2e/server-env.js, and
// they drifted apart by default: on 15 Sep 2026 LATE_SCORECARD_CRON_TOKEN went into one
// and not the other, and the Meta credentials did the same a few hours later. Now an
// entry's `test` and `e2e` fields are the decision, so a variable added to the schema is
// treated in both suites in the same line that declares it.
//
// Three treatments, and the difference matters (HARD-26):
//   fake  — a value that resolves nowhere. Credentials the app needs to start.
//   unset — deleted. Safe BECAUSE absent: an unset AUDIT_EMAIL_TO sends nothing, an unset
//           cron token closes its path. A fake would arm the thing, not secure it — the
//           mistake that broke three tests when HARD-26 was written.
//   real  — S3_BUCKET_NAME only. Tests compare URLs against it; the dead credentials are
//           what make the bucket unreachable, and renaming it would only make them wrong.
const schema = require('./schema');

function e2eTreatment(entry) {
  if (entry.e2e) return entry.e2e;
  return entry.test === 'real' || entry.test === 'pass' ? 'local' : entry.test;
}

// Anything matching these is deleted even when the schema has never heard of it. A
// declared list is still one variable behind a `.env` nobody has reconciled yet, and the
// Meta Page tokens never expire and can publish to the league's Pages and Instagram.
const NEVER_IN_A_TEST = [/_CRON_TOKEN$/, /^META_/];

function deleteUndeclaredDangers(env) {
  for (const name of Object.keys(env)) {
    if (NEVER_IN_A_TEST.some(re => re.test(name))) delete env[name];
  }
}

/** The whole Jest environment. Called from __tests__/setup.js before any module loads. */
function applyForJest(env) {
  deleteUndeclaredDangers(env);
  for (const [name, entry] of Object.entries(schema)) {
    if (entry.test === 'fake' || entry.test === 'real') env[name] = entry.testValue;
    else if (entry.test === 'unset') delete env[name];
  }
}

/**
 * The browser suite's server environment. `readFile(name)` returns the parsed contents of
 * dev.env, then .env (or {} if absent). Only variables the schema declares 'local' are taken
 * from them, and only when the shell has not already set them — playwright.config.js puts
 * DEV_MODE, NODE_ENV and GLOBAL_RATE_LIMIT on the command line. Nothing else in .env (the
 * old Twitter, RDS and Make secrets among them) ever reaches the server.
 */
function applyForE2E(env, envFiles) {
  for (const [name, entry] of Object.entries(schema)) {
    const how = e2eTreatment(entry);
    if (how === 'fake') env[name] = entry.testValue;
    else if (how === 'unset') delete env[name];
    else if (how === 'local' && env[name] === undefined) {
      const from = envFiles.find(parsed => parsed[name] !== undefined);
      if (from) env[name] = from[name];
    }
  }
  deleteUndeclaredDangers(env);
}

module.exports = { applyForJest, applyForE2E, e2eTreatment, NEVER_IN_A_TEST };
