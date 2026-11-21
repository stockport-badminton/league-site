#!/usr/bin/env node
// Fills in the weekly snapshots of the points-based rating (migration 038) for past weeks,
// so it can be charted beside the ELO from the start.
//
//   node tools/strength-history.js                          local, dry run: the weeks it would fit
//   node tools/strength-history.js --apply                  local, fit and store them
//   node tools/strength-history.js --prod [--apply]
//   node tools/strength-history.js --from 2024-09-01 --to 2025-05-01 --force --apply
//
// Each week is a fit to every game before that Monday, so it takes a few seconds; a full
// history is a few hundred weeks. Re-running is safe: a week already held, whose fit would see
// the same games, is skipped (--force refits them anyway). The nightly run keeps the newest
// weeks up to date (controllers/teamStrengthController.js refreshWeeks).
const { loadEnv } = require('./lib/loadEnv');
loadEnv();

// A season of our games before the first snapshot, so it does not start from nothing.
const DEFAULT_FROM = '2019-09-01';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const db = require('../db_connect');
  db.connect();
  const model = require('../utils/teamStrength');
  const { loadInput, weeksBetween, snapshotWeeks } = require('../controllers/teamStrengthController');
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const from = model.dayMs(arg('--from') || DEFAULT_FROM);
  const to = arg('--to') ? model.dayMs(arg('--to')) : Date.now();

  const input = await loadInput();
  const mondays = weeksBetween(input, from, to);
  process.stdout.write(`${input.games.length} games; ${mondays.length} weeks with our games from ${model.isoDay(mondays[0] || from)} to ${model.isoDay(mondays[mondays.length - 1] || to)}\n`);

  const started = Date.now();
  let n = 0;
  const weeks = await snapshotWeeks(input, mondays, {
    caller: 'strength-history', force, dryRun: !apply,
    onWeek: w => {
      n++;
      const why = w.was == null ? 'new' : `held with ${w.was} games`;
      process.stdout.write(apply
        ? `${w.asOf}  ${w.games} games, ${w.players} players, ${w.ms} ms  (${why})  [${n}]\n`
        : `${w.asOf}  ${w.games} games  (${why})\n`);
    },
  });
  if (!apply) {
    process.stdout.write(`Dry run: ${weeks.length} weeks to fit, nothing written. Add --apply to write.\n`);
  } else {
    process.stdout.write(`Stored ${weeks.length} weeks in ${Math.round((Date.now() - started) / 1000)}s.\n`);
    const held = await require('../models/teamStrength').weeks();
    process.stdout.write(`Now held: ${held.length} weeks, ${held[0] ? held[0].asOf : '-'} to ${held.length ? held[held.length - 1].asOf : '-'}\n`);
  }
}

main().then(() => process.exit(process.exitCode || 0), err => { process.stderr.write(`${err.stack}\n`); process.exit(1); });
