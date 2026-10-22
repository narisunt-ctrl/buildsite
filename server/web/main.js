// Page wiring: live connection, project picker, HUD and site diary. The 3D world lives in scene.js.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATUS = { construct: 'กำลังก่อสร้าง', handover: 'ส่งมอบแล้ว', stopped: 'หยุดงานกลางคัน' };
const EL = { active: 'กำลังทำ', done: 'ผ่าน', defect: 'บกพร่อง', repaired: 'แก้แล้ว' };
const KEY = 'buildsite.project';

function stored() {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
function store(v) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    // fine without it
  }
}

const fmtClock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

let scene = null;
let trades = {};
let view = null;
let follow = stored();

async function boot() {
  trades = await (await fetch('/api/trades')).json();
  try {
    const { SiteScene } = await import('./scene.js');
    scene = new SiteScene($('scene'), $('overlay'));
    scene.setTrades(trades);
    scene.onFollowChange = (on) => $('follow').classList.toggle('on', on);
  } catch (err) {
    console.error(err);
    $('nogl').hidden = false;
  }
  $('follow').addEventListener('click', () => scene?.setFollow(!scene.follow));
  $('project').addEventListener('change', (e) => {
    follow = e.target.value;
    store(follow);
    connect();
  });
  connect();
  setInterval(tickClock, 500);
}

let source = null;
function connect() {
  source?.close();
  source = new EventSource(`/events${follow ? `?project=${encodeURIComponent(follow)}` : ''}`);
  source.onmessage = (e) => render(JSON.parse(e.data));
}

function render(next) {
  view = next;
  const ids = Object.keys(view.projects).sort((a, b) => view.projects[b].updatedAt - view.projects[a].updatedAt);
  const picker = $('project');
  picker.parentElement.hidden = ids.length < 2;
  picker.innerHTML =
    `<option value="">ล่าสุดเสมอ</option>` +
    ids.map((id) => `<option value="${esc(id)}">${esc(view.projects[id].name ?? id.slice(0, 8))}</option>`).join('');
  picker.value = follow && view.projects[follow] ? follow : '';

  const p = view.projects[view.current] ?? null;
  $('empty').hidden = !!p || !$('nogl').hidden;
  scene?.update(p);
  $('report').href = p ? `/report?project=${encodeURIComponent(p.id)}` : '/report';
  document.title = p?.name ? `${p.name} · Buildsite` : 'Buildsite · ไซต์งานของ Claude';

  const b = p?.buildings.at(-1);
  $('bno').textContent = b ? `#${b.no}` : '—';
  $('bstatus').textContent = b ? STATUS[b.status] : '';

  $('trades').innerHTML = Object.entries(trades)
    .map(([id, t]) => {
      const busy = b?.status === 'construct' && p.crew[id]?.busy > 0;
      return `<span class="chip${busy ? ' busy' : ''}" style="--trade:${t.color}"><i></i>${esc(t.label)} <b style="font-size:14px">${b?.stats.byTrade[id] ?? 0}</b></span>`;
    })
    .join('');

  let open = 0;
  for (const bb of p?.buildings ?? []) open += bb.stats.defect;
  $('defects').textContent = open;
  $('defects').classList.toggle('bad', open > 0);

  const tk = b?.tokens;
  $('tokens').textContent = tk ? `${fmtTok(tk.input + tk.cacheRead + tk.cacheWrite)} / ${fmtTok(tk.output)}` : '— / —';
  $('tokcell').title = tk ? `อาคารนี้: input ${tk.input} · cache อ่าน ${tk.cacheRead} · cache เขียน ${tk.cacheWrite} · output ${tk.output}` : 'ยังไม่มีข้อมูล token';

  const items = [];
  for (const bb of [...(p?.buildings ?? [])].reverse()) {
    for (const el of [...bb.elements].reverse()) {
      items.push({ bb, el });
      if (items.length >= 16) break;
    }
    if (items.length >= 16) break;
  }
  $('diary').innerHTML = items.length
    ? items
        .map(({ bb, el }) => `<li class="${el.status}" style="--trade:${trades[el.trade]?.color}"><i></i><span title="${esc(el.tool)} ${esc(el.target ?? '')}">${esc(el.verb)}<small>${esc(el.target ?? el.tool)}</small></span><em>${bb.no}.${el.n} ${EL[el.status]}</em></li>`)
        .join('')
    : '<li class="none">ยังไม่มีรายการ</li>';
  tickClock();
}

function tickClock() {
  const b = view?.projects[view.current]?.buildings.at(-1);
  $('timer').textContent = b ? fmtClock((b.endedAt ?? Date.now()) - b.startedAt) : '00:00';
}

boot();
