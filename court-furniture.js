import * as T from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// Ghế băng và bồn cây cho sân lát gạch cam. Được dựng CÙNG lúc với mặt sân (campus-editor.js gọi mỗi lần dựng lại sân),
// nên luôn nằm đúng cao độ mặt sân và đi theo khi sân bị dời, ẩn hoặc ủi bỏ.
// Mặt sân dùng polygonOffset âm (kéo về phía camera để không bị cỏ đâm xuyên); đồ đạc phải dùng cùng độ lệch,
// nếu không phần chân ghế / thành bồn sẽ bị mặt sân vẽ đè lên.
const material = new T.MeshStandardMaterial({vertexColors: true, roughness: .85, flatShading: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6});

function part(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d, x, y, z, hex) => part(new T.BoxGeometry(w, h, d).translate(x, y, z), hex);
const WOOD = '#b9773f', LEG = '#3b4652', STONE = '#e6dccb', SOIL = '#4d6b3a', LEAF = '#3f8a3d';
// Ghế quay mặt về +z; bồn cây vuông có bụi cây cắt tỉa
const BENCH = mergeGeometries([
  box(1.5, .08, .44, 0, .44, 0, WOOD), box(1.5, .34, .07, 0, .72, -.2, WOOD),
  box(.08, .44, .4, -.6, .22, 0, LEG), box(.08, .44, .4, .6, .22, 0, LEG)
]);
const PLANTER = mergeGeometries([
  box(1.15, .42, 1.15, 0, .21, 0, STONE), box(.95, .06, .95, 0, .44, 0, SOIL),
  part(new T.IcosahedronGeometry(.5, 1).translate(0, .82, 0), LEAF), part(new T.IcosahedronGeometry(.3, 1).translate(.28, .62, .22), LEAF)
]);

export function buildCourtFurniture(c, {roads, terrain, levelY, sampleY}) {
  if (!c || c.hidden || c.kind || c.w < 4.5 || c.d < 2.8) return null;
  const hw = c.w / 2, hd = c.d / 2, rot = c.rotY || 0, cos = Math.cos(rot), sin = Math.sin(rot);
  const world = (lx, lz) => [c.x + lx * cos - lz * sin, c.z + lx * sin + lz * cos];
  const inRect = (x, z, q, pad) => {
    const r = q.rotY || 0, dx = x - q.x, dz = z - q.z, lx = dx * Math.cos(r) + dz * Math.sin(r), lz = -dx * Math.sin(r) + dz * Math.cos(r);
    return Math.abs(lx) < q.w / 2 + pad && Math.abs(lz) < q.d / 2 + pad;
  };
  const walks = [];
  for (const p of roads?.paths || []) {
    if (p.hidden || p.class !== 1 || !p.curve) continue;
    const n = Math.max(2, Math.ceil(p.curve.getLength() / .6));
    for (let i = 0; i <= n; i++) { const q = p.curve.getPointAt(i / n); walks.push([q.x, q.z, (p.width || 2) / 2]); }
  }
  const placed = [];
  function blocked(x, z, r) {
    for (const f of placed) if (Math.hypot(x - f[0], z - f[1]) < r + f[2]) return true;
    for (const p of terrain?.pads || []) if (Math.abs(x - p.x) < p.hx + r + .25 && Math.abs(z - p.z) < p.hz + r + .25) return true;
    for (const s of terrain?.stairDefs || []) {
      const along = (s.start + s.end) / 2, ha = Math.abs(s.end - s.start) / 2 + r + 1, hc = s.width / 2 + r + .6;
      const [dx, dz] = s.axis === 'x' ? [x - along, z - s.cross] : [z - along, x - s.cross];
      if (Math.abs(dx) < ha && Math.abs(dz) < hc) return true;
    }
    // Thềm đá (kind khác 0) chỉ là lớp sơn nằm dưới mặt sân, đầu bậc thang đã được chừa ở trên: không tính là vật cản
    for (const o of terrain?.courts || []) if (o !== c && !o.hidden && !o.kind && inRect(x, z, o, r * .5)) return true;
    // Không đặt lên lối đi bộ đang dẫn vào sân
    for (const w of walks) if (Math.hypot(x - w[0], z - w[1]) < w[2] + r * .5) return true;
    return false;
  }
  const geos = [], m = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), one = new T.Vector3(1, 1, 1);
  function place(geo, lx, lz, yawLocal, r) {
    const [x, z] = world(lx, lz);
    if (blocked(x, z, r)) return false;
    const y = levelY ?? sampleY(x, z);
    placed.push([x, z, r]);
    geos.push(geo.clone().applyMatrix4(m.compose(new T.Vector3(x, y, z), q.setFromAxisAngle(up, yawLocal - rot), one)));
    return true;
  }
  // Bồn cây ở bốn góc (sân hẹp: hai đầu); góc bị lối đi / bậc thang chiếm thì lùi dần vào dọc cạnh dài, không vượt qua giữa sân
  const narrow = c.d < 5.5, inset = .95;
  for (const [sx, sz] of narrow ? [[-1, 0], [1, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    for (let k = 0, lx; k < 3 && (lx = hw - inset - k * 1.7) > .6 && !place(PLANTER, sx * lx, sz * (hd - inset), 0, .7); k++);
  // Ghế băng dọc cạnh dài quay vào giữa sân; trùng bồn cây thì dịch ghế dọc cạnh (ưu tiên về phía giữa sân)
  const slots = Math.max(1, Math.min(4, Math.floor((c.w - 5) / 5))), spacing = Math.min(6.5, (c.w - 4) / slots);
  for (let i = 0; i < slots; i++) {
    const lx = (i - (slots - 1) / 2) * spacing, inward = lx > 0 ? -1 : 1;
    for (const side of [1, -1]) {
      const ok = [0, 1, -1, 2].some(k => place(BENCH, lx + inward * k * 1.1, side * (hd - .5), side < 0 ? 0 : Math.PI, .8));
      if (ok && narrow) break; // sân hẹp chỉ đủ chỗ cho một hàng ghế
    }
  }
  if (!geos.length) return null;
  const mesh = new T.Mesh(mergeGeometries(geos), material);
  mesh.name = `court_furniture_${c.id}`;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
