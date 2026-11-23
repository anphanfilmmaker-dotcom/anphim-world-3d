import {createModularRoadSystem} from './modular-roads.js?rev=14';
import {createHQGardens} from './hq-gardens.js?rev=63';
import {createGamePostProcessing} from './game-postprocessing.js?rev=1';
import {createCampusEditor} from './campus-editor.js?rev=129';
import {createLandscapePolish} from './landscape-polish.js?rev=119';
import {createCampusGreenery} from './campus-greenery.js?rev=13';
import {createGroundDebug} from './ground-debug.js?rev=20';
import {createPedestrianRouter} from './pedestrian-router.js?rev=20';
import {runSpatialLint} from './spatial-lint.js?rev=1';
import {getStudioModelById} from './asset-pack-extractor.js?rev=146';
import * as T from 'three';
import {composeCapture} from './capture.js?rev=hq9';
import {createEcosystemDesign} from './ecosystem-design.js?rev=sep_master_plan_v9';
import {createNetwork} from './network.js?rev=21';
import {OrbitControls} from './vendor/OrbitControls.js';
import {createCameraDirector} from './camera-director.js?rev=3';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {createArchitecture} from './architecture.js?rev=v43';
import {createAdapter, nightWindowGlow} from './materials.js?rev=10';
import {createAssetRegistry} from './asset-registry.js?rev=8';
import {createTerrain} from './terrain.js?rev=hq28';
import {createRoads} from './roads.js?rev=8';
import {createLandscape} from './landscape.js?rev=up4';
import {createUrbanPlanningEngine} from './urban-planning-engine.js?rev=median2';
import {dataConnector} from './data-connector.js';
import {CutawayAnimator} from './cutaway-animator.js?rev=cutaway_v4';
import {CockpitHUD} from './cockpit-hud.js';
import {CockpitFrame} from './cockpit-frame.js';
import {createDayNight} from './day-night.js';
import {BuildingPanels} from './building-panels.js';
import {createStateVisuals} from './state-visuals.js';
import {createClientDistricts} from './client-districts.js';
import {createWorldBackdrop} from './world-landscape.js';
import {districtPlan, districtGroundPads} from './district-layout.js';

window.THREE = T;

const report = {
  schemaVersion: '2.5.0-art-review-c',
  scope: 'anphim-world-v25-integrated-ground',
  ready: false,
  errors: [],
  loadedAssets: [],
  buildings: [],
  roadWidths: {'1': 2, '2': 4, '3': 8},
  priority: [3, 2, 1],
  businessWrites: 0,
  liveDatabaseConnections: 0,
  artApproval: 'pending-user-review',
  massingReview: false,
  warnings: []
};

const out = document.querySelector('#proof-report'), status = document.querySelector('#status');
const sync = () => out.textContent = JSON.stringify(report);
window.addEventListener('error', e => { report.errors.push(e.message); sync(); });
window.addEventListener('unhandledrejection', e => { report.errors.push(String(e.reason)); sync(); });

const fetchJSON = async u => {
  const r = await fetch(u, {cache: 'no-store'});
  if (!r.ok) throw Error(u + ':' + r.status);
  return r.json();
};

try { await main(); }
catch(e) {
  report.errors.push(e.message);
  status.textContent = 'Không dựng được Campus: ' + e.message;
  sync();
  console.error(e);
}

async function main() {
  console.log('[STEP 1] main started');
  // Automatically purge stale legacy cached states
  localStorage.removeItem('ANPHIM_CAMPUS_STUDIO_STATE');
  localStorage.removeItem('ANPHIM_CAMPUS_STUDIO_STATE_V25');
  localStorage.removeItem('ANPHIM_CAMPUS_STUDIO_STATE_V27');
  localStorage.removeItem('ANPHIM_CAMPUS_STUDIO_STATE_V26');
  localStorage.removeItem('CAMPUS_STUDIO_SAVE_V2');

  // Tự động dọn dẹp các cache localStorage cũ để lấy 100% nguồn gốc từ file JSON độc lập
  ['hq', 'telegram', 'bank', 'vault', 'hermes', 'database', 'oracle'].forEach(b => {
    localStorage.removeItem('anphim_studio_config_' + b);
  });

  // Nạp cấu hình riêng biệt của từng tòa nhà từ thư mục buildings_config/ (Mỗi tòa 1 file JSON độc lập)
  const staticBuildingConfigs = {};
  await Promise.all(['hq', 'telegram', 'bank', 'vault', 'hermes', 'database', 'oracle'].map(async b => {
    try {
      const res = await fetch(`./buildings_config/${b}.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) staticBuildingConfigs[b] = await res.json();
    } catch (_) {}
  }));

  const [L, P] = await Promise.all([fetchJSON('./physical-topology.json?rev=sep_master_plan_v13'), fetchJSON('./campus-palette.json?rev=finalPaletteV10')]);
  console.log('[STEP 2] topology loaded');
  report.lightRig = P.lighting;
  report.paletteVersion = P.schemaVersion;
  report.aliasMapping = L.aliasMapping;

  const scene = new T.Scene();
  scene.background = new T.Color(P.colors.sky);
  scene.fog = new T.Fog(P.colors.sky, 420, 950);

  const renderer = new T.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  // Bóng đổ mềm kiểu diorama: PCF + shadow.radius (PCFSoft bỏ qua radius). ?shadow=soft|vsm để so sánh A/B.
  const urlShadow = new URLSearchParams(window.location.search).get('shadow') || 'pcf';
  renderer.shadowMap.type = urlShadow === 'vsm' ? T.VSMShadowMap : (urlShadow === 'soft' ? T.PCFSoftShadowMap : T.PCFShadowMap);
  renderer.outputColorSpace = T.SRGBColorSpace;
  document.querySelector('#scene').append(renderer.domElement);

  // Ánh sáng lấy từ campus-palette.json (lighting): hemisphere trời xanh nhạt / đất ấm + sun ấm.
  // Cân chỉnh để cỏ ngoài nắng ra ~#74ab47 và cỏ trong bóng ~#3c6944 (ảnh tham chiếu) với NeutralToneMapping exposure 1.0
  const LR = P.lighting, lightColor = k => new T.Color(P.colors[k] || k);
  const hemi = new T.HemisphereLight(lightColor(LR.skyColor), lightColor(LR.groundColor), LR.hemisphereIntensity);
  scene.add(hemi);
  const sun = new T.DirectionalLight(lightColor(LR.sunColor), LR.sunIntensity);

  // P3: Hệ thống Tone Mapping A/B/C debug flag
  function setToneMappingMode(mode) {
    if (mode === 'A' || mode === 'A1') {
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.86;
    } else if (mode === 'A2') {
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.00; // Cùng exposure 1.0 với Neutral để so sánh công bằng
    } else if (mode === 'B') {
      renderer.toneMapping = T.NeutralToneMapping;
      renderer.toneMappingExposure = 1.00;
    } else if (mode === 'C') {
      renderer.toneMapping = T.NeutralToneMapping;
      renderer.toneMappingExposure = 1.08;
    }
    window.__toneMappingMode = mode;
  }
  window.__setToneMappingMode = setToneMappingMode;
  const urlTone = new URLSearchParams(window.location.search).get('tone') || 'B';
  setToneMappingMode(urlTone);
  sun.position.set(...LR.sunPosition);
  sun.castShadow = true;
  sun.shadow.mapSize.set(LR.shadowMapSize, LR.shadowMapSize);
  // The shadow box covers the campus and, seen from the sun, every district that has a client.
  {
    const box = [-130, 130, -130, 130, 380], view = new T.Matrix4().lookAt(sun.position, sun.target.position, sun.up).setPosition(sun.position).invert(), p = new T.Vector3();
    const tenants = new Set((districtPlan(L)?.slots || []).filter(s => s.clientId).map(s => s.id));
    for (const pad of districtGroundPads(L, 8)) {
      if (!tenants.has(pad.id)) continue;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [pad.y, pad.y + 24]) {
        p.set(pad.x + sx * pad.hx, y, pad.z + sz * pad.hz).applyMatrix4(view);
        box[0] = Math.min(box[0], p.x); box[1] = Math.max(box[1], p.x);
        box[2] = Math.min(box[2], p.y); box[3] = Math.max(box[3], p.y);
        box[4] = Math.max(box[4], 12 - p.z);
      }
    }
    [sun.shadow.camera.left, sun.shadow.camera.right, sun.shadow.camera.bottom, sun.shadow.camera.top, sun.shadow.camera.far] = box;
  }
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = LR.shadowRadius;
  sun.shadow.blurSamples = LR.shadowBlurSamples;
  scene.add(sun);

  const camera = new T.OrthographicCamera(-100, 100, 50, -50, 0.1, 800);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 10;
  controls.maxDistance = 450;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.35;
  controls.mouseButtons = {
    LEFT: T.MOUSE.ROTATE, // Chế độ xem: kéo chuột trái để xoay, click không kéo để chọn. Editor: camera-director tắt chuột trái
    MIDDLE: T.MOUSE.ROTATE, // Chuột giữa xoay góc nhìn tự do 360 độ
    RIGHT: T.MOUSE.PAN      // Giữ chuột phải kéo để di chuyển camera
  };
  controls.addEventListener('start', () => { report.camera = 'free-orbit'; });

  // Ngăn chặn context menu trình duyệt khi kéo chuột phải & autoscroll chuột giữa
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  renderer.domElement.addEventListener('pointerdown', e => {
    if (e.button === 1) e.preventDefault();
  });

  let postPipeline = null;
  let span = 95, currentView = 'overview';
  function size() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    if (postPipeline) postPipeline.resize(w, h);
    camera.left = -span * w / h / 2;
    camera.right = span * w / h / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', size);

  postPipeline = createGamePostProcessing(renderer, scene, camera);
  postPipeline.buildHUDControls();

  function setSpan(newSpan) {
    span = newSpan;
    const w = innerWidth, h = innerHeight;
    camera.left = -span * w / h / 2;
    camera.right = span * w / h / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
  }

  const views = {
    junction: {pos:[0, 90, 20], target:[0, 4, 32], span: 26},
    stairZoom: {pos:[0, 60, 0], target:[0, 6, 12], span: 20},
    arrivalLow: {pos:[22,13,42],target:[0,5,17],span:32},
    internalLow: {pos:[58,12,-8],target:[34,4,-23],span:35},
    forecourt: {pos:[22,28,34],target:[0,6,7],span:28},
    overview: {pos: [92, 121, 153], target: [8, 5, 0], span: 79},
    top: {pos: [-10, 190, -6], target: [-10, 0, -7], span: 118},
    arrival: {pos: [30, 42, 62], target: [0, 9, 12], span: 58},
    vistax: {pos: [196, 38, 10], target: [168, 4, -13], span: 40},
    uturn_top: {pos: [0, 52, 25.5], target: [0, 4.5, 25.0], span: 26},
    hqref: {pos: [0, 80, 94], target: [0, 9, 9], span: 60},
    commons: {pos: [25, 40, -55], target: [0, 5, -21], span: 36},
    admin: {pos: [-55, 42, -5], target: [-24, 4, -19], span: 45},
    finance: {pos: [-58, 42, 40], target: [-25, 4, 15], span: 45},
    it: {pos: [62, 45, 40], target: [32.5, 4, 15], span: 48},
    internal: {pos: [62, 48, -6], target: [33, 4, -20], span: 55},
    oracle: {pos: [52, 28, 25], target: [38, 4, 10], span: 32},
    cluster: {pos: [71, 65, 70], target: [31, 2, -6], span: 76},
    hero: {pos: [31, 30, 48], target: [0, 12, -4], span: 31},
    showcase: {pos: [136, 42, 52], target: [86, 6, 2], span: 54},
    front: {pos: [0, 13, 75], target: [0, 13, -5], span: 23},
    side: {pos: [-75, 13, -5], target: [0, 13, -5], span: 23},
    back: {pos: [0, 18, -75], target: [0, 12, -5], span: 29},
    hqRearAngle: {pos: [-25, 42, -35], target: [0, 10, -5], span: 28}
  };

  const director = createCameraDirector({
    camera, controls, domElement: renderer.domElement,
    getSpan: () => span, setSpan,
    keyboardEnabled: () => !(cutawayAnimator && cutawayAnimator.isInspecting),
    leftDragRotates: () => !editor.isEditMode() || !!(cutawayAnimator && cutawayAnimator.isInspecting),
    onUserMove: mode => { report.camera = mode; }
  });

  function view(k, {immediate = false} = {}) {
    const v = views[k];
    if (!v) return;
    currentView = k;
    director.flyTo({position: v.pos, target: v.target, span: v.span}, {immediate});
    report.camera = k;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === k)));
    sync();
  }

  window.setCameraSpan = setSpan;
  window.setCameraView = view;
  window.cameraDirector = director;

  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => view(b.dataset.view));
  size();
  view(new URLSearchParams(location.search).get('view') || 'overview', {immediate: true});

  const V23 = await fetchJSON('./assets-manifest.json?rev=local-v23');
  const A = createArchitecture(P), adapter = createAdapter(P), registry = createAssetRegistry(adapter, report);
  const terrain = createTerrain(scene, P, L), roads = await createRoads(scene, P, L, terrain, adapter, report);
  console.log('[STEP 3] roads created');
  report.terrain = {waterNormalY: terrain.waterNormalY, riverWidth: terrain.riverWidth};

  const layers = Object.fromEntries(['groundcover', 'shrubs', 'canopy', 'parcels', 'footprints', 'labels', 'biomes'].map(k => [k, new T.Group()]));
  for (const g of Object.values(layers)) scene.add(g);
  layers.parcels.visible = layers.footprints.visible = false;
  layers.biomes.visible = true;
  document.querySelectorAll('[data-layer]').forEach(el => {
    el.onchange = () => { if (layers[el.dataset.layer]) layers[el.dataset.layer].visible = el.checked; };
  });
  const footprintToggle = document.querySelector('#toggle-footprints');
  if (footprintToggle) {
    footprintToggle.onchange = () => {
      layers.footprints.visible = footprintToggle.checked;
      layers.parcels.visible = footprintToggle.checked;
    };
    layers.footprints.visible = footprintToggle.checked;
    layers.parcels.visible = footprintToggle.checked;
  }

  const clickable = [], allDoors = [], buildingObjects = new Map();
  let network = null;

  // Chuyển sắc kiểu vẽ tay trên mặt nhà: chân tường sẫm và ấm hơn, lên cao sáng dần (vertex color theo cao độ trong tòa).
  // Cường độ lấy từ campus-palette.json (lighting.faceGradient, 0 = tắt). Vật liệu có texture (biển chữ) giữ nguyên.
  const FACE_GRADIENT = P.lighting.faceGradient ?? 0.24;
  const gradientMaterials = new WeakMap();
  function gradientMaterial(mat) {
    if (!FACE_GRADIENT || mat.map || !mat.isMeshStandardMaterial) return null;
    if (!gradientMaterials.has(mat)) {
      const m = mat.clone();
      m.vertexColors = true;
      paintedWash(m, mat.metalness > 0.05); // chỉ vật liệu kính có metalness
      gradientMaterials.set(mat, m);
    }
    return gradientMaterials.get(mat);
  }
  // Nét vẽ tay trên mặt nhà (lighting.paintedWash trong campus-palette.json, strength 0 = tắt): mặt đón nắng ngả ấm, mặt khuất nắng ngả lạnh,
  // loang màu tần số thấp theo toạ độ world như nét cọ, và vệt sáng chéo trên kính. Chỉ đổi màu nền (albedo), không đụng tới đèn.
  const WASH = {strength: 1, warmCool: 0.07, blotch: 0.06, glassSheen: 0.14, ...(P.lighting.paintedWash || {})};
  const sunDir = new T.Vector3(...P.lighting.sunPosition).normalize();
  function paintedWash(material, glass) {
    if (!(WASH.strength > 0)) return;
    const k = WASH.strength, f = v => (v * k).toFixed(4);
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWashPos;\nvarying vec3 vWashNormal;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWashPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWashNormal = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWashPos;
          varying vec3 vWashNormal;
          float washHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float washNoise(vec3 p) {
            vec3 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
            return mix(mix(mix(washHash(i), washHash(i + vec3(1, 0, 0)), u.x), mix(washHash(i + vec3(0, 1, 0)), washHash(i + vec3(1, 1, 0)), u.x), u.y),
                       mix(mix(washHash(i + vec3(0, 0, 1)), washHash(i + vec3(1, 0, 1)), u.x), mix(washHash(i + vec3(0, 1, 1)), washHash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 wn = normalize(vWashNormal);
            float lit = dot(wn, vec3(${sunDir.x.toFixed(4)}, ${sunDir.y.toFixed(4)}, ${sunDir.z.toFixed(4)}));
            float side = 1.0 - abs(wn.y);
            vec3 warm = vec3(1.0 + ${f(WASH.warmCool)}, 1.0 + ${f(WASH.warmCool * 0.35)}, 1.0 - ${f(WASH.warmCool * 0.9)});
            vec3 cool = vec3(1.0 - ${f(WASH.warmCool * 1.1)}, 1.0 - ${f(WASH.warmCool * 0.2)}, 1.0 + ${f(WASH.warmCool * 0.9)});
            diffuseColor.rgb *= mix(vec3(1.0), mix(cool, warm, smoothstep(-0.25, 0.45, lit)), 0.35 + 0.65 * side);
            float blotch = washNoise(vWashPos * vec3(0.42, 0.3, 0.42)) * 0.65 + washNoise(vWashPos * 1.15 + 17.0) * 0.35;
            diffuseColor.rgb *= 1.0 + ${f(WASH.blotch)} * (blotch - 0.5) * 2.0;
            // Nét cọ: nhiễu kéo dài theo đường chéo trên mặt đứng, và mảng màu ngả ấm / ngả lạnh đổi chậm theo vị trí
            vec2 sp = vec2(vWashPos.x + vWashPos.z, vWashPos.y);
            float stroke = washNoise(vec3(sp.x * 0.3 + sp.y * 0.45, sp.y * 2.3 - sp.x * 0.85, (vWashPos.x - vWashPos.z) * 0.3));
            float roofStroke = washNoise(vec3((vWashPos.x + vWashPos.z * 0.6) * 0.22, (vWashPos.z - vWashPos.x * 0.6) * 1.4, 3.0));
            diffuseColor.rgb *= 1.0 + ${f(WASH.strokes || 0)} * (mix(roofStroke, stroke, side) - 0.5) * 2.0;
            float hue = washNoise(vWashPos * vec3(0.23, 0.17, 0.23) + 41.0);
            diffuseColor.rgb *= mix(vec3(1.0 - ${f((WASH.tint || 0) * 0.8)}, 1.0, 1.0 + ${f(WASH.tint || 0)}), vec3(1.0 + ${f(WASH.tint || 0)}, 1.0 + ${f((WASH.tint || 0) * 0.3)}, 1.0 - ${f(WASH.tint || 0)}), hue);
            ${glass ? `float streak = sin((vWashPos.x + vWashPos.z) * 0.55 + vWashPos.y * 1.15);
            diffuseColor.rgb += ${f(WASH.glassSheen)} * side * (smoothstep(0.72, 0.95, streak) + 0.5 * smoothstep(0.9, 0.99, sin((vWashPos.x + vWashPos.z) * 0.55 + vWashPos.y * 1.15 + 1.1)));` : ''}
          }`);
    };
    material.customProgramCacheKey = () => 'painted-wash-' + glass + '-' + JSON.stringify(WASH);
    material.needsUpdate = true;
  }
  function paintFaceGradient(geo, y0, height) {
    const p = geo.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / height)), k = FACE_GRADIENT * (1 - t) ** 1.4;
      c[i * 3] = 1 - k * 0.85;
      c[i * 3 + 1] = 1 - k;
      c[i * 3 + 2] = 1 - k * 1.3;
    }
    geo.setAttribute('color', new T.BufferAttribute(c, 3));
  }

  function mergeBuilding(group) {
    group.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(group), boundsH = Math.max(0.01, bounds.max.y - bounds.min.y);
    const buckets = new Map();
    for (const o of [...group.children]) {
      if (!o.isMesh || Array.isArray(o.material)) continue;
      const geo = o.geometry.clone().applyMatrix4(o.matrix);
      const n = geo.index ? geo.toNonIndexed() : geo;
      if (n !== geo) geo.dispose();
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(n);
      group.remove(o);
    }
    for (const [mat, geos] of buckets) {
      const g = mergeGeometries(geos, false);
      // P4: Dispose all intermediate non-indexed geometries after merge
      for (const geom of geos) {
        geom.dispose();
      }
      if (!g) throw Error('Không merge được building');
      const shaded = gradientMaterial(mat);
      if (shaded) paintFaceGradient(g, bounds.min.y, boundsH);
      const m = new T.Mesh(g, shaded || mat);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    return group;
  }

  function label(text, x, y, z, width = 10, height = 1.8, parent = layers.labels, flat = false) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 192;
    const ctx = c.getContext('2d');
    ctx.fillStyle = P.colors.brandMoss;
    ctx.font = '600 82px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 96, 1000);
    const tx = new T.CanvasTexture(c);
    tx.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({map: tx, transparent: true, depthWrite: false, side: T.DoubleSide}));
    m.position.set(x, y, z);
    if (flat) m.rotation.x = -Math.PI / 2;
    parent.add(m);
    return m;
  }

  let cutawayAnimator = null;
  let cockpitHUD = null;
  let cockpitFrame = null;

  let buildingPanels = null;
  let insideBuilding = null;
  async function inspector(b) {
    if (cutawayAnimator) {
      const g = (L && L.grades && L.grades[b.grade]) || [12, 5, 10];
      const pos = [...(b.position || [0, 0, 0])];
      insideBuilding = b;
      cutawayAnimator.inspect(b.id, pos, {
        width: g[0], depth: g[2], height: g[1], name: b.name, hostId: b.hostId,
        view: dataConnector.getBuildingView(b)
      });
      // Approved interiors get their own left/right panels; other buildings keep the old detail wing.
      const own = buildingPanels && buildingPanels.show(b);
      const root = document.getElementById('cockpit-hud-root');
      if (root) root.style.display = own ? 'none' : 'flex';
      if (cockpitHUD && !own) cockpitHUD.render(b.id);
      if (cockpitFrame) cockpitFrame.setInside(b);
    } else {
      const sel = document.querySelector('#selection');
      if (sel) sel.hidden = false;
      const t = document.querySelector('#selected-title');
      if (t) t.textContent = b.name;
    }
    report.lastPicked = b.id;
    network?.select(b.id);
    sync();
  }
  document.querySelector('#close').onclick = () => document.querySelector('#selection').hidden = true;

  const STYLIZED_BUILDING_MAP = {
    'telegram': { id: '#023', rotY: Math.PI, maxHeight: 18 },  // Tháp Phát Sóng & Quan Sát Đỏ
    'bank':     { id: '#016', rotY: 0, maxHeight: 16 },        // Tháp Văn Phòng Kính Xanh Mái Xéo
    'documents':{ id: '#004', rotY: Math.PI, maxHeight: 8 },   // Tòa Nhà Phố Shophouse Cam 3 Tầng
    'reserve':  { id: '#019', rotY: Math.PI, maxHeight: 7.5 }, // Khối Đế Thương Mại Kính Hoa Văn
    'drive':    { id: '#007', rotY: 0, maxHeight: 5.5 },       // Cửa Hàng Showroom 1 Tầng Vách Kính
    'ai':       { id: '#020', rotY: 0, maxHeight: 11 },        // Tháp Cao Ốc Neon Tím Xanh
    'hermes':   { id: '#010', rotY: 0, maxHeight: 9.5 },       // Tòa Nhà Văn Phòng Kính Tím Hiện Đại
    'supabase': { id: '#018', rotY: 0, maxHeight: 8.5 },       // Tòa Văn Phòng Kính Xanh 3 Tầng
    'oracle':   { id: '#012', rotY: 0, maxHeight: 15 },        // Tháp Cao Ốc Trắng Giật Cấp
    'google':   { id: '#009', rotY: Math.PI, maxHeight: 7 },   // Tòa Nhà Văn Phòng Kính Ngang 4 Tầng
    'proj_24':  { id: '#002', rotY: Math.PI, maxHeight: 7.5 }, // Cửa Hàng Thời Trang Clothes 2 Tầng
    'proj_25':  { id: '#003', rotY: Math.PI, maxHeight: 6.5 }, // Tòa Nhà Thương Mại 3 Tầng Biển Cam
    'proj_05':  { id: '#005', rotY: 0, maxHeight: 7 }          // Tòa Chung Cư Vàng 5 Tầng Có Ban Công
  };

  // --- ĐỒNG BỘ CẤU HÌNH TỪ BUILDING STUDIO SANG CAMPUS (VERSION 2 - PART_ID CỐ ĐỊNH) ---
  function getStudioConfig(type) {
    // 100% NGUỒN CHUẨN TỪ FILE JSON RIÊNG BIỆT TRONG THƯ MỤC buildings_config/
    if (staticBuildingConfigs[type] && staticBuildingConfigs[type].version >= 3) {
      return staticBuildingConfigs[type];
    }
    return null;
  }

  function tagBuildingPartsForCampus(group, type) {
    let counter = 0;
    group.traverse(c => {
      if (c.isMesh) {
        c.userData.partId = `${type}_part_${counter++}`;
      }
    });
  }

  function applyStudioConfigToBuilding(group, type, config) {
    if (!config) return group;

    // 1. Phân loại và lọc toggles (Hỗ trợ tất cả các tòa nhà theo dynamic toggleKey)
    if (config.toggles) {
      if (type === 'hq') {
        group.traverse(c => {
          if (c.position.z >= 9.0 && (c.position.y <= 5.0)) c.userData.toggleKey = 'canopy';
          if (c.position.y >= 25.0) c.userData.toggleKey = 'solar';
          if ((c.position.x >= 9.5 && c.position.z >= 10.5) || (c.position.x <= -1.0 && c.position.z >= 7.8 && c.position.z <= 8.5)) c.userData.toggleKey = 'fins';
          if (c.position.y >= 7.0 && c.position.x >= 4.0 && c.position.z <= 4.0) c.userData.toggleKey = 'lantern';
          if (c.geometry && c.geometry.type === 'ExtrudeGeometry' && c.position.z === 2.1) c.userData.toggleKey = 'shoulder';
        });
      }

      const toRemove = [];
      group.traverse(c => {
        if (c.userData.toggleKey && config.toggles[c.userData.toggleKey] === false) {
          toRemove.push(c);
        } else if (c.userData.isCanopy && config.toggles.canopy === false) {
          toRemove.push(c);
        } else if (c.userData.isSolar && config.toggles.solar === false) {
          toRemove.push(c);
        } else if (c.userData.isFins && config.toggles.fins === false) {
          toRemove.push(c);
        } else if (c.userData.isLantern && config.toggles.lantern === false) {
          toRemove.push(c);
        } else if (c.userData.isShoulder && config.toggles.shoulder === false) {
          toRemove.push(c);
        }
      });
      toRemove.forEach(c => { if (c.parent) c.parent.remove(c); });
    }

    // 2. Xóa các chi tiết đã bị xóa trong Studio (deletedPartIds)
    if (config.deletedPartIds && Array.isArray(config.deletedPartIds)) {
      const toRemove = [];
      group.traverse(c => {
        if (c.isMesh && config.deletedPartIds.includes(c.userData.partId)) {
          toRemove.push(c);
        }
      });
      toRemove.forEach(c => { if (c.parent) c.parent.remove(c); });
    }

    // 3. Tinh chỉnh scale & position các chi tiết đã sửa trong Studio (modifiedParts)
    if (config.modifiedParts && Array.isArray(config.modifiedParts)) {
      const meshMap = new Map();
      group.traverse(c => {
        if (c.isMesh && c.userData.partId) {
          meshMap.set(c.userData.partId, c);
        }
      });

      config.modifiedParts.forEach(p => {
        if (!p.partId) return;
        const mesh = meshMap.get(p.partId);
        if (mesh && mesh.isMesh) {
          if (p.position) mesh.position.set(p.position.x, p.position.y, p.position.z);
          if (p.scale) mesh.scale.set(p.scale.x, p.scale.y, p.scale.z);
          if (p.rotation) mesh.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
          if (p.visible !== undefined) mesh.visible = p.visible;
          mesh.updateMatrix();
        }
      });
      group.updateMatrixWorld(true);
    }

    return group;
  }

  for (const b of L.buildings) {
    let g, bbox, f = null, offsetLot = false;
    const [w, h, d] = (L.grades && L.grades[b.grade]) || [7, 7, 7];
    const isSmallBuilding = ['documents', 'drive', 'google'].includes(b.legacyId) || String(b.id).startsWith('bld:project:');

    if (b.style === 'hq') {
      const studioCfg = getStudioConfig('hq');
      let hqA = A;
      if (studioCfg && studioCfg.colors && (studioCfg.colors.glassColor || studioCfg.colors.accentColor)) {
        const customP = JSON.parse(JSON.stringify(P));
        if (studioCfg.colors.glassColor) customP.colors.referenceGlass = studioCfg.colors.glassColor;
        if (studioCfg.colors.accentColor) customP.colors.brandOrange = studioCfg.colors.accentColor;
        hqA = createArchitecture(customP);
      }
      let rawBuilding = hqA.HQ();
      tagBuildingPartsForCampus(rawBuilding, 'hq');
      if (studioCfg) {
        rawBuilding = applyStudioConfigToBuilding(rawBuilding, 'hq', studioCfg);
      }

      const src = mergeBuilding(rawBuilding);
      for (const m of src.children) {
        if (m.isMesh) {
          const p = m.geometry.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const y = p.getY(i);
            if (y > 5.55) p.setY(i, 5.55 + (y - 5.55) * 0.86);
          }
          m.geometry.computeVertexNormals();
        }
      }
      f = A.fit(src, b.grade, L.grades);
      g = f.group;
      bbox = f.bbox;
    } else {
      let bldType = null;
      if (b.legacyId === 'telegram') bldType = 'telegram';
      else if (b.legacyId === 'hermes' || b.style === 'research') bldType = 'hermes';
      else if (b.legacyId === 'reserve' || b.style === 'vault') bldType = 'vault';
      else if (b.legacyId === 'bank' || b.style === 'bank') bldType = 'bank';
      else if (b.legacyId === 'supabase') bldType = 'database';
      else if (b.legacyId === 'oracle') bldType = 'oracle';

      let currentA = A;
      let studioCfg = bldType ? getStudioConfig(bldType) : null;
      if (studioCfg && studioCfg.colors && (studioCfg.colors.glassColor || studioCfg.colors.accentColor)) {
        const customP = JSON.parse(JSON.stringify(P));
        if (studioCfg.colors.glassColor) customP.colors.referenceGlass = studioCfg.colors.glassColor;
        if (studioCfg.colors.accentColor) customP.colors.brandOrange = studioCfg.colors.accentColor;
        currentA = createArchitecture(customP);
      }

      let rawBuilding;
      if (b.legacyId === 'telegram') rawBuilding = currentA.telegramTower();
      else if (b.legacyId === 'hermes' || b.style === 'research') rawBuilding = currentA.hermesLab();
      else if (b.legacyId === 'reserve' || b.style === 'vault') rawBuilding = currentA.vaultBuilding();
      else if (b.legacyId === 'bank' || b.style === 'bank') rawBuilding = currentA.bankBuilding();
      else if (b.legacyId === 'supabase') rawBuilding = currentA.databaseBuilding();
      else if (b.legacyId === 'oracle') rawBuilding = currentA.oracleCloudBuilding();
      else if (b.legacyId === 'ai' || b.style === 'office') rawBuilding = currentA.officeBuilding();
      // Các tòa nhỏ (tài liệu, drive, google, tòa dự án) dựng bằng code theo ảnh tham chiếu thay cho model GLB mặt phẳng
      else if (isSmallBuilding) rawBuilding = currentA.smallCampusBuilding(b.legacyId);
      else rawBuilding = await registry.building(V23.bindings[b.legacyId], currentA, b.legacyId);

      if (bldType) {
        tagBuildingPartsForCampus(rawBuilding, bldType);
        if (studioCfg) {
          rawBuilding = applyStudioConfigToBuilding(rawBuilding, bldType, studioCfg);
        }
      }

      // Tòa nhỏ dựng bằng code nằm gọn trong mặt bằng của model cũ, nên khe hở và khoảng lùi giữa các tòa không đổi
      // Vài tòa có lô được nới rộng tại chỗ cho cánh nhà chữ L (plot.front != null): khối đế vẫn đứng đúng vị trí topology và mép trước
      // của lô ở chỗ cũ, nên lô chỉ nới về phía cánh và ra sau; vị trí và id trong topology giữ nguyên.
      const plot = isSmallBuilding ? currentA.smallBuildingPlot(b.legacyId) : null;
      const merged = mergeBuilding(rawBuilding);
      const coreX = plot && plot.front !== null ? new T.Box3().setFromObject(merged).getCenter(new T.Vector3()).x : 0;
      f = A.fit(merged, b.grade, plot ? {[b.grade]: [plot.size[0], plot.size[1] || L.grades[b.grade][1], plot.size[2]]} : L.grades);
      if (plot && plot.front !== null) {
        const dz = (plot.front - f.bbox[2] / 2) / f.scale;
        for (const child of f.group.children) {
          child.position.x += coreX;
          child.position.z += dz;
        }
        offsetLot = true;
      }
      g = f.group;
      bbox = f.bbox;
    }
    // Snap Y theo cao độ thực tế của địa hình terrain (P5)
    const groundY = terrain.height(b.position[0], b.position[2]);
    // Giữ nguyên thiết kế đặc biệt cho HQ trên bệ dốc cao (Y=6.8)
    const finalY = (b.style === 'hq') ? b.position[1] : groundY;
    b.position[1] = finalY;

    g.position.set(b.position[0], finalY, b.position[2]);
    // Tòa nhỏ dựng bằng code có mặt tiền (+Z cục bộ): xoay mặt tiền về phía cửa khai trong topology (doorXZ) khi topology chưa cho rotationY.
    let rotY = b.rotationY;
    if (rotY === undefined && isSmallBuilding && b.doorXZ) {
      const dx = b.doorXZ[0] - b.position[0], dz = b.doorXZ[1] - b.position[2];
      if (Math.abs(dx) > Math.abs(dz)) rotY = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
      else if (dz < 0) rotY = Math.PI;
    }
    if (rotY !== undefined) g.rotation.y = rotY;
    g.userData.binding = b;
    g.userData.buildingId = b.id;
    g.userData.isBuildingRoot = true;
    g.name = 'building_' + b.id;
    g.traverse(c => {
      c.userData.buildingId = b.id;
      c.userData.isBuildingPart = true;
    });
    scene.add(g);
    g.updateMatrixWorld(true);
    clickable.push(g);
    console.log('[STEP 4] building placed:', b.id);
    buildingObjects.set(b.id, g);

    const socket = g.getObjectByName('entry-socket'), door = socket.getWorldPosition(new T.Vector3());
    allDoors.push({id: b.id, x: door.x, z: door.z});

    // Khung định vị phẳng sát mặt đất (Flat Ground Outlines - Không dùng Box3Helper 3D)
    // Lô lệch tâm (tòa có cánh chữ L): lô thật ghi trong hệ tọa độ cục bộ của tòa (chưa xoay), để khung và kiểm tra va chạm của Studio
    // đi theo khi tòa bị dời hoặc xoay.
    let lot = null;
    if (offsetLot) {
      const rotation = g.rotation.y, box = new T.Box3();
      g.rotation.y = 0;
      g.updateMatrixWorld(true);
      box.setFromObject(g);
      lot = g.userData.lot = {x: (box.min.x + box.max.x) / 2 - g.position.x, z: (box.min.z + box.max.z) / 2 - g.position.z, w: box.max.x - box.min.x, d: box.max.z - box.min.z};
      g.rotation.y = rotation;
      g.updateMatrixWorld(true);
      box.setFromObject(g);
      // Cây và tiểu cảnh tự động (urban-planning-engine) tránh lô thật này; chỉ là dữ liệu lúc chạy, không ghi vào physical-topology.json
      (L.builtLots ||= {})[b.id] = {minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z};
    }
    const fpGeo = new T.EdgesGeometry(new T.PlaneGeometry(lot ? lot.w : bbox[0], lot ? lot.d : bbox[2]));
    if (lot) fpGeo.translate(lot.x, -lot.z, 0);
    const footprint = new T.LineSegments(fpGeo, new T.LineBasicMaterial({color: P.colors.brandOrange, transparent: true, opacity: 0.85}));
    footprint.rotation.x = -Math.PI / 2;
    if (lot) footprint.rotation.z = g.rotation.y;
    footprint.position.set(b.position[0], b.position[1] + 0.04, b.position[2]);
    footprint.userData.buildingId = b.id;
    footprint.userData.isFootprint = true;
    g.userData.footprint = footprint;
    layers.footprints.add(footprint);

    const pcGeo = new T.EdgesGeometry(new T.PlaneGeometry(w + 2, d + 2));
    const parcel = new T.LineSegments(pcGeo, new T.LineBasicMaterial({color: 0x5588aa, transparent: true, opacity: 0.5}));
    parcel.rotation.x = -Math.PI / 2;
    parcel.position.set(b.position[0], b.position[1] + 0.03, b.position[2]);
    layers.parcels.add(parcel);

    // Door connector leading to the pedestrian path
    let doorPoints;
    if (b.doorTargetXZ) {
      doorPoints = [[door.x, door.z], b.doorTargetXZ];
    } else {
      const targetZ = L.doorTargetZ ? L.doorTargetZ[b.department] : door.z;
      doorPoints = [[door.x, door.z], [door.x, targetZ !== undefined ? targetZ : door.z]];
    }
    roads.walk('door:' + b.id, doorPoints);

    if (b.legacyId !== 'hq') {
      const lbl = label(b.name, door.x, b.position[1] + 1.2, door.z + 0.10, Math.min(6, b.name.length * 0.27), 0.55, layers.labels, false);
      if (rotY !== undefined) lbl.rotation.y = rotY;
    }
    const btn = document.createElement('button');
    btn.textContent = b.name;
    btn.onclick = () => inspector(b);
    document.querySelector('#building-nav').append(btn);

    report.buildings.push({
      id: b.id,
      legacyId: b.legacyId,
      name: b.name,
      department: b.department,
      kind: b.kind,
      projectId: b.projectId || null,
      status: b.status || null,
      grade: b.grade,
      position: b.position,
      bbox: bbox,
      uniformScale: f ? f.scale : 1,
      normalizedMinY: f ? f.minY : 0,
      front: '+Z',
      door: door.toArray(),
      doorConnected: true,
      style: b.style,
      level: b.level || null
    });
  }

  function districtLabel(name, x, z, parent = layers.labels) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const ctx = c.getContext('2d');
    
    // 1. Nền capsule pill mờ màu xanh rừng trầm bán trong suốt (tinh tế, không quá lộ)
    const padX = 64, padY = 36;
    const pillW = 1024 - padX * 2;
    const pillH = 256 - padY * 2;
    const rad = pillH / 2;
    
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(padX, padY, pillW, pillH, rad);
    } else {
      ctx.rect(padX, padY, pillW, pillH);
    }
    ctx.fillStyle = 'rgba(16, 36, 26, 0.50)'; // Trầm dịu, hài hòa với thảm cỏ
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'; // Viền trắng mờ mảnh
    ctx.stroke();

    // 2. Chữ màu trắng tinh khôi, có bóng đổ nổi khối nhẹ nhàng
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 84px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 512, 128);

    const tx = new T.CanvasTexture(c);
    tx.colorSpace = T.SRGBColorSpace;
    
    const w = 17, h = 4.25;
    const geo = new T.PlaneGeometry(w, h);
    const mat = new T.MeshBasicMaterial({
      map: tx,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide
    });
    const m = new T.Mesh(geo, mat);
    
    // Nổi cao hơn mặt đất 0.42m để không bao giờ bị chìm dưới cỏ, không z-fighting
    const groundY = terrain.height(x, z);
    m.position.set(x, groundY + 0.42, z);
    
    // Nghiêng nhẹ góc 65 độ đón tầm nhìn camera isometric từ trên xuống
    m.rotation.x = -Math.PI * 0.36;
    
    parent.add(m);
    return m;
  }

  // =============================================================
  // DYNAMIC BIOME CLUSTERS (ÔM SÁT ĐỊA HÌNH 100% - TERRAIN CONFORMING)
  // BÌNH THƯỜNG ẨN HOÀN TOÀN 100% (ZERO CLUTTER)
  // CHỈ KHI RÊ CHUỘT (HOVER) VÀO MỚI SMOOTH FADE-IN & ILLUMINATE
  // =============================================================
  const biomeControllers = [];
  const biomeColors = {
    administration: 0x6366f1, // Indigo / Hành chính
    finance: 0x10b981,        // Emerald / Tài chính
    internal: 0xf59e0b,       // Amber / Dự án nội bộ
    it: 0x00f0ff              // Cyan Neon / Khu IT Lab
  };

  function isInsideRoundedRect(x, z, cx, cz, hw, hd, r) {
    const dx = Math.abs(x - cx) - (hw - r);
    const dz = Math.abs(z - cz) - (hd - r);
    if (dx <= 0 && dz <= 0) return true;
    if (dx > 0 && dz > 0) return (dx * dx + dz * dz) <= (r * r);
    if (dx > 0) return dx <= r;
    if (dz > 0) return dz <= r;
    return false;
  }

  function buildTerrainConformingBiomeGeometry(minX, maxX, minZ, maxZ, r, terrainFn, yOffset = 0.045) {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const hw = (maxX - minX) / 2;
    const hd = (maxZ - minZ) / 2;
    const rad = Math.min(r, hw * 0.45, hd * 0.45);
    const step = 0.75;
    const nx = Math.ceil((maxX - minX) / step);
    const nz = Math.ceil((maxZ - minZ) / step);
    const dx = (maxX - minX) / nx;
    const dz = (maxZ - minZ) / nz;

    const positions = [];
    const uvs = [];

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x0 = minX + i * dx, x1 = x0 + dx;
        const z0 = minZ + j * dz, z1 = z0 + dz;
        const c00 = isInsideRoundedRect(x0, z0, cx, cz, hw, hd, rad);
        const c10 = isInsideRoundedRect(x1, z0, cx, cz, hw, hd, rad);
        const c01 = isInsideRoundedRect(x0, z1, cx, cz, hw, hd, rad);
        const c11 = isInsideRoundedRect(x1, z1, cx, cz, hw, hd, rad);

        const y00 = terrainFn(x0, z0) + yOffset;
        const y10 = terrainFn(x1, z0) + yOffset;
        const y01 = terrainFn(x0, z1) + yOffset;
        const y11 = terrainFn(x1, z1) + yOffset;

        // Tri 1: (0,0) -> (1,0) -> (0,1)
        if (c00 && c10 && c01) {
          positions.push(x0, y00, z0,  x1, y10, z0,  x0, y01, z1);
          uvs.push((x0 - minX) / (hw * 2), (z0 - minZ) / (hd * 2),
                   (x1 - minX) / (hw * 2), (z0 - minZ) / (hd * 2),
                   (x0 - minX) / (hw * 2), (z1 - minZ) / (hd * 2));
        }
        // Tri 2: (1,0) -> (1,1) -> (0,1)
        if (c10 && c11 && c01) {
          positions.push(x1, y10, z0,  x1, y11, z1,  x0, y01, z1);
          uvs.push((x1 - minX) / (hw * 2), (z0 - minZ) / (hd * 2),
                   (x1 - minX) / (hw * 2), (z1 - minZ) / (hd * 2),
                   (x0 - minX) / (hw * 2), (z1 - minZ) / (hd * 2));
        }
      }
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    return geo;
  }

  function buildTerrainConformingOutlineGeometry(minX, maxX, minZ, maxZ, r, terrainFn, yOffset = 0.065) {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const hw = (maxX - minX) / 2;
    const hd = (maxZ - minZ) / 2;
    const rad = Math.min(r, hw * 0.45, hd * 0.45);
    const pts = [];

    function addArc(ox, oz, startAngle, endAngle, steps = 14) {
      for (let i = 0; i <= steps; i++) {
        const theta = startAngle + (endAngle - startAngle) * (i / steps);
        const x = ox + rad * Math.cos(theta);
        const z = oz + rad * Math.sin(theta);
        pts.push(new T.Vector3(x, terrainFn(x, z) + yOffset, z));
      }
    }

    addArc(cx + hw - rad, cz - hd + rad, -Math.PI / 2, 0);
    addArc(cx + hw - rad, cz + hd - rad, 0, Math.PI / 2);
    addArc(cx - hw + rad, cz + hd - rad, Math.PI / 2, Math.PI);
    addArc(cx - hw + rad, cz - hd + rad, Math.PI, Math.PI * 1.5);

    return new T.BufferGeometry().setFromPoints(pts);
  }

  function rebuildBiomes() {
    while (layers.biomes.children.length > 0) {
      const o = layers.biomes.children.pop();
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    biomeControllers.length = 0;

    const terrainFn = (x, z) => (terrain.surfaceHeight ? terrain.surfaceHeight(x, z) : terrain.height(x, z));

    for (const d of L.departments) {
      const blds = L.buildings.filter(b => b.department === d.id);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

      if (blds.length > 0) {
        for (const b of blds) {
          const g = (L.grades && L.grades[b.grade]) || [10, 5, 8];
          const hw = g[0] / 2, hd = g[2] / 2;
          minX = Math.min(minX, b.position[0] - hw);
          maxX = Math.max(maxX, b.position[0] + hw);
          minZ = Math.min(minZ, b.position[2] - hd);
          maxZ = Math.max(maxZ, b.position[2] + hd);
        }
      } else if (d.labelXZ) {
        minX = d.labelXZ[0] - 8; maxX = d.labelXZ[0] + 8;
        minZ = d.labelXZ[1] - 8; maxZ = d.labelXZ[1] + 8;
      }

      // Khoảng lùi kiến trúc
      const pad = 5.2;
      minX -= pad; maxX += pad;
      minZ -= pad; maxZ += pad;

      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const hd = (maxZ - minZ) / 2;
      const depColor = biomeColors[d.id] || 0x569577;

      // 1. Mặt phẳng thảm màu ôm sát địa hình (Draping Mesh)
      const fillGeo = buildTerrainConformingBiomeGeometry(minX, maxX, minZ, maxZ, 6.0, terrainFn, 0.045);
      const fillMat = new T.MeshBasicMaterial({
        color: depColor,
        transparent: true,
        opacity: 0.0, // Ẩn hoàn toàn khi không hover
        depthWrite: false,
        side: T.DoubleSide
      });
      const fillMesh = new T.Mesh(fillGeo, fillMat);
      fillMesh.userData.departmentId = d.id;
      fillMesh.userData.isBiome = true;
      layers.biomes.add(fillMesh);

      // 2. Đường viền ranh giới ôm sát địa hình (Draping Outline)
      const borderGeo = buildTerrainConformingOutlineGeometry(minX, maxX, minZ, maxZ, 6.0, terrainFn, 0.065);
      const borderMat = new T.LineBasicMaterial({
        color: depColor,
        transparent: true,
        opacity: 0.0, // Ẩn hoàn toàn khi không hover
        depthTest: false
      });
      const borderMesh = new T.LineLoop(borderGeo, borderMat);
      borderMesh.visible = false;
      layers.biomes.add(borderMesh);

      // 3. Nhãn tên phân khu (District Label)
      const labelZ = cz - hd - 2.8;
      const labelMesh = districtLabel(d.name, cx, labelZ, layers.biomes);
      if (labelMesh && labelMesh.material) {
        labelMesh.material.transparent = true;
        labelMesh.material.opacity = 0.0;
        labelMesh.visible = false;
        labelMesh.scale.set(0.85, 0.85, 0.85);
      }

      biomeControllers.push({
        id: d.id,
        name: d.name,
        mesh: fillMesh,
        border: borderMesh,
        label: labelMesh,
        currentOpacity: 0.0,
        targetOpacity: 0.0,
        currentScale: 0.85,
        targetScale: 0.85
      });
    }
  }

  rebuildBiomes();

  // Mouse hover detection for Biomes
  const biomeRaycaster = new T.Raycaster();
  const biomePointer = new T.Vector2();

  window.addEventListener('pointermove', e => {
    if (!layers.biomes.visible) return;
    biomePointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    biomePointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    biomeRaycaster.setFromCamera(biomePointer, camera);
    const intersects = biomeRaycaster.intersectObjects(biomeControllers.map(b => b.mesh));
    const hitDeptId = intersects[0]?.object?.userData?.departmentId;

    for (const b of biomeControllers) {
      if (b.id === hitDeptId) {
        b.targetOpacity = 1.0;
        b.targetScale = 1.0;
      } else {
        b.targetOpacity = 0.0;
        b.targetScale = 0.85;
      }
    }
  });

  function updateBiomeAnimations() {
    let animating = false;
    for (const b of biomeControllers) {
      if (Math.abs(b.targetOpacity - b.currentOpacity) > 0.002 || Math.abs(b.targetScale - b.currentScale) > 0.002) animating = true;
      b.currentOpacity += (b.targetOpacity - b.currentOpacity) * 0.14;
      b.currentScale += (b.targetScale - b.currentScale) * 0.14;

      const isVisible = layers.biomes.visible && (b.currentOpacity > 0.005);

      if (b.mesh && b.mesh.material) {
        b.mesh.material.opacity = b.currentOpacity * 0.24; // 0.0 khi unhover, 0.24 khi hover
      }
      if (b.border && b.border.material) {
        b.border.visible = isVisible;
        b.border.material.opacity = b.currentOpacity * 0.90; // 0.0 khi unhover, 0.90 khi hover
      }
      if (b.label && b.label.material) {
        b.label.visible = isVisible;
        b.label.material.opacity = b.currentOpacity;
        b.label.scale.set(b.currentScale, b.currentScale, 1);
      }
    }
    return animating;
  }

  // Schedule kiosk - Restored to compact original kiosk at [17, 31.5]
  const sx = 17, sz = 31.5, sy = terrain.height(sx, sz);
  const sg = new T.Group();
  sg.name = 'schedule-kiosk';
  A.box(sg, 4.1, 1.7, 0.3, 0, 0.6, 0, A.M.moss);
  A.box(sg, 4.4, 0.15, 0.7, 0, 2.3, 0, A.M.orange);
  A.sign(sg, 'LỊCH LÀM VIỆC', 3.8, 0.7, 0, 1.5, 0.18);
  for (const x of [-1.5, 1.5]) A.box(sg, 0.15, 0.7, 0.15, x, 0, 0, A.M.metal);
  sg.position.set(sx, sy, sz);
  sg.userData.binding = {...L.schedule, department: 'campus'};
  sg.userData.buildingId = L.schedule.id;
  sg.userData.isBuildingRoot = true;
  sg.traverse(c => {
    c.userData.buildingId = L.schedule.id;
    c.userData.isBuildingPart = true;
  });
  scene.add(sg);
  clickable.push(sg);
  buildingObjects.set(L.schedule.id, sg);
  // Riêng Lịch làm việc không cần đường đi bộ tới theo yêu cầu của Sếp
  report.schedule = {...L.schedule, groundY: sy};
  const schedBtn = document.createElement('button');
  schedBtn.textContent = 'Lịch làm việc';
  schedBtn.onclick = () => inspector(sg.userData.binding);
  document.querySelector('#building-nav').append(schedBtn);

  const landscape = await createLandscape(scene, P, L, terrain, roads.paths, adapter, layers, report, registry, V23);
  console.log('[STEP 5] landscape created');
  await createEcosystemDesign(scene, P, L, terrain, roads, registry, layers, report, A);
  console.log('[STEP 6] ecosystem design created');
  await createLandscapePolish(scene, P, L, terrain, roads, registry, layers, report, A);
  await createHQGardens(scene,terrain,roads,L,report);
  await createModularRoadSystem(scene, terrain, roads);
  createCampusGreenery(scene, L, terrain, roads, landscape, layers, report);
  console.log('[STEP 6.5] HQ gardens created');
  scene.traverse(o => {
    if (o.name === 'hq-arrival-stair-terrace' || o.parent?.name === 'hq-arrival-stair-terrace') {
      o.visible = false;
      o.parent?.remove(o);
    }
  });

  // Khu nhà mẫu (District Showcase) đã được gỡ bỏ theo yêu cầu sếp

  const [opGraph, sysGraph] = await Promise.all([fetchJSON("./operational-graph.json"), fetchJSON("./system-graph.json")]);
  const groundDebug = createGroundDebug(scene,terrain,roads,buildingObjects,report);
  const router = createPedestrianRouter(roads.paths, L.buildings, terrain.surfaceHeight);
  console.log('[STEP 7] router created');
  report.pedestrianRoutes = [...opGraph.edges, ...sysGraph.edges].map(e => ({...router.route(e.source, e.target), relationId: e.id, type: e.type}));
  network = createNetwork(scene, P, L, buildingObjects, opGraph, sysGraph, report, sync, router);
  console.log('[STEP 8] network created');
  // Decorative benches & rich urban props from the 146 Standardized Studio Models
  const studioCampusDecor = [];

  for (const item of studioCampusDecor) {
    const model = await getStudioModelById(item.id, { scale: item.scale || 1.0, addEntrySocket: false });
    if (!model) continue;
    const y = terrain.height(item.x, item.z);
    model.name = `campus_studio_${item.id.replace('#', '')}_${item.x}_${item.z}`;
    model.position.set(item.x, y, item.z);
    model.rotation.y = item.rotY || 0;
    model.userData.isProp = true;
    model.userData.isCustomAsset = true;
    model.userData.assetType = item.id;
    scene.add(model);
    model.updateMatrixWorld(true);
    clickable.push(model);
  }

  const editor = createCampusEditor({ scene, camera, renderer, controls, terrain, L, P, buildingObjects, clickable, roads, report, sync, views, viewFn: view, registry, layers, router, network });
  console.log('[STEP 9] campus editor created');

  // P1: Run Spatial Lint
  const spatialLintResult = runSpatialLint(report.buildings, roads, terrain, buildingObjects, scene);
  report.spatialLint = spatialLintResult;

  // --- AAA URBAN PLANNING ENFORCEMENT ---
  // Triệt tiêu 100% mọi cây cối, bụi rậm, hoặc prop thừa xâm lấn lòng đường và trước sảnh
  const urbanEngine = createUrbanPlanningEngine(L, terrain);
  urbanEngine.enforceUrbanSpatialClearance(scene);
  setTimeout(() => urbanEngine.enforceUrbanSpatialClearance(scene), 400);
  setTimeout(() => urbanEngine.enforceUrbanSpatialClearance(scene), 1200);
  setTimeout(() => urbanEngine.enforceUrbanSpatialClearance(scene), 2500);
  setTimeout(() => urbanEngine.enforceUrbanSpatialClearance(scene), 4500);
  window.__urbanEngine = urbanEngine;

  // Cockpit Command Engine (Spec Kit Integration)
  await dataConnector.load();
  // Client districts around the ring road: land from the topology, clients and projects from the data.
  createWorldBackdrop({scene, terrain, camera, controls});
  const clientDistricts = createClientDistricts({scene, terrain, L, dataConnector, buildingObjects, clickable});
  window.__clientDistricts = clientDistricts;
  // Where a district's gate road or a branch road leaves the ring, the ring opens its curb and sidewalk and gets
  // its junction markings; the district draws its own road, so its lines are left to it.
  const syncDistrictRoads = () => {
    const plan = districtPlan(L);
    if (!plan) return;
    const inUse = new Set(clientDistricts.districts.filter(d => d.client).map(d => d.id));
    const gates = plan.slots.filter(s => s.ringXZ && inUse.has(s.id)), half = plan.template.roadWidth / 2;
    roads.crossingRoads = [
      ...gates.map(s => ({points: [s.ringXZ, s.gateXZ], halfW: half})),
      ...(plan.accessRoads || []).map(r => ({points: r.points, halfW: r.width / 2}))
    ];
    const polyline = pts => {
      const path = new T.CurvePath();
      for (let i = 0; i < pts.length - 1; i++)
        path.add(new T.LineCurve3(new T.Vector3(pts[i][0], 0, pts[i][1]), new T.Vector3(pts[i + 1][0], 0, pts[i + 1][1])));
      return path;
    };
    const districtDef = (id, pts, halfW) => ({
      id, districtGate: true, markings: false, halfW, signature: JSON.stringify(pts), curve: polyline(pts),
      yAt: (x, z) => Math.max(terrain.height(x, z), terrain.world?.deck?.(x, z) ?? -Infinity) + 0.15
    });
    roads.extraRoadDefs = (roads.extraRoadDefs || []).filter(d => !d.districtGate).concat(
      gates.map(s => districtDef('road:district-gate:' + s.id, [s.ringXZ, s.gateXZ], half)),
      (plan.accessRoads || []).map(r => districtDef(r.id, r.points, r.width / 2))
    );
    roads.syncRoadNetwork?.();
  };
  syncDistrictRoads();
  cutawayAnimator = new CutawayAnimator(scene, camera, controls, buildingObjects, setSpan, () => span, director);
  window.__cutawayAnimator = cutawayAnimator;
  window.__inspector = inspector;
  function exitInspect() {
    if (cutawayAnimator) cutawayAnimator.exit();
    const root = document.getElementById('cockpit-hud-root');
    if (root) root.style.display = 'none';
    if (cockpitFrame) cockpitFrame.setInside(null);
    if (buildingPanels) buildingPanels.hide();
    insideBuilding = null;
  }

  cockpitHUD = new CockpitHUD(
    dataConnector,
    (jumpId) => {
      const b = L.buildings.find(item => item.id === jumpId);
      if (b) inspector(b);
    },
    exitInspect
  );

  // Marketing has an approved interior but no building on the campus yet (its position waits for
  // approval), so its room opens inside the AI Team building until the topology gets one.
  const marketingHost = L.buildings.find(b => b.id === 'bld:facility:ai');
  const marketingRoom = marketingHost && !L.buildings.some(b => b.id === 'bld:facility:marketing')
    ? [{...marketingHost, id: 'bld:facility:marketing', legacyId: 'marketing', name: 'Marketing', hostId: marketingHost.id}]
    : [];

  // A data refresh or the money switch rebuilds the room in place and re-renders its panels.
  function refreshInside() {
    if (!insideBuilding || !cutawayAnimator.isInspecting) return;
    cutawayAnimator.buildInterior(
      dataConnector.getBuildingView(insideBuilding) || {type: null, id: insideBuilding.id, title: insideBuilding.name, connected: false, agents: []});
    if (buildingPanels) buildingPanels.render();
  }
  dataConnector.subscribe(refreshInside);

  // Day and night: sky, sun and sky light, lamps and windows (day-night.js); switched from the cockpit frame
  const dayNight = createDayNight({
    scene, sun, hemi, palette: P, groundHeight: terrain.height, windowGlow: nightWindowGlow,
    onChange: () => { report.dayNight = dayNight.mode; cockpitFrame?.renderDayNight(); window.requestRender?.(); sync(); }
  });
  report.dayNight = dayNight.mode;
  window.__dayNight = dayNight;

  // Campus-view frame: resource bar, missions, hovered building, quick jump
  const frameBuildings = () => [...L.buildings, {...L.schedule, kind: 'facility'}, ...marketingRoom, ...clientDistricts.buildings];
  clientDistricts.onChange = () => { cockpitFrame.setBuildings(frameBuildings()); syncDistrictRoads(); };
  cockpitFrame = new CockpitFrame({
    dataConnector,
    buildings: frameBuildings(),
    onMoneyToggle: () => refreshInside(),
    dayNight,
    onEnterBuilding: b => inspector(buildingObjects.get(b.id)?.userData.binding || b),
    getDistricts: () => clientDistricts.districts,
    onEnterDistrict: d => {
      if (cutawayAnimator.isInspecting) exitInspect();
      const [x, y, z] = d.center;
      director.flyTo({target: [x, y + 1, z], position: [x + 70, y + 86, z + 94], span: Math.max(d.depth, 60) * 1.05});
    },
    onOverview: () => {
      if (cutawayAnimator.isInspecting) exitInspect();
      else view('overview');
    }
  });
  window.__cockpitFrame = cockpitFrame;
  if (cutawayAnimator) cutawayAnimator.dayNight = dayNight;
  buildingPanels = new BuildingPanels({dataConnector, frame: cockpitFrame});
  window.__buildingPanels = buildingPanels;

  // Project state drawn on the building exteriors (scaffolding, crane, built height, DELAY sign)
  const stateVisuals = createStateVisuals({scene, renderer, buildingObjects, dataConnector});
  window.__stateVisuals = stateVisuals;

  // Chế độ click chọn tòa nhà (Cockpit / Cutaway)
  // Mặc định: BẬT, bấm vào tòa là bay vào bên trong; tắt trong "Công cụ" khi làm cảnh quan
  let buildingClickEnabled = true;
  window.buildingClickEnabled = true;

  function updateBuildingClickUI() {
    const btn = document.getElementById('btn-toggle-building-click');
    const lbl = document.getElementById('lbl-building-click');
    const ico = document.getElementById('ico-building-click');
    if (btn && lbl && ico) {
      if (buildingClickEnabled) {
        btn.style.background = '#E8F6F5';
        btn.style.color = '#1E8C86';
        btn.style.borderColor = '#2BA8A2';
        lbl.textContent = 'Click Tòa: BẬT';
        ico.textContent = '🔓';
      } else {
        btn.style.background = '#f1f5f9';
        btn.style.color = '#64748b';
        btn.style.borderColor = '#cbd5e1';
        lbl.textContent = 'Click Tòa: TẮT';
        ico.textContent = '🔒';
      }
    }
    window.buildingClickEnabled = buildingClickEnabled;
  }

  window.setBuildingClickEnabled = function(enabled) {
    buildingClickEnabled = !!enabled;
    updateBuildingClickUI();
  };

  const toggleBuildingClickBtn = document.getElementById('btn-toggle-building-click');
  if (toggleBuildingClickBtn) {
    toggleBuildingClickBtn.onclick = () => {
      buildingClickEnabled = !buildingClickEnabled;
      updateBuildingClickUI();
    };
    updateBuildingClickUI();
  }

  // Phím ESC để thoát ngay chế độ Cockpit/Cutaway nếu đang mở
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (cutawayAnimator && cutawayAnimator.isInspecting) exitInspect();
    }
  });

  // Pointer picking
  const ray = new T.Raycaster(), mouse = new T.Vector2();
  let pointerDown;
  renderer.domElement.addEventListener('pointerdown', e => pointerDown = [e.clientX, e.clientY]);
  renderer.domElement.addEventListener('pointerup', e => {
    if (editor && editor.isEditMode()) return;
    if (!pointerDown || Math.hypot(e.clientX - pointerDown[0], e.clientY - pointerDown[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(mouse, camera);
    // Inside a building: an object in the room opens its section in the panels; the room itself never exits.
    // The campus is hidden meanwhile and takes no clicks; a click on the backdrop goes back out.
    if (cutawayAnimator && cutawayAnimator.isInspecting) {
      if (!cutawayAnimator.staged) return;
      const focus = cutawayAnimator.pick(ray);
      if (focus === undefined) exitInspect();
      else if (focus && buildingPanels) buildingPanels.focus(focus);
      return;
    }
    const hit = ray.intersectObjects(clickable, true)[0];
    if (hit) {
      let o = hit.object;
      let cur = o;
      let customTarget = null;
      while (cur) {
        if (cur.userData && cur.userData.isCustomAsset) {
          customTarget = cur;
          break;
        }
        cur = cur.parent;
      }
      if (customTarget && editor && editor.isEditMode()) {
        editor.selectCustomObject(customTarget);
        return;
      }

      while (o && !o.userData.binding) o = o.parent;
      if (o) {
        if (editor && editor.isEditMode()) {
          editor.selectBuilding(o.userData.binding.id);
        } else if (buildingClickEnabled) {
          inspector(o.userData.binding);
        }
      }
    }
  });

  // Hover: the building under the pointer shows its summary card in the cockpit frame
  let hoverAt = 0;
  renderer.domElement.addEventListener('pointermove', e => {
    if (e.buttons || performance.now() - hoverAt < 60) return;
    hoverAt = performance.now();
    if (editor.isEditMode()) return;
    let binding = null;
    if (!cutawayAnimator.isInspecting) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(mouse, camera);
      let o = ray.intersectObjects(clickable, true)[0]?.object;
      while (o && !o.userData.binding) o = o.parent;
      binding = o?.userData.binding || null;
    }
    cockpitFrame.setHovered(binding);
    let overFocus = false;
    if (cutawayAnimator.isInspecting) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(mouse, camera);
      overFocus = !!cutawayAnimator.pick(ray);
    }
    renderer.domElement.style.cursor = overFocus || (binding && buildingClickEnabled) ? 'pointer' : '';
  });
  renderer.domElement.addEventListener('pointerleave', () => cockpitFrame.setHovered(null));

  // Massing Review toggle implementation
  const massingToggle = document.querySelector('#massing-review');
  let savedLayers = null;
  function setMassingReview(active) {
    report.massingReview = active;
    if (active) {
      savedLayers = {
        canopy: layers.canopy.visible,
        shrubs: layers.shrubs.visible,
        groundcover: layers.groundcover.visible,
        labels: layers.labels.visible
      };
      layers.canopy.visible = false;
      layers.shrubs.visible = false;
      layers.groundcover.visible = false;
      layers.labels.visible = false;
      if (network?.group) network.group.visible = false;
      layers.footprints.visible = true;
    } else {
      if (savedLayers) {
        layers.canopy.visible = savedLayers.canopy;
        layers.shrubs.visible = savedLayers.shrubs;
        layers.groundcover.visible = savedLayers.groundcover;
        layers.labels.visible = savedLayers.labels;
      }
      if (network?.group && report.mode !== 'world') {
        network.group.visible = true;
      }
      layers.footprints.visible = false;
    }
    sync();
  }
  if (massingToggle) {
    massingToggle.onchange = e => setMassingReview(e.target.checked);
  }

  const names = {
    arrivalLow: 'AFTER_ARRIVAL_LOW', internalLow: 'AFTER_INTERNAL_LOW', forecourt: 'AFTER_HQ_FORECOURT',
    overview: 'AFTER_CAMPUS_OVERVIEW',
    top: 'AFTER_CAMPUS_TOPVIEW',
    arrival: 'AFTER_HQ_ARRIVAL',
    hqref: 'HQ_REFERENCE_COMPARISON',
    commons: 'AFTER_CENTRAL_COMMONS',
    admin: 'AFTER_ADMIN_COURTYARD',
    finance: 'AFTER_FINANCE_COURTYARD',
    it: 'AFTER_IT_COURTYARD',
    internal: 'AFTER_INTERNAL_TERRACES',
    oracle: 'AFTER_ORACLE_CLOUD',
    cluster: 'AFTER_CLUSTER',
    hero: 'AFTER_HERO_HQ',
    front: 'AFTER_HQ_FRONT',
    side: 'AFTER_HQ_SIDE',
    back: 'AFTER_HQ_BACK'
  };

  document.querySelector('#photo').onclick = () => {
    renderer.setPixelRatio(2);
    drawFrame();
    report.drawCalls = renderer.info.render.calls;
    report.triangles = renderer.info.render.triangles;
    report.exportPixels = [renderer.domElement.width, renderer.domElement.height];
    sync();
    let a = document.querySelector('#export-result');
    if (!a) {
      a = document.createElement('a');
      a.id = 'export-result';
      a.hidden = true;
      document.body.append(a);
    }
    let filename;
    if (report.groundDebug && report.groundDebug !== 'off') { filename='AFTER_DEBUG_'+report.groundDebug.toUpperCase();
    } else if (report.massingReview) {
      filename = currentView === 'top' ? 'MASSING_TOPVIEW' : 'MASSING_OVERVIEW';
    } else if (report.mode === 'operations') {
      filename = 'AFTER_OPERATIONS';
    } else if (report.mode === 'system') {
      filename = 'AFTER_SYSTEM';
    } else if (report.circulationDebug) {
      filename = 'AFTER_PEDESTRIAN_DEBUG';
    } else {
      filename = names[currentView] || 'AFTER_CAMPUS_VIEW';
    }
    a.download = filename + '.png';
    a.href = composeCapture(
      renderer.domElement,
      report,
      report.massingReview ? 'Massing review · pure spatial geometry' :
      report.circulationDebug ? 'Circulation debug · vehicles / pedestrian network' :
      report.mode === 'world' ? currentView.toUpperCase() + ' · Physical campus' :
      report.mode.toUpperCase() + ' · ' + report.network.focus
    );
    a.click();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  };

  report.walkSamples = roads.paths.filter(p => p.class === 1).map(p => ({
    id: p.id,
    width: p.width,
    points: Array.from({length: 161}, (_, i) => {
      const q = p.curve.getPointAt(i / 160);
      return [q.x, q.z];
    })
  }));
  report.physicalPaths = roads.paths.map(p => ({
    id: p.id,
    class: p.class,
    width: p.width,
    points: Array.from({length: 161}, (_, i) => {
      const q = p.curve.getPointAt(i / 160);
      return [q.x, terrain.height(q.x, q.z), q.z];
    })
  }));
  report.internalLevels = L.internalLevels;
  report.roads = roads.paths.map(p => ({id: p.id, class: p.class, width: p.width}));
  report.hqReferenceFiles = ['references/hq-2.png', 'references/hq-3.png', 'references/hq-4.png'];
  report.hqDesign = 'custom geometry derived from approved slanted tower references; no specific GLB approval assumed';
  report.warnings.push('Art Direction A layout implemented. Art approval remains pending user review.');
  report.ready = true;
  status.textContent = `HQ landscape updated · Art approval pending`;
  sync();

  // =============================================================
  // CIRCULATION NETWORK (TIM ĐƯỜNG TRẮNG TINH KHÔI VIỀN ĐEN TƯƠNG PHẢN CAO - REALTIME REBUILD)
  // =============================================================
  const debug = new T.Group();
  debug.visible = false;
  debug.name = 'circulation-network';
  scene.add(debug);

  function rebuildCirculationNetwork() {
    while (debug.children.length > 0) {
      const child = debug.children.pop();
      child.geometry?.dispose();
      child.material?.dispose();
    }
    for (const p of roads.paths) {
      if (p.hidden || !p.points || p.points.length < 2 || !p.curve) continue;
      const len = p.curve.getLength ? p.curve.getLength() : 20;
      const steps = Math.max(30, Math.ceil(len * 4));
      const vs = [];
      for (let i = 0; i <= steps; i++) {
        const q = p.curve.getPointAt(i / steps);
        const y = (typeof terrain.surfaceHeight === 'function' ? terrain.surfaceHeight(q.x, q.z) : terrain.height(q.x, q.z)) + 0.35;
        vs.push(new T.Vector3(q.x, y, q.z));
      }
      if (vs.length < 2) continue;

      // Đường tim màu trắng tinh khôi nổi bật tuyệt đối trên mọi mặt đất
      const lineMat = new T.LineBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        transparent: true,
        opacity: 0.98
      });
      const line = new T.Line(new T.BufferGeometry().setFromPoints(vs), lineMat);
      line.renderOrder = 32;
      debug.add(line);

      // Đường bóng đen viền casing bên dưới tạo độ tách bạch 100%
      const shadowVs = vs.map(v => new T.Vector3(v.x, v.y - 0.04, v.z));
      const shadowMat = new T.LineBasicMaterial({
        color: 0x050505,
        depthTest: false,
        transparent: true,
        opacity: 0.70
      });
      const shadowLine = new T.Line(new T.BufferGeometry().setFromPoints(shadowVs), shadowMat);
      shadowLine.renderOrder = 31;
      debug.add(shadowLine);
    }
  }

  // Khởi tạo circulation ban đầu và export ra window để campus-editor tự động gọi realtime
  rebuildCirculationNetwork();
  window.rebuildCirculationNetwork = rebuildCirculationNetwork;

  const circEl = document.querySelector('#circulation');
  if (circEl) {
    circEl.onchange = e => {
      if (e.target.checked) {
        rebuildCirculationNetwork();
      }
      debug.visible = e.target.checked;
      report.circulationDebug = debug.visible;
      sync();
    };
  }

  report.mode = 'world';
  report.integrationPolicy = 'No verified dependencies or health probes. System links are labelled mock/unverified.';
  window.connectedCampusProof = {
    ready: true,
    report, terrain, roads, groundDebug,
    setView: view,
    setMode: m => network.setMode(m),
    setMassingReview,
    inspector,
    network,
    router,
    renderer,
    scene,
    camera,
    controls,
    editor,
    rebuildBiomes
  };
  window.scene = scene;
  window.renderer = renderer;
  window.camera = camera;
  window.controls = controls;

  // Render on demand: draw while something moves or the user is interacting,
  // otherwise only a slow heartbeat so late-loading assets still show up.
  const IDLE_RENDER_MS = 250, ACTIVE_AFTER_INPUT_MS = 1500, REPORT_MS = 500;
  let activeUntil = 0, lastRender = 0, lastReport = 0;
  const keepRendering = () => { activeUntil = performance.now() + ACTIVE_AFTER_INPUT_MS; };
  ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'click', 'input', 'change', 'resize']
    .forEach(type => addEventListener(type, keepRendering, {capture: true, passive: true}));
  window.requestRender = keepRendering;
  keepRendering();

  const frameTimes = [];
  let previous = performance.now();
  const drawCampus = () => postPipeline ? postPipeline.render() : renderer.render(scene, camera);
  // While a building is open the animator draws the frame: the campus as a sketch, the room on top
  const drawFrame = () => { if (!cutawayAnimator?.render(renderer, drawCampus)) drawCampus(); };
  function frame(now) {
    requestAnimationFrame(frame);
    const cameraMoving = director.update(now);
    cockpitFrame.setBuilding(editor.isEditMode());
    const insideMoving = !!cutawayAnimator && cutawayAnimator.update(performance.now());
    const networkMoving = network?.tick(now * 0.001) === true;
    const biomesMoving = updateBiomeAnimations();
    const statesMoving = stateVisuals.tick(now * 0.001);
    const skyMoving = dayNight.tick(now);
    const active = skyMoving || cameraMoving || networkMoving || biomesMoving || statesMoving || insideMoving || now < activeUntil;
    if (active || now - lastRender >= IDLE_RENDER_MS) {
      lastRender = now;
      drawFrame();
    }
    frameTimes.push(now - previous);
    previous = now;
    if (frameTimes.length > 180) frameTimes.shift();
    if (now - lastReport >= REPORT_MS) {
      lastReport = now;
      const f = [...frameTimes].sort((a, b) => a - b);
      report.textureMemory = {textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, note: 'GPU texture count; byte estimate not measured'};
      report.activeNPCs = 0;
      report.drawCalls = renderer.info.render.calls;
      report.triangles = renderer.info.render.triangles;
      report.frameMedian = f[Math.floor(f.length / 2)];
      report.frameP95 = f[Math.floor(f.length * 0.95)];
      report.rendering = active ? 'active' : 'idle';
      sync();
    }
  }
  requestAnimationFrame(frame);
}