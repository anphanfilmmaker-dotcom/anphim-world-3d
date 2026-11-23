/**
 * district-layout.js
 * Geometry of the client districts declared in physical-topology.json
 * (expansion.clientDistricts). Shared by the terrain, which levels the land
 * of every slot, and by client-districts.js, which draws on it.
 *
 * A slot is described from its gate: u runs from the gate away from the
 * campus, v runs across the slot. Its internal road is straight along u
 * unless the slot has `road.points` ([u, v] from the gate), which the road
 * then follows as a smooth curve; the land of the slot is the strip along
 * that road. Along the road, s is the distance from the gate and o the
 * offset to one side. Lot numbers are fixed by this file and the topology
 * alone, so a lot never moves when projects come and go.
 */
const SIDE_ROTATION = {E: 0, N: Math.PI / 2, W: Math.PI, S: -Math.PI / 2};
const STEP = 1;

export function districtPlan(L) {
  const plan = L?.expansion?.clientDistricts;
  return plan?.slots?.length ? plan : null;
}

/**
 * The internal road of a slot in its own (u, v): `pts` every metre, its length `len`, and
 * at(s) -> [u, v, tu, tv] (point and direction; straight on past either end), map(s, o) -> [u, v].
 * `joins` is set when the road ends on itself (a loop), so it has no turnaround.
 */
function buildRoad(slot) {
  const ctl = slot.road?.points || [[0, 0], [slot.depth, 0]], fine = [];
  // Catmull-Rom through the control points, then one point per metre of road.
  for (let i = 0; i < ctl.length - 1; i++) {
    const p0 = ctl[Math.max(i - 1, 0)], p1 = ctl[i], p2 = ctl[i + 1], p3 = ctl[Math.min(i + 2, ctl.length - 1)];
    const n = ctl.length > 2 ? Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 2)) : 1;
    for (let k = i ? 1 : 0; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      fine.push([0, 1].map(a => 0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  const cum = [0];
  for (let i = 1; i < fine.length; i++) cum.push(cum[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
  const len = cum[cum.length - 1], count = Math.max(1, Math.round(len / STEP)), pts = [];
  for (let k = 0, i = 0; k <= count; k++) {
    const d = len * k / count;
    while (i < fine.length - 2 && cum[i + 1] < d) i++;
    const t = (d - cum[i]) / (cum[i + 1] - cum[i] || 1);
    pts.push([fine[i][0] + (fine[i + 1][0] - fine[i][0]) * t, fine[i][1] + (fine[i + 1][1] - fine[i][1]) * t]);
  }
  const step = len / count, dir = pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, count)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  });
  const at = s => {
    if (s <= 0) return [pts[0][0] + dir[0][0] * s, pts[0][1] + dir[0][1] * s, dir[0][0], dir[0][1]];
    if (s >= len) return [pts[count][0] + dir[count][0] * (s - len), pts[count][1] + dir[count][1] * (s - len), dir[count][0], dir[count][1]];
    const i = Math.min(count - 1, Math.floor(s / step)), t = s / step - i;
    const tu = dir[i][0] + (dir[i + 1][0] - dir[i][0]) * t, tv = dir[i][1] + (dir[i + 1][1] - dir[i][1]) * t, l = Math.hypot(tu, tv) || 1;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, tu / l, tv / l];
  };
  const map = (s, o) => { const [u, v, tu, tv] = at(s); return [u - tv * o, v + tu * o]; };
  /** Distance from (u, v) to the road's centre line, leaving out the stretch within `skip` metres of `s`. */
  const gapTo = (u, v, s = -1e9, skip = 0) => {
    let best = Infinity;
    for (let i = 0; i < count; i++) {
      if (Math.abs((i + 0.5) * step - s) < skip) continue;
      const [au, av] = pts[i], du = pts[i + 1][0] - au, dv = pts[i + 1][1] - av, t = Math.min(1, Math.max(0, ((u - au) * du + (v - av) * dv) / (du * du + dv * dv || 1)));
      best = Math.min(best, Math.hypot(u - au - t * du, v - av - t * dv));
    }
    return best;
  };
  const curved = !!slot.road?.points;
  /** Rotation about the vertical that turns the u axis along the road at s. */
  const heading = s => { const [, , tu, tv] = at(s); return Math.atan2(-tv, tu); };
  /** False when the place o metres beside the road at s is as near to another stretch of the road (the inside of a tight bend). */
  const clear = (s, o) => !curved || Math.abs(o) < 4.5 || gapTo(...map(s, o)) >= Math.abs(o) - 1.5;
  /** Points [u, v] on a grid inside a road that comes back on itself, at least `margin` from the road. */
  const inside = (grid, margin = 6.5) => {
    const out = [], us = pts.map(p => p[0]), vs = pts.map(p => p[1]);
    for (let u = Math.min(...us) + grid / 2; u < Math.max(...us); u += grid) for (let v = Math.min(...vs) + grid / 2; v < Math.max(...vs); v += grid) {
      let within = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > v) !== (pts[j][1] > v) && u < pts[i][0] + (pts[j][0] - pts[i][0]) * (v - pts[i][1]) / (pts[j][1] - pts[i][1])) within = !within;
      if (within && gapTo(u, v) >= margin) out.push([u, v]);
    }
    return out;
  };
  return {pts, len, step, at, map, gapTo, heading, clear, inside, curved, joins: !!slot.road?.joins, lotSide: slot.road?.lotSide || 0};
}

const frames = new WeakMap();
/**
 * Local frame of a slot: rotY for a group placed at the gate, (u, v) -> world [x, z] and back, its road, and
 * gap(x, z): how far a world point is outside the slot's land (0 on it). `center` and `halfExtent` box that land.
 */
export function slotFrame(slot, template) {
  if (frames.has(slot)) return frames.get(slot);
  const rotY = SIDE_ROTATION[slot.side] ?? 0, cos = Math.round(Math.cos(rotY)), sin = Math.round(Math.sin(rotY));
  const [gx, gz] = slot.gateXZ, half = template.width / 2, road = buildRoad(slot), depth = road.len;
  const toWorld = (u, v) => [gx + u * cos + v * sin, gz - u * sin + v * cos];
  const toLocal = (x, z) => [(x - gx) * cos - (z - gz) * sin, (x - gx) * sin + (z - gz) * cos];
  // The land: a straight slot is its rectangle; along a curved road it is everything within `half` of the road,
  // cut off square at both ends.
  let u0 = 0, u1 = depth, v0 = -half, v1 = half;
  if (road.curved) for (const [u, v] of road.pts) { u0 = Math.min(u0, u - half); u1 = Math.max(u1, u + half); v0 = Math.min(v0, v - half); v1 = Math.max(v1, v + half); }
  const coarse = road.pts.filter((_, i) => i % 3 === 0 || i === road.pts.length - 1), [g0, g1] = coarse, [e1, e0] = coarse.slice(-2);
  const localGap = (u, v) => {
    const out = Math.hypot(Math.max(u0 - u, 0, u - u1), Math.max(v0 - v, 0, v - v1));
    if (!road.curved || out > 40) return out;
    let best = Infinity;
    for (let i = 0; i < coarse.length - 1; i++) {
      const [au, av] = coarse[i], du = coarse[i + 1][0] - au, dv = coarse[i + 1][1] - av, t = Math.min(1, Math.max(0, ((u - au) * du + (v - av) * dv) / (du * du + dv * dv)));
      best = Math.min(best, Math.hypot(u - au - t * du, v - av - t * dv));
    }
    // Square ends: behind the gate, and past the far end of a road that does not come back on itself.
    let cut = 0;
    for (const [p, q] of road.joins ? [[g0, g1]] : [[g0, g1], [e0, e1]]) {
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]), over = -((u - p[0]) * (q[0] - p[0]) + (v - p[1]) * (q[1] - p[1])) / l;
      const near = Math.min(1, Math.max(0, (Math.hypot(u - p[0], v - p[1]) - half) / half));
      cut = Math.max(cut, over * (1 - near * near * (3 - 2 * near)));
    }
    return Math.max(0, best - half, cut);
  };
  road.land = localGap;
  const a = toWorld(u0, v0), b = toWorld(u1, v1);
  const frame = {
    rotY, depth, half, toWorld, toLocal, road,
    y: slot.groundY ?? 0,
    gap: (x, z) => localGap(...toLocal(x, z)),
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    halfExtent: [Math.abs(a[0] - b[0]) / 2, Math.abs(a[1] - b[1]) / 2]
  };
  frames.set(slot, frame);
  return frame;
}

/** The level ground the terrain keeps under each slot: its box, and gap(x, z) -> metres outside it. */
export function districtGroundPads(L, margin = 4) {
  const plan = districtPlan(L);
  if (!plan) return [];
  return plan.slots.map(slot => {
    const f = slotFrame(slot, plan.template);
    // `path` (world [x, z] along a curved road) and `half` say where inside the box the ground really is.
    const path = f.road.curved ? f.road.pts.filter((_, i, all) => i % 4 === 0 || i === all.length - 1).map(([u, v]) => f.toWorld(u, v)) : null;
    return {id: slot.id, x: f.center[0], z: f.center[1], hx: f.halfExtent[0] + margin, hz: f.halfExtent[1] + margin, y: f.y, path, half: f.half + margin, gap: (x, z) => Math.max(0, f.gap(x, z) - margin)};
  });
}

const lotCache = new WeakMap();
/**
 * Every lot of a slot, lot 1 nearest the gate: {n, id, s, u, v, side, tu, tv}; (u, v) is the lot centre and
 * (tu, tv) the direction of the road beside it. Lots stand in rows along the road, one on each side (or all on
 * `road.lotSide`); on a bend the next row moves on until its lots are clear of the ones before and of the road.
 */
export function slotLots(slot, template) {
  if (lotCache.has(slot)) return lotCache.get(slot);
  const lots = [], [lotW, lotD] = template.lotSize, road = slotFrame(slot, template).road;
  const off = template.lotSetback + lotD / 2, keep = template.roadWidth / 2 + template.sidewalkWidth + 0.2;
  const corners = l => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [l.u + a * l.tu * lotW / 2 - b * l.tv * lotD / 2, l.v + a * l.tv * lotW / 2 + b * l.tu * lotD / 2]);
  // Two lots are clear when a line along a side of either keeps them as far apart as two lots on a straight road.
  const spare = template.lotPitch - lotW - 1e-6;
  const apart = (p, q) => [p, q].some(r => r.some((c, i) => {
    const d = r[(i + 1) % 4], nu = d[1] - c[1], nv = c[0] - d[0], l = Math.hypot(nu, nv), other = r === p ? q : p;
    return other.every(e => ((e[0] - c[0]) * nu + (e[1] - c[1]) * nv) / l >= spare);
  }));
  const place = (s, side) => { const [u, v, tu, tv] = road.at(s); return {s, side, tu, tv, u: u - tv * side * off, v: v + tu * side * off}; };
  const fits = l => {
    const c = corners(l);
    if (road.curved) {
      if (c.some(([u, v]) => road.land(u, v) > 0)) return false;
      for (let i = 0; i < 4; i++) for (const t of [0, 0.25, 0.5, 0.75]) {
        const d = c[(i + 1) % 4];
        if (road.gapTo(c[i][0] + (d[0] - c[i][0]) * t, c[i][1] + (d[1] - c[i][1]) * t) < keep) return false;
      }
    }
    return lots.every(o => Math.abs(o.s - l.s) > 45 && Math.hypot(o.u - l.u, o.v - l.v) > 20 || apart(c, o.c));
  };
  const sides = road.lotSide ? [road.lotSide] : [-1, 1], last = road.len - (road.joins ? 0 : lotW / 2);
  let s = template.firstLotAt + template.lotPitch / 2;
  for (let n = 1; n <= slot.lots;) {
    let row = sides.map(side => place(s, side));
    // Along a curved road each row stands as soon after the last as it fits: closer on the outside of a bend,
    // further on where the lots of the inside would touch. A row that fits nowhere stays one pitch on.
    if (road.curved && lots.length) {
      const from = s - template.lotPitch / 2;
      for (let d = from; d <= last; d += 0.5) { row = sides.map(side => place(d, side)); if (row.every(fits)) { s = d; break; } }
      if (s < from + 1e-9 && !row.every(fits)) row = sides.map(side => place(s, side));
    }
    for (const l of row) {
      if (n > slot.lots) break;
      l.c = corners(l);
      lots.push({...l, n, id: 'lot:' + slot.label + ':' + String(n++).padStart(2, '0')});
    }
    s += template.lotPitch;
  }
  lotCache.set(slot, lots);
  return lots;
}

/** Lots served by the road today: the opened phase, grown in pairs when projects need more. */
export function openLotCount(slot, template, used = 0) {
  const base = slot.openLots ?? template.openLots;
  return Math.min(slot.lots, Math.max(base, used + (used % 2)));
}

/** How far the internal road runs for a number of open lots: past the last of them, or all the way round a loop. */
export function spineEnd(slot, template, open) {
  const road = slotFrame(slot, template).road, lots = slotLots(slot, template);
  if (road.joins) return road.len;
  return Math.min(road.len, Math.max(0, ...lots.slice(0, open).map(l => l.s)) + template.lotPitch / 2 + 5);
}
