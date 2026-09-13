// The documentation's pointers must resolve.
//
// This repo has a recurring failure, and it is not wrong documentation — it is documentation
// whose *routing* has gone stale while its content stayed fine. Four instances in two days:
//
//   - CLAUDE.md and the hardening README both said "`dev.env` carries the same connection
//     string as `.env`". True when written, false from the moment HARD-13 landed, and
//     nobody noticed for days.
//   - The README's numbered priority list ranked four packages, all long done, and read as
//     a queue.
//   - The hardening skill's own description said "HARD-01 … HARD-19", so naming HARD-24 or
//     HARD-35 might never have invoked it.
//   - The emails skill covers the annual invoice email — `clubInvoice.ejs` is in its table
//     — but its trigger named only `distribution_list`, so it stayed silent while HARD-23
//     spent a day editing the invoice send.
//
// A warning that has quietly inverted is worse than no warning, because it is what a
// careful person checks instead of looking. The answer this codebase already reached for
// the same problem in code is to make the claim executable — see
// mail-sends-use-mailer.test.js, whose header puts it plainly: "Documentation did not catch
// it. A guard does." This is that, for the documentation's own references.
//
// **What this can and cannot do.** It cannot tell that a sentence has become untrue; no
// test can. It checks the mechanical half — that every file a document names still exists,
// that every link resolves, and that the backlog and its status table still describe the
// same set of packages. Every one of the failures above had a mechanical tell alongside the
// semantic one. On its first run this found that HARD-27's brief claimed, in the present
// tense, that a guard was in force which had been deliberately deleted.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

// Files that are named deliberately and are *supposed* to be absent — a historical
// narrative about something that was removed is legitimate prose, not a stale pointer.
// Same idiom as ALLOWED in mail-sends-use-mailer.test.js: an exception must carry a reason.
const KNOWN_ABSENT = {
  'no-sql-logging.test.js':
    'deleted on purpose. It held the weaker rule that was only possible while DB_PI_KEY ' +
    'was still being pasted into SQL, plus a second assertion whose whole job was to ' +
    'confirm the bug still existed — a test that fails when you fix something. Replaced ' +
    'by no-secrets-in-sql.test.js. HARD-27 and the README describe it in the past tense.',
};

function docFiles() {
  const out = [];
  const add = f => { if (fs.existsSync(path.join(ROOT, f))) out.push(f); };
  add('CLAUDE.md');
  for (const dir of ['docs/hardening', 'docs/hardening/done']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const e of fs.readdirSync(abs)) if (e.endsWith('.md')) add(path.join(dir, e));
  }
  const skills = path.join(ROOT, '.claude/skills');
  if (fs.existsSync(skills)) {
    for (const e of fs.readdirSync(skills)) add(path.join('.claude/skills', e, 'SKILL.md'));
  }
  return out;
}

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const byBasename = new Map();
for (const f of tracked) {
  const b = path.basename(f);
  if (!byBasename.has(b)) byBasename.set(b, []);
  byBasename.get(b).push(f);
}

const LOOKS_LIKE_FILE = /\.(js|ejs|sql|json|sh|ya?ml|css|html|md)$/;

function resolves(ref) {
  if (fs.existsSync(path.join(ROOT, ref))) return true;
  // Docs routinely name a file by its basename alone — `setup.js`, `rosterController.js`.
  // That is normal prose and should keep working, so a unique-or-not basename match counts.
  return (byBasename.get(path.basename(ref)) || []).length > 0;
}

// Prose mentions plenty of backticked things that are not repo paths: URL routes
// (`/sw.js`, `/scripts/ejs/ejs.js` in a CSP allowlist), bare extensions (`.ejs`), globs
// (`views/**/*.ejs`) and code fragments. Only check what is unambiguously a path.
function candidatePaths(text) {
  const withoutFences = text.replace(/```[\s\S]*?```/g, '');
  const found = new Set();
  for (const m of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    const v = m[1].trim();
    if (!LOOKS_LIKE_FILE.test(v)) continue;
    if (v.startsWith('/')) continue;          // a URL path, not a repo path
    if (v.startsWith('.') && !v.includes('/')) continue;  // a bare extension
    if (/[*()\s,]/.test(v)) continue;         // globs, calls, prose
    found.add(v);
  }
  return [...found];
}

describe('the documentation points at things that exist', () => {
  it('every backticked file path in the docs resolves', () => {
    const broken = [];
    for (const doc of docFiles()) {
      const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
      for (const ref of candidatePaths(text)) {
        if (KNOWN_ABSENT[path.basename(ref)]) continue;
        if (!resolves(ref)) broken.push(`${doc} → ${ref}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every markdown link to a repo file resolves', () => {
    const broken = [];
    for (const doc of docFiles()) {
      const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
      for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = m[1].split('#')[0].trim();
        if (!target || /^(https?:|mailto:)/.test(target)) continue;
        if (KNOWN_ABSENT[path.basename(target)]) continue;
        const abs = path.join(ROOT, path.dirname(doc), target);
        if (!fs.existsSync(abs)) broken.push(`${doc} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  // Landed packages move to done/, so the directory listing IS the backlog. If a package
  // exists with no row, the status table is not the state of play it claims to be; if a row
  // links to a package that has moved, the link is dead. Both have happened.
  it('every hardening package has a status-table row, and no row is orphaned', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'docs/hardening/README.md'), 'utf8');

    const onDisk = new Set();
    for (const dir of ['docs/hardening', 'docs/hardening/done']) {
      for (const e of fs.readdirSync(path.join(ROOT, dir))) {
        const m = e.match(/^(HARD-\d+)-/);
        if (m) onDisk.add(m[1]);
      }
    }

    const inTable = new Set();
    for (const m of readme.matchAll(/^\|\s*\[(HARD-\d+)\]/gm)) inTable.add(m[1]);

    expect([...onDisk].filter(p => !inTable.has(p)).sort()).toEqual([]);
    expect([...inTable].filter(p => !onDisk.has(p)).sort()).toEqual([]);
  });

  it('the KNOWN_ABSENT list holds only things that really are absent', () => {
    // An entry that starts resolving again is an exception nobody needs, and a stale
    // exception is the same failure this file exists to catch.
    //
    // Note this fires only once the resurrected file is git-tracked, because the basename
    // index is built from `git ls-files`. That is the right moment: an untracked file in
    // someone's working copy is not the guard coming back.
    const resurrected = Object.keys(KNOWN_ABSENT).filter(b => (byBasename.get(b) || []).length > 0);
    expect(resurrected).toEqual([]);
  });
});
