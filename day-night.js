/**
 * day-night.js
 * Day and night for the campus. One number, `k` (0 = day, 1 = night), drives the sky, fog, sun and
 * sky light, and what switches on after dark: lamp heads, a pool of light on the ground and a halo
 * at every lamp, and warm windows. Day values are whatever main.js set from campus-palette.json,
 * so k = 0 is exactly the daylight scene.
 */
import * as T from 'three';

const STORE_KEY = 'anphim.world.dayNight';
const MODES = ['day', 'night', 'auto'];
const TRANSITION_MS = 2600;
const RESCAN_MS = 1200;        // the editor and the districts add and rebuild objects while the page runs
const AUTO_CHECK_MS = 30000;
const NIGHT_FROM = 18, NIGHT_TO = 6; // auto mode: night from 18:00 to 06:00 local time

// k = 0.5 is dusk; colours go day -> dusk -> night.
const NIGHT = {
  sky: '#101c3a', skyDusk: '#e8a27c',
  sun: '#a9c2ff', sunDusk: '#ff9d5e', sunIntensity: 1.25,
  hemiSky: '#7d99e0', hemiGround: '#2c3a5e', hemiIntensity: 1.0,
  window: '#ffc56e', windowIntensity: 0.85,
  lamp: '#ffd9a0', lampIntensity: 2.4,
  pool: '#ffb866', poolOpacity: 0.5, haloOpacity: 0.85
};

const LAMP_NAME = /(^|[^a-z])lamp([^a-z]|$)/i;

const smooth = t => t * t * (3 - 2 * t);
const through = (out, a, mid, b, k) => k < 0.5 ? out.lerpColors(a, mid, k * 2) : out.lerpColors(mid, b, k * 2 - 1);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/**
 * @param {object} o
 * @param {T.Scene} o.scene
 * @param {T.DirectionalLight} o.sun
 * @param {T.HemisphereLight} o.hemi
 * @param {object} o.palette        campus-palette.json (glass colours)
 * @param {(x: number, z: number) => number} o.groundHeight
 * @param {() => void} [o.onChange]  mode or day/night changed
 */
export function createDayNight({scene, sun, hemi, palette, groundHeight, windowGlow, onChange}) {
  const C = v => new T.Color(v);
  // The animator takes the background and fog off the scene while it draws a room, so hold the objects themselves.
  const background = scene.background, fog = scene.fog;
  const day = {
    sky: background.clone(), sun: sun.color.clone(), sunIntensity: sun.intensity,
    hemiSky: hemi.color.clone(), hemiGround: hemi.groundColor.clone(), hemiIntensity: hemi.intensity
  };
  const night = {sky: C(NIGHT.sky), skyDusk: C(NIGHT.skyDusk), sun: C(NIGHT.sun), sunDusk: C(NIGHT.sunDusk), hemiSky: C(NIGHT.hemiSky), hemiGround: C(NIGHT.hemiGround)};
  const glassColors = [palette.colors.referenceGlass, palette.colors.glass].filter(Boolean).map(C);
  const windowColor = C(NIGHT.window), lampColor = C(NIGHT.lamp), poolColor = C(NIGHT.pool), sky = new T.Color();

  const url = new URLSearchParams(location.search).get('time');
  let mode = MODES.includes(url) ? url : MODES.includes(localStorage.getItem(STORE_KEY)) ? localStorage.getItem(STORE_KEY) : 'day';
  const clockNight = () => { const h = new Date().getHours(); return h >= NIGHT_FROM || h < NIGHT_TO; };
  const wantNight = () => mode === 'auto' ? clockNight() : mode === 'night';

  let k = wantNight() ? 1 : 0, from = k, to = k, startedAt = 0, lastScan = -Infinity, lastAuto = 0, lampKey = '';
  const lit = new Map(); // material -> {kind: 'lamp' | 'window', emissive, intensity} as it was by day

  const texture = glowTexture();
  const group = new T.Group();
  group.name = 'night-lights';
  group.visible = false;
  scene.add(group);
  const poolMaterial = new T.MeshBasicMaterial({map: texture, color: poolColor, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4});
  // Halo: a quad that always faces the camera, sized in world units (the instance's scale) so it scales with zoom.
  const haloMaterial = new T.ShaderMaterial({
    uniforms: {map: {value: texture}, color: {value: lampColor}, opacity: {value: 0}},
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * length(instanceMatrix[0].xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 color; uniform float opacity; varying vec2 vUv;
      void main() { gl_FragColor = vec4(color * texture2D(map, vUv).a * opacity, 1.0); }`,
    transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
  });
  const poolGeometry = new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), haloGeometry = new T.PlaneGeometry(1, 1);
  let pools = null, halos = null;

  // A lamp head is a near-white material with a warm white glow (lanterns in modular-roads.js, hq-gardens.js, campus-editor.js).
  const isLamp = m => {
    if (m.userData.nightLamp) return true;
    const e = m.emissive.getHex();
    return m.emissiveIntensity > 0 && m.color.getHex() >> 16 > 230 && e >> 16 > 230 && (e >> 8 & 255) > 190 && (e & 255) > 100;
  };
  const isGlass = m => m.metalness > 0.05 && glassColors.some(c => Math.abs(c.r - m.color.r) + Math.abs(c.g - m.color.g) + Math.abs(c.b - m.color.b) < 0.03);

  function addLights(heads) {
    const key = heads.length + ':' + heads.reduce((s, {p}) => s + p.x * 3 + p.y * 5 + p.z * 7, 0).toFixed(1);
    if (key === lampKey) return;
    lampKey = key;
    for (const mesh of [pools, halos]) if (mesh) { group.remove(mesh); mesh.dispose(); }
    pools = halos = null;
    if (!heads.length) return;
    pools = new T.InstancedMesh(poolGeometry, poolMaterial, heads.length);
    halos = new T.InstancedMesh(haloGeometry, haloMaterial, heads.length);
    const m = new T.Matrix4();
    heads.forEach(({p, tall}, i) => {
      // A tall street lantern lights a wide pool, a low path lamp a small one, on the ground at its foot.
      const radius = T.MathUtils.clamp(tall * 2.1, 3.4, 7.5), halo = T.MathUtils.clamp(tall * 0.8, 1.5, 2.8);
      pools.setMatrixAt(i, m.makeScale(radius, 1, radius).setPosition(p.x, p.y - tall + 0.2, p.z));
      halos.setMatrixAt(i, m.makeScale(halo, halo, halo).setPosition(p.x, p.y, p.z));
    });
    for (const mesh of [pools, halos]) {
      mesh.frustumCulled = false;
      mesh.raycast = () => {};                 // never picked by the inspector or the editor
      mesh.userData.keepInArrivalZone = true;  // urban-planning-engine clears other meshes in front of the HQ
      mesh.renderOrder = mesh === pools ? 3 : 4;
      group.add(mesh);
    }
    pools.name = 'night-light-pools';
    halos.name = 'night-lamp-halos';
  }

  /** Finds lamp and window materials (and lamp positions) in the scene as it is now. */
  function scan() {
    const heads = [], named = [], p = new T.Vector3(), im = new T.Matrix4();
    // `top` is the lamp head in the mesh's own space; instances scaled to nothing are lamps the planner removed.
    const head = (o, top, list = heads) => {
      const add = matrix => {
        if (Math.abs(matrix.elements[0]) + Math.abs(matrix.elements[1]) + Math.abs(matrix.elements[2]) < 1e-6) return;
        const at = p.copy(top).applyMatrix4(matrix).clone(), ground = groundHeight(at.x, at.z);
        // A lamp on a plinth or a deck keeps its light near its own foot.
        list.push({p: at, tall: T.MathUtils.clamp(at.y - ground, 0.8, 4.2)});
      };
      o.updateWorldMatrix(true, false);
      if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); add(im.premultiply(o.matrixWorld)); }
      else add(o.matrixWorld);
    };
    const visit = o => {
      if (o === group || o.userData.interior || !o.visible) return;
      const m = o.isMesh && !Array.isArray(o.material) && o.material.isMeshStandardMaterial ? o.material : null;
      if (m) {
        if (!lit.has(m)) {
          const kind = isLamp(m) ? 'lamp' : isGlass(m) ? 'window' : null;
          lit.set(m, kind && {kind, emissive: m.emissive.clone(), intensity: m.emissiveIntensity});
        }
        if (lit.get(m)?.kind === 'lamp') {
          // One mesh or instance per lamp head. Many heads merged into one mesh have no single place: they only glow.
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          if (o.geometry.boundingSphere.radius < 1.5) head(o, o.geometry.boundingSphere.center);
        }
        else if (LAMP_NAME.test(o.name)) {
          // A whole lamp merged into one mesh (path lamps in campus-greenery.js): the head is its top.
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          head(o, new T.Vector3((b.min.x + b.max.x) / 2, b.max.y - 0.15, (b.min.z + b.max.z) / 2), named);
        }
      }
      for (const c of o.children) visit(c);
    };
    visit(scene);
    // The pole and cap of a lantern carry "lamp" in their names too: one light per lamp.
    for (const n of named) if (!heads.some(h => Math.hypot(h.p.x - n.p.x, h.p.z - n.p.z) < 1)) heads.push(n);
    addLights(heads);
  }

  function lightColors(e) {
    through(sun.color, day.sun, night.sunDusk, night.sun, e);
    hemi.color.lerpColors(day.hemiSky, night.hemiSky, e);
    hemi.groundColor.lerpColors(day.hemiGround, night.hemiGround, e);
  }

  function apply() {
    const e = smooth(k);
    through(sky, day.sky, night.skyDusk, night.sky, e);
    background.copy(sky);
    fog?.color.copy(sky);
    lightColors(e);
    sun.intensity = T.MathUtils.lerp(day.sunIntensity, NIGHT.sunIntensity, e);
    hemi.intensity = T.MathUtils.lerp(day.hemiIntensity, NIGHT.hemiIntensity, e);

    // Lights come on in the second half of dusk.
    const on = smooth(T.MathUtils.clamp((k - 0.45) / 0.55, 0, 1));
    for (const [m, was] of lit) {
      if (!was) continue;
      if (was.kind === 'lamp') m.emissiveIntensity = was.intensity + on * NIGHT.lampIntensity;
      else {
        m.emissive.lerpColors(was.emissive, windowColor, on);
        m.emissiveIntensity = T.MathUtils.lerp(was.intensity, NIGHT.windowIntensity, on);
      }
    }
    windowGlow.value.copy(windowColor).multiplyScalar(on * NIGHT.windowIntensity);
    poolMaterial.opacity = on * NIGHT.poolOpacity;
    haloMaterial.uniforms.opacity.value = on * NIGHT.haloOpacity;
    group.visible = on > 0;
  }

  function go(now = performance.now()) {
    const target = wantNight() ? 1 : 0;
    if (target === to) return;
    from = k;
    to = target;
    startedAt = now;
  }

  function setMode(next) {
    if (!MODES.includes(next) || next === mode) return;
    mode = next;
    localStorage.setItem(STORE_KEY, mode);
    go();
    onChange?.();
  }

  apply();

  return {
    get mode() { return mode; },
    get auto() { return mode === 'auto'; },
    /** Where the world is heading: true once night is switched on, also while it is still getting dark. */
    get night() { return to === 1; },
    get amount() { return k; },
    setMode,
    setNight: on => setMode(on ? 'night' : 'day'),
    setAuto: on => setMode(on ? 'auto' : (to === 1 ? 'night' : 'day')),
    /** Call once per frame; true while the light is changing, so the frame must be drawn. */
    tick(now) {
      if (mode === 'auto' && now - lastAuto > AUTO_CHECK_MS) {
        lastAuto = now;
        const before = to;
        go(now);
        if (to !== before) onChange?.();
      }
      const moving = k !== to;
      if (moving) k = T.MathUtils.lerp(from, to, T.MathUtils.clamp((now - startedAt) / TRANSITION_MS, 0, 1));
      const rescan = (k > 0 || to > 0) && now - lastScan > RESCAN_MS;
      if (rescan) { lastScan = now; scan(); }
      if (moving || rescan) apply();
      return moving;
    },
    /** Rooms are lit from inside: the animator draws them under the day light colours, then puts the night back. */
    roomLight(on) { lightColors(on ? 0 : smooth(k)); }
  };
}
