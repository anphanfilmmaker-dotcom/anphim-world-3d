/**
 * state-visuals.js
 * Draws each project's live state on the outside of its building:
 * scaffolding, a tower crane, the built height (milestone percentage),
 * the DELAY sign, status flags, the overdue clock and mission markers.
 *
 * Everything is an overlay next to the Campus V2.5 building: the building's
 * own geometry is never changed, only clipped (and dimmed) through cloned
 * materials that are dropped again when the project is finished.
 */
import * as T from 'three';

const COLORS = {
  scaffold: 0x8f9aa3,
  plank: 0xb89868,
  frame: 0xa3523c,
  deck: 0xb9b4a8,
  crane: 0xf2b21c,
  craneDark: 0x30363d,
  weight: 0x8b8f94,
  load: 0xd9763a,
  pole: 0xe8e8e8,
  flag: {feedback: 0xf5c518, revise: 0xe53935, done: 0x2e9e4f}
};

const BANNER = {
  building: {label: 'ĐANG XÂY', bg: '#f28c28', fg: '#1b1b1b'},
  feedback: {label: 'CHỜ KHÁCH', bg: '#f5c518', fg: '#1b1b1b'},
  revise: {label: 'CẦN REVISE', bg: '#d93025', fg: '#ffffff'}
};

const UP = new T.Vector3(0, 1, 0);
const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _d = new T.Vector3();

/** Collects boxes, then bakes them into one InstancedMesh per material. */
class BoxBatch {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.matrices = [];
  }
  box(w, h, d, x, y, z) {
    this.matrices.push(new T.Matrix4().compose(_p.set(x, y, z), _q.identity(), _s.set(w, h, d)));
  }
  /** A bar of square section `t` from point a to point b. */
  strut(a, b, t) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _d.length();
    if (len < 1e-4) return;
    _q.setFromUnitVectors(UP, _d.divideScalar(len));
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.matrices.push(new T.Matrix4().compose(_p, _q, _s.set(t, len, t)));
  }
  build(parent) {
    if (!this.matrices.length) return null;
    const mesh = new T.InstancedMesh(this.geometry, this.material, this.matrices.length);
    this.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  }
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';

function hazardStripes(ctx, w, h, band) {
  ctx.save();
  ctx.fillStyle = '#ffd21f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#16181b';
  for (let x = -h; x < w + h; x += band * 2) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + band, h);
    ctx.lineTo(x + band + h, 0);
    ctx.lineTo(x + h, 0);
    ctx.fill();
  }
  ctx.restore();
}

function fitText(ctx, text, maxWidth, size, weight = '900') {
  do {
    ctx.font = `${weight} ${size}px ${FONT}`;
    size -= 4;
  } while (ctx.measureText(text).width > maxWidth && size > 12);
}

function delayTexture(subtitle) {
  return canvasTexture(1024, 448, (ctx, w, h) => {
    hazardStripes(ctx, w, h, 46);
    ctx.fillStyle = '#ffd21f';
    ctx.fillRect(40, 40, w - 80, h - 80);
    ctx.strokeStyle = '#16181b';
    ctx.lineWidth = 10;
    ctx.strokeRect(40, 40, w - 80, h - 80);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c4161c';
    fitText(ctx, 'DELAY', w - 180, 230);
    ctx.fillText('DELAY', w / 2, subtitle ? 190 : h / 2);
    if (subtitle) {
      ctx.fillStyle = '#16181b';
      fitText(ctx, subtitle, w - 160, 72, '800');
      ctx.fillText(subtitle, w / 2, 340);
    }
  });
}

function bannerTexture(style, state) {
  return canvasTexture(768, 288, (ctx, w, h) => {
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = style.fg;
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = style.fg;
    ctx.textBaseline = 'middle';
    const hasPct = state.progress != null;
    ctx.textAlign = hasPct ? 'left' : 'center';
    fitText(ctx, style.label, hasPct ? 400 : w - 80, 64, '800');
    ctx.fillText(style.label, hasPct ? 40 : w / 2, hasPct ? 84 : h / 2);
    if (!hasPct) return;
    ctx.textAlign = 'right';
    fitText(ctx, state.progress + '%', 280, 124);
    ctx.fillText(state.progress + '%', w - 36, 96);
    ctx.textAlign = 'left';
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(`${state.milestonesDone}/${state.milestonesTotal} mốc`, 40, 150);
    ctx.globalAlpha = 0.28;
    ctx.fillRect(40, 200, w - 80, 44);
    ctx.globalAlpha = 1;
    ctx.fillRect(40, 200, (w - 80) * state.progress / 100, 44);
  });
}

function clockTexture() {
  return canvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#d93025';
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c, c, c - 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d93025';
    ctx.lineCap = 'round';
    ctx.lineWidth = 10;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(c + Math.sin(a) * 78, c - Math.cos(a) * 78);
      ctx.lineTo(c + Math.sin(a) * 90, c - Math.cos(a) * 90);
      ctx.stroke();
    }
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c, c - 66);
    ctx.moveTo(c, c);
    ctx.lineTo(c + 44, c + 22);
    ctx.stroke();
  });
}

function badgeTexture(text, bg, fg = '#ffffff') {
  return canvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(c, c + 6, c - 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(c, c, c - 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, text, w - 70, 150);
    ctx.fillText(text, c, c + 8);
  });
}

/** A sheet of paper with the number of documents still missing. */
function docTexture(count) {
  return canvasTexture(256, 256, ctx => {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3b6fd4';
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(56, 22);
    ctx.lineTo(150, 22);
    ctx.lineTo(200, 72);
    ctx.lineTo(200, 234);
    ctx.lineTo(56, 234);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(150, 22);
    ctx.lineTo(150, 72);
    ctx.lineTo(200, 72);
    ctx.stroke();
    ctx.fillStyle = '#d93025';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 110px ${FONT}`;
    ctx.fillText(String(count), 128, 156);
  });
}

export function createStateVisuals({scene, renderer, buildingObjects, dataConnector}) {
  renderer.localClippingEnabled = true;

  const unitBox = new T.BoxGeometry(1, 1, 1);
  const std = (color, extra = {}) => new T.MeshStandardMaterial({color, roughness: 0.75, metalness: 0.1, ...extra});
  const M = {
    scaffold: std(COLORS.scaffold, {metalness: 0.5, roughness: 0.5}),
    plank: std(COLORS.plank),
    frame: std(COLORS.frame, {metalness: 0.3}),
    deck: std(COLORS.deck, {roughness: 0.95}),
    crane: std(COLORS.crane, {metalness: 0.3, roughness: 0.55}),
    craneDark: std(COLORS.craneDark, {metalness: 0.4}),
    weight: std(COLORS.weight, {roughness: 0.95}),
    load: std(COLORS.load),
    pole: std(COLORS.pole, {metalness: 0.4}),
    beaconOn: new T.MeshBasicMaterial({color: 0xff3b30}),
    beaconOff: std(0x5a1f1c),
    pulse: new T.MeshBasicMaterial({color: 0xff3b30, transparent: true, opacity: 0.6, depthWrite: false}),
    flag: Object.fromEntries(Object.entries(COLORS.flag).map(([k, c]) => [k, std(c, {side: T.DoubleSide, roughness: 0.9})]))
  };
  const beaconGeo = new T.SphereGeometry(0.11, 12, 8);
  const flagGeo = new T.PlaneGeometry(1, 0.6, 8, 1).translate(0.5, 0, 0);
  const planeGeo = new T.PlaneGeometry(1, 1);
  const discGeo = new T.CircleGeometry(0.5, 32);

  const root = new T.Group();
  root.name = 'state-visuals';
  scene.add(root);

  const overlays = new Map();   // building id -> project overlay
  const markers = new Map();    // building id -> {group, key}
  const previews = new Map();   // building id -> state overrides (for trying states by hand)
  const textures = new Map();   // cache key -> CanvasTexture
  let lastT = 0;

  const texture = (key, make) => {
    if (!textures.has(key)) textures.set(key, make());
    return textures.get(key);
  };
  const sign = (tex, w, h, side = T.FrontSide) => {
    const mesh = new T.Mesh(planeGeo, new T.MeshBasicMaterial({map: tex, side, toneMapped: false}));
    mesh.scale.set(w, h, 1);
    mesh.userData.ownMaterial = true;
    return mesh;
  };
  const sprite = (tex, size) => {
    const s = new T.Sprite(new T.SpriteMaterial({map: tex, toneMapped: false, depthWrite: false}));
    s.scale.setScalar(size);
    s.userData.ownMaterial = true;
    return s;
  };
  const disposeGroup = group => {
    group.traverse(o => {
      if (o.userData.ownMaterial) o.material.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
    group.removeFromParent();
  };

  /** Size of the building in its own axes (front = +Z), measured once. */
  function measure(g) {
    const ry = g.rotation.y;
    g.rotation.y = 0;
    g.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(g);
    g.rotation.y = ry;
    g.updateMatrixWorld(true);
    const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    return {w: size.x, h: size.y, d: size.z, cx: center.x - g.position.x, cz: center.z - g.position.z, y0: box.min.y - g.position.y, scale: g.scale.x};
  }

  /** Clip the building at the built height and/or dim it, without touching its shared materials. */
  function setBuildingLook(o, clipPlane, dim) {
    const g = o.building;
    g.traverse(m => {
      if (!m.isMesh || !m.material || Array.isArray(m.material)) return;
      const original = m.userData.svOriginalMaterial || m.material;
      if (!clipPlane && !dim) {
        if (m.userData.svOriginalMaterial) {
          m.material.dispose();
          m.material = original;
          delete m.userData.svOriginalMaterial;
        }
        return;
      }
      if (!m.userData.svOriginalMaterial) {
        m.userData.svOriginalMaterial = original;
        m.material = original.clone();
        // clone() bỏ qua shader hook: giữ lại nét vẽ tay (paintedWash) của vật liệu gốc
        m.material.onBeforeCompile = original.onBeforeCompile;
        m.material.customProgramCacheKey = original.customProgramCacheKey;
      }
      m.material.clippingPlanes = clipPlane ? [clipPlane] : null;
      m.material.clipShadows = true;
      if (m.material.color) m.material.color.copy(original.color).multiplyScalar(dim ? 0.55 : 1);
      m.material.needsUpdate = true;
    });
  }

  function addScaffold(group, dim, top) {
    const {w, d} = dim, off = 0.32, x1 = w / 2 + off, z1 = d / 2 + off;
    const tubes = new BoxBatch(unitBox, M.scaffold), planks = new BoxBatch(unitBox, M.plank);
    const lifts = Math.max(2, Math.round(top / 0.95)), lift = top / lifts;
    const nx = Math.max(2, Math.round(2 * x1 / 1.15)), nz = Math.max(2, Math.round(2 * z1 / 1.15));
    for (let i = 0; i <= nx; i++) {
      const x = -x1 + 2 * x1 * i / nx;
      for (const z of [-z1, z1]) tubes.box(0.06, top + 0.5, 0.06, x, (top + 0.5) / 2, z);
    }
    for (let i = 1; i < nz; i++) {
      const z = -z1 + 2 * z1 * i / nz;
      for (const x of [-x1, x1]) tubes.box(0.06, top + 0.5, 0.06, x, (top + 0.5) / 2, z);
    }
    for (let l = 1; l <= lifts; l++) {
      const y = l * lift;
      for (const z of [-z1, z1]) {
        tubes.box(2 * x1, 0.05, 0.05, 0, y, z);
        tubes.box(2 * x1, 0.04, 0.04, 0, y + 0.42, z);
        planks.box(2 * x1, 0.04, 0.2, 0, y - 0.045, z - Math.sign(z) * 0.15);
      }
      for (const x of [-x1, x1]) {
        tubes.box(0.05, 0.05, 2 * z1, x, y, 0);
        tubes.box(0.04, 0.04, 2 * z1, x, y + 0.42, 0);
        planks.box(0.2, 0.04, 2 * z1 - 0.4, x - Math.sign(x) * 0.15, y - 0.045, 0);
      }
    }
    // Cross braces on alternate bays keep it reading as scaffolding from far away.
    for (let l = 0; l < lifts; l++) {
      for (let i = l % 2; i < nx; i += 2) {
        const a = -x1 + 2 * x1 * i / nx, b = -x1 + 2 * x1 * (i + 1) / nx;
        for (const z of [-z1, z1]) tubes.strut([a, l * lift, z], [b, (l + 1) * lift, z], 0.035);
      }
      for (let i = l % 2; i < nz; i += 2) {
        const a = -z1 + 2 * z1 * i / nz, b = -z1 + 2 * z1 * (i + 1) / nz;
        for (const x of [-x1, x1]) tubes.strut([x, l * lift, a], [x, (l + 1) * lift, b], 0.035);
      }
    }
    tubes.build(group);
    planks.build(group);
    return {x1, z1};
  }

  /** Bare structure for the part that is not built yet, plus the working deck on top of the built part. */
  function addUnbuiltFrame(group, dim, builtH) {
    const {w, h, d} = dim, x1 = w / 2 * 0.9, z1 = d / 2 * 0.9;
    const steel = new BoxBatch(unitBox, M.frame), deck = new BoxBatch(unitBox, M.deck);
    deck.box(w * 0.96, 0.08, d * 0.96, 0, builtH, 0);
    const rest = h - builtH;
    if (rest > 0.35) {
      const floors = Math.max(1, Math.round(rest / 1.1)), fh = rest / floors;
      for (const x of [-x1, 0, x1]) for (const z of [-z1, 0, z1]) {
        if (x === 0 && z === 0) continue;
        steel.box(0.12, rest, 0.12, x, builtH + rest / 2, z);
      }
      for (let f = 1; f <= floors; f++) {
        const y = builtH + f * fh;
        for (const z of [-z1, z1]) steel.box(2 * x1, 0.1, 0.1, 0, y, z);
        for (const x of [-x1, x1]) steel.box(0.1, 0.1, 2 * z1, x, y, 0);
        steel.box(2 * x1, 0.08, 0.08, 0, y, 0);
        steel.box(0.08, 0.08, 2 * z1, 0, y, 0);
      }
    }
    steel.build(group);
    deck.build(group);
  }

  function addCrane(group, dim, builtH, working) {
    const {w, h, d} = dim;
    const crane = new T.Group();
    crane.position.set(-w / 2 - 1.25, 0, -d / 2 - 0.55);
    group.add(crane);
    const mastH = h + Math.max(2.2, h * 0.35);
    const jibLen = Math.hypot(w, d) * 0.72 + 1.6, tail = jibLen * 0.36, a = 0.25;

    const mast = new BoxBatch(unitBox, M.crane), base = new BoxBatch(unitBox, M.weight);
    base.box(1.5, 0.22, 1.5, 0, 0.11, 0);
    for (const x of [-a, a]) for (const z of [-a, a]) mast.box(0.09, mastH, 0.09, x, mastH / 2, z);
    const seg = 0.6, n = Math.floor(mastH / seg);
    for (let i = 0; i < n; i++) {
      const y0 = i * seg + 0.22, y1 = y0 + seg, flip = i % 2 ? 1 : -1;
      mast.strut([-a * flip, y0, a], [a * flip, y1, a], 0.05);
      mast.strut([-a * flip, y0, -a], [a * flip, y1, -a], 0.05);
      mast.strut([a, y0, -a * flip], [a, y1, a * flip], 0.05);
      mast.strut([-a, y0, -a * flip], [-a, y1, a * flip], 0.05);
    }
    mast.build(crane);
    base.build(crane);

    const slew = new T.Group();
    slew.position.y = mastH;
    crane.add(slew);
    const yellow = new BoxBatch(unitBox, M.crane), dark = new BoxBatch(unitBox, M.craneDark), weight = new BoxBatch(unitBox, M.weight);
    dark.box(0.8, 0.16, 0.8, 0, 0.08, 0);
    dark.box(0.5, 0.5, 0.46, 0.14, 0.41, 0.56);           // operator cab
    const apex = 1.5, jy = 0.34;
    for (const x of [-a, a]) for (const z of [-a, a]) yellow.strut([x, 0.16, z], [0, apex, 0], 0.07);
    // Jib: two bottom chords, one top chord, zigzag lacing.
    const top = jy + 0.36, steps = Math.max(4, Math.round(jibLen / 0.6)), sx = jibLen / steps;
    for (const z of [-0.17, 0.17]) yellow.strut([0, jy, z], [jibLen, jy, z], 0.07);
    yellow.strut([0, top, 0], [jibLen - sx, top, 0], 0.07);
    for (let i = 0; i < steps; i++) {
      const x0 = i * sx, xm = Math.min(x0 + sx / 2, jibLen - sx);
      for (const z of [-0.17, 0.17]) {
        yellow.strut([x0, jy, z], [xm, top, 0], 0.04);
        yellow.strut([xm, top, 0], [x0 + sx, jy, z], 0.04);
      }
    }
    yellow.box(tail, 0.12, 0.42, -tail / 2, jy, 0);          // counter-jib
    weight.box(0.7, 0.6, 0.54, -tail + 0.4, jy - 0.34, 0);  // counterweight
    dark.strut([0, apex, 0], [jibLen * 0.62, top, 0], 0.03);
    dark.strut([0, apex, 0], [-tail + 0.2, jy + 0.05, 0], 0.03);
    yellow.build(slew);
    dark.build(slew);
    weight.build(slew);

    const beacon = new T.Mesh(beaconGeo, working ? M.beaconOn : M.beaconOff);
    beacon.position.y = apex + 0.1;
    slew.add(beacon);

    const trolley = new T.Group();
    trolley.position.y = jy - 0.06;
    slew.add(trolley);
    const carriage = new T.Mesh(unitBox, M.craneDark);
    carriage.scale.set(0.36, 0.12, 0.44);
    trolley.add(carriage);
    const cable = new T.Mesh(unitBox, M.craneDark);
    const hook = new T.Group();
    const block = new T.Mesh(unitBox, M.crane);
    block.scale.set(0.2, 0.24, 0.2);
    hook.add(block);
    let load = null;
    if (working) {
      load = new T.Mesh(unitBox, M.load);
      load.scale.set(0.62, 0.36, 0.46);
      load.position.y = -0.34;
      load.castShadow = true;
      hook.add(load);
    }
    trolley.add(cable, hook);

    // Angle that points the jib from the mast at the middle of the building.
    const aim = Math.atan2(-(d / 2 + 0.55), w / 2 + 1.25);
    const reach = Math.hypot(w / 2 + 1.25, d / 2 + 0.55);
    const maxDrop = Math.max(0.8, mastH + jy - builtH - 0.75);
    const pose = t => {
      let angle, x, drop;
      if (working) {
        const swing = Math.sin(t * 0.22);
        angle = aim + 0.85 * swing;
        x = Math.min(jibLen - 0.3, reach * (0.95 + 0.3 * Math.sin(t * 0.31 + 1.3)));
        drop = 0.7 + (maxDrop - 0.7) * (0.5 - 0.5 * Math.cos(t * 0.5));
        beacon.material = Math.sin(t * 5) > 0 ? M.beaconOn : M.beaconOff;
      } else {
        angle = aim + 2.2;   // parked, jib swung away from the building
        x = 1.1;
        drop = 0.7;
      }
      slew.rotation.y = angle;
      trolley.position.x = x;
      cable.scale.set(0.035, drop, 0.035);
      cable.position.y = -drop / 2;
      hook.position.y = -drop - 0.1;
    };
    pose(lastT);
    return working ? pose : null;
  }

  function addFlag(group, material, x, z, height, animated) {
    const pole = new BoxBatch(unitBox, M.pole);
    pole.box(0.07, height, 0.07, x, height / 2, z);
    pole.build(group);
    const flag = new T.Mesh(flagGeo, material);
    flag.position.set(x + 0.04, height - 0.36, z);
    flag.castShadow = true;
    group.add(flag);
    animated.push(t => { flag.rotation.y = 0.22 * Math.sin(t * 2.1 + x); });
  }

  function buildOverlay(o, state) {
    if (o.group) disposeGroup(o.group);
    o.animate = [];
    o.busy = false;
    o.clip = null;
    const group = o.group = new T.Group();
    group.name = 'state:' + o.id;
    group.userData.buildingId = o.id;
    root.add(group);
    const dim = o.dim, {w, h, d} = dim;
    const inner = new T.Group();
    inner.position.set(dim.cx, dim.y0, dim.cz);
    group.add(inner);

    const mode = state?.mode;
    if (!mode) {
      setBuildingLook(o, null, false);
      return;
    }
    const underConstruction = mode !== 'done';
    const pct = state.progress;
    const partBuilt = underConstruction && pct != null && pct < 100;
    const builtH = partBuilt ? h * Math.max(0.08, pct / 100) : h;
    const delayed = mode === 'paused' || state.overdueDays > 0;
    const edge = {x1: w / 2, z1: d / 2};

    if (partBuilt) {
      o.clip = new T.Plane(new T.Vector3(0, -1, 0), 0);
      o.builtH = builtH;
    }
    setBuildingLook(o, o.clip, mode === 'paused');

    if (underConstruction) {
      Object.assign(edge, addScaffold(inner, dim, h + 0.2));
      if (partBuilt) addUnbuiltFrame(inner, dim, builtH);
      const working = mode === 'building' || mode === 'revise';
      const pose = addCrane(inner, dim, builtH, working);
      if (pose) {
        o.animate.push(pose);
        o.busy = true;
      }
    }

    if (delayed) {
      const sw = Math.min(7.5, Math.max(4.6, w * 0.95)), sh = sw * 0.4375;
      const cy = Math.max(h * 0.62, sh / 2 + 1.1), z = edge.z1 + 0.16;
      const parts = [];
      if (mode === 'paused') parts.push('TẠM DỪNG');
      if (state.overdueDays > 0) parts.push(`TRỄ HẠN ${state.overdueDays} NGÀY`);
      if (pct != null && parts.length < 2) parts.push(`XONG ${pct}%`);
      const text = parts.join(' · ');
      const tex = texture('delay:' + text, () => delayTexture(text));
      const front = sign(tex, sw, sh);
      front.position.set(0, cy, z + 0.05);
      const back = sign(tex, sw, sh);
      back.position.set(0, cy, -z - 0.05);
      back.rotation.y = Math.PI;
      inner.add(front, back);
      const posts = new BoxBatch(unitBox, M.craneDark);
      for (const s of [1, -1]) {
        for (const x of [-sw * 0.36, sw * 0.36]) posts.box(0.14, cy + sh / 2, 0.14, x, (cy + sh / 2) / 2, s * z);
        posts.box(sw + 0.16, sh + 0.16, 0.06, 0, cy, s * z);
      }
      posts.build(inner);
    } else if (BANNER[mode]) {
      const bw = Math.min(4.4, Math.max(2.6, w * 0.72)), bh = bw * 0.375;
      const tex = texture(`banner:${mode}:${pct}:${state.milestonesDone}/${state.milestonesTotal}`, () => bannerTexture(BANNER[mode], state));
      const y = Math.max(bh / 2 + 1.05, h * 0.58);
      const front = sign(tex, bw, bh);
      front.position.set(0, y, edge.z1 + 0.06);
      const back = sign(tex, bw, bh);
      back.position.set(0, y, -edge.z1 - 0.06);
      back.rotation.y = Math.PI;
      inner.add(front, back);
    }

    if (M.flag[mode]) addFlag(inner, M.flag[mode], edge.x1 + 0.3, edge.z1 + 0.3, h + 1.7, o.animate);

    if (mode === 'revise') {
      const ring = new BoxBatch(unitBox, M.pulse), rx = edge.x1 + 0.55, rz = edge.z1 + 0.55;
      for (const z of [-rz, rz]) ring.box(2 * rx + 0.18, 0.06, 0.18, 0, 0.06, z);
      for (const x of [-rx, rx]) ring.box(0.18, 0.06, 2 * rz - 0.18, x, 0.06, 0);
      const mesh = ring.build(inner);
      mesh.castShadow = mesh.receiveShadow = false;
      o.busy = true;
    }

    if (state.overdueDays > 0) {
      const clock = new T.Mesh(discGeo, new T.MeshBasicMaterial({map: texture('clock', clockTexture), side: T.DoubleSide, toneMapped: false}));
      clock.userData.ownMaterial = true;
      clock.scale.setScalar(1.25);
      clock.position.set(0, h + 1.25, 0);
      inner.add(clock);
      const post = new BoxBatch(unitBox, M.craneDark);
      post.box(0.1, 0.7, 0.1, 0, h + 0.3, 0);
      post.build(inner);
    }

    if (state.missingDocs > 0) {
      const doc = sprite(texture('docs:' + state.missingDocs, () => docTexture(state.missingDocs)), 1.0);
      doc.position.set(-w / 2 - 0.2, h + 1.5, d / 2);
      inner.add(doc);
    }
  }

  function projectState(binding) {
    const project = dataConnector.getProject(binding.projectId || binding.legacyId);
    const state = project ? dataConnector.getProjectState(project) : null;
    const override = previews.get(binding.id);
    if (!override) return state;
    const base = state || {status: '', mode: null, progress: null, milestonesDone: 0, milestonesTotal: 0, overdueDays: 0, missingDocs: 0};
    const merged = {...base, ...override};
    if (override.progress != null && override.milestonesTotal == null) {
      merged.milestonesTotal = base.milestonesTotal || 10;
      merged.milestonesDone = Math.round(merged.milestonesTotal * override.progress / 100);
    }
    return merged;
  }

  /** Mission count and "system down" markers float above any building. */
  function refreshMarkers() {
    const counts = dataConnector.getMissionCounts();
    const down = new Map(dataConnector.getSystems().filter(s => s.buildingId && s.status && s.status !== 'online').map(s => [s.buildingId, s.status]));
    for (const [id, g] of buildingObjects) {
      const count = counts.get(id) || 0, sys = down.get(id) || '';
      const key = count + '|' + sys;
      let m = markers.get(id);
      if (m && m.key === key && m.building === g) continue;
      if (m) disposeGroup(m.group);
      markers.delete(id);
      if (!count && !sys) continue;
      const group = new T.Group();
      group.userData.buildingId = id;
      root.add(group);
      const dim = overlays.get(id)?.dim || measure(g);
      const lift = g.userData.binding?.kind === 'project' ? 2.9 : 1.3;
      m = {key, building: g, group, dim, lift, beacon: null};
      if (count) {
        const badge = sprite(texture('mission:' + count, () => badgeTexture(count > 1 ? '!' + count : '!', '#f28c28')), 1.25);
        group.add(badge);
      }
      if (sys) {
        const beacon = new T.Mesh(beaconGeo, sys === 'down' ? M.beaconOn : M.flag.feedback);
        beacon.scale.setScalar(2.4);
        beacon.position.set(count ? 0.95 : 0, 0, 0);
        group.add(beacon);
        m.beacon = sys === 'down' ? beacon : null;
      }
      markers.set(id, m);
    }
    for (const [id, m] of markers) {
      if (!buildingObjects.has(id)) {
        disposeGroup(m.group);
        markers.delete(id);
      }
    }
  }

  function refresh() {
    for (const [id, g] of buildingObjects) {
      const binding = g.userData.binding;
      if (!binding || binding.kind !== 'project') continue;
      let o = overlays.get(id);
      if (o && o.building !== g) {
        if (o.group) disposeGroup(o.group);
        o = null;
      }
      if (!o) {
        o = {id, building: g, dim: measure(g), group: null, key: null, animate: [], busy: false, clip: null, builtH: 0};
        overlays.set(id, o);
      }
      const state = projectState(binding);
      const key = JSON.stringify(state);
      if (key !== o.key) {
        o.key = key;
        o.state = state;
        buildOverlay(o, state);
      }
    }
    for (const [id, o] of overlays) {
      if (buildingObjects.get(id) === o.building) continue;
      if (o.group) disposeGroup(o.group);
      overlays.delete(id);
    }
    refreshMarkers();
    tick(lastT);
  }

  /** Follows the buildings and moves cranes, flags and lights. Returns true while something is animating. */
  function tick(t) {
    lastT = t;
    let busy = false;
    M.pulse.opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3.2));
    for (const o of overlays.values()) {
      const g = o.building, group = o.group;
      if (!group) continue;
      group.visible = g.visible && !!g.parent;
      group.position.copy(g.position);
      group.rotation.y = g.rotation.y;
      const k = g.scale.x / o.dim.scale;   // the editor can resize a building after it was measured
      group.scale.setScalar(k);
      if (o.clip) o.clip.constant = g.position.y + (o.dim.y0 + o.builtH) * k;
      if (!group.visible) continue;
      for (const fn of o.animate) fn(t);
      busy = busy || o.busy;
    }
    const blink = Math.sin(t * 5) > 0;
    for (const m of markers.values()) {
      const g = m.building;
      m.group.visible = g.visible && !!g.parent;
      const k = g.scale.x / m.dim.scale;
      m.group.position.set(g.position.x + m.dim.cx * k, g.position.y + (m.dim.y0 + m.dim.h) * k + m.lift, g.position.z + m.dim.cz * k);
      if (m.beacon) {
        m.beacon.material = blink ? M.beaconOn : M.beaconOff;
        busy = busy || m.group.visible;
      }
    }
    return busy;
  }

  const unsubscribe = dataConnector.subscribe(refresh);
  refresh();

  return {
    refresh,
    tick,
    /** State drawn for a building right now (after any preview override). */
    getState: id => overlays.get(id)?.state || null,
    /** Try a state by hand: preview('bld:project:proj_25', {mode: 'paused', progress: 80}). */
    preview(id, override) {
      previews.set(id, override);
      refresh();
    },
    clearPreview(id) {
      if (id) previews.delete(id);
      else previews.clear();
      refresh();
    },
    dispose() {
      unsubscribe();
      for (const o of overlays.values()) {
        setBuildingLook(o, null, false);
        if (o.group) disposeGroup(o.group);
      }
      for (const m of markers.values()) disposeGroup(m.group);
      for (const tex of textures.values()) tex.dispose();
      root.removeFromParent();
    }
  };
}
