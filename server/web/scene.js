// The construction-site scene. Pure view: it receives a project snapshot and makes the 3D world match it.
// Everything is built from primitives; no model files.
import * as THREE from './vendor/three.module.js';

const PLOT = 9; // distance between plots
const COLS = 4;
const CELL = 1.9; // block footprint
const LAYER = 1.05; // block height
const OFFICE = new THREE.Vector3(-24, 0, 3);

const C = {
  ground: 0xc9b48f,
  pad: 0x9d9a94,
  concrete: 0xc4c0b8,
  defect: 0xd2452f,
  crack: 0x2a1a16,
  repaired: 0x9fa3a6,
  patch: 0xf2c230,
  ghost: 0xffd24a,
  stake: 0xf2994a,
  scaffold: 0x9b51e0,
  roof: 0x5a6b7a,
  flag: 0x27ae60,
  fence: 0x2f80ed,
  office: 0x2c6fb7,
};

const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;

export function plotPosition(index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return new THREE.Vector3((col - (COLS - 1) / 2) * PLOT, 0, -row * PLOT);
}

function textSprite(text, { bg = '#1d2330', fg = '#ffffff', size = 44, pad = 18 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `600 ${size}px "Noto Sans Thai", Sarabun, "Leelawadee UI", Tahoma, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = size + pad * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(w / 90, h / 90, 1);
  return sprite;
}

function box(w, h, d, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- static site furniture ----------

function buildGround(scene) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: C.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(400, 200, 0xb39e78, 0xbfa984);
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);
}

function buildOffice(scene) {
  const g = new THREE.Group();
  const body = box(6, 2.6, 2.6, C.office);
  body.position.y = 1.3;
  g.add(body);
  for (let i = -2; i <= 2; i++) {
    const rib = box(0.08, 2.6, 2.7, 0x24578f);
    rib.position.set(i * 1.2, 1.3, 0);
    g.add(rib);
  }
  const door = box(0.9, 1.9, 0.05, 0xe8e8e8);
  door.position.set(1.8, 0.95, 1.33);
  g.add(door);
  const win = box(1.6, 0.8, 0.05, 0x9fd3ff, { emissive: 0x2a5577, emissiveIntensity: 0.4 });
  win.position.set(-1, 1.6, 1.33);
  g.add(win);
  const sign = textSprite('สำนักงานสนาม', { bg: '#f2c230', fg: '#1d2330', size: 40 });
  sign.position.set(0, 3.4, 0);
  g.add(sign);
  g.position.copy(OFFICE);
  g.rotation.y = Math.PI / 2.4;
  scene.add(g);
  return g;
}

function buildCrane(scene) {
  const crane = new THREE.Group();
  const yellow = 0xf2c230;
  const base = box(2.2, 0.6, 2.2, 0x555555);
  base.position.y = 0.3;
  crane.add(base);
  const mast = box(0.7, 16, 0.7, yellow, { wireframe: false });
  mast.position.y = 8.3;
  crane.add(mast);
  const top = new THREE.Group();
  top.position.y = 16.3;
  const jib = box(22, 0.5, 0.6, yellow);
  jib.position.x = 8;
  top.add(jib);
  const counter = box(2.4, 1.1, 1.4, 0x666666);
  counter.position.set(-4.4, -0.3, 0);
  top.add(counter);
  const cab = box(1.4, 1.2, 1.3, 0xf5f5f5);
  cab.position.set(0.2, -0.9, 0.9);
  top.add(cab);
  const trolley = new THREE.Group();
  const cable = box(0.05, 1, 0.05, 0x222222);
  cable.castShadow = false;
  const hook = box(0.5, 0.5, 0.5, 0xd2452f);
  trolley.add(cable, hook);
  top.add(trolley);
  crane.add(top);
  // stands in the gap between plots so the jib can reach the first two rows
  crane.position.set(0, 0, -PLOT / 2);
  scene.add(crane);
  return { group: crane, top, trolley, cable, hook, reach: 6, drop: 10, targetYaw: 0, targetReach: 6, targetDrop: 10 };
}

function buildFence(scene) {
  const mat = new THREE.MeshStandardMaterial({ color: C.fence, roughness: 0.7 });
  const g = new THREE.Group();
  const span = 70;
  for (let i = 0; i <= span; i += 3) {
    for (const [x, z] of [
      [-span / 2 + i, 12],
      [-span / 2 + i, -span + 12],
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.15), mat);
      post.position.set(x, 0.8, z);
      g.add(post);
    }
  }
  for (const z of [12, -span + 12]) {
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(span, 1.4, 0.06), new THREE.MeshStandardMaterial({ color: 0x2f80ed, transparent: true, opacity: 0.55 }));
    sheet.position.set(0, 0.85, z);
    g.add(sheet);
  }
  scene.add(g);
}

// ---------- workers ----------

function makeWorker(color) {
  const g = new THREE.Group();
  const skin = 0xd9a77c;
  const legs = box(0.5, 0.8, 0.3, 0x30394a);
  legs.position.y = 0.4;
  const body = box(0.62, 0.75, 0.38, 0xff8a1f);
  body.position.y = 1.18;
  const stripe = box(0.64, 0.08, 0.4, 0xf4f4f4);
  stripe.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), new THREE.MeshStandardMaterial({ color: skin }));
  head.position.y = 1.8;
  head.castShadow = true;
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  hat.position.y = 1.86;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 16), hat.material);
  brim.position.y = 1.86;
  const tool = box(0.08, 0.55, 0.08, 0x444444);
  tool.position.set(0.42, 1.1, 0.1);
  g.add(legs, body, stripe, head, hat, brim, tool);
  return { group: g, body, tool };
}

// ---------- the scene class ----------

export class SiteScene {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbfd9ee);
    this.scene.fog = new THREE.Fog(0xbfd9ee, 70, 170);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7350, 1.2);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    sun.position.set(25, 40, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 140 });
    this.scene.add(sun, sun.target);
    this.sun = sun;

    buildGround(this.scene);
    buildFence(this.scene);
    this.office = buildOffice(this.scene);
    this.crane = buildCrane(this.scene);

    this.trades = {};
    this.workers = {};
    this.buildings = new Map(); // building no -> { group, items: Map(n -> item), plaque, index, status }
    this.anims = [];
    this.project = null;
    this.projectId = null;

    // camera orbit state
    this.orbit = { yaw: 0.55, pitch: 0.6, dist: 36, target: new THREE.Vector3(0, 0, -4) };
    this.focus = new THREE.Vector3(0, 0, -4);
    this.follow = true;
    this.lastManual = 0;
    this.bindControls();

    this.bubbles = {};
    this.last = performance.now();
    this.elapsed = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setTrades(trades) {
    this.trades = trades;
    let i = 0;
    for (const [id, t] of Object.entries(trades)) {
      if (this.workers[id]) continue;
      const w = makeWorker(new THREE.Color(t.color));
      const home = OFFICE.clone().add(new THREE.Vector3(-2.5 + i * 1.6, 0, 3));
      w.group.position.copy(home);
      w.home = home;
      w.goal = home.clone();
      w.id = id;
      this.scene.add(w.group);
      this.workers[id] = w;
      const el = document.createElement('div');
      el.className = 'bubble';
      el.style.setProperty('--trade', t.color);
      el.innerHTML = `<b>${t.label}</b><span></span>`;
      this.overlay.appendChild(el);
      this.bubbles[id] = el;
      i++;
    }
    this.officeBubble = this.officeBubble ?? Object.assign(document.createElement('div'), { className: 'bubble office' });
    this.overlay.appendChild(this.officeBubble);
  }

  // ---- controls ----
  bindControls() {
    let drag = null;
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: this.orbit.yaw, pitch: this.orbit.pitch, pan: e.button === 2 || e.shiftKey, target: this.orbit.target.clone() };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      this.lastManual = performance.now();
      if (drag.pan) {
        const s = this.orbit.dist / 600;
        const right = new THREE.Vector3(Math.cos(this.orbit.yaw), 0, -Math.sin(this.orbit.yaw));
        const fwd = new THREE.Vector3(Math.sin(this.orbit.yaw), 0, Math.cos(this.orbit.yaw));
        this.orbit.target.copy(drag.target).addScaledVector(right, -dx * s).addScaledVector(fwd, -dy * s);
        this.focus.copy(this.orbit.target);
        this.setFollow(false);
      } else {
        this.orbit.yaw = drag.yaw - dx * 0.006;
        this.orbit.pitch = Math.min(1.35, Math.max(0.18, drag.pitch + dy * 0.004));
      }
    });
    el.addEventListener('pointerup', () => (drag = null));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.dist = Math.min(110, Math.max(10, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
  }

  setFollow(on) {
    this.follow = on;
    this.onFollowChange?.(on);
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- model → world ----
  clear() {
    for (const b of this.buildings.values()) {
      this.scene.remove(b.group);
      b.plaque.remove();
    }
    this.buildings.clear();
    this.anims = [];
  }

  update(project) {
    if (!project) {
      this.clear();
      this.project = null;
      this.projectId = null;
      return;
    }
    if (project.id !== this.projectId) {
      this.clear();
      this.projectId = project.id;
    }
    this.project = project;
    const seen = new Set();
    project.buildings.forEach((b, index) => {
      seen.add(b.no);
      let rec = this.buildings.get(b.no);
      if (!rec) rec = this.addBuilding(b, index);
      if (rec.index !== index) {
        rec.index = index;
        rec.group.position.copy(plotPosition(index));
      }
      this.syncBuilding(rec, b);
    });
    for (const [no, rec] of this.buildings) {
      if (!seen.has(no)) {
        this.scene.remove(rec.group);
        rec.plaque.remove();
        this.buildings.delete(no);
      }
    }
    const current = project.buildings.at(-1);
    if (current) this.focus.copy(plotPosition(project.buildings.length - 1));
  }

  addBuilding(b, index) {
    const group = new THREE.Group();
    group.position.copy(plotPosition(index));
    const pad = box(6.4, 0.2, 6.4, C.pad);
    pad.position.y = 0.1;
    group.add(pad);
    const board = box(3.2, 1.3, 0.1, 0xffffff);
    board.position.set(0, 1.25, 4.2);
    const legL = box(0.1, 0.9, 0.1, 0x444444);
    legL.position.set(-1.4, 0.45, 4.2);
    const legR = legL.clone();
    legR.position.x = 1.4;
    group.add(board, legL, legR);
    this.scene.add(group);
    this.drop(group, 0, 0.6);
    const plaque = document.createElement('div');
    plaque.className = 'plaque';
    this.overlay.appendChild(plaque);
    const rec = { group, items: new Map(), plaque, index, status: null, counts: { survey: 0, build: 0, qc: 0, sub: 0 }, roof: null };
    this.buildings.set(b.no, rec);
    return rec;
  }

  // Each trade has its own place on the plot.
  slotFor(rec, trade) {
    const k = rec.counts[trade]++;
    if (trade === 'build') {
      const layer = Math.floor(k / 4);
      const cell = k % 4;
      const x = (cell % 2 ? 1 : -1) * (CELL / 2 + 0.02);
      const z = (cell < 2 ? -1 : 1) * (CELL / 2 + 0.02);
      return new THREE.Vector3(x, 0.2 + LAYER / 2 + layer * LAYER, z);
    }
    if (trade === 'survey') {
      // stakes walk around the pad edge
      const per = 12;
      const ring = Math.floor(k / per);
      const t = (k % per) / per;
      const r = 3.0 + ring * 0.5;
      const side = Math.floor(t * 4);
      const f = (t * 4) % 1;
      const pts = [
        [-r + 2 * r * f, -r],
        [r, -r + 2 * r * f],
        [r - 2 * r * f, r],
        [-r, r - 2 * r * f],
      ][side];
      return new THREE.Vector3(pts[0], 0, pts[1]);
    }
    if (trade === 'qc') {
      const row = Math.floor(k / 6);
      return new THREE.Vector3(-1.25 + (k % 6) * 0.5, 1.55 - row * 0.45, 4.27);
    }
    // sub: scaffold bays along the right side
    const layer = Math.floor(k / 3);
    return new THREE.Vector3(3.55, 0.2 + 0.6 + layer * 1.2, -1.9 + (k % 3) * 1.9);
  }

  makeItem(trade) {
    if (trade === 'build') {
      const g = new THREE.Group();
      const block = box(CELL, LAYER, CELL, C.concrete);
      const crack = box(0.06, LAYER * 0.8, CELL + 0.02, C.crack);
      crack.rotation.y = 0.5;
      crack.visible = false;
      const patch = box(CELL + 0.04, 0.16, CELL + 0.04, C.patch);
      patch.visible = false;
      g.add(block, crack, patch);
      return { g, main: block, crack, patch };
    }
    if (trade === 'survey') {
      const g = new THREE.Group();
      const pole = box(0.1, 1.1, 0.1, 0xe9d6b0);
      pole.position.y = 0.55;
      const tip = box(0.18, 0.22, 0.18, C.stake);
      tip.position.y = 1.15;
      g.add(pole, tip);
      return { g, main: tip };
    }
    if (trade === 'qc') {
      const g = new THREE.Group();
      const tag = box(0.4, 0.35, 0.04, 0x27ae60);
      g.add(tag);
      return { g, main: tag };
    }
    const g = new THREE.Group();
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 1.2, 1.9)), new THREE.LineBasicMaterial({ color: C.scaffold }));
    const plank = box(0.9, 0.06, 1.9, 0x8b6b45);
    plank.position.y = -0.6;
    g.add(frame, plank);
    return { g, main: plank, frame };
  }

  syncBuilding(rec, b) {
    for (const el of b.elements) {
      let item = rec.items.get(el.n);
      if (!item) {
        item = this.makeItem(el.trade);
        item.trade = el.trade;
        item.pos = this.slotFor(rec, el.trade);
        item.g.position.copy(item.pos);
        rec.group.add(item.g);
        rec.items.set(el.n, item);
        if (el.trade === 'build') this.craneTo(rec, item.pos);
        this.drop(item.g, item.pos.y, el.trade === 'build' ? 0.9 : 0.35, el.trade === 'build' ? 6 : 1.2);
      }
      if (item.status !== el.status) this.paint(item, el.status);
    }
    if (rec.status !== b.status) {
      rec.status = b.status;
      if (b.status === 'handover') this.topOut(rec);
      if (b.status === 'stopped') this.barrier(rec);
    }
    const s = b.stats;
    const label = { construct: 'กำลังก่อสร้าง', handover: 'ส่งมอบแล้ว', stopped: 'หยุดงาน' }[b.status];
    rec.plaque.innerHTML = `<b>อาคาร ${b.no}</b> ${label}<small>${s.total} ชิ้น${s.defect ? ` · <em>บกพร่อง ${s.defect}</em>` : ''}${s.repaired ? ` · แก้แล้ว ${s.repaired}` : ''}</small>`;
    rec.plaque.dataset.status = b.status;
  }

  paint(item, status) {
    item.status = status;
    const m = item.main.material;
    m.transparent = status === 'active';
    m.opacity = status === 'active' ? 0.55 : 1;
    m.emissive?.setHex(status === 'active' ? 0x6b5200 : 0x000000);
    if (item.crack) item.crack.visible = status === 'defect';
    if (item.patch) item.patch.visible = status === 'repaired';
    const byTrade = {
      build: { active: C.ghost, done: C.concrete, defect: C.defect, repaired: C.repaired },
      survey: { active: C.ghost, done: C.stake, defect: C.defect, repaired: C.patch },
      qc: { active: C.ghost, done: 0x27ae60, defect: C.defect, repaired: C.patch },
      sub: { active: C.ghost, done: 0x8b6b45, defect: C.defect, repaired: C.patch },
    };
    m.color.setHex(byTrade[item.trade][status]);
    if (item.frame) item.frame.material.color.setHex(status === 'defect' ? C.defect : C.scaffold);
  }

  topOut(rec) {
    const layers = Math.max(1, Math.ceil(rec.counts.build / 4));
    const h = rec.counts.build ? 0.2 + layers * LAYER : 0.2;
    const roof = box(CELL * 2 + 0.6, 0.25, CELL * 2 + 0.6, C.roof);
    roof.position.y = h + 0.12;
    const pole = box(0.08, 2.2, 0.08, 0xdddddd);
    pole.position.set(1.6, h + 1.3, 1.6);
    const flag = box(0.9, 0.55, 0.03, C.flag, { emissive: 0x0b3d1f, emissiveIntensity: 0.5 });
    flag.position.set(2.07, h + 2.1, 1.6);
    rec.group.add(roof, pole, flag);
    rec.flag = flag;
    rec.roof = roof;
    this.drop(roof, roof.position.y, 0.8, 4);
  }

  barrier(rec) {
    for (let i = 0; i < 4; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 12), new THREE.MeshStandardMaterial({ color: 0xff6a00 }));
      cone.position.set(-2.4 + i * 1.6, 0.55, 3.6);
      cone.castShadow = true;
      rec.group.add(cone);
    }
  }

  drop(obj, y, duration, height = 3) {
    obj.position.y = y + height;
    this.anims.push({ obj, from: y + height, to: y, t: 0, duration });
  }

  craneTo(rec, local) {
    const world = rec.group.position.clone().add(local);
    const base = this.crane.group.position;
    const dx = world.x - base.x;
    const dz = world.z - base.z;
    this.crane.targetYaw = Math.atan2(-dz, dx);
    this.crane.targetReach = Math.min(18, Math.max(3, Math.hypot(dx, dz)));
    this.crane.targetDrop = 16.3 - (local.y + 0.8);
  }

  workSpot(trade, index) {
    const p = plotPosition(index);
    const off = { survey: [-4.2, 0, 2.6], build: [-1.5, 0, 3.4], qc: [1.9, 0, 5.0], sub: [4.6, 0, 1.2] }[trade] ?? [0, 0, 4];
    return p.add(new THREE.Vector3(...off));
  }

  // ---- per frame ----
  frame() {
    const nowMs = performance.now();
    const dt = Math.min((nowMs - this.last) / 1000, 0.05);
    this.last = nowMs;
    this.elapsed += dt;
    const t = this.elapsed;

    this.anims = this.anims.filter((a) => {
      a.t += dt / a.duration;
      a.obj.position.y = lerp(a.from, a.to, easeOut(Math.min(1, a.t)));
      return a.t < 1;
    });

    // pulse active elements
    for (const rec of this.buildings.values()) {
      for (const item of rec.items.values()) {
        if (item.status === 'active') item.main.material.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 6));
        else if (item.status === 'defect' && item.main.material.emissive) item.main.material.emissive.setHex(Math.sin(t * 4) > 0 ? 0x4a0d05 : 0x000000);
      }
      if (rec.flag) rec.flag.rotation.y = Math.sin(t * 3 + rec.index) * 0.25;
    }

    // crane
    const cr = this.crane;
    let d = cr.targetYaw - cr.top.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    cr.top.rotation.y += d * Math.min(1, dt * 1.6);
    cr.reach = lerp(cr.reach, cr.targetReach, Math.min(1, dt * 1.8));
    cr.drop = lerp(cr.drop, cr.targetDrop, Math.min(1, dt * 1.5));
    cr.trolley.position.x = cr.reach;
    cr.cable.scale.y = cr.drop;
    cr.cable.position.y = -cr.drop / 2;
    cr.hook.position.y = -cr.drop;

    // workers
    const project = this.project;
    const current = project?.buildings.at(-1);
    const working = current && current.status === 'construct';
    for (const [id, w] of Object.entries(this.workers)) {
      const crew = project?.crew?.[id];
      const busy = working && crew?.busy > 0;
      // Tool calls are often shorter than the walk, so a worker stays on the plot for a while after a task.
      if (busy) w.lastBusy = t;
      const onSite = working && w.lastBusy !== undefined && t - w.lastBusy < 8;
      w.goal = busy || onSite ? this.workSpot(id, project.buildings.length - 1) : w.home;
      const pos = w.group.position;
      const to = w.goal.clone().sub(pos);
      to.y = 0;
      const dist = to.length();
      if (dist > 0.15) {
        const step = Math.min(dist, dt * 9);
        pos.addScaledVector(to.normalize(), step);
        w.group.rotation.y = Math.atan2(to.x, to.z);
        w.group.position.y = Math.abs(Math.sin(t * 14)) * 0.12;
        w.tool.rotation.x = 0;
      } else {
        w.group.position.y = 0;
        if (busy || onSite) {
          const center = plotPosition(project.buildings.length - 1);
          w.group.rotation.y = Math.atan2(center.x - pos.x, center.z - pos.z);
        }
        w.tool.rotation.x = busy ? Math.sin(t * 9) * 0.9 : 0;
      }
      const bubble = this.bubbles[id];
      if (bubble) {
        bubble.classList.toggle('on', !!busy);
        if (busy) {
          const extra = crew.busy > 1 ? ` ×${crew.busy}` : '';
          bubble.querySelector('span').textContent = `${crew.verb ?? ''}${extra}${crew.target ? ` · ${crew.target}` : ''}`;
        }
        this.place(bubble, pos.clone().add(new THREE.Vector3(0, 2.6, 0)));
      }
    }

    // office: planning when a building is open but nobody is on a task
    if (this.officeBubble) {
      const planning = working && !Object.values(project.crew).some((c) => c.busy > 0);
      this.officeBubble.classList.toggle('on', !!planning);
      this.officeBubble.textContent = 'วางแผน / เขียนคำตอบ…';
      this.place(this.officeBubble, OFFICE.clone().add(new THREE.Vector3(0, 4.4, 0)));
    }

    for (const rec of this.buildings.values()) {
      const layers = Math.ceil(rec.counts.build / 4);
      this.place(rec.plaque, rec.group.position.clone().add(new THREE.Vector3(0, 1.2 + layers * LAYER + (rec.roof ? 1 : 0) + 1.6, 0)));
    }

    // camera
    if (this.follow) this.orbit.target.lerp(this.focus, Math.min(1, dt * 1.5));
    const o = this.orbit;
    const cam = this.camera;
    cam.position.set(
      o.target.x + o.dist * Math.cos(o.pitch) * Math.sin(o.yaw),
      o.target.y + o.dist * Math.sin(o.pitch),
      o.target.z + o.dist * Math.cos(o.pitch) * Math.cos(o.yaw),
    );
    cam.lookAt(o.target.x, o.target.y + 1.5, o.target.z);
    this.sun.position.set(o.target.x + 25, 40, o.target.z + 18);
    this.sun.target.position.copy(o.target);

    this.renderer.render(this.scene, cam);
  }

  place(el, world) {
    const v = world.clone().project(this.camera);
    const hidden = v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2;
    el.style.visibility = hidden ? 'hidden' : '';
    if (hidden) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
  }
}
