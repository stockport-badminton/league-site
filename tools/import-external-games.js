#!/usr/bin/env node
// Loads other leagues' games for the team-strength ratings (utils/externalLeagues.js).
//
//   node tools/import-external-games.js                     local, this season, dry run
//   node tools/import-external-games.js --history --apply   local, every Manchester season
//   node tools/import-external-games.js --prod --history [--apply]
//
// The weekly POST /admin/team-strength/import keeps the current season up to date; this is
// for loading the history once, and for re-running a season by hand. A dry run fetches and
// parses everything and writes nothing. Re-running is safe: games already held are skipped.
const { loadEnv } = require('./lib/loadEnv');
loadEnv();

// Every season Manchester's search offers (there was no 2020-21).
const HISTORY = ['2016-17', '2017-18', '2018-19', '2019-20', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27'];

async function main() {
  const db = require('../db_connect');
  db.connect();
  const apply = process.argv.includes('--apply');
  const { importExternal } = require('../controllers/teamStrengthController');
  const result = await importExternal({ seasons: process.argv.includes('--history') ? HISTORY : undefined, dryRun: !apply });
  const t = result.tameside;
  process.stdout.write(`Tameside: ${t.skipped || t.error || `${t.games} games, ${t.added} new`}\n`);
  for (const m of result.mcrbl) {
    process.stdout.write(`Manchester ${m.season}: ${m.error || `${m.cards} cards, ${m.games} games (${m.dropped} pairings dropped), ${m.added} new`}\n`);
  }
  if (!apply) process.stdout.write('Dry run: nothing written. Add --apply to write.\n');
  else {
    const held = await require('../models/externalGame').summary();
    process.stdout.write(`Now held: ${held.map(h => `${h.league} ${h.games} to ${h.latest}`).join(', ')}\n`);
  }
}

main().then(() => process.exit(process.exitCode || 0), err => { process.stderr.write(`${err.stack}\n`); process.exit(1); });
