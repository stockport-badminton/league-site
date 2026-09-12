// Is this test process holding something that reaches production?
//
// A pure predicate so it can be tested directly; wired into __tests__/setupAfterEnv.js,
// which runs before every suite.
//
// The point is that it is an ALLOWLIST of shapes, not a denylist of variable names. The
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
  const e = env || process.env;
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
  // between the public internet and the audit and registration runs. Unset closes those
  // paths; a value in a test process is a live secret with nothing to gain from it.
  for (const name of ['AUDIT_CRON_TOKEN', 'REGISTRATION_CRON_TOKEN']) {
    if (e[name]) found.push(`${name} is set`);
  }

  // Recipient lists: set means the weekly digest and the registration chaser will actually
  // send. Unset is what makes `npm test` incapable of emailing the results secretary.
  for (const name of ['AUDIT_EMAIL_TO', 'REGISTRATION_EMAIL_TO']) {
    if (e[name]) found.push(`${name} is set, so a test could send real mail`);
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
    '__tests__/setup.js is meant to declare the entire environment — app.js and',
    'instrument.js skip dotenv under NODE_ENV=test precisely so nothing is inherited.',
    'Something has put these back: a shell export, a changed setup.js, or a new variable',
    'in .env that setup.js does not neutralise.',
    '',
    'See docs/hardening/done/HARD-26-test-process-carries-production-secrets.md — this has',
    'already cost two real objects written into the production bucket.',
    '',
  ].join('\n');
}

module.exports = { liveCredentials, refusalMessage, hostOf, PRODUCTION_DB_HOSTS };
