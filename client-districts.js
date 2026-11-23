/**
 * client-districts.js
 * One district per client around the campus ring road: gate, internal road
 * with a turnaround, sidewalks, crossings, a walking loop, numbered lots and
 * a landscape of its own. The land comes from physical-topology.json
 * (expansion.clientDistricts); clients and their projects come from
 * dataConnector, so no client or project is named in this file.
 *
 * A project takes the lowest free lot of its client's district and keeps it.
 * A new client takes the first slot nobody holds. Projects that already have
 * a building in the topology (AN PHIM's internal ones) stay where they are.
 */
import * as T from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {districtPlan, slotFrame, slotLots, openLotCount, spineEnd} from './district-layout.js';

/** Landscape of the land, keyed by `landscape` on the topology slot. */
const LAMP_HEAD = new T.BoxGeometry(0.34, 0.12, 0.5);
const LANDSCAPES = {
  grassland: {label: 'Đồng cỏ', ground: 0x9ccb6b, verge: 0x7fb659, lot: 0xe4dcc4, accent: 0x2f8f4e, walls: [0xf4efe2, 0xe6edd8, 0xfbf6ea], tree: 'round', canopy: [0x4f9c46, 0x6bb04f]},
  'flower-hills': {label: 'Đồi hoa', ground: 0xc9dd9c, verge: 0xb4d28a, lot: 0xf3e3da, accent: 0xd9488f, walls: [0xfff1f4, 0xfdf3d7, 0xeaf3ff], tree: 'round', canopy: [0xf3a6c4, 0xf7c1d6, 0xe98bb2]},
  'snow-mountain': {label: 'Núi tuyết', ground: 0xeef4f9, verge: 0xdbe7f0, lot: 0xc9d6e2, accent: 0x2f6fb5, walls: [0xf7fafc, 0xdfeaf3, 0xcfdcea], tree: 'snowpine', canopy: [0x2f5d4a, 0x3b6b58]},
  'film-set': {label: 'Phố phim trường', ground: 0xb9b2a6, verge: 0xa39c90, lot: 0xd8d2c6, accent: 0xc0392b, walls: [0xf2e6d0, 0xe9d3b4, 0xd9dde2], tree: 'palm', canopy: [0x3f8a4c]},
  'pine-forest': {label: 'Rừng thông', ground: 0x5f8f57, verge: 0x4c7a48, lot: 0xd6ceb6, accent: 0x7a4b2a, walls: [0xefe6d2, 0xd9c7a6, 0xe7ead9], tree: 'pine', canopy: [0x2e6140, 0x3a7049, 0x285538]},
  'red-canyon': {label: 'Hẻm núi đá đỏ', ground: 0xdfa46e, verge: 0xcf8e58, lot: 0xf0d6b4, accent: 0xb5482a, walls: [0xf6e2c6, 0xeccba2, 0xf9efdd], tree: 'cactus', canopy: [0x5f9150]},
  'tropical-beach': {label: 'Bãi biển', ground: 0xf0deb0, verge: 0xe6cf98, lot: 0xfaf0d8, accent: 0x1596a8, walls: [0xffffff, 0xfdeccf, 0xdff3f4], tree: 'palm', canopy: [0x3fa05a, 0x4fb267]},
  meadow: {label: 'Đồng cỏ', ground: 0xa9cf7a, verge: 0x8cbc62, lot: 0xe4dcc4, accent: 0x5b6b7a, walls: [0xf4efe2, 0xe9e9e2], tree: 'round', canopy: [0x58a04c]}
};

const HEX = n => '#' + n.toString(16).padStart(6, '0');

/** Small deterministic generator, so a district looks the same on every load. */
function seeded(text) {
  let s = 2166136261;
  for (const ch of String(text)) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909);
    return ((s ^= s >>> 16) >>> 0) / 4294967296;
  };
}

const projectNumber = id => {
  const m = String(id).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
};

export function createClientDistricts({scene, terrain, L, dataConnector, buildingObjects, clickable}) {
  const plan = districtPlan(L);
  const root = new T.Group();
  root.name = 'client-districts';
  scene.add(root);
  // onChange is called after project buildings were added or removed.
  const api = {root, districts: [], buildings: [], onChange: null, refresh: () => {}, dispose: () => scene.remove(root)};
  if (!plan) return api;
  const tpl = plan.template;

  const mats = new Map();
  const mat = (color, opts = {}) => {
    const key = color + JSON.stringify(opts);
    if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial({color, roughness: 0.9, ...opts}));
    return mats.get(key);
  };
  const M = {
    asphalt: mat(terrain.materials?.[1]?.color?.getHex?.() ?? 0x383f44, {roughness: 0.86}),
    walk: mat(terrain.materials?.[2]?.color?.getHex?.() ?? 0xdca658),
    plaza: mat(0xe9c9a0),
    curb: mat(0xb9bec4),
    line: mat(0xf8fafc, {roughness: 0.7}),
    glass: mat(0x2c4a66, {roughness: 0.25, metalness: 0.35}),
    roof: mat(0x5d646c),
    trunk: mat(0x7a5a3c),
    rock: mat(0x8d949b, {flatShading: true}),
    pole: mat(0x39424e, {roughness: 0.5, metalness: 0.5}),
    glow: new T.MeshBasicMaterial({color: 0xfff0a6}),
    // Street lamp heads: one instance per lamp, so day-night.js can put a pool of light under each at night.
    lampHead: Object.assign(new T.MeshStandardMaterial({color: 0xfff6dc, emissive: 0xfff0a6, emissiveIntensity: 0.9, roughness: 0.6}), {userData: {nightLamp: true}}),
    snow: mat(0xffffff, {flatShading: true}),
    water: mat(0x4fb7d6, {roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.9})
  };

  // ---- geometry helpers: collect by material, merge once per district ----
  function batch() {
    const byMat = new Map();
    const add = (material, geo) => {
      if (!byMat.has(material)) byMat.set(material, []);
      byMat.get(material).push(geo.index ? geo.toNonIndexed() : geo);
    };
    const box = (material, w, h, d, x, y, z, ry = 0) => {
      const g = new T.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y + h / 2, z);
      add(material, g);
    };
    const flat = (material, shape, y) => {
      const g = new T.ShapeGeometry(shape, 10);
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, 0);
      add(material, g);
    };
    const disc = (material, r, x, y, z, seg = 28) => {
      const g = new T.CircleGeometry(r, seg);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      add(material, g);
    };
    const solid = (material, g, x, y, z) => {
      g.translate(x, y, z);
      add(material, g);
    };
    const build = (parent, {shadow = true} = {}) => {
      for (const [material, geos] of byMat) {
        for (const g of geos) for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        const mesh = new T.Mesh(mergeGeometries(geos, false), material);
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        parent.add(mesh);
        geos.forEach(g => g.dispose());
      }
      byMat.clear();
    };
    return {add, box, flat, disc, solid, build};
  }

  const roundedRect = (u0, v0, u1, v1, r) => {
    const s = new T.Shape();
    // Shape y becomes -z once laid flat, so v is negated here.
    const y0 = -v1, y1 = -v0;
    s.moveTo(u0 + r, y0);
    s.lineTo(u1 - r, y0);
    s.quadraticCurveTo(u1, y0, u1, y0 + r);
    s.lineTo(u1, y1 - r);
    s.quadraticCurveTo(u1, y1, u1 - r, y1);
    s.lineTo(u0 + r, y1);
    s.quadraticCurveTo(u0, y1, u0, y1 - r);
    s.lineTo(u0, y0 + r);
    s.quadraticCurveTo(u0, y0, u0 + r, y0);
    return s;
  };

  const textures = new Map();
  function signTexture(key, w, h, draw) {
    if (!textures.has(key)) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      textures.set(key, t);
    }
    return textures.get(key);
  }
  function fitText(ctx, text, maxW, size, weight = 800) {
    do ctx.font = `${weight} ${size}px "Be Vietnam Pro", "Segoe UI", Arial, sans-serif`;
    while (ctx.measureText(text).width > maxW && (size -= 2) > 10);
  }
  function board(key, w, h, pxPerM, draw) {
    const tex = signTexture(key, Math.round(w * pxPerM), Math.round(h * pxPerM), draw);
    return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({map: tex, toneMapped: false}));
  }

  /** Height a road runs at: the ground, or the deck of a bridge where one carries it over water. */
  const roadHeight = (x, z) => Math.max(terrain.height(x, z), terrain.world?.deck?.(x, z) ?? -Infinity);

  /** A ribbon laid on the natural ground along world points, for roads outside the level pads. */
  function drapedRibbon(points, width, material, lift = 0.07) {
    const v = points.map(p => new T.Vector3(p[0], 0, p[1]));
    const curve = v.length > 2 ? new T.CatmullRomCurve3(v, false, 'catmullrom', 0.15) : new T.LineCurve3(v[0], v[1]);
    const n = Math.max(2, Math.ceil(curve.getLength() / 1.2)), across = 4, pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(i / n), t = curve.getTangentAt(i / n), nx = -t.z, nz = t.x;
      for (let j = 0; j <= across; j++) {
        const o = (j / across - 0.5) * width, x = p.x + nx * o, z = p.z + nz * o;
        pos.push(x, roadHeight(x, z) + lift, z);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j, b = a + 1, c = a + across + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---- trees, instanced per district ----
  const treeParts = {};
  function treeGeometry(kind) {
    if (treeParts[kind]) return treeParts[kind];
    const cyl = (r0, r1, h, y, seg = 6) => new T.CylinderGeometry(r0, r1, h, seg).translate(0, y + h / 2, 0);
    const cone = (r, h, y, seg = 7) => new T.ConeGeometry(r, h, seg).translate(0, y + h / 2, 0);
    let parts;
    if (kind === 'pine' || kind === 'snowpine') {
      parts = [
        {m: 'trunk', g: cyl(0.16, 0.22, 1.2, 0)},
        {m: 'canopy', g: mergeGeometries([cone(1.35, 2.2, 0.9), cone(1.0, 1.9, 2.2), cone(0.62, 1.5, 3.4)].map(g => g.toNonIndexed()))}
      ];
      if (kind === 'snowpine') parts.push({m: 'snow', g: mergeGeometries([cone(0.66, 0.75, 4.15), cone(1.02, 0.35, 3.75), cone(1.37, 0.3, 2.8)].map(g => g.toNonIndexed()))});
    } else if (kind === 'palm') {
      const leaves = [];
      for (let i = 0; i < 7; i++) {
        const leaf = new T.ConeGeometry(0.34, 2.3, 4).rotateZ(-Math.PI / 2 - 0.42).translate(1.05, 4.15, 0).rotateY(i * Math.PI * 2 / 7);
        leaves.push(leaf.toNonIndexed());
      }
      parts = [{m: 'trunk', g: cyl(0.13, 0.2, 4.3, 0)}, {m: 'canopy', g: mergeGeometries(leaves)}];
    } else if (kind === 'cactus') {
      const body = [new T.CapsuleGeometry(0.34, 1.9, 3, 8).translate(0, 1.3, 0), new T.CapsuleGeometry(0.2, 0.7, 3, 8).translate(0.62, 1.75, 0), new T.CapsuleGeometry(0.18, 0.5, 3, 8).rotateZ(Math.PI / 2).translate(0.38, 1.3, 0), new T.CapsuleGeometry(0.2, 0.6, 3, 8).translate(-0.6, 1.35, 0), new T.CapsuleGeometry(0.18, 0.45, 3, 8).rotateZ(Math.PI / 2).translate(-0.36, 1.0, 0)];
      parts = [{m: 'canopy', g: mergeGeometries(body.map(g => g.toNonIndexed()))}];
    } else {
      parts = [
        {m: 'trunk', g: cyl(0.17, 0.24, 1.7, 0)},
        {m: 'canopy', g: mergeGeometries([new T.IcosahedronGeometry(1.45, 1).translate(0, 2.9, 0), new T.IcosahedronGeometry(1.0, 1).translate(0.75, 2.3, 0.3), new T.IcosahedronGeometry(0.95, 1).translate(-0.65, 2.45, -0.35)])}
      ];
    }
    return (treeParts[kind] = parts);
  }
  function plantTrees(parent, kind, colors, spots) {
    if (!spots.length) return;
    const dummy = new T.Object3D(), tint = new T.Color();
    for (const part of treeGeometry(kind)) {
      const material = part.m === 'trunk' ? M.trunk : part.m === 'snow' ? M.snow : mat(0xffffff, {flatShading: true});
      const mesh = new T.InstancedMesh(part.g, material, spots.length);
      spots.forEach((s, i) => {
        dummy.position.set(s.u, 0, s.v);
        dummy.rotation.y = s.r * Math.PI * 2;
        dummy.scale.setScalar(s.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (part.m === 'canopy') mesh.setColorAt(i, tint.setHex(colors[Math.floor(s.r * 97) % colors.length]));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }

  // ---- landscape dressing; every function works in the slot's own (u, v) ----
  const DRESS = {
    grassland(b, ctx) {
      const {rand, depth} = ctx;
      for (let i = 0; i < 140; i++) {
        const u = 4 + rand() * (depth - 8), v = (rand() < 0.5 ? -1 : 1) * (19.6 + rand() * 3.6);
        b.solid(mat(rand() < 0.6 ? 0xf7d94c : 0xffffff), new T.IcosahedronGeometry(0.16, 0), u, 0.2, v);
      }
      // A windmill at the far end marks the district from the campus.
      const u = depth - 7, v = 0;
      b.solid(mat(0xf3efe6), new T.CylinderGeometry(0.9, 1.6, 9, 8), u, 4.5, v);
      b.solid(mat(0xb5482a), new T.ConeGeometry(1.25, 1.6, 8), u, 9.8, v);
      for (let i = 0; i < 4; i++) b.solid(mat(0xfaf7f0), new T.BoxGeometry(0.16, 5.2, 1.0).translate(0, 2.9, 0).rotateX(i * Math.PI / 2 + 0.4), u - 1.15, 8.6, v);
    },
    'flower-hills'(b, ctx) {
      const {rand, depth} = ctx, petals = [0xff6fa8, 0xffd23f, 0x8e7cf0, 0xff8f3f, 0x5fd0c5, 0xffffff];
      for (let c = 0; c < 26; c++) {
        const cu = 4 + rand() * (depth - 8), cv = (rand() < 0.5 ? -1 : 1) * (20 + rand() * 2.6), colour = mat(petals[c % petals.length]);
        for (let i = 0; i < 9; i++) b.solid(colour, new T.IcosahedronGeometry(0.19, 0), cu + (rand() - 0.5) * 2.4, 0.22, cv + (rand() - 0.5) * 1.6);
      }
    },
    'snow-mountain'(b, ctx) {
      const {rand, depth, roadEnd} = ctx;
      for (let i = 0; i < 16; i++) {
        const r = 0.7 + rand() * 1.1;
        b.solid(M.snow, new T.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1), 4 + rand() * (depth - 8), 0, (rand() < 0.5 ? -1 : 1) * (20 + rand() * 3));
      }
      if (roadEnd + 20 < depth) b.disc(mat(0xbfe6f5, {roughness: 0.15, metalness: 0.15}), 5.5, roadEnd + 13, 0.09, -1, 24);
    },
    'film-set'(b, ctx) {
      const {depth, roadEnd, accent} = ctx;
      // Red carpet beside the road, clear of the plaza palm and the spotlight poles.
      b.box(accent, 9.5, 0.03, 2, 6.2, 0.14, -6.4);
      for (const [u, v] of [[3, -10.5], [3, 10.5], [10.5, -10.5], [10.5, 10.5]]) {
        b.box(M.pole, 0.28, 6.5, 0.28, u, 0, v);
        b.box(M.pole, 1.5, 0.22, 0.22, u, 6.4, v);
        b.box(M.glow, 0.5, 0.42, 0.34, u - 0.45, 5.95, v);
        b.box(M.glow, 0.5, 0.42, 0.34, u + 0.45, 5.95, v);
      }
      // Studio water tower over the land kept for later.
      const u = Math.min(depth - 8, Math.max(roadEnd + 12, depth - 14)), v = 13;
      for (const [du, dv] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.box(M.pole, 0.24, 8, 0.24, u + du, 0, v + dv);
      b.solid(mat(0xe8e2d4), new T.CylinderGeometry(2.3, 2.3, 3.6, 14), u, 9.8, v);
      b.solid(accent, new T.ConeGeometry(2.6, 1.5, 14), u, 12.35, v);
      // Clapperboard billboard on the other side.
      b.box(M.pole, 0.3, 4, 0.3, u, 0, -15.6);
      b.box(mat(0x20242a), 0.3, 3.4, 5, u, 4, -15.6);
      for (let i = 0; i < 5; i++) b.box(M.line, 0.34, 0.7, 0.5, u, 6.7, -17.6 + i);
    },
    'pine-forest'(b, ctx) {
      const {rand, depth} = ctx;
      for (let i = 0; i < 22; i++) {
        const r = 0.5 + rand() * 0.9;
        b.solid(M.rock, new T.DodecahedronGeometry(r, 0).scale(1, 0.7, 1), 4 + rand() * (depth - 8), r * 0.3, (rand() < 0.5 ? -1 : 1) * (19.8 + rand() * 3.4));
      }
      for (const v of [-20.6, 20.6]) for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) {
        b.solid(M.trunk, new T.CylinderGeometry(0.26, 0.26, 3.4, 8).rotateZ(Math.PI / 2), 8, 0.28 + i * 0.46, v + (j - (2 - i) / 2) * 0.56);
      }
    },
    'red-canyon'(b, ctx) {
      const {rand, depth} = ctx;
      const stone = mat(0xb86a45, {flatShading: true});
      for (let i = 0; i < 26; i++) {
        const r = 0.5 + rand() * 1.1;
        b.solid(stone, new T.DodecahedronGeometry(r, 0).scale(1, 0.75, 1), 4 + rand() * (depth - 8), r * 0.3, (rand() < 0.5 ? -1 : 1) * (19.8 + rand() * 3.4));
      }
    },
    'tropical-beach'(b, ctx) {
      const {rand, depth} = ctx, stripes = [0xf2545b, 0xffffff, 0xf7b32b, 0x2bb3c0];
      for (let i = 0; i < 6; i++) {
        const u = 3.2 + (i % 3) * 3.2, v = (i < 3 ? -1 : 1) * 9.6;
        b.box(M.pole, 0.1, 2.3, 0.1, u, 0, v);
        b.solid(mat(stripes[i % stripes.length]), new T.ConeGeometry(1.35, 0.6, 10), u, 2.5, v);
      }
      for (let i = 0; i < 14; i++) {
        const r = 0.3 + rand() * 0.5;
        b.solid(mat(0xd9c69a, {flatShading: true}), new T.DodecahedronGeometry(r, 0).scale(1, 0.6, 1), 4 + rand() * (depth - 8), r * 0.2, (rand() < 0.5 ? -1 : 1) * (20 + rand() * 3));
      }
    }
  };

  // ---- one district ----
  function buildDistrict(slot, client, used) {
    const frame = slotFrame(slot, tpl), land = LANDSCAPES[slot.landscape] || LANDSCAPES.meadow;
    const group = new T.Group();
    group.name = slot.id;
    group.position.set(slot.gateXZ[0], frame.y, slot.gateXZ[1]);
    group.rotation.y = frame.rotY;
    const {depth, half} = frame, b = batch(), flatB = batch();
    const open = openLotCount(slot, tpl, used), roadEnd = spineEnd(tpl, open);
    const rw = tpl.roadWidth / 2, sw = tpl.sidewalkWidth, loop = tpl.walkLoopOffset, lots = slotLots(slot, tpl);
    const [lotW, lotD] = tpl.lotSize, accent = mat(land.accent), rand = seeded(slot.id);

    // The ground itself is the terrain, coloured by world-landscape.js for this slot's landscape.

    // Walking loop behind the lots, with spokes back to the sidewalks.
    const ring = roundedRect(5 - 0.8, -loop - 0.8, depth - 3 + 0.8, loop + 0.8, 5);
    ring.holes.push(roundedRect(5 + 0.8, -loop + 0.8, depth - 3 - 0.8, loop - 0.8, 4.2));
    flatB.flat(M.walk, ring, 0.07);
    const spokes = [];
    for (let u = tpl.firstLotAt; u <= depth - 6; u += 2 * tpl.lotPitch) spokes.push(u);
    for (const u of spokes) for (const s of [-1, 1]) flatB.box(M.walk, 1.3, 0.05, loop - rw - sw, u, 0.03, s * (rw + sw + (loop - rw - sw) / 2));

    // Gate plaza, road with centre line, turnaround, sidewalks, crossings.
    flatB.flat(M.plaza, roundedRect(tpl.gatePlaza[0], -12, tpl.gatePlaza[1], 12, 1.2), 0.09);
    b.box(M.asphalt, roadEnd + 1.5, 0.12, tpl.roadWidth, (roadEnd - 1.5) / 2, 0, 0);
    flatB.disc(M.asphalt, tpl.turnaroundRadius, roadEnd, 0.125, 0);
    b.solid(mat(land.verge), new T.CylinderGeometry(1.8, 1.8, 0.3, 18), roadEnd, 0.2, 0);
    for (let u = 1.5; u < roadEnd - tpl.turnaroundRadius - 1; u += 3.2) if (!spokes.some(c => Math.abs(u + 0.8 - c) < 2.2)) flatB.box(M.line, 1.6, 0.01, 0.16, u + 0.8, 0.125, 0);
    for (const s of [-1, 1]) {
      b.box(M.walk, roadEnd - tpl.gatePlaza[1] - 3, 0.2, sw, (roadEnd + tpl.gatePlaza[1] - 3) / 2, 0, s * (rw + sw / 2));
      b.box(M.curb, roadEnd - 3, 0.22, 0.18, (roadEnd - 3) / 2, 0, s * (rw + 0.09));
    }
    for (const u of spokes.filter(u => u < roadEnd - tpl.turnaroundRadius)) for (let i = -2; i <= 2; i++) flatB.box(M.line, 2.2, 0.012, 0.55, u, 0.125, i * 1.1);
    for (let i = -2; i <= 2; i++) flatB.box(M.line, 2.2, 0.012, 0.55, -1.6, 0.125, i * 1.1);

    // Street lamps along the road.
    const lampHeads = [];
    for (let u = 16, k = 0; u < roadEnd - 4; u += 12, k++) {
      const s = k % 2 ? 1 : -1, v = s * (rw + sw - 0.3);
      b.box(M.pole, 0.14, 4.2, 0.14, u, 0.2, v);
      b.box(M.pole, 0.1, 0.1, 1.1, u, 4.3, v - s * 0.5);
      lampHeads.push([u, 4.26, v - s * 0.85]);
    }

    // Gate: two pillars, a beam and the client's name on both faces.
    for (const s of [-1, 1]) {
      b.box(accent, 1.0, 5.6, 1.0, 0.4, 0, s * 5.2);
      b.box(M.curb, 1.3, 0.5, 1.3, 0.4, 0, s * 5.2);
    }
    b.box(mat(0x2a3038), 0.7, 1.7, 11.4, 0.4, 5.1, 0);
    const title = client ? 'QUẬN ' + client.name.toUpperCase() : 'ĐẤT DỰ TRỮ';
    for (const s of [-1, 1]) {
      const sign = board('gate:' + title + '|' + land.label, 10.6, 1.4, 64, (ctx, w, h) => {
        ctx.fillStyle = '#1d2228';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = HEX(land.accent);
        ctx.fillRect(0, h - 8, w, 8);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitText(ctx, title, w - 60, 54);
        ctx.fillText(title, w / 2, h / 2 - 4);
      });
      sign.position.set(0.4 + s * 0.36, 5.95, 0);
      sign.rotation.y = s * Math.PI / 2;
      group.add(sign);
    }

    // Lots: a paved pad with its number when the road reaches it, a pegged outline when it is kept for later.
    const peg = mat(0xf28c28);
    for (const lot of lots) {
      const front = lot.v - lot.side * lotD / 2;
      if (lot.n <= open) {
        b.box(mat(land.lot), lotW, 0.16, lotD, lot.u, 0.02, lot.v);
        b.box(M.walk, 1.4, 0.05, tpl.lotSetback - rw - sw + 0.1, lot.u, 0.03, lot.side * (rw + sw + (tpl.lotSetback - rw - sw) / 2));
        const plate = board('lot:' + lot.n, 1.5, 0.9, 80, (ctx, w, h) => {
          ctx.fillStyle = '#20262d';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '800 50px "Be Vietnam Pro", Arial, sans-serif';
          ctx.fillText(String(lot.n).padStart(2, '0'), w / 2, h / 2 + 3);
        });
        plate.rotation.x = -Math.PI / 2;
        plate.rotation.z = lot.side > 0 ? Math.PI : 0;
        plate.position.set(lot.u - lotW / 2 + 1.1, 0.195, front + lot.side * 0.75);
        group.add(plate);
      } else {
        for (const du of [-1, 1]) for (const dv of [-1, 1]) b.box(peg, 0.16, 0.7, 0.16, lot.u + du * lotW / 2, 0.04, lot.v + dv * lotD / 2);
        for (const du of [-1, 1]) for (let i = 0; i < 4; i++) flatB.box(M.line, 0.14, 0.012, 1.2, lot.u + du * lotW / 2, 0.05, lot.v + (i - 1.5) * 2.6);
        for (const dv of [-1, 1]) for (let i = 0; i < 3; i++) flatB.box(M.line, 1.2, 0.012, 0.14, lot.u + (i - 1) * 2.8, 0.05, lot.v + dv * lotD / 2);
      }
    }

    // Trees: a row along both long edges, a few at the far end, a grove on the land kept for later.
    const spots = [];
    const spot = (u, v, s = 1) => spots.push({u: u + (rand() - 0.5) * 0.9, v: v + (rand() - 0.5) * 0.9, r: rand(), s: s * (0.82 + rand() * 0.4)});
    for (let u = 3; u <= depth - 3; u += land.tree === 'pine' ? 4 : 6) for (const v of [-21.4, 21.4]) spot(u, v);
    for (const v of [-13, -7, 7, 13]) spot(depth - 1.6, v);
    if (land.tree === 'pine' || land.tree === 'snowpine') for (let u = 6; u <= depth - 4; u += 7) for (const v of [-23.4, 23.4]) spot(u + 3, v, 0.8);
    for (let u = roadEnd + 9; u < depth - 5; u += 6.5) for (const v of [-13.5, -4.5, 4.5, 13.5]) if (rand() < 0.55) spot(u, v);
    spot(roadEnd, 0, 0.9);
    for (const s of [-1, 1]) spot(6.2, s * 10, 0.85);
    plantTrees(group, land.tree, land.canopy, spots);

    DRESS[slot.landscape]?.(b, {rand, depth, half, roadEnd, accent});

    flatB.build(group, {shadow: false});
    b.build(group);
    if (lampHeads.length) {
      const heads = new T.InstancedMesh(LAMP_HEAD, M.lampHead, lampHeads.length), m = new T.Matrix4();
      lampHeads.forEach((at, i) => heads.setMatrixAt(i, m.makeTranslation(...at)));
      heads.name = 'district-lamp-heads';
      group.add(heads);
    }
    group.userData.districtInfo = {slotId: slot.id, clientId: client?.id || null, open};
    return {group, open, roadEnd};
  }

  /** A slot nobody holds yet: level ground, corner pegs and a board at its future gate. */
  function buildReserve(slot) {
    const frame = slotFrame(slot, tpl), group = new T.Group(), b = batch();
    group.name = slot.id;
    group.position.set(slot.gateXZ[0], frame.y, slot.gateXZ[1]);
    group.rotation.y = frame.rotY;
    const {depth, half} = frame, peg = mat(0xf28c28);
    for (let u = 0; u <= depth; u += 10) for (const v of [-half, half]) b.box(peg, 0.22, 1.0, 0.22, u, 0, v);
    for (let v = -half + 8; v < half; v += 8) for (const u of [0, depth]) b.box(peg, 0.22, 1.0, 0.22, u, 0, v);
    for (const v of [-2.6, 2.6]) b.box(M.pole, 0.2, 3.2, 0.2, 1, 0, v);
    b.build(group);
    for (const s of [-1, 1]) {
      const sign = board('reserve:' + slot.label, 5.6, 1.7, 64, (ctx, w, h) => {
        ctx.fillStyle = '#f6f1e7';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#f28c28';
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, w - 8, h - 8);
        ctx.fillStyle = '#20262d';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 38px "Be Vietnam Pro", Arial, sans-serif';
        ctx.fillText('ĐẤT DỰ TRỮ · ' + slot.label, w / 2, h * 0.36);
        ctx.font = '600 24px "Be Vietnam Pro", Arial, sans-serif';
        ctx.fillText('Dành cho khách hàng mới', w / 2, h * 0.72);
      });
      sign.position.set(1 + s * 0.12, 2.5, 0);
      sign.rotation.y = s * Math.PI / 2;
      group.add(sign);
    }
    return {group, open: 0, roadEnd: 0};
  }

  // ---- project buildings ----
  function buildProjectBuilding(project, land, seed) {
    const g = new T.Group(), b = batch(), rand = seeded(seed);
    const floors = T.MathUtils.clamp(Math.round((Number(project.budget) || 0) / 35e6), 2, 6), fh = 1.45;
    const wall = mat(land.walls[Math.floor(rand() * land.walls.length)]), accent = mat(land.accent);
    const style = Math.floor(rand() * 4);
    const bands = (w, d, x, y0, z, n) => {
      for (let i = 0; i < n; i++) {
        const y = y0 + i * fh + 0.5;
        b.box(M.glass, w * 0.84, 0.72, 0.08, x, y, z + d / 2);
        b.box(M.glass, w * 0.84, 0.72, 0.08, x, y, z - d / 2);
        b.box(M.glass, 0.08, 0.72, d * 0.78, x + w / 2, y, z);
        b.box(M.glass, 0.08, 0.72, d * 0.78, x - w / 2, y, z);
      }
    };
    const block = (w, d, x, y0, z, n, material = wall) => {
      b.box(material, w, n * fh, d, x, y0, z);
      bands(w, d, x, y0, z, n);
      b.box(M.roof, w + 0.3, 0.22, d + 0.3, x, y0 + n * fh, z);
      return y0 + n * fh + 0.22;
    };
    let top;
    if (style === 0) {
      top = block(6.4, 6.0, 0, 0, -0.8, floors);
      b.box(accent, 1.8, 0.9, 1.4, 1.4, top, -1.4);
    } else if (style === 1) {
      top = block(6.8, 6.2, 0, 0, -0.8, 2);
      top = block(4.4, 4.2, -0.9, top, -1.4, Math.max(1, floors - 2));
      b.box(accent, 4.7, 0.3, 4.5, -0.9, top, -1.4);
    } else if (style === 2) {
      top = block(3.6, 6.0, -1.5, 0, -0.8, floors);
      block(3.0, 5.0, 1.8, 0, -0.9, Math.max(1, floors - 1));
      b.box(accent, 0.5, floors * fh + 0.6, 0.5, -3.3, 0, 2.2);
    } else {
      top = block(6.6, 5.6, 0, 0, -1.0, Math.min(2, floors));
      const roofG = new T.CylinderGeometry(2.8, 2.8, 6.6, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.55, 1);
      b.solid(accent, roofG, 0, top - 0.05, -1.0);
      if (floors > 2) block(2.6, 2.6, 2.0, 0, 2.3, floors - 2);
    }
    b.box(accent, 1.5, 2.0, 0.14, 0, 0, 2.24 - (style === 3 ? 0.2 : 0));
    b.box(M.roof, 2.3, 0.14, 1.1, 0, 2.1, 2.7 - (style === 3 ? 0.2 : 0));
    b.build(g);
    return g;
  }

  const byProject = new Map();   // project number -> {group, binding, lot, slotId}
  const districts = new Map();   // slot id -> {slot, client, group, open, key}
  const signs = new T.Group();
  signs.name = 'client-district-signs';
  root.add(signs);

  const claimed = new Map();     // slot id -> client id, for clients that took a free slot
  // A free slot can be given out once a road reaches its gate: from the ring, or by a branch road.
  const served = slot => !!slot.ringXZ || (plan.accessRoads || []).some(r => {
    const end = r.points[r.points.length - 1];
    return end[0] === slot.gateXZ[0] && end[1] === slot.gateXZ[1];
  });

  function assignSlots(clients) {
    const held = new Map();
    for (const slot of plan.slots) {
      const c = slot.clientId && clients.find(x => x.id === slot.clientId);
      if (c) held.set(slot.id, c);
    }
    // A client keeps the free slot it took for as long as it is in the data.
    for (const [slotId, clientId] of claimed) {
      const c = clients.find(x => x.id === clientId);
      if (c) held.set(slotId, c);
      else claimed.delete(slotId);
    }
    for (const c of clients) {
      if (c.kind !== 'client' || [...held.values()].some(x => x.id === c.id)) continue;
      const slot = plan.slots.find(s => !s.clientId && !held.has(s.id) && served(s));
      if (slot) {
        held.set(slot.id, c);
        claimed.set(slot.id, c.id);
      } else console.warn('[client-districts] No free district slot with road access for client', c.name);
    }
    return held;
  }

  // Frees what a removed object owns. Cached materials, sign textures and tree geometry are shared and stay.
  function release(...objects) {
    for (const obj of objects) obj?.traverse(o => {
      if (o.isInstancedMesh) return o.dispose();
      o.geometry?.dispose();
      if (o.material?.map) o.material.dispose();
    });
  }

  function dropBuilding(num) {
    const e = byProject.get(num);
    root.remove(e.group);
    signs.remove(e.sign, e.post);
    release(e.group, e.sign, e.post);
    if (buildingObjects?.get(e.binding.id) === e.group) buildingObjects.delete(e.binding.id);
    for (const list of [clickable, api.buildings]) {
      const i = list ? list.indexOf(list === clickable ? e.group : e.binding) : -1;
      if (i >= 0) list.splice(i, 1);
    }
    byProject.delete(num);
  }

  function refresh() {
    const clients = dataConnector.getClients(), held = assignSlots(clients);
    const fixed = new Set((L.buildings || []).filter(x => x.kind === 'project').map(x => projectNumber(x.projectId ?? x.id)));
    const wanted = new Map(), home = new Map();
    for (const slot of plan.slots) {
      const client = held.get(slot.id) || null;
      const projects = client ? dataConnector.getClientProjects(client.id).filter(p => !fixed.has(projectNumber(p.id))) : [];
      wanted.set(slot.id, projects);
      for (const p of projects) home.set(projectNumber(p.id), slot.id);
    }
    // A project that left the data, or now belongs to another client, gives its lot back.
    let changed = false;
    for (const [num, e] of [...byProject]) {
      if (home.get(num) === e.slotId) continue;
      dropBuilding(num);
      changed = true;
    }
    for (const slot of plan.slots) {
      const client = held.get(slot.id) || null, frame = slotFrame(slot, tpl), lots = slotLots(slot, tpl);
      const projects = wanted.get(slot.id);
      // Lots already given stay; a lot number sent with the project wins; the rest take the lowest free lot.
      const taken = new Map();
      for (const p of projects) {
        const had = byProject.get(projectNumber(p.id));
        if (had && had.slotId === slot.id) taken.set(had.lot, p);
      }
      for (const p of projects) {
        const n = Number(p.lot);
        if ([...taken.values()].includes(p) || !(n >= 1 && n <= slot.lots) || taken.has(n)) continue;
        taken.set(n, p);
      }
      for (const p of projects) {
        if ([...taken.values()].includes(p)) continue;
        const lot = lots.find(l => !taken.has(l.n));
        if (lot) taken.set(lot.n, p);
        else console.warn('[client-districts] District', slot.label, 'has no lot left for', p.name);
      }
      const used = Math.max(0, ...taken.keys());
      const key = (client?.id || '') + '|' + (client?.name || '') + '|' + openLotCount(slot, tpl, used);
      let d = districts.get(slot.id);
      if (!d || d.key !== key) {
        if (d) {
          root.remove(d.group);
          if (d.road) access.remove(d.road);
          release(d.group, d.road);
        }
        const built = client ? buildDistrict(slot, client, used) : buildReserve(slot);
        d = {slot, client, key, road: client ? gateRoad(slot) : null, ...built};
        districts.set(slot.id, d);
        root.add(d.group);
        if (d.road) access.add(d.road);
      }
      d.projects = projects.length;
      const land = LANDSCAPES[slot.landscape] || LANDSCAPES.meadow;
      for (const [n, p] of taken) {
        const num = projectNumber(p.id);
        if (byProject.has(num)) continue;
        const lot = lots[n - 1], [x, z] = frame.toWorld(lot.u, lot.v);
        const g = buildProjectBuilding(p, land, p.id);
        g.position.set(x, frame.y + 0.18, z);
        g.rotation.y = frame.rotY + (lot.side > 0 ? Math.PI : 0);
        const id = 'bld:project:proj_' + String(num).padStart(2, '0');
        const binding = {id, legacyId: 'proj_' + String(num).padStart(2, '0'), projectId: p.id, kind: 'project', name: p.name, clientLabel: client.name, department: slot.id, lotId: lot.id, grade: 'B', position: [x, frame.y + 0.18, z], front: '+Z', level: 0};
        g.name = id;
        g.userData.binding = binding;
        g.userData.clientDistrict = slot.id;
        root.add(g);
        g.updateMatrixWorld(true);
        // Name board at the front of the lot, facing the road.
        const sign = board('project:' + p.name, 3.4, 0.8, 72, (ctx, w, h) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = HEX(land.accent);
          ctx.fillRect(0, 0, 10, h);
          ctx.fillStyle = '#1d2228';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          fitText(ctx, p.name, w - 34, 30, 700);
          ctx.fillText(p.name, 22, h / 2 + 1);
        });
        const [sx, sz] = frame.toWorld(lot.u + 2.2, lot.v - lot.side * (tpl.lotSize[1] / 2 - 0.5));
        sign.position.set(sx, frame.y + 1.25, sz);
        sign.rotation.y = frame.rotY + (lot.side > 0 ? 0 : Math.PI);
        const post = new T.Mesh(new T.BoxGeometry(0.12, 0.9, 0.12), M.pole);
        post.position.set(sx, frame.y + 0.62, sz);
        signs.add(sign, post);
        byProject.set(num, {group: g, binding, lot: n, slotId: slot.id, sign, post});
        changed = true;
        buildingObjects?.set(id, g);
        clickable?.push(g);
        api.buildings.push(binding);
      }
    }
    api.districts = [...districts.values()].map(d => {
      const f = slotFrame(d.slot, tpl);
      return {id: d.slot.id, label: d.slot.label, client: d.client, landscape: d.client ? (LANDSCAPES[d.slot.landscape] || LANDSCAPES.meadow).label : null, lots: d.slot.lots, depth: d.slot.depth, open: d.open, projects: d.projects, center: [f.center[0], f.y, f.center[1]], gate: [d.slot.gateXZ[0], f.y, d.slot.gateXZ[1]]};
    });
    if (changed) api.onChange?.();
  }

  // The branch roads to the corner districts, and under each district in use its road from the ring.
  const access = new T.Group();
  access.name = 'client-district-access';
  root.add(access);
  for (const road of plan.accessRoads || []) access.add(drapedRibbon(road.points, road.width, M.asphalt));
  // Bridges: a deck under the road and its sidewalks, parapets, and piers down to the bed of the water.
  for (const road of plan.accessRoads || []) for (const [from, to] of road.bridges || []) {
    const a = road.points[from], b = road.points[to], len = Math.hypot(b[0] - a[0], b[1] - a[1]), wide = road.width + 2 * tpl.sidewalkWidth + 0.8;
    const span = new T.Group();
    span.name = 'bridge:' + road.id;
    span.position.set((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, (a[1] + b[1]) / 2);
    span.rotation.set(0, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), Math.atan2(b[2] - a[2], len), 'YZX');
    const part = (m, w, h, d, x, y, z) => {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      span.add(mesh);
    };
    part(M.curb, len + 3, 0.6, wide, 0, -0.28, 0);
    for (const s of [-1, 1]) {
      part(M.plaza, len + 3, 0.22, 0.3, 0, 1.0, s * (wide / 2 - 0.15));
      for (let x = -len / 2 - 1.2; x <= len / 2 + 1.21; x += (len + 2.4) / Math.round((len + 2.4) / 2.4)) part(M.curb, 0.24, 0.9, 0.24, x, 0.47, s * (wide / 2 - 0.15));
    }
    const piers = Math.max(1, Math.round(len / 9) - 1);
    for (let i = 1; i <= piers; i++) {
      const t = i / (piers + 1), x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, top = a[2] + (b[2] - a[2]) * t - 0.55, foot = Math.min(terrain.height(x, z), 0) - 0.6;
      part(M.curb, 1.1, top - foot, wide - 1.6, (t - 0.5) * len, (top + foot) / 2 - span.position.y, 0);
    }
    access.add(span);
  }
  // A roundabout: a ring of road around a planted island.
  for (const r of plan.roundabouts || []) {
    const [cx, cz] = r.center, circle = (radius, n = 40) => Array.from({length: n + 1}, (_, i) => [cx + radius * Math.cos(i / n * Math.PI * 2), cz + radius * Math.sin(i / n * Math.PI * 2)]);
    const mid = (r.radius + r.islandRadius) / 2;
    access.add(drapedRibbon(circle(mid), r.radius - r.islandRadius + 0.6, M.asphalt, 0.075));
    access.add(drapedRibbon(circle(r.radius + tpl.sidewalkWidth / 2), tpl.sidewalkWidth, M.walk, 0.06));
    access.add(drapedRibbon(circle(r.islandRadius / 2, 20), r.islandRadius, M.curb, 0.2));
    const green = new T.Mesh(new T.CylinderGeometry(r.islandRadius - 0.35, r.islandRadius - 0.35, 0.3, 28), mat(0x6fa659));
    green.position.set(cx, roadHeight(cx, cz) + 0.2, cz);
    green.receiveShadow = true;
    access.add(green);
  }
  // Sidewalks and a dashed centre line along the branch roads, left open where the ring or a gate road crosses.
  const branchDress = new T.Group();
  access.add(branchDress);
  const ringHalf = (L.roadWidths?.[3] || 8) / 2;
  const ringGap = (() => {
    const c = L.roadPlan?.ringCorners, r = L.roadPlan?.ringCornerRadius || 0;
    if (!c) return () => Infinity;
    const xs = c.map(p => p[0]), zs = c.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const hx = (Math.max(...xs) - Math.min(...xs)) / 2, hz = (Math.max(...zs) - Math.min(...zs)) / 2;
    return (x, z) => {
      const qx = Math.abs(x - cx) - hx, qz = Math.abs(z - cz) - hz;
      return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    };
  })();
  const segGap = (x, z, [ax, az], [bx, bz]) => {
    const dx = bx - ax, dz = bz - az, t = T.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(x - ax - t * dx, z - az - t * dz);
  };
  function dressBranches() {
    release(branchDress);
    branchDress.clear();
    const gates = [...districts.values()].filter(d => d.road).map(d => [d.slot.ringXZ, d.slot.gateXZ]);
    const clearOf = (other, x, z, r) => other.points.every((p, i) => !i || segGap(x, z, other.points[i - 1], p) >= other.width / 2 + r);
    const base = ([x, z], r) => ringGap(x, z) >= ringHalf + r && gates.every(([a, b]) => segGap(x, z, a, b) >= tpl.roadWidth / 2 + r)
      && (plan.roundabouts || []).every(c => Math.hypot(x - c.center[0], z - c.center[1]) >= c.radius + r);
    for (const road of plan.accessRoads || []) {
      // Sidewalks and centre lines also stop where another branch road joins or leaves this one.
      const others = (plan.accessRoads || []).filter(o => o !== road), free = (p, r) => base(p, r) && others.every(o => clearOf(o, p[0], p[1], r));
      const v = road.points.map(p => new T.Vector3(p[0], 0, p[1]));
      const curve = v.length > 2 ? new T.CatmullRomCurve3(v, false, 'catmullrom', 0.15) : new T.LineCurve3(v[0], v[1]);
      const len = curve.getLength();
      const at = (d, o) => {
        const u = T.MathUtils.clamp(d / len, 0, 1), p = curve.getPointAt(u), t = curve.getTangentAt(u);
        return [p.x - t.z * o, p.z + t.x * o];
      };
      for (const s of [-1, 1]) {
        let piece = [];
        const close = () => {
          if (piece.length > 1) branchDress.add(drapedRibbon(piece, tpl.sidewalkWidth, M.walk, 0.09));
          piece = [];
        };
        for (let d = 0; d <= len; d += 1.2) {
          const p = at(d, s * (road.width / 2 + tpl.sidewalkWidth / 2));
          if (free(p, tpl.sidewalkWidth / 2 + 0.2)) piece.push(p); else close();
        }
        close();
      }
      for (let d = 2; d < len - 3.5; d += 3.2) {
        const dash = [at(d, 0), at(d + 0.8, 0), at(d + 1.6, 0)];
        if (dash.every(p => free(p, 0.6))) branchDress.add(drapedRibbon(dash, 0.16, M.line, 0.1));
      }
    }
  }
  function gateRoad(slot) {
    if (!slot.ringXZ) return null;
    const g = new T.Group(), f = slotFrame(slot, tpl);
    g.add(drapedRibbon([slot.ringXZ, f.toWorld(1, 0)], tpl.roadWidth, M.asphalt));
    const len = Math.hypot(slot.ringXZ[0] - slot.gateXZ[0], slot.ringXZ[1] - slot.gateXZ[1]);
    for (const s of [-1, 1]) g.add(drapedRibbon([f.toWorld(-len + 4.2, s * (tpl.roadWidth / 2 + 1)), f.toWorld(1, s * (tpl.roadWidth / 2 + 1))], tpl.sidewalkWidth, M.walk, 0.09));
    return g;
  }

  /**
   * The campus scatters trees and props over the whole map. Whatever stands on a district that
   * is in use, on its backdrop or on an access road is taken away; empty slots keep their trees.
   */
  function clearLand() {
    const zones = [...districts.values()].filter(d => d.client).map(d => {
      const f = slotFrame(d.slot, tpl), cos = Math.cos(f.rotY), sin = Math.sin(f.rotY), [gx, gz] = d.slot.gateXZ;
      return (x, z) => {
        const u = (x - gx) * cos - (z - gz) * sin, v = (x - gx) * sin + (z - gz) * cos;
        return (u >= -4 && u <= f.depth + 4 && Math.abs(v) <= f.half + 4) || (u > f.depth && u <= f.depth + 36 && Math.abs(v) <= f.half + 14);
      };
    });
    const lines = [...(plan.accessRoads || []).map(r => [r.points, r.width / 2 + tpl.sidewalkWidth + 1])];
    for (const d of districts.values()) if (d.client && d.slot.ringXZ) lines.push([[d.slot.ringXZ, d.slot.gateXZ], tpl.roadWidth / 2 + tpl.sidewalkWidth + 1.5]);
    const onRoad = (x, z) => lines.some(([pts, r]) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az;
        const t = T.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        if (Math.hypot(x - ax - t * dx, z - az - t * dz) <= r) return true;
      }
      return false;
    });
    const taken = (x, z) => zones.some(inside => inside(x, z)) || onRoad(x, z) || (terrain.world?.isSea(x, z) && terrain.height(x, z) < 0.6);
    const m = new T.Matrix4(), w = new T.Matrix4(), p = new T.Vector3(), gone = new T.Matrix4().makeScale(0, 0, 0);
    const mine = o => {
      for (let q = o; q; q = q.parent) if (q === root || q.name === 'state-visuals' || q.userData.binding) return true;
      return false;
    };
    scene.updateMatrixWorld(true);
    scene.traverse(o => {
      if (!o.isMesh || mine(o)) return;
      if (o.isInstancedMesh) {
        let changed = false;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          w.multiplyMatrices(o.matrixWorld, m);
          if (!taken(w.elements[12], w.elements[14])) continue;
          o.setMatrixAt(i, gone);
          changed = true;
        }
        if (changed) o.instanceMatrix.needsUpdate = true;
        return;
      }
      if (!o.visible) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if (o.geometry.boundingSphere.radius * o.getWorldScale(p).x > 12) return;
      o.getWorldPosition(p);
      if (taken(p.x, p.z)) o.visible = false;
    });
  }

  api.refresh = () => {
    const before = [...districts.values()].map(d => d.key).join();
    refresh();
    if (before === [...districts.values()].map(d => d.key).join()) return;
    clearLand();
    dressBranches();
  };
  refresh();
  clearLand();
  dressBranches();
  dataConnector.subscribe?.(api.refresh);
  return api;
}
