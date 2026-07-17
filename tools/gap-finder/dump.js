/*
 * Build the unified cross-league dataset for the calendar gap-finder.
 *   node tools/gap-finder/dump.js
 * Reads BOTH Supabase projects (Stockport = DATABASE_URL, Tameside =
 * TAMESIDE_DATABASE_URL) read-only, reconciles clubs/venues by name, infers each
 * team's usual home night from its home-fixture weekdays, and writes
 * generated/data.json for gen-artifact.js. Prints a summary + existing collisions.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const fs = require('fs');
const { Pool } = require('pg');

const GEN = path.join(__dirname, 'generated');
fs.mkdirSync(GEN, { recursive: true });

const LEAGUES = {
  stockport: { url: process.env.DATABASE_URL, tag: 'S', label: 'Stockport' },
  tameside:  { url: process.env.TAMESIDE_DATABASE_URL, tag: 'T', label: 'Tameside' },
};
for (const [k, v] of Object.entries(LEAGUES)) if (!v.url) { console.error(`Missing connection string for ${k} (${k === 'tameside' ? 'TAMESIDE_DATABASE_URL' : 'DATABASE_URL'})`); process.exit(1); }

const WIN_S = '2026-08-15', WIN_E = '2027-05-31';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dowOf = d => DOW[new Date(d + 'T00:00:00Z').getUTCDay()];

(async () => {
  const teams = [], fixtures = [], clubsByKey = {}, venuesByKey = {};

  for (const [league, cfg] of Object.entries(LEAGUES)) {
    const pool = new Pool({ connectionString: cfg.url });
    const q = (s, a) => pool.query(s, a).then(r => r.rows);
    const clById = Object.fromEntries((await q('SELECT id,name FROM club')).map(c => [c.id, c.name]));
    const veById = Object.fromEntries((await q('SELECT id,name FROM venue')).map(v => [v.id, v.name]));
    const dvById = Object.fromEntries((await q('SELECT id,name FROM division')).map(d => [d.id, d.name]));

    for (const t of await q('SELECT id,name,club,venue,division,"matchDay" FROM team')) {
      const clubName = clById[t.club] || 'No Club', venName = veById[t.venue] || '';
      const ck = norm(clubName), vk = norm(venName);
      teams.push({ key: `${cfg.tag}:${t.id}`, league, leagueLabel: cfg.label, id: t.id, name: t.name,
        club: clubName, clubKey: ck, venue: venName, venueKey: vk,
        division: dvById[t.division] || null, matchDayText: t.matchDay || null, homeNight: null });
      const c = (clubsByKey[ck] = clubsByKey[ck] || { key: ck, name: clubName, leagues: new Set(), teamKeys: [] });
      c.leagues.add(league); c.teamKeys.push(`${cfg.tag}:${t.id}`);
      if (vk) (venuesByKey[vk] = venuesByKey[vk] || { key: vk, name: venName, leagues: new Set() }).leagues.add(league);
    }
    for (const f of await q(`SELECT id,"homeTeam","awayTeam",to_char(date,'YYYY-MM-DD') d,status FROM fixture WHERE date>=$1 AND date<=$2`, [WIN_S, WIN_E]))
      fixtures.push({ id: f.id, league, date: f.d, dow: dowOf(f.d),
        homeKey: `${cfg.tag}:${f.homeTeam}`, awayKey: `${cfg.tag}:${f.awayTeam}`, status: f.status });
    await pool.end();
  }

  const teamByKey = Object.fromEntries(teams.map(t => [t.key, t]));
  fixtures.forEach(f => { f.homeClubKey = teamByKey[f.homeKey]?.clubKey; f.awayClubKey = teamByKey[f.awayKey]?.clubKey; });

  // infer usual home night = most common weekday among a team's HOME fixtures
  const homeDow = {};
  fixtures.forEach(f => { (homeDow[f.homeKey] = homeDow[f.homeKey] || {})[f.dow] = (homeDow[f.homeKey]?.[f.dow] || 0) + 1; });
  teams.forEach(t => { const m = homeDow[t.key]; if (m) t.homeNight = Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]; });

  const clubs = Object.values(clubsByKey)
    .map(c => ({ key: c.key, name: c.name, leagues: [...c.leagues], teamKeys: c.teamKeys }))
    .sort((a, b) => a.name.localeCompare(b.name));

  fs.writeFileSync(path.join(GEN, 'data.json'),
    JSON.stringify({ generatedFor: '2026/27', window: { start: WIN_S, end: WIN_E }, clubs, teams, fixtures }, null, 1));

  // ---- summary ----
  console.log(`Teams ${teams.length} | Fixtures ${fixtures.length} | Clubs ${clubs.length} | Venues ${Object.keys(venuesByKey).length}`);
  const both = clubs.filter(c => c.leagues.length > 1);
  console.log(`Clubs in both leagues: ${both.length} — ${both.map(c => c.name).join(', ')}`);
  const noNight = teams.filter(t => !t.homeNight && !t.name.toLowerCase().includes('no team'));
  if (noNight.length) console.log(`Teams with no inferred home night (no home fixtures?): ${noNight.map(t => t.key + ' ' + t.name).join(', ')}`);
  console.log(`Wrote ${path.join(GEN, 'data.json')}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
