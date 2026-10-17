// The annual invoice run's record of itself (HARD-35, migration 023).
//
// `record` is called by contactusController.runInvoiceSend for every run, refusals
// included. `findings` is what the weekly audit digest reports (tools/audit/checks.js,
// `invoice-run`), and is split from the query as `findingsFor` so the decision can be
// tested without a database.

var db = require('../db_connect.js');

// Mirrors INVOICE_WINDOW_DAYS in contactusController: the run may fire this many days
// either side of 1 September. The check waits for the window to CLOSE before calling a
// missing run missing, so a run that fails on the day and is retried on the 3rd is never
// reported.
const WINDOW_DAYS = 3;

// Seasons whose invoices went out before this table existed, so the absence of a row is
// not evidence of anything. Adding a season here is a decision to stop looking.
//
// 20262027: sent by hand on the evening of 1 Sep 2026, after HARD-23 unblocked the run —
// 18 clubs, all reported success (docs/hardening/done/HARD-23). The table arrived in
// October.
const UNRECORDED_SEASONS = ['20262027'];

exports.WINDOW_DAYS = WINDOW_DAYS;
exports.UNRECORDED_SEASONS = UNRECORDED_SEASONS;

exports.record = async function({ season, caller, forced, status, outcomes }) {
  const [rows] = await (await db.otherConnect()).query(
    `INSERT INTO invoice_run (season, caller, forced, status, outcomes)
     VALUES (?, ?, ?, ?, ?::jsonb) RETURNING id`,
    [season, caller || 'unknown', !!forced, status, JSON.stringify(outcomes || [])]
  );
  return rows[0].id;
};

// 1 September of the season's first year, UK local midnight. Read from the season NAME
// rather than the clock, so a check run in January asks about the right September.
function invoiceDateFor(season) {
  const year = Number(String(season).slice(0, 4));
  return new Date(Date.UTC(year, 8, 1));
}

function day(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
}

// The decision, with no database. `runs` are this season's invoice_run rows, any order.
// Returns digest rows: empty means nothing to say.
function findingsFor({ season, runs, now }) {
  if (!season || UNRECORDED_SEASONS.includes(String(season))) return [];
  const due = invoiceDateFor(season);
  const closes = new Date(due.getTime() + (WINDOW_DAYS + 1) * 86400000);
  const ordered = (runs || []).slice().sort((a, b) => new Date(a.ran_at) - new Date(b.ran_at));

  const latest = new Map();
  for (const run of ordered) {
    for (const o of run.outcomes || []) {
      if (o && o.club) latest.set(o.club, { sent: !!o.sent, detail: o.detail || '', at: new Date(run.ran_at) });
    }
  }

  const out = [];
  // Over EVERY run, not each club's latest outcome: a club that was sent on the 1st and
  // failed a re-run on the 2nd is one club to chase, not a season with no invoices.
  const anySent = ordered.some(run => (run.outcomes || []).some(o => o && o.sent));
  if (!anySent && (now || new Date()) >= closes) {
    const last = ordered[ordered.length - 1];
    out.push({
      season,
      club: '(all clubs)',
      problem: `annual invoices NOT sent — due ${day(due)}`,
      last_attempt: last
        ? `${day(new Date(last.ran_at))}, answered ${last.status}`
        : 'no run recorded at all',
    });
  }
  for (const [club, o] of latest) {
    if (o.sent) continue;
    out.push({ season, club, problem: o.detail || 'not sent', last_attempt: day(o.at) });
  }
  return out;
}
exports.findingsFor = findingsFor;

// The current season comes from the season table, as in every other audit check, not from
// seasonModel.current(): that is a per-process cache filled by init() at app startup, and
// `dbq --check` never calls it, so the same check would ask about a different season
// depending on who ran it. It did — the date-based fallback names 20262027, which is
// exempt, and the check reported nothing locally while the app would have reported a row.
exports.findings = async function(now) {
  const conn = await db.otherConnect();
  const [seasons] = await conn.query(
    `SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1`
  );
  if (!seasons.length) return [];
  const season = String(seasons[0].name);
  const [runs] = await conn.query(
    `SELECT ran_at, status, outcomes FROM invoice_run WHERE season = ? ORDER BY ran_at`,
    [season]
  );
  return findingsFor({ season, runs, now });
};
