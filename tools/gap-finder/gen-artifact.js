/*
 * Generate the interactive cross-league gap-finder artifact from generated/data.json.
 *   node tools/gap-finder/gen-artifact.js [outfile.html]
 */
const path = require('path');
const fs = require('fs');
const GEN = path.join(__dirname, 'generated');
const DATA = JSON.parse(fs.readFileSync(path.join(GEN, 'data.json'), 'utf8'));
const OUT = process.argv[2] || path.join(GEN, 'gap-finder.html');

// slim payload
const payload = {
  window: DATA.window,
  clubs: DATA.clubs,
  teams: DATA.teams.map(t => ({ key: t.key, league: t.league, leagueLabel: t.leagueLabel, name: t.name,
    club: t.club, clubKey: t.clubKey, venue: t.venue, division: t.division, homeNight: t.homeNight })),
  fixtures: DATA.fixtures.map(f => ({ uid: f.league + '#' + f.id, id: f.id, league: f.league, date: f.date, dow: f.dow,
    homeKey: f.homeKey, awayKey: f.awayKey, homeClubKey: f.homeClubKey, awayClubKey: f.awayClubKey, status: f.status })),
};

const html = `<title>Badminton Gap Finder — cross-league rearrangements</title>
<style>
:root{
  --bg:#f4f5f7; --card:#ffffff; --ink:#161b22; --soft:#5b6470; --line:#e0e3e8;
  --accent:#2b5c8a; --accent-ink:#fff;
  --stockport:#2b5c8a; --stockport-bg:#e7eef5; --tameside:#7a4ea8; --tameside-bg:#efe8f6;
  --free:#227a4b; --free-bg:#e6f3ec; --warn:#9a6b12; --warn-bg:#faf1d8; --busy:#a5342b; --busy-bg:#f7e3e0;
  --mono:'SF Mono',ui-monospace,Menlo,Consolas,monospace; --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0f1319; --card:#171d25; --ink:#e7ebf0; --soft:#9aa4b1; --line:#28303a;
  --accent:#6ea8dc; --accent-ink:#0f1319;
  --stockport:#6ea8dc; --stockport-bg:#16283a; --tameside:#b78be0; --tameside-bg:#271a38;
  --free:#5ec489; --free-bg:#132a1e; --warn:#e0b25a; --warn-bg:#2c2513; --busy:#e88b80; --busy-bg:#331b19;
}}
:root[data-theme="light"]{ --bg:#f4f5f7; --card:#fff; --ink:#161b22; --soft:#5b6470; --line:#e0e3e8; --accent:#2b5c8a; --accent-ink:#fff; --stockport:#2b5c8a; --stockport-bg:#e7eef5; --tameside:#7a4ea8; --tameside-bg:#efe8f6; --free:#227a4b; --free-bg:#e6f3ec; --warn:#9a6b12; --warn-bg:#faf1d8; --busy:#a5342b; --busy-bg:#f7e3e0; }
:root[data-theme="dark"]{ --bg:#0f1319; --card:#171d25; --ink:#e7ebf0; --soft:#9aa4b1; --line:#28303a; --accent:#6ea8dc; --accent-ink:#0f1319; --stockport:#6ea8dc; --stockport-bg:#16283a; --tameside:#b78be0; --tameside-bg:#271a38; --free:#5ec489; --free-bg:#132a1e; --warn:#e0b25a; --warn-bg:#2c2513; --busy:#e88b80; --busy-bg:#331b19; }
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:26px 20px 90px}
header.top{border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:20px}
.eyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 5px}
h1{margin:0;font-size:25px;font-weight:660;letter-spacing:-.01em}
.sub{color:var(--soft);margin:6px 0 0;max-width:70ch}
.tabs{display:inline-flex;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px;margin-bottom:18px}
.tab{border:0;background:transparent;color:var(--soft);font:inherit;font-weight:560;padding:8px 16px;border-radius:7px;cursor:pointer}
.tab[aria-selected="true"]{background:var(--accent);color:var(--accent-ink)}
.panel{display:none} .panel.on{display:block}
.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:18px}
.field{display:flex;flex-direction:column;gap:5px}
.field label{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);font-weight:600}
select{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);min-width:200px}
select:focus{outline:2px solid var(--accent);outline-offset:1px}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-family:var(--mono);padding:1px 7px;border-radius:20px;border:1px solid transparent;white-space:nowrap}
.pill.stockport{background:var(--stockport-bg);color:var(--stockport)} .pill.tameside{background:var(--tameside-bg);color:var(--tameside)}
.pill.free{background:var(--free-bg);color:var(--free)} .pill.warn{background:var(--warn-bg);color:var(--warn)} .pill.busy{background:var(--busy-bg);color:var(--busy)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
/* move finder */
.selsummary{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin-bottom:16px}
.selsummary .match{font-size:17px;font-weight:600}
.selsummary .meta{color:var(--soft);font-size:13px;font-family:var(--mono)}
.opts{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 14px;font-size:13px;color:var(--soft)}
.opts label{display:inline-flex;gap:6px;align-items:center;cursor:pointer}
.results{display:flex;flex-direction:column;gap:7px}
.slot{display:grid;grid-template-columns:150px 92px 1fr;gap:12px;align-items:center;padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card)}
.slot.free{border-left:4px solid var(--free)} .slot.warn{border-left:4px solid var(--warn)} .slot.busy{border-left:4px solid var(--busy);opacity:.72}
.slot .d{font-weight:600;font-variant-numeric:tabular-nums} .slot .d small{display:block;color:var(--soft);font-weight:400;font-size:11.5px;font-family:var(--mono)}
.slot .flags{display:flex;flex-wrap:wrap;gap:5px}
.empty{color:var(--soft);padding:20px;text-align:center}
.hint{font-size:12.5px;color:var(--soft);margin-top:14px}
/* calendar */
.cal{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
.month{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.month h3{margin:0 0 8px;font-size:13.5px;font-weight:640}
.mgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.mgrid .wd{font-size:9.5px;text-align:center;color:var(--soft);font-family:var(--mono);padding-bottom:2px}
.day{aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:11.5px;border-radius:5px;position:relative;color:var(--soft)}
.day.has{color:var(--ink);font-weight:600;cursor:pointer}
.day.stockport{background:var(--stockport-bg);color:var(--stockport)}
.day.tameside{background:var(--tameside-bg);color:var(--tameside)}
.day.both{background:linear-gradient(135deg,var(--stockport-bg) 50%,var(--tameside-bg) 50%)}
.day.multi::after{content:'';position:absolute;bottom:2px;width:3px;height:3px;border-radius:50%;background:currentColor}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--soft);margin:6px 0 16px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
.daylist{margin-top:16px}
.daylist h3{font-size:14px;margin:0 0 8px}
.fx{display:flex;gap:10px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--line);font-size:13px}
.fx .fxd{font-family:var(--mono);color:var(--soft);min-width:112px}
.foot{margin-top:26px;font-size:12px;color:var(--soft);border-top:1px solid var(--line);padding-top:12px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <header class="top">
    <p class="eyebrow">Stockport &amp; Tameside Badminton · Season 2026/27</p>
    <h1>Calendar gap finder</h1>
    <p class="sub">Combined view across <strong>both leagues</strong>. A club's commitments are every night any of its teams plays — home or away, either league. Use it to spot free nights and to find valid dates to move a match into.</p>
  </header>

  <div class="tabs" role="tablist">
    <button class="tab" role="tab" data-panel="move" aria-selected="true">Move a match</button>
    <button class="tab" role="tab" data-panel="cal" aria-selected="false">Club calendar</button>
  </div>

  <section class="panel on" id="panel-move">
    <div class="controls">
      <div class="field"><label for="mClub">Club</label><select id="mClub"></select></div>
      <div class="field"><label for="mFix">Match to move</label><select id="mFix"></select></div>
    </div>
    <div id="moveOut"></div>
  </section>

  <section class="panel" id="panel-cal">
    <div class="controls">
      <div class="field"><label for="cClub">Club</label><select id="cClub"></select></div>
    </div>
    <div class="legend">
      <span><i class="sw" style="background:var(--stockport-bg);border:1px solid var(--stockport)"></i> Stockport</span>
      <span><i class="sw" style="background:var(--tameside-bg);border:1px solid var(--tameside)"></i> Tameside</span>
      <span><i class="sw" style="background:linear-gradient(135deg,var(--stockport-bg) 50%,var(--tameside-bg) 50%)"></i> both leagues that night</span>
      <span>· dot = 2+ teams out</span>
    </div>
    <div id="calOut"></div>
  </section>

  <p class="foot">Read-only snapshot generated from the two league databases. Hard rule: a date is only invalid if one of the two teams is already playing that night (either league). Everything else is a warning — same-club nights, adjacent nights, off usual home night, weekends, and holiday breaks (Xmas/Easter approximate). Regenerate any time by re-running the tool.</p>
</div>

<script>
const D = ${JSON.stringify(payload)};
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const teamByKey = Object.fromEntries(D.teams.map(t=>[t.key,t]));
const clubByKey = Object.fromEntries(D.clubs.map(c=>[c.key,c]));
const fxByUid = Object.fromEntries(D.fixtures.map(f=>[f.uid,f]));

// indices
const committed = {};              // teamKey -> {date:[uid]}
const clubDateTeams = {};          // clubKey -> {date:Set(teamKey)}
D.fixtures.forEach(f=>{
  [['home',f.homeKey,f.homeClubKey],['away',f.awayKey,f.awayClubKey]].forEach(([ha,tk,ck])=>{
    (committed[tk]=committed[tk]||{}); (committed[tk][f.date]=committed[tk][f.date]||[]).push(f.uid);
    if(ck){ (clubDateTeams[ck]=clubDateTeams[ck]||{}); (clubDateTeams[ck][f.date]=clubDateTeams[ck][f.date]||new Set()).add(tk); }
  });
});
// season date list
function isoAdd(iso,days){ const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
// Candidate window = actual play window (first scheduled match .. last + 3 catch-up weeks),
// NOT the broad DB season record — otherwise empty pre/post-season nights look "free".
const _fxDates=D.fixtures.map(f=>f.date).sort();
const PLAY_START=_fxDates[0], PLAY_END=isoAdd(_fxDates[_fxDates.length-1],21);
const SEASON=[]; for(let d=PLAY_START; d<=PLAY_END; d=isoAdd(d,1)) SEASON.push(d);
const dow = iso => DOW[new Date(iso+'T00:00:00Z').getUTCDay()];
const BREAKS=[['Xmas','2026-12-19','2027-01-04'],['Easter','2027-03-22','2027-04-05']];
const inBreak = iso => BREAKS.find(b=>iso>=b[1]&&iso<=b[2]);
function fmt(iso){ const d=new Date(iso+'T00:00:00Z'); return DOW[d.getUTCDay()]+' '+d.getUTCDate()+' '+MON[d.getUTCMonth()]+' '+String(d.getUTCFullYear()).slice(2); }
function teamsOut(clubKey,iso,exclude){ const s=clubDateTeams[clubKey]?.[iso]; if(!s) return []; return [...s].filter(tk=>!exclude.includes(tk)); }
function busyOn(teamKey,iso,exceptUid){ const u=committed[teamKey]?.[iso]; return u && u.some(x=>x!==exceptUid); }
function oppOn(teamKey,iso,exceptUid){ const u=(committed[teamKey]?.[iso]||[]).filter(x=>x!==exceptUid);
  return u.map(uid=>{ const f=fxByUid[uid]; const other=f.homeKey===teamKey?f.awayKey:f.homeKey; const ha=f.homeKey===teamKey?'H':'A';
    return (teamByKey[other]?.name||'?')+' ('+ha+')'; }); }

/* ---------- move finder ---------- */
function candidates(f){
  const home=teamByKey[f.homeKey], away=teamByKey[f.awayKey];
  const night=home.homeNight||f.dow;
  const orig=new Date(f.date+'T00:00:00Z').getTime();
  const rows=[];
  SEASON.forEach(iso=>{
    const wd=dow(iso), onNight=wd===night;
    const homeBusy=busyOn(f.homeKey,iso,f.uid), awayBusy=busyOn(f.awayKey,iso,f.uid);
    const hard=homeBusy||awayBusy;
    const warnings=[];
    if(!onNight) warnings.push({t:'off night', s:'not '+home.name+"'s usual "+night});
    if(wd==='Sat'||wd==='Sun'){ if(wd!==night) warnings.push({t:'weekend',s:wd}); }
    const b=inBreak(iso); if(b) warnings.push({t:b[0]+' break',s:'holiday period'});
    const hc=teamsOut(home.clubKey,iso,[f.homeKey,f.awayKey]);
    if(hc.length) warnings.push({t:home.club+' ×'+hc.length,s:'other club teams out: '+hc.map(k=>teamByKey[k].name).join(', ')});
    if(away.clubKey!==home.clubKey){ const ac=teamsOut(away.clubKey,iso,[f.homeKey,f.awayKey]);
      if(ac.length) warnings.push({t:away.club+' ×'+ac.length,s:'other club teams out: '+ac.map(k=>teamByKey[k].name).join(', ')}); }
    const adjH=teamsOut(home.clubKey,isoAdd(iso,-1),[]).length+teamsOut(home.clubKey,isoAdd(iso,1),[]).length;
    if(adjH) warnings.push({t:'adjacent night',s:home.club+' plays the night before/after'});
    const status=hard?'busy':(warnings.length?'warn':'free');
    let busyReason='';
    if(homeBusy) busyReason=home.name+' already playing '+oppOn(f.homeKey,iso,f.uid).join(', ');
    else if(awayBusy) busyReason=away.name+' already playing '+oppOn(f.awayKey,iso,f.uid).join(', ');
    rows.push({iso,wd,onNight,status,warnings,busyReason,weeks:Math.round((new Date(iso+'T00:00:00Z').getTime()-orig)/6048e5)});
  });
  return {rows,night};
}
let optOnNight=true, optHideWarn=false;
function renderMove(){
  const f=fxByUid[document.getElementById('mFix').value];
  const out=document.getElementById('moveOut');
  if(!f){ out.innerHTML='<div class="card empty">Pick a match to move.</div>'; return; }
  const home=teamByKey[f.homeKey], away=teamByKey[f.awayKey];
  const {rows,night}=candidates(f);
  let list=rows.filter(r=>r.status!=='busy');
  if(optOnNight) list=list.filter(r=>r.onNight);
  if(optHideWarn) list=list.filter(r=>r.status==='free');
  // fewest conflicts first (free = 0 warnings floats to top), then nearest to the original date
  list.sort((a,b)=> a.warnings.length-b.warnings.length || Math.abs(a.weeks)-Math.abs(b.weeks));
  const freeN=rows.filter(r=>r.status==='free'&&(!optOnNight||r.onNight)).length;
  out.innerHTML=
    '<div class="card">'
    +'<div class="selsummary"><span class="match">'+home.name+' <span style="color:var(--soft)">vs</span> '+away.name+'</span>'
      +'<span class="pill '+f.league+'">'+teamByKey[f.homeKey].leagueLabel+'</span>'
      +'<span class="meta">currently '+fmt(f.date)+' · '+(f.status||'')+'</span>'
      +'<span class="meta">home night: '+night+(home.homeNight?'':' (assumed)')+'</span></div>'
    +'<div class="opts">'
      +'<label><input type="checkbox" id="optNight" '+(optOnNight?'checked':'')+'> usual home night ('+night+') only</label>'
      +'<label><input type="checkbox" id="optWarn" '+(optHideWarn?'checked':'')+'> hide dates with warnings</label>'
      +'<span style="margin-left:auto">'+freeN+' clean · '+list.length+' shown</span></div>'
    +'<div class="results">'
    +(list.length?list.map(r=>slotHTML(r)).join(''):'<div class="empty">No candidate dates with these filters — try unticking "usual home night only".</div>')
    +'</div></div>';
  document.getElementById('optNight').onchange=e=>{optOnNight=e.target.checked;renderMove();};
  document.getElementById('optWarn').onchange=e=>{optHideWarn=e.target.checked;renderMove();};
}
function slotHTML(r){
  const wk=r.weeks===0?'this week':(Math.abs(r.weeks)+'wk '+(r.weeks<0?'earlier':'later'));
  const pill='<span class="pill '+r.status+'">'+(r.status==='free'?'free':(r.status==='busy'?'busy':r.warnings.length+' warning'+(r.warnings.length>1?'s':'')))+'</span>';
  const flags=r.status==='busy'?'<span class="meta">'+r.busyReason+'</span>'
    :'<div class="flags">'+(r.warnings.length?r.warnings.map(w=>'<span class="pill warn" title="'+w.s.replace(/"/g,'&quot;')+'">'+w.t+'</span>').join(''):'<span class="pill free">no conflicts</span>')+'</div>';
  return '<div class="slot '+r.status+'"><div class="d">'+fmt(r.iso)+'<small>'+wk+'</small></div>'+pill+flags+'</div>';
}

/* ---------- club calendar ---------- */
function clubFixtures(clubKey){
  const teamKeys=clubByKey[clubKey].teamKeys;
  return D.fixtures.filter(f=>teamKeys.includes(f.homeKey)||teamKeys.includes(f.awayKey));
}
function renderCal(){
  const clubKey=document.getElementById('cClub').value;
  const fxs=clubFixtures(clubKey);
  const byDate={}; fxs.forEach(f=>{ (byDate[f.date]=byDate[f.date]||[]).push(f); });
  // months Sep 2026 .. May 2027
  const months=[]; for(let y=2026,m=8; !(y===2027&&m===5); m++){ if(m>11){m=0;y++;} months.push([y,m]); if(y===2027&&m===5)break; }
  let cal='<div class="cal">';
  months.forEach(([y,m])=>{
    const first=new Date(Date.UTC(y,m,1)), days=new Date(Date.UTC(y,m+1,0)).getUTCDate();
    let lead=(first.getUTCDay()+6)%7; // Mon=0
    cal+='<div class="month"><h3>'+MON[m]+' '+y+'</h3><div class="mgrid">'
      +['M','T','W','T','F','S','S'].map(w=>'<div class="wd">'+w+'</div>').join('');
    for(let i=0;i<lead;i++) cal+='<div class="day"></div>';
    for(let dd=1;dd<=days;dd++){
      const iso=y+'-'+String(m+1).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
      const fx=byDate[iso];
      if(!fx){ cal+='<div class="day">'+dd+'</div>'; continue; }
      const leagues=new Set(fx.map(f=>f.league));
      const cls=leagues.size>1?'both':[...leagues][0];
      const title=fx.map(f=>fmtFx(f,clubKey)).join('\\n');
      cal+='<div class="day has '+cls+(fx.length>1?' multi':'')+'" data-iso="'+iso+'" title="'+title.replace(/"/g,'&quot;')+'">'+dd+'</div>';
    }
    cal+='</div></div>';
  });
  cal+='</div>';
  // list
  const dates=Object.keys(byDate).sort();
  cal+='<div class="daylist card"><h3>'+clubByKey[clubKey].name+' — '+fxs.length+' commitments across '+clubByKey[clubKey].leagues.length+' league(s)</h3>'
    +dates.map(dt=>byDate[dt].map(f=>'<div class="fx"><span class="fxd">'+fmt(dt)+'</span><span class="pill '+f.league+'">'+teamByKey[f.homeKey].leagueLabel+'</span><span>'+fmtFx(f,clubKey)+'</span></div>').join('')).join('')
    +'</div>';
  document.getElementById('calOut').innerHTML=cal;
}
function fmtFx(f,clubKey){
  const home=teamByKey[f.homeKey], away=teamByKey[f.awayKey];
  const ours=clubByKey[clubKey].teamKeys;
  const homeOurs=ours.includes(f.homeKey);
  return (homeOurs?'▸ ':'')+home.name+' v '+away.name+(homeOurs?'':' ◂')+'  '+(homeOurs?'(H)':'(A)');
}

/* ---------- wiring ---------- */
function fillClubSelect(el){
  el.innerHTML=D.clubs.filter(c=>c.name!=='No Club').map(c=>'<option value="'+c.key+'">'+c.name+(c.leagues.length>1?' ‡':'')+'</option>').join('');
}
function fillFixtures(clubKey){
  const mFix=document.getElementById('mFix');
  const teamKeys=clubByKey[clubKey].teamKeys;
  const fxs=D.fixtures.filter(f=>teamKeys.includes(f.homeKey)).sort((a,b)=>a.date<b.date?-1:1); // home matches (the ones this club hosts/can move)
  mFix.innerHTML='<option value="">— select a home match —</option>'+fxs.map(f=>
    '<option value="'+f.uid+'">'+fmt(f.date)+' · '+teamByKey[f.homeKey].name+' v '+teamByKey[f.awayKey].name+' ['+teamByKey[f.homeKey].leagueLabel+']</option>').join('');
}
const mClub=document.getElementById('mClub'), cClub=document.getElementById('cClub');
fillClubSelect(mClub); fillClubSelect(cClub);
mClub.value=[...mClub.options].find(o=>o.textContent.startsWith('College Green'))?.value||mClub.options[0].value;
cClub.value=mClub.value;
fillFixtures(mClub.value);
mClub.onchange=()=>{ fillFixtures(mClub.value); renderMove(); };
document.getElementById('mFix').onchange=renderMove;
cClub.onchange=renderCal;
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',String(x===t)));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('on',p.id==='panel-'+t.dataset.panel));
  if(t.dataset.panel==='cal') renderCal();
});
renderMove();
</script>`;

fs.writeFileSync(OUT, html);
console.log('Wrote ' + OUT + ' (' + html.length + ' bytes)');
