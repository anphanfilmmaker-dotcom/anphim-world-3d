import * as T from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {createUrbanPlanningEngine} from './urban-planning-engine.js';

// Lớp cây xanh đa tầng theo ảnh tham chiếu "AN PHIM World Campus Builder":
// vườn có hàng rào cây cắt tỉa + cây tán tròn nở hoa, thông sẫm, cây tán đa diện sáng, đá cảnh, đèn lối đi.
// Mọi vị trí được tính tự động từ khoảng trống thật của campus (không đè nhà, đường, sân, cầu thang, cây có sẵn)
// và dùng seed cố định nên bố cục giống nhau ở mỗi lần tải.
export function createCampusGreenery(scene, L, terrain, roads, landscape, layers, report) {
  const root = new T.Group();
  root.name = 'campus-greenery-layers';
  scene.add(root);
  // Cây và hàng rào nằm trong layer canopy/shrubs có sẵn để các nút ẩn/hiện layer và Massing Review áp dụng luôn cho chúng.
  const canopyGroup = new T.Group(), shrubGroup = new T.Group();
  canopyGroup.name = 'campus-greenery-canopy-layer';
  shrubGroup.name = 'campus-greenery-shrub-layer';
  (layers?.canopy || root).add(canopyGroup);
  (layers?.shrubs || root).add(shrubGroup);

  let seed = 90210;
  const rand = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const urban = createUrbanPlanningEngine(L, terrain);

  // ---- Bản đồ chiếm chỗ -------------------------------------------------------------------
  const disks = [];
  const rects = [];
  let ring = [];
  for (const p of roads.paths) {
    if (p.hidden || !p.curve) continue;
    const half = (p.width || 2) / 2 + (p.class === 1 ? .55 : 2.6);
    const n = Math.max(2, Math.ceil(p.curve.getLength() / .8));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const q = p.curve.getPointAt(Math.min(1, i / n));
      disks.push({x: q.x, z: q.z, r: half, walk: p.class === 1});
      pts.push(q);
    }
    if (p.id === 'road:campus-ring') ring = pts;
  }
  for (const p of terrain.pads) rects.push({x: p.x, z: p.z, hx: p.hx + 1.3, hz: p.hz + 1.3, cos: 1, sin: 0});
  for (const c of terrain.courts) {
    if (c.hidden) continue;
    const rot = c.rotY || 0;
    rects.push({x: c.x, z: c.z, hx: c.w / 2 + .7, hz: c.d / 2 + .7, cos: Math.cos(-rot), sin: Math.sin(-rot)});
  }
  for (const s of terrain.stairDefs) {
    const along = (s.start + s.end) / 2, halfAlong = Math.abs(s.end - s.start) / 2 + 1.6, halfAcross = s.width / 2 + 1;
    rects.push(s.axis === 'x' ? {x: along, z: s.cross, hx: halfAlong, hz: halfAcross, cos: 1, sin: 0} : {x: s.cross, z: along, hx: halfAcross, hz: halfAlong, cos: 1, sin: 0});
  }
  for (const t of landscape?.trees || []) disks.push({x: t.x, z: t.z, r: 1.6, soft: true});

  // Vật thể cảnh quan đã dựng sẵn trong scene (bồn cây, ghế, kiosk, khu VistaX...): lấy theo bounding box thật.
  scene.updateMatrixWorld(true);
  const box = new T.Box3(), m4 = new T.Matrix4(), v3 = new T.Vector3();
  const skip = new Set(['continuous-ground', 'river-only', root.name, 'anphim-modular-road-network']);
  for (const top of scene.children) {
    if (skip.has(top.name) || !top.visible || top.isLight || top.name.startsWith('building_')) continue;
    top.traverse(o => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m4);
          v3.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
          disks.push({x: v3.x, z: v3.z, r: 1.3, soft: true, mesh: o, index: i});
        }
        return;
      }
      box.setFromObject(o);
      const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
      if (!isFinite(sx) || sx > 14 || sz > 14) return;
      let loose = false;
      for (let a = o.parent; a && a !== scene; a = a.parent) if (a.name === 'organic-bush-clusters' || a.name === 'hq-designed-gardens') loose = true;
      rects.push({x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, hx: sx / 2 + .5, hz: sz / 2 + .5, cos: 1, sin: 0, soft: loose && sx < 5 && sz < 5, obj: o});
    });
  }
  const vistax = scene.getObjectByName('district-vistax-partner-campus');
  if (vistax) {
    box.setFromObject(vistax);
    if (isFinite(box.min.x)) rects.push({x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, hx: (box.max.x - box.min.x) / 2 + 3, hz: (box.max.z - box.min.z) / 2 + 3, cos: 1, sin: 0});
  }

  const CELL = 6, bins = new Map();
  const binKey = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
  function addDisk(d) {
    for (let gx = Math.floor((d.x - d.r) / CELL); gx <= Math.floor((d.x + d.r) / CELL); gx++)
      for (let gz = Math.floor((d.z - d.r) / CELL); gz <= Math.floor((d.z + d.r) / CELL); gz++) {
        const k = gx + ',' + gz;
        if (!bins.has(k)) bins.set(k, []);
        bins.get(k).push(d);
      }
  }
  disks.forEach(addDisk);

  function insideRing(x, z) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }
  // ignoreSoft: bỏ qua cây/bụi rời có sẵn (vườn rào được ưu tiên và sẽ dọn chúng khỏi lòng vườn)
  function free(x, z, r, ignoreSoft = false) {
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++)
        for (const d of bins.get(gx + ',' + gz) || []) {
          if (d.gone || (ignoreSoft && d.soft)) continue;
          const dx = x - d.x, dz = z - d.z, rr = d.r + r;
          if (dx * dx + dz * dz < rr * rr) return false;
        }
    for (const q of rects) {
      if (q.gone || (ignoreSoft && q.soft)) continue;
      const dx = x - q.x, dz = z - q.z, lx = dx * q.cos - dz * q.sin, lz = dx * q.sin + dz * q.cos;
      if (Math.abs(lx) < q.hx + r && Math.abs(lz) < q.hz + r) return false;
    }
    if (urban.isInsideUTurnCorridor(x, z, r + 1) || urban.isInsideHQForecourt(x, z, r + 1)) return false;
    if (Math.abs(z - terrain.riverZ(x)) < terrain.riverR(x) + 3.5 + r) return false;
    return true;
  }
  const occupy = (x, z, r) => addDisk({x, z, r});
  function walkDistance(x, z) {
    let best = Infinity;
    for (const d of disks) if (d.walk) best = Math.min(best, Math.hypot(x - d.x, z - d.z));
    return best;
  }

  // ---- Hình khối & vật liệu ----------------------------------------------------------------
  // Mỗi cây / đèn là MỘT instance (thân + tán gộp chung geometry, màu theo vertex color),
  // nên công cụ ủi trong editor xoá trọn cả cây chứ không để lại tán lơ lửng.
  const material = new T.MeshStandardMaterial({vertexColors: true, roughness: .9, flatShading: true});
  function jitter(geo, amount) {
    const p = geo.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
      if (!seen.has(k)) seen.set(k, 1 + (rand() - .5) * amount);
      const f = seen.get(k);
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
    }
    return geo;
  }
  function part(geo, hex, boost = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo, c = new T.Color(hex).multiplyScalar(boost), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    return g;
  }
  const TRUNK = '#8a5a38', trunk = (h, top = .12, bottom = .18) => part(new T.CylinderGeometry(top, bottom, h, 6).translate(0, h / 2, 0), TRUNK);
  const petals = [];
  for (let i = 0; i < 14; i++) {
    const a = rand() * 6.28, e = .15 + rand() * 1.2;
    petals.push(part(new T.IcosahedronGeometry(.07, 0).translate(Math.cos(a) * Math.sin(e), 1.75 + Math.cos(e) * .96, Math.sin(a) * Math.sin(e)), '#fff8ec'));
  }
  const G = {
    hedge: part(new T.BoxGeometry(1, 1, 1).translate(0, .5, 0), '#3f8a3d'),
    bush: part(jitter(new T.IcosahedronGeometry(1, 1), .1), '#3f8a3d'),
    round: mergeGeometries([trunk(1.3), part(jitter(new T.IcosahedronGeometry(1, 1), .22).translate(0, 1.75, 0), '#84c14c')]),
    pine: mergeGeometries([
      trunk(.6, .1, .15),
      part(new T.ConeGeometry(1, 1.5, 7).translate(0, 1.15, 0), '#2f7a48'),
      part(new T.ConeGeometry(.78, 1.3, 7).translate(0, 2, 0), '#2f7a48'),
      part(new T.ConeGeometry(.52, 1.15, 7).translate(0, 2.8, 0), '#2f7a48')
    ]),
    bloom: mergeGeometries([trunk(1.3), part(jitter(new T.IcosahedronGeometry(1, 2), .08).translate(0, 1.75, 0), '#4c9a3f'), ...petals]),
    rock: part(jitter(new T.IcosahedronGeometry(1, 0), .5).translate(0, .45, 0), '#a3a9ae'),
    lamp: mergeGeometries([
      part(new T.CylinderGeometry(.045, .06, 1.55, 6).translate(0, .775, 0), '#46515e'),
      part(new T.SphereGeometry(.13, 10, 8).translate(0, 1.62, 0), '#fff3cf', 1.5)
    ])
  };
  const STONE = '#e6dccb';
  G.gate = mergeGeometries([
    part(new T.BoxGeometry(1.15, .3, 1.15).translate(0, .15, 0), '#cfc6b4'),
    part(new T.BoxGeometry(.85, 2.1, .85).translate(0, 1.35, 0), STONE),
    part(new T.BoxGeometry(.87, .28, .87).translate(0, 1.15, 0), '#e8833a'),
    part(new T.BoxGeometry(1.1, .2, 1.1).translate(0, 2.5, 0), '#cfc6b4'),
    part(new T.BoxGeometry(.42, .42, .42).translate(0, 2.81, 0), '#fff3cf', 1.5)
  ]);
  const GROUP_OF = {gate: root, round: canopyGroup, pine: canopyGroup, bloom: canopyGroup, hedge: shrubGroup, bush: shrubGroup, rock: root, lamp: root};

  const batches = new Map();
  function put(kind, x, y, z, sx, sy, sz, yaw = 0, color = null, shadow = true) {
    const k = kind + '|' + shadow;
    if (!batches.has(k)) batches.set(k, {kind, shadow, items: []});
    batches.get(k).items.push({x, y, z, sx, sy, sz, yaw, color});
  }
  const ground = (x, z) => terrain.height(x, z);
  // Biến thiên màu nhẹ từng cây: hệ số nhân quanh 1 (nhân với vertex color)
  const tint = spread => new T.Color(1 + (rand() - .5) * spread, 1 + (rand() - .5) * spread * .6, 1 + (rand() - .5) * spread);

  function roundTree(x, z, s) {
    const r = (1.2 + rand() * .25) * s;
    put('round', x, ground(x, z), z, r, r * (.94 + rand() * .12), r, rand() * 6.28, tint(.22));
    occupy(x, z, 1.5 * s);
  }
  function pineTree(x, z, s) {
    put('pine', x, ground(x, z), z, s * 1.15, s * 1.35, s * 1.15, rand() * 6.28, tint(.16));
    occupy(x, z, 1.25 * s);
  }
  function rock(x, z, s) {
    put('rock', x, ground(x, z) - .08 * s, z, s * (.8 + rand() * .5), s * (.55 + rand() * .3), s * (.7 + rand() * .4), rand() * 6.28);
    occupy(x, z, .9 * s);
  }

  const surface = terrain.surfaceHeight || terrain.height;
  // Dọn cây/bụi rời có sẵn nằm trong một ô chữ nhật (lòng vườn rào, chỗ đặt bảng tên)
  const zero = new T.Matrix4().makeScale(0, 0, 0), touched = new Set();
  function clearSoft(cx, cz, hx, hz) {
    const inside = q => Math.abs(q.x - cx) < hx && Math.abs(q.z - cz) < hz;
    for (const d of disks) if (d.soft && !d.gone && inside(d)) { d.gone = true; if (d.mesh) { d.mesh.setMatrixAt(d.index, zero); touched.add(d.mesh); } }
    for (const q of rects) if (q.soft && !q.gone && inside(q)) { q.gone = true; q.obj.visible = false; }
  }
  // ---- 0. Trụ cổng ở hai đầu đường vòng đón khách (U-turn) ------------------------------------------
  const arrival = roads.paths.find(p => p.id === 'road:HQ-arrival' && p.curve && !p.hidden);
  let gateCount = 0;
  if (arrival) {
    const len = arrival.curve.getLength(), setback = Math.min(.2, 5.5 / len);
    // Vỉa hè ngoài của đường vòng (hq-gardens.js) rộng tới 1.35 m tính từ mép đường: trụ đứng trên cỏ, sát mép ngoài vỉa hè
    const GATE_SCALE = 1.25, off = (arrival.width || 4) / 2 + 1.35 + 1.15 * GATE_SCALE / 2 + .1;
    for (const [t, side] of [[setback, 1], [1 - setback, 1]]) {
      const q = arrival.curve.getPointAt(t), tan = arrival.curve.getTangentAt(t);
      // Trụ nằm phía ngoài vòng U (xa tâm đảo)
      const centre = arrival.curve.getPointAt(.5), nx = -tan.z, nz = tan.x, out = Math.sign((q.x - centre.x) * nx + (q.z - centre.z) * nz) || side;
      const x = q.x + nx * out * off, z = q.z + nz * out * off;
      put('gate', x, surface(x, z), z, GATE_SCALE, GATE_SCALE, GATE_SCALE, Math.atan2(tan.x, tan.z));
      gateCount++;
    }
    // Bảng tên campus đặt trên bãi cỏ cạnh cổng, quay ra đường chính
    const a = arrival.curve.getPointAt(0), b = arrival.curve.getPointAt(1), left = a.x < b.x ? a : b;
    let spot = null;
    for (let dz = 4; dz <= 12 && !spot; dz += .75) for (let dx = 8; dx <= 34 && !spot; dx += 1) {
      const x = left.x - dx, z = left.z - dz;
      let ok = true;
      for (let i = -2; i <= 2 && ok; i++) if (!free(x + i * 1.5, z, .7, true) || !free(x + i * 1.5, z + 1, .5, true)) ok = false;
      if (ok) spot = {x, z};
    }
    if (spot) {
      clearSoft(spot.x, spot.z, 4.4, 2.2);
      const signGroup = new T.Group();
      signGroup.name = 'campus-entrance-sign';
      const y = ground(spot.x, spot.z), std = hex => new T.MeshStandardMaterial({color: hex, roughness: .8});
      const add = (geo, mat, px, py, pz) => { const m = new T.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; signGroup.add(m); return m; };
      add(new T.BoxGeometry(6.4, .35, 1.3), std(STONE), 0, .175, 0);
      add(new T.BoxGeometry(5.6, 1.5, .34), std('#27323d'), 0, 1.15, 0);
      add(new T.BoxGeometry(5.9, .2, .6), std('#e8833a'), 0, 2, 0);
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#27323d'; ctx.fillRect(0, 0, 1024, 256);
      ctx.fillStyle = '#fff3cf'; ctx.font = 'bold 132px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('AN PHIM WORLD', 512, 134, 960);
      const tex = new T.CanvasTexture(canvas);
      tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
      const face = add(new T.PlaneGeometry(5.4, 1.35), new T.MeshBasicMaterial({map: tex, toneMapped: false}), 0, 1.15, .175);
      face.castShadow = false;
      signGroup.position.set(spot.x, y, spot.z);
      root.add(signGroup);
      for (let i = -3; i <= 3; i++) { const bs = .5 + rand() * .15; put('bush', spot.x + i * .95, y + bs * .55, spot.z + .95, bs, bs * .8, bs, rand() * 6.28); }
      occupy(spot.x - 2, spot.z, 2.2); occupy(spot.x + 2, spot.z, 2.2);
    }
  }

  // ---- 1. Vườn rào cây cắt tỉa + cây tán tròn nở hoa -------------------------------------------
  const parterres = [];
  const sizes = [[9, 6.4], [6.4, 8.4], [7.4, 5.6], [6.4, 4.8], [5.2, 5.2], [4.6, 4.6], [4.2, 3.8]];
  const candidates = [];
  for (let x = -58; x <= 62; x += 1.5) for (let z = -46; z <= 42; z += 1.5) {
    if (!insideRing(x, z)) continue;
    const d = walkDistance(x, z);
    if (d < 14) candidates.push({x, z, d});
  }
  // Vườn rào định sẵn quanh HQ, quảng trường và đường vòng (landscapePlan.hedgedGardens trong physical-topology.json):
  // mỗi ô được thử ở đúng kích thước, vướng thì thu nhỏ dần cho tới khi lọt vào khoảng trống.
  function fits(x, z, w, d, r) {
    let lo = Infinity, hi = -Infinity;
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const px = x + i * w / 8, pz = z + j * d / 8, h = ground(px, pz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      if (!free(px, pz, r, true) || !insideRing(px, pz)) return false;
    }
    return hi - lo <= 3.2; // vườn định sẵn nằm trên mái dốc quanh nền HQ: hàng rào bám theo địa hình
  }
  const SHRINK = [1, .92, .84, .76, .68];
  for (const [x, z, w, d] of L.landscapePlan?.hedgedGardens || []) {
    let best = null;
    for (const fw of SHRINK) for (const fd of SHRINK) {
      if (best && fw * fd <= best.w * best.d / (w * d)) continue;
      if (fits(x, z, w * fw, d * fd, .2)) best = {x, z, w: w * fw, d: d * fd, seeded: true};
    }
    if (best) parterres.push(best);
  }
  const seededCount = parterres.length;
  candidates.sort((a, b) => a.d - b.d);
  const open = candidates.filter(c => free(c.x, c.z, 1.6, true));
  // Vườn lớn được xếp trước (ảnh tham chiếu dùng các ô vườn rào lớn), cỡ nhỏ lấp các khoảng còn lại
  for (const [w, d] of sizes) {
    const hw = w / 2, hd = d / 2;
    for (const c of open) {
      if (parterres.length >= seededCount + 13) break;
      if (parterres.some(p => Math.abs(p.x - c.x) < (p.w + w) / 2 + 2 && Math.abs(p.z - c.z) < (p.d + d) / 2 + 2)) continue;
      let ok = true, lo = Infinity, hi = -Infinity;
      for (let i = -3; i <= 3 && ok; i++) for (let j = -3; j <= 3 && ok; j++) {
        const px = c.x + i * hw / 3, pz = c.z + j * hd / 3, h = ground(px, pz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
        if (!free(px, pz, .45, true) || !insideRing(px, pz)) ok = false;
      }
      if (ok && hi - lo <= 1.1) parterres.push({x: c.x, z: c.z, w, d});
    }
  }
  // Hàng rào ghép từ các đoạn ngắn bám theo cao độ địa hình (campus có dốc nhẹ).
  function hedgeRun(x0, z0, x1, z1, th, hh) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 1.1)), alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i < n; i++) {
      const t = (i + .5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, seg = len / n + .04;
      put('hedge', x, ground(x, z) - .12, z, alongX ? seg : th, hh + .12, alongX ? th : seg);
    }
  }
  // Giữ chỗ toàn bộ các ô vườn trước khi trồng, để cây góc vườn này không mọc vào lòng vườn khác
  for (const p of parterres) rects.push({x: p.x, z: p.z, hx: p.w / 2 + .35, hz: p.d / 2 + .35, cos: 1, sin: 0});
  let roundCount = 0, pineCount = 0, rockCount = 0;
  for (const p of parterres) {
    const hw = p.w / 2, hd = p.d / 2, th = .55, hh = .6, gap = 1.3, in_ = th / 2;
    clearSoft(p.x, p.z, hw + .9, hd + .9);
    hedgeRun(p.x - hw, p.z - hd + in_, p.x + hw, p.z - hd + in_, th, hh);
    hedgeRun(p.x - hw + in_, p.z - hd + th, p.x - hw + in_, p.z + hd - th, th, hh);
    hedgeRun(p.x + hw - in_, p.z - hd + th, p.x + hw - in_, p.z + hd - th, th, hh);
    hedgeRun(p.x - hw, p.z + hd - in_, p.x - gap / 2, p.z + hd - in_, th, hh);
    hedgeRun(p.x + gap / 2, p.z + hd - in_, p.x + hw, p.z + hd - in_, th, hh);
    // Vườn dài trồng hai cây nở hoa dọc trục dài, vườn vuông một cây giữa
    const longX = p.w >= p.d, span = Math.max(hw, hd), pair = span >= 3.4;
    const r = Math.min(Math.min(hw, hd) * .52, 2.1, pair ? span * .5 : 9);
    for (const o of pair ? [-span * .45, span * .45] : [0]) {
      const tx = p.x + (longX ? o : 0), tz = p.z + (longX ? 0 : o), ts = r * (.92 + rand() * .16);
      put('bloom', tx, ground(tx, tz), tz, ts, ts, ts, rand() * 6.28);
    }
    // Cây thông / cây tán nhỏ đứng ngoài góc vườn như ảnh tham chiếu
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (rand() < .4) continue;
      const cx = p.x + ox * (hw + 1.1), cz = p.z + oz * (hd + 1.1), cs = .7 + rand() * .25;
      if (!free(cx, cz, 1.05)) continue;
      if (rand() < .6) { pineTree(cx, cz, cs); pineCount++; } else { roundTree(cx, cz, cs * .9); roundCount++; }
    }
    for (const [ox, oz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      if (rand() < .35) continue;
      const bx = p.x + ox * (hw - th - .55), bz = p.z + oz * (hd - th - .55), bs = .32 + rand() * .14;
      put('bush', bx, ground(bx, bz) + bs * .6, bz, bs, bs * .8, bs, rand() * 6.28, null, false);
    }
    // Lòng vườn: cụm bụi thấp sát hàng rào và một tảng đá cảnh, như các ô vườn trong ảnh tham chiếu
    for (let k = 0, n = 2 + Math.floor(rand() * 3); k < n; k++) {
      const side = rand() < .5 ? -1 : 1, t = (rand() - .5) * 1.5, bs = .36 + rand() * .2;
      const bx = p.x + (longX ? t * (hw - th - .6) : side * (hw - th - .6)), bz = p.z + (longX ? side * (hd - th - .6) : t * (hd - th - .6));
      put('bush', bx, ground(bx, bz) + bs * .6, bz, bs, bs * .8, bs, rand() * 6.28, null, false);
    }
    if (rand() < .6) {
      const rx = p.x + (longX ? 0 : (rand() - .5) * hw * .6), rz = p.z + (longX ? (rand() - .5) * hd * .6 : 0), rs = .3 + rand() * .2;
      put('rock', rx, ground(rx, rz) - .08 * rs, rz, rs, rs * .7, rs * .9, rand() * 6.28);
      rockCount++;
    }
  }

  for (const mesh of touched) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }

  // ---- 2. Cây đa tầng: thông sẫm + cây tán đa diện sáng (trong campus và vành ngoài) ---------------
  function scatter(count, tries, pick, accept) {
    let placed = 0;
    for (let i = 0; i < tries && placed < count; i++) {
      const [x, z] = pick();
      if (!accept(x, z)) continue;
      const s = .95 + rand() * .5;
      if (rand() < .42) { pineTree(x, z, s); pineCount++; } else { roundTree(x, z, s); roundCount++; }
      placed++;
      // Cụm 2-3 cây cạnh nhau cho cảm giác tự nhiên
      for (let k = 0, n = rand() < .45 ? 1 + Math.floor(rand() * 2) : 0; k < n; k++) {
        const a = rand() * 6.28, d = 2.3 + rand() * 1.2, cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d;
        if (!accept(cx, cz)) continue;
        const cs = .8 + rand() * .35;
        if (rand() < .5) { pineTree(cx, cz, cs); pineCount++; } else { roundTree(cx, cz, cs); roundCount++; }
        placed++;
      }
    }
  }
  scatter(95, 6000, () => [-60 + rand() * 124, -48 + rand() * 92], (x, z) => insideRing(x, z) && free(x, z, 1.7));
  scatter(120, 8000, () => [-108 + rand() * 216, -62 + rand() * 118], (x, z) => !insideRing(x, z) && free(x, z, 2.6));

  // ---- 3. Đá cảnh ---------------------------------------------------------------------------
  for (let i = 0; i < 4000 && rockCount < 70; i++) {
    const x = -70 + rand() * 144, z = -52 + rand() * 104;
    if (!free(x, z, .9)) continue;
    rock(x, z, .45 + rand() * .45);
    rockCount++;
    if (rand() < .4) { const a = rand() * 6.28; const rx = x + Math.cos(a) * .9, rz = z + Math.sin(a) * .9; if (free(rx, rz, .3)) { rock(rx, rz, .28 + rand() * .2); rockCount++; } }
  }

  // ---- 3b. Bụi thấp viền lối đi bộ (ảnh tham chiếu có cây bụi tròn dọc các lối đi) ---------------------
  let shrubCount = 0;
  for (let i = 0; i < 20000 && shrubCount < 90; i++) {
    const x = -58 + rand() * 120, z = -46 + rand() * 88;
    if (!insideRing(x, z)) continue;
    const wd = walkDistance(x, z);
    if (wd < 1.8 || wd > 5 || !free(x, z, .7)) continue;
    const bs = .42 + rand() * .26;
    put('bush', x, ground(x, z) + bs * .55, z, bs, bs * .8, bs, rand() * 6.28, null, false);
    occupy(x, z, .7);
    shrubCount++;
    if (rand() < .5) { const a = rand() * 6.28, cx = x + Math.cos(a) * .85, cz = z + Math.sin(a) * .85, cs = bs * .7; if (free(cx, cz, .3) && walkDistance(cx, cz) > 1.7) { put('bush', cx, ground(cx, cz) + cs * .55, cz, cs, cs * .8, cs, rand() * 6.28, null, false); shrubCount++; } }
  }

  // ---- 4. Đèn lối đi dọc đường đi bộ ------------------------------------------------------------
  let lampCount = 0;
  for (const p of roads.paths) {
    if (p.hidden || p.class !== 1 || !p.curve) continue;
    const len = p.curve.getLength(), n = Math.floor(len / 7);
    for (let i = 1; i <= n; i++) {
      const t = (i - .5) / n, q = p.curve.getPointAt(t), tan = p.curve.getTangentAt(t), side = i % 2 ? 1 : -1;
      const x = q.x - tan.z * side * ((p.width || 2) / 2 + .45), z = q.z + tan.x * side * ((p.width || 2) / 2 + .45);
      let clear = !urban.isInsideUTurnCorridor(x, z, .6) && !urban.isInsideHQForecourt(x, z, .6);
      for (const r of rects) { const dx = x - r.x, dz = z - r.z, lx = dx * r.cos - dz * r.sin, lz = dx * r.sin + dz * r.cos; if (Math.abs(lx) < r.hx && Math.abs(lz) < r.hz) { clear = false; break; } }
      for (const d of disks) if (clear && d.walk && Math.hypot(x - d.x, z - d.z) < d.r - .35) clear = false;
      if (!clear) continue;
      put('lamp', x, ground(x, z), z, 1, 1, 1);
      lampCount++;
    }
  }

  // ---- Dựng InstancedMesh ---------------------------------------------------------------------
  const o = new T.Object3D();
  for (const [key, b] of batches) {
    const mesh = new T.InstancedMesh(G[b.kind], material, b.items.length);
    mesh.name = 'greenery:' + key;
    b.items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(0, it.yaw, 0);
      o.scale.set(it.sx, it.sy, it.sz);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    mesh.userData.campusGreenery = true;
    if (b.kind === 'gate') mesh.userData.keepInArrivalZone = true;
    mesh.computeBoundingSphere();
    GROUP_OF[b.kind].add(mesh);
  }

  if (report) report.greenery = {parterres: parterres.length, roundTrees: roundCount, pines: pineCount, rocks: rockCount, pathShrubs: shrubCount, pathLamps: lampCount, gatePillars: gateCount, drawCalls: batches.size, placement: 'auto: free-space map of pads, courts, stairs, roads, walks, existing landscape; fixed seed'};
  return {root, parterres, free};
}
