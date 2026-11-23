/**
 * world-landscape.js
 * The land around the campus as one continuous world. Every client district
 * (physical-topology.json, expansion.clientDistricts) sits in real terrain of
 * its own landscape: a valley among snow mountains, a canyon between mesas,
 * forest hills, a beach on the sea. The same shape runs on past the edge of
 * the campus ground into far mountains and the sea, so the map has no edge.
 *
 * createWorldLandform gives the terrain its shape and ground colours.
 * createWorldBackdrop draws the land beyond the campus ground, the sea and
 * the forests.
 */
import * as T from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {districtPlan, slotFrame} from './district-layout.js';

const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const hash = (i, j) => {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, octaves = 3) {
  let sum = 0, amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++, x = x * 2.03 + 17.1, z = z * 2.03 - 9.7, amp *= 0.5) { sum += amp * noise(x, z); total += amp; }
  return sum / total;
}
function ridged(x, z, octaves = 4) {
  let sum = 0, amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++, x = x * 2.07 + 31.3, z = z * 2.07 + 5.9, amp *= 0.5) {
    const r = 1 - Math.abs(2 * noise(x, z) - 1);
    sum += amp * r * r;
    total += amp;
  }
  return sum / total;
}
const rectGap = (x, z, r) => Math.hypot(Math.max(r[0] - x, 0, x - r[2]), Math.max(r[1] - z, 0, z - r[3]));

export const SEA_LEVEL = 0.18;

// The far land is drawn on a grid of about this size where it meets the campus ground.
const SEAM_STEP = 4;

/**
 * Where the campus ground (a fine grid over `rect` [x0, z0, x1, z1]) meets the far land (a coarse grid).
 * Within `band` of the border both take their height and their shading from one shared lattice of
 * SEAM_STEP, so a slope or a cliff crosses the border without teeth, a gap or a line of light.
 */
export function createSeam(height, rect, band = 14) {
  const [x0, z0, x1, z1] = rect, nx = Math.round((x1 - x0) / SEAM_STEP), nz = Math.round((z1 - z0) / SEAM_STEP), sx = (x1 - x0) / nx, sz = (z1 - z0) / nz;
  const cache = new Map();
  const node = (i, j) => {
    const key = (i + 2048) * 8192 + j + 2048;
    let h = cache.get(key);
    if (h === undefined) cache.set(key, h = height(x0 + i * sx, z0 + j * sz));
    return h;
  };
  // Distance inside the border; negative outside it.
  const inside = (x, z) => Math.min(x - x0, x1 - x, z - z0, z1 - z);
  const cell = (x, z) => { const i = Math.floor((x - x0) / sx + 1e-6), j = Math.floor((z - z0) / sz + 1e-6); return [i, j, (x - x0) / sx - i, (z - z0) / sz - j]; };
  /** Height of the campus ground: `height` inside, the lattice on the border. */
  function heightAt(x, z) {
    const d = inside(x, z);
    if (d >= band) return height(x, z);
    const [i, j, u, v] = cell(x, z), coarse = (node(i, j) * (1 - u) + node(i + 1, j) * u) * (1 - v) + (node(i, j + 1) * (1 - u) + node(i + 1, j + 1) * u) * v, k = smooth(d / band);
    return k > 0 ? coarse + (height(x, z) - coarse) * k : coarse;
  }
  const slopeX = (i, j) => (node(i + 1, j) - node(i - 1, j)) / (2 * sx), slopeZ = (i, j) => (node(i, j + 1) - node(i, j - 1)) / (2 * sz);
  /** Turn the normals of a mesh towards the lattice's own as its vertices near the border, from either side. */
  function shade(position, normal) {
    for (let n = 0; n < position.count; n++) {
      const x = position.getX(n), z = position.getZ(n), w = 1 - smooth(Math.abs(inside(x, z)) / band);
      if (w <= 0) continue;
      const [i, j, u, v] = cell(x, z);
      const gx = (slopeX(i, j) * (1 - u) + slopeX(i + 1, j) * u) * (1 - v) + (slopeX(i, j + 1) * (1 - u) + slopeX(i + 1, j + 1) * u) * v;
      const gz = (slopeZ(i, j) * (1 - u) + slopeZ(i + 1, j) * u) * (1 - v) + (slopeZ(i, j + 1) * (1 - u) + slopeZ(i + 1, j + 1) * u) * v;
      const len = Math.hypot(gx, 1, gz), ax = normal.getX(n) * (1 - w) - gx / len * w, ay = normal.getY(n) * (1 - w) + w / len, az = normal.getZ(n) * (1 - w) - gz / len * w, l = Math.hypot(ax, ay, az) || 1;
      normal.setXYZ(n, ax / l, ay / l, az / l);
    }
    normal.needsUpdate = true;
  }
  const line = (lo, step, count) => Array.from({length: count + 1}, (_, k) => lo + step * k);
  return {height: heightAt, shade, xs: line(x0, sx, nx), zs: line(z0, sz, nz)};
}

/** The direction the sun shines from (campus-palette.json, lighting.sunPosition), for the tone of each facet. */
const SUN = [-0.476, 0.774, 0.417];

/**
 * The land is drawn low-poly: a lattice of triangles about `size` metres wide over `rect`, its corners shifted at
 * random, lies over the fine ground mesh, and every vertex takes the shading and colour of the triangle it is in.
 * Heights are not touched. `find(x, z)` gives the index of that triangle; `update()` reads the heights again and
 * sets, per triangle, `normal` (x y z), `centre` (x y z), `lit` (how far it faces the sun) and `tone` (a shade of its own).
 */
export function createFacets(height, rect, size = 9) {
  const [x0, z0, x1, z1] = rect, ni = Math.ceil((x1 - x0) / size) + 3, nj = Math.ceil((z1 - z0) / size) + 3, count = (ni - 1) * (nj - 1) * 2;
  const px = new Float32Array(ni * nj), pz = new Float32Array(ni * nj), py = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    px[j * ni + i] = x0 + (i - 1 + (hash(i + 11, j + 5) - 0.5) * 0.7) * size;
    pz[j * ni + i] = z0 + (j - 1 + (hash(i + 3, j + 17) - 0.5) * 0.7) * size;
  }
  // Each cell is cut along one of its two diagonals.
  const corners = new Int32Array(count * 3);
  for (let j = 0; j < nj - 1; j++) for (let i = 0; i < ni - 1; i++) {
    const a = j * ni + i, b = a + 1, c = a + ni, d = c + 1, t = (j * (ni - 1) + i) * 6;
    corners.set(hash(i + 29, j + 43) < 0.5 ? [a, c, b, b, c, d] : [a, c, d, a, d, b], t);
  }
  const normal = new Float32Array(count * 3), centre = new Float32Array(count * 3), lit = new Float32Array(count), tone = new Float32Array(count);
  for (let t = 0; t < count; t++) tone[t] = hash(t % 9973, Math.floor(t / 9973) + 7);
  const holds = (t, x, z) => {
    const a = corners[t * 3], b = corners[t * 3 + 1], c = corners[t * 3 + 2];
    const d1 = (x - px[b]) * (pz[a] - pz[b]) - (px[a] - px[b]) * (z - pz[b]), d2 = (x - px[c]) * (pz[b] - pz[c]) - (px[b] - px[c]) * (z - pz[c]), d3 = (x - px[a]) * (pz[c] - pz[a]) - (px[c] - px[a]) * (z - pz[a]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  function find(x, z) {
    const ci = Math.min(ni - 2, Math.max(0, Math.floor((x - x0) / size) + 1)), cj = Math.min(nj - 2, Math.max(0, Math.floor((z - z0) / size) + 1));
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i > ni - 2 || j > nj - 2) continue;
      const t = (j * (ni - 1) + i) * 2;
      if (holds(t, x, z)) return t;
      if (holds(t + 1, x, z)) return t + 1;
    }
    return (cj * (ni - 1) + ci) * 2;
  }
  function update() {
    for (let n = 0; n < px.length; n++) py[n] = height(Math.min(x1, Math.max(x0, px[n])), Math.min(z1, Math.max(z0, pz[n])));
    for (let t = 0; t < count; t++) {
      const a = corners[t * 3], b = corners[t * 3 + 1], c = corners[t * 3 + 2];
      const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a], vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = (ny < 0 ? -1 : 1) * (Math.hypot(nx, ny, nz) || 1);
      nx /= l; ny /= l; nz /= l;
      normal[t * 3] = nx; normal[t * 3 + 1] = ny; normal[t * 3 + 2] = nz;
      centre[t * 3] = (px[a] + px[b] + px[c]) / 3; centre[t * 3 + 1] = (py[a] + py[b] + py[c]) / 3; centre[t * 3 + 2] = (pz[a] + pz[b] + pz[c]) / 3;
      lit[t] = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
    }
  }
  update();
  return {find, update, normal, centre, lit, tone};
}

/**
 * Landscapes by the `landscape` id of a topology slot. `pad` is the ground inside the district,
 * `wild` the land around it, `rise(x, z)` its height above the plain, `rim` a ridge closing the
 * district in on the sides away from its gate (`closed`: on every side, the road comes in over a pass;
 * `back`: one hill behind its far end only),
 * `trees` what grows there.
 */
const LAND = {
  plain: {rise: () => 0},
  meadow: {rise: (x, z) => 1 + 4 * fbm(x / 70, z / 70), trees: ['conifer', 0.3, [0x2f7045, 0x3d8350, 0x347a4a]], blossom: 0.14},
  grassland: {pad: 0x9ccb6b, wild: 0x8fcc5f, rise: (x, z) => 1 + 6 * fbm(x / 85, z / 85), trees: ['round', 0.13, [0x5aa64a, 0x77b955]], blossom: 0.2},
  'flower-hills': {pad: 0xc9dd9c, wild: 0xb4d28a, rise: (x, z) => 1.5 + 11 * Math.pow(fbm(x / 34, z / 34, 2), 1.4), trees: ['round', 0.14, [0xf3a6c4, 0xf7c1d6, 0xe98bb2]]},
  'snow-mountain': {pad: 0xeef4f9, wild: 0xeef4f9, rim: 15, closed: true, rise: (x, z) => 9 + 58 * Math.pow(ridged(x / 62, z / 62), 1.25), trees: ['conifer', 0.3, [0x2f5d4a, 0x3b6b58, 0xdfeaf0]]},
  'film-set': {pad: 0xc4bfae, wild: 0x7fbf58, rim: 17, back: true, rise: (x, z) => 3 + 11 * fbm(x / 52, z / 52), trees: ['conifer', 0.3, [0x2f7045, 0x3d8350]], blossom: 0.1},
  'pine-forest': {pad: 0x6a9f58, wild: 0x528a4c, rise: (x, z) => 4 + 15 * fbm(x / 55, z / 55), trees: ['conifer', 0.85, [0x2e6140, 0x3a7049, 0x285538]], blossom: 0.04},
  'red-canyon': {pad: 0xdfa46e, wild: 0xd98050, rim: 9, rise: (x, z) => {
    const t = (5 + 30 * fbm(x / 68, z / 68)) / 7, f = Math.floor(t);
    return 7 * (f + smooth((t - f - 0.55) / 0.45));
  }, trees: ['round', 0.03, [0x8a9a4c]]},
  'tropical-beach': {pad: 0xf0deb0, wild: 0x8ccb62, rise: (x, z) => 0.4 + 1.2 * fbm(x / 30, z / 30), trees: ['round', 0.16, [0x3fa05a, 0x4fb267]], blossom: 0.18},
  // Rolling ground near the districts, growing into mountains towards the horizon.
  highland: {wild: 0x5aa052, rise: (x, z) => 4 + (22 * fbm(x / 120, z / 120) + 20 * ridged(x / 190, z / 190, 3)) * smooth((Math.hypot(x, z) - 170) / 260), trees: ['conifer', 0.55, [0x2f6b45, 0x3d7c4f]], blossom: 0.05},
  sea: {rise: () => -7}
};
// Beyond the campus ground: [landscape, x0, z0, x1, z1].
const FAR = [
  ['snow-mountain', -3000, -3000, -210, -190],
  ['pine-forest', -140, -3000, 140, -260],
  ['red-canyon', 210, -3000, 3000, -190],
  ['sea', 104, -90, 3000, 3000],
  ['highland', -3000, 270, 150, 3000],
  ['meadow', -40, 178, 92, 270],
  ['highland', -3000, -130, -270, 3000]
];
// The one island in the sea: open water stops at this rectangle, and the districts inside it are its land.
const ISLAND = [122, -66, 290, 98];
// The strait that keeps the island off the mainland, along its west and north shores: [x, z] points and half its width.
const STRAIT = {half: 8, points: [[112, 122], [106, 90], [104, 56], [106, 24], [104, -8], [107, -42], [120, -68], [150, -78], [200, -79], [250, -80], [300, -74]]};
const CAMPUS = [-66, -66, 66, 52];
const STRATA = [0xb5482a, 0xc9603a, 0xd98050, 0xa63f26];
const FLOWERS = [0xf3a6c4, 0xffe08a, 0xc9b8f5];
const BLOSSOM = [0xf7a9c9, 0xf48fb9, 0xfbc4da];
const STONE = [0x9aa1ab, 0x868e9b, 0xb1b5bb, 0xa39d96];
const lin = hex => new T.Color(hex);

/** `fine` is the rectangle [x0, z0, x1, z1] whose ground mesh is fine enough to carry small patterns. */
export function createWorldLandform(L, {riverZ = () => 1e9, fine = null} = {}) {
  const detail = (x, z) => fine ? smooth(Math.min(x - fine[0], fine[2] - x, z - fine[1], fine[3] - z) / 30) : 0;
  const plan = districtPlan(L), tpl = plan?.template;
  const slots = (plan?.slots || []).map(slot => {
    const f = slotFrame(slot, tpl), [cx, cz] = f.center, [hx, hz] = f.halfExtent;
    const cos = Math.round(Math.cos(f.rotY)), sin = Math.round(Math.sin(f.rotY)), [gx, gz] = slot.gateXZ;
    // A closed valley takes the mountains around it into its own landscape.
    const land = LAND[slot.landscape] ? slot.landscape : 'meadow', out = LAND[land].closed ? 24 : 0;
    // `core` is how far a point lies outside the district's land (the strip along its road), `pad` the same for its level ground.
    return {land, named: !!LAND[slot.landscape], core: f.gap, gap: (x, z) => Math.max(0, f.gap(x, z) - out), pad: (x, z) => Math.max(0, f.gap(x, z) - 4), box: [cx - hx - 4, cz - hz - 4, cx + hx + 4, cz + hz + 4], y: f.y, len: f.road.len, half: f.half, u: (x, z) => (x - gx) * cos - (z - gz) * sin, v: (x, z) => (x - gx) * sin + (z - gz) * cos};
  });
  const anchors = [{land: 'plain', rect: CAMPUS}, ...slots, ...FAR.map(([land, ...rect]) => ({land, rect}))];
  // How far a point is from open sea: inside the island's rectangle the sea is as far as the nearest side.
  const seaGap = (x, z) => Math.max(rectGap(x, z, anchors[seaAnchor].rect), Math.min(x - ISLAND[0], ISLAND[2] - x, z - ISLAND[1], ISLAND[3] - z));
  // Water on the land. A lagoon is a basin below the water line, with a shore that is not an ellipse.
  // A stream is the same cut along a line of points, narrowing from its mouth (the first point) to its source.
  const waters = (plan?.waters || []).map(w => w.points
    ? {points: w.points, half: w.width / 2, taper: w.taper ?? 1, box: [Math.min(...w.points.map(p => p[0])) - w.width * 3.5, Math.min(...w.points.map(p => p[1])) - w.width * 3.5, Math.max(...w.points.map(p => p[0])) + w.width * 3.5, Math.max(...w.points.map(p => p[1])) + w.width * 3.5]}
    : {x: w.center[0], z: w.center[1], rx: w.radii[0], rz: w.radii[1]});
  const basin = (x, z, w) => {
    if (!w.points) return Math.hypot((x - w.x) / w.rx, (z - w.z) / w.rz) + 0.5 * (fbm(x / 17 + 11, z / 17 + 23, 2) - 0.5);
    if (x < w.box[0] || z < w.box[1] || x > w.box[2] || z > w.box[3]) return 9;
    let q = 9;
    for (let i = 0, n = w.points.length - 1; i < n; i++) {
      const [ax, az] = w.points[i], [bx, bz] = w.points[i + 1], dx = bx - ax, dz = bz - az, t = T.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      q = Math.min(q, Math.hypot(x - ax - t * dx, z - az - t * dz) / (w.half * (1 + (w.taper - 1) * (i + t) / n)));
    }
    return q + 0.3 * (fbm(x / 9 + 5, z / 9 + 17, 2) - 0.5);
  };
  // Roads that climb: points given as [x, z, y] set the grade the ground is cut to.
  const grades = [], lanes = [], decks = [];
  for (const road of plan?.accessRoads || []) for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i], b = road.points[i + 1];
    lanes.push({a, b, half: road.width / 2 + (tpl?.sidewalkWidth || 2) + 0.6});
    // A bridge carries its stretch of road: the ground under it is left as it is, and the deck gives the road its height.
    const spans = n => (road.bridges || []).some(([from, to]) => n >= from && n < to);
    if (spans(i)) decks.push({a, b, half: road.width / 2 + (tpl?.sidewalkWidth || 2) + 0.4});
    else if (a[2] != null && b[2] != null) grades.push({a, b, first: road.points[i - 1]?.[2] == null, half: road.width / 2 + (tpl?.sidewalkWidth || 2) + 0.6, spanA: spans(i - 1), spanB: spans(i + 1)});
  }
  // A roundabout is level ground, wide enough for its ring of road.
  for (const r of plan?.roundabouts || []) {
    const c = [...r.center, r.y];
    lanes.push({a: c, b: c, half: r.radius + 2});
    grades.push({a: c, b: c, first: false, half: r.radius + 1.5});
  }

  const beds = [], near = new Float64Array(slots.length), weights = new Float64Array(anchors.length), seaAnchor = anchors.findIndex(a => a.land === 'sea');
  /** Share of each anchor at a point; returns the index of the strongest. */
  function blend(x, z) {
    // Borders between landscapes wander instead of following the straight sides of the plots.
    const wx = x + 140 * (fbm(x / 130 + 3.1, z / 130, 2) - 0.5), wz = z + 140 * (fbm(x / 130, z / 130 + 7.7, 2) - 0.5);
    let total = 0, best = 0;
    for (let k = 0; k < anchors.length; k++) {
      const a = anchors[k], d = (k === seaAnchor ? seaGap(wx, wz) : a.gap ? a.gap(wx, wz) : rectGap(wx, wz, a.rect)) + 9, w = 1 / (d * d * d * d);
      weights[k] = w;
      total += w;
      if (w > weights[best]) best = k;
    }
    for (let k = 0; k < anchors.length; k++) weights[k] /= total;
    return best;
  }
  // The level ground of a district runs a little past its plot, by a different amount all round, so no valley is a rectangle.
  const edge = (x, z) => 11 * fbm(x / 21 + 5, z / 21 + 9, 2);

  /** Share (0..1) of the hill behind a district's far end at a point: one ridge across the end of its road. */
  const backHill = (s, x, z) => Math.exp(-(((s.u(x, z) - s.len - 24) / 11) ** 2)) * (1 - smooth((Math.abs(s.v(x, z)) - s.half) / 26));

  /** Height of the land once the landscapes are added to the ground `y` the terrain already has. */
  function shape(x, z, y) {
    const open = smooth((rectGap(x, z, CAMPUS) - 6) / 45);
    if (open > 0) {
      const y0 = y;
      blend(x, z);
      // Hills stand back from the river, which keeps a flat valley; the sea bed does not, so the river runs out into open water.
      let hills = 0, deep = 0;
      for (let k = 0; k < anchors.length; k++) {
        if (weights[k] <= 0.01) continue;
        const rise = weights[k] * LAND[anchors[k].land].rise(x, z);
        if (rise > 0) hills += rise; else deep += rise;
      }
      y += open * (hills * (1 + 1.5 * smooth((Math.hypot(x, z) - 260) / 380)) * smooth((Math.abs(z - riverZ(x)) - 9) / 60) + deep);
      // Each district keeps its own level, and the land eases from that level into the landscape around it.
      const e = edge(x, z);
      let wild = 1, level = 0, share = 0;
      for (let i = 0; i < slots.length; i++) {
        const d = slots[i].pad(x, z);
        near[i] = d < 34 ? smooth((d - 1 - e) / 22) : 1;
        if (d >= 34) continue;
        // The nearer a district, the more its level counts: on its own ground it is the only one, whatever lies next door.
        const w = (1 - near[i]) / (d * d + 1e-4);
        wild *= near[i];
        level += w * slots[i].y;
        share += w;
      }
      if (share > 0) y = wild * y + (1 - wild) * level / share;
      // A ridge around the districts that lie in a valley or a canyon: open towards the gate, or closed all round.
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i], land = LAND[s.land];
        if (!land.rim) continue;
        const d = s.pad(x, z);
        if (d <= 0 || d >= 62) continue;
        // The ridge stops short of any other district's ground.
        let clear = 1;
        for (let j = 0; j < slots.length; j++) if (j !== i) clear *= near[j];
        if (clear <= 0) continue;
        // A hill behind the far end of a district is one even ridge, a backdrop to look at from the gate.
        if (land.back) {
          y += open * clear * land.rim * backHill(s, x, z) * (0.9 + 0.2 * fbm(x / 30, z / 30, 2));
          continue;
        }
        // A closed valley is walled highest at the back; the sides towards the campus stay low enough to look in over.
        const side = land.closed ? (1 - 0.5 * Math.max(smooth((z - s.box[3] + 10) / 20), smooth((x - s.box[2] + 10) / 20))) * (0.8 + 0.4 * fbm(x / 16, z / 16, 2)) : smooth((s.u(x, z) - 4) / 16) * (0.55 + 0.9 * fbm(x / 16, z / 16, 2));
        y += open * clear * land.rim * Math.exp(-(((d - 14 - e * 0.5 - 14 * fbm(x / 48 + 2, z / 48 + 4, 2)) / 7) ** 2)) * side;
      }
      {
        let d = Infinity;
        for (let i = 0; i < STRAIT.points.length - 1; i++) {
          const [ax, az] = STRAIT.points[i], [bx, bz] = STRAIT.points[i + 1], dx = bx - ax, dz = bz - az, t = T.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
          d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz));
        }
        if (d < 40) y += (Math.min(y, -3) - y) * (1 - smooth((d - STRAIT.half - 5 * (fbm(x / 23 + 31, z / 23 + 3, 2) - 0.5)) / 9));
      }
      for (const w of waters) {
        const q = basin(x, z, w);
        // A stream runs in a shallow valley of its own, so it never cuts a trench through a hill.
        if (w.points && q < 6) y += (Math.min(y, 1.3) - y) * (1 - smooth((q - 1.4) / 4.6)) * 0.85;
        if (q < 1.45) y += (Math.min(y, -1.3) - y) * (1 - smooth((q - 0.72) / 0.5)) + (0.9 - y) * (1 - smooth(Math.abs(q - 1.22) / 0.45)) * 0.8;
      }
      // Beside the campus the ground stays as the campus has it; the landscapes take over within a few metres.
      y = y0 + (y - y0) * smooth(open * 8);
    }
    // The road bed: the grade of the nearest stretch of road, passing smoothly from one stretch to the next.
    let cut = 0, nearest = Infinity;
    beds.length = 0;
    for (const g of grades) {
      const dx = g.b[0] - g.a[0], dz = g.b[1] - g.a[1], raw = ((x - g.a[0]) * dx + (z - g.a[1]) * dz) / (dx * dx + dz * dz || 1), t = T.MathUtils.clamp(raw, 0, 1);
      const d = Math.hypot(x - g.a[0] - t * dx, z - g.a[1] - t * dz);
      if (d > g.half + 7) continue;
      // Where the road goes on over a bridge the bank ends with the road, so the water passes under the span.
      const past = g.spanA && raw < 0 ? -raw : g.spanB && raw > 1 ? raw - 1 : 0, bank = past ? 1 - smooth(past * Math.hypot(dx, dz) / 2.5) : 1;
      if (!bank) continue;
      cut = Math.max(cut, (1 - smooth((d - g.half) / 7)) * (g.first ? smooth(t * 1.6) : 1) * bank);
      nearest = Math.min(nearest, d);
      beds.push(d, g.a[2] + (g.b[2] - g.a[2]) * t);
    }
    // A district's own ground is level right up to its gate: the road bed stops at the edge of the plot.
    if (cut) for (const s of slots) {
      const d = s.core(x, z);
      if (d < 4) cut *= smooth(d / 4);
    }
    if (!cut) return y;
    let level = 0, total = 0;
    for (let i = 0; i < beds.length; i += 2) {
      const k = Math.exp((nearest - beds[i]) / 1.5);
      level += k * beds[i + 1];
      total += k;
    }
    return y + (level / total - y) * cut;
  }

  const isSea = (x, z) => seaGap(x, z) < 40 || waters.some(w => basin(x, z, w) < 1.3);
  /** Height of the bridge deck over a point, or null where no bridge passes. */
  function deck(x, z) {
    for (const g of decks) {
      const dx = g.b[0] - g.a[0], dz = g.b[1] - g.a[1], t = ((x - g.a[0]) * dx + (z - g.a[1]) * dz) / (dx * dx + dz * dz || 1);
      if (t < 0 || t > 1 || Math.hypot(x - g.a[0] - t * dx, z - g.a[1] - t * dz) > g.half) continue;
      return g.a[2] + (g.b[2] - g.a[2]) * t;
    }
    return null;
  }

  /**
   * Colour the ground: `pos` and `col` are vertex arrays laid out in rows of `row` vertices,
   * `col` holds multipliers of the grass colour `base` and is updated in place.
   * `facet(i, F)` tells of the low-poly facet vertex i lies in: F.k how far the vertex takes the facet's colour
   * (0 not at all), F.x F.y F.z its centre, F.slope, F.lit (createFacets) and F.tone; without `row` it also gives F.vslope, the vertex's own slope.
   */
  function paint(pos, col, row, base, facet = null) {
    const n = pos.length / 3, c = new T.Color(), t = new T.Color(), s1 = new T.Color(), b = lin(base), F = {k: 0, x: 0, y: 0, z: 0, slope: 0, vslope: 0, lit: SUN[1], tone: 0.5};
    const colour = Object.fromEntries(Object.entries(LAND).map(([k, v]) => [k, {pad: v.pad != null ? lin(v.pad) : null, wild: v.wild != null ? lin(v.wild) : null}]));
    const rock = lin(0x8d9ab5), snow = lin(0xf6f9fc), ice = lin(0xb4c4e6), sand = lin(0xf3e2b4), seabed = lin(0xd9cf9c), abyss = lin(0x14508f), cliff = lin(0x8a8f86), strata = STRATA.map(lin), flowers = FLOWERS.map(lin), gold = lin(0xd8d27a), mesaTop = lin(0xe6b584);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const open = smooth(rectGap(x, z, CAMPUS) / 22);
      if (open <= 0) continue;
      F.k = 0;
      if (facet) facet(i, F);
      let slope = F.vslope;
      if (row) {
        // Slope across both neighbours on each axis, so a cliff reads the same from either side.
        const l = i % row ? i - 1 : i, r = (i + 1) % row ? i + 1 : i, u = i >= row ? i - row : i, v = i + row < n ? i + row : i;
        const sx = (pos[r * 3 + 1] - pos[l * 3 + 1]) / (pos[r * 3] - pos[l * 3] || 1), sz = (pos[v * 3 + 1] - pos[u * 3 + 1]) / (pos[v * 3 + 2] - pos[u * 3 + 2] || 1);
        slope = Math.hypot(sx, sz);
      }
      // A facet is one landscape, one height band and one slope all over: the borders between colours follow its edges.
      const fk = F.k, bx = x + (F.x - x) * fk, bz = z + (F.z - z) * fk, ys = y + (F.y - y) * fk;
      slope += (F.slope - slope) * fk;
      // Snow in the shade of the sun is blue.
      const frost = fk * smooth((0.74 - F.lit) / 0.45) * 0.8, snowAt = into => into.copy(snow).lerp(ice, frost).lerp(rock, smooth((slope - 0.9) / 0.9) * 0.8);
      blend(bx, bz);
      c.setRGB(0, 0, 0);
      let cover = 0;
      for (let k = 0; k < anchors.length; k++) {
        const w = weights[k];
        if (w < 0.01) continue;
        const a = anchors[k], name = a.land, set = colour[name];
        const inside = a.pad && a.named ? 1 - smooth(a.core(x, z) / 9) : 0;
        if (!set.wild && !(set.pad && inside)) continue;
        t.copy(set.wild || set.pad);
        if (name === 'snow-mountain') snowAt(t);
        else if (name === 'red-canyon') {
          // Rock layers on the cliffs: bands that follow the height, each passing softly into the next.
          const band = y / 2.6 + 1.2 * fbm(x / 40, z / 40, 2), f = Math.floor(band), mix = smooth((band - f - 0.6) / 0.4);
          t.lerp(mesaTop, smooth((ys - 10) / 4));
          // On the steepest faces the ground mesh is too coarse to carry the layers: one rock colour there.
          t.lerp(s1.copy(strata[((f % 4) + 4) % 4]).lerp(strata[(((f + 1) % 4) + 4) % 4], mix).lerp(strata[1], smooth((slope - 1.1) / 0.9)), smooth((slope - 0.3) / 0.5));
        } else if (name === 'flower-hills') {
          // Flower fields: rows of one colour each, in patches across the hills.
          const field = fbm(x / 26 + 40, z / 26, 2), turn = Math.floor(fbm(x / 60, z / 60 + 20, 2) * 6), row = (turn % 2 ? x * 0.8 + z * 0.6 : x * 0.6 - z * 0.8) / 3.2;
          if (field > 0.5 && row - Math.floor(row) < 0.72) t.lerp(flowers[((Math.floor(row) + turn) % 3 + 3) % 3], smooth((field - 0.5) / 0.05) * 0.9 * detail(x, z) * (1 - smooth((slope - 0.2) / 0.3)));
        } else if (name === 'grassland') t.lerp(gold, smooth((fbm(bx / 28, bz / 28 + 60, 2) - 0.55) / 0.15) * 0.55);
        else if (name === 'pine-forest') t.multiplyScalar(0.86 + 0.28 * fbm(bx / 20, bz / 20, 2));
        else if (name === 'highland') {
          if (slope > 0.95) t.lerp(cliff, smooth((slope - 0.95) / 0.4));
          if (ys > 104) t.lerp(snow, smooth((ys - 104) / 14));
        }
        if (set.pad && inside) t.lerp(set.pad, inside);
        c.r += w * t.r; c.g += w * t.g; c.b += w * t.b;
        cover += w;
      }
      if (cover > 0) c.multiplyScalar(1 / cover);
      // The snow line: high ground beside the snow mountains is snow too, whatever grows lower down.
      let snowy = 0;
      for (let k = 0; k < anchors.length; k++) if (anchors[k].land === 'snow-mountain') snowy += weights[k];
      const white = smooth((ys - 9) / 9) * smooth(snowy / 0.2);
      if (white > 0) {
        c.lerp(snowAt(t), white);
        cover = Math.max(cover, white);
      }
      // The ridge around a closed valley belongs to the valley: snow and rock down to its foot.
      for (const s of slots) {
        if (!LAND[s.land].closed) continue;
        const ring = 1 - smooth((s.pad(x, z) - 16) / 14);
        if (ring <= 0) continue;
        c.lerp(snowAt(t), ring);
        cover = Math.max(cover, ring);
      }
      // The hill behind a district is that district's land, whatever landscape lies next to it.
      for (const s of slots) {
        if (!LAND[s.land].back) continue;
        const hill = smooth(backHill(s, x, z) / 0.3);
        if (hill <= 0) continue;
        c.lerp(colour[s.land].wild, hill);
        cover = Math.max(cover, hill);
      }
      // The shore: sand at the water's edge, sea bed below it. The river keeps its own banks.
      const still = waters.reduce((m, w) => Math.max(m, 1 - smooth((basin(x, z, w) - 1.3) / 0.35)), 0);
      if (y < 1.5 && (weights[seaAnchor] > 0.02 || still > 0)) {
        const shore = (1 - smooth((y - 0.5) / 1.0)) * Math.max(smooth(weights[seaAnchor] / 0.2), still);
        if (!cover) c.copy(b);
        // Under water the bed is pale in the shallows and dark in the deep, and the water takes its blue from it.
        c.lerp(s1.copy(sand).lerp(seabed, smooth((-0.2 - y) / 1.2)).lerp(abyss, smooth((-1.1 - y) / 3.2)), shore);
        cover = Math.max(cover, shore);
      }
      // The river bed is pale too, so the river runs light blue between its banks.
      if (y < 0.7 && Math.abs(z - riverZ(x)) < 14) {
        const bed = (1 - smooth((y - 0.15) / 0.5)) * smooth((y + 0.9) / 0.5);
        if (!cover) c.copy(b);
        c.lerp(s1.copy(sand).lerp(seabed, 0.5), bed);
        cover = Math.max(cover, bed);
      }
      // Every facet has a shade of its own, lighter towards the sun.
      const k = open * Math.min(1, cover * 1.25), shade = 1 + open * fk * ((F.tone - 0.5) * 0.1 + (F.lit - SUN[1]) * 0.3) * (y < 0.3 ? 0 : 1);
      if (k <= 0) c.copy(b);
      col[i * 3] *= (1 + (c.r / b.r - 1) * k) * shade;
      col[i * 3 + 1] *= (1 + (c.g / b.g - 1) * k) * shade;
      col[i * 3 + 2] *= (1 + (c.b / b.b - 1) * k) * shade;
    }
  }

  /** What grows at a point: {kind, density, colors} of the strongest landscape there, or null. */
  function growth(x, z) {
    // The ridge around a closed valley grows what the valley grows.
    const ring = slots.find(s => LAND[s.land].closed && s.pad(x, z) < 26);
    const land = LAND[ring ? ring.land : anchors[blend(x, z)].land];
    return land.trees ? {kind: land.trees[0], density: land.trees[1], colors: land.trees[2], blossom: land.blossom || 0, rocky: !!land.rim || land === LAND.highland} : null;
  }
  /** How far (0..1) the ground at a point is drawn as low-poly facets: not on the campus, nor on the level land of a district. */
  const faceted = (x, z) => {
    let k = smooth((rectGap(x, z, CAMPUS) - 5) / 18) * (fine ? smooth((Math.min(x - fine[0], fine[2] - x, z - fine[1], fine[3] - z) - 2) / 12) : 1);
    for (let i = 0; k > 0 && i < slots.length; i++) k *= smooth((slots[i].core(x, z) - 1) / 6);
    return k;
  };
  const onPad = (x, z, margin = 0) => slots.some(s => s.pad(x, z) <= margin);
  const onRoad = (x, z, margin = 0) => lanes.some(g => {
    const dx = g.b[0] - g.a[0], dz = g.b[1] - g.a[1], t = T.MathUtils.clamp(((x - g.a[0]) * dx + (z - g.a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(x - g.a[0] - t * dx, z - g.a[1] - t * dz) < g.half + margin;
  });
  return {shape, paint, faceted, growth, isSea, deck, onPad, onRoad, campus: CAMPUS};
}

/** The land past the campus ground, the sea, the river's upper course and the forests. */
export function createWorldBackdrop({scene, terrain, camera, controls, reach = 2000}) {
  const world = terrain.world, group = new T.Group();
  group.name = 'world-backdrop';
  scene.add(group);
  if (!world || !terrain.seam) return group;
  const box = new T.Box3().setFromBufferAttribute(new T.BufferAttribute(terrain.basePosArray, 3)), x0 = box.min.x, x1 = box.max.x, z0 = box.min.z, z1 = box.max.z;

  // Grid lines: fine at the edge of the campus ground, coarser with distance. One ring of cells lies under the edge.
  const axis = (nodes, lo = nodes[0], hi = nodes[nodes.length - 1]) => {
    const out = [...nodes];
    for (let v = lo, step = SEAM_STEP * 1.12; v > -reach; step = Math.min(34, step * 1.12)) out.unshift(v -= step);
    for (let v = hi, step = SEAM_STEP * 1.12; v < reach; step = Math.min(34, step * 1.12)) out.push(v += step);
    return out;
  };
  const xs = axis(terrain.seam.xs), zs = axis(terrain.seam.zs), row = xs.length, pos = new Float32Array(row * zs.length * 3), col = new Float32Array(row * zs.length * 3).fill(1), idx = [];
  const within = (x, z, m) => x > x0 + m && x < x1 - m && z > z0 + m && z < z1 - m;
  zs.forEach((z, j) => xs.forEach((x, i) => {
    // The same soft light and dark patches the campus ground has (terrain.js), so the two meet without a line.
    const k = (j * row + i) * 3, shade = 1 + 0.04 * Math.sin(x * 0.08) * Math.cos(z * 0.06) + 0.035 * (Math.sin(x * 0.025 + z * 0.02) * 0.5 + Math.cos(x * 0.04 - z * 0.05) * 0.5) + 0.045 * (Math.sin(x * 0.047 + 1.3) * Math.sin(z * 0.053 - 0.7) + 0.6 * Math.sin((x + z) * 0.021 + 2.1));
    // Away from the campus ground the grid lines are broken up, so the far land is triangles of every shape.
    const loose = 0.62 * smooth((Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)) - 1) / 13);
    let px = x, pz = z;
    if (loose > 0 && i > 0 && j > 0 && i < row - 1 && j < zs.length - 1) {
      px += (hash(i + 5, j + 9) - 0.5) * loose * Math.min(xs[i + 1] - x, x - xs[i - 1]);
      pz += (hash(i + 23, j + 2) - 0.5) * loose * Math.min(zs[j + 1] - z, z - zs[j - 1]);
    }
    pos[k] = px;
    pos[k + 1] = terrain.designHeight(px, pz) - (within(px, pz, 1) ? 2 : 0);
    pos[k + 2] = pz;
    const tone = f => T.MathUtils.clamp(1 + (shade - 1) * f, 0.86, 1.12);
    col[k] = tone(0.85);
    col[k + 1] = tone(1.05);
    col[k + 2] = tone(0.65);
  }));
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < row - 1; i++) {
    if (within((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2, 4.5)) continue;
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    if (hash(i + 31, j + 47) < 0.5) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  // The far land is low-poly outright: every triangle has corners of its own, one normal and one colour.
  // Next to the campus ground it keeps the vertex's own colour and shading, so the two still meet without a line.
  const count = idx.length, flat = new Float32Array(count * 3), hue = new Float32Array(count * 3), steep = new Float32Array(count), face = new Float32Array(idx.length / 3 * 6);
  const grade = n => {
    const l = n % row ? n - 1 : n, r = (n + 1) % row ? n + 1 : n, u = n >= row ? n - row : n, v = n + row < pos.length / 3 ? n + row : n;
    return Math.hypot((pos[r * 3 + 1] - pos[l * 3 + 1]) / (pos[r * 3] - pos[l * 3] || 1), (pos[v * 3 + 1] - pos[u * 3 + 1]) / (pos[v * 3 + 2] - pos[u * 3 + 2] || 1));
  };
  for (let t = 0; t < count; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz) || 1;
    face.set([(pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3, Math.hypot(nx, nz) / Math.max(ny, len * 0.05), (nx * SUN[0] + ny * SUN[1] + nz * SUN[2]) / len, hash(idx[t] % 8191, idx[t + 1] % 8191)], t * 2);
    for (let k = 0; k < 3; k++) {
      const n = idx[t + k];
      flat.set(pos.subarray(n * 3, n * 3 + 3), (t + k) * 3);
      hue.set(col.subarray(n * 3, n * 3 + 3), (t + k) * 3);
      steep[t + k] = grade(n);
    }
  }
  const away = (x, z) => smooth((Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)) - 1) / 13);
  world.paint(flat, hue, 0, terrain.materials[0].color, (i, F) => {
    const f = Math.floor(i / 3) * 6;
    F.k = away(flat[i * 3], flat[i * 3 + 2]);
    F.vslope = steep[i];
    F.x = face[f]; F.y = face[f + 1]; F.z = face[f + 2]; F.slope = face[f + 3]; F.lit = face[f + 4]; F.tone = face[f + 5];
  });
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(flat, 3));
  geo.setAttribute('color', new T.BufferAttribute(hue, 3));
  geo.setAttribute('uv', new T.BufferAttribute(new Float32Array(count * 2).map((_, i) => flat[Math.floor(i / 2) * 3 + (i % 2) * 2] * 0.45), 2));
  geo.computeVertexNormals();
  terrain.seam.shade(geo.attributes.position, geo.attributes.normal);
  const land = new T.Mesh(geo, terrain.materials[0]);
  land.name = 'world-land';
  land.receiveShadow = true;
  group.add(land);

  // One water surface for the sea and the river, so the river runs into the sea without a seam.
  const stream = terrain.terrain.parent?.getObjectByName('river-only');
  // Clear enough to show the bed: pale sand in the shallows along every shore, dark blue in the deep.
  const sea = new T.Mesh(new T.PlaneGeometry(reach * 2.4, reach * 2.4).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({color: 0x2f9be0, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.74}));
  sea.position.y = SEA_LEVEL;
  sea.name = 'world-sea';
  group.add(sea);
  if (stream) stream.visible = false;

  // Forests: one instanced mesh per tree shape, thinning out with distance.
  const tint = (g, hex) => {
    const c = new T.Color(hex);
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute('uv');
    g.setAttribute('color', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
    return g;
  };
  const cone = (r, h, y) => new T.ConeGeometry(r, h, 6).translate(0, y + h / 2, 0), trunk = h => tint(new T.CylinderGeometry(0.16, 0.24, h, 5).translate(0, h / 2, 0), 0x6a4a30);
  const shapes = {
    conifer: mergeGeometries([trunk(1.2), tint(cone(1.4, 2.4, 0.9), 0xffffff), tint(cone(1.0, 2.0, 2.3), 0xffffff), tint(cone(0.6, 1.5, 3.5), 0xffffff)]),
    round: mergeGeometries([trunk(1.7), tint(new T.IcosahedronGeometry(1.5, 1).translate(0, 2.9, 0), 0xffffff), tint(new T.IcosahedronGeometry(1.0, 0).translate(0.8, 2.3, 0.3), 0xffffff)])
  };
  const spots = {conifer: [], round: []}, ground = (x, z) => within(x, z, 0) ? terrain.height(x, z) : terrain.designHeight(x, z);
  const plant = (lo, hi, step, skip) => {
    for (let x = -hi; x <= hi; x += step) for (let z = -hi; z <= hi; z += step) {
      if (Math.max(Math.abs(x), Math.abs(z)) < lo) continue;
      const i = Math.round(x / step), j = Math.round(z / step), px = x + (hash(i, j + 91) - 0.5) * step, pz = z + (hash(i + 57, j) - 0.5) * step;
      if (skip(px, pz) || rectGap(px, pz, world.campus) < 14 || world.onPad(px, pz, 2) || world.onRoad(px, pz, 4) || Math.abs(pz - terrain.riverZ(px)) < 11) continue;
      const g = world.growth(px, pz);
      if (!g || hash(i + 13, j + 29) > g.density) continue;
      const y = ground(px, pz);
      if (y < 1.2 || y > 60 || Math.abs(ground(px + 2, pz) - y) > 2.6 || Math.abs(ground(px, pz + 2) - y) > 2.6) continue;
      // Here and there a tree in blossom among the green ones.
      const pink = hash(i + 77, j + 19) < g.blossom;
      spots[pink ? 'round' : g.kind].push({x: px, y, z: pz, s: 0.8 + hash(i + 3, j + 71) * 0.7 + (lo ? 0.5 : 0), r: hash(i + 7, j + 5), color: pink ? BLOSSOM[Math.floor(hash(i + 41, j + 2) * BLOSSOM.length)] : g.colors[Math.floor(hash(i + 41, j + 2) * g.colors.length)]});
    }
  };
  // Boulders: along the sea shore, the lagoon and the river, out in the shallows, and loose on the mountains.
  const rocks = [];
  for (let x = -300; x <= 330; x += 4.5) for (let z = -300; z <= 300; z += 4.5) {
    const i = Math.round(x / 4.5), j = Math.round(z / 4.5), px = x + (hash(i + 9, j + 61) - 0.5) * 4.5, pz = z + (hash(i + 83, j + 4) - 0.5) * 4.5;
    if (rectGap(px, pz, world.campus) < 16 || world.onPad(px, pz, 3) || world.onRoad(px, pz, 3.5)) continue;
    const y = ground(px, pz), river = Math.abs(pz - terrain.riverZ(px)), chance = hash(i + 15, j + 37);
    const shore = y > -1.3 && y < 1.1 && (river < 9 ? chance < 0.2 : world.isSea(px, pz) && chance < 0.34), g = !shore && y > 4 && y < 70 ? world.growth(px, pz) : null;
    if (!shore && !(g?.rocky && chance < 0.035)) continue;
    const big = hash(i + 51, j + 8);
    rocks.push({x: px, y: Math.max(y, shore ? -0.5 : y), z: pz, s: shore ? 0.7 + big * big * 2.2 : 1 + big * 2.4, r: hash(i + 2, j + 67), tone: hash(i + 19, j + 73)});
  }
  // Outside the two ring-road corridors and off every road of the campus ground.
  plant(0, 300, 6.5, (x, z) => Math.abs(x) < 70 && z > -70 && z < 56);
  plant(300, 640, 17, () => false);
  const dummy = new T.Object3D(), c = new T.Color(), leaf = new T.MeshStandardMaterial({roughness: 0.9, vertexColors: true, flatShading: true});
  for (const [kind, list] of Object.entries(spots)) {
    if (!list.length) continue;
    const mesh = new T.InstancedMesh(shapes[kind], leaf, list.length);
    list.forEach((s, i) => {
      dummy.position.set(s.x, s.y - 0.1, s.z);
      dummy.rotation.y = s.r * Math.PI * 2;
      dummy.scale.setScalar(s.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, c.setHex(s.color));
    });
    mesh.name = 'world-forest-' + kind;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (rocks.length) {
    // A boulder is a few flat faces, wider than it is high, each one turned and squashed its own way.
    const mesh = new T.InstancedMesh(tint(new T.DodecahedronGeometry(1, 0).scale(1, 0.72, 0.85).translate(0, 0.3, 0), 0xffffff), leaf, rocks.length);
    rocks.forEach((s, i) => {
      dummy.position.set(s.x, s.y - 0.15, s.z);
      dummy.rotation.set((s.tone - 0.5) * 0.5, s.r * Math.PI * 2, (s.r - 0.5) * 0.5);
      dummy.scale.set(s.s * (0.8 + s.tone * 0.5), s.s * (0.7 + s.r * 0.5), s.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, c.setHex(STONE[Math.floor(s.tone * STONE.length)]));
    });
    mesh.name = 'world-rocks';
    // Boulders stand in the shallows, where client-districts.js clears the trees away.
    mesh.userData.shoreline = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // A few low-poly clouds over the far mountains, the canyon rim, the open sea and the southern woods: never over
  // the campus or a district.
  const puffs = [];
  for (const [n, [cx, cz]] of [[-235, -235], [-150, -300], [215, -270], [318, -205], [345, 40], [300, 215], [120, 290], [-90, 300], [-240, 225], [-255, 20]].entries()) {
    const size = 8 + hash(n + 29, 13) * 7, cy = 62 + hash(n + 41, 7) * 26;
    for (let k = 0; k < 5; k++) {
      const r = size * (k ? 0.45 + hash(n + 5, k + 53) * 0.35 : 1);
      puffs.push(new T.IcosahedronGeometry(r, 0).scale(1.25, 0.62, 1).rotateY(hash(n + 61, k + 3) * 6).translate(cx + (k ? (hash(n + 7, k + 31) - 0.5) * size * 2.6 : 0), cy + (k ? -size * 0.16 : 0), cz + (k ? (hash(n + 13, k + 71) - 0.5) * size * 1.3 : 0)));
    }
  }
  const clouds = new T.Mesh(mergeGeometries(puffs), new T.MeshStandardMaterial({color: 0xffffff, roughness: 1, flatShading: true, fog: false}));
  clouds.name = 'world-clouds';
  group.add(clouds);

  // Scenery only: nothing here can be picked, so the Studio never selects or bulldozes the far land.
  group.traverse(o => { o.raycast = () => {}; });

  // The view reaches the far mountains, and the camera stays over the land that is drawn in full.
  if (camera) {
    camera.far = Math.max(camera.far, reach * 2);
    // An orthographic view low over the land would otherwise cut away the hills behind the camera.
    if (camera.isOrthographicCamera) camera.near = -reach * 1.5;
    camera.updateProjectionMatrix();
  }
  if (controls) {
    const lim = [x0 - 60, z0 - 60, x1 + 60, z1 + 60], d = new T.Vector3();
    controls.addEventListener('change', () => {
      d.set(T.MathUtils.clamp(controls.target.x, lim[0], lim[2]) - controls.target.x, 0, T.MathUtils.clamp(controls.target.z, lim[1], lim[3]) - controls.target.z);
      if (d.lengthSq() === 0) return;
      controls.target.add(d);
      controls.object.position.add(d);
    });
  }
  return group;
}
