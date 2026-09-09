// Every outbound email goes through utils/mailer.send — or is listed here with a reason.
//
// Why this exists: when the last ten sends moved onto the MJML pipeline, one was missed —
// the signup notification in routes/index.js, which built its HTML with string
// concatenation and so had no styling, no plain-text alternative and no "why you got
// this" line. It survived because it lives in a *route* rather than a controller, so
// unlike the others there was no unstyled file in views/emails/ to notice. CLAUDE.md
// meanwhile claimed every send was on the pipeline, which is precisely the sort of
// statement that stops the next person checking.
//
// Documentation did not catch it. A guard does — the same argument as
// no-res-send-err.test.js and runtime-requires.test.js.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DIRS = ['controllers', 'models', 'routes', 'middleware', 'utils'];

// Strip comments before scanning.
//
// Not optional, and not paranoia: a comment-blind scanner has been written in this repo
// four times now (run-migration.js, tools/dbq.js, runtime-requires.test.js,
// key-contract.js), and it would misfire here immediately — controllers/fixtureController.js
// carries the line "// `ses.sendEmail(undefined)` and threw", which is a note about a bug
// that was fixed, not a send. Strings are skipped too, so a URL's `//` cannot open a
// comment and swallow the rest of a line.
function stripCommentsAndStrings(src, label) {
  let out = '';
  let i = 0;
  const n = src.length;
  // The last significant character emitted, used to tell a regex literal from a division.
  let prev = '';

  const REGEX_CAN_FOLLOW = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '']);
  const KEYWORD_BEFORE_REGEX = /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

  while (i < n) {
    const c = src[i], next = src[i + 1];

    if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }

    // A regex literal. Without this the scanner desynchronises on `.replace(/"/g, ...)` —
    // the quote inside the pattern reads as a string opener and swallows the rest of the
    // file. That is not hypothetical: it is what this scanner did on the first attempt,
    // and it silently reported zero sends in routes/index.js.
    if (c === '/' && (REGEX_CAN_FOLLOW.has(prev) || KEYWORD_BEFORE_REGEX.test(out))) {
      let j = i + 1, inClass = false, closed = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;                 // unterminated: it was division after all
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { i = j + 1; out += '0'; prev = '0'; continue; }
    }

    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const startedAt = i;
      i++;
      while (i < n && src[i] !== quote) { if (src[i] === '\\') i++; i++; }
      // Safety net, and an exact one rather than a guess at a length: a ' or " string
      // literal CANNOT contain a raw newline in JavaScript — only a template literal can.
      // So if one appears to, the scanner has lost sync and is now swallowing code.
      //
      // This matters more than it looks. A desynchronised scanner UNDER-reports: it says
      // "no sends in this file", which is exactly the answer that lets through the thing
      // this test exists to catch. It is also not hypothetical — the first version of this
      // scanner desynchronised on `.replace(/"/g, ...)` in routes/index.js and reported
      // that file clean while it contained the very send that prompted all this.
      //
      // (A length threshold was tried first and was wrong: models/players.js has a
      // perfectly legitimate 1,598-character SQL string on one line.)
      if (quote !== '`' && src.slice(startedAt, i).includes('\n')) {
        const line = src.slice(0, startedAt).split('\n').length;
        throw new Error(
          `scanner lost sync in ${label || 'source'} at line ${line}: a ${quote} run ` +
          `containing a raw newline. It is under-reporting, so trust nothing it says.`);
      }
      i++;
      out += '""';
      prev = '"';
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// Call sites only. A bare `SendEmailCommand` in an import or an object property is a
// reference, not a send — contactusController.js has one of each.
//
// A word boundary, NOT "no dot before": `ses.sendEmail(` is the ordinary form, so
// excluding a preceding dot matches nothing that matters. It also counts the function
// declarations in utils/ses.js, which is harmless — that file is the transport and its
// expected count simply includes them.
const SEND_CALL = /\b(?:sendEmail|sendRawEmail)\s*\(|new\s+Send(?:Raw)?EmailCommand\s*\(/g;

// file -> { sends, why }. `sends` is exact, so a NEW send in an already-listed file
// fails too — an allowlist that only names files would let contactusController grow
// another unstyled email silently.
const ALLOWED = {
  'utils/ses.js': {
    sends: 2,
    why: 'the transport itself — everything else reaches SES through this',
  },
  'utils/mailer.js': {
    sends: 2,
    why: 'the pipeline: renders the template, then picks raw-MIME or simple send',
  },
  'controllers/contactusController.js': {
    sends: 1,
    why: 'the annual club invoice, still on its own hand-written views/emails/clubInvoice.ejs ' +
         '(pre-dates the pipeline, off-brand, tracked as its own piece of work)',
  },
  'controllers/auditController.js': {
    sends: 1,
    why: 'the weekly data-integrity digest renders its own view and is internal to the ' +
         'results secretary, so it is deliberately not a member-facing template',
  },
};

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

describe('outbound email goes through the mailer', () => {
  const found = new Map();
  for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'), rel);
      const count = (code.match(SEND_CALL) || []).length;
      if (count) found.set(rel, count);
    }
  }

  it('no file sends mail directly unless it is listed with a reason', () => {
    const unlisted = [...found.keys()].filter(f => !ALLOWED[f]);
    expect(unlisted).toEqual([]);
  });

  it('the listed files have not grown extra sends', () => {
    const actual = {}, expected = {};
    for (const [file, { sends }] of Object.entries(ALLOWED)) {
      actual[file] = found.get(file) || 0;
      expected[file] = sends;
    }
    // A mismatch either way is worth knowing: more means a new hand-rolled send, fewer
    // means one moved onto the pipeline and this list should shrink with it.
    expect(actual).toEqual(expected);
  });

  it('ignores a send mentioned in a comment', () => {
    // fixtureController.js documents a bug about `ses.sendEmail(undefined)`. If this
    // scanner ever counts it, it has stopped stripping comments.
    const src = fs.readFileSync(path.join(ROOT, 'controllers/fixtureController.js'), 'utf8');
    expect(src).toMatch(/ses\.sendEmail\(undefined\)/);
    expect(found.has('controllers/fixtureController.js')).toBe(false);
  });

  it('the signup notification is on the pipeline', () => {
    const routes = fs.readFileSync(path.join(ROOT, 'routes/index.js'), 'utf8');
    expect(routes).toMatch(/template:\s*'access-request'/);
    expect(fs.existsSync(path.join(ROOT, 'emails/access-request.mjml'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'views/emails/access-request.ejs'))).toBe(true);
  });
});
