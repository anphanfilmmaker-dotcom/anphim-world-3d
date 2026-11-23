import * as T from 'three';

/**
 * building-section.js: a campus building opened up to look inside, without changing it.
 *
 * - sectionOf(host) measures the building from its own meshes: where its storeys are, where its gate is,
 *   and for each storey the floor area enclosed by its walls and the largest free rectangle in it.
 * - buildShell(host) is the building itself drawn again with everything above a cut height removed, so
 *   the walls, the gate and the plinth seen inside are the ones seen outside, at the same size and place.
 *
 * Plan coordinates [x, z] are metres around the building's position, along the building's own axes.
 */

const CELL = 0.2;
export const STUB_H = 0.9;   // height the walls on the camera's side are cut down to
const MAX_FLOORS = 6;

const meshesOf = host => {
  const list = [];
  host.traverseVisible(m => {
    if (m.isMesh && !m.isInstancedMesh && m.geometry?.attributes?.position && m.material?.visible !== false) list.push(m);
  });
  return list;
};

export function sectionOf(host) {
  host.updateMatrixWorld(true);
  const key = Array.from(host.matrixWorld.elements, v => v.toFixed(3)).join();
  if (host.userData.section?.key === key) return host.userData.section;

  const pos = new T.Vector3().setFromMatrixPosition(host.matrixWorld);
  const rot = new T.Euler().setFromRotationMatrix(host.matrixWorld, 'YXZ').y;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const toPlan = (x, z) => [(x - pos.x) * cos - (z - pos.z) * sin, (x - pos.x) * sin + (z - pos.z) * cos];

  // Every triangle of the building as [x, y, z] * 3 in plan coordinates (y stays the world height)
  const chunks = [];
  let count = 0;
  const v = new T.Vector3();
  for (const m of meshesOf(host)) {
    const p = m.geometry.attributes.position, index = m.geometry.index;
    const n = index ? index.count : p.count, out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(m.matrixWorld);
      const [x, z] = toPlan(v.x, v.z);
      out[i * 3] = x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = z;
    }
    chunks.push(out);
    count += n;
  }
  const tris = new Float32Array(count * 3);
  let at = 0;
  for (const c of chunks) { tris.set(c, at); at += c.length; }

  // Storey levels: heights where the building has a large flat surface facing up
  const box = {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity};
  const flat = new Map();
  for (let i = 0; i < tris.length; i += 9) {
    for (let k = 0; k < 9; k += 3) {
      box.x0 = Math.min(box.x0, tris[i + k]); box.x1 = Math.max(box.x1, tris[i + k]);
      box.y0 = Math.min(box.y0, tris[i + k + 1]); box.y1 = Math.max(box.y1, tris[i + k + 1]);
      box.z0 = Math.min(box.z0, tris[i + k + 2]); box.z1 = Math.max(box.z1, tris[i + k + 2]);
    }
    const ux = tris[i + 3] - tris[i], uy = tris[i + 4] - tris[i + 1], uz = tris[i + 5] - tris[i + 2];
    const wx = tris[i + 6] - tris[i], wy = tris[i + 7] - tris[i + 1], wz = tris[i + 8] - tris[i + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, len = Math.hypot(nx, ny, nz);
    if (len > 1e-9 && ny / len > 0.95) {
      const bin = Math.round(tris[i + 1] * 10);
      flat.set(bin, (flat.get(bin) || 0) + len / 2);
    }
  }
  // A level is the highest wide surface of a group lying close together (steps and plinth, slab and sills);
  // the next one is at least a storey higher: 1.6 m, or over half the height of the ground storey.
  const peak = Math.max(0, ...flat.values());
  const wide = [...flat].map(([bin, area]) => [bin / 10, area]).sort((a, b) => a[0] - b[0]);
  const base = pos.y >= box.y0 && pos.y <= box.y0 + 1 ? pos.y : box.y0;
  const levels = [];
  for (let i = 0, from = -Infinity; i < wide.length;) {
    if (wide[i][0] < from || wide[i][1] < Math.max(3, peak * 0.12)) { i++; continue; }
    let j = i, most = 0, level = wide[i][0];
    while (j < wide.length && wide[j][0] <= wide[i][0] + 1.2) most = Math.max(most, wide[j++][1]);
    for (let k = i; k < j; k++) if (wide[k][1] >= most * 0.4) level = wide[k][0];
    if (!levels.length && level > base + 1.5) levels.push(base);
    levels.push(level);
    from = level + Math.max(1.6, levels.length > 1 ? (levels[1] - levels[0]) * 0.55 : 0);
    i = j;
  }
  const floors = [];
  for (let i = 0; i + 1 < levels.length && floors.length < MAX_FLOORS; i++) floors.push({y: levels[i], top: levels[i + 1]});
  if (!floors.length) floors.push({y: base, top: Math.max(base + 2.2, Math.min(box.y1, base + 3.4))});

  const socket = host.getObjectByName('entry-socket');
  const gate = socket ? toPlan(...socket.getWorldPosition(v).toArray().filter((_, i) => i !== 1)) : [0, box.z1];

  const section = {key, pos, rot, box, floors, gate, tris, plans: []};
  host.userData.section = section;
  return section;
}

/**
 * The plan of one storey: null when its walls enclose no usable floor (a signboard, an open frame), else
 * {geometry: the enclosed floor as a flat mesh in plan coordinates, inner: {x0, x1, z0, z1} its bounds,
 *  rect: {cx, cz, hx, hz} the largest free rectangle on it}.
 */
export function planOf(section, floor) {
  if (section.plans[floor] !== undefined) return section.plans[floor];
  const {tris, box} = section, {y, top} = section.floors[floor];
  const y1 = y + 0.3, y2 = Math.min(y + 1.2, top - 0.15);
  const x0 = box.x0 - CELL * 2, z0 = box.z0 - CELL * 2;
  const W = Math.ceil((box.x1 - box.x0) / CELL) + 4, H = Math.ceil((box.z1 - box.z0) / CELL) + 4;
  let blocked = new Uint8Array(W * H);

  // Walls and anything else standing on this storey, drawn into a grid
  for (let i = 0; i < tris.length; i += 9) {
    const ay = tris[i + 1], by = tris[i + 4], cy = tris[i + 7];
    if (Math.max(ay, by, cy) < y1 || Math.min(ay, by, cy) > y2) continue;
    const ax = tris[i], az = tris[i + 2], ux = tris[i + 3] - ax, uy = by - ay, uz = tris[i + 5] - az;
    const wx = tris[i + 6] - ax, wy = cy - ay, wz = tris[i + 8] - az;
    const edge = Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz));
    const n = Math.min(500, Math.max(1, Math.ceil(edge / (CELL * 0.45))));
    for (let a = 0; a <= n; a++) {
      for (let b = 0; a + b <= n; b++) {
        const s = a / n, t = b / n, py = ay + uy * s + wy * t;
        if (py < y1 || py > y2) continue;
        const gx = Math.floor((ax + ux * s + wx * t - x0) / CELL), gz = Math.floor((az + uz * s + wz * t - z0) / CELL);
        if (gx >= 0 && gz >= 0 && gx < W && gz < H) blocked[gz * W + gx] = 1;
      }
    }
  }

  // Inside = free cells that cannot be reached from the edge of the grid
  const enclosed = walls => {
    const out = new Uint8Array(W * H), queue = [];
    const push = c => { if (!walls[c] && !out[c]) { out[c] = 1; queue.push(c); } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let z = 0; z < H; z++) { push(z * W); push(z * W + W - 1); }
    while (queue.length) {
      const c = queue.pop(), x = c % W, z = (c - x) / W;
      if (x > 0) push(c - 1);
      if (x < W - 1) push(c + 1);
      if (z > 0) push(c - W);
      if (z < H - 1) push(c + W);
    }
    const inside = new Uint8Array(W * H);
    let total = 0;
    for (let c = 0; c < W * H; c++) if (!walls[c] && !out[c]) { inside[c] = 1; total++; }
    return {inside, total};
  };
  let found = enclosed(blocked);
  if (found.total * CELL * CELL < 3) {
    // An open doorway lets the outside in: close gaps up to two cells wide and look again
    const thick = new Uint8Array(W * H);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (!blocked[z * W + x]) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx >= 0 && zz >= 0 && xx < W && zz < H) thick[zz * W + xx] = 1;
      }
    }
    blocked = thick;
    found = enclosed(blocked);
  }
  const {inside} = found;

  // Rooms: connected areas of at least 1.5 m2 (the inside of a planter or a column is not a room)
  const label = new Int32Array(W * H);
  let rooms = 0, area = 0;
  for (let c0 = 0; c0 < W * H; c0++) {
    if (!inside[c0] || label[c0]) continue;
    const cells = [c0];
    label[c0] = ++rooms;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], x = c % W;
      for (const d of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (d >= 0 && d < W * H && inside[d] && !label[d]) { label[d] = rooms; cells.push(d); }
      }
    }
    if (cells.length * CELL * CELL < 1.5) for (const c of cells) inside[c] = 0;
    else area += cells.length * CELL * CELL;
  }
  if (area < 3) return (section.plans[floor] = null);

  // Largest free rectangle: long ones count only up to 2.2 times their short side,
  const heights = new Int32Array(W + 1);
  let best = null;
  // and a room near the gate counts for more than one at the back
  const score = (w, h, x, z) => Math.min(w, 2.2 * h) * Math.min(h, 2.2 * w) *
    (1 + Math.exp(-Math.hypot(x0 + (x + w / 2) * CELL - section.gate[0], z0 + (z + h / 2) * CELL - section.gate[1]) / 5));
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) heights[x] = inside[z * W + x] ? heights[x] + 1 : 0;
    const stack = [];
    for (let x = 0; x <= W; x++) {
      const h = x < W ? heights[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1][1] >= h) {
        const [sx, sh] = stack.pop();
        const value = sh > 0 ? score(x - sx, sh, sx, z - sh + 1) : 0;
        if (value > (best?.score || 0)) best = {score: value, x: sx, z: z - sh + 1, w: x - sx, h: sh};
        start = sx;
      }
      stack.push([start, h]);
    }
  }
  const trim = (from, size, cap) => size > cap ? [from + (size - cap) / 2, cap] : [from, size];
  const [rx, rw] = trim(best.x, best.w, 2.2 * best.h), [rz, rh] = trim(best.z, best.h, 2.2 * best.w);
  const rect = {cx: x0 + (rx + rw / 2) * CELL, cz: z0 + (rz + rh / 2) * CELL, hx: rw * CELL / 2 - 0.3, hz: rh * CELL / 2 - 0.3};
  if (rect.hx < 0.6 || rect.hz < 0.6) return (section.plans[floor] = null);

  // The floor: one strip per run of inside cells, runs that repeat on the next row joined into one
  const position = [], uv = [], inner = {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity};
  const quad = (xa, xb, za, zb) => {
    const ax = x0 + xa * CELL, bx = x0 + xb * CELL, az = z0 + za * CELL, bz = z0 + zb * CELL;
    position.push(ax, 0, az, ax, 0, bz, bx, 0, bz, ax, 0, az, bx, 0, bz, bx, 0, az);
    for (const [x, z] of [[ax, az], [ax, bz], [bx, bz], [ax, az], [bx, bz], [bx, az]]) uv.push(x / 1.25, z / 1.25);
    inner.x0 = Math.min(inner.x0, ax); inner.x1 = Math.max(inner.x1, bx);
    inner.z0 = Math.min(inner.z0, az); inner.z1 = Math.max(inner.z1, bz);
  };
  let open = new Map();
  for (let z = 0; z <= H; z++) {
    const runs = new Map();
    for (let x = 0; z < H && x < W; x++) {
      if (!inside[z * W + x]) continue;
      const xa = x;
      while (x < W && inside[z * W + x]) x++;
      runs.set(xa * (W + 1) + x, open.get(xa * (W + 1) + x) ?? z);
    }
    for (const [k, from] of open) if (!runs.has(k)) quad(Math.floor(k / (W + 1)), k % (W + 1), from, z);
    open = runs;
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return (section.plans[floor] = {geometry, inner, rect, rooms});
}

/**
 * The building drawn again, cut open. Returns {group, planes, dispose}: `planes.stub` and `planes.cut` are the
 * heights everything is cut at on the camera's side and at the two far walls (`planes.farX`, `planes.farZ`);
 * the caller moves them. Geometry is shared with the building, so only the materials are disposed.
 */
export function buildShell(host, layer) {
  const down = () => new T.Plane(new T.Vector3(0, -1, 0), 0);
  const planes = {stub: down(), cut: down(), farX: new T.Plane(), farZ: new T.Plane()};
  const sets = [[planes.stub], [planes.cut, planes.farX], [planes.cut, planes.farZ]];
  const group = new T.Group();
  group.name = 'interior-shell';
  group.layers.set(layer);
  const made = sets.map(() => new Map());
  const cut = (source, i) => {
    if (!made[i].has(source)) {
      const m = source.clone();
      // clone() drops shader hooks: keep the hand-painted wash of the original
      m.onBeforeCompile = source.onBeforeCompile;
      m.customProgramCacheKey = source.customProgramCacheKey;
      m.side = T.DoubleSide;
      m.clippingPlanes = sets[i];
      m.clipShadows = true;
      made[i].set(source, m);
    }
    return made[i].get(source);
  };
  host.updateMatrixWorld(true);
  host.traverseVisible(m => {
    if (!m.isMesh || !m.geometry?.attributes?.position) return;
    const source = m.userData.svOriginalMaterial || m.material;
    sets.forEach((clip, i) => {
      const material = Array.isArray(source) ? source.map(s => cut(s, i)) : cut(source, i);
      const copy = m.isInstancedMesh ? new T.InstancedMesh(m.geometry, material, m.count) : new T.Mesh(m.geometry, material);
      if (m.isInstancedMesh) { copy.instanceMatrix = m.instanceMatrix; copy.instanceColor = m.instanceColor; }
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(m.matrixWorld);
      copy.castShadow = m.castShadow; copy.receiveShadow = true;
      copy.layers.set(layer);
      copy.userData.clip = clip;
      copy.userData.interior = true;
      group.add(copy);
    });
  });
  return {group, planes, dispose() { group.removeFromParent(); for (const map of made) for (const m of map.values()) m.dispose(); }};
}
