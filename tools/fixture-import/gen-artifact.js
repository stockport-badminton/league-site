const fs = require('fs');
const path = require('path');
const GEN = path.join(__dirname, 'generated');
const { divisions, records } = JSON.parse(fs.readFileSync(path.join(GEN, 'review-data.json'), 'utf8'));

// Slim payload for the client
const DATA = {
  divOrder: ["Premier", "Division 1", "Division 2", "Division 3"],
  divisions: Object.fromEntries(Object.entries(divisions).map(([k, v]) => [k, { teamIds: v.teamIds, teamNames: v.teamNames }])),
  records: records.map(r => ({
    fixtureId: r.fixtureId, div: r.div, homeId: r.homeId, awayId: r.awayId,
    home: r.home, away: r.away, date: r.date, lowConf: r.lowConf
  }))
};

const OUT = process.argv[2] || path.join(GEN, 'fixtures-review.html');

const html = `<title>2026/27 Fixtures — Review &amp; Approve</title>
<style>
:root{
  --paper:#f6f4ee; --card:#fffdf8; --ink:#1c2530; --ink-soft:#5b6472; --line:#d9d3c6;
  --accent:#1f4e79; --accent-soft:#3a6ea5; --accent-ghost:#e7edf4;
  --ok:#2f7d55; --ok-bg:#e7f2ea; --warn:#9a6b12; --warn-bg:#faf0d7; --bad:#a5342b; --bad-bg:#f7e2df;
  --shade:#ece7dc;
  --mono:'SF Mono',ui-monospace,'DejaVu Sans Mono',Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#14181d; --card:#1b2027; --ink:#e6e9ee; --ink-soft:#9aa4b1; --line:#2f3742;
  --accent:#6fa8dc; --accent-soft:#8bbbe6; --accent-ghost:#1f2a35;
  --ok:#6cc294; --ok-bg:#172a20; --warn:#e0b25a; --warn-bg:#2e2612; --bad:#e88b80; --bad-bg:#331c1a;
  --shade:#232a32;
}}
:root[data-theme="light"]{
  --paper:#f6f4ee; --card:#fffdf8; --ink:#1c2530; --ink-soft:#5b6472; --line:#d9d3c6;
  --accent:#1f4e79; --accent-soft:#3a6ea5; --accent-ghost:#e7edf4;
  --ok:#2f7d55; --ok-bg:#e7f2ea; --warn:#9a6b12; --warn-bg:#faf0d7; --bad:#a5342b; --bad-bg:#f7e2df; --shade:#ece7dc;
}
:root[data-theme="dark"]{
  --paper:#14181d; --card:#1b2027; --ink:#e6e9ee; --ink-soft:#9aa4b1; --line:#2f3742;
  --accent:#6fa8dc; --accent-soft:#8bbbe6; --accent-ghost:#1f2a35;
  --ok:#6cc294; --ok-bg:#172a20; --warn:#e0b25a; --warn-bg:#2e2612; --bad:#e88b80; --bad-bg:#331c1a; --shade:#232a32;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.5;
  -webkit-font-smoothing:antialiased;font-size:15px}
.wrap{max-width:1240px;margin:0 auto;padding:28px 22px 80px}
header.top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px;
  border-bottom:2px solid var(--ink);padding-bottom:16px;margin-bottom:22px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 4px}
h1{font-size:26px;margin:0;font-weight:650;letter-spacing:-.01em;text-wrap:balance}
.sub{color:var(--ink-soft);margin:6px 0 0;max-width:60ch}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:22px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.tile .n{font-size:28px;font-weight:680;font-variant-numeric:tabular-nums;line-height:1.05}
.tile .l{font-size:12px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.tile.bad .n{color:var(--bad)} .tile.warn .n{color:var(--warn)} .tile.ok .n{color:var(--ok)}
.tile.bad{border-color:var(--bad)} .tile.warn{border-color:var(--warn)}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:18px}
.tabs{display:flex;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px}
.tab{border:0;background:transparent;color:var(--ink-soft);font:inherit;font-weight:560;padding:7px 14px;border-radius:7px;cursor:pointer}
.tab[aria-selected="true"]{background:var(--accent);color:#fff}
.tab .badge{display:inline-block;min-width:18px;margin-left:6px;padding:0 5px;font-size:11px;font-family:var(--mono);
  background:var(--bad);color:#fff;border-radius:9px;vertical-align:1px}
.tab[aria-selected="true"] .badge{background:rgba(255,255,255,.28)}
.tab .badge.zero{display:none}
.spacer{flex:1}
button.action{border:1px solid var(--accent);background:var(--accent);color:#fff;font:inherit;font-weight:580;
  padding:9px 16px;border-radius:9px;cursor:pointer}
button.action.ghost{background:transparent;color:var(--accent)}
button.action:disabled{opacity:.45;cursor:not-allowed}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--ink-soft);margin-bottom:14px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.dot{width:11px;height:11px;border-radius:3px;border:1px solid var(--line);display:inline-block}
.dot.ok{background:var(--ok-bg);border-color:var(--ok)} .dot.warn{background:var(--warn-bg);border-color:var(--warn)}
.dot.bad{background:var(--bad-bg);border-color:var(--bad)}
.gridwrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px}
table{border-collapse:separate;border-spacing:0;font-size:13px}
th,td{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:0}
thead th{position:sticky;top:0;background:var(--card);z-index:2}
th.corner{position:sticky;left:0;z-index:3;background:var(--card)}
th.awayhdr{padding:8px 6px;font-weight:600;color:var(--accent);vertical-align:bottom;min-width:96px;
  writing-mode:horizontal-tb;text-align:center;font-size:11.5px;line-height:1.2}
th.homehdr{position:sticky;left:0;z-index:2;background:var(--card);text-align:left;padding:6px 10px;
  font-weight:600;white-space:nowrap;min-width:130px}
td.cell{padding:4px 5px;text-align:center;background:var(--card)}
td.diag{background:repeating-linear-gradient(45deg,var(--shade),var(--shade) 6px,transparent 6px,transparent 12px)}
td.cell input{width:118px;border:1px solid var(--line);background:var(--paper);color:var(--ink);
  font:inherit;font-size:12px;padding:4px 5px;border-radius:6px;font-variant-numeric:tabular-nums}
td.cell input:focus{outline:2px solid var(--accent);outline-offset:1px}
td.cell .dow{font-size:10.5px;color:var(--ink-soft);margin-top:2px;height:13px;font-family:var(--mono)}
td.st-ok{background:var(--ok-bg)} td.st-ok input{border-color:var(--ok)}
td.st-warn{background:var(--warn-bg)} td.st-warn input{border-color:var(--warn)}
td.st-bad{background:var(--bad-bg)} td.st-bad input{border-color:var(--bad);font-weight:600}
td.cell .flag{font-size:10px;font-family:var(--mono);margin-top:1px;min-height:12px;line-height:1.1}
td.st-warn .flag{color:var(--warn)} td.st-bad .flag{color:var(--bad)}
.confirm{margin-top:2px;font-size:10px;border:1px solid var(--warn);background:transparent;color:var(--warn);
  border-radius:5px;padding:1px 6px;cursor:pointer;font-family:var(--mono)}
td.confirmed{background:var(--card)!important} td.confirmed input{border-color:var(--line)!important}
.issues{margin-top:26px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.issues h2{font-size:15px;margin:0 0 10px;letter-spacing:-.01em}
.issues ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto}
.issues li{display:flex;gap:10px;align-items:center;font-size:13px;padding:5px 8px;border-radius:7px;cursor:pointer}
.issues li:hover{background:var(--accent-ghost)}
.issues li .tag{font-family:var(--mono);font-size:10.5px;padding:1px 6px;border-radius:5px;white-space:nowrap}
.issues li .tag.bad{background:var(--bad-bg);color:var(--bad)} .issues li .tag.warn{background:var(--warn-bg);color:var(--warn)}
.issues li .where{color:var(--ink-soft);font-family:var(--mono);font-size:11px}
.done{color:var(--ok);font-weight:560}
.foot{margin-top:26px;font-size:12.5px;color:var(--ink-soft);border-top:1px solid var(--line);padding-top:14px}
code{font-family:var(--mono);background:var(--accent-ghost);padding:1px 5px;border-radius:4px;font-size:12px}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;
  background:var(--ink);color:var(--paper);padding:11px 20px;border-radius:10px;font-weight:560;font-size:14px;
  transition:.25s;pointer-events:none;z-index:50}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <header class="top">
    <div>
      <p class="eyebrow">Stockport Badminton League · Season 2026/27</p>
      <h1>Fixture grid review &amp; approve</h1>
      <p class="sub">Transcribed from the four handwritten grids. Rows are the <strong>home</strong> team, columns the <strong>away</strong> team — exactly as on paper. Correct any cell against the sheets, clear the flags, then export the approved set to publish. <strong>Your edits save automatically in this browser</strong> — a refresh won\\u2019t lose them.</p>
    </div>
  </header>

  <section class="tiles" id="tiles"></section>

  <div class="bar">
    <div class="tabs" id="tabs" role="tablist"></div>
    <div class="spacer"></div>
    <span id="savedAt" class="where" style="font-family:var(--mono);color:var(--ok);font-size:11.5px"></span>
    <button class="action ghost" id="btnJump">Jump to next issue</button>
    <button class="action ghost" id="btnReset" title="Discard your edits and reload the original transcription">Restore original</button>
    <button class="action ghost" id="btnCopy">Copy JSON</button>
    <button class="action" id="btnExport">Download JSON</button>
  </div>

  <div class="legend">
    <span><i class="dot ok"></i> Ready</span>
    <span><i class="dot warn"></i> Check — low-confidence read or weekend date (confirm to clear)</span>
    <span><i class="dot bad"></i> Must fix — blank, clash, or out of season</span>
    <span style="margin-left:auto;font-family:var(--mono)">272 fixtures · ids 7123–7394</span>
  </div>

  <div class="gridwrap"><div id="grid"></div></div>

  <section class="issues">
    <h2 id="issuesTitle">Outstanding</h2>
    <ul id="issuesList"></ul>
  </section>

  <details id="jsonBox" style="margin-top:22px">
    <summary style="cursor:pointer;font-weight:560;color:var(--accent)">Approved JSON <span id="jsonReady" class="where" style="font-family:var(--mono);color:var(--ink-soft)"></span></summary>
    <p class="foot" style="margin-top:10px;border:0;padding:0">Copy this and paste it back into the chat, or use <strong>Download JSON</strong> / <strong>Copy JSON</strong> above. Covers all 272 fixtures as <code>{ fixtureId: "YYYY-MM-DD" }</code>. Nothing here touches the live database — publishing is a separate, backed-up step.</p>
    <textarea id="jsonOut" readonly spellcheck="false" style="width:100%;height:200px;margin-top:8px;font-family:var(--mono);font-size:12px;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px;resize:vertical"></textarea>
  </details>
  <p class="foot">Season window enforced: 15 Aug 2026 – 15 May 2027; weekday expected (Syddal Park plays Sundays, so those are flagged as "check", not errors). The publish step refuses any blank, clash, or out-of-season date, so an export with reds still showing is safe to send — it just won't publish until fixed.</p>
</div>
<div class="toast" id="toast"></div>

<script>
const DATA = ${JSON.stringify(DATA)};
const WIN_START = Date.UTC(2026,7,15), WIN_END = Date.UTC(2027,4,15);
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pairKey = (h,a) => h+'-'+a;

// state
const cells = {}; // fixtureId -> {rec, value, orig, lowConf, confirmed}
DATA.records.forEach(r => { cells[r.fixtureId] = { rec:r, value:r.date||'', orig:r.date||'', lowConf:r.lowConf, confirmed:false }; });
const byPair = {}; DATA.records.forEach(r => byPair[pairKey(r.homeId,r.awayId)] = r.fixtureId);
let activeDiv = DATA.divOrder[0];

// --- autosave (this browser) so a refresh never loses edits ---
const STORE='sbl-fixtures-2026-27';
let storeOK=true;
function saveState(){
  if(!storeOK) return;
  try{
    const v={}, cf=[];
    Object.values(cells).forEach(c=>{ v[c.rec.fixtureId]=c.value; if(c.confirmed) cf.push(c.rec.fixtureId); });
    localStorage.setItem(STORE, JSON.stringify({t:Date.now(), v, cf}));
    stampSaved(Date.now());
  }catch(e){ storeOK=false; }
}
function loadState(){
  try{
    const raw=localStorage.getItem(STORE); if(!raw) return null;
    const s=JSON.parse(raw);
    Object.entries(s.v||{}).forEach(([fid,val])=>{ if(cells[fid]) cells[fid].value=val; });
    (s.cf||[]).forEach(fid=>{ if(cells[fid]) cells[fid].confirmed=true; });
    return s.t||null;
  }catch(e){ storeOK=false; return null; }
}
function stampSaved(t){
  const el=document.getElementById('savedAt'); if(!el) return;
  const d=new Date(t);
  el.textContent='saved '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');
}
const restoredAt = loadState();

function parseUTC(s){ if(!s) return null; const m=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s); if(!m) return NaN;
  return Date.UTC(+m[1],+m[2]-1,+m[3]); }
function ukLabel(s){ const t=parseUTC(s); if(t==null) return ''; if(isNaN(t)) return 'bad date';
  const d=new Date(t); const dd=String(d.getUTCDate()).padStart(2,'0'), mm=String(d.getUTCMonth()+1).padStart(2,'0');
  return DOW[d.getUTCDay()]+' '+dd+'/'+mm+'/'+String(d.getUTCFullYear()).slice(2); }

// compute flags for every cell given current values
function evaluate(){
  const teamDate = {}; // teamId|date -> [fixtureId]
  Object.values(cells).forEach(c=>{
    c.flags=[];
    const v=c.value;
    if(!v){ c.flags.push('BLANK'); return; }
    const t=parseUTC(v);
    if(isNaN(t)){ c.flags.push('BADDATE'); return; }
    if(t<WIN_START||t>WIN_END) c.flags.push('OUT_OF_SEASON');
    const dow=new Date(t).getUTCDay();
    if(dow===0||dow===6) c.flags.push('WEEKEND');
    [c.rec.homeId,c.rec.awayId].forEach(tid=>{ const k=tid+'|'+v; (teamDate[k]=teamDate[k]||[]).push(c.rec.fixtureId); });
  });
  Object.values(teamDate).forEach(ids=>{ if(ids.length>1) ids.forEach(id=>cells[id].flags.push('CLASH')); });
  // both legs same night
  Object.values(cells).forEach(c=>{ if(!c.value) return;
    const rev=byPair[pairKey(c.rec.awayId,c.rec.homeId)];
    if(rev && cells[rev].value===c.value) c.flags.push('BOTHLEGS'); });
  // low-confidence still unresolved (only if unchanged & unconfirmed)
  Object.values(cells).forEach(c=>{
    if(c.lowConf && !c.confirmed && c.value===c.orig && c.value) c.flags.push('LOWCONF');
  });
}
const HARD=['BLANK','BADDATE','OUT_OF_SEASON','CLASH','BOTHLEGS'];
const SOFT=['WEEKEND','LOWCONF'];
function status(c){ if(c.flags.some(f=>HARD.includes(f))) return 'bad'; if(c.confirmed) return 'ok'; if(c.flags.some(f=>SOFT.includes(f))) return 'warn'; return 'ok'; }
const FLAGTXT={BLANK:'blank',BADDATE:'bad date',OUT_OF_SEASON:'out of season',CLASH:'team clash',BOTHLEGS:'both legs same day',WEEKEND:'weekend',LOWCONF:'unsure — confirm'};

function renderTiles(){
  evaluate();
  const list=Object.values(cells);
  const bad=list.filter(c=>status(c)==='bad').length;
  const warn=list.filter(c=>status(c)==='warn').length;
  const ok=list.filter(c=>status(c)==='ok').length;
  const clash=list.filter(c=>c.flags.includes('CLASH')||c.flags.includes('BOTHLEGS')).length;
  document.getElementById('tiles').innerHTML=
    tile(list.length,'Fixtures','')+tile(ok,'Ready','ok')+tile(warn,'To check','warn')+
    tile(bad,'Must fix','bad')+tile(clash,'Date clashes',clash?'bad':'ok');
  // keep the live JSON + readiness note in sync
  const ta=document.getElementById('jsonOut'); if(ta) ta.value=buildJSON();
  const jr=document.getElementById('jsonReady');
  if(jr) jr.textContent = bad>0 ? ('— '+bad+' still to fix (safe to send; won\\u2019t publish yet)') : '— all clear, ready to publish';
  // tab badges
  DATA.divOrder.forEach(d=>{
    const n=list.filter(c=>c.rec.div===d&&status(c)!=='ok').length;
    const b=document.querySelector('.tab[data-div="'+CSS.escape(d)+'"] .badge');
    if(b){ b.textContent=n; b.classList.toggle('zero',n===0); }
  });
}
function tile(n,l,cls){ return '<div class="tile '+cls+'"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }

function renderGrid(){
  const d=DATA.divisions[activeDiv], ids=d.teamIds, names=d.teamNames;
  let h='<table><thead><tr><th class="corner homehdr">'+activeDiv+' ▸ home ╲ away</th>';
  names.forEach(n=>h+='<th class="awayhdr">'+n+'</th>');
  h+='</tr></thead><tbody>';
  ids.forEach((hid,r)=>{
    h+='<tr><th class="homehdr">'+names[r]+'</th>';
    ids.forEach((aid,c)=>{
      if(r===c){ h+='<td class="diag"></td>'; return; }
      const fid=byPair[pairKey(hid,aid)]; const cell=cells[fid]; const st=status(cell);
      const flagLabel=cell.confirmed?'':cell.flags.map(f=>FLAGTXT[f]).join(' · ');
      const showConfirm=st==='warn'&&!cell.confirmed;
      h+='<td class="cell st-'+st+(cell.confirmed?' confirmed':'')+'" data-fid="'+fid+'">'
        +'<input type="date" min="2026-08-15" max="2027-05-15" value="'+cell.value+'" '
        +'aria-label="'+names[r]+' v '+names[c]+'" data-fid="'+fid+'">'
        +'<div class="dow">'+ukLabel(cell.value)+'</div>'
        +'<div class="flag">'+flagLabel+'</div>'
        +'<button class="confirm" data-fid="'+fid+'"'+(showConfirm?'':' hidden')+'>confirm ✓</button>'
        +'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  document.getElementById('grid').innerHTML=h;
}

// In-place status refresh — never replaces inputs, so typing (incl. the year) is stable.
function updateStatuses(){
  document.querySelectorAll('#grid td.cell').forEach(td=>{
    const fid=+td.dataset.fid, c=cells[fid], st=status(c);
    td.className='cell st-'+st+(c.confirmed?' confirmed':'');
    const dow=td.querySelector('.dow'); if(dow) dow.textContent=ukLabel(c.value);
    const fl=td.querySelector('.flag'); if(fl) fl.textContent=c.confirmed?'':c.flags.map(f=>FLAGTXT[f]).join(' · ');
    const btn=td.querySelector('.confirm'); if(btn) btn.hidden=!(st==='warn'&&!c.confirmed);
  });
}

function renderIssues(){
  const list=Object.values(cells).filter(c=>status(c)!=='ok')
    .sort((a,b)=>{const o=DATA.divOrder.indexOf(a.rec.div)-DATA.divOrder.indexOf(b.rec.div);return o||(status(b)==='bad')-(status(a)==='bad');});
  const t=document.getElementById('issuesTitle');
  const ul=document.getElementById('issuesList');
  if(!list.length){ t.innerHTML='Outstanding <span class="done">— all clear ✓</span>'; ul.innerHTML=''; return; }
  t.textContent='Outstanding ('+list.length+')';
  ul.innerHTML=list.map(c=>{
    const st=status(c); const flags=c.flags.map(f=>FLAGTXT[f]).join(', ');
    return '<li data-fid="'+c.rec.fixtureId+'" data-div="'+c.rec.div+'">'
      +'<span class="tag '+st+'">'+(st==='bad'?'FIX':'check')+'</span>'
      +'<span>'+c.rec.home+' v '+c.rec.away+'</span>'
      +'<span class="where">'+c.rec.div+' · #'+c.rec.fixtureId+' · '+(c.value?ukLabel(c.value):'blank')+'</span>'
      +'<span class="where" style="margin-left:auto">'+flags+'</span></li>';
  }).join('');
}

function renderAll(){ renderTiles(); renderGrid(); renderIssues(); }

// events
document.getElementById('grid').addEventListener('input',e=>{
  const inp=e.target.closest('input[data-fid]'); if(!inp) return;
  const fid=+inp.dataset.fid; cells[fid].value=inp.value;
  renderTiles();       // tiles + tab badges + JSON box (separate DOM subtree)
  updateStatuses();    // recolour cells in place — does NOT touch the input being typed in
  renderIssues();      // outstanding list (separate DOM subtree)
  saveState();
});
document.getElementById('grid').addEventListener('click',e=>{
  const btn=e.target.closest('.confirm'); if(!btn) return;
  const fid=+btn.dataset.fid; cells[fid].confirmed=true; renderAll(); saveState();
});
document.getElementById('issuesList').addEventListener('click',e=>{
  const li=e.target.closest('li'); if(!li) return;
  const div=li.dataset.div, fid=+li.dataset.fid;
  if(div!==activeDiv){ activeDiv=div; syncTabs(); renderGrid(); }
  const td=document.querySelector('td[data-fid="'+fid+'"]'); if(td){ td.scrollIntoView({block:'center',inline:'center'});
    const i=td.querySelector('input'); if(i) i.focus(); }
});
document.getElementById('btnJump').addEventListener('click',()=>{
  const order=DATA.divOrder;
  const all=order.flatMap(d=>DATA.divisions[d].teamIds.flatMap((h,r)=>DATA.divisions[d].teamIds.map((a,c)=>r!==c?byPair[pairKey(h,a)]:null)).filter(Boolean));
  const bad=all.filter(fid=>status(cells[fid])!=='ok');
  if(!bad.length){ toast('Nothing left to review 🎉'); return; }
  const fid=bad[0]; const div=cells[fid].rec.div;
  if(div!==activeDiv){ activeDiv=div; syncTabs(); renderGrid(); }
  const td=document.querySelector('td[data-fid="'+fid+'"]'); if(td){ td.scrollIntoView({block:'center',inline:'center'});
    const i=td.querySelector('input'); if(i) i.focus(); }
});
function buildJSON(){
  const out={}; Object.values(cells).forEach(c=>{ out[c.rec.fixtureId]=c.value; });
  return JSON.stringify({season:'2026/27',count:Object.keys(out).length,dates:out},null,1);
}
document.getElementById('btnExport').addEventListener('click',()=>{
  const json=buildJSON();
  try{
    const blob=new Blob([json],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='approved-fixtures-2026-27.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Downloaded approved-fixtures-2026-27.json — check your Downloads folder');
  }catch(e){
    document.getElementById('jsonBox').open=true;
    document.getElementById('jsonOut').select();
    toast('Download blocked — copy the JSON box below instead');
  }
});
document.getElementById('btnCopy').addEventListener('click',async()=>{
  const json=buildJSON();
  try{
    await navigator.clipboard.writeText(json);
    toast('Copied 272 fixtures to clipboard — paste it into the chat');
  }catch(e){
    const ta=document.getElementById('jsonOut'); document.getElementById('jsonBox').open=true;
    ta.focus(); ta.select();
    try{ document.execCommand('copy'); toast('Copied — paste it into the chat'); }
    catch(_){ toast('Select the JSON box below and copy manually'); }
  }
});
document.getElementById('btnReset').addEventListener('click',()=>{
  if(!confirm('Discard all your edits and reload the original transcription? This cannot be undone.')) return;
  Object.values(cells).forEach(c=>{ c.value=c.orig; c.confirmed=false; });
  try{ localStorage.removeItem(STORE); }catch(e){}
  document.getElementById('savedAt').textContent='';
  renderAll(); toast('Reverted to the original transcription');
});

// tabs
function syncTabs(){ document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',String(t.dataset.div===activeDiv))); }
(function buildTabs(){
  const wrap=document.getElementById('tabs');
  wrap.innerHTML=DATA.divOrder.map(d=>'<button class="tab" role="tab" data-div="'+d+'" aria-selected="'+(d===activeDiv)+'">'+d+' <span class="badge zero">0</span></button>').join('');
  wrap.addEventListener('click',e=>{const b=e.target.closest('.tab');if(!b)return;activeDiv=b.dataset.div;syncTabs();renderGrid();renderTiles();});
})();

let toastT; function toast(m){ const el=document.getElementById('toast'); el.textContent=m; el.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),2600); }

renderAll();
if(restoredAt){ stampSaved(restoredAt); toast('Restored your saved edits from this browser'); }
else if(!storeOK){ const s=document.getElementById('savedAt'); if(s){ s.style.color='var(--warn)'; s.textContent='autosave off (browser storage blocked)'; } }
</script>`;

fs.writeFileSync(OUT, html);
console.log('Wrote ' + OUT + ' (' + html.length + ' bytes)');
