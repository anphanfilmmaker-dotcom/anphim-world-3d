/**
 * district-landmarks.js
 * The landmark of a district, the thing it is known by from across the map: a lodge on the summit, a row of
 * letters on the hill, a club on the lagoon. Each one is listed on its slot in physical-topology.json
 * (`landmarks`: kind, `at` [x, z] in the world, `turn` in degrees), stands on the ground as it is and changes
 * none of it, so no district, client or project is named here. The boats on the sea are listed the same way.
 */
import * as T from 'three';
import {SEA_LEVEL} from './world-landscape.js';

/** How far around `at` a landmark keeps the wild trees away. */
export const LANDMARK_REACH = {'summit-lodge': 13, 'hill-sign': 5, lookout: 7, 'lagoon-club': 15, beach: 20, 'flower-hill': 17, 'rock-arch': 11};

/** The ground a landmark keeps free of trees: [x, z, radius] round it and, every 2 m, along its path. */
export function landmarkClearings(mark) {
  const reach = LANDMARK_REACH[mark.kind] || 0, out = mark.at ? [[mark.at[0], mark.at[1], reach]] : [], path = mark.path || [];
  // A landmark with a place of its own is reached by a footpath; one without is as long as its path.
  const r = mark.at ? 2.5 : reach;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let k = i ? 1 : 0; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n, r]);
  }
  return out;
}

const seeded = text => {
  let s = 2166136261;
  for (const ch of String(text)) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909);
    return ((s ^= s >>> 16) >>> 0) / 4294967296;
  };
};

export function createLandmarks({batch, mat, M, signTexture, plantTrees, ground, lampHead}) {
  const wood = mat(0x8a5a3c), darkWood = mat(0x4a3428), deck = mat(0xb98a5a), white = mat(0xf7f4ec), straw = mat(0xcaa560), sand = mat(0xf0deb0);
  const sail = mat(0xffffff, {side: T.DoubleSide}), stripes = [0xf2545b, 0xffffff, 0xf7b32b, 0x2bb3c0];

  /** A group standing on the ground at the landmark's place, +z turned to `turn`; `gy` is the ground under a point of it. */
  function site(mark) {
    const [x, z] = mark.at, turn = T.MathUtils.degToRad(mark.turn || 0), cos = Math.cos(turn), sin = Math.sin(turn), y = ground(x, z);
    const g = new T.Group(), b = batch(), lamps = [];
    g.position.set(x, y, z);
    g.rotation.y = turn;
    const world = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
    const local = (wx, wz) => [(wx - x) * cos - (wz - z) * sin, (wx - x) * sin + (wz - z) * cos];
    const gy = (lx, lz) => ground(...world(lx, lz)) - y;
    const finish = () => {
      b.build(g);
      if (lamps.length) {
        const heads = new T.InstancedMesh(lampHead, M.lampHead, lamps.length), m = new T.Matrix4();
        lamps.forEach(([lx, ly, lz], i) => heads.setMatrixAt(i, m.makeTranslation(lx, ly, lz)));
        heads.name = 'district-lamp-heads';
        g.add(heads);
      }
      return g;
    };
    /** A lamp on a pole, `h` above the ground at its foot. */
    const lamp = (lx, lz, h = 3.4, base = gy(lx, lz)) => {
      b.box(M.pole, 0.12, h, 0.12, lx, base, lz);
      lamps.push([lx, base + h + 0.06, lz]);
    };
    return {g, b, y, gy, world, local, lamp, finish, sea: SEA_LEVEL - y};
  }

  /** A bar between two points. */
  function beam(b, material, a, c, thick = 0.1) {
    const from = new T.Vector3(...a), to = new T.Vector3(...c), len = from.distanceTo(to);
    const geo = new T.BoxGeometry(len, thick, thick);
    geo.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), to.clone().sub(from).normalize()));
    b.solid(material, geo, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  }
  /** A gable roof, ridge along x: `w` long, `d` across, `h` high, its eaves at y. */
  function gable(b, material, w, d, h, x, y, z, ry = 0) {
    const s = new T.Shape();
    s.moveTo(-d / 2, 0);
    s.lineTo(d / 2, 0);
    s.lineTo(0, h);
    const geo = new T.ExtrudeGeometry(s, {depth: w, bevelEnabled: false}).translate(0, 0, -w / 2).rotateY(Math.PI / 2 + ry);
    b.solid(material, geo, x, y, z);
  }
  function umbrella(b, colour, x, y, z, r = 1.5) {
    b.box(M.pole, 0.09, 2.3, 0.09, x, y, z);
    b.solid(mat(colour), new T.ConeGeometry(r, 0.65, 10), x, y + 2.45, z);
  }
  function lounger(b, x, y, z, ry = 0) {
    b.box(white, 0.65, 0.22, 1.8, x, y + 0.12, z, ry);
    b.box(white, 0.65, 0.5, 0.14, x - Math.sin(ry) * 0.85, y + 0.2, z - Math.cos(ry) * 0.85, ry);
  }
  /** A walkway of planks on posts from (x, z0) out to (x, z1), its top at `top`, the posts down to `bed`. */
  function pier(b, x, z0, z1, top, bed, wide = 2.2) {
    b.box(deck, wide, 0.18, z1 - z0, x, top - 0.18, (z0 + z1) / 2);
    for (let z = z0 + 1; z <= z1; z += 3) for (const s of [-1, 1]) b.box(darkWood, 0.2, top - bed + 0.35, 0.2, x + s * (wide / 2 - 0.15), bed, z);
  }
  /** A ring of posts under a round roof. */
  function pavilion(b, roof, x, y, z, r = 2.4, h = 2.6) {
    b.solid(M.plaza, new T.CylinderGeometry(r + 0.5, r + 0.5, 0.18, 18), x, y + 0.09, z);
    for (let i = 0; i < 6; i++) b.box(white, 0.18, h, 0.18, x + Math.cos(i * Math.PI / 3) * r, y + 0.18, z + Math.sin(i * Math.PI / 3) * r);
    b.solid(roof, new T.ConeGeometry(r + 0.9, 1.5, 12), x, y + 0.18 + h + 0.75, z);
  }
  /** A ribbon laid on the ground along world points: a path to a landmark, the sand of a beach. */
  function ribbon(points, width, material, lift = 0.08, across = 4) {
    const v = points.map(p => new T.Vector3(p[0], 0, p[1]));
    const curve = v.length > 2 ? new T.CatmullRomCurve3(v, false, 'catmullrom', 0.3) : new T.LineCurve3(v[0], v[1]);
    const n = Math.max(2, Math.ceil(curve.getLength() / 1.1)), pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(i / n), t = curve.getTangentAt(i / n);
      for (let j = 0; j <= across; j++) {
        const o = (j / across - 0.5) * width, x = p.x - t.z * o, z = p.z + t.x * o;
        pos.push(x, ground(x, z) + lift, z);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j, c = a + across + 1;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  const KINDS = {
    /** A lodge on a stone footing that caps the summit, and a cable car up to it from `cable` [x, z]. */
    'summit-lodge'(mark, {accent}) {
      const s = site(mark), {b} = s, floor = 0.25;
      b.solid(M.rock, new T.CylinderGeometry(0.72, 1, 15, 4, 1).rotateY(Math.PI / 4).scale(17.3, 1, 9), 0, floor - 7.5, 0);
      b.box(M.curb, 17.6, 0.3, 9.2, 0, floor, 0);
      const y0 = floor + 0.3;
      b.box(M.rock, 13, 1.1, 6.4, 0.6, y0, 0);
      b.box(wood, 13, 3.3, 6.4, 0.6, y0 + 1.1, 0);
      gable(b, darkWood, 14.6, 8.2, 3.3, 0.6, y0 + 4.4, 0);
      gable(b, M.snow, 14.9, 7.4, 3.2, 0.6, y0 + 4.75, 0);
      for (const f of [-1, 1]) {
        for (let i = -2; i <= 2; i++) b.box(M.glass, 1.5, 1.4, 0.1, 0.6 + i * 2.5, y0 + 2.1, f * 3.22);
        b.box(M.glass, 0.1, 1.2, 1.6, 0.6 + f * 6.52, y0 + 4.7, 0);
        b.box(darkWood, 13.4, 0.16, 1.3, 0.6, y0 + 1.1, f * 3.85);
        beam(b, darkWood, [-5.9, y0 + 2, f * 4.45], [7.1, y0 + 2, f * 4.45], 0.1);
      }
      b.box(M.rock, 1.1, 7.4, 1.1, 4.6, y0, -1.2);
      b.box(M.snow, 1.3, 0.25, 1.3, 4.6, y0 + 7.4, -1.2);
      b.box(M.pole, 0.1, 5, 0.1, 8.2, floor + 0.3, 3.6);
      b.box(accent, 1.6, 0.9, 0.05, 9.05, floor + 4.3, 3.6);
      for (const [x, z] of [[-8.2, -4], [8.2, -4], [-8.2, 4], [8.2, 4]]) s.lamp(x, z, 2.6, floor + 0.3);
      if (mark.cable) {
        // The cable car: a hut at the foot, one span up the face, the upper stop on the footing.
        const [cx, cz] = s.local(...mark.cable), base = s.gy(cx, cz), top = [-8.4, floor + 3.6, 0], foot = [cx, base + 4.4, cz];
        const turn = Math.atan2(-(top[2] - cz), top[0] - cx);
        b.box(wood, 4.4, 3, 3.6, cx, base, cz, turn);
        gable(b, M.snow, 5, 4.4, 1.4, cx, base + 3, cz, turn);
        b.box(M.pole, 0.3, 4.6, 0.3, cx, base, cz);
        for (const z of [-0.5, 0.5]) {
          b.box(M.pole, 0.24, 3.4, 0.24, top[0], floor + 0.3, z * 2.4);
          beam(b, M.pole, [foot[0], foot[1], foot[2] + z], [top[0], top[1], top[2] + z], 0.07);
        }
        b.box(M.pole, 0.24, 0.24, 3.2, top[0], floor + 3.6, 0);
        for (const [t, z] of [[0.36, -0.5], [0.72, 0.5]]) {
          const p = foot.map((v, i) => v + (top[i] - v) * t);
          b.box(M.pole, 0.08, 1.1, 0.08, p[0], p[1] - 1.1, p[2] + z);
          b.box(accent, 2, 1.7, 1.5, p[0], p[1] - 2.8, p[2] + z, turn);
          b.box(M.glass, 2.04, 0.7, 1.54, p[0], p[1] - 2, p[2] + z, turn);
        }
        s.lamp(cx + 2.8, cz + 2.4, 3.4);
      }
      return s.finish();
    },

    /** The client's name in tall white letters along `path`, read from the side `faces` points to. */
    'hill-sign'(mark, {client}) {
      const text = String(mark.text || client?.name || '').toUpperCase().trim(), chars = [...text];
      if (!chars.length || !mark.path) return null;
      const g = new T.Group(), b = batch(), curve = new T.CatmullRomCurve3(mark.path.map(p => new T.Vector3(p[0], 0, p[1])), false, 'catmullrom', 0.5);
      const len = curve.getLength(), pitch = Math.min(len / chars.length, 5.4), wide = pitch * 0.8, tall = Math.min(pitch * 1.3, 6.6);
      const faces = mark.faces || [0, -1], rand = seeded(text);
      const made = new Map();
      const glyph = letter => {
        if (made.has(letter)) return made.get(letter);
        const tex = signTexture('hill-letter:' + letter, 160, 256, (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.font = '900 250px "Arial Black", "Be Vietnam Pro", Arial, sans-serif';
          const m = ctx.measureText(letter), tw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
          // Every letter fills its panel, as the letters of a hillside sign are all one size.
          ctx.translate(w / 2, h);
          ctx.scale(Math.min(1.25, (w - 6) / tw), (h - 4) / th);
          ctx.fillText(letter, (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2, -m.actualBoundingBoxDescent - 2 / ((h - 4) / th));
        });
        const material = new T.MeshStandardMaterial({map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7, alphaTest: 0.5, roughness: 0.8});
        made.set(letter, material);
        return material;
      };
      chars.forEach((ch, i) => {
        const along = len / 2 + (i - (chars.length - 1) / 2) * pitch, t = curve.getTangentAt(along / len);
        let nx = -t.z, nz = t.x;
        if (nx * faces[0] + nz * faces[1] < 0) { nx = -nx; nz = -nz; }
        // Read from the front, the letters run to the reader's right: (nz, -nx).
        const order = t.x * nz - t.z * nx < 0 ? chars.length - 1 - i : i;
        const p = curve.getPointAt(along / len), base = ground(p.x, p.z) + 0.5 + rand() * 0.5;
        // Two faces back to back, the far one lettered the other way round, so the name reads right from both sides.
        [[chars[order], 1], [chars[chars.length - 1 - order], -1]].forEach(([letter, side]) => {
          if (letter === ' ') return;
          const face = new T.Mesh(new T.PlaneGeometry(wide, tall), glyph(letter));
          face.position.set(p.x + nx * 0.04 * side, base + tall / 2, p.z + nz * 0.04 * side);
          face.rotation.y = Math.atan2(nx * side, nz * side);
          g.add(face);
        });
        if (chars[order] === ' ' && chars[chars.length - 1 - order] === ' ') return;
        // Each letter stands on two short legs.
        for (const o of [-0.3, 0.3]) {
          const x = p.x + t.x * o * wide, z = p.z + t.z * o * wide, y = ground(x, z) - 0.3;
          b.box(M.pole, 0.2, base + 0.1 - y, 0.2, x, y, z);
        }
      });
      b.build(g);
      return g;
    },

    /** A round tower with a railed deck and a glass room under a pointed roof. */
    lookout(mark, {accent}) {
      const s = site(mark), {b} = s;
      b.solid(M.plaza, new T.CylinderGeometry(5.6, 5.6, 0.16, 28), 0, 0.08, 0);
      b.solid(white, new T.CylinderGeometry(1.15, 1.6, 10, 12), 0, 5, 0);
      b.solid(M.curb, new T.CylinderGeometry(3.7, 3.1, 0.5, 20), 0, 10.25, 0);
      b.solid(M.glass, new T.CylinderGeometry(2.1, 2.1, 1.5, 16), 0, 11.6, 0);
      b.solid(white, new T.CylinderGeometry(2.14, 2.14, 0.5, 16), 0, 10.75, 0);
      b.solid(accent, new T.ConeGeometry(3.3, 2.1, 16), 0, 13.4, 0);
      b.box(M.pole, 0.1, 2.6, 0.1, 0, 14.4, 0);
      b.solid(M.pole, new T.TorusGeometry(3.55, 0.06, 6, 32).rotateX(Math.PI / 2), 0, 11.5, 0);
      for (let i = 0; i < 16; i++) b.box(M.pole, 0.08, 1, 0.08, Math.cos(i * Math.PI / 8) * 3.55, 10.5, Math.sin(i * Math.PI / 8) * 3.55);
      b.box(M.glass, 1.1, 2.1, 0.1, 0, 0.16, 1.58);
      for (const a of [0.6, 2.2, 3.8, 5.4]) b.box(wood, 1.7, 0.45, 0.5, Math.cos(a) * 4.4, 0.16, Math.sin(a) * 4.4, -a + Math.PI / 2);
      for (const x of [-2.6, 2.6]) s.lamp(x, 3.6, 3.2, 0.16);
      return s.finish();
    },

    /** A club house with a roof terrace, a bar under thatch, a deck to the shore and a pier out on the water (+z). */
    'lagoon-club'(mark, {accent, land}) {
      const s = site(mark), {b} = s, bed = -3.3, top = Math.max(s.sea + 0.75, -1);
      b.box(deck, 19, 1.7, 13, 0, -1.42, 2);
      b.box(white, 12, 3.4, 6, 0, 0.28, -1);
      b.box(M.glass, 10.6, 2.3, 0.1, 0, 0.5, 2.02);
      for (const x of [-4.6, 4.6]) b.box(M.glass, 2.2, 1.2, 0.1, x, 1.5, -4.02);
      b.box(accent, 13.4, 0.3, 7.6, 0, 3.68, -1);
      for (const z of [-4.7, 2.7]) beam(b, M.pole, [-6.6, 4.9, z], [6.6, 4.9, z], 0.07);
      for (const x of [-6.6, 6.6]) beam(b, M.pole, [x, 4.9, -4.7], [x, 4.9, 2.7], 0.07);
      for (const x of [-6.6, -2.2, 2.2, 6.6]) for (const z of [-4.7, 2.7]) b.box(M.pole, 0.08, 0.95, 0.08, x, 3.98, z);
      umbrella(b, stripes[0], -3.2, 3.98, -1, 1.7);
      umbrella(b, stripes[2], 3.2, 3.98, -1, 1.7);
      // The bar: posts and a counter under a thatched cone.
      for (let i = 0; i < 6; i++) b.box(darkWood, 0.16, 2.5, 0.16, 7.2 + Math.cos(i * Math.PI / 3) * 1.9, 0.28, 5.6 + Math.sin(i * Math.PI / 3) * 1.9);
      b.solid(wood, new T.CylinderGeometry(1.25, 1.25, 1.05, 12), 7.2, 0.8, 5.6);
      b.solid(straw, new T.ConeGeometry(3, 1.7, 12), 7.2, 3.6, 5.6);
      [-7.2, -3.4, 0.4].forEach((x, i) => {
        umbrella(b, stripes[(i + 1) % 4], x, 0.28, 6.3);
        lounger(b, x - 0.9, 0.28, 6.5);
        lounger(b, x + 0.9, 0.28, 6.5);
      });
      for (let i = 0; i < 3; i++) b.box(deck, 2.4, 0.2, 0.5, -1.5, 0.08 - i * (0.28 - top) / 3, 8.75 + i * 0.5);
      pier(b, -1.5, 9.6, 23, top, bed);
      b.box(deck, 8, 0.18, 2.2, -1.5, top - 0.18, 24.1);
      for (const x of [-5, 2]) for (const z of [23.3, 24.9]) b.box(darkWood, 0.2, top - bed + 0.35, 0.2, x, bed, z);
      // Two small boats tied up at the pier head.
      for (const [x, z, colour] of [[-4.3, 21, 0xf2545b], [1.3, 19.5, 0x2bb3c0]]) {
        b.solid(mat(colour), new T.CapsuleGeometry(0.55, 2.2, 3, 8).rotateX(Math.PI / 2).scale(1, 0.55, 1), x, s.sea + 0.12, z);
        b.box(white, 0.9, 0.08, 0.3, x, s.sea + 0.34, z);
      }
      for (const [x, z] of [[-9, -4], [9, -4], [-9, 8], [9, 8]]) s.lamp(x, z, 3.2, 0.28);
      s.lamp(-2.9, 24.1, 2.4, top);
      plantTrees(s.g, 'palm', land.canopy, [[-11.2, -1.5], [11.4, 1], [-10.6, 4.6]].map(([u, v], i) => ({u, v, r: 0.2 + i * 0.3, s: 1 + i * 0.08})));
      return s.finish();
    },

    /** Sand, sunshades, huts, a lifeguard tower and a jetty; the sea is on +z. */
    beach(mark, {accent}) {
      const s = site(mark), {b, gy} = s, wide = mark.width || 34, half = wide / 2;
      const holder = new T.Group();
      holder.add(ribbon([s.world(-half, -2.5), s.world(0, -2.5), s.world(half, -2.5)], 10, sand, 0.07, 8));
      if (mark.path) holder.add(ribbon(mark.path, 2, M.plaza, 0.07));
      for (let x = -half + 3, i = 0; x <= half - 3; x += 5.5, i++) for (const z of [-4.2, -0.4]) {
        if (Math.abs(x - 2.5) < 2.6 && z < -2) continue;
        umbrella(b, stripes[(i + (z < -2 ? 0 : 2)) % 4], x, gy(x, z) - 0.1, z);
        lounger(b, x - 0.95, gy(x - 0.95, z + 0.2) - 0.06, z + 0.2);
        lounger(b, x + 0.95, gy(x + 0.95, z + 0.2) - 0.06, z + 0.2);
      }
      // Changing huts along the back of the beach.
      [-14.5, -11.2, -7.9, 8.4, 11.7, 15].forEach((x, i) => {
        const y = gy(x, -9) - 0.1;
        b.box(i % 2 ? white : mat(stripes[i % 4]), 2.5, 2.3, 2.5, x, y, -9);
        gable(b, i % 2 ? mat(stripes[(i + 1) % 4]) : white, 2.9, 3, 1.1, x, y + 2.3, -9, Math.PI / 2);
        b.box(darkWood, 0.9, 1.7, 0.08, x, y, -7.73);
      });
      // Lifeguard tower.
      const ty = gy(2.5, -3.6) - 0.1;
      for (const x of [-0.9, 0.9]) for (const z of [-0.8, 0.8]) b.box(white, 0.16, 2.6, 0.16, 2.5 + x, ty, -3.6 + z);
      b.box(deck, 2.6, 0.16, 2.4, 2.5, ty + 2.6, -3.6);
      b.box(white, 2, 1.7, 1.5, 2.5, ty + 2.76, -3.9);
      b.box(M.glass, 1.5, 0.7, 0.08, 2.5, ty + 3.5, -3.13);
      b.box(mat(0xf2545b), 2.5, 0.2, 2.1, 2.5, ty + 4.46, -3.8);
      beam(b, white, [2.5, ty + 2.6, -2.4], [2.5, gy(2.5, 0.4), 0.4], 0.5);
      b.box(M.pole, 0.07, 2.2, 0.07, 3.4, ty + 4.66, -4.4);
      b.box(mat(0xf2545b), 1, 0.6, 0.04, 3.95, ty + 6.2, -4.4);
      // Volleyball net.
      for (const x of [9.5, 16.5]) b.box(M.pole, 0.1, 2.3, 0.1, x, gy(x, -4.6) - 0.1, -4.6);
      b.box(white, 7, 0.9, 0.04, 13, gy(13, -4.6) + 1.2, -4.6);
      // Jetty and a line of buoys round the swimming water.
      const top = s.sea + 0.7, x0 = -half + 5;
      pier(b, x0, 1, 15, top, s.sea - 3, 2);
      b.box(deck, 5, 0.18, 2, x0, top - 0.18, 16);
      beam(b, deck, [x0, gy(x0, -1.5), -1.5], [x0, top - 0.09, 1.2], 0.3);
      for (let i = 0; i <= 14; i++) {
        const a = i / 14 * Math.PI;
        b.solid(mat(i % 2 ? 0xffffff : 0xf28c28), new T.SphereGeometry(0.3, 8, 6), x0 + 4 + (half - 1 - x0 - 4) / 2 * (1 - Math.cos(a)), s.sea + 0.06, 6 + Math.sin(a) * 10);
      }
      b.box(M.pole, 0.1, 3, 0.1, -half + 1, gy(-half + 1, -6) - 0.1, -6);
      b.box(accent, 1.5, 0.85, 0.05, -half + 1.8, gy(-half + 1, -6) + 2, -6);
      for (const x of [-half + 2, 0, half - 2]) s.lamp(x, -6.4, 3.4, gy(x, -6.4) - 0.1);
      s.lamp(x0 - 1.6, 16, 2.4, top);
      holder.add(s.finish());
      return holder;
    },

    /** A round hill of flower terraces laid over the ground, a path up it and a pavilion on top. */
    'flower-hill'(mark, {accent}) {
      const s = site(mark), {gy} = s, R = mark.radius || 14, H = mark.height || 5, rings = Math.round(R), seg = 56, rand = seeded(mark.kind + mark.at);
      const petals = [0xff6fa8, 0xffd23f, 0x8e7cf0, 0xff8f3f, 0x5fd0c5, 0xfafafa].map(c => new T.Color(c)), path = new T.Color(0xe9c9a0), green = new T.Color(0x86b85c);
      const rise = r => H * (1 - T.MathUtils.smootherstep(r, 1.6, R));
      const pos = [], col = [], idx = [], tone = new T.Color();
      for (let i = 0; i <= rings; i++) for (let j = 0; j < seg; j++) {
        const r = i === 0 ? 0.01 : i * R / rings, a = j / seg * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, gy(x, z) + (i === rings ? -0.35 : rise(r) + 0.04), z);
        // Terraces of one colour each, wavy round the hill; the path runs up the -x side.
        const band = Math.floor((r + 0.9 * Math.sin(a * 3)) / 2.3);
        if (r < 3.3) tone.copy(path);
        else if (Math.abs(z) < 1.05 && x < 0) tone.copy(path);
        else if (i >= rings - 1) tone.copy(green);
        else tone.copy(petals[band % petals.length]).lerp(green, 0.18 + 0.12 * Math.sin(a * 17 + r * 3));
        col.push(tone.r, tone.g, tone.b);
      }
      for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
        const a = i * seg + j, c = i * seg + (j + 1) % seg, d = a + seg, e = c + seg;
        idx.push(a, c, d, c, e, d);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const hill = new T.Mesh(geo, mat(0xffffff, {vertexColors: true}));
      hill.castShadow = hill.receiveShadow = true;
      s.g.add(hill);
      const b = s.b;
      for (let i = 0; i < 260; i++) {
        const r = 3.8 + rand() * (R - 5.4), a = rand() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.abs(z) < 1.5 && x < 0) continue;
        const band = Math.floor((r + 0.9 * Math.sin(a * 3)) / 2.3);
        b.solid(mat(petals[band % petals.length].clone().offsetHSL(0, 0.05, rand() < 0.5 ? 0.08 : -0.1).getHex()), new T.IcosahedronGeometry(0.2 + rand() * 0.12, 0), x, gy(x, z) + rise(r) + 0.16, z);
      }
      pavilion(b, accent, 0, H + gy(0, 0), 0, 2.2);
      s.lamp(0, 0, 2.5, H + 0.2);
      for (const z of [-1.5, 1.5]) s.lamp(-R - 0.6, z, 2.8);
      const holder = new T.Group();
      if (mark.path) holder.add(ribbon(mark.path, 2, M.plaza, 0.07));
      holder.add(s.finish());
      return holder;
    },

    /** A natural arch of red rock with a railed ledge in front of it (+z), looking out over the sea. */
    'rock-arch'(mark) {
      const s = site(mark), {b, gy} = s, stone = mat(0xb86a45, {flatShading: true}), pale = mat(0xd08a5c, {flatShading: true});
      for (const f of [-1, 1]) {
        b.solid(stone, new T.CylinderGeometry(2, 2.9, 7.4, 7), f * 5.2, gy(f * 5.2, 0) + 3.3, 0);
        b.solid(pale, new T.DodecahedronGeometry(1.7, 0).scale(1.2, 0.7, 1), f * 6.7, gy(f * 6.7, 1.6) + 0.6, 1.6);
      }
      b.solid(stone, new T.TorusGeometry(5.2, 1.7, 5, 9, Math.PI).scale(1, 0.62, 1.25), 0, 6.3, 0);
      b.solid(pale, new T.BoxGeometry(13.4, 1.2, 4).translate(0, 0, 0), 0, 9.9, 0);
      b.solid(M.plaza, new T.CylinderGeometry(4.4, 4.4, 0.16, 20, 1, false, -Math.PI / 2, Math.PI), 0, gy(0, 4) + 0.1, 3.2);
      for (let i = 0; i <= 8; i++) {
        const a = i / 8 * Math.PI, x = Math.cos(a) * 4.3, z = 3.2 + Math.sin(a) * 4.3;
        b.box(M.pole, 0.08, 1, 0.08, x, gy(x, z), z);
      }
      b.solid(M.pole, new T.TorusGeometry(4.3, 0.05, 5, 20, Math.PI).rotateX(Math.PI / 2), 0, gy(0, 6) + 1, 3.2);
      for (const x of [-1.6, 1.6]) b.box(wood, 1.6, 0.45, 0.5, x, gy(x, 4.4) + 0.1, 4.4);
      for (const x of [-3.4, 3.4]) s.lamp(x, 3.4, 3);
      return s.finish();
    }
  };

  /** The landmarks of a slot in use, in one group in the world. */
  function build(slot, client, land, accent) {
    const marks = (slot.landmarks || []).filter(m => KINDS[m.kind]);
    if (!marks.length) return null;
    const group = new T.Group();
    group.name = 'landmarks:' + slot.id;
    for (const mark of marks) {
      const g = KINDS[mark.kind](mark, {client, land, accent});
      if (!g) continue;
      g.name = 'landmark:' + mark.kind;
      group.add(g);
    }
    return group;
  }

  /**
   * A park on the green inside a road that comes back on itself, in the district's own (u, v): a promenade down
   * its length, a fountain in the middle, a pavilion at the far end, benches, lamps and flower beds.
   * Returns where trees may stand.
   */
  function park(road, b, flatB, {accent, rand}) {
    const lamps = [], rows = new Map();
    for (const [u, v] of road.inside(1, 3.4)) {
      const k = Math.round(u), e = rows.get(k) || [Infinity, -Infinity];
      rows.set(k, [Math.min(e[0], v), Math.max(e[1], v)]);
    }
    // The middle of the green, where it is wide enough to walk down.
    const axis = [...rows].sort((p, q) => p[0] - q[0]).filter(([, [lo, hi]]) => hi - lo >= 5).map(([u, [lo, hi]]) => ({u, v: (lo + hi) / 2, w: (hi - lo) / 2}));
    if (axis.length < 12) return {lamps, keep: () => true};
    const from = axis[0], to = axis[axis.length - 1], mid = axis[axis.length >> 1], end = axis[axis.length - 4];
    for (let i = 1; i < axis.length; i++) {
      const p = axis[i - 1], q = axis[i];
      flatB.raw.box(M.walk, Math.hypot(q.u - p.u, q.v - p.v) + 0.1, 0.02, 2, (p.u + q.u) / 2, 0.05, (p.v + q.v) / 2, Math.atan2(-(q.v - p.v), q.u - p.u));
    }
    const plaza = Math.min(4.4, mid.w - 0.6);
    flatB.raw.disc(M.plaza, plaza, mid.u, 0.085, mid.v);
    b.raw.solid(M.curb, new T.CylinderGeometry(2, 2.1, 0.5, 20), mid.u, 0.3, mid.v);
    b.raw.solid(M.water, new T.CylinderGeometry(1.75, 1.75, 0.1, 20), mid.u, 0.52, mid.v);
    b.raw.solid(M.curb, new T.CylinderGeometry(0.22, 0.34, 1.3, 10), mid.u, 0.95, mid.v);
    b.raw.solid(M.curb, new T.CylinderGeometry(0.75, 0.3, 0.22, 12), mid.u, 1.6, mid.v);
    b.raw.solid(M.water, new T.SphereGeometry(0.3, 10, 8), mid.u, 1.9, mid.v);
    pavilion(b.raw, accent, end.u, 0, end.v, Math.min(2.4, end.w - 1.4));
    const beds = [0xff6fa8, 0xffd23f, 0x8e7cf0, 0xff8f3f];
    const spots = [];
    axis.forEach((p, i) => {
      const d = p.u - from.u, clearOf = q => Math.abs(p.u - q.u) > 5.5;
      if (i % 9 === 4 && clearOf(mid) && clearOf(end)) {
        const side = (i / 9 | 0) % 2 ? 1 : -1;
        b.raw.box(darkWood, 1.7, 0.42, 0.5, p.u, 0.05, p.v + side * 1.55);
        b.raw.box(darkWood, 1.7, 0.5, 0.08, p.u, 0.47, p.v + side * 1.8);
        b.raw.box(M.pole, 0.11, 3, 0.11, p.u + 1.6, 0.05, p.v - side * 1.35);
        lamps.push([p.u + 1.6, 3.11, p.v - side * 1.35]);
      }
      if (i % 9 === 0 && d > 3 && clearOf(mid) && clearOf(end) && p.w > 4) for (const side of [-1, 1]) {
        const bu = p.u, bv = p.v + side * 2.6, colour = mat(beds[(i / 9 | 0) % beds.length]);
        flatB.raw.disc(mat(0x6b4a34), 1.15, bu, 0.07, bv, 14);
        for (let k = 0; k < 9; k++) b.raw.solid(colour, new T.IcosahedronGeometry(0.2, 0), bu + (rand() - 0.5) * 1.5, 0.24, bv + (rand() - 0.5) * 1.5);
        spots.push([bu, bv, 1.6]);
      }
    });
    for (const p of [from, to]) flatB.raw.disc(M.plaza, 1.5, p.u, 0.08, p.v, 16);
    /** True where a tree at (u, v) is off the promenade, the fountain, the pavilion and the beds. */
    const keep = (u, v) => {
      const p = axis.reduce((best, q) => Math.abs(q.u - u) < Math.abs(best.u - u) ? q : best, axis[0]);
      return Math.abs(v - p.v) >= 2.5 && Math.hypot(u - mid.u, v - mid.v) > plaza + 1.3 && Math.hypot(u - end.u, v - end.v) > 4.6 && spots.every(([bu, bv, r]) => Math.hypot(u - bu, v - bv) > r);
    };
    return {lamps, keep};
  }

  /** Boats lying on the sea: [x, z, heading in degrees, kind]. */
  function boats(list) {
    const group = new T.Group(), b = batch(), hulls = [0xf7f4ec, 0x2f6fb5, 0xc0392b, 0xf2b84b];
    group.name = 'world-boats';
    (list || []).forEach(([x, z, deg = 0, kind = 'sail'], i) => {
      const turn = T.MathUtils.degToRad(deg), size = kind === 'row' ? 0.45 : kind === 'yacht' ? 1.5 : 1;
      const put = (material, geo, lx, ly, lz) => {
        geo.scale(size, size, size).translate(lx * size, ly * size, lz * size).rotateY(turn);
        b.solid(material, geo, x, SEA_LEVEL, z);
      };
      // The hull: pointed at the bow (+x), flat at the stern.
      const s = new T.Shape();
      s.moveTo(-3.6, -1.05);
      s.lineTo(1.2, -1.2);
      s.quadraticCurveTo(3.4, -0.9, 4.6, 0);
      s.quadraticCurveTo(3.4, 0.9, 1.2, 1.2);
      s.lineTo(-3.6, 1.05);
      s.closePath();
      put(mat(hulls[i % hulls.length]), new T.ExtrudeGeometry(s, {depth: 1.1, bevelEnabled: false}).rotateX(Math.PI / 2), 0, 0.7, 0);
      put(deck, new T.BoxGeometry(6.6, 0.06, 1.7), -0.2, 0.73, 0);
      if (kind === 'sail') {
        put(M.pole, new T.BoxGeometry(0.14, 8.4, 0.14), 0.4, 4.9, 0);
        put(M.pole, new T.BoxGeometry(3.9, 0.1, 0.1), -1.6, 1.7, 0);
        const main = new T.Shape(), jib = new T.Shape();
        main.moveTo(0.25, 1.9); main.lineTo(-3.5, 1.9); main.lineTo(0.25, 8.9); main.closePath();
        jib.moveTo(0.6, 1.3); jib.lineTo(4.3, 0.9); jib.lineTo(0.6, 7.6); jib.closePath();
        put(sail, new T.ShapeGeometry(main), 0, 0, 0.06);
        put(sail, new T.ShapeGeometry(jib), 0, 0, -0.06);
      } else if (kind !== 'row') {
        put(white, new T.BoxGeometry(2.8, 1.3, 1.6), -0.6, 1.38, 0);
        put(M.glass, new T.BoxGeometry(2.84, 0.5, 1.64), -0.6, 1.62, 0);
        put(mat(hulls[(i + 2) % hulls.length]), new T.BoxGeometry(3.1, 0.12, 1.9), -0.6, 2.09, 0);
        put(M.pole, new T.BoxGeometry(0.08, 1.8, 0.08), -1.4, 3, 0);
      } else put(white, new T.BoxGeometry(0.5, 0.1, 2), 0, 0.5, 0);
    });
    b.build(group);
    return group;
  }

  return {build, park, boats};
}
