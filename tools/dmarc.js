#!/usr/bin/env node
// What the DMARC aggregate reports say about mail sent as our domain.
//
//   node tools/dmarc.js                 the last 30 days
//   node tools/dmarc.js --days 90       a wider window
//   node tools/dmarc.js --json          machine-readable
//   node tools/dmarc.js --raw           list the reports rather than the rollup
//
// Why this exists: the reports arrive as gzipped XML attachments on ordinary mail, so
// "am I authenticated everywhere" is otherwise a question you answer by opening
// attachments one at a time and reading XML. The parsing lives in
// utils/dmarcReports.js so this and the weekly audit check cannot drift.
//
// Read-only: it lists and gets S3 objects and nothing else.
//
// **DMARC is on p=none**, which enforces nothing — it is the monitoring state, and the
// point of monitoring is to leave it. The row that matters is any source with a non-zero
// FAIL: either someone spoofing us, or a real sender that moving to p=reject would start
// binning. A clean run is the evidence for that move.

// Production by default; see tools/lib/loadEnv.js for why the order matters.
require('./lib/loadEnv').loadEnv();

const dmarc = require('../utils/dmarcReports');

function renderTable(rows) {
  if (!rows.length) return '(none)';
  const cols = Object.keys(rows[0]);
  const width = c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length));
  const widths = Object.fromEntries(cols.map(c => [c, width(c)]));
  const line = r => cols.map(c => String(r[c] ?? '').padEnd(widths[c])).join('  ');
  return [
    cols.map(c => c.padEnd(widths[c])).join('  '),
    cols.map(c => '-'.repeat(widths[c])).join('  '),
    ...rows.map(line),
  ].join('\n');
}

const when = ts => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '?');

(async () => {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const raw = argv.includes('--raw');
  const daysAt = argv.indexOf('--days');
  const days = daysAt >= 0 ? Number(argv[daysAt + 1]) || 30 : 30;

  const reports = await dmarc.fetchReports({ days });
  const summary = dmarc.summarise(reports);

  if (json) {
    console.log(JSON.stringify({ days, ...summary }, null, 2));
    return;
  }

  if (raw) {
    console.log(renderTable(reports.map(r => ({
      received: r.receivedAt ? r.receivedAt.toISOString().slice(0, 10) : '?',
      org: r.org,
      covering: when(r.begin) + ' -> ' + when(r.end),
      policy: 'p=' + r.policy.p + (r.policy.pct ? ' pct=' + r.policy.pct : ''),
      records: r.records.length,
    }))));
    return;
  }

  console.log(`DMARC aggregate reports, last ${days} days`);
  console.log(`  reports   : ${summary.reports}${summary.reporters ? '  (' + summary.reporters + ')' : ''}`);
  console.log(`  covering  : ${when(summary.begin)} -> ${when(summary.end)}`);
  console.log(`  messages  : ${summary.pass} passed DMARC, ${summary.fail} failed\n`);

  if (!summary.reports) {
    console.log('No reports in the window. That is not the same as "no problems" — check that');
    console.log('_dmarc still carries rua=, and that inbound mail is still landing in');
    console.log(`s3://${dmarc.BUCKET}/${dmarc.PREFIX} (an SES receipt rule, not code).`);
    return;
  }

  console.log(renderTable(summary.sources));

  if (summary.unauthenticated.length) {
    console.log('\n!! These sent as our domain and authenticated as nobody.');
    console.log('   Either spoofing, or a real sender that p=reject would bin. Identify each');
    console.log('   before tightening the policy.');
  } else {
    console.log('\nEvery reported message authenticated. That is the evidence for moving off');
    console.log('p=none — but reports only cover receivers that report, and only the volume');
    console.log('actually sent, so let a bulk send fall inside the window before you rely on it.');
  }
})().catch(err => { console.error(err.message); process.exit(1); });
