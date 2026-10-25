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

// The same rule, as the typed query layer (REARCH-01) spells it:
//   .innerJoin('player as p', join => join.onRef(...).on('p.clubSecretary', '=', 1))
// Each `.innerJoin('player…')` call is taken whole — balanced brackets — and flagged if
// it tests a role, unless the function it sits in names the role it collects
// (`sql.lit('club officer').as('role')`), the same permitted form as above.
function builderJoins(src) {
  const found = [];
  const re = /\.innerJoin\(\s*'player\b/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0, i = m.index + '.innerJoin'.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    found.push({ call: src.slice(m.index, i + 1), at: m.index });
  }
  return found;
}

// The top-level function a position sits in: from the nearest top-level definition before
// it to the next one after.
function enclosing(src, at) {
  const starts = [...src.matchAll(/^(?:exports\.\w+\s*=|(?:async\s+)?function\s+\w+|const\s+\w+\s*=)/gm)].map(x => x.index);
  const from = Math.max(0, ...starts.filter(x => x <= at));
  const to = Math.min(src.length, ...starts.filter(x => x > at));
  return src.slice(from, to);
}

// A condition the scanner cannot read — a column built at runtime (`p.${flag}`), or a
// condition passed in (`join.on(holds)`) — may be testing a role, and is treated as one.
// getReminderContacts and getEmails are both written that way; without this, removing the
// role literal from either went unnoticed (tried).
const DYNAMIC = /\$\{|join\s*=>\s*join\.on\(\s*[A-Za-z_]\w*\s*\)/;

function builderOffenders(file, src) {
  const bad = [];
  for (const { call, at } of builderJoins(src)) {
    if (!ROLE.test(call) && !DYNAMIC.test(call)) continue;
    if (/sql\.lit\([^)]*\)\s*\.as\(\s*'role'\s*\)/.test(enclosing(src, at))) continue;
    bad.push(`${path.relative(root, file)}: ${call.replace(/\s+/g, ' ').slice(0, 90)}`);
  }
  return bad;
}

function offenders() {
  const bad = [];
  for (const file of sources()) bad.push(...builderOffenders(file, fs.readFileSync(file, 'utf8')));
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
  // Both spellings are counted: as REARCH-01 converts the models, string statements give
  // way to builder calls, and a guard that only counted the first would read fewer and
  // fewer queries without saying so.
  it('is reading the queries at all', () => {
    const n = sources().reduce((t, f) => {
      const src = fs.readFileSync(f, 'utf8');
      return t + statements(src).length + (src.match(/\.selectFrom\(/g) || []).length;
    }, 0);
    expect(n).toBeGreaterThan(40);
    const builderJoinCount = sources().reduce((t, f) => t + builderJoins(fs.readFileSync(f, 'utf8')).length, 0);
    expect(builderJoinCount).toBeGreaterThan(5);
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

  it('would catch an officer joined without LEFT in a typed query, and accepts the permitted form', () => {
    const bad = `exports.f = async function() {
  return kysely.selectFrom('club')
    .innerJoin('player as p', join => join.onRef('p.club', '=', 'club.id').on('p.clubSecretary', '=', 1))
    .select(['club.name']).execute()
}`;
    expect(builderOffenders('models/x.js', bad)).toHaveLength(1);
    expect(builderOffenders('models/x.js', bad.replace('innerJoin', 'leftJoin'))).toEqual([]);
    const definesRole = bad.replace("select(['club.name'])", "select([sql.lit('club Sec').as('role')])");
    expect(builderOffenders('models/x.js', definesRole)).toEqual([]);
    // A join that does not test a role is none of this guard's business.
    expect(builderOffenders('models/x.js', bad.replace(".on('p.clubSecretary', '=', 1)", ''))).toEqual([]);
    // One it cannot read is treated as testing a role.
    expect(builderOffenders('models/x.js', bad.replace("'p.clubSecretary'", '`p.${flag}`'))).toHaveLength(1);
    expect(builderOffenders('models/x.js', bad.replace(/join => join\.onRef[^)]*\)\.on\([^)]*\)/, 'join => join.on(holds)'))).toHaveLength(1);
  });
});
