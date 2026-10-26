#!/usr/bin/env node
// The environment variables the app reads, printed from config/schema.js.
//
//   node tools/env-table.js              markdown table: kind, unset meaning, test treatment
//   node tools/env-table.js --cloud-run  compare with what the Cloud Run service sets
//
// --cloud-run reads variable NAMES only (never values) with gcloud. It reports a required
// variable production does not set — which would stop the next deploy starting — and
// anything production sets that the app no longer reads.
const { execFileSync } = require('child_process');
const schema = require('../config/schema');

function unsetMeaning(entry) {
  if (entry.required === true) return '**required**';
  if (entry.required === 'production') return `**required in production**; dev: \`${entry.default}\``;
  if (entry.unset) return entry.unset;
  if (entry.default !== undefined) return `default \`${entry.default}\``;
  if (entry.kind === 'flag') return 'off';
  return '—';
}

function table() {
  const rows = Object.entries(schema).map(([name, e]) =>
    `| \`${name}\` | ${e.kind}${e.readBy ? ` (${e.readBy})` : ''} | ${unsetMeaning(e)} | ${e.test} | ${e.doc} |`);
  return ['| Variable | Kind | Unset means | Tests | What it is |', '|---|---|---|---|---|', ...rows].join('\n');
}

function cloudRun() {
  const json = execFileSync('gcloud', ['run', 'services', 'describe', 'league-site',
    '--region', 'europe-west2', '--format=json(spec.template.spec.containers[0].env[].name)'], { encoding: 'utf8' });
  const set = new Set((JSON.parse(json).spec.template.spec.containers[0].env || []).map(e => e.name));
  const required = Object.entries(schema).filter(([, e]) => e.required).map(([n]) => n);
  const missing = required.filter(n => !set.has(n));
  const unread = [...set].filter(n => !schema[n]).sort();
  console.log(missing.length ? `Required but NOT set on Cloud Run: ${missing.join(', ')}` : 'Every required variable is set on Cloud Run.');
  console.log(unread.length ? `Set on Cloud Run, read by nothing: ${unread.join(', ')}` : 'Nothing set on Cloud Run is unread.');
  if (missing.length) process.exitCode = 1;
}

if (process.argv.includes('--cloud-run')) cloudRun();
else console.log(table());
