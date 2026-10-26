// Is this test process holding something that reaches production?
//
// A pure predicate so it can be tested directly; wired into __tests__/setupAfterEnv.js,
// which runs before every suite.
//
// The schema (config/schema.js) decides what the test environment IS; this checks what it
// actually turned out to be, which is a different question. The point is that it is an
// ALLOWLIST of shapes, not a denylist of variable names. The
// exposure this closes had already been patched three times variable by variable — Sentry
// reporting our own test runs, then two real objects written into the production bucket —
// and each patch was one variable behind the next one added to .env. Checking the SHAPE of
// what is present catches a credential nobody thought to neutralise.

// Hosts that are the live database. Substring match: the connection string appears both
// directly and in pooler form.
const PRODUCTION_DB_HOSTS = ['supabase.co', 'supabase.com'];

// A real AWS key id is AKIA/ASIA + 16 more. The dummies planted in setup.js are not.
const REAL_AWS_KEY = /^(AKIA|ASIA)[A-Z0-9]{16}$/;

function hostOf(connectionString) {
  const match = String(connectionString || '').match(/@([^:/?]+)/);
  return match ? match[1] : '';
}

/**
 * @param {object} env
 * @returns {string[]} one message per live credential found; empty means clean.
 */
function liveCredentials(env) {
  const e = env;
  const found = [];

  for (const name of ['DATABASE_URL', 'TAMESIDE_DATABASE_URL']) {
    const host = hostOf(e[name]);
    if (host && PRODUCTION_DB_HOSTS.some(h => host.endsWith(h))) {
      found.push(`${name} points at ${host}`);
    }
  }

  if (REAL_AWS_KEY.test(String(e.AWS_ACCESS_KEY_ID || ''))) {
    found.push('AWS_ACCESS_KEY_ID looks like a real key id');
  }

  // The cron tokens are compared with timingSafeEqual and are the only thing standing
  // between the public internet and the audit, registration, invoice and missing-scorecard
  // runs. Unset closes those paths; a value in a test process is a live secret with nothing
  // to gain from it.
  //
  // Matched by SHAPE, not by a list of names. This file's whole claim is that it checks
  // shapes so it cannot go one variable out of date the way `__tests__/setup.js` did three
  // times — and this loop was a hardcoded list of three, which is that same bug one layer
  // in. It would have gone stale on 15 Sep 2026, when LATE_SCORECARD_CRON_TOKEN became the
  // fourth. Any `*_CRON_TOKEN` now counts.
  for (const name of Object.keys(e)) {
    if (/_CRON_TOKEN$/.test(name) && e[name]) found.push(`${name} is set`);
  }

  // Meta Graph API credentials (Sep 2026). A Page access token is the sharpest thing in
  // `.env`: `debug_token` reports `expires: never`, and it can publish to the league's
  // Facebook Pages and its Instagram account. There is no expiry to save us and no
  // "sandbox" Meta to point it at — a test process holding one could post to 90 followers.
  //
  // Two rules, deliberately overlapping:
  //
  //   - by VALUE: every Meta Graph access token starts `EAA`, and every Threads token
  //     starts `THAA` (the first real one, 26 Sep 2026), which is distinctive enough to
  //     catch one stored under a name nobody here anticipated. Threads is the one that
  //     would have slipped through: a Threads token is not an `EAA` token, and the app
  //     keeps it in the database rather than in a `META_*` variable;
  //   - by NAME PATTERN, not a list: any `META_*TOKEN` or `META_*SECRET`. A pattern
  //     survives a new variable; a list is one variable behind the next deploy, which is
  //     the mistake the cron loop above made and `__tests__/setup.js` made three times.
  //
  // The ids (META_PAGE_ID, META_IG_USER_ID) are deliberately NOT flagged. They are public
  // — they appear in page URLs — and a test that needs a plausible id should have one.
  for (const [name, value] of Object.entries(e)) {
    const v = String(value || '');
    if (!v) continue;
    if (/^EAA[A-Za-z0-9]/.test(v)) found.push(`${name} holds a Meta access token`);
    else if (/^THAA[A-Za-z0-9]/.test(v)) found.push(`${name} holds a Threads access token`);
    else if (/^META_.+(TOKEN|SECRET)$/.test(name)) found.push(`${name} is set`);
  }

  // Recipient lists: set means the weekly digest and the registration chaser will actually
  // send. Unset is what makes `npm test` incapable of emailing the results secretary.
  for (const name of ['AUDIT_EMAIL_TO', 'REGISTRATION_EMAIL_TO']) {
    if (e[name]) found.push(`${name} is set, so a test could send real mail`);
  }

  // From config/schema.js (REARCH-06). A secret the tests are meant to run without, if
  // present, is live by definition; and a value shaped like a declared secret is caught
  // under ANY name except one the schema declares public (GMAPSAPIKEY holds a real AIza key
  // in the browser suite, and is meant to).
  const schema = require('../config/schema');
  for (const [name, entry] of Object.entries(schema)) {
    if (entry.kind === 'secret' && entry.test === 'unset' && e[name] && !found.some(f => f.startsWith(name + ' '))) {
      found.push(`${name} is set`);
    }
  }
  for (const [secret, entry] of Object.entries(schema)) {
    if (!entry.shape) continue;
    for (const [name, value] of Object.entries(e)) {
      if (schema[name] && schema[name].kind === 'public') continue;
      // The name's own check above has already said so.
      if (name === secret && found.some(f => f.startsWith(name + ' '))) continue;
      if (entry.shape.test(String(value || ''))) found.push(`${name} holds what looks like a real ${secret}`);
    }
  }

  return found;
}

function refusalMessage(found) {
  return [
    '',
    'This test process is holding live production credentials.',
    '',
    ...found.map(f => '  - ' + f),
    '',
    'config/schema.js declares the entire test environment — config/index.js skips',
    'dotenv under NODE_ENV=test precisely so nothing is inherited. Something has put',
    'these back: a shell export, or a variable the schema does not declare.',
    '',
    'See docs/hardening/done/HARD-26-test-process-carries-production-secrets.md — this has',
    'already cost two real objects written into the production bucket.',
    '',
  ].join('\n');
}

module.exports = { liveCredentials, refusalMessage, hostOf, PRODUCTION_DB_HOSTS };
