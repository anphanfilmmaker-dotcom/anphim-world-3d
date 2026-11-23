/**
 * check-world-layout.mjs
 * Checks the world layout in physical-topology.json without a browser:
 *   node check-world-layout.mjs [git ref to compare ids against, default origin/main]
 * 1. Identity: buildings, district slots and lots keep their ids, labels, clients and lot counts.
 * 2. Projects: every project of the live data lands on the same lot id as before.
 * 3. Land: every lot stands on its level pad, above water, clear of other districts and of the roads;
 *    along a district's own road, curved or straight, lot 1 is nearest the gate and no lot touches another or the road.
 * 4. Roads: each district with a client is reached by road; roads stay dry except on a bridge.
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';

const three = pathToFileURL('./vendor/three.module.js').href;
register('data:text/javascript,' + encodeURIComponent(`export function resolve(s, c, next) { return s === 'three' ? {url: ${JSON.stringify(three)}, shortCircuit: true} : next(s, c); }`));
const T = await import('three'), {createTerrain} = await import('./terrain.js');
const {districtPlan, slotFrame, slotLots, openLotCount, spineEnd} = await import('./district-layout.js');
const {SEA_LEVEL} = await import('./world-landscape.js'), {DataConnector} = await import('./data-connector.js');

const json = file => JSON.parse(readFileSync(file, 'utf8'));
const base = process.argv[2] || 'origin/main';
const L = json('./physical-topology.json'), L0 = JSON.parse(execFileSync('git', ['show', base + ':physical-topology.json'], {encoding: 'utf8', maxBuffer: 1 << 26}));
const live = json('./live_campus_data.json'), plan = districtPlan(L), plan0 = districtPlan(L0), tpl = plan.template;
const fails = [], notes = [];
const check = (ok, text) => { if (!ok) fails.push(text); };

// ---- 1. identity ----
const ident = b => [b.id, b.legacyId ?? null, b.projectId ?? null, b.kind ?? null].join('|');
check(JSON.stringify((L.buildings || []).map(ident)) === JSON.stringify((L0.buildings || []).map(ident)), 'buildings: id / legacyId / projectId changed');
const slotIdent = s => [s.id, s.label, s.lots, s.depth, s.openLots ?? null, s.landscape ?? null, s.clientId ?? null].join('|');
check(JSON.stringify(plan.slots.map(slotIdent)) === JSON.stringify(plan0.slots.map(slotIdent)), 'district slots: id / label / lots / depth / landscape / client changed');
const lotIds = p => p.slots.flatMap(s => slotLots(s, p.template).map(l => l.id));
check(JSON.stringify(lotIds(plan)) === JSON.stringify(lotIds(plan0)), 'lot ids changed');
for (const key of ['width', 'firstLotAt', 'lotPitch', 'lotSize', 'lotSetback', 'openLots']) check(JSON.stringify(tpl[key]) === JSON.stringify(plan0.template[key]), 'district template changed: ' + key);
notes.push(`identity: ${(L.buildings || []).length} buildings, ${plan.slots.length} slots, ${lotIds(plan).length} lots compared with ${base}`);

// ---- 2. projects keep their lots (the allocation rule of client-districts.js) ----
const projectNumber = id => Number(String(id).match(/(\d+)\s*$/)?.[1]);
const data = new DataConnector();
data.cache = live;
function allocate(p, topology) {
  const fixed = new Set((topology.buildings || []).filter(x => x.kind === 'project').map(x => projectNumber(x.projectId ?? x.id)));
  const out = {}, used = {}, clients = data.getClients();
  for (const slot of p.slots) {
    const client = slot.clientId && clients.find(c => c.id === slot.clientId);
    if (!client) continue;
    const projects = data.getClientProjects(client.id).filter(x => !fixed.has(projectNumber(x.id)));
    const lots = slotLots(slot, p.template), taken = new Map();
    for (const x of projects) { const n = Number(x.lot); if (n >= 1 && n <= slot.lots && !taken.has(n)) taken.set(n, x); }
    for (const x of projects) { if ([...taken.values()].includes(x)) continue; const lot = lots.find(l => !taken.has(l.n)); if (lot) taken.set(lot.n, x); else fails.push(`no lot left in ${slot.label} for project ${x.id}`); }
    for (const [n, x] of taken) out[x.id] = lots[n - 1].id;
    used[slot.id] = Math.max(0, ...taken.keys());
  }
  return {out, used};
}
const now = allocate(plan, L), before = allocate(plan0, L0);
check(JSON.stringify(now.out) === JSON.stringify(before.out), 'a project moved to another lot id');
check(Object.keys(now.out).length > 0, 'no project of the live data reached a district lot');
notes.push(`projects: ${Object.keys(now.out).length} district projects, each on the lot id it had`);

// ---- 3 + 4. land and roads, on the ground the app builds ----
const terrain = createTerrain(new T.Scene(), json('./campus-palette.json'), L);
const wet = (x, z) => terrain.height(x, z) < SEA_LEVEL + 0.25;
const segGap = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
const roads = plan.accessRoads || [], roadGap = (x, z) => Math.min(...roads.map(r => Math.min(...r.points.slice(1).map((p, i) => segGap(x, z, r.points[i], p))) - r.width / 2));
const ring = L.roadPlan?.ringCorners, ringBox = ring && [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))];
const frames = plan.slots.map(s => ({slot: s, frame: slotFrame(s, tpl)}));
// On a district's land, `inset` metres or more from its edge (the land is the strip along its road).
const inSlot = ({frame}, x, z, inset = 0) => [[0, 0], [inset, 0], [-inset, 0], [0, inset], [0, -inset]].every(([dx, dz]) => frame.gap(x + dx, z + dz) === 0);
let lotCount = 0, worstStep = 0, nearestRoad = Infinity;
for (const f of frames) {
  const {slot, frame} = f, [lotW, lotD] = tpl.lotSize;
  // The land of a district: no other district on it, and clear of the campus ring road.
  for (let x = frame.center[0] - frame.halfExtent[0]; x <= frame.center[0] + frame.halfExtent[0]; x += 2) for (let z = frame.center[1] - frame.halfExtent[1]; z <= frame.center[1] + frame.halfExtent[1]; z += 2) {
    if (frame.gap(x, z) > 0) continue;
    for (const g of frames) if (g !== f && slot.id < g.slot.id) check(!inSlot(g, x, z, 1), `${slot.label} overlaps ${g.slot.label} at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    if (ringBox) check(x < ringBox[0] || x > ringBox[2] || z < ringBox[1] || z > ringBox[3], `${slot.label} overlaps the campus ring road at (${x.toFixed(0)}, ${z.toFixed(0)})`);
  }
  const lots = slotLots(slot, tpl), road = frame.road, clear = tpl.roadWidth / 2 + tpl.sidewalkWidth;
  // Lot 1 is nearest the gate and the numbers run on along the road; no lot touches another or the district's own road.
  check(lots.every((l, i) => !i || l.s >= lots[i - 1].s), `${slot.label}: lot numbers do not run along the road from the gate`);
  check(lots[0].s <= tpl.firstLotAt + tpl.lotPitch / 2 + 1e-6, `${slot.label}: lot 1 is not the first lot from the gate`);
  const sat = (p, q) => [p, q].some(r => r.some((c, i) => { const d = r[(i + 1) % 4], nu = d[1] - c[1], nv = c[0] - d[0], l = Math.hypot(nu, nv); return (r === p ? q : p).every(e => ((e[0] - c[0]) * nu + (e[1] - c[1]) * nv) / l >= 1); }));
  for (const lot of lots) {
    lotCount++;
    for (const other of lots) if (other.n > lot.n) check(sat(lot.c, other.c), `${lot.id} is less than 1 m from ${other.id}`);
    for (let i = 0; i < 4; i++) for (const t of [0, 0.5]) {
      const a = lot.c[i], b = lot.c[(i + 1) % 4], u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      check(road.gapTo(u, v) >= clear, `${lot.id} is ${road.gapTo(u, v).toFixed(1)} m from the centre of its own road`);
      check(road.land(u, v) === 0, `${lot.id} is off the land of ${slot.label}`);
    }
    for (const du of [-0.5, 0, 0.5]) for (const dv of [-0.5, 0, 0.5]) {
      const [x, z] = frame.toWorld(lot.u + du * lotW * lot.tu - dv * lotD * lot.tv, lot.v + du * lotW * lot.tv + dv * lotD * lot.tu), y = terrain.height(x, z);
      worstStep = Math.max(worstStep, Math.abs(y - frame.y));
      check(Math.abs(y - frame.y) < 0.35, `${lot.id} is not level: ground ${y.toFixed(2)} m, pad ${frame.y} m at (${x.toFixed(0)}, ${z.toFixed(0)})`);
      check(!wet(x, z), `${lot.id} is in water at (${x.toFixed(0)}, ${z.toFixed(0)})`);
      const gap = roadGap(x, z);
      nearestRoad = Math.min(nearestRoad, gap);
      check(gap > 1, `${lot.id} is ${gap.toFixed(1)} m from an access road at (${x.toFixed(0)}, ${z.toFixed(0)})`);
      for (const r of plan.roundabouts || []) check(Math.hypot(x - r.center[0], z - r.center[1]) > r.radius + 1, `${lot.id} is on ${r.id}`);
    }
  }
  // The district's own road, gate to turnaround, stays on dry level ground too.
  const end = spineEnd(slot, tpl, slot.lots) + (road.joins ? 0 : tpl.turnaroundRadius);
  check(end <= road.len + tpl.turnaroundRadius + 1e-6 && lots[lots.length - 1].s + lotW / 2 <= road.len + 1e-6, `${slot.label}: the road is too short for its ${slot.lots} lots`);
  // The gate stands square across the road: the road leaves it straight.
  check([0, 1, 2].every(s => { const [, v, , tv] = road.at(s); return Math.abs(v) < 1e-3 && Math.abs(tv) < 1e-3; }), `${slot.label}: the road is not straight through its gate`);
  // A loop comes back onto its own centreline, past the gate plaza, so the two roadways meet over their full width.
  if (road.joins) {
    const [eu, ev] = road.at(road.len);
    let gap = Infinity, at = 0;
    for (let s = 0; s < road.len / 2; s += 0.25) { const [u, v] = road.at(s), d = Math.hypot(u - eu, v - ev); if (d < gap) [gap, at] = [d, s]; }
    check(gap < 0.5, `${slot.label}: the loop ends ${gap.toFixed(1)} m off the road it joins`);
    check(at >= tpl.gatePlaza[1], `${slot.label}: the loop joins its road on the gate plaza`);
  }
  for (let s = 0; s <= end; s += 2) for (const o of [-tpl.roadWidth / 2, 0, tpl.roadWidth / 2]) {
    const [x, z] = frame.toWorld(...road.map(s, o)), y = terrain.height(x, z);
    check(!wet(x, z), `${slot.label} internal road is in water at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    check(Math.abs(y - frame.y) < 0.35, `${slot.label} internal road is not level at (${x.toFixed(0)}, ${z.toFixed(0)}): ground ${y.toFixed(2)} m`);
  }
  if (slot.clientId) check(!!slot.ringXZ || roads.some(r => { const e = r.points[r.points.length - 1]; return e[0] === slot.gateXZ[0] && e[1] === slot.gateXZ[1]; }), `${slot.label} (${slot.clientId}) has no road to its gate`);
}
notes.push(`land: ${lotCount} lots on their pads (largest step ${worstStep.toFixed(2)} m), dry, nearest access road ${nearestRoad.toFixed(1)} m from a lot`);

// Landmarks: every district in use has one, each stands on dry land clear of every lot and road, and the boats lie on the sea.
const REACH = {'summit-lodge': 9, 'hill-sign': 1.5, lookout: 6, 'lagoon-club': 10, beach: 12, 'flower-hill': 14.5, 'rock-arch': 8};
const lotGap = (x, z) => {
  let best = Infinity;
  for (const {slot, frame} of frames) {
    const [u, v] = frame.toLocal(x, z);
    for (const lot of slotLots(slot, tpl)) for (let i = 0; i < 4; i++) {
      const a = lot.c[i], b = lot.c[(i + 1) % 4], du = b[0] - a[0], dv = b[1] - a[1], t = Math.min(1, Math.max(0, ((u - a[0]) * du + (v - a[1]) * dv) / (du * du + dv * dv)));
      best = Math.min(best, Math.hypot(u - a[0] - t * du, v - a[1] - t * dv));
    }
  }
  return best;
};
let markCount = 0, nearestLot = Infinity;
for (const {slot, frame} of frames) {
  const marks = slot.landmarks || [];
  if (slot.clientId) check(marks.length > 0, `${slot.label} (${slot.clientId}) has no landmark`);
  for (const mark of marks) {
    markCount++;
    if (mark.kind === 'park') { check(frame.road.joins, `${slot.label}: a park needs a road that comes back on itself`); continue; }
    check(mark.kind in REACH, `${slot.label}: unknown landmark kind ${mark.kind}`);
    const reach = REACH[mark.kind] || 0, spots = [...(mark.at ? [mark.at] : []), ...(mark.path || []), ...(mark.cable ? [mark.cable] : [])];
    check(spots.length > 0, `${slot.label}: landmark ${mark.kind} has no place`);
    for (const [x, z] of spots) {
      // A footpath to a landmark is 2 m wide and starts at the district's road or on its walking loop, 1.5 m behind the lots.
      const footpath = !!mark.at && !!mark.path?.some(p => p[0] === x && p[1] === z);
      const r = footpath ? 1 : mark.at && x === mark.at[0] && z === mark.at[1] ? reach : 1.5, name = `${slot.label} ${mark.kind} at (${x}, ${z})`;
      check(!wet(x, z), `${name} is in water`);
      const lot = lotGap(x, z), own = frame.road.gapTo(...frame.toLocal(x, z));
      nearestLot = Math.min(nearestLot, lot - r);
      check(lot > r + (footpath ? 0.2 : 1), `${name} is ${lot.toFixed(1)} m from a lot`);
      if (!footpath) check(own > r + tpl.roadWidth / 2 + tpl.sidewalkWidth, `${name} is ${own.toFixed(1)} m from the district's road`);
      check(roadGap(x, z) > r + 4, `${name} is ${roadGap(x, z).toFixed(1)} m from an access road`);
      for (const f of frames) if (f.slot !== slot) check(f.frame.gap(x, z) > r, `${name} stands on ${f.slot.label}`);
      if (ringBox) check(x < ringBox[0] - r || x > ringBox[2] + r || z < ringBox[1] - r || z > ringBox[3] + r, `${name} is on the campus`);
    }
  }
}
for (const [x, z] of plan.boats || []) {
  check(terrain.world.isSea(x, z) && terrain.designHeight(x, z) < SEA_LEVEL - 0.9, `boat at (${x}, ${z}) is not on open water (bed ${terrain.designHeight(x, z).toFixed(1)} m)`);
  check(roadGap(x, z) > 14, `boat at (${x}, ${z}) is ${roadGap(x, z).toFixed(1)} m from a bridge`);
}
notes.push(`landmarks: ${markCount} on ${frames.filter(f => (f.slot.landmarks || []).length).length} districts, dry, nearest ${nearestLot.toFixed(1)} m clear of a lot; ${(plan.boats || []).length} boats on open water`);

let bridgeLength = 0;
for (const road of roads) {
  const spans = new Set((road.bridges || []).map(([a]) => a));
  for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i], b = road.points[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (spans.has(i)) {
      bridgeLength += len;
      let water = 0;
      for (let d = 0; d <= len; d += 1) water += wet(a[0] + (b[0] - a[0]) * d / len, a[1] + (b[1] - a[1]) * d / len) ? 1 : 0;
      check(water > 2, `${road.id}: bridge ${i}-${i + 1} crosses no water`);
      for (const p of [a, b]) check(Math.abs(terrain.height(p[0], p[1]) - p[2]) < 0.6, `${road.id}: bridge end (${p[0]}, ${p[1]}) is ${(p[2] - terrain.height(p[0], p[1])).toFixed(2)} m off the ground`);
      continue;
    }
    for (let d = 0; d <= len; d += 1) {
      const x = a[0] + (b[0] - a[0]) * d / len, z = a[1] + (b[1] - a[1]) * d / len;
      check(!wet(x, z), `${road.id} is in water at (${x.toFixed(0)}, ${z.toFixed(0)})`);
      // A road only enters the district it leads to, at its gate.
      for (const f of frames) if (inSlot(f, x, z, 1)) check(false, `${road.id} runs through ${f.slot.label} at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    }
  }
}
notes.push(`districts: ${frames.filter(f => f.frame.road.curved).length} of ${frames.length} on a curved road of their own, lot 1 nearest the gate, lots clear of each other and of the road, every road long enough for all its lots`);
notes.push(`roads: ${roads.length} access roads dry and outside the districts, ${roads.reduce((n, r) => n + (r.bridges || []).length, 0)} bridges (${bridgeLength.toFixed(0)} m)`);

for (const n of notes) console.log('ok   ' + n);
const unique = [...new Set(fails)];
for (const f of unique.slice(0, 40)) console.log('FAIL ' + f);
if (unique.length > 40) console.log(`... and ${unique.length - 40} more`);
console.log(unique.length ? `${unique.length} problems` : 'World layout checks passed');
process.exit(unique.length ? 1 : 0);
