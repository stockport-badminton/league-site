// `req.user.email` does not exist, and reading it fails silently.
//
// req.user is the raw passport-auth0 `Profile`, cached whole in the session by
// `passport.serializeUser` in app.js. That object carries `displayName`, `id`, `name`,
// `emails: [{ value }]` and `_json` — and no `email`. The login strategy itself reads
// `profile.emails[0].value`, so the shape was never in doubt; the spelling just looked
// obvious enough that three call sites used it.
//
// It fails in the worst available way. `undefined` is falsy, so every one of those sites
// had a `||` fallback or an `if` beside it and quietly took the other branch:
//
//   - `rosterController` put the requester in a transfer email's `replyTo` so the club
//     could reply to whoever asked. It has always sent the league address alone.
//   - `spamAdminController` recorded who added a blocklist entry. Every row says 'admin'.
//   - `registrationController` survived only because `displayName` is checked first.
//
// Found 17 Sep 2026 while adding the submitter's address to the draft-received email,
// where the new code had been written with the same spelling and would have shipped doing
// nothing at all.

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const { userEmail, userDisplayName, userLabel } = require('../../utils/sessionUser');

describe('the premise, against the real dependency', () => {
  // Built with passport-auth0's own Profile constructor rather than a hand-written
  // object. A test that asserts against my description of the shape proves only that I
  // described it consistently; this one breaks if the dependency ever grows an `email`.
  const Profile = require('passport-auth0/lib/Profile');
  const AUTH0_USERINFO = {
    sub: 'auth0|abc123',
    name: 'Jane Captain',
    email: 'jane.captain@example.com',
    email_verified: true,
  };
  const profile = new Profile(AUTH0_USERINFO, JSON.stringify(AUTH0_USERINFO));

  it('has no `email` property — the whole reason this helper exists', () => {
    expect(profile.email).toBeUndefined();
  });

  it('carries the address as `emails[0].value`, which is what the helper reads', () => {
    expect(profile.emails[0].value).toBe('jane.captain@example.com');
    expect(userEmail(profile)).toBe('jane.captain@example.com');
  });

  it('gives the display name and a combined label', () => {
    expect(userDisplayName(profile)).toBe('Jane Captain');
    expect(userLabel(profile)).toBe('Jane Captain (jane.captain@example.com)');
  });
});

describe('userEmail', () => {
  it('falls back to the raw Auth0 claims', () => {
    expect(userEmail({ _json: { email: 'bob@example.com' } })).toBe('bob@example.com');
  });

  it('prefers `emails`, which is what the login strategy authenticates on', () => {
    expect(userEmail({ emails: [{ value: 'a@x.com' }], _json: { email: 'b@x.com' } })).toBe('a@x.com');
  });

  // Never undefined: callers put this straight into a mail header or a template, and
  // `undefined` there is how this bug looked in the first place.
  it.each([undefined, null, {}, { emails: [] }, { emails: [{}] }, { _json: {} }])(
    'returns a string, never undefined: %p', user => {
      expect(userEmail(user)).toBe('');
    });

  it('trims', () => {
    expect(userEmail({ emails: [{ value: '  a@x.com ' }] })).toBe('a@x.com');
  });
});

describe('userLabel', () => {
  it('is the address alone when there is no name', () => {
    expect(userLabel({ emails: [{ value: 'a@x.com' }] })).toBe('a@x.com');
  });

  it('is the name alone when there is no address', () => {
    expect(userLabel({ displayName: 'Jane' })).toBe('Jane');
  });

  it('is empty for nobody', () => {
    expect(userLabel(undefined)).toBe('');
  });
});

// The guard. Same shape as the other static-analysis guards in this directory, and the
// same lesson as __tests__/unit/mail-sends-use-mailer.test.js: count CODE, not mentions —
// several files discuss `req.user.email` in a comment explaining why not to use it.
describe('no source file reads .user.email directly', () => {
  const ROOTS = ['controllers', 'models', 'utils', 'routes', 'middleware'];

  function stripCommentsAndStrings(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')       // block comments
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')   // line comments, sparing "http://"
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")   // single-quoted strings
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')   // double-quoted
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');    // template literals
  }

  // The stripper is the part that can rot without anyone noticing: a desynchronised
  // scanner under-reports, so it fails in the direction that looks fine.
  it('self-test: the stripper removes comments but keeps code', () => {
    const sample = [
      '// a comment about req.user.email',
      '/* a block about req.user.email */',
      "const s = 'req.user.email in a string';",
      'const real = req.user.email;',
    ].join('\n');
    const stripped = stripCommentsAndStrings(sample);
    expect((stripped.match(/\.user\.email\b/g) || []).length).toBe(1);
  });

  const files = [];
  for (const root of ROOTS) {
    const dir = path.join(__dirname, '..', '..', root);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.js')) files.push(path.join(dir, name));
    }
  }

  it('found files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map(f => [path.relative(path.join(__dirname, '..', '..'), f), f]))(
    '%s', (rel, full) => {
      const code = stripCommentsAndStrings(fs.readFileSync(full, 'utf8'));
      const hits = code.match(/\.user\.email\b/g) || [];
      expect(hits).toEqual([]);   // use utils/sessionUser's userEmail(req.user) instead
    });
});
