const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const fs = require('fs');
const db = require('../../db_connect.js');
const GEN = path.join(__dirname, 'generated');
fs.mkdirSync(GEN, { recursive: true });

(async () => {
  db.connect();
  const conn = await db.otherConnect();
  const [rows] = await conn.query(`
    SELECT f.id, f."homeTeam", f."awayTeam", f.date, f.status,
           ht.name AS home, at.name AS away,
           d.id AS "divId", d.name AS "divName", d.rank AS "divRank"
    FROM fixture f
    JOIN team ht ON f."homeTeam" = ht.id
    JOIN team at ON f."awayTeam" = at.id
    JOIN division d ON ht.division = d.id
    WHERE f.date >= '2026-07-01' AND f.date < '2027-06-01'
    ORDER BY d.rank, ht.name, at.name`);

  // distinct dates present (are they all the sentinel?)
  const dates = {};
  rows.forEach(r => { const k = new Date(r.date).toISOString().slice(0,10); dates[k] = (dates[k]||0)+1; });
  console.log('Distinct dates among skeleton rows:', JSON.stringify(dates));
  console.log('Total rows:', rows.length);

  const out = rows.map(r => ({
    id: r.id, homeId: r.homeTeam, awayId: r.awayTeam,
    home: r.home, away: r.away,
    divId: r.divId, div: r.divName, divRank: r.divRank,
    date: new Date(r.date).toISOString().slice(0,10), status: r.status
  }));
  fs.writeFileSync(path.join(GEN, 'skeleton.json'), JSON.stringify(out, null, 1));
  console.log('Wrote ' + path.join(GEN, 'skeleton.json'));
  // per-division counts
  const byDiv = {};
  out.forEach(r => { byDiv[r.div] = (byDiv[r.div]||0)+1; });
  console.log('Per division:', JSON.stringify(byDiv));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
