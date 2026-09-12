// Tools must not choose their own database.
//
// dotenv does not overwrite a variable that is already set, so whichever env file loads
// FIRST decides which database a tool talks to. Every tool used to load dev.env first and
// .env second. That was harmless for as long as dev.env carried the same connection
// string as .env — and wrong the instant HARD-13 pointed dev.env at a local Postgres.
//
// The failure was silent and, for an audit tool, the worst available: `dbq --check all`
// kept running and kept printing counts, against a two-year-old local seed rather than
// production. It surfaced only because a query returned "no rows" for drafts that plainly
// existed — and it could just as easily have been a data decision taken on the wrong
// numbers.
//
// So the ordering is no longer something each tool gets right or wrong: it lives in
// tools/lib/loadEnv.js, production is the default, and asking for the development
// database is explicit (`dbq --local`). This asserts nothing drifts back.

const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '../../tools');

const files = fs.readdirSync(TOOLS)
  .filter(f => f.endsWith('.js'))
  .map(f => ({ name: f, source: fs.readFileSync(path.join(TOOLS, f), 'utf8') }));

const stripComments = src =>
  src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('tools load their environment through one helper', () => {
  const usingEnv = files.filter(f => /dev\.env|loadEnv/.test(stripComments(f.source)));

  it('there are tools to check', () => {
    // If this reaches zero the sweep below is vacuous and would pass for ever.
    expect(usingEnv.length).toBeGreaterThan(2);
  });

  for (const file of usingEnv) {
    it(`${file.name} uses loadEnv rather than calling dotenv itself`, () => {
      const code = stripComments(file.source);
      expect(code).toMatch(/loadEnv\(/);
      // A direct dotenv call is how the order becomes a per-file decision again.
      // (Jest's expect takes no message argument — that is Playwright's.)
      expect(code).not.toMatch(/require\(['"]dotenv['"]\)\.config\(/);
    });
  }

  // The helper itself is the one place allowed to care, and it must default to production.
  it('the helper defaults to production and takes an explicit opt-in for local', () => {
    const helper = fs.readFileSync(path.join(TOOLS, 'lib/loadEnv.js'), 'utf8');
    const code = stripComments(helper);
    expect(code).toMatch(/local \? \['dev\.env', '\.env'\] : \['\.env', 'dev\.env'\]/);
  });
});
