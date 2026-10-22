// The site model. A Claude Code session is a project (โครงการ); each prompt is one building (อาคาร);
// each tool call is one element (ชิ้นงาน) of that building. Buildings stay on the site after handover,
// so the project keeps a visible history of the day's work.
//
// Element status: active → done | defect. A defect becomes "repaired" when a later call of the same
// kind on the same target succeeds.
import { classify, TRADE_IDS } from './trades.js';

export const LIMITS = { projects: 10, buildings: 40, elements: 240, staleMs: 10 * 60 * 1000 };

const crewIdle = () => Object.fromEntries(TRADE_IDS.map((t) => [t, { busy: 0, verb: null, target: null }]));

function newProject(id, now) {
  return { id, name: null, cwd: null, createdAt: now, updatedAt: now, buildings: [], crew: crewIdle(), seq: 0 };
}

function newBuilding(project, now, opened = 'prompt') {
  return {
    no: project.buildings.length ? project.buildings[project.buildings.length - 1].no + 1 : 1,
    status: 'construct',
    opened,
    startedAt: now,
    endedAt: null,
    elements: [],
    tokens: null,
  };
}

export function createSite() {
  return { latest: null, projects: {} };
}

const openBuilding = (p) => {
  const b = p.buildings[p.buildings.length - 1];
  return b && b.status === 'construct' ? b : null;
};

function ensureBuilding(p, now) {
  let b = openBuilding(p);
  if (!b) {
    // Work arrived without a prompt (resumed session, server started late): open a building anyway.
    b = newBuilding(p, now, 'resume');
    p.buildings.push(b);
  }
  return b;
}

function recomputeCrew(p) {
  p.crew = crewIdle();
  const b = openBuilding(p);
  if (!b) return;
  for (const el of b.elements) {
    if (el.status !== 'active') continue;
    const c = p.crew[el.trade];
    c.busy += 1;
    c.verb = el.verb;
    c.target = el.target;
  }
}

function closeBuilding(b, now, status) {
  for (const el of b.elements) {
    if (el.status === 'active') {
      el.status = 'done';
      el.endedAt = now;
    }
  }
  b.status = status;
  b.endedAt = now;
}

function findActive(b, ev) {
  if (ev.toolUseId) {
    const hit = b.elements.find((e) => e.toolUseId === ev.toolUseId);
    if (hit) return hit;
  }
  // Older Claude Code builds may not send tool_use_id: take the oldest active call of the same tool and key.
  return b.elements.find((e) => e.status === 'active' && e.tool === ev.tool && e.key === ev.key)
    ?? b.elements.find((e) => e.status === 'active' && e.tool === ev.tool);
}

function repairEarlier(p, el, now) {
  for (const b of p.buildings) {
    for (const d of b.elements) {
      if (d.status === 'defect' && d !== el && d.key === el.key && d.trade === el.trade) {
        d.status = 'repaired';
        d.repairedAt = now;
        d.repairedBy = { building: p.buildings.at(-1).no, element: el.n };
      }
    }
  }
}

export function apply(site, ev, rules, now = Date.now()) {
  if (!ev) return false;
  const p = site.projects[ev.session] ?? newProject(ev.session, now);
  if (ev.cwd) {
    p.cwd = ev.cwd;
    p.name = ev.cwd.split(/[\\/]+/).filter(Boolean).at(-1) ?? ev.cwd;
  }

  switch (ev.kind) {
    case 'SessionStart':
      break;
    case 'UserPromptSubmit': {
      const b = openBuilding(p);
      if (b) closeBuilding(b, now, 'stopped');
      p.buildings.push(newBuilding(p, now));
      break;
    }
    case 'PreToolUse': {
      const b = ensureBuilding(p, now);
      const { trade, verb } = classify(rules, ev.tool, ev.command);
      p.seq += 1;
      b.elements.push({
        n: b.elements.length + 1,
        toolUseId: ev.toolUseId ?? null,
        tool: ev.tool,
        trade,
        verb,
        target: ev.target ?? null,
        key: ev.key ?? ev.tool,
        status: 'active',
        startedAt: now,
        endedAt: null,
      });
      if (b.elements.length > LIMITS.elements) b.elements.splice(0, b.elements.length - LIMITS.elements);
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const b = ensureBuilding(p, now);
      const el = findActive(b, ev);
      if (!el) break;
      el.endedAt = now;
      if (ev.kind === 'PostToolUse') {
        el.status = 'done';
        repairEarlier(p, el, now);
      } else {
        el.status = 'defect';
        if (ev.interrupted) el.interrupted = true;
      }
      break;
    }
    case 'SubagentStop':
      break;
    case 'Stop': {
      const b = openBuilding(p);
      if (b) closeBuilding(b, now, 'handover');
      break;
    }
    case 'SessionEnd': {
      const b = openBuilding(p);
      if (b) closeBuilding(b, now, 'stopped');
      break;
    }
    default:
      return false;
  }

  if (p.buildings.length > LIMITS.buildings) p.buildings.splice(0, p.buildings.length - LIMITS.buildings);
  recomputeCrew(p);
  p.updatedAt = now;
  site.projects[p.id] = p;
  site.latest = p.id;
  pruneProjects(site);
  return true;
}

export function pruneProjects(site, keep = LIMITS.projects) {
  const ids = Object.keys(site.projects);
  if (ids.length <= keep) return;
  ids.sort((a, b) => site.projects[b].updatedAt - site.projects[a].updatedAt);
  for (const id of ids.slice(keep)) delete site.projects[id];
}

// A call that never reported back (interrupted turn, crashed hook) is closed after a while.
export function expireStale(site, now = Date.now()) {
  let changed = false;
  for (const p of Object.values(site.projects)) {
    for (const b of p.buildings) {
      for (const el of b.elements) {
        if (el.status === 'active' && now - el.startedAt > LIMITS.staleMs) {
          el.status = 'done';
          el.stale = true;
          el.endedAt = now;
          changed = true;
        }
      }
    }
    if (changed) recomputeCrew(p);
  }
  return changed;
}

export function stats(building) {
  const s = { total: 0, active: 0, done: 0, defect: 0, repaired: 0, byTrade: Object.fromEntries(TRADE_IDS.map((t) => [t, 0])) };
  for (const el of building.elements) {
    s.total += 1;
    s[el.status] += 1;
    s.byTrade[el.trade] += 1;
  }
  return s;
}

// What the browser gets: no matching keys, no tool_use_ids.
export function publicView(site, projectId) {
  const projects = {};
  for (const [id, p] of Object.entries(site.projects)) {
    projects[id] = {
      id,
      name: p.name,
      cwd: p.cwd,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      crew: p.crew,
      tokens: p.tokens ?? null,
      buildings: p.buildings.map((b) => ({
        ...b,
        stats: stats(b),
        elements: b.elements.map(({ key, toolUseId, ...rest }) => rest),
      })),
    };
  }
  const current = projectId && projects[projectId] ? projectId : site.latest;
  return { current, projects };
}
