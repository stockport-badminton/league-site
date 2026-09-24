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
// that every link resolves, and that the hardening README's two tables are both well formed
// and both describe the same set of packages the directory does. Every one of the failures
// above had a mechanical tell alongside the semantic one. On its first run this found that
// HARD-27's brief claimed, in the present tense, that a guard was in force which had been
// deliberately deleted; on the first run after the table checks were added (15 Sep) it found
// that HARD-32 had no status row at all.

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

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

// `scripts/` and `migrations/data/` are gitignored on purpose, and the docs name files in
// them. On a working machine they exist and are checked like anything else; in a clean
// checkout — Cloud Build's — they cannot exist, so absence there says nothing about the
// docs. Until Sep 2026 this test had only ever run on machines that had them.
function isIgnored(ref) {
  return spawnSync('git', ['check-ignore', '-q', ref], { cwd: ROOT }).status === 0;
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
        if (!resolves(ref) && !isIgnored(ref)) broken.push(`${doc} → ${ref}`);
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

  // ── The hardening README's two tables ───────────────────────────────────────
  //
  // The README carries a conflict map (Package / Owns / Wave / Blocked by) and a status
  // table (Package / Status / Commit / Notes). They answer different questions and they
  // have to be checked as two tables, which the first version of this guard did not do:
  // it matched `^\|\s*\[(HARD-\d+)\]` anywhere in the file, so
  //
  //   - a conflict-map row satisfied "has a status row" and vice versa. A HARD-33 row had
  //     been pasted bodily into the status table, giving it two status rows and none in
  //     the map, and HARD-28 had no map row at all. Both passed;
  //   - a row written WITHOUT a link was invisible. `| HARD-11 | not started | | |` sat
  //     there for a day after HARD-11 landed, and it is the first HARD-11 row a reader
  //     scanning top-down meets. Four of the stalest rows were unlinked ones.
  //
  // Reviewed 15 Sep 2026; every case below is one this file had already let through.

  const README = 'docs/hardening/README.md';

  // Markdown cells may contain an escaped `\|`, and several notes do.
  const splitRow = line => line.split(/(?<!\\)\|/).slice(1, -1);

  // A table is its header row plus the unbroken run of `|` lines beneath it. Returning the
  // line numbers as well, because "which row" is most of the value of the failure message.
  function tableUnder(lines, headerStartsWith) {
    const i = lines.findIndex(l => l.startsWith(headerStartsWith));
    expect(i).toBeGreaterThan(-1);
    const rows = [];
    for (let k = i; k < lines.length && lines[k].startsWith('|'); k++) {
      rows.push({ line: k + 1, text: lines[k], cells: splitRow(lines[k]) });
    }
    return { header: rows[0], body: rows.slice(2), all: rows, end: i + rows.length };
  }

  const readmeTables = () => {
    const lines = fs.readFileSync(path.join(ROOT, README), 'utf8').split('\n');
    return {
      lines,
      conflict: tableUnder(lines, '| Package | Owns | Wave'),
      status: tableUnder(lines, '| Package | Status | Commit'),
    };
  };

  const packagesOnDisk = () => {
    const onDisk = new Map();
    for (const dir of ['docs/hardening', 'docs/hardening/done']) {
      for (const e of fs.readdirSync(path.join(ROOT, dir))) {
        const m = e.match(/^(HARD-\d+b?)-/);
        if (m) onDisk.set(m[1], dir.endsWith('done') ? 'done' : 'open');
      }
    }
    return onDisk;
  };

  // A package named in the first cell, linked or not. The unlinked spelling is the one the
  // old guard could not see, and it is the spelling stale rows are written in.
  const named = row => (row.cells[0].match(/HARD-\d+b?/) || [])[0];

  // Landed packages move to done/, so the directory listing IS the backlog. A package with
  // no row means the table is not the state of play it claims to be; a row naming a package
  // that has moved is a dead link. Both have happened.
  it('every hardening package has a row in BOTH README tables, and neither has an orphan', () => {
    const { conflict, status } = readmeTables();
    const onDisk = [...packagesOnDisk().keys()];

    for (const [name, table] of [['conflict map', conflict], ['status table', status]]) {
      const listed = new Set(table.body.map(named).filter(Boolean));
      expect({ [`${name}: on disk, no row`]: onDisk.filter(p => !listed.has(p)).sort() })
        .toEqual({ [`${name}: on disk, no row`]: [] });
      expect({ [`${name}: row, not on disk`]: [...listed].filter(p => !onDisk.includes(p)).sort() })
        .toEqual({ [`${name}: row, not on disk`]: [] });
    }
  });

  // A row with the wrong number of cells silently shifts every column after the mistake:
  // three status rows had an update appended as a fifth cell rather than joined to the
  // note, and two had never closed their last cell at all. Both render as garbage and
  // neither is visible in a diff of a 4,000-character line.
  it('every README table row has the same number of cells as its header', () => {
    const { conflict, status } = readmeTables();
    const bad = [];
    for (const [name, table] of [['conflict map', conflict], ['status table', status]]) {
      const want = table.header.cells.length;
      for (const row of table.all.slice(1)) {
        if (row.cells.length !== want) {
          bad.push(`${name} line ${row.line}: ${row.cells.length} cells, expected ${want} — ${row.text.slice(0, 70)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  // One blank line ends a markdown table. A stray one sat above the HARD-31 row, so the
  // last five entries — including two of the three most recent — stopped being a table at
  // all, while still reading fine in a text editor.
  it('no blank line splits a README table', () => {
    const { lines } = readmeTables();
    const split = [];
    for (let i = 1; i < lines.length - 1; i++) {
      if (!lines[i].trim() && lines[i - 1].startsWith('|') && lines[i + 1].startsWith('|')) {
        split.push(`line ${i + 1}, between two table rows`);
      }
    }
    expect(split).toEqual([]);
  });

  // *Blocked by* names the package that must land first. It is not a status column, and
  // nine rows had `done` in it — which is how it came to disagree with the status table it
  // was duplicating. Progress belongs in one place.
  it('the conflict map does not carry status in its Blocked by column', () => {
    const { conflict } = readmeTables();
    const blockedBy = conflict.header.cells.findIndex(c => /blocked by/i.test(c));
    expect(blockedBy).toBeGreaterThan(-1);
    const carrying = conflict.body
      .filter(r => /\b(done|not started|in progress|landed)\b/i.test(r.cells[blockedBy]))
      .map(r => `line ${r.line}: ${named(r)} — "${r.cells[blockedBy].trim()}"`);
    expect(carrying).toEqual([]);
  });

  // A package may legitimately have several status rows: the table is kept as a chronology,
  // and HARD-14/HARD-20's diagnosis took three entries to reach the truth. What it may not
  // have is a superseded row still claiming to be the current state. A row for a package
  // that has landed must either say so or say it has been superseded — `HARD-11 | not
  // started` survived the move into done/ and was the first thing a fresh session read.
  it('no status row says a landed package is unstarted', () => {
    const { status } = readmeTables();
    const onDisk = packagesOnDisk();
    const statusCol = status.header.cells.findIndex(c => /status/i.test(c));
    const lying = status.body
      .filter(r => onDisk.get(named(r)) === 'done')
      .filter(r => /not started|^\s*$|\bopen\b/i.test(r.cells[statusCol]))
      .filter(r => !/supersed|historic/i.test(r.cells[statusCol]))
      .map(r => `line ${r.line}: ${named(r)} is in done/ but its row reads "${r.cells[statusCol].trim()}"`);
    expect(lying).toEqual([]);
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
