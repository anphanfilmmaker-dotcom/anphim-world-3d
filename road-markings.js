import * as T from 'three';

/**
 * Cơ chế vạch kẻ đường theo mạng lưới (road network markings).
 * Đầu vào là danh sách tuyến đường xe chạy: {id, curve, halfW, closed, yAt(x,z), center, edges, walkW, group}.
 * Module tự tìm giao lộ (ngã ba: đầu một tuyến chạm vào tuyến khác; ngã tư: hai tuyến cắt nhau) rồi sinh:
 * vạch tim đứt đoạn, vạch mép liền, vạch dừng và vạch qua đường (zebra) ở từng nhánh của giao lộ.
 * Không tuyến nào được vẽ vạch xuyên qua lòng giao lộ.
 */
const ZEBRA_DEPTH = 2.2, ZEBRA_BAR = 0.45, ZEBRA_PITCH = 0.9, ZEBRA_SETBACK = 0.5;
const STOP_GAP = 0.6, STOP_T = 0.32, LINK_SPARE = 4, MIN_HALF = 1.5, DASH = 2.0, DASH_GAP = 2.2, EDGE_INSET = 0.38;

function sampleRoad(def) {
  const len = def.curve.getLength(), n = Math.max(2, Math.round(len / 0.5)), pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = def.curve.getPointAt(u), t = def.curve.getTangentAt(Math.min(u, 0.999999));
    const l = Math.hypot(t.x, t.z) || 1;
    pts.push({x: p.x, z: p.z, tx: t.x / l, tz: t.z / l});
  }
  return {...def, len, n, ds: len / n, pts};
}

function at(r, s) {
  s = r.closed ? ((s % r.len) + r.len) % r.len : Math.min(r.len, Math.max(0, s));
  const f = s / r.ds, i = Math.min(r.n - 1, Math.floor(f)), k = f - i, a = r.pts[i], b = r.pts[i + 1];
  const tx = a.tx + (b.tx - a.tx) * k, tz = a.tz + (b.tz - a.tz) * k, l = Math.hypot(tx, tz) || 1;
  return {x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, tx: tx / l, tz: tz / l};
}

/** Tìm giao lộ và tính sẵn kích thước từng nhánh (arm). */
export function analyseRoadNetwork(defs) {
  const roads = defs.filter(d => d && d.curve && d.halfW >= MIN_HALF).map(sampleRoad);
  const junctions = [], ends = [];
  // Các khúc của cùng một con đường (tách ở chỗ quay đầu gấp) không tạo giao lộ với nhau
  const sameRoad = (a, b) => a.group != null && a.group === b.group;
  const add = (x, z, arms) => {
    let j = junctions.find(q => Math.hypot(q.x - x, q.z - z) < 3);
    if (!j) junctions.push(j = {x, z, arms: []});
    for (const a of arms) if (!j.arms.some(b => b.road === a.road && b.dir === a.dir)) j.arms.push(a);
  };
  const armsOf = (r, s) => {
    const out = [];
    if (r.closed || r.len - s > 1.5) out.push({road: r, s, dir: 1, off: 0});
    if (r.closed || s > 1.5) out.push({road: r, s, dir: -1, off: 0});
    return out;
  };
  const nearest = (r, x, z) => {
    let best = Infinity, bi = 0;
    for (let i = 0; i <= r.n; i++) { const p = r.pts[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) { best = d; bi = i; } }
    return {d: Math.sqrt(best), s: bi * r.ds};
  };

  // Ngã ba: đầu của một tuyến hở chạm vào thân một tuyến khác
  for (const a of roads) if (!a.closed) for (const sA of [0, a.len]) {
    const e = at(a, sA);
    for (const b of roads) if (b !== a && !sameRoad(a, b)) {
      const q = nearest(b, e.x, e.z), c = at(b, q.s);
      // Đầu đường phải thật sự chạm mặt nhựa của tuyến kia; đi vào xiên góc thì góc của đầu đường chạm trước tim đường
      // Đầu đường đã vượt qua tim tuyến kia: chỉ là ngã ba nếu nó dừng trong lòng mặt nhựa; vượt hẳn sang bên kia là giao cắt (xử lý bên dưới)
      const body = sA === 0 ? 1 : -1, past = ((e.x - c.x) * e.tx + (e.z - c.z) * e.tz) * body < 0;
      if (q.d > (past ? b.halfW : b.halfW + 0.3 + a.halfW * Math.abs(e.tx * c.tx + e.tz * c.tz))) continue;
      if (!b.closed && (q.s < 1.5 || b.len - q.s < 1.5)) continue; // hai đầu nối nhau = cùng một con đường đi tiếp
      add(c.x, c.z, [{road: a, s: sA, dir: sA === 0 ? 1 : -1, off: q.d}, ...armsOf(b, q.s)]);
      ends.push({x: c.x, z: c.z, a, b});
    }
  }
  // Ngã tư: hai tim đường cắt nhau
  for (let i = 0; i < roads.length; i++) for (let k = i + 1; k < roads.length; k++) {
    const a = roads[i], b = roads[k];
    if (sameRoad(a, b)) continue;
    for (let p = 0; p < a.n; p++) {
      const a0 = a.pts[p], a1 = a.pts[p + 1];
      for (let q = 0; q < b.n; q++) {
        const b0 = b.pts[q], b1 = b.pts[q + 1];
        if (Math.abs(a0.x - b0.x) > 2.5 || Math.abs(a0.z - b0.z) > 2.5) continue;
        const d = (a1.x - a0.x) * (b1.z - b0.z) - (a1.z - a0.z) * (b1.x - b0.x);
        if (Math.abs(d) < 1e-9) continue;
        const u = ((b0.x - a0.x) * (b1.z - b0.z) - (b0.z - a0.z) * (b1.x - b0.x)) / d;
        const v = ((b0.x - a0.x) * (a1.z - a0.z) - (b0.z - a0.z) * (a1.x - a0.x)) / d;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const x = a0.x + (a1.x - a0.x) * u, z = a0.z + (a1.z - a0.z) * u;
        // Chính cặp tuyến này đã tạo ngã ba ở đây (đầu tuyến chạm tuyến kia): không tính thêm một giao cắt nữa
        if (ends.some(e => ((e.a === a && e.b === b) || (e.a === b && e.b === a)) && Math.hypot(e.x - x, e.z - z) < 6)) continue;
        // Hai đoạn nối đuôi nhau (vd. hai nửa của một khúc cua gấp) không phải giao lộ
        const sa = (p + u) * a.ds, sb = (q + v) * b.ds;
        if (!a.closed && !b.closed && Math.min(sa, a.len - sa) < 1.5 && Math.min(sb, b.len - sb) < 1.5) continue;
        add(x, z, [...armsOf(a, sa), ...armsOf(b, sb)]);
      }
    }
  }

  for (const j of junctions) {
    for (const arm of j.arms) {
      const r = arm.road, h = at(r, arm.s);
      arm.dx = h.tx * arm.dir; arm.dz = h.tz * arm.dir;
    }
    for (const arm of j.arms) {
      let clear = 0;
      for (const o of j.arms) if (o.road !== arm.road) {
        const sin = Math.abs(arm.dx * o.dz - arm.dz * o.dx);
        clear = Math.max(clear, o.road.halfW / Math.max(0.6, sin));
      }
      arm.clear = clear + 0.3; // từ tâm giao lộ tới chỗ nhánh này rời khỏi lòng giao lộ
      arm.avail = arm.road.closed ? Infinity : (arm.dir > 0 ? arm.road.len - arm.s : arm.s) + arm.off;
    }
  }
  // Hai giao lộ sát nhau trên cùng một tuyến (vd. hai miệng đường vòng chữ U) được coi là một cụm: không kẻ vạch qua đường ở giữa
  for (const j of junctions) for (const arm of j.arms) {
    const r = arm.road;
    for (const k of junctions) if (k !== j) for (const o of k.arms) if (o.road === r) {
      let delta = (o.s - arm.s) * arm.dir;
      if (r.closed) delta = ((delta % r.len) + r.len) % r.len;
      // "Sát nhau" = khoảng giữa hai lòng giao lộ không đủ chỗ cho hai vạch qua đường, hai vạch dừng và một đoạn vạch tim
      const need = arm.clear + o.clear + 2 * (ZEBRA_SETBACK + ZEBRA_DEPTH + STOP_GAP + STOP_T) + LINK_SPARE;
      if (delta > 0.5 && delta < need && !(arm.linked < delta)) arm.linked = delta;
    }
    const z0 = arm.clear + ZEBRA_SETBACK, z1 = z0 + ZEBRA_DEPTH;
    arm.zebra = !arm.linked && arm.avail >= z1 + 0.3 ? [z0, z1] : null;
    arm.stop = arm.zebra && arm.avail >= z1 + STOP_GAP + STOP_T + 0.4 ? z1 + STOP_GAP : null;
    arm.quiet = arm.zebra ? (arm.stop ? arm.stop + STOP_T / 2 + 0.5 : z1 + 0.4) : arm.linked ? arm.linked / 2 + 0.01 : arm.clear + 0.4;
  }
  return {roads, junctions};
}

// Khoảng [D0, D1] tính từ tâm giao lộ dọc theo nhánh -> khoảng [s0, s1] trên tuyến
function span(arm, d0, d1) {
  const a = arm.s + arm.dir * (d0 - arm.off), b = arm.s + arm.dir * (d1 - arm.off);
  return [Math.min(a, b), Math.max(a, b)];
}

function freeIntervals(r, blocked) {
  const cuts = [];
  for (let [a, b] of blocked) {
    if (b - a >= r.len) return [];
    if (r.closed) {
      const w = b - a;
      a = ((a % r.len) + r.len) % r.len; b = a + w;
      if (b > r.len) { cuts.push([a, r.len], [0, b - r.len]); continue; }
    }
    cuts.push([Math.max(0, a), Math.min(r.len, b)]);
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const free = [];
  let cur = 0;
  for (const [a, b] of cuts) { if (a > cur + 1e-6) free.push([cur, a]); cur = Math.max(cur, b); }
  if (cur < r.len - 1e-6) free.push([cur, r.len]);
  if (r.closed && free.length > 1 && free[0][0] < 1e-6 && free[free.length - 1][1] > r.len - 1e-6) {
    const last = free.pop();
    free[0] = [last[0] - r.len, free[0][1]];
  }
  return free;
}

/** Các đoạn mà bó vỉa / vỉa hè / vạch mép ở phía `side` (+1: theo pháp tuyến (-tz, tx), -1: ngược lại) phải ngắt cho đường nhánh đi vào. */
export function sideOpenings(net, road, side, forCurb = false) {
  const out = [];
  for (const j of net.junctions) for (const arm of j.arms) if (arm.road === road) {
    const h = at(road, arm.s), nx = -h.tz * side, nz = h.tx * side;
    let reach = 0;
    for (const o of j.arms) if (o.road !== road && o.dx * nx + o.dz * nz > 0.3) {
      reach = Math.max(reach, forCurb ? arm.clear - 0.3 + (o.road.walkW || 0) : arm.clear + 0.3);
      if (forCurb && arm.linked) reach = Math.max(reach, arm.linked / 2 + 0.01);
    }
    if (reach > 0) out.push(span(arm, 0, reach));
  }
  return out;
}

export function isInside(intervals, road, s) {
  for (const [a, b] of intervals) {
    if (s >= a && s <= b) return true;
    if (road.closed && ((s + road.len >= a && s + road.len <= b) || (s - road.len >= a && s - road.len <= b))) return true;
  }
  return false;
}

/** Sinh danh sách hộp vạch sơn {x, y, z, rotY, w, d} cho toàn mạng lưới. */
export function buildMarkingBoxes(net) {
  const boxes = [];
  // Mỗi vạch nghiêng theo độ dốc dọc chiều dài của nó để không bị chìm một đầu trên mặt đường dốc
  const push = (r, x, z, tx, tz, w, d) => {
    const y0 = r.yAt(x - tx * d / 2, z - tz * d / 2), y1 = r.yAt(x + tx * d / 2, z + tz * d / 2);
    boxes.push({x, y: Math.max((y0 + y1) / 2, r.yAt(x, z)), z, rotY: Math.atan2(tx, tz), pitch: -Math.atan2(y1 - y0, d), w, d});
  };
  const chord = (r, s0, s1, lateral, w) => {
    const a = at(r, s0), b = at(r, s1);
    const ax = a.x - a.tz * lateral, az = a.z + a.tx * lateral, bx = b.x - b.tz * lateral, bz = b.z + b.tx * lateral;
    const d = Math.hypot(bx - ax, bz - az);
    if (d > 0.05) push(r, (ax + bx) / 2, (az + bz) / 2, (bx - ax) / d, (bz - az) / d, w, d);
  };
  for (const r of net.roads) {
    const arms = net.junctions.flatMap(j => j.arms.filter(a => a.road === r));
    if (r.center !== false) {
      for (const [a, b] of freeIntervals(r, arms.map(arm => span(arm, 0, arm.quiet)))) {
        const L = b - a, n = Math.floor((L + DASH_GAP) / (DASH + DASH_GAP));
        const start = a + (L - (n * DASH + (n - 1) * DASH_GAP)) / 2;
        for (let i = 0; i < n; i++) chord(r, start + i * (DASH + DASH_GAP), start + i * (DASH + DASH_GAP) + DASH, 0, 0.14);
      }
    }
    if (r.edges !== false) for (const side of [1, -1]) {
      const blocked = sideOpenings(net, r, side);
      for (const arm of arms) if (arm.zebra) blocked.push(span(arm, arm.zebra[0] - 0.15, arm.zebra[1] + 0.15));
      for (const [a, b] of freeIntervals(r, blocked)) {
        const n = Math.max(1, Math.ceil((b - a) / 1.0)), step = (b - a) / n;
        for (let i = 0; i < n; i++) chord(r, a + i * step, a + (i + 1) * step + 0.01, side * (r.halfW - EDGE_INSET), 0.1);
      }
    }
    for (const arm of arms) {
      if (arm.zebra) {
        const mid = at(r, arm.s + arm.dir * ((arm.zebra[0] + arm.zebra[1]) / 2 - arm.off));
        const n = Math.max(2, Math.floor((2 * r.halfW - 0.5) / ZEBRA_PITCH));
        for (let i = 0; i < n; i++) {
          const o = (i - (n - 1) / 2) * ZEBRA_PITCH;
          push(r, mid.x - mid.tz * o, mid.z + mid.tx * o, mid.tx, mid.tz, ZEBRA_BAR, ZEBRA_DEPTH);
        }
      }
      if (arm.stop) {
        // Vạch dừng nằm ở làn bên phải của xe đang đi vào giao lộ
        const p = at(r, arm.s + arm.dir * (arm.stop - arm.off)), rx = arm.dz, rz = -arm.dx, o = r.halfW / 2;
        push(r, p.x + rx * o, p.z + rz * o, rx, rz, STOP_T, r.halfW - 0.3);
      }
    }
  }
  return boxes;
}

export function createMarkingMesh(boxes, material, name = 'road-markings-instanced') {
  const mesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), material, Math.max(1, boxes.length));
  mesh.name = name;
  mesh.count = boxes.length;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.studioPassThrough = true; // Studio bỏ qua khi chọn / ủi: vạch sơn không phải cây hay đồ vật
  mesh.userData.keepInArrivalZone = true; // vạch kẻ ở cổng không phải cảnh quan cần dọn khỏi vùng đón khách
  const dummy = new T.Object3D(), H = 0.012;
  dummy.rotation.order = 'YXZ';
  boxes.forEach((b, i) => {
    dummy.position.set(b.x, b.y + H / 2, b.z);
    dummy.rotation.set(b.pitch || 0, b.rotY, 0);
    dummy.scale.set(b.w, H, b.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
