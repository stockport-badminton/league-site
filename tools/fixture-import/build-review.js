const fs = require('fs');
const path = require('path');
const GEN = path.join(__dirname, 'generated');
const skeleton = JSON.parse(fs.readFileSync(path.join(GEN, 'skeleton.json'), 'utf8'));
const T = require('./transcription.js');

// index skeleton by "homeId-awayId"
const skelByPair = {};
skeleton.forEach(s => { skelByPair[`${s.homeId}-${s.awayId}`] = s; });

const WINDOW_START = new Date('2026-08-15T00:00:00Z');
const WINDOW_END   = new Date('2027-05-15T00:00:00Z');
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const records = [];
const problems = [];
const usedPairs = new Set();

for (const [div, d] of Object.entries(T)) {
  const ids = d.teamIds, names = d.teamNames;
  for (let r = 0; r < d.grid.length; r++) {
    for (let c = 0; c < d.grid[r].length; c++) {
      const cell = d.grid[r][c];
      if (r === c) { // diagonal
        if (cell !== null) problems.push(`${div}: diagonal ${names[r]} not null (${cell})`);
        continue;
      }
      const homeId = ids[r], awayId = ids[c];
      const pair = `${homeId}-${awayId}`;
      const skel = skelByPair[pair];
      if (!skel) { problems.push(`${div}: NO skeleton fixture for ${names[r]} v ${names[c]} (${pair})`); continue; }
      usedPairs.add(pair);

      let raw = cell == null ? '' : String(cell).trim();
      const lowConf = raw.endsWith('?');
      if (lowConf) raw = raw.slice(0, -1);
      const blank = raw === '';

      const rec = {
        fixtureId: skel.id, div, homeId, awayId,
        home: names[r], away: names[c],
        date: blank ? '' : raw, lowConf, blank, flags: []
      };
      if (blank) rec.flags.push('UNREAD');
      else {
        const dt = new Date(raw + 'T00:00:00Z');
        if (isNaN(dt)) rec.flags.push('BADDATE');
        else {
          if (dt < WINDOW_START || dt > WINDOW_END) rec.flags.push('OUT_OF_SEASON');
          const dow = dt.getUTCDay();
          if (dow === 0 || dow === 6) rec.flags.push('WEEKEND');
          rec.dow = DOW[dow];
        }
      }
      if (lowConf) rec.flags.push('LOWCONF');
      records.push(rec);
    }
  }
}

// coverage: every skeleton pair used exactly once
skeleton.forEach(s => {
  if (!usedPairs.has(`${s.homeId}-${s.awayId}`))
    problems.push(`MISSING transcription for skeleton ${s.div}: ${s.home} v ${s.away} (fixture ${s.id})`);
});

// team double-booked same date (a team home or away in >1 fixture that night)
const teamDate = {};
records.filter(r => r.date).forEach(r => {
  [r.homeId, r.awayId].forEach(tid => {
    const k = `${tid}|${r.date}`;
    (teamDate[k] = teamDate[k] || []).push(r);
  });
});
const dblBooked = [];
Object.entries(teamDate).forEach(([k, rs]) => {
  if (rs.length > 1) {
    const [tid] = k.split('|');
    rs.forEach(r => r.flags.push('DOUBLEBOOK'));
    dblBooked.push({ teamId: +tid, date: k.split('|')[1], fixtures: rs.map(r => `${r.home} v ${r.away} (#${r.fixtureId})`) });
  }
});

// both legs same date (A v B and B v A on same day)
records.filter(r => r.date).forEach(r => {
  const rev = records.find(x => x.homeId === r.awayId && x.awayId === r.homeId && x.date === r.date);
  if (rev && !r.flags.includes('BOTHLEGS')) { r.flags.push('BOTHLEGS'); }
});

fs.writeFileSync(path.join(GEN, 'review-data.json'), JSON.stringify({ divisions: T, records }, null, 1));

// ---- report ----
const byFlag = {};
records.forEach(r => r.flags.forEach(f => byFlag[f] = (byFlag[f]||0)+1));
console.log('Records:', records.length, '(expected 272)');
console.log('Flag counts:', JSON.stringify(byFlag));
console.log('\nStructural problems:', problems.length);
problems.forEach(p => console.log('  ! ' + p));
console.log('\nDouble-booked team/nights:', dblBooked.length);
dblBooked.forEach(d => console.log(`  team ${d.teamId} on ${d.date}: ` + d.fixtures.join('  ||  ')));
console.log('\nFlagged cells needing attention:');
records.filter(r => r.flags.length).forEach(r =>
  console.log(`  [${r.div}] ${r.home} v ${r.away}  ${r.date||'(blank)'} ${r.dow||''}  -> ${r.flags.join(',')}`));
