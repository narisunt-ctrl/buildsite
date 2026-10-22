// "ใบตรวจรับงาน" — a printable handover report for one project, rendered as a standalone HTML page.
import { stats } from './site.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' }) : '—');

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h} ชม. ${m} นาที` : m ? `${m} นาที ${r} วินาที` : `${r} วินาที`;
}

const fmtNum = (v) => (Number.isFinite(v) ? v.toLocaleString('th-TH') : '—');

const STATUS_TH = { construct: 'กำลังก่อสร้าง', handover: 'ส่งมอบแล้ว', stopped: 'หยุดงานกลางคัน' };
const EL_TH = { active: 'กำลังทำ', done: 'ผ่าน', defect: 'ข้อบกพร่อง', repaired: 'แก้ไขแล้ว' };

export function renderReport(project, trades, now = Date.now()) {
  const totals = { buildings: project.buildings.length, elements: 0, defect: 0, repaired: 0, handover: 0 };
  for (const b of project.buildings) {
    const s = stats(b);
    totals.elements += s.total;
    totals.defect += s.defect;
    totals.repaired += s.repaired;
    if (b.status === 'handover') totals.handover += 1;
  }

  const rows = project.buildings
    .map((b) => {
      const s = stats(b);
      const t = b.tokens;
      return `<tr><td>อาคาร ${b.no}</td><td>${esc(STATUS_TH[b.status])}</td><td>${fmtTime(b.startedAt)}</td>
      <td>${fmtDuration((b.endedAt ?? now) - b.startedAt)}</td><td class="n">${s.total}</td>
      <td class="n">${s.defect}</td><td class="n">${s.repaired}</td>
      <td class="n">${t ? fmtNum(t.input + t.cacheRead + t.cacheWrite) : '—'}</td><td class="n">${t ? fmtNum(t.output) : '—'}</td></tr>`;
    })
    .join('');

  const issues = [];
  for (const b of project.buildings) {
    for (const el of b.elements) {
      if (el.status !== 'defect' && el.status !== 'repaired') continue;
      issues.push(`<tr class="${el.status}"><td>อาคาร ${b.no} / ชิ้นที่ ${el.n}</td><td>${esc(trades[el.trade]?.label ?? el.trade)}</td>
        <td>${esc(el.verb)}</td><td><code>${esc(el.tool)}</code> ${esc(el.target ?? '')}</td>
        <td>${esc(EL_TH[el.status])}${el.interrupted ? ' (ถูกขัดจังหวะ)' : ''}${el.repairedBy ? ` — โดยอาคาร ${el.repairedBy.building} ชิ้นที่ ${el.repairedBy.element}` : ''}</td></tr>`);
    }
  }

  const details = project.buildings
    .map((b) => {
      const items = b.elements
        .map((el) => `<tr class="${el.status}"><td class="n">${el.n}</td><td>${esc(trades[el.trade]?.label ?? el.trade)}</td><td>${esc(el.verb)}</td>
          <td><code>${esc(el.tool)}</code></td><td>${esc(el.target ?? '')}</td><td>${esc(EL_TH[el.status])}</td>
          <td class="n">${el.endedAt ? fmtDuration(el.endedAt - el.startedAt) : '—'}</td></tr>`)
        .join('');
      return `<section class="b"><h3>อาคาร ${b.no} · ${esc(STATUS_TH[b.status])}</h3>
        ${items ? `<table><thead><tr><th>#</th><th>สายงาน</th><th>งาน</th><th>เครื่องมือ</th><th>เป้าหมาย</th><th>ผล</th><th>เวลา</th></tr></thead><tbody>${items}</tbody></table>` : '<p class="muted">ไม่มีชิ้นงาน (ตอบคำถามอย่างเดียว)</p>'}</section>`;
    })
    .join('');

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ใบตรวจรับงาน — ${esc(project.name ?? project.id)}</title>
<style>
  :root { --ink:#1d2330; --muted:#69707d; --line:#d7dbe2; --ok:#1e8e4e; --bad:#c0392b; --fix:#b7791f; }
  * { box-sizing: border-box; }
  body { font-family: Sarabun, "TH Sarabun New", Tahoma, sans-serif; color: var(--ink); margin: 0; background: #f4f5f7; }
  main { max-width: 980px; margin: 24px auto; background: #fff; padding: 40px 48px; }
  h1 { font-size: 28px; margin: 0 0 18px; } h2 { font-size: 20px; margin: 32px 0 10px; border-bottom: 2px solid var(--ink); padding-bottom: 4px; }
  h3 { font-size: 16px; margin: 20px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #eef0f3; } td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .info th { width: 32%; } code { font-size: 12px; background: #f1f2f4; padding: 1px 4px; border-radius: 3px; }
  tr.defect td { color: var(--bad); } tr.repaired td { color: var(--fix); }
  .cover { page-break-after: always; } .muted { color: var(--muted); }
  .bar { display:flex; justify-content:flex-end; margin-bottom: 12px; } button { font: inherit; padding: 6px 14px; cursor: pointer; }
  @media print { body { background:#fff; } main { margin:0; padding: 0; max-width:none; } .bar { display:none; } }
</style></head><body><main>
<div class="bar"><button onclick="print()">พิมพ์ / บันทึกเป็น PDF</button></div>
<section class="cover">
<h1>ใบตรวจรับงาน (Work Handover Record)</h1>
<table class="info"><tbody>
<tr><th>โครงการ</th><td>${esc(project.name ?? '—')}</td></tr>
<tr><th>ที่ตั้ง (โฟลเดอร์)</th><td><code>${esc(project.cwd ?? '—')}</code></td></tr>
<tr><th>รหัสเซสชัน</th><td><code>${esc(project.id)}</code></td></tr>
<tr><th>เริ่มโครงการ</th><td>${fmtTime(project.createdAt)}</td></tr>
<tr><th>วันที่ออกรายงาน</th><td>${fmtTime(now)}</td></tr>
<tr><th>จำนวนอาคาร / ส่งมอบแล้ว</th><td>${totals.buildings} / ${totals.handover}</td></tr>
<tr><th>ชิ้นงานทั้งหมด</th><td>${totals.elements}</td></tr>
<tr><th>ข้อบกพร่องคงค้าง / แก้ไขแล้ว</th><td>${totals.defect} / ${totals.repaired}</td></tr>
</tbody></table>
</section>
<h2>1. สรุปรายอาคาร</h2>
<table><thead><tr><th>อาคาร</th><th>สถานะ</th><th>เริ่ม</th><th>ระยะเวลา</th><th>ชิ้นงาน</th><th>บกพร่อง</th><th>แก้แล้ว</th><th>Token เข้า</th><th>Token ออก</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9" class="muted">ยังไม่มีอาคาร</td></tr>'}</tbody></table>
<h2>2. บัญชีข้อบกพร่อง</h2>
${issues.length ? `<table><thead><tr><th>ตำแหน่ง</th><th>สายงาน</th><th>งาน</th><th>รายละเอียด</th><th>สถานะ</th></tr></thead><tbody>${issues.join('')}</tbody></table>` : '<p>ไม่พบข้อบกพร่อง</p>'}
<h2>3. รายละเอียดชิ้นงาน</h2>
${details || '<p class="muted">—</p>'}
<p class="muted" style="margin-top:32px;font-size:12px">"ข้อบกพร่อง" คือการเรียกเครื่องมือที่ Claude Code รายงานว่าล้มเหลว · Token เข้า รวม cache · ข้อมูลทั้งหมดอยู่ในเครื่องของคุณเท่านั้น</p>
</main></body></html>`;
}
