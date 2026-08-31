// Triage for the weekly anomaly email.
//
// `tools/audit/checks.js` answers eleven questions about the data. This module decides
// what a person needs to be told about the answers, which is a different job and the one
// that decides whether the email gets read.
//
// The problem it exists to solve
// -----------------------------------------------------------------------------
// On the day this was written, three of the eleven checks reported findings, and all
// three were already owned by another hardening package: 2,132 orphaned team references
// (HARD-11, awaiting a decision) and one withdrawn team showing up twice, in short-squads
// and ghost-teams (HARD-10). None of them will be resolved for weeks.
//
// A digest that lists those in full every Monday is worse than no digest. By week three
// its reader knows the email always looks like that, stops opening it, and the first
// genuinely new finding — a scorecard submission that committed halfway, which is what
// this whole package is for — arrives in an email nobody reads any more. The failure
// mode is not a missing email, it is a trusted email that turns into wallpaper.
//
// checks.js already has an answer for rows that are *accepted*: exclude them by id, with
// the reason beside them (ACCEPTED_ORPHAN_RESULTS, ACCEPTED_BAD_TOTALS). That is the
// right mechanism for "we have decided to stop looking at this", and deliberately not
// what these rows are. They are not accepted — somebody is going to fix them — so
// silencing them in the check would also hide them from `--check all`, which is the tool
// that says whether HARD-10 and HARD-11 worked.
//
// So the suppression lives here, at the *reporting* layer, and it suppresses the detail
// rather than the finding:
//
//   * a check with no baseline, holding rows          -> "new", listed in full, loud
//   * a baselined check holding exactly what we know  -> one line, no rows, quiet
//   * a baselined check holding more than we know     -> "grown", listed, loud
//   * a baselined check holding less than we know     -> one line, "update the baseline"
//   * a check that could not run at all               -> loud, and never fatal
//
// Growth is always loud. That is the property that matters: a baseline can make the
// email quieter about a known problem, but it can never make it quiet about a new one.
// And shrinkage produces a nudge rather than silence, so a baseline that has gone stale
// says so instead of quietly widening.
//
// Two matching strategies, and the choice is about reviewability
// -----------------------------------------------------------------------------
// `match` is a predicate naming the known rows. It is exact — an unknown row escalates
// even if the total is unchanged — so it is what you want wherever the known set is
// small enough to describe.
//
// `count` is a number. It is used for orphan-team-refs only, where the known set is
// 2,132 rows and no predicate could be written that a human would check. Its weakness is
// real and worth stating: if one row is fixed and a different one appears in the same
// week, the count is unchanged and the email says nothing. That is an acceptable trade
// for the check whose findings are all ~6 years old and none of which is new; it would
// not be acceptable for orphan-results, which has no baseline for exactly that reason.
//
// A baseline is a decision to say less about something, so every entry carries the
// package that owns it and a reason somebody can disagree with later. There is a test
// asserting that.

const { absoluteUrl, eventPath } = require('./canonical');

// Per-section listing cap. Without it a check that grows by one row mails all 2,133 of
// them, and SES has a 10MB message limit that a few thousand table rows will find.
const MAX_ROWS = 20;

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const TRACKED = {
  'orphan-team-refs': {
    owner: 'HARD-11',
    count: 2132,
    note: 'Fixtures whose team id no longer exists. There is no foreign key, so teams '
        + 'deleted over the years left their fixtures pointing at nothing. Counted '
        + 'rather than listed by id — HARD-11 has to decide between tombstoning the '
        + 'teams and rewriting the references, and until then the number is the finding.',
  },

  // Both of these are the same team, seen through two different checks. Matched by name
  // rather than by count so that a *second* short-handed team is a finding this week
  // rather than next time somebody happens to look — and if the name is spelled
  // differently in the database than it is here, the predicate misses and the row shows
  // up as new. That is the safe direction to be wrong in.
  'short-squads': {
    owner: 'HARD-10',
    match: row => teamName(row) === 'parrswood c',
    note: 'Parrswood C was withdrawn on 31 August 2026 but still holds a division place, '
        + 'so it reads as a team that cannot field a side. Withdrawing a team properly '
        + 'is HARD-10; any other team appearing here is a real finding.',
  },
  'ghost-teams': {
    owner: 'HARD-10',
    match: row => teamName(row) === 'parrswood c',
    note: 'The same withdrawn Parrswood C — in a division, with no fixtures this season, '
        + 'so it shows as an empty row in the league table. HARD-10.',
  },
};

function teamName(row) {
  return String(row.team || row.name || '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
// Absolute, and built from utils/canonical rather than the request: this is email, there
// is no request when a scheduler calls it, and `req.get('host')` on Cloud Run is the run
// app's hostname anyway (CLAUDE.md gotcha 1b).

const FIXTURE_CHECKS = new Set([
  'orphan-results', 'unplayed-fixtures', 'bad-totals', 'orphan-team-refs',
]);

// Checks whose rows name a player or a team but not a page — the roster editor is where
// all of them get fixed, and it is one click from there to the right club.
const ROSTER_CHECKS = new Set([
  'duplicate-ranks', 'unranked-players', 'short-squads', 'missing-contact',
]);

function linkFor(name, row) {
  if (FIXTURE_CHECKS.has(name) && row && row.id) {
    const date = row.played || row.due;
    if (!date) return null;
    return absoluteUrl(eventPath({
      id: row.id, date, homeTeam: row.home, awayTeam: row.away,
    }));
  }
  if (name === 'ghost-teams' && row && row.id) {
    return absoluteUrl('/admin/teams/' + row.id);
  }
  if (ROSTER_CHECKS.has(name)) return absoluteUrl('/manage-players');
  // Deliberately no link for orphan-drafts: /populated-scorecard-beta/:id now needs the
  // draft's own confirmToken (HARD-03), so a link built from the id alone would 403.
  return null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classify(result) {
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const tracked = TRACKED[result.name];

  const section = {
    name: result.name,
    description: result.description,
    severity: result.severity || 'medium',
    error: result.error || null,
    total: rows.length,
    tracked: tracked || null,
    trackedRows: 0,
    delta: 0,
    shown: [],
    hidden: 0,
    columns: [],
  };

  if (result.error) {
    section.status = 'error';
    return section;
  }

  let interesting = rows;

  if (tracked && tracked.match) {
    // Exact: the rows the baseline names are set aside, whatever the total.
    interesting = [];
    for (const row of rows) {
      if (safeMatch(tracked.match, row)) section.trackedRows++;
      else interesting.push(row);
    }
    if (interesting.length) section.status = 'new';
    else if (section.trackedRows) section.status = 'tracked';
    // A baseline whose findings have all gone is the one outcome that has to announce
    // itself, or the entry sits in this file forever quietly suppressing detail for a
    // check that has nothing to suppress. 'resolved' is not a finding — it just asks
    // for the entry to be deleted, once.
    else section.status = 'resolved';
  } else if (tracked && typeof tracked.count === 'number') {
    section.delta = rows.length - tracked.count;
    section.trackedRows = Math.min(rows.length, tracked.count);
    if (rows.length === 0) section.status = 'resolved';
    else if (section.delta > 0) section.status = 'grown';
    else if (section.delta < 0) section.status = 'shrunk';
    else section.status = 'tracked';
    // On growth the whole set is listed rather than an attempt to guess which rows are
    // the new ones — a count baseline cannot know, and pretending otherwise would point
    // the reader at arbitrary rows.
    if (section.status !== 'grown') interesting = [];
  } else {
    section.status = rows.length ? 'new' : 'clean';
  }

  if (interesting.length) {
    section.shown = interesting.slice(0, MAX_ROWS).map(row => ({ row, link: linkFor(result.name, row) }));
    section.hidden = interesting.length - section.shown.length;
    section.columns = Object.keys(interesting[0]);
  }

  return section;
}

// A predicate is written by hand against a row shape that comes out of SQL. If it throws
// — a renamed column, a null where a string was expected — the row must not vanish, so
// treat the failure as "not a known row" and let it escalate.
function safeMatch(fn, row) {
  try {
    return !!fn(row);
  } catch (err) {
    return false;
  }
}

const ATTENTION = new Set(['new', 'grown', 'error']);
const NOTED = new Set(['tracked', 'shrunk', 'resolved']);

function buildDigest(results, opts = {}) {
  const sections = (results || []).map(classify);
  const bySeverity = (a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
    a.name.localeCompare(b.name);

  const attention = sections.filter(s => ATTENTION.has(s.status)).sort(bySeverity);
  const noted = sections.filter(s => NOTED.has(s.status)).sort(bySeverity);
  const clean = sections.filter(s => s.status === 'clean').sort(bySeverity);
  const failed = attention.filter(s => s.status === 'error');
  const findings = attention.filter(s => s.status !== 'error');
  // A resolved baseline is still shown, but it is not a known issue — counting it as one
  // in the subject line would report a problem that has just stopped existing.
  const resolved = noted.filter(s => s.status === 'resolved');
  const known = noted.filter(s => s.status !== 'resolved');

  return {
    runAt: opts.runAt || new Date(),
    sections, attention, noted, known, resolved, clean, failed, findings,
    allClear: attention.length === 0,
    subject: subjectFor({ findings, failed, known }),
  };
}

// The subject line is the only part of this email that a busy person reliably reads, so
// it carries the whole verdict: a week worth opening and a week worth ignoring must be
// distinguishable without opening either. "all clear" is still sent — silence is
// indistinguishable from the job being broken.
function subjectFor({ findings, failed, known }) {
  const parts = [];
  if (findings.length) parts.push(plural(findings.length, 'new finding', 'new findings'));
  if (failed.length) parts.push(plural(failed.length, 'check failing', 'checks failing'));
  if (parts.length) return '[SBL audit] ' + parts.join(', ');
  if (known.length) {
    return '[SBL audit] all clear — ' + plural(known.length, 'known issue', 'known issues') + ' tracked';
  }
  return '[SBL audit] all clear';
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

module.exports = {
  buildDigest, linkFor, classify,
  TRACKED, MAX_ROWS, SEVERITY_ORDER,
};
