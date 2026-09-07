// An INNER JOIN to something optional loses the whole row. CLAUDE.md gotcha 1c.
//
// What it has cost:
//   Aug 2026  getFixtureEventById inner-joined the home team's captain. Six teams have
//             none flagged, so 48 fixtures rendered as HTTP 200 with a two-byte body —
//             which Googlebot banked as real pages.
//   Sep 2026  getContactDetailsById was all-INNER-JOIN, so a club missing one team
//             captain returned NO ROWS: College Green E vanished from its club page.
//   Sep 2026  getAnnualInvoices inner-joined the club secretary, so a club with nobody
//             flagged was dropped from the invoice run entirely. Latent — all 18 clubs
//             happen to have one — but it was one unflagged secretary away from a club
//             never being invoiced, silently.
//
// WHY THIS GUARD IS NARROW
//
// There are 164 inner joins inside SQL in this codebase and almost all are correct. A
// guard that flagged them would be deleted within a week, and HARD-19 says so: "a guard
// that cries wolf is worse than none, because it teaches people to add exclusions."
//
// So it flags one specific shape: an inner join to `player` whose ON clause tests a ROLE.
// A role is optional by nature — six teams have no captain flagged right now — so joining
// one as an attribute of some other row is the mistake every case above made.
//
// THE ONE PERMITTED FORM, and it is a rule rather than an exemption: a statement that
// hardcodes the role as a literal in its own SELECT list (`'club Sec' AS role`) is asking
// "who holds this role", so the join defines what the row IS rather than decorating it,
// and INNER is correct — a club with no treasurer should contribute no treasurer row.
// That is Player.getEmails, whose five UNION branches each name their own role.
//
// DELIBERATELY NOT COVERED: inner joins to `venue`, `club` and `division` — 27 of them.
// Gotcha 1c notes those are "NOT NULL in practice but nothing enforces it, and a missing
// one should cost a field, not the page", so they are a real class; but almost every one
// is correct, and flagging 27 to find perhaps one is how a guard gets deleted. They need
// judgement per query, which is `tools/key-contract.js`'s style of job, not a unit test's.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

// Optional by nature: nothing in the schema requires any of these to exist.
const ROLE = /teamCaptain|clubSecretary|matchSecrertary|treasurer|otherComms|\bcaptain\b|"clubSec"|"matchSec"/i;

function sources() {
  const out = [];
  for (const d of ['models', 'controllers']) {
    const dir = path.join(root, d);
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) out.push(path.join(dir, f));
  }
  return out;
}

// SQL strings only, with `--` comments removed: a comment is free to describe the mistake.
function statements(src) {
  const found = [];
  for (const s of src.match(/`[^`]*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || []) {
    if (!/\bSELECT\b/i.test(s)) continue;
    found.push(s.split('\n').map(l => l.split('--')[0]).join('\n'));
  }
  return found;
}

function offenders() {
  const bad = [];
  for (const file of sources()) {
    for (const stmt of statements(fs.readFileSync(file, 'utf8'))) {
      // The permitted form: this statement selects a hardcoded role literal.
      const definesRole = /'[^']*'\s+AS\s+"?role"?/i.test(stmt);
      const joins = stmt.matchAll(
        /(?<!LEFT\s)(?<!CROSS\s)\bJOIN\s+player\s+(\w+)?\s*ON\s+([\s\S]*?)(?=\b(?:LEFT|INNER|CROSS|JOIN|WHERE|GROUP|ORDER|UNION)\b|$)/gi);
      for (const m of joins) {
        const on = m[2] || '';
        if (!ROLE.test(on) && !ROLE.test(m[1] || '')) continue;
        if (definesRole) continue;
        bad.push(`${path.relative(root, file)}: JOIN player ON ${on.trim().slice(0, 60)}`);
      }
    }
  }
  return bad;
}

describe('inner joins to an optional role', () => {
  it('is reading the queries at all', () => {
    const n = sources().reduce((t, f) => t + statements(fs.readFileSync(f, 'utf8')).length, 0);
    expect(n).toBeGreaterThan(40);
  });

  it('finds none: an optional officer is joined with LEFT', () => {
    expect(offenders()).toEqual([]);
  });

  // Prove the rule, not just the current state — HARD-19's standard is that reintroducing
  // the gotcha must go red, demonstrated by putting it back.
  it('would catch an officer joined without LEFT', () => {
    const bad = 'const q = `SELECT club.name FROM club JOIN player ON player.club = club.id AND player."clubSecretary" = 1`';
    const stmt = statements(bad)[0];
    const hit = [...stmt.matchAll(/(?<!LEFT\s)\bJOIN\s+player\s+(\w+)?\s*ON\s+([\s\S]*?)$/gi)]
      .some(m => ROLE.test(m[2]));
    expect(hit).toBe(true);
  });

  it('accepts the same join once it is LEFT', () => {
    const ok = 'const q = `SELECT club.name FROM club LEFT JOIN player ON player.club = club.id AND player."clubSecretary" = 1`';
    const stmt = statements(ok)[0];
    const hit = [...stmt.matchAll(/(?<!LEFT\s)\bJOIN\s+player\s+(\w+)?\s*ON\s+([\s\S]*?)$/gi)]
      .some(m => ROLE.test(m[2]));
    expect(hit).toBe(false);
  });
});
