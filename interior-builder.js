import * as T from 'three';

/**
 * interior-builder.js: the room shown when a campus building is inspected, in the style of The Sims.
 *
 * - The floor plan is the outline of the building itself (footprintOf), scaled evenly to working size.
 * - Nothing in the room shows text or numbers; those are in the left/right panels. Furniture and moving
 *   people show how the building works, and each one stands for a record of dataConnector.getBuildingView().
 * - Clickable things carry userData.focus = {section, id}; the panels jump to that entry.
 * - Walls between the camera and the room drop to a low stub, also while the camera is rotated.
 */

const FLOOR_Y = 0.14, WALL_H = 3.2, STUB_H = 0.4, WALL_T = 0.22;
const MIN_W = 12, MIN_D = 9, MAX_ASPECT = 1.7;
const PRIORITY = {high: 0xef5350, medium: 0xffb020, low: 0x4fa3ff};
const STYLE = {
  hq: [0xf3ead9, 0xd9b98f], bank: [0xe7edf2, 0xcfd8df], documents: [0xe9f0e4, 0xd6bb94], project: [0xeceff1, 0xd3d8dc],
  schedule: [0xf5eeda, 0xdcc19a], ai: [0xe8e9f6, 0xcdd3e0], marketing: [0xf7e6e4, 0xe0c3a0]
};

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = list => {
    const out = [];
    for (const q of list) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return half(p).concat(half(p.reverse()));
}

/** Drops corners that barely bend (tessellation noise); real corners and curves stay. */
function simplify(points, eps) {
  const out = [...points];
  for (let i = 0; out.length > 4 && i < out.length;) {
    const a = out[(i + out.length - 1) % out.length], c = out[(i + 1) % out.length];
    const off = Math.abs(cross(a, c, out[i])) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1);
    if (off < eps) { out.splice(i, 1); i = Math.max(0, i - 1); } else i++;
  }
  return out;
}

/** Outline of an object seen from above: the convex hull [[x, z], ...] of its meshes, around the object's own position. */
export function footprintOf(object) {
  object.updateMatrixWorld(true);
  const origin = new T.Vector3().setFromMatrixPosition(object.matrixWorld), v = new T.Vector3(), points = [];
  object.traverse(m => {
    const pos = m.isMesh && m.geometry?.attributes?.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 3000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      points.push([v.x - origin.x, v.z - origin.z]);
    }
  });
  return points.length > 2 ? hull(points) : null;
}

/**
 * Room plan for a building outline (null: a plain width x depth box). The outline keeps its shape and is
 * scaled evenly until a MIN_W x MIN_D work area fits inside; an outline thinner than MAX_ASPECT is widened to it.
 * Returns {outline, hx, hz: half sizes of the work area, span: camera span that frames the room}.
 */
export function roomPlan(footprint, width = MIN_W, depth = MIN_D) {
  let pts = footprint?.length > 2 ? footprint : [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs);
  let bw = Math.max(...xs) - x0, bd = Math.max(...zs) - z0;
  if (!(bw > 0.01 && bd > 0.01)) return roomPlan(null);
  const sx = Math.max(1, bd / MAX_ASPECT / bw), sz = Math.max(1, bw / MAX_ASPECT / bd);
  pts = simplify(pts.map(([x, z]) => [(x - x0 - bw / 2) * sx, (z - z0 - bd / 2) * sz]), Math.max(bw * sx, bd * sz) * 0.006);
  bw *= sx; bd *= sz;
  const inside = (x, z) => pts.every((a, i) => cross(a, pts[(i + 1) % pts.length], [x, z]) >= -1e-6);
  let k = 1;
  while (k > 0.3 && ![[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([i, j]) => inside(i * bw * k / 2, j * bd * k / 2))) k -= 0.02;
  const s = Math.max(MIN_W / (bw * k), MIN_D / (bd * k));
  return {outline: pts.map(([x, z]) => [x * s, z * s]), hx: bw * k * s / 2, hz: bd * k * s / 2, span: (bw + bd) * s / Math.SQRT2 * 1.05};
}

export function buildInterior(view, plan = roomPlan()) {
  const g = new T.Group();
  g.name = `interior_${view.id}`;
  const {outline, hx, hz} = plan;
  const L = -hx, R = hx, B = -hz, F = hz;
  const anim = [];
  const mat = (color, o = {}) => new T.MeshStandardMaterial({color, roughness: 0.7, ...o});
  const glow = (color, k = 0.35) => mat(color, {emissive: color, emissiveIntensity: k});
  const [wallColor, floorColor] = STYLE[view.type] || [0xe9e6df, 0xd0cbc0];
  const M = {
    wall: mat(wallColor, {roughness: 0.9}), plinth: mat(0x4a4038, {roughness: 1}),
    wood: mat(0xc99862, {roughness: 0.55}), woodDark: mat(0xa9773f, {roughness: 0.6}), white: mat(0xf8fafc),
    dark: mat(0x1e293b), pc: mat(0x0f172a, {roughness: 0.4}), chair: mat(0x475569),
    screenOn: mat(0x0b3b33, {emissive: 0x34e0b0, emissiveIntensity: 1.1, roughness: 0.15}), screenOff: mat(0x1f2933, {roughness: 0.4}),
    active: mat(0x1f9d8f), idle: mat(0x9aa7b4), staff: mat(0x3b6fb6), skin: mat(0xf6cfa0, {roughness: 0.8}),
    hair: mat(0x3a2a20, {roughness: 0.9}), trouser: mat(0x334155),
    paper: glow(0xf7941d, 0.3), filed: mat(0xb8c0c8), ok: mat(0x4cc27a), warn: glow(0xf7941d, 0.25), teal: mat(0x1f9d8f), unknown: mat(0xaab4bf),
    cabinet: mat(0x2c8f88, {roughness: 0.6}), safe: mat(0x7d8b9a, {roughness: 0.5, metalness: 0.2}), steel: mat(0x94a3b8, {roughness: 0.35, metalness: 0.5}),
    gold: mat(0xf2c230, {roughness: 0.3, metalness: 0.6, emissive: 0x8a6a00, emissiveIntensity: 0.25}),
    crateIn: mat(0x4cc27a), crateOut: mat(0xf7941d), block: mat(0xf7941d), cone: mat(0xff6b2c), leaf: mat(0x4f9d5d), pot: mat(0xb5714a),
    padDone: mat(0x7fdc9e), padNow: glow(0xffd84a, 0.4), padTodo: mat(0xf8fafc, {transparent: true, opacity: 0.5}),
    led: glow(0x34e0b0, 1.2)
  };
  const box = (parent, sx, sy, sz, material, x, y, z, focus) => {
    const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    if (focus) m.userData.focus = focus;
    parent.add(m);
    return m;
  };
  const cyl = (parent, r, h, material, x, y, z, seg = 20) => {
    const m = new T.Mesh(new T.CylinderGeometry(r, r, h, seg), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** A piece of furniture standing on the floor at (x, z), turned by rot. */
  const group = (x, z, rot = 0, focus) => {
    const o = new T.Group();
    o.position.set(x, FLOOR_Y, z); o.rotation.y = rot;
    if (focus) o.userData.focus = focus;
    g.add(o);
    return o;
  };
  /** Room position of a point given in a furniture group's own coordinates. */
  const local = (o, lx, lz) => {
    const c = Math.cos(o.rotation.y), s = Math.sin(o.rotation.y);
    return [o.position.x + lx * c + lz * s, o.position.z - lx * s + lz * c];
  };

  // ---- shell: floor in the building's outline, walls that drop on the camera side ----
  const tile = document.createElement('canvas');
  tile.width = tile.height = 64;
  const tc = tile.getContext('2d');
  tc.fillStyle = '#fff'; tc.fillRect(0, 0, 64, 64);
  tc.strokeStyle = 'rgba(0,0,0,.13)'; tc.lineWidth = 2; tc.strokeRect(0, 0, 64, 64);
  const tiles = new T.CanvasTexture(tile);
  tiles.wrapS = tiles.wrapT = T.RepeatWrapping; tiles.repeat.set(0.8, 0.8); tiles.colorSpace = T.SRGBColorSpace;
  const slab = new T.Mesh(
    new T.ExtrudeGeometry(new T.Shape(outline.map(([x, z]) => new T.Vector2(x, -z))), {depth: 0.7, bevelEnabled: false}),
    [mat(floorColor, {map: tiles, roughness: 0.65}), M.plinth]);
  slab.rotation.x = -Math.PI / 2; slab.position.y = FLOOR_Y - 0.7; slab.receiveShadow = true;
  g.add(slab);

  const walls = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const n = [dz / len, -dx / len];
    const mesh = box(g, len + WALL_T, 1, WALL_T, M.wall, (a[0] + b[0]) / 2 + n[0] * WALL_T / 2, 0, (a[1] + b[1]) / 2 + n[1] * WALL_T / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    return {mesh, n, len, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], h: 0};
  });
  const eye = new T.Vector3();
  anim.push((t, camera) => {
    if (camera) eye.copy(camera.position).sub(g.position); else eye.set(1, 1, 1);
    const k = Math.hypot(eye.x, eye.z) || 1;
    for (const w of walls) {
      const target = (w.n[0] * eye.x + w.n[1] * eye.z) / k > 0.05 ? STUB_H : WALL_H;
      w.h = w.h ? w.h + (target - w.h) * 0.2 : target;
      w.mesh.scale.y = w.h; w.mesh.position.y = FLOOR_Y + w.h / 2;
    }
  });

  // The door is on the longest wall facing the campus front (+z); people come and go through it.
  const front = walls.filter(w => w.n[1] > 0.5).sort((a, b) => b.len - a.len)[0] || walls[0];
  const along = [-front.n[1], front.n[0]];
  const door = [front.mid[0] - front.n[0] * 0.9, front.mid[1] - front.n[1] * 0.9];
  const doorRot = -Math.atan2(along[1], along[0]);
  const dg = group(front.mid[0], front.mid[1], doorRot);
  box(dg, 1.7, 0.03, 1.0, mat(0x7a4b3a), 0, 0.015, -0.55);
  for (const x of [-0.95, 0.95]) box(dg, 0.14, 2.3, 0.14, M.woodDark, x, 1.15, 0.1);
  box(dg, 2.04, 0.14, 0.14, M.woodDark, 0, 2.3, 0.1);
  /** Point near the door: `side` along the wall, `inward` into the room. */
  const byDoor = (side, inward = 0.9) => [front.mid[0] + along[0] * side - front.n[0] * inward, front.mid[1] + along[1] * side - front.n[1] * inward];

  // ---- people ----
  function person(shirt, focus) {
    const p = new T.Group();
    const limb = (w, h, material, x, y) => {
      const pivot = new T.Group();
      pivot.position.set(x, y, 0);
      box(pivot, w, h, w, material, 0, -h / 2, 0);
      p.add(pivot);
      return pivot;
    };
    p.userData.legs = [limb(0.15, 0.5, M.trouser, -0.1, 0.5), limb(0.15, 0.5, M.trouser, 0.1, 0.5)];
    p.userData.arms = [limb(0.1, 0.44, shirt, -0.29, 1.06), limb(0.1, 0.44, shirt, 0.29, 1.06)];
    const torso = new T.Mesh(new T.CapsuleGeometry(0.2, 0.3, 4, 10), shirt);
    torso.position.y = 0.8; torso.castShadow = true;
    const head = new T.Mesh(new T.SphereGeometry(0.18, 14, 12), M.skin);
    head.position.y = 1.31; head.castShadow = true;
    const hair = new T.Mesh(new T.SphereGeometry(0.195, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), M.hair);
    hair.position.y = 1.33;
    p.add(torso, head, hair);
    if (focus) p.userData.focus = focus;
    g.add(p);
    return p;
  }

  /**
   * A person going round a loop of stops, forever. Each stop: {at: [x, z], wait: seconds there, look: [x, z],
   * sit, work (hands busy), carry: true/false from this stop on}. The position depends only on the clock,
   * so a rebuild after a data refresh does not make anyone jump.
   */
  function walker(shirt, stops, {speed = 1.5, phase = 0, cargo = M.crateIn, focus} = {}) {
    const p = person(shirt, focus);
    const item = box(p, 0.32, 0.24, 0.24, cargo, 0, 0.9, 0.3);
    const {legs, arms} = p.userData;
    let total = 0, carry = [...stops].reverse().find(s => s.carry != null)?.carry || false;
    const path = stops.map((s, i) => {
      const to = stops[(i + 1) % stops.length].at;
      if (s.carry != null) carry = s.carry;
      const leg = {s, to, start: total, wait: s.wait || 0, walk: Math.hypot(to[0] - s.at[0], to[1] - s.at[1]) / speed, carry};
      total += leg.wait + leg.walk;
      return leg;
    });
    total = total || 1;
    anim.push(t => {
      const tt = (t + phase) % total;
      let leg = path[0];
      for (const l of path) if (l.start <= tt) leg = l;
      const {s, to} = leg, u = tt - leg.start, moving = u >= leg.wait && leg.walk > 0;
      const f = moving ? (u - leg.wait) / leg.walk : 0;
      const swing = moving ? Math.sin(u * speed * 5) : 0, sit = !moving && s.sit;
      p.position.set(s.at[0] + (to[0] - s.at[0]) * f, FLOOR_Y + Math.abs(swing) * 0.03, s.at[1] + (to[1] - s.at[1]) * f);
      const face = moving ? to : s.look;
      if (face) p.rotation.y = Math.atan2(face[0] - p.position.x, face[1] - p.position.z);
      legs[0].rotation.x = sit ? -1.5 : swing * 0.6;
      legs[1].rotation.x = sit ? -1.5 : -swing * 0.6;
      const busy = !moving && s.work;
      arms[0].rotation.x = leg.carry ? -1.2 : busy ? -1.0 + Math.sin(t * 9 + phase) * 0.14 : -swing * 0.5;
      arms[1].rotation.x = leg.carry ? -1.2 : busy ? -1.0 - Math.sin(t * 9 + phase) * 0.14 : swing * 0.5;
      item.visible = leg.carry;
    });
    return p;
  }

  // ---- furniture ----
  /** Desk with a screen and a chair; returns where its worker sits, looks and steps out. */
  function desk(x, z, rot, {on = false, focus, load = 0} = {}) {
    const o = group(x, z, rot, focus);
    box(o, 1.7, 0.72, 0.8, M.wood, 0, 0.36, 0);
    box(o, 1.78, 0.08, 0.88, M.woodDark, 0, 0.76, 0);
    box(o, 0.08, 0.16, 0.08, M.pc, 0, 0.88, -0.2);
    const screen = box(o, 0.8, 0.48, 0.05, on ? M.screenOn.clone() : M.screenOff, 0, 1.18, -0.2);
    box(o, 0.46, 0.03, 0.16, M.pc, 0, 0.82, 0.14);
    box(o, 0.5, 0.08, 0.5, M.chair, 0, 0.44, 0.95);
    box(o, 0.5, 0.55, 0.08, M.chair, 0, 0.75, 1.22);
    box(o, 0.1, 0.4, 0.1, M.dark, 0, 0.2, 0.95);
    for (let i = 0; i < load; i++) box(o, 0.2, 0.2, 0.2, M.led, 0.62, 0.9 + i * 0.21, -0.18);
    if (on) anim.push(t => { screen.material.emissiveIntensity = 0.95 + Math.sin(t * 5 + x + z) * 0.25; });
    return {seat: local(o, 0, 0.95), look: local(o, 0, 0), out: local(o, 1.25, 1.0)};
  }

  /** One agent at a desk: active ones work and walk the given errand, the others sit in grey at a dark screen. */
  function agentAt(agent, x, z, rot, errand = [], i = 0) {
    const focus = {section: 'agent', id: agent.id};
    const d = desk(x, z, rot, {on: agent.active, focus, load: agent.active && agent.loadPct != null ? Math.max(1, Math.round(agent.loadPct / 25)) : 0});
    const sitting = {at: d.seat, look: d.look, sit: true, work: agent.active, wait: 5 + (i * 1.7) % 4, carry: false};
    if (!agent.active || !errand.length) return walker(agent.active ? M.active : M.idle, [sitting], {focus});
    return walker(M.active, [sitting, {at: d.out}, ...errand, {at: d.out}], {focus, phase: i * 3.1});
  }

  const sheet = (parent, x, y, z, material, focus) => {
    const s = box(parent, 0.36, 0.025, 0.48, material, x, y, z, focus);
    s.rotation.y = ((x * 7 + z * 3) % 3 - 1) * 0.12;
    return s;
  };
  const pulse = (material, base = 0.3) => anim.push(t => { material.emissiveIntensity = base + (Math.sin(t * 3) + 1) * 0.15; });
  pulse(M.paper);

  const plant = (x, z) => {
    const o = group(x, z);
    cyl(o, 0.26, 0.4, M.pot, 0, 0.2, 0, 12);
    const top = new T.Mesh(new T.SphereGeometry(0.5, 10, 8), M.leaf);
    top.position.y = 0.9; top.scale.y = 1.3; top.castShadow = true;
    o.add(top);
  };

  /** Stand by the door: one glowing sheet per open mission waiting for An in this building. */
  function inbox(missions) {
    const o = group(...byDoor(-2.2, 0.8), doorRot, {section: 'missions'});
    box(o, 1.3, 0.8, 0.6, M.woodDark, 0, 0.4, 0);
    missions.slice(0, 6).forEach((m, i) => sheet(o, -0.4 + (i % 3) * 0.4, 0.82 + Math.floor(i / 3) * 0.03, i < 3 ? -0.04 : 0.06, M.paper, {section: 'mission', id: m.id}));
  }

  /** Room with nothing to show: no approved sketch for this building, or no data for it. */
  function empty() {
    for (const [x, z] of [[-1.2, 0], [0, 0.6], [1.2, 0]]) {
      const cone = new T.Mesh(new T.ConeGeometry(0.22, 0.6, 12), M.cone);
      cone.position.set(x, FLOOR_Y + 0.3, z); cone.castShadow = true;
      g.add(cone);
    }
  }

  const rooms = {
    // Missions come in at the mission desk and are carried to the campus model, where every running project is a block.
    hq() {
      const {open, done} = view.allMissions;
      const md = group(L + 2.3, B + 1.4, 0, {section: 'missions'});
      box(md, 3.4, 0.76, 1.1, M.wood, 0, 0.38, 0);
      open.slice(0, 12).forEach((m, i) => sheet(md, -1.4 + (i % 6) * 0.42, 0.78 + Math.floor(i / 6) * 0.03, i < 6 ? -0.2 : 0.22, M.paper, {section: 'mission', id: m.id}));
      done.slice(0, 8).forEach((m, i) => box(md, 0.36, 0.03, 0.48, M.filed, 1.4, 0.78 + i * 0.032, 0));

      const ps = view.projects, cols = Math.max(1, Math.ceil(Math.sqrt(ps.length))), tw = 3.4;
      const table = group(1.6, 1.0, 0, {section: 'projects'});
      box(table, tw + 0.3, 0.5, tw + 0.3, M.woodDark, 0, 0.25, 0);
      box(table, tw, 0.08, tw, mat(0x9ccf8b), 0, 0.54, 0);
      ps.slice(0, 36).forEach((p, i) => {
        const cell = tw / cols, h = 0.2 + (p.progress ?? 0) / 100 * 1.3;
        box(table, cell * 0.6, h, cell * 0.6, M.block, -tw / 2 + cell * (i % cols + 0.5), 0.58 + h / 2, -tw / 2 + cell * (Math.floor(i / cols) + 0.5), {section: 'project', id: p.id});
      });

      const atModel = [{at: [-0.7, 1.0], look: [1.6, 1.0], wait: 2.5, work: true}];
      view.agents.slice(0, 3).forEach((a, i) => agentAt(a, 0.4 + i * 2.3, B + 1.3, 0, atModel, i));
      const runners = view.connected ? Math.min(3, Math.ceil(open.length / 4)) : 0;
      for (let i = 0; i < runners; i++) {
        walker(M.staff, [
          {at: [L + 1.6 + i * 0.9, B + 2.6], look: [L + 1.6 + i * 0.9, B + 1.4], wait: 1.5, carry: true},
          {at: [1.6 - 0.8 + i * 0.8, 3.4], look: [1.6, 1.0], wait: 2, carry: false}
        ], {phase: i * 3.7, cargo: M.paper});
      }
      plant(L + 0.7, F - 0.7); plant(R - 0.6, B + 3.4);
    },

    // Money in is carried from the door to the vault, money out from the vault to the door.
    bank() {
      const f = view.finance;
      const vault = group(0.6, B + 1.2, 0, {section: 'kpi'});
      box(vault, 3.0, 2.5, 1.8, M.safe, 0, 1.25, 0);
      const wheel = new T.Group();
      wheel.position.set(0, 1.25, 0.95);
      const disc = cyl(wheel, 0.9, 0.16, M.steel, 0, 0, 0, 28);
      disc.rotation.x = Math.PI / 2;
      box(wheel, 1.2, 0.1, 0.1, M.dark, 0, 0, 0.12); box(wheel, 0.1, 1.2, 0.1, M.dark, 0, 0, 0.12);
      vault.add(wheel);

      const bars = group(-2.2, B + 0.9, 0, {section: 'ledger'});
      box(bars, 1.5, 0.12, 1.0, M.woodDark, 0, 0.06, 0);
      f.incomes.slice(0, 12).forEach((e, i) => box(bars, 0.4, 0.16, 0.22, M.gold, -0.48 + (i % 3) * 0.48, 0.2 + Math.floor(i / 6) * 0.18, i % 6 < 3 ? -0.2 : 0.2, {section: 'entry', id: e.id}));
      const out = group(3.4, B + 0.7, 0, {section: 'flow'});
      box(out, 1.6, 1.5, 0.5, M.cabinet, 0, 0.75, 0);
      f.expenses.slice(0, 12).forEach((e, i) => box(out, 0.3, 0.3, 0.3, M.crateOut, -0.55 + (i % 4) * 0.37, 1.66 + Math.floor(i / 4) * 0.31, 0, {section: 'entry', id: e.id}));

      const inPile = group(...byDoor(2.4, 0.9), doorRot, {section: 'ledger'});
      box(inPile, 1.1, 0.1, 0.9, M.woodDark, 0, 0.05, 0);
      if (f.incomes.length) for (let i = 0; i < 3; i++) box(inPile, 0.34, 0.26, 0.26, M.crateIn, -0.3 + i * 0.3, 0.23, 0);
      const outPile = group(...byDoor(3.8, 0.9), doorRot, {section: 'flow'});
      box(outPile, 1.1, 0.1, 0.9, M.woodDark, 0, 0.05, 0);
      if (f.expenses.length) for (let i = 0; i < 3; i++) box(outPile, 0.34, 0.26, 0.26, M.crateOut, -0.3 + i * 0.3, 0.23, 0);

      const moving = view.connected && (f.incomes.length || f.expenses.length);
      if (moving) anim.push(t => { wheel.rotation.z = Math.sin(t * 0.8) * 0.9; });
      for (let i = 0; view.connected && i < Math.min(2, f.incomes.length); i++) {
        walker(M.staff, [{at: byDoor(2.4, 1.9), look: byDoor(2.4, 0.9), wait: 1, carry: true}, {at: [0.2 - i * 0.7, B + 2.9], look: [0.6, B + 1.2], wait: 1.4, carry: false}], {phase: i * 4.3, cargo: M.crateIn});
      }
      for (let i = 0; view.connected && i < Math.min(2, f.expenses.length); i++) {
        walker(M.staff, [{at: [1.4 + i * 0.7, B + 2.9], look: [0.6, B + 1.2], wait: 1.4, carry: true}, {at: byDoor(3.8, 1.9), look: byDoor(3.8, 0.9), wait: 1, carry: false}], {phase: 2 + i * 4.3, cargo: M.crateOut});
      }
      view.agents.slice(0, 2).forEach((a, i) => agentAt(a, L + 1.3, -1.8 + i * 2.5, Math.PI / 2, [{at: [-1.2, B + 2.9], look: [0.6, B + 1.2], wait: 2, work: true}], i));
      inbox(view.missions);
      plant(R - 0.6, F - 0.7);
    },

    // One binder per project on the shelves; the ones with papers missing stick out and are carried to the review table.
    documents() {
      const rows = view.board.connected ? view.board.rows : [];
      const per = 8, units = Math.min(4, Math.max(2, Math.ceil(rows.length / (per * 3))));
      const x0 = L + 1.6, pitch = Math.min(2.8, (2 * hx - 3.2) / Math.max(1, units - 1));
      for (let u = 0; u < units; u++) {
        const shelf = group(x0 + u * pitch, B + 0.45, 0, {section: 'board'});
        box(shelf, 2.4, 2.5, 0.5, M.cabinet, 0, 1.25, -0.12);
        for (let r = 0; r < 3; r++) box(shelf, 2.3, 0.06, 0.5, M.woodDark, 0, 0.3 + r * 0.75, 0.1);
        rows.slice(u * per * 3, (u + 1) * per * 3).forEach((row, i) => {
          const missing = row.missing.length > 0;
          box(shelf, 0.2, 0.52, 0.36, row.complete ? M.ok : missing ? M.warn : M.unknown, -0.95 + (i % per) * 0.27, 0.6 + Math.floor(i / per) * 0.75, missing ? 0.26 : 0.1,
            {section: missing ? 'missing' : 'board'});
        });
      }
      const missing = rows.filter(r => r.missing.length);
      const table = group(0.8, 1.4, 0, {section: 'missing'});
      box(table, 2.6, 0.76, 1.3, M.wood, 0, 0.38, 0);
      missing.slice(0, 10).forEach((r, i) => box(table, 0.4, 0.06, 0.52, M.warn, -0.95 + (i % 5) * 0.47, 0.8 + Math.floor(i / 5) * 0.07, i % 2 ? 0.2 : -0.2));
      for (let i = 0; view.connected && i < Math.min(2, Math.ceil(missing.length / 5)); i++) {
        const sx = x0 + i * pitch;
        walker(M.staff, [{at: [sx, B + 1.6], look: [sx, B], wait: 1.6, work: true, carry: true}, {at: [0.2 + i * 1.2, 2.6], look: [0.8, 1.4], wait: 2.6, carry: false}], {phase: i * 5, cargo: M.warn});
      }
      view.agents.slice(0, 2).forEach((a, i) => agentAt(a, L + 1.3, -0.6 + i * 2.5, Math.PI / 2, [{at: [-0.9, 1.4], look: [0.8, 1.4], wait: 2.5, work: true}], i));
      inbox(view.missions);
      plant(R - 0.6, F - 0.7);
    },

    // A production line: one station per milestone. The crew builds at the current one; a paused project is fenced off.
    project() {
      if (!view.project) return empty();
      const ms = view.milestones, mode = view.state?.mode;
      const pitch = Math.min(2.6, (2 * hx - 3) / Math.max(1, ms.length - 1)), size = Math.min(1.7, pitch * 0.75);
      const sx = i => -pitch * (ms.length - 1) / 2 + i * pitch, sz = -0.4;
      let current = null;
      ms.forEach((m, i) => {
        const st = group(sx(i), sz, 0, {section: 'milestone', id: String(i)});
        box(st, size, 0.08, size, m.state === 'done' ? M.padDone : m.state === 'current' ? M.padNow : M.padTodo, 0, 0.04, 0);
        if (m.state === 'done') {
          box(st, size * 0.6, 1.2, size * 0.6, M.block, 0, 0.68, 0);
          box(st, size * 0.7, 0.1, size * 0.7, M.ok, 0, 1.33, 0);
        } else if (m.state === 'current') {
          current = i;
          box(st, size * 0.6, 0.5, size * 0.6, M.block, 0, 0.33, 0);
          for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(st, 0.06, 1.5, 0.06, M.steel, x * size * 0.42, 0.75, z * size * 0.42);
          box(st, size * 0.9, 0.05, 0.06, M.steel, 0, 1.1, -size * 0.42);
        }
      });
      pulse(M.padNow, 0.3);

      const pile = group(...byDoor(2.6, 1.0), doorRot);
      box(pile, 1.3, 0.1, 1.0, M.woodDark, 0, 0.05, 0);
      for (let i = 0; i < 6; i++) box(pile, 0.34, 0.26, 0.26, M.block, -0.36 + (i % 3) * 0.36, 0.23 + Math.floor(i / 3) * 0.27, 0);
      const tank = group(R - 0.9, B + 0.9, 0, {section: 'payments'});
      box(tank, 1.2, 1.5, 1.2, mat(0xdbeafe, {transparent: true, opacity: 0.3, roughness: 0.1}), 0, 0.75, 0);
      box(tank, 1.3, 0.1, 1.3, M.safe, 0, 0.05, 0);
      if (view.receivedPct > 0) box(tank, 1.0, 1.3 * Math.min(100, view.receivedPct) / 100, 1.0, M.gold, 0, 0.1 + 0.65 * Math.min(100, view.receivedPct) / 100, 0);
      const papers = group(L + 1.0, B + 0.6, 0, {section: 'papers'});
      box(papers, 1.6, 1.0, 0.5, M.cabinet, 0, 0.5, 0);
      (view.papers?.slots || []).forEach((s, i) => box(papers, 0.2, 0.46, 0.34, s === true ? M.ok : s === false ? M.warn : M.unknown, -0.6 + i * 0.24, 1.23, 0));

      if (current != null && view.connected) {
        const spot = k => [sx(current) + (k ? 0.5 : -0.5), sz + size / 2 + 0.6], look = [sx(current), sz];
        if (mode === 'building') {
          for (let k = 0; k < 2; k++) walker(M.staff, [{at: byDoor(2.6 - k * 0.7, 2.0), look: byDoor(2.6, 1.0), wait: 0.8, carry: true}, {at: spot(k), look, wait: 2.6, work: true, carry: false}], {phase: k * 3.3, cargo: M.block});
        } else if (mode === 'revise') {
          walker(M.staff, [{at: spot(0), look, wait: 2.6, work: true, carry: true}, {at: byDoor(2.6, 2.0), look: byDoor(2.6, 1.0), wait: 0.8, carry: false}], {cargo: M.block});
        } else if (mode === 'feedback') {
          walker(M.staff, [{at: spot(0), look, wait: 4}]);
        } else if (mode === 'paused') {
          const fence = group(sx(current), sz + size / 2 + 0.5, 0);
          for (const x of [-0.8, 0.8]) {
            const cone = new T.Mesh(new T.ConeGeometry(0.2, 0.55, 12), M.cone);
            cone.position.set(x, 0.28, 0); fence.add(cone);
          }
          box(fence, 1.8, 0.1, 0.06, M.cone, 0, 0.5, 0);
          const bench = group(L + 3.6, B + 0.9, 0);
          box(bench, 1.8, 0.44, 0.5, M.woodDark, 0, 0.22, 0);
          for (let k = 0; k < 2; k++) walker(M.idle, [{at: [L + 3.2 + k * 0.8, B + 1.0], look: [L + 3.2 + k * 0.8, 2], sit: true, wait: 5}]);
        }
      }
      inbox(view.missions);
    },

    // One meeting table per event of today: people sit at the ones still to come, finished ones are empty.
    schedule() {
      const s = view.schedule, today = s.todayEvents.slice(0, 4);
      const spots = [[-2.8, -0.6], [1.6, -0.6], [-0.6, 2.2], [3.6, 2.0]];
      const next = today.find(e => !e.done);
      today.forEach((e, i) => {
        const [x, z] = spots[i];
        const tb = group(x, z, 0, {section: 'event', id: e.id});
        cyl(tb, 0.95, 0.08, M.wood, 0, 0.76, 0, 24);
        cyl(tb, 0.12, 0.74, M.woodDark, 0, 0.37, 0, 10);
        const chairs = [0, 1, 2, 3].map(k => {
          const a = k * Math.PI / 2 + Math.PI / 4, c = [Math.sin(a) * 1.35, Math.cos(a) * 1.35];
          box(tb, 0.46, 0.08, 0.46, M.chair, c[0], 0.44, c[1]);
          box(tb, 0.1, 0.4, 0.1, M.dark, c[0], 0.2, c[1]);
          return [x + c[0], z + c[1]];
        });
        const lamp = e.done ? M.filed : glow(PRIORITY[e.priority] || PRIORITY.low, 0.6);
        cyl(tb, 0.16, 0.3, lamp, 0, 0.95, 0, 12);
        if (e.done || !view.connected) return;
        pulse(lamp, 0.5);
        const seat = k => ({at: chairs[k], look: [x, z], sit: true, work: true});
        walker(M.staff, [{...seat(1), wait: 6}], {phase: i});
        if (e === next) walker(M.active, [{at: door, wait: 1.5}, {...seat(0), wait: 9}], {phase: 2});
        else walker(M.staff, [{...seat(3), wait: 6}], {phase: i + 2});
      });
      // The days ahead: a block on the shelf for every event of the next 7 days
      const rack = group(L + 3.2, B + 0.5, 0, {section: 'month'});
      box(rack, 5.2, 0.9, 0.6, M.cabinet, 0, 0.45, 0);
      const days = [...new Set(s.upcoming.map(e => e.date))].slice(0, 7);
      s.upcoming.forEach(e => {
        const col = days.indexOf(e.date);
        if (col < 0) return;
        const n = rack.children.filter(c => c.userData.col === col).length;
        if (n >= 5) return;
        box(rack, 0.5, 0.26, 0.4, mat(PRIORITY[e.priority] || PRIORITY.low), -2.2 + col * 0.73, 1.04 + n * 0.28, 0, {section: 'event', id: e.id}).userData.col = col;
      });
      view.agents.slice(0, 2).forEach((a, i) => agentAt(a, R - 1.4 - i * 2.4, B + 1.3, 0, [{at: [L + 3.2 + i, B + 1.6], look: [L + 3.2 + i, B], wait: 2, work: true}], i));
      inbox(view.missions);
      plant(R - 0.6, F - 0.7);
    },

    // Every agent has a desk; the ones running carry their work to the server core and back.
    ai() {
      const core = group(0, B + 1.0, 0, {section: 'agents'});
      for (let i = 0; i < 3; i++) {
        box(core, 0.9, 2.4, 0.9, M.dark, -1.05 + i * 1.05, 1.2, 0);
        for (let k = 0; k < 5; k++) box(core, 0.7, 0.06, 0.04, M.led, -1.05 + i * 1.05, 0.5 + k * 0.4, 0.46);
      }
      anim.push(t => { M.led.emissiveIntensity = 1.0 + Math.sin(t * 4) * 0.4; });
      const n = Math.min(6, view.agents.length), pitch = (2 * hx - 3) / Math.max(1, n - 1);
      view.agents.slice(0, n).forEach((a, i) => {
        const x = n > 1 ? L + 1.5 + i * pitch : 0;
        agentAt(a, x, i % 2 ? 2.0 : 0.3, 0, [{at: [x * 0.35, B + 2.2], look: [x * 0.35, B], wait: 1.8, work: true, carry: false}], i);
      });
      const pod = group(R - 1.3, F - 1.3, 0, {section: 'chat'});
      cyl(pod, 0.7, 0.08, M.white, 0, 0.7, 0, 24);
      cyl(pod, 0.1, 0.7, M.steel, 0, 0.35, 0, 10);
      const orb = new T.Mesh(new T.SphereGeometry(0.22, 16, 12), glow(0x4fa3ff, 0.9));
      orb.position.y = 1.05; pod.add(orb);
      inbox(view.missions);
      plant(L + 0.7, F - 0.7);
    },

    // Posts move left to right: drafts waiting for An, approved ones, and the published ones pinned on the wall.
    marketing() {
      const posts = view.posts || [], by = s => posts.filter(p => p.status === s);
      const card = (parent, p, x, y, z, material, upright) => box(parent, 0.42, upright ? 0.32 : 0.03, upright ? 0.03 : 0.32, material, x, y, z, {section: 'post', id: p.id});
      const drafts = group(-2.6, 1.0, 0, {section: 'posts'});
      box(drafts, 2.4, 0.76, 1.2, M.wood, 0, 0.38, 0);
      by('pending').slice(0, 12).forEach((p, i) => card(drafts, p, -0.85 + (i % 4) * 0.56, 0.79, -0.36 + Math.floor(i / 4) * 0.36, M.paper));
      const okd = group(1.0, 1.0, 0, {section: 'posts'});
      box(okd, 2.4, 0.76, 1.2, M.wood, 0, 0.38, 0);
      by('approved').slice(0, 12).forEach((p, i) => card(okd, p, -0.85 + (i % 4) * 0.56, 0.79, -0.36 + Math.floor(i / 4) * 0.36, M.teal));
      const wall = group(0.4, B + 0.35, 0, {section: 'posts'});
      box(wall, 4.6, 2.2, 0.12, M.white, 0, 1.5, 0);
      for (const x of [-2.1, 2.1]) box(wall, 0.1, 0.5, 0.1, M.dark, x, 0.25, 0);
      by('published').slice(0, 24).forEach((p, i) => card(wall, p, -1.9 + (i % 8) * 0.54, 2.3 - Math.floor(i / 8) * 0.5, 0.08, M.ok, true));

      // Studio corner: camera on a tripod and a soft light
      const studio = group(R - 1.3, B + 1.6, -Math.PI / 4);
      cyl(studio, 0.04, 1.3, M.dark, 0, 0.65, 0, 8);
      box(studio, 0.36, 0.24, 0.5, M.pc, 0, 1.4, 0);
      cyl(studio, 0.04, 1.8, M.dark, 1.0, 0.9, -0.5, 8);
      box(studio, 0.7, 0.7, 0.12, glow(0xfff3c4, 0.8), 1.0, 1.9, -0.5);

      const errand = [
        {at: [-2.6, 2.3], look: [-2.6, 1.0], wait: 1.5, work: true, carry: true},
        {at: [1.0, 2.3], look: [1.0, 1.0], wait: 1.5, work: true},
        {at: [0.4, B + 1.5], look: [0.4, B], wait: 1.8, work: true, carry: false}
      ];
      view.agents.slice(0, 3).forEach((a, i) => agentAt(a, L + 1.3, -2.2 + i * 2.4, Math.PI / 2, posts.length ? errand : [], i));
      inbox(view.missions);
      plant(R - 0.6, F - 0.7);
    }
  };

  if (rooms[view.type]) rooms[view.type](); else empty();
  // A deep building leaves room in front of the work area: a waiting corner by the door
  if (rooms[view.type] && F > 6.2) {
    const lounge = group(R - 2.2, F - 1.6, 0);
    box(lounge, 3.2, 0.02, 2.2, mat(0x8fb3c9, {roughness: 1}), 0, 0.01, 0);
    box(lounge, 2.2, 0.4, 0.8, M.chair, 0, 0.2, -0.6);
    box(lounge, 2.2, 0.5, 0.2, M.chair, 0, 0.65, -0.9);
    cyl(lounge, 0.4, 0.36, M.wood, 0, 0.18, 0.4, 16);
  }

  g.userData.update = (t, camera) => { for (const fn of anim) fn(t, camera); };
  g.userData.update(performance.now() / 1000);
  return g;
}

/** What a pointer ray hits in the room: undefined (nothing), null (room, nothing clickable) or {section, id}. */
export function pickFocus(interior, raycaster) {
  let o = raycaster.intersectObject(interior, true)[0]?.object;
  if (!o) return undefined;
  while (o && o !== interior && !o.userData.focus) o = o.parent;
  return o?.userData.focus || null;
}
