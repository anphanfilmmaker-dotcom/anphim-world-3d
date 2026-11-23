import * as T from 'three';
import { TransformControls } from './vendor/TransformControls.js';
import { applyCampusPaving } from './paving-pattern.js';
import { buildCourtFurniture } from './court-furniture.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { getStudioModelById, loadStudioCatalog } from './asset-pack-extractor.js?rev=146';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast
} from './vendor/three-mesh-bvh.module.js';

// Note: Keep native T.Mesh.prototype.raycast intact because terrain mesh uses multi-material groups
try {
  T.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  T.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
} catch (e) {
  console.warn('[Editor] three-mesh-bvh init warning:', e);
}

/**
 * AN PHIM WORLD — OPEN-SOURCE VISUAL CAMPUS EDITOR & UNIFIED AGENT API
 *
 * Tích hợp kiến trúc từ:
 * 1. vibe-stack/three-roads: Spline Curve Ribbon Mesh với Control Point Handles kéo thả.
 * 2. ZyFou/ProceduralTerrains: Layered Paint Mode Manager (Texture, Height, Foliage Scatter Brush) + Undo/Redo.
 * 3. epun/ghost-panel: Two-way property binding + Scene Hierarchy & Material Inspector.
 * 4. gkjohnson/three-mesh-bvh: Tăng tốc tính toán va chạm raycasting O(log N).
 */
export function createCampusEditor({
  scene,
  camera,
  renderer,
  controls,
  terrain,
  L,
  P,
  buildingObjects,
  clickable,
  roads,
  report,
  sync,
  views = {},
  viewFn = null,
  registry = null,
  layers = null,
  router = null,
  network = null
}) {
  let editModeActive = false;
  let activeTab = 'buildings'; // 'buildings' | 'props' | 'foliage' | 'roads' | 'terrain' | 'bulldoze'
  let selectedObject = null;
  let groundSnapEnabled = true;

  const buildingFootprints = new Map();
  const customPlacedObjects = [];
  const customRoadsList = [];
  const demolishedNativeItems = []; // Persists bulldozed native Campus trees/bushes across reloads
  const modifiedHeightIndices = new Set();
  const modifiedColorIndices = new Set();

  // Sân sơn thẳng lên địa hình / thềm đá: kiểu sơn thuộc về thiết kế gốc, không nằm trong bản lưu của editor
  function courtPaintMeta(c) {
    const meta = {};
    if (c.kind) meta.kind = c.kind;
    if (c.useGroundTriangles) meta.useGroundTriangles = true;
    return meta;
  }
  // Mã bố cục gốc (physical-topology.json): bản lưu Studio ghi lại để biết nó được làm trên bố cục nào
  const LAYOUT_REVISION = L?.layoutRevision || null;
  // Baseline snapshot of native Orange Courts & Yellow Walkways (before any localStorage edits)
  const initialNativeCourts = (terrain && terrain.courts) ? terrain.courts.map(c => ({
    id: c.id,
    x: c.x,
    z: c.z,
    w: c.w,
    d: c.d,
    r: c.r ?? 1.5,
    rotY: c.rotY || 0,
    hidden: false,
    ...courtPaintMeta(c)
  })) : [];
  const initialNativeWalks = (roads && roads.paths) ? roads.paths.filter(p => p.class === 1).map(p => ({
    id: p.id,
    width: p.width || 2.0,
    points: (p.points || []).map(pt => [pt[0], pt[1]]),
    hidden: false
  })) : [];

  // Accelerate terrain geometry with BVH if possible
  const tMesh = terrain.terrain;
  const tGeo = tMesh.geometry;
  // The ground lattice as the terrain built it; saved brush work is keyed by vertex index on it.
  const GRID = terrain.grid || {x0: -190, z0: -170, nx: 506, nz: 453, stepX: 380 / 506, stepZ: 340 / 453, legacy: [506, 453]};
  const nx = GRID.nx;
  const nz = GRID.nz;
  // States saved before the ground grew used a narrower lattice from the same corner: same (i, j), new row length.
  const gridIndex = (i, savedGrid) => {
    const [onx, onz] = savedGrid || GRID.legacy;
    if (onx === nx && onz === nz) return i;
    const col = i % (onx + 1), row = Math.floor(i / (onx + 1));
    return col <= nx && row <= nz && row <= onz ? row * (nx + 1) + col : -1;
  };
  const baseCount = terrain.baseCount || ((nx + 1) * (nz + 1));
  const basePosArray = terrain.basePosArray;
  const originalHeights = terrain.origHeights || new Float32Array(baseCount);
  const baseColorArray = terrain.baseColorArray;

  // Bulletproof Ground Raycast: tries native tMesh intersection first, falls back to analytical heightfield ray-march
  function intersectGround(raycasterInstance) {
    try {
      const hits = raycasterInstance.intersectObject(tMesh, false);
      if (hits && hits.length > 0) return hits[0].point;
    } catch (e) {}
    const ray = raycasterInstance.ray;
    const pt = new T.Vector3();
    let prevT = 0.5;
    for (let t = 1.0; t <= 480; t += 1.5) {
      ray.at(t, pt);
      if (pt.x >= GRID.x0 && pt.x <= GRID.x0 + nx * GRID.stepX && pt.z >= GRID.z0 && pt.z <= GRID.z0 + nz * GRID.stepZ) {
        const groundY = terrain.height(pt.x, pt.z);
        if (pt.y <= groundY) {
          let lo = prevT, hi = t;
          for (let k = 0; k < 8; k++) {
            const mid = (lo + hi) * 0.5;
            ray.at(mid, pt);
            if (pt.y <= terrain.height(pt.x, pt.z)) hi = mid;
            else lo = mid;
          }
          ray.at((lo + hi) * 0.5, pt);
          pt.y = terrain.height(pt.x, pt.z);
          return pt.clone();
        }
      }
      prevT = t;
    }
    return null;
  }

  // =========================================================================
  // 1. UNDO / REDO & LOCAL-FIRST PERSISTENCE STATE
  // =========================================================================
  const undoStack = [];
  const redoStack = [];

  function pushUndo(action) {
    undoStack.push(action);
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
    showToast('Đã ghi nhận thao tác', '#047857');
  }

  // Sau Undo/Redo, đưa gizmo về đúng vị trí dữ liệu của sân/điểm đường đang chọn; nếu không, syncUI() sẽ ghi vị trí cũ của gizmo đè lên dữ liệu vừa khôi phục.
  function syncNativeProxyToTarget() {
    if (selectedObject !== nativeProxyObj) return;
    if (selectedNativeCourt) {
      nativeProxyObj.position.x = selectedNativeCourt.x;
      nativeProxyObj.position.z = selectedNativeCourt.z;
      nativeProxyObj.rotation.y = selectedNativeCourt.rotY || 0;
    } else if (selectedNativeWalk) {
      const pt = selectedNativeWalk.path.points[selectedNativeWalk.pointIndex];
      if (pt) { nativeProxyObj.position.x = pt[0]; nativeProxyObj.position.z = pt[1]; }
    }
  }

  function executeUndo() {
    if (undoStack.length === 0) {
      showToast('Không còn thao tác để Undo', '#64748b');
      return { ok: false, msg: 'Undo stack empty' };
    }
    const action = undoStack.pop();
    if (action.undo) {
      action.undo();
      redoStack.push(action);
      showToast('↩️ Đã Undo', '#0284c7');
      syncNativeProxyToTarget();
      syncRoadMarkings();
      syncUI();
      return { ok: true, action: action.type };
    }
    return { ok: false };
  }

  function executeRedo() {
    if (redoStack.length === 0) {
      showToast('Không còn thao tác để Redo', '#64748b');
      return { ok: false, msg: 'Redo stack empty' };
    }
    const action = redoStack.pop();
    if (action.redo) {
      action.redo();
      undoStack.push(action);
      showToast('↪️ Đã Redo', '#0284c7');
      syncNativeProxyToTarget();
      syncRoadMarkings();
      syncUI();
      return { ok: true, action: action.type };
    }
    return { ok: false };
  }

  function showToast(msg, color = '#047857') {
    const toast = document.querySelector('#save-status-toast');
    if (toast) {
      toast.textContent = msg;
      toast.style.color = color;
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.textContent = 'Tự động lưu vào trình duyệt (Reload không mất)';
        toast.style.color = '#047857';
      }, 2500);
    }
  }

  // =========================================================================
  // 2. TRANSFORM CONTROLS & SPATIAL COLLISION ENGINE (Turf.js)
  // =========================================================================
  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.size = 0.85;
  transformControls.setMode('translate');
  transformControls.showY = false;
  transformControls.setTranslationSnap(1.0);

  const helper = transformControls.getHelper();
  helper.visible = false;
  scene.add(helper);

  let objectDragStartSnapshot = null;

  transformControls.addEventListener('dragging-changed', event => {
    controls.enabled = !event.value;
    if (event.value) {
      // Drag started: snapshot if editing native court or walk, OR building/prop/foliage
      if (selectedObject === nativeProxyObj) {
        if (selectedNativeCourt) {
          nativeDragStartSnapshot = {
            kind: 'court',
            court: selectedNativeCourt,
            x: selectedNativeCourt.x,
            z: selectedNativeCourt.z,
            rotY: selectedNativeCourt.rotY || 0
          };
        } else if (selectedNativeWalk) {
          const pt = selectedNativeWalk.path.points[selectedNativeWalk.pointIndex];
          const connectedNodes = [];
          if (roads && roads.paths) {
            for (const p of roads.paths) {
              if (p.hidden || p.class !== 1 || !p.points) continue;
              p.points.forEach((pcoord, idx) => {
                if (p === selectedNativeWalk.path && idx === selectedNativeWalk.pointIndex) return;
                if (Math.hypot(pcoord[0] - pt[0], pcoord[1] - pt[1]) < 0.25) {
                  connectedNodes.push({ path: p, pointIndex: idx, origPt: [pcoord[0], pcoord[1]] });
                }
              });
            }
          }
          nativeDragStartSnapshot = {
            kind: 'walk',
            path: selectedNativeWalk.path,
            pointIndex: selectedNativeWalk.pointIndex,
            pt: [pt[0], pt[1]],
            connectedNodes
          };
        }
      } else if (selectedObject) {
        const grp = selectedObject.group || selectedObject;
        if (grp && grp.position) {
          objectDragStartSnapshot = {
            grp,
            pos: grp.position.clone(),
            rotY: grp.rotation.y,
            scale: grp.scale.clone()
          };
        }
      }
    } else {
      // Drag finished: rebuild terrain surfaces & record undo!
      if (selectedObject === nativeProxyObj && nativeDragStartSnapshot) {
        const snap = nativeDragStartSnapshot;
        nativeDragStartSnapshot = null;
        if (snap.kind === 'court') {
          const newX = snap.court.x, newZ = snap.court.z, newRot = snap.court.rotY || 0;
          pushUndo({
            type: 'move_native_court',
            undo: () => {
              snap.court.x = snap.x;
              snap.court.z = snap.z;
              snap.court.rotY = snap.rotY;
              rebuildTerrainSurfaces();
              saveStudioState();
            },
            redo: () => {
              snap.court.x = newX;
              snap.court.z = newZ;
              snap.court.rotY = newRot;
              rebuildTerrainSurfaces();
              saveStudioState();
            }
          });
        } else if (snap.kind === 'walk') {
          const curPt = snap.path.points[snap.pointIndex];
          const newPt = [curPt[0], curPt[1]];
          pushUndo({
            type: 'move_native_walk_pt',
            undo: () => {
              snap.path.points[snap.pointIndex] = [snap.pt[0], snap.pt[1]];
              if (snap.connectedNodes) {
                for (const node of snap.connectedNodes) {
                  if (node.path.points && node.path.points[node.pointIndex]) {
                    node.path.points[node.pointIndex] = [node.origPt[0], node.origPt[1]];
                  }
                }
              }
              rebuildTerrainSurfaces();
              saveStudioState();
            },
            redo: () => {
              snap.path.points[snap.pointIndex] = [newPt[0], newPt[1]];
              if (snap.connectedNodes) {
                for (const node of snap.connectedNodes) {
                  if (node.path.points && node.path.points[node.pointIndex]) {
                    node.path.points[node.pointIndex] = [newPt[0], newPt[1]];
                  }
                }
              }
              rebuildTerrainSurfaces();
              saveStudioState();
            }
          });
        }
        rebuildTerrainSurfaces();
        syncNativeSurfaceUI();
        saveStudioState();
      } else if (objectDragStartSnapshot) {
        const snap = objectDragStartSnapshot;
        objectDragStartSnapshot = null;
        const newPos = snap.grp.position.clone();
        const newRot = snap.grp.rotation.y;
        const newScale = snap.grp.scale.clone();
        if (
          newPos.distanceToSquared(snap.pos) > 0.0001 ||
          Math.abs(newRot - snap.rotY) > 0.0001 ||
          newScale.distanceToSquared(snap.scale) > 0.0001
        ) {
          pushUndo({
            type: 'transform_object',
            undo: () => {
              snap.grp.position.copy(snap.pos);
              snap.grp.rotation.y = snap.rotY;
              snap.grp.scale.copy(snap.scale);
              onTransformChange();
              saveStudioState();
            },
            redo: () => {
              snap.grp.position.copy(newPos);
              snap.grp.rotation.y = newRot;
              snap.grp.scale.copy(newScale);
              onTransformChange();
              saveStudioState();
            }
          });
          onTransformChange();
          saveStudioState();
        }
      }
    }
  });

  const roadBuffers = [];
  const turf = window.turf;
  if (turf) {
    try {
      const avenueLine = turf.lineString([[0, 17.5], [0, 36.0]]);
      const avenueBuffer = turf.buffer(avenueLine, 5.5, { units: 'meters' });
      roadBuffers.push({ id: 'road_avenue', name: 'Đại lộ U-turn (Avenue)', feature: avenueBuffer });

      const circlePts = [];
      const r = 8.5;
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        circlePts.push([Number((Math.cos(a) * r).toFixed(3)), Number((17.5 + Math.sin(a) * r).toFixed(3))]);
      }
      circlePts.push([circlePts[0][0], circlePts[0][1]]);
      roadBuffers.push({ id: 'road_roundabout', name: 'Vòng xuyến đón khách HQ', feature: turf.polygon([circlePts]) });

      if (roads && roads.paths) {
        for (const p of roads.paths) {
          if (p.class >= 2 && p.curve) {
            const pts = Array.from({ length: 41 }, (_, i) => {
              const q = p.curve.getPointAt(i / 40);
              return [q.x, q.z];
            });
            const buf = turf.buffer(turf.lineString(pts), (p.width / 2) + 1.5, { units: 'meters' });
            roadBuffers.push({ id: `road_${p.id || 'internal'}`, name: `Đường xe ${p.id || 'nội bộ'}`, feature: buf });
          }
        }
      }
    } catch (e) {
      console.warn('[Editor] Turf road buffers error:', e);
    }
  }

  // Register buildings
  for (const b of L.buildings) {
    const group = buildingObjects.get(b.id);
    if (!group) continue;
    const gradeDims = L.grades[b.grade] || [10, 8, 10];
    buildingFootprints.set(b.id, {
      id: b.id,
      name: b.name,
      group,
      w: gradeDims[0],
      d: gradeDims[2],
      grade: b.grade,
      binding: b,
      lot: group.userData.lot || null
    });
  }

  if (L.schedule) {
    const sg = buildingObjects.get(L.schedule.id);
    if (sg) {
      buildingFootprints.set(L.schedule.id, {
        id: L.schedule.id,
        name: 'Kiosk Lịch làm việc',
        group: sg,
        w: 4.4,
        d: 1.5,
        grade: 'kiosk',
        binding: L.schedule
      });
    }
  }

  function calcFootprintPolygon(x, z, w, d, rotY = 0) {
    const hw = w / 2, hd = d / 2;
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const ring = pts.map(([dx, dz]) => [
      Number((x + dx * cos - dz * sin).toFixed(3)),
      Number((z + dx * sin + dz * cos).toFixed(3))
    ]);
    ring.push([ring[0][0], ring[0][1]]);
    return turf.polygon([ring]);
  }

  // Tòa có lô nới rộng (cánh chữ L) vượt ra ngoài ô hạng: đa giác lô thật theo vị trí và góc xoay hiện tại của tòa
  function lotPolygon(data) {
    const lot = data.lot, grp = data.group;
    if (!lot || !grp) return null;
    const cos = Math.cos(grp.rotation.y), sin = Math.sin(grp.rotation.y);
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
      const lx = lot.x + sx * lot.w / 2, lz = lot.z + sz * lot.d / 2;
      return [Number((grp.position.x + lx * cos + lz * sin).toFixed(3)), Number((grp.position.z - lx * sin + lz * cos).toFixed(3))];
    });
    ring.push([ring[0][0], ring[0][1]]);
    return turf.polygon([ring]);
  }

  function evaluateCollision(bldOrTarget) {
    if (!turf) return { state: 'UNKNOWN', msg: 'Turf.js chưa sẵn sàng', safe: true };
    const grp = bldOrTarget.group || bldOrTarget;
    const x = grp.position.x;
    const z = grp.position.z;
    const rotY = grp.rotation.y;
    const w = bldOrTarget.w || 2.0;
    const d = bldOrTarget.d || 2.0;
    const currentPolys = [calcFootprintPolygon(x, z, w, d, rotY), lotPolygon(bldOrTarget)].filter(Boolean);

    for (const rBuf of roadBuffers) {
      try {
        if (currentPolys.some(poly => turf.booleanIntersects(poly, rBuf.feature))) {
          return {
            state: 'ROAD_COLLISION',
            safe: false,
            msg: `⚠️ VA CHẠM: Đè hành lang ${rBuf.name}!`,
            target: rBuf.name
          };
        }
      } catch (e) {}
    }

    for (const [otherId, otherData] of buildingFootprints) {
      if (bldOrTarget.id && otherId === bldOrTarget.id) continue;
      const otherPolys = [calcFootprintPolygon(
        otherData.group.position.x,
        otherData.group.position.z,
        otherData.w,
        otherData.d,
        otherData.group.rotation.y
      ), lotPolygon(otherData)].filter(Boolean);
      try {
        if (currentPolys.some(poly => otherPolys.some(other => turf.booleanIntersects(poly, other)))) {
          return {
            state: 'BUILDING_COLLISION',
            safe: false,
            msg: `⚠️ VA CHẠM: Đè công trình ${otherData.name}!`,
            target: otherData.name
          };
        }
      } catch (e) {}
    }

    return { state: 'SAFE', safe: true, msg: '✅ Tọa độ an toàn · Không va chạm' };
  }

  function evaluateAllCollisions() {
    if (!turf) return { ok: true, safe: true, totalChecked: 0, violations: [] };
    const violations = [];
    let totalChecked = 0;

    for (const [id, fp] of buildingFootprints) {
      totalChecked++;
      const res = evaluateCollision(fp);
      if (!res.safe) {
        violations.push({
          source: id,
          sourceName: fp.name,
          target: res.target,
          type: res.state,
          message: res.msg
        });
      }
    }

    for (const obj of customPlacedObjects) {
      totalChecked++;
      const res = evaluateCollision(obj);
      if (!res.safe) {
        violations.push({
          source: obj.name,
          sourceName: obj.userData?.assetType || 'Custom Prop',
          target: res.target,
          type: res.state,
          message: res.msg
        });
      }
    }

    return {
      ok: true,
      safe: violations.length === 0,
      totalChecked,
      violations
    };
  }

  function onTransformChange() {
    if (!selectedObject) return;
    if (selectedObject === nativeProxyObj) {
      const nx = Number(nativeProxyObj.position.x.toFixed(2));
      const nz = Number(nativeProxyObj.position.z.toFixed(2));
      nativeProxyObj.position.y = terrain.height(nx, nz) + 0.22;
      if (selectedNativeCourt) {
        selectedNativeCourt.x = nx;
        selectedNativeCourt.z = nz;
        selectedNativeCourt.rotY = Number(nativeProxyObj.rotation.y.toFixed(3));
      } else if (selectedNativeWalk) {
        selectedNativeWalk.path.points[selectedNativeWalk.pointIndex] = [nx, nz];
        if (nativeDragStartSnapshot && nativeDragStartSnapshot.connectedNodes) {
          for (const node of nativeDragStartSnapshot.connectedNodes) {
            if (node.path.points && node.path.points[node.pointIndex]) {
              node.path.points[node.pointIndex] = [nx, nz];
            }
          }
        }
      }
      rebuildNativeSurfaceHandles();
      syncNativeSurfaceUI();
      return;
    }
    const grp = selectedObject.group || selectedObject;

    const x = grp.position.x;
    const z = grp.position.z;
    if (groundSnapEnabled && !transformControls.showY) {
      grp.position.y = terrain.height(x, z);
    }
    const y = grp.position.y;
    const rotY = grp.rotation.y;

    if (grp.userData?.footprint) {
      grp.userData.footprint.position.set(x, y + 0.04, z);
      // Khung nằm ngang (rotation.x = -PI/2) nên rotation.z = rotY mới xoay cùng chiều với tòa; -rotY cho khung soi gương, lộ rõ ở lô lệch tâm
      grp.userData.footprint.rotation.z = rotY;
    }

    const coordsEl = document.querySelector('#edit-coords');
    const rotEl = document.querySelector('#edit-rot');
    const rotBadge = document.querySelector('#edit-rot-badge');
    const rotSlider = document.querySelector('#slider-rotate-y');
    const rotInp = document.querySelector('#inp-rotate-y');

    let deg = Math.round((rotY * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;

    if (coordsEl) coordsEl.textContent = `[${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}]`;
    if (rotEl) rotEl.textContent = `${deg}°`;
    if (rotBadge) rotBadge.textContent = `${deg}°`;
    if (rotSlider && document.activeElement !== rotSlider) rotSlider.value = deg;
    if (rotInp && document.activeElement !== rotInp) rotInp.value = deg;

    if (selectedObject && selectedObject.id) {
      const itemEl = document.querySelector(`.bld-quick-item[data-id="${selectedObject.id}"] span:last-child`);
      if (itemEl) itemEl.textContent = `[${x.toFixed(1)}, ${z.toFixed(1)}]`;
    }

    const res = evaluateCollision(selectedObject);
    const hud = document.querySelector('#collision-hud');
    if (hud) {
      if (res.safe) {
        hud.style.background = '#dcfce7';
        hud.style.borderColor = '#86efac';
        hud.style.color = '#166534';
        hud.textContent = res.msg;
      } else {
        hud.style.background = '#fee2e2';
        hud.style.borderColor = '#ef4444';
        hud.style.color = '#991b1b';
        hud.textContent = res.msg;
      }
    }

    syncMaterialUI(selectedObject);
  }

  transformControls.addEventListener('objectChange', onTransformChange);

  function isTransformGizmoObject(o) {
    if (!o) return false;
    let cur = o;
    while (cur) {
      if (cur.isTransformControlsRoot || cur.isTransformControlsGizmo || cur.isTransformControlsPlane || cur === helper) {
        return true;
      }
      cur = cur.parent;
    }
    return false;
  }

  
  function syncTransformGizmoAxes(targetMode = null) {
    const mode = targetMode || transformControls.mode || 'translate';
    transformControls.setMode(mode);
    if (mode === 'rotate') {
      transformControls.showX = false;
      transformControls.showZ = false;
      transformControls.showY = true;
    } else if (mode === 'scale') {
      transformControls.showX = true;
      transformControls.showZ = true;
      transformControls.showY = true;
    } else {
      transformControls.showX = true;
      transformControls.showZ = true;
      transformControls.showY = !groundSnapEnabled;
    }

    const styleBtn = (id, active) => {
      const b = document.querySelector(id);
      if (!b) return;
      b.style.background = active ? '#047857' : '#05966930';
      b.style.color = active ? '#ffffff' : '#065f46';
    };
    styleBtn('#btn-mode-translate', mode === 'translate');
    styleBtn('#btn-mode-rotate', mode === 'rotate');
    styleBtn('#btn-prop-translate', mode === 'translate');
    styleBtn('#btn-prop-rotate', mode === 'rotate');
    styleBtn('#btn-prop-scale', mode === 'scale');
    styleBtn('#btn-foliage-translate', mode === 'translate');
    styleBtn('#btn-foliage-rotate', mode === 'rotate');
    styleBtn('#btn-foliage-scale', mode === 'scale');
  }

  function rotateSelectedObject(deltaDeg) {
    if (!selectedObject) {
      showToast('⚠️ Vui lòng click chọn một tòa nhà, hộp cam hoặc đồ vật trước khi xoay!', '#f59e0b');
      return;
    }
    if (selectedObject === nativeProxyObj && selectedNativeCourt) {
      const c = selectedNativeCourt;
      const oldRot = c.rotY || 0;
      const newRot = oldRot + (deltaDeg * Math.PI) / 180;
      c.rotY = newRot;
      nativeProxyObj.rotation.y = newRot;
      rebuildTerrainSurfaces();
      syncNativeSurfaceUI();
      saveStudioState();
      pushUndo({
        type: 'rotate_native_court',
        undo: () => { c.rotY = oldRot; nativeProxyObj.rotation.y = oldRot; rebuildTerrainSurfaces(); syncNativeSurfaceUI(); saveStudioState(); },
        redo: () => { c.rotY = newRot; nativeProxyObj.rotation.y = newRot; rebuildTerrainSurfaces(); syncNativeSurfaceUI(); saveStudioState(); }
      });
      showToast(`🔄 Đã xoay Hộp cam ${deltaDeg > 0 ? '+' : ''}${deltaDeg}°`, '#ea580c');
      return;
    }
    const grp = selectedObject.group || selectedObject;
    const oldRot = grp.rotation.y;
    const deltaRad = (deltaDeg * Math.PI) / 180;
    grp.rotation.y += deltaRad;
    grp.rotation.y = grp.rotation.y % (Math.PI * 2);
    if (grp.rotation.y < 0) grp.rotation.y += Math.PI * 2;
    const newRot = grp.rotation.y;

    pushUndo({
      type: 'rotate_object',
      undo: () => { grp.rotation.y = oldRot; onTransformChange(); saveStudioState(); },
      redo: () => { grp.rotation.y = newRot; onTransformChange(); saveStudioState(); }
    });

    onTransformChange();
    saveStudioState();

    let deg = Math.round((grp.rotation.y * 180) / Math.PI) % 360;
    showToast(`🔄 Đã xoay ${deltaDeg > 0 ? '+' : ''}${deltaDeg}° (Góc hiện tại: ${deg}°)`, '#059669');
  }

  function setRotationSelectedObject(targetDeg) {
    if (!selectedObject) return;
    const grp = selectedObject.group || selectedObject;
    let deg = parseFloat(targetDeg) % 360;
    if (isNaN(deg)) deg = 0;
    if (deg < 0) deg += 360;
    grp.rotation.y = (deg * Math.PI) / 180;
    onTransformChange();
    saveStudioState();
  }

  function selectBuilding(bldId) {
    setTimeout(updateSelectTargetInfoUI, 10);
    if (!bldId) return null;
    const id = typeof bldId === 'string' ? bldId : (bldId.id || bldId.userData?.buildingId);
    const bld = buildingFootprints.get(id);
    if (!bld) return null;
    selectedObject = bld;
    transformControls.attach(bld.group);
    syncTransformGizmoAxes('translate');
    helper.visible = true;

    const nameEl = document.querySelector('#edit-target-name');
    if (nameEl) nameEl.textContent = `Đang chọn: ${bld.name} (${bld.id})`;

    onTransformChange();
    updateBuildingsQuickList();
    return bld;
  }

  function selectCustomObject(obj) {
    setTimeout(updateSelectTargetInfoUI, 10);
    if (!obj || isTransformGizmoObject(obj) || obj.name === 'grid-helper' || obj === brushMarker) return null;
    selectedObject = obj;
    transformControls.attach(obj);
    syncTransformGizmoAxes('translate');
    helper.visible = true;

    const isProp = obj.userData?.isProp;
    const propNameEl = document.querySelector('#prop-target-name');
    const foliageNameEl = document.querySelector('#foliage-target-name');
    const genNameEl = document.querySelector('#edit-target-name');
    const title = `Đang chọn: ${obj.userData?.assetType || 'Đối tượng'} (${obj.name})`;

    if (isProp && propNameEl) propNameEl.textContent = title;
    else if (!isProp && foliageNameEl) foliageNameEl.textContent = title;
    if (genNameEl) genNameEl.textContent = title;

    onTransformChange();
    updatePropsListUI();
    updateFoliageListUI();
    return obj;
  }

  function deselect() {
    setTimeout(updateSelectTargetInfoUI, 10);
    transformControls.detach();
    helper.visible = false;
    selectedObject = null;
    const nameEl = document.querySelector('#edit-target-name');
    if (nameEl) nameEl.textContent = 'Đang chọn: (Click vào nhà/công trình/đạo cụ)';
  }

  // =========================================================================
  // 3. TERRAIN SCULPTING ENGINE (Gauss Falloff: Raise, Lower, Flatten, Smooth)
  // =========================================================================
  let terrainSubMode = 'sculpt'; // 'sculpt' | 'paint'
  let sculptRadius = 6.0;
  let sculptStrength = 0.4;
  let sculptMode = 'raise';
  let flattenTargetY = null;
  // Chỉ khác null trong lúc đang kéo cọ; applySculpt/applyPaint gọi từ API hay Redo không ghi vào đây.
  let activeSculptStroke = null; // k -> prevY
  let activePaintStroke = null;  // k -> [prevR, prevG, prevB]
  let activeSculptSnaps = null;  // object -> prevY của tòa nhà/vật thể bị kéo theo mặt đất

  const brushRingGeo = new T.RingGeometry(sculptRadius - 0.25, sculptRadius + 0.15, 48);
  brushRingGeo.rotateX(-Math.PI / 2);
  const brushRingMat = new T.MeshBasicMaterial({ color: 0x059669, side: T.DoubleSide, transparent: true, opacity: 0.8 });
  const brushMarker = new T.Mesh(brushRingGeo, brushRingMat);
  brushMarker.visible = false;
  scene.add(brushMarker);

  function updateBrushMarkerGeometry(r) {
    brushMarker.geometry.dispose();
    const g = new T.RingGeometry(Math.max(0.2, r - 0.25), r + 0.15, 48);
    g.rotateX(-Math.PI / 2);
    brushMarker.geometry = g;
  }

  function snapSceneObjectsToNewTerrain(xc = null, zc = null, radius = 999) {
    if (groundSnapEnabled) {
      for (const [, fp] of buildingFootprints) {
        const p = fp.group.position;
        if (xc === null || Math.hypot(p.x - xc, p.z - zc) <= radius + 12) {
          if (activeSculptSnaps && !activeSculptSnaps.has(fp.group)) activeSculptSnaps.set(fp.group, p.y);
          p.y = terrain.height(p.x, p.z);
          if (fp.group.userData?.footprint) {
            fp.group.userData.footprint.position.y = p.y + 0.04;
          }
        }
      }
      for (const obj of customPlacedObjects) {
        const p = obj.position;
        if (xc === null || Math.hypot(p.x - xc, p.z - zc) <= radius + 6) {
          if (activeSculptSnaps && !activeSculptSnaps.has(obj)) activeSculptSnaps.set(obj, p.y);
          p.y = terrain.height(p.x, p.z);
        }
      }
    }
  }

  function setSnappedHeights(heights) {
    for (const [obj, y] of heights) {
      obj.position.y = y;
      if (obj.userData?.footprint) obj.userData.footprint.position.y = y + 0.04;
    }
    if (selectedObject) onTransformChange();
  }

  function applySculpt(hitPoint, mode = sculptMode, radius = sculptRadius, strength = sculptStrength, targetY = null) {
    if (!basePosArray) return { affectedVertices: 0, previousHeights: [] };
    const xc = hitPoint.x;
    const zc = hitPoint.z;
    const yc = hitPoint.y;

    if (mode === 'flatten' && targetY === null && flattenTargetY === null) flattenTargetY = yc;
    const effectiveTargetY = targetY !== null ? targetY : flattenTargetY;

    const minI = Math.max(0, Math.floor((xc - radius - GRID.x0) / GRID.stepX));
    const maxI = Math.min(nx, Math.ceil((xc + radius - GRID.x0) / GRID.stepX));
    const minJ = Math.max(0, Math.floor((zc - radius - GRID.z0) / GRID.stepZ));
    const maxJ = Math.min(nz, Math.ceil((zc + radius - GRID.z0) / GRID.stepZ));

    let modifiedCount = 0;
    const previousHeights = [];

    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const vx = GRID.x0 + i * GRID.stepX;
        const vz = GRID.z0 + j * GRID.stepZ;
        const dist = Math.hypot(vx - xc, vz - zc);
        if (dist <= radius) {
          const k = j * (nx + 1) + i;
          const currentY = basePosArray[k * 3 + 1];
          previousHeights.push([k, currentY]);
          if (activeSculptStroke && !activeSculptStroke.has(k)) activeSculptStroke.set(k, currentY);

          const ratio = dist / radius;
          const falloff = Math.pow(1 - ratio * ratio, 2);

          let newY = currentY;
          if (mode === 'raise') newY += strength * falloff * 0.22;
          else if (mode === 'lower') newY -= strength * falloff * 0.22;
          else if (mode === 'flatten') {
            const target = effectiveTargetY !== null ? effectiveTargetY : yc;
            newY = currentY + (target - currentY) * falloff * Math.min(1.0, strength * 0.45);
          } else if (mode === 'smooth') {
            let neighborSum = 0, neighborCount = 0;
            for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
              const ni = i + di, nj = j + dj;
              if (ni >= 0 && ni <= nx && nj >= 0 && nj <= nz) {
                neighborSum += basePosArray[(nj * (nx + 1) + ni) * 3 + 1];
                neighborCount++;
              }
            }
            if (neighborCount > 0) {
              const avgY = neighborSum / neighborCount;
              newY = currentY + (avgY - currentY) * falloff * strength * 0.4;
            }
          }
          basePosArray[k * 3 + 1] = newY;
          modifiedHeightIndices.add(k);
          modifiedCount++;
        }
      }
    }

    if (modifiedCount > 0) {
      if (terrain.syncLiveBuffers) terrain.syncLiveBuffers(true, false);
      snapSceneObjectsToNewTerrain(xc, zc, radius);
      if (selectedObject) onTransformChange();
    }

    return { affectedVertices: modifiedCount, previousHeights };
  }

  function resetTerrainHeights() {
    if (!basePosArray) return;
    for (let i = 0; i < baseCount; i++) {
      basePosArray[i * 3 + 1] = originalHeights[i];
    }
    modifiedHeightIndices.clear();
    if (terrain.syncLiveBuffers) terrain.syncLiveBuffers(true, false);
    snapSceneObjectsToNewTerrain();
    rebuildTerrainGrid();
    if (selectedObject) onTransformChange();
    saveStudioState();
    showToast('🔄 Đã khôi phục địa hình nguyên bản!', '#64748b');
  }

  // =========================================================================
  // 4. PAINT GROUND TEXTURE ENGINE (Grass, Dirt, Gravel, Stone)
  // =========================================================================
  let paintMaterialType = 'dirt'; // 'grass' | 'dirt' | 'gravel' | 'stone'
  let paintRadius = 5.0;
  let paintIntensity = 0.35;

  // Base terrain material[0] is #4f805a. Compensating vertexColor = desiredColor / baseGrassColor
  // guarantees that in Three.js fragment shader (diffuseColor.rgb *= vColor), the ground renders the exact target color!
  const baseGrassCol = terrain?.materials?.[0]?.color?.clone() || new T.Color('#6fa659');
  function makeCompensatedVertexColor(hexStr) {
    const c = new T.Color(hexStr);
    return {
      r: c.r / Math.max(0.01, baseGrassCol.r),
      g: c.g / Math.max(0.01, baseGrassCol.g),
      b: c.b / Math.max(0.01, baseGrassCol.b)
    };
  }
  const targetColors = {
    grass:  { r: 1.0, g: 1.0, b: 1.0 },                 // 🌾 Cỏ xanh nguyên bản (#4f805a)
    dirt:   makeCompensatedVertexColor('#b76e4b'),      // 🟫 Đất cam gạch nung (#b76e4b)
    gravel: makeCompensatedVertexColor(P?.colors?.walk || '#dca658'),      // 🟨 Cát vàng đường dạo (campus-palette.json → colors.walk)
    stone:  makeCompensatedVertexColor('#d6cebd')       // ⬜ Đá sỏi kem sáng (#d6cebd)
  };

  function applyPaint(hitPoint, type = paintMaterialType, radius = paintRadius, intensity = paintIntensity) {
    if (!baseColorArray) return { affectedVertices: 0 };

    const xc = hitPoint.x;
    const zc = hitPoint.z;
    const minI = Math.max(0, Math.floor((xc - radius - GRID.x0) / GRID.stepX));
    const maxI = Math.min(nx, Math.ceil((xc + radius - GRID.x0) / GRID.stepX));
    const minJ = Math.max(0, Math.floor((zc - radius - GRID.z0) / GRID.stepZ));
    const maxJ = Math.min(nz, Math.ceil((zc + radius - GRID.z0) / GRID.stepZ));

    const target = targetColors[type] || targetColors.grass;
    let modifiedCount = 0;
    const prevColors = [];

    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const vx = GRID.x0 + i * GRID.stepX;
        const vz = GRID.z0 + j * GRID.stepZ;
        const dist = Math.hypot(vx - xc, vz - zc);
        if (dist <= radius) {
          const k = j * (nx + 1) + i;
          const r = baseColorArray[k * 3];
          const g = baseColorArray[k * 3 + 1];
          const b = baseColorArray[k * 3 + 2];
          prevColors.push([k, r, g, b]);
          if (activePaintStroke && !activePaintStroke.has(k)) activePaintStroke.set(k, [r, g, b]);

          const ratio = dist / radius;
          const falloff = Math.min(1.0, Math.pow(1 - ratio, 1.5) * intensity * 0.85);

          modifiedColorIndices.add(k);
          baseColorArray[k * 3]     = T.MathUtils.lerp(r, target.r, falloff);
          baseColorArray[k * 3 + 1] = T.MathUtils.lerp(g, target.g, falloff);
          baseColorArray[k * 3 + 2] = T.MathUtils.lerp(b, target.b, falloff);
          modifiedCount++;
        }
      }
    }

    if (modifiedCount > 0) {
      if (terrain.syncLiveBuffers) terrain.syncLiveBuffers(false, true);
    }

    return { affectedVertices: modifiedCount, prevColors };
  }

  function resetGroundPaint() {
    if (!baseColorArray) return;
    if (terrain.designColorArray) baseColorArray.set(terrain.designColorArray);
    else baseColorArray.fill(1.0);
    modifiedColorIndices.clear();
    if (terrain.syncLiveBuffers) terrain.syncLiveBuffers(false, true);
    saveStudioState();
    showToast('🔄 Đã khôi phục màu cỏ ban đầu!', '#64748b');
  }

  // =========================================================================
  // 5. SIMCITY 3D TERRAIN-CONFORMING GRID, TILE CURSOR & GRID ROAD ENGINE
  // =========================================================================
  let gridVisible = false;
  let gridSnapEnabled = true;
  let gridStep = 1.0;

  // Build a 3D Grid that hugs the exact terrain elevation (terrain.height(x, z) + 0.09)
  // Grid lines are placed at (k + 0.5) * step so each tile (gx, gz) centered at (gx*step, gz*step) sits squarely inside a grid cell!
  // Group chứa toàn bộ nhãn số tọa độ in trực tiếp trên mặt đất
  const gridLabelsGroup = new T.Group();
  gridLabelsGroup.name = 'grid-coordinate-labels';
  gridLabelsGroup.visible = false;
  scene.add(gridLabelsGroup);

  // Helper tạo Texture chữ số nổi bật sắc nét
  function makeCoordinateLabelSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    
    // Nền viên thuốc mờ tối
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(4, 4, 120, 40, 12);
    ctx.fill();
    ctx.stroke();

    // Chữ số trắng kem nổi bật
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 24);

    const texture = new T.CanvasTexture(canvas);
    texture.minFilter = T.LinearFilter;
    const mat = new T.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new T.Sprite(mat);
    sprite.scale.set(4.0, 1.5, 1.0);
    return sprite;
  }

  function buildTerrainGridObject(stepSize = 5.0) {
    // Xóa nhãn số cũ nếu có
    while (gridLabelsGroup.children.length > 0) {
      const c = gridLabelsGroup.children.pop();
      c.material?.map?.dispose();
      c.material?.dispose();
    }

    const positions = [];
    const colors = [];
    const minX = -80, maxX = 80;
    const minZ = -60, maxZ = 50;
    const subStep = 2.0;

    const colMajor = new T.Color(0x38bdf8); // Cyan thanh lịch mỗi 10m
    const colMinor = new T.Color(0xffffff); // Trắng mờ mỗi 5m

    // Vẽ lưới đường mỏng, thanh lịch (bước 5m)
    for (let x = minX; x <= maxX; x += 5.0) {
      const isMajor = (Math.abs(x) % 10 === 0);
      const c = isMajor ? colMajor : colMinor;
      for (let z = minZ; z < maxZ; z += subStep) {
        const zNext = Math.min(maxZ, z + subStep);
        const y1 = terrain.height(x, z) + 0.12;
        const y2 = terrain.height(x, zNext) + 0.12;
        positions.push(x, y1, z, x, y2, zNext);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }

    for (let z = minZ; z <= maxZ; z += 5.0) {
      const isMajor = (Math.abs(z) % 10 === 0);
      const c = isMajor ? colMajor : colMinor;
      for (let x = minX; x < maxX; x += subStep) {
        const xNext = Math.min(maxX, x + subStep);
        const y1 = terrain.height(x, z) + 0.12;
        const y2 = terrain.height(xNext, z) + 0.12;
        positions.push(x, y1, z, xNext, y2, z);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }

    // IN SỐ TỌA ĐỘ TRỰC TIẾP LÊN MẶT ĐẤT CỨ MỖI 10M
    for (let x = -60; x <= 60; x += 10) {
      for (let z = -40; z <= 35; z += 10) {
        const sprite = makeCoordinateLabelSprite(`[${x},${z}]`);
        sprite.position.set(x, terrain.height(x, z) + 1.2, z);
        gridLabelsGroup.add(sprite);
      }
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    const mat = new T.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    const lines = new T.LineSegments(geo, mat);
    lines.name = 'grid-helper';
    lines.renderOrder = 2;
    return lines;
  }
  function legacyBuildTerrainGridObjectDummy() {
    const positions = [];
    const colors = [];
    const minX = -86, maxX = 86;
    const minZ = -62, maxZ = 54;
    const subStep = 1.0;

    const colMajor = new T.Color(0x047857); // Deep emerald every 5 tiles
    const colMinor = new T.Color(0x10b981); // Crisp bright green tile lines

    const minIx = Math.floor(minX / stepSize);
    const maxIx = Math.ceil(maxX / stepSize);
    const minIz = Math.floor(minZ / stepSize);
    const maxIz = Math.ceil(maxZ / stepSize);

    // Lines parallel to Z (constant X = (ix + 0.5) * stepSize)
    for (let ix = minIx; ix <= maxIx; ix++) {
      const x = (ix + 0.5) * stepSize;
      const isMajor = (ix % 5 === 0);
      const c = isMajor ? colMajor : colMinor;
      for (let z = minZ; z < maxZ; z += subStep) {
        const zNext = Math.min(maxZ, z + subStep);
        const y1 = terrain.height(x, z) + 0.09;
        const y2 = terrain.height(x, zNext) + 0.09;
        positions.push(x, y1, z, x, y2, zNext);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }

    // Lines parallel to X (constant Z = (iz + 0.5) * stepSize)
    for (let iz = minIz; iz <= maxIz; iz++) {
      const z = (iz + 0.5) * stepSize;
      const isMajor = (iz % 5 === 0);
      const c = isMajor ? colMajor : colMinor;
      for (let x = minX; x < maxX; x += subStep) {
        const xNext = Math.min(maxX, x + subStep);
        const y1 = terrain.height(x, z) + 0.09;
        const y2 = terrain.height(xNext, z) + 0.09;
        positions.push(x, y1, z, xNext, y2, z);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    const mat = new T.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.68,
      depthWrite: false
    });
    const lines = new T.LineSegments(geo, mat);
    lines.name = 'grid-helper';
    lines.renderOrder = 2;
    return lines;
  }

  let gridHelper = buildTerrainGridObject(gridStep);
  gridHelper.visible = false;
  scene.add(gridHelper);

  function rebuildTerrainGrid() {
    const wasVisible = gridHelper ? gridHelper.visible : gridVisible;
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.geometry?.dispose();
      gridHelper.material?.dispose();
    }
    gridHelper = buildTerrainGridObject(gridStep);
    gridHelper.visible = wasVisible;
    scene.add(gridHelper);
  }

  // SimCity Tile Cursor Rig (Highlights the exact grid cell [gx, gz] under mouse)
  const tileCursorGroup = new T.Group();
  tileCursorGroup.name = 'simcity-tile-cursor';
  tileCursorGroup.visible = false;
  scene.add(tileCursorGroup);

  const tileFillGeo = new T.BufferGeometry();
  tileFillGeo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(12), 3));
  tileFillGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const tileFillMat = new T.MeshBasicMaterial({
    color: 0x0ea5e9,
    side: T.DoubleSide,
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  });
  const tileFillMesh = new T.Mesh(tileFillGeo, tileFillMat);
  tileFillMesh.renderOrder = 4;
  tileCursorGroup.add(tileFillMesh);

  const tileBorderGeo = new T.BufferGeometry();
  tileBorderGeo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(15), 3));
  const tileBorderMat = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
  const tileBorderLine = new T.Line(tileBorderGeo, tileBorderMat);
  tileBorderLine.renderOrder = 5;
  tileCursorGroup.add(tileBorderLine);

  function worldToTile(x, z, stepSize = gridStep) {
    return {
      gx: Math.round(x / stepSize),
      gz: Math.round(z / stepSize)
    };
  }

  function updateTileCursor(gx, gz, colorHex = 0x0ea5e9, visible = true) {
    if (!visible) {
      tileCursorGroup.visible = false;
      return;
    }
    tileCursorGroup.visible = true;
    const cx = gx * gridStep;
    const cz = gz * gridStep;
    const hs = gridStep * 0.48;
    const x0 = cx - hs, x1 = cx + hs;
    const z0 = cz - hs, z1 = cz + hs;
    const cElev00 = getCourtSurfaceY(x0, z0);
    const cElev10 = getCourtSurfaceY(x1, z0);
    const cElev11 = getCourtSurfaceY(x1, z1);
    const cElev01 = getCourtSurfaceY(x0, z1);
    const y00 = terrain.height(x0, z0) + cElev00 + 0.12;
    const y10 = terrain.height(x1, z0) + cElev10 + 0.12;
    const y11 = terrain.height(x1, z1) + cElev11 + 0.12;
    const y01 = terrain.height(x0, z1) + cElev01 + 0.12;

    const fPos = tileFillGeo.attributes.position;
    fPos.setXYZ(0, x0, y00, z0);
    fPos.setXYZ(1, x1, y10, z0);
    fPos.setXYZ(2, x1, y11, z1);
    fPos.setXYZ(3, x0, y01, z1);
    fPos.needsUpdate = true;
    tileFillMat.color.setHex(colorHex);

    const bPos = tileBorderGeo.attributes.position;
    bPos.setXYZ(0, x0, y00 + 0.02, z0);
    bPos.setXYZ(1, x1, y10 + 0.02, z0);
    bPos.setXYZ(2, x1, y11 + 0.02, z1);
    bPos.setXYZ(3, x0, y01 + 0.02, z1);
    bPos.setXYZ(4, x0, y00 + 0.02, z0);
    bPos.needsUpdate = true;
  }

  function snapCoord(val, stepSize = gridStep) {
    if (!gridSnapEnabled) return Number(val.toFixed(2));
    return Number((Math.round(val / stepSize) * stepSize).toFixed(2));
  }

  function setGridState({ visible = null, snap = null, step = null }) {
    if (step !== null && !isNaN(step) && step > 0) {
      gridStep = step;
      rebuildTerrainGrid();
      transformControls.setTranslationSnap(gridSnapEnabled ? gridStep : null);
      const sel = document.querySelector('#sel-grid-step');
      if (sel) sel.value = String(step);
    }
    if (visible !== null) {
      gridVisible = visible;
      if (gridHelper) gridHelper.visible = visible;
      gridLabelsGroup.visible = visible;
      const hudBtn = document.querySelector('#btn-toggle-grid-hud');
      if (hudBtn) {
        hudBtn.style.background = visible ? '#0284c7' : '#1e293b';
        hudBtn.style.color = visible ? '#ffffff' : '#94a3b8';
        hudBtn.style.borderColor = visible ? '#38bdf8' : '#475569';
      }
      const chk = document.querySelector('#chk-show-grid');
      if (chk) chk.checked = visible;
    }
    if (snap !== null) {
      gridSnapEnabled = snap;
      const chk = document.querySelector('#chk-grid-snap');
      if (chk) chk.checked = snap;
      transformControls.setTranslationSnap(gridSnapEnabled ? gridStep : null);
    }
  }

  const roadsGroup = new T.Group();
  roadsGroup.name = 'city_builder_custom_roads';
  scene.add(roadsGroup);

  let currentRoadPoints = [];
  let currentControlHandles = [];
  let currentRoadMesh = null;
  let activeRoadType = 'road_yellow';
  const ROAD_WIDTH_PRESETS = {
    road_yellow: 2.0,
    road_orange: 6.0,
    road_asphalt: 6.0,
    road_concrete: 4.5,
    road_walk: 2.0,
    road_brick: 2.8,
    plaza_park: 8.0
  };
  let customRoadWidth = 2.0;
  let selectedRoad = null;

  function makeRoadMaterial(colorHex, roughness = 0.90, offsetFactor = -2) {
    return new T.MeshStandardMaterial({
      color: colorHex,
      roughness,
      side: T.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: offsetFactor,
      polygonOffsetUnits: offsetFactor
    });
  }

  const roadMaterials = {
    // 1. Đường nhựa slate cùng màu vành đai (#4f6078) + Vạch kẻ trắng
    asphalt:         makeRoadMaterial(0x4f6078, 0.88, -2),
    asphaltStripe:   makeRoadMaterial(0xf8fafc, 0.35, -4),

    // 2. Đường bê tông nội khu
    concrete:        makeRoadMaterial(0x94a3b8, 0.78, -2),
    concreteSeam:    makeRoadMaterial(0x475569, 0.90, -3),

    // 3. Đường đi bộ Campus (lòng đường vàng + 2 mép vàng kem nhạt hơn; màu lấy từ campus-palette.json → colors.walk / walkBorder)
    walkStone:          makeRoadMaterial(P?.colors?.walk || 0xdca658, 0.90, -3),
    curbStone:          makeRoadMaterial(0x808d59, 0.86, -2),

    // 4. Đường lát gạch nung (Terracotta Brick)
    brickTerracotta:    makeRoadMaterial(0xb76e4b, 0.88, -3),

    // 5. Sàn quảng trường / Công viên (Granite Plaza & Deck)
    plazaGranite:       makeRoadMaterial(0xdfd9c7, 0.82, -3),

    // 6. Đường đi bộ màu vàng kèm 2 mép vàng nhạt & Hộp sân màu cam (#b76e4b)
    campusYellow:       makeRoadMaterial(P?.colors?.walk || 0xdca658, 0.90, -3),
    campusYellowBorder: makeRoadMaterial(P?.colors?.walkBorder || 0xf2d99b, 0.86, -2),
    campusOrange:       makeRoadMaterial(0xe09468, 0.90, -4)
  };

  // (Đã gỡ texture gạch lát theo yêu cầu sếp - giữ màu phẳng gốc)
  // Lưới gạch thủ tục theo ảnh tham chiếu Campus Builder; tắt bằng campus-palette.json → paving.tiles = false để về màu phẳng.
  applyCampusPaving(P, roadMaterials.campusOrange, roadMaterials.campusYellow);
    // Set fine polygon offset to avoid any micro-flickering against terrain
    roadMaterials.campusYellow.polygonOffset = true;
    roadMaterials.campusYellow.polygonOffsetFactor = -5;
    roadMaterials.campusYellow.polygonOffsetUnits = -5;
    roadMaterials.campusYellowBorder.polygonOffset = true;
    roadMaterials.campusYellowBorder.polygonOffsetFactor = -5;
    roadMaterials.campusYellowBorder.polygonOffsetUnits = -5;

  // Ensure road and tile materials render crisply above terrain and courts with no z-fighting
  for (const m of Object.values(roadMaterials)) {
    if (m && m.isMaterial) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -5;
      m.polygonOffsetUnits = -5;
      m.depthTest = true;
    }
  }


  function sampleGroundSurfaceY(x, z) {
    return terrain.height(x, z);
  }

  function getCourtSurfaceY(x, z) {
    if (terrain && terrain.courts) {
      for (const c of terrain.courts) {
        if (c.hidden) continue;
        const rx = x - c.x, rz = z - c.z;
        const rot = c.rotY || 0;
        const cos = rot ? Math.cos(-rot) : 1, sin = rot ? Math.sin(-rot) : 0;
        const lx = rx * cos - rz * sin;
        const lz = rx * sin + rz * cos;
        const hw = c.w / 2;
        const hd = c.d / 2;
        const cr = Math.min(c.r ?? 1.5, Math.max(0.05, hw - 0.05), Math.max(0.05, hd - 0.05));
        const ix = Math.max(0, hw - cr);
        const iz = Math.max(0, hd - cr);
        const dx = Math.max(Math.abs(lx) - ix, 0);
        const dz = Math.max(Math.abs(lz) - iz, 0);
        if (dx * dx + dz * dz <= cr * cr + 0.04) {
          return 0.130;
        }
      }
    }
    return 0;
  }

  function computeTerrainUpwardNormal(x, z, eps = 0.35) {
    const hL = sampleGroundSurfaceY(x - eps, z);
    const hR = sampleGroundSurfaceY(x + eps, z);
    const hD = sampleGroundSurfaceY(x, z - eps);
    const hU = sampleGroundSurfaceY(x, z + eps);
    const nx = (hL - hR) / (2 * eps);
    const nz = (hD - hU) / (2 * eps);
    const ny = 1.0;
    const len = Math.hypot(nx, ny, nz) || 1.0;
    return [nx / len, ny / len, nz / len];
  }

  // =========================================================================
  // 5B. SIMCITY GRID-TILE ROAD ENGINE (100% Terrain-Conforming + Lighter Yellow Borders)
  // =========================================================================
  // Map key: `${gx},${gz}` -> { key, gx, gz, step, type, mesh }
  const gridRoadsMap = new Map();

  function makeTerrainConformingQuad(x0, z0, x1, z1, yOffset, mat, minSubdiv = 4) {
    const spanX = Math.abs(x1 - x0);
    const spanZ = Math.abs(z1 - z0);
    const subdivX = Math.max(minSubdiv, Math.ceil(spanX / 0.32));
    const subdivZ = Math.max(minSubdiv, Math.ceil(spanZ / 0.32));

    const positions = [];
    const normals = [];
    const indices = [];

    for (let iz = 0; iz <= subdivZ; iz++) {
      const vz = z0 + (z1 - z0) * (iz / subdivZ);
      for (let ix = 0; ix <= subdivX; ix++) {
        const vx = x0 + (x1 - x0) * (ix / subdivX);
        const courtElev = getCourtSurfaceY(vx, vz);
        const vy = sampleGroundSurfaceY(vx, vz) + courtElev + yOffset;
        positions.push(vx, vy, vz);
        const [nx, ny, nz] = computeTerrainUpwardNormal(vx, vz);
        normals.push(nx, ny, nz);
      }
    }
    const stride = subdivX + 1;
    for (let iz = 0; iz < subdivZ; iz++) {
      for (let ix = 0; ix < subdivX; ix++) {
        const a = iz * stride + ix;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d); // cả hai tam giác cùng quay mặt lên (tam giác thứ hai trước đây lật úp nên bị tô tối thành ô caro)
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    const uvs = new Float32Array((positions.length / 3) * 2);
    const uvScale = 0.55;
    for (let i = 0; i < positions.length / 3; i++) {
      uvs[i * 2]     = positions[i * 3]     * uvScale;
      uvs[i * 2 + 1] = positions[i * 3 + 2] * uvScale;
    }
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    const m = new T.Mesh(geo, mat);
    m.receiveShadow = true;
    return m;
  }

  function buildGridRoadTileMesh(gx, gz, stepSize = 2.0, type = 'road_yellow') {
    const top = gridRoadsMap.has(`${gx},${gz - 1}`);
    const bottom = gridRoadsMap.has(`${gx},${gz + 1}`);
    const left = gridRoadsMap.has(`${gx - 1},${gz}`);
    const right = gridRoadsMap.has(`${gx + 1},${gz}`);
    const topLeft = gridRoadsMap.has(`${gx - 1},${gz - 1}`);
    const topRight = gridRoadsMap.has(`${gx + 1},${gz - 1}`);
    const bottomLeft = gridRoadsMap.has(`${gx - 1},${gz + 1}`);
    const bottomRight = gridRoadsMap.has(`${gx + 1},${gz + 1}`);

    const cx = gx * stepSize;
    const cz = gz * stepSize;
    // Slight 0.015m overlap eliminates hairline gaps between adjacent tiles on slopes
    const hs = stepSize / 2 + 0.015;

    let baseMat = roadMaterials.campusYellow;
    if (type === 'road_yellow' || type === 'road_walk') baseMat = roadMaterials.campusYellow;
    else if (type === 'road_orange') baseMat = roadMaterials.campusOrange;
    else if (type === 'road_asphalt' || type === 'road_car') baseMat = roadMaterials.asphalt;
    else if (type === 'road_concrete') baseMat = roadMaterials.concrete;
    else if (type === 'road_brick') baseMat = roadMaterials.brickTerracotta;
    else if (type === 'plaza_park') baseMat = roadMaterials.plazaGranite;

    const tileGroup = new T.Group();
    tileGroup.name = `grid_road_${gx}_${gz}`;

    if (type === 'road_yellow' || type === 'road_walk') {
      // 1A. Outer Casing Slab in Lighter Yellow (#f6dfa4) at yOffset = 0.032
      const borderSlab = makeTerrainConformingQuad(cx - hs, cz - hs, cx + hs, cz + hs, 0.072, roadMaterials.campusYellowBorder, 6);
      borderSlab.name = 'walkway_light_yellow_border';
      borderSlab.userData.isWalkwayBorder = true;
      tileGroup.add(borderSlab);

      // 1B. Inner Core Slab in Warm Campus Yellow (#dca658) at yOffset = 0.038 (inset on non-connected sides)
      const cw = Math.min(0.22, Math.max(0.15, stepSize * 0.095));
      const x0 = cx - hs + (left ? 0 : cw);
      const x1 = cx + hs - (right ? 0 : cw);
      const z0 = cz - hs + (top ? 0 : cw);
      const z1 = cz + hs - (bottom ? 0 : cw);
      const coreSlab = makeTerrainConformingQuad(x0, z0, x1, z1, 0.080, roadMaterials.campusYellow, 6);
      coreSlab.name = 'walkway_yellow_core';
      tileGroup.add(coreSlab);

      // 1C. Inner corner border dots when two orthogonal neighbors connect at an L/T/X corner
      if (top && left && !topLeft) {
        const cDot = makeTerrainConformingQuad(cx - hs, cz - hs, cx - hs + cw, cz - hs + cw, 0.040, roadMaterials.campusYellowBorder, 2);
        cDot.userData.isWalkwayBorder = true;
        tileGroup.add(cDot);
      }
      if (top && right && !topRight) {
        const cDot = makeTerrainConformingQuad(cx + hs - cw, cz - hs, cx + hs, cz - hs + cw, 0.040, roadMaterials.campusYellowBorder, 2);
        cDot.userData.isWalkwayBorder = true;
        tileGroup.add(cDot);
      }
      if (bottom && left && !bottomLeft) {
        const cDot = makeTerrainConformingQuad(cx - hs, cz + hs - cw, cx - hs + cw, cz + hs, 0.040, roadMaterials.campusYellowBorder, 2);
        cDot.userData.isWalkwayBorder = true;
        tileGroup.add(cDot);
      }
      if (bottom && right && !bottomRight) {
        const cDot = makeTerrainConformingQuad(cx + hs - cw, cz + hs - cw, cx + hs, cz + hs, 0.040, roadMaterials.campusYellowBorder, 2);
        cDot.userData.isWalkwayBorder = true;
        tileGroup.add(cDot);
      }
    } else {
      // Standard single-surface slab for Orange / Asphalt / Concrete / Brick / Plaza tiles
      const drivable = type === 'road_asphalt' || type === 'road_car';
      const baseSlab = makeTerrainConformingQuad(cx - hs, cz - hs, cx + hs, cz + hs, drivable ? 0.085 : 0.038, baseMat, 6);
      tileGroup.add(baseSlab);
    }

    // 2. Smart Auto-Connecting Road Lane Markings ONLY for Asphalt Car Roads
    if (type === 'road_asphalt' || type === 'road_car') {
      const sw = Math.min(0.09, stepSize * 0.045);
      const stripeY = 0.1;
      const deg = (top ? 1 : 0) + (bottom ? 1 : 0) + (left ? 1 : 0) + (right ? 1 : 0);

      if (deg === 0 || ((top || bottom) && !left && !right)) {
        tileGroup.add(makeTerrainConformingQuad(cx - sw, cz - hs * 0.62, cx + sw, cz + hs * 0.62, stripeY, roadMaterials.asphaltStripe, 3));
      } else if ((left || right) && !top && !bottom) {
        tileGroup.add(makeTerrainConformingQuad(cx - hs * 0.62, cz - sw, cx + hs * 0.62, cz + sw, stripeY, roadMaterials.asphaltStripe, 3));
      } else if (deg === 2) {
        if (top) tileGroup.add(makeTerrainConformingQuad(cx - sw, cz - hs * 0.70, cx + sw, cz + sw, stripeY, roadMaterials.asphaltStripe, 3));
        if (bottom) tileGroup.add(makeTerrainConformingQuad(cx - sw, cz - sw, cx + sw, cz + hs * 0.70, stripeY, roadMaterials.asphaltStripe, 3));
        if (left) tileGroup.add(makeTerrainConformingQuad(cx - hs * 0.70, cz - sw, cx + sw, cz + sw, stripeY, roadMaterials.asphaltStripe, 3));
        if (right) tileGroup.add(makeTerrainConformingQuad(cx - sw, cz - sw, cx + hs * 0.70, cz + sw, stripeY, roadMaterials.asphaltStripe, 3));
      } else if (deg >= 3) {
        // Ô giao lộ (ngã ba / ngã tư): mỗi nhánh nối vào có một vạch qua đường (zebra) nằm sát mép ô, lòng giao lộ để trống
        const z0 = hs * 0.52, z1 = hs * 0.94, bw = hs * 0.07;
        for (const f of [-0.36, -0.12, 0.12, 0.36]) {
          const o = f * hs;
          if (top) tileGroup.add(makeTerrainConformingQuad(cx + o - bw, cz - z1, cx + o + bw, cz - z0, stripeY, roadMaterials.asphaltStripe, 2));
          if (bottom) tileGroup.add(makeTerrainConformingQuad(cx + o - bw, cz + z0, cx + o + bw, cz + z1, stripeY, roadMaterials.asphaltStripe, 2));
          if (left) tileGroup.add(makeTerrainConformingQuad(cx - z1, cz + o - bw, cx - z0, cz + o + bw, stripeY, roadMaterials.asphaltStripe, 2));
          if (right) tileGroup.add(makeTerrainConformingQuad(cx + z0, cz + o - bw, cx + z1, cz + o + bw, stripeY, roadMaterials.asphaltStripe, 2));
        }
      }
    }

    const key = `${gx},${gz}`;
    tileGroup.userData.isGridRoadTile = true;
    tileGroup.userData.tileKey = key;
    tileGroup.userData.gx = gx;
    tileGroup.userData.gz = gz;
    tileGroup.userData.roadType = type;
    tileGroup.traverse(c => {
      if (c.isMesh) {
        c.userData.isGridRoadTile = true;
        c.userData.tileKey = key;
        c.userData.gx = gx;
        c.userData.gz = gz;
      }
    });

      // Set renderOrder according to priority hierarchy (on top of court if on court)
    const isOnCourt = getCourtSurfaceY(cx, cz) > 0;
    const baseRenderOrder = isOnCourt ? 6 : (
      (type === 'plaza_park') ? 5 :
      (type === 'road_asphalt' || type === 'road_car') ? 4 :
      (type === 'road_orange') ? 3 : 2
    );
    tileGroup.traverse(m => {
      if (m.isMesh) {
        m.renderOrder = (m.material === roadMaterials.asphaltStripe) ? (baseRenderOrder + 1) : baseRenderOrder;
      }
    });

    return tileGroup;
  }

  function refreshGridRoadTile(gx, gz) {
    const key = `${gx},${gz}`;
    const entry = gridRoadsMap.get(key);
    if (!entry) return;
    if (entry.mesh) {
      roadsGroup.remove(entry.mesh);
      entry.mesh.traverse(c => { if (c.isMesh) c.geometry?.dispose(); });
    }
    entry.mesh = buildGridRoadTileMesh(entry.gx, entry.gz, entry.step, entry.type);
    roadsGroup.add(entry.mesh);
  }

  function refreshGridRoadNeighbors(gx, gz) {
    refreshGridRoadTile(gx, gz);
    refreshGridRoadTile(gx, gz - 1);
    refreshGridRoadTile(gx, gz + 1);
    refreshGridRoadTile(gx - 1, gz);
    refreshGridRoadTile(gx + 1, gz);
  }

  function placeGridRoadTile(gx, gz, type = activeRoadType, stepSize = gridStep, recordUndo = true) {
        const key = `${gx},${gz}`;
    const existing = gridRoadsMap.get(key);
    if (existing && existing.type === type && existing.step === stepSize) {
      return existing;
    }
    const prevType = existing ? existing.type : null;
    const prevStep = existing ? existing.step : null;

    if (existing && existing.mesh) {
      roadsGroup.remove(existing.mesh);
      existing.mesh.traverse(c => { if (c.isMesh) c.geometry?.dispose(); });
    }

    const newEntry = { key, gx, gz, step: stepSize, type, mesh: null };
    gridRoadsMap.set(key, newEntry);
    refreshGridRoadNeighbors(gx, gz);

    if (recordUndo) {
      pushUndo({
        type: 'grid_road_place',
        undo: () => {
          if (prevType) {
            placeGridRoadTile(gx, gz, prevType, prevStep, false);
          } else {
            removeGridRoadTile(gx, gz, false);
          }
          renderRoadsDynamicList();
          saveStudioState();
        },
        redo: () => {
          placeGridRoadTile(gx, gz, type, stepSize, false);
          renderRoadsDynamicList();
          saveStudioState();
        }
      });
    }

    renderRoadsDynamicList();
    return newEntry;
  }

  function removeGridRoadTile(gx, gz, recordUndo = true) {
    const key = `${gx},${gz}`;
    const existing = gridRoadsMap.get(key);
    if (!existing) return false;
    const oldType = existing.type;
    const oldStep = existing.step;

    if (existing.mesh) {
      roadsGroup.remove(existing.mesh);
      existing.mesh.traverse(c => { if (c.isMesh) c.geometry?.dispose(); });
    }
    gridRoadsMap.delete(key);
    refreshGridRoadNeighbors(gx, gz);

    if (recordUndo) {
      pushUndo({
        type: 'grid_road_remove',
        undo: () => {
          placeGridRoadTile(gx, gz, oldType, oldStep, false);
          renderRoadsDynamicList();
          saveStudioState();
        },
        redo: () => {
          removeGridRoadTile(gx, gz, false);
          renderRoadsDynamicList();
          saveStudioState();
        }
      });
    }

    renderRoadsDynamicList();
    return true;
  }

  // Orthogonal Manhattan line stepping between two grid tiles (so dragging fast never leaves gaps or unconnected diagonals)
  function getOrthogonalTilePath(gx0, gz0, gx1, gz1) {
    const path = [];
    let cx = gx0, cz = gz0;
    path.push([cx, cz]);
    while (cx !== gx1 || cz !== gz1) {
      const dx = gx1 - cx;
      const dz = gz1 - cz;
      if (Math.abs(dx) >= Math.abs(dz) && dx !== 0) {
        cx += Math.sign(dx);
      } else if (dz !== 0) {
        cz += Math.sign(dz);
      }
      path.push([cx, cz]);
    }
    return path;
  }

  // =========================================================================
  // 5C. INTERACTIVE ORANGE COURT BOXES & YELLOW WALKWAYS EDITOR
  // =========================================================================
  const nativeHandlesGroup = new T.Group();
  nativeHandlesGroup.name = 'native-surface-handles';
  nativeHandlesGroup.visible = false;
  scene.add(nativeHandlesGroup);

  const nativeProxyObj = new T.Group();
  nativeProxyObj.name = 'native-transform-proxy';
  scene.add(nativeProxyObj);

  // Smooth 3D Ribbon Groups for ALL existing Campus Yellow Walkways & Orange Courts (Eliminating 100% of ground sawtooth!)
  const nativeWalkwaysGroup = new T.Group();
  nativeWalkwaysGroup.name = 'native_campus_walkways_smooth';
  scene.add(nativeWalkwaysGroup);

  const nativeCourtsSmoothGroup = new T.Group();
  nativeCourtsSmoothGroup.name = 'native_campus_courts_smooth';
  scene.add(nativeCourtsSmoothGroup);

  let selectedNativeCourt = null;
  let selectedNativeWalk = null; // { path, pointIndex }
  let nativeDragStartSnapshot = null;

  function buildSmoothCourtMesh(c) {
    if (!c || c.hidden || c.useGroundTriangles || c.w <= 0.1 || c.d <= 0.1) return null;
    const hw = c.w / 2;
    const hd = c.d / 2;
    const cr = Math.min(c.r ?? 1.5, Math.max(0.05, hw - 0.05), Math.max(0.05, hd - 0.05));

    // Construct clean 2D rounded rectangle shape (zero degenerate corner clamping)
    const roundedRect = grow => {
      const w = hw + grow, d = hd + grow, r = cr + grow;
      const shape = new T.Shape();
      shape.moveTo(-w + r, -d);
      shape.lineTo(w - r, -d);
      shape.absarc(w - r, -d + r, r, -Math.PI / 2, 0, false);
      shape.lineTo(w, d - r);
      shape.absarc(w - r, d - r, r, 0, Math.PI / 2, false);
      shape.lineTo(-w + r, d);
      shape.absarc(-w + r, d - r, r, Math.PI / 2, Math.PI, false);
      shape.lineTo(-w, -d + r);
      shape.absarc(-w + r, -d + r, r, Math.PI, Math.PI * 1.5, false);
      const g = new T.ShapeGeometry(shape, 12);
      g.rotateX(-Math.PI / 2);
      return g;
    };
    const geo = roundedRect(0);

    const rot = c.rotY || 0;
    const cos = rot ? Math.cos(rot) : 1;
    const sin = rot ? Math.sin(rot) : 0;

    // Sân cam là thềm bệ quảng trường phẳng (podium terrace) lấy chuẩn cao độ cao nhất tại tâm
    const centerSurfaceY = sampleGroundSurfaceY(c.x, c.z);
    const courtLevelY = centerSurfaceY + 0.130; // Nổi cao hơn mặt đất & đường vàng, tuyệt đối không bị đồi cỏ đâm xuyên

    const posAttr = geo.attributes.position;
    const normals = [];
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const lz = posAttr.getZ(i);
      const wx = c.x + lx * cos - lz * sin;
      const wz = c.z + lx * sin + lz * cos;
      posAttr.setXYZ(i, wx, courtLevelY, wz);
      normals.push(0, 1, 0);
    }
    geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    posAttr.needsUpdate = true;

    const mesh = new T.Mesh(geo, roadMaterials.campusOrange);
    mesh.receiveShadow = true;
    mesh.renderOrder = 4; // Render above yellow walkways (2) & yellow borders (3)

    // Bó vỉa sáng bao quanh sân (theo ảnh tham chiếu): cùng hình bo góc, nới rộng 0.3, nằm ngay dưới mặt sân
    const curbGeo = roundedRect(0.3);
    const curbPos = curbGeo.attributes.position;
    for (let i = 0; i < curbPos.count; i++) {
      const lx = curbPos.getX(i), lz = curbPos.getZ(i);
      curbPos.setXYZ(i, c.x + lx * cos - lz * sin, courtLevelY - 0.02, c.z + lx * sin + lz * cos);
    }
    curbGeo.computeVertexNormals();
    const curb = new T.Mesh(curbGeo, roadMaterials.campusYellowBorder);
    curb.receiveShadow = true;
    curb.renderOrder = 3;
    curb.name = `smooth_court_curb_${c.id}`;
    curb.userData.isCourtCurb = true; // bó vỉa đi theo sân: không phải vật thể chọn/ủi riêng
    mesh.add(curb);
    // Ghế băng + bồn cây là con của mặt sân: dời / ẩn / ủi sân thì chúng đi theo, bấm vào chúng = bấm vào sân
    const furniture = buildCourtFurniture(c, { roads, terrain, levelY: courtLevelY });
    if (furniture) {
      furniture.userData.isCourtCurb = true;
      mesh.add(furniture);
    }
    mesh.name = `smooth_court_${c.id}`;
    mesh.userData.isSmoothCourtMesh = true;
    mesh.userData.courtId = c.id;
    return mesh;
  }

  function rebuildNativeWalkwaysAndCourtsMeshes() {
    nativeCourtsSmoothGroup.visible = true;
    nativeWalkwaysGroup.visible = true;
    while (nativeCourtsSmoothGroup.children.length > 0) {
      const ch = nativeCourtsSmoothGroup.children.pop();
      ch.traverse(o => { if (o.isMesh) o.geometry?.dispose(); });
    }
    if (terrain && terrain.courts) {
      for (const c of terrain.courts) {
        if (c.hidden) continue;
        const cm = buildSmoothCourtMesh(c);
        if (cm) nativeCourtsSmoothGroup.add(cm);
        else if (c.useGroundTriangles) {
          // Sân sơn thẳng lên địa hình không có mesh riêng: đồ đạc bám cao độ mặt đất, không phải vật thể chọn/ủi
          const furniture = buildCourtFurniture(c, { roads, terrain, sampleY: (x, z) => sampleGroundSurfaceY(x, z) + 0.02 });
          if (furniture) { furniture.raycast = () => {}; nativeCourtsSmoothGroup.add(furniture); }
        }
      }
    }

    while (nativeWalkwaysGroup.children.length > 0) {
      const ch = nativeWalkwaysGroup.children.pop();
      ch.traverse(o => { if (o.isMesh) o.geometry?.dispose(); });
    }
    if (roads && roads.paths) {
      for (const p of roads.paths) {
        if (p.hidden || p.class !== 1 || p.isCustomRoad || !p.points || p.points.length < 2) continue;
        const wm = generateRoadMesh(p.points, p.width || 2.0, 'road_yellow', {
          clipObstacles: true,
          isNativeWalk: true,
          walkId: p.id
        });
        if (wm) {
          wm.name = `native_walk_${p.id}`;
          wm.userData.isNativeWalkMesh = true;
          wm.userData.walkId = p.id;
          nativeWalkwaysGroup.add(wm);
        }
      }
    }
  }

  function rebuildTerrainSurfaces() {
    if (terrain && typeof terrain.rebuild === 'function' && roads && roads.paths) {
      for (const p of roads.paths) {
        if (p.points && p.points.length >= 2 && p.class === 1) {
          p.curve = new T.CatmullRomCurve3(
            p.points.map(pt => new T.Vector3(pt[0], 0, pt[1])),
            false,
            'centripetal'
          );
        }
      }
      terrain.rebuild(roads.paths);
    }
    rebuildNativeWalkwaysAndCourtsMeshes();
    rebuildNativeSurfaceHandles();
    renderRoadsDynamicList();
    if (router && typeof router.rebuild === 'function' && roads && roads.paths) {
      router.rebuild(roads.paths, terrain.surfaceHeight || terrain.height);
    }
    if (network && typeof network.rebuild === 'function') {
      network.rebuild();
    }
    if (typeof window.rebuildCirculationNetwork === 'function') {
      window.rebuildCirculationNetwork();
    }
    scene.traverse(o => {
      if (o.name === 'hq-arrival-stair-terrace' || o.parent?.name === 'hq-arrival-stair-terrace') {
        o.visible = false;
        o.parent?.remove(o);
      }
    });
  }

  function findNativeSurfaceAtPoint(x, z) {
    // 1. Check Yellow Walkways (roads.paths where class === 1)
    if (roads && roads.paths) {
      let bestWalk = null;
      let bestDist = Infinity;
      for (const p of roads.paths) {
        if (p.hidden || p.class !== 1 || !p.curve) continue;
        const steps = Math.max(12, Math.ceil(p.curve.getLength() * 2));
        for (let i = 0; i <= steps; i++) {
          const q = p.curve.getPointAt(i / steps);
          const d = Math.hypot(q.x - x, q.z - z);
          if (d <= (p.width || 2) / 2 + 0.55 && d < bestDist) {
            bestDist = d;
            bestWalk = p;
          }
        }
      }
      if (bestWalk && bestWalk.points && bestWalk.points.length > 0) {
        let nearestIdx = 0;
        let minPtDist = Infinity;
        bestWalk.points.forEach((pt, idx) => {
          const d = Math.hypot(pt[0] - x, pt[1] - z);
          if (d < minPtDist) {
            minPtDist = d;
            nearestIdx = idx;
          }
        });
        return { kind: 'walk', path: bestWalk, pointIndex: nearestIdx };
      }
    }

    // 2. Check Orange Court Boxes (terrain.courts)
    if (terrain && terrain.courts) {
      for (let i = terrain.courts.length - 1; i >= 0; i--) {
        const c = terrain.courts[i];
        if (c.hidden) continue;
        const rx = x - c.x, rz = z - c.z;
        const rot = c.rotY || 0;
        const cos = rot ? Math.cos(-rot) : 1, sin = rot ? Math.sin(-rot) : 0;
        const lx = rx * cos - rz * sin;
        const lz = rx * sin + rz * cos;
        if (Math.abs(lx) <= c.w / 2 + 0.3 && Math.abs(lz) <= c.d / 2 + 0.3) {
          return { kind: 'court', court: c };
        }
      }
    }
    return null;
  }

  function findHandleNearScreenPoint(clientX, clientY, maxPixelDist = 28) {
    if (!nativeHandlesGroup || !nativeHandlesGroup.visible) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    let best = null;
    let bestDist = maxPixelDist;

    // 1. Check all yellow spheres first (highest priority)
    nativeHandlesGroup.traverse(obj => {
      if (obj.userData?.isNativeWalkHandle && obj.userData?.walkRef) {
        const p3 = obj.position.clone().project(camera);
        if (p3.z >= -1 && p3.z <= 1) {
          const sx = ((p3.x + 1) / 2) * rect.width + rect.left;
          const sy = ((-p3.y + 1) / 2) * rect.height + rect.top;
          const dist = Math.hypot(clientX - sx, clientY - sy);
          if (dist < bestDist) {
            bestDist = dist;
            best = {
              kind: 'walk',
              walkRef: obj.userData.walkRef,
              pointIndex: obj.userData.pointIndex
            };
          }
        }
      }
    });

    if (best) return best;

    // 2. Check orange court center box handles
    nativeHandlesGroup.traverse(obj => {
      if (obj.userData?.isNativeCourtHandle && obj.userData?.courtRef && obj.isMesh && obj.geometry?.type === 'BoxGeometry') {
        const p3 = new T.Vector3();
        obj.getWorldPosition(p3);
        p3.project(camera);
        if (p3.z >= -1 && p3.z <= 1) {
          const sx = ((p3.x + 1) / 2) * rect.width + rect.left;
          const sy = ((-p3.y + 1) / 2) * rect.height + rect.top;
          const dist = Math.hypot(clientX - sx, clientY - sy);
          if (dist < bestDist) {
            bestDist = dist;
            best = {
              kind: 'court',
              courtRef: obj.userData.courtRef
            };
          }
        }
      }
    });

    return best;
  }

  function rebuildNativeSurfaceHandles() {
    while (nativeHandlesGroup.children.length > 0) {
      const ch = nativeHandlesGroup.children.pop();
      ch.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    }

    // 1. Build 3D frames & center handles for all active Orange Courts (terrain.courts)
    if (terrain && terrain.courts) {
      for (const c of terrain.courts) {
        if (c.hidden) continue;
        const isSel = selectedNativeCourt === c;
        const cy = terrain.height(c.x, c.z) + 0.16;
        const grp = new T.Group();
        grp.position.set(c.x, cy, c.z);
        grp.rotation.y = c.rotY || 0;

        // Clickable semi-transparent orange pad
        const padGeo = new T.PlaneGeometry(c.w, c.d);
        padGeo.rotateX(-Math.PI / 2);
        const padMat = new T.MeshBasicMaterial({
          color: isSel ? 0xfbbf24 : 0xf97316,
          transparent: true,
          opacity: isSel ? 0.32 : 0.14,
          side: T.DoubleSide,
          depthWrite: false
        });
        const padMesh = new T.Mesh(padGeo, padMat);
        padMesh.userData.isNativeCourtHandle = true;
        padMesh.userData.courtRef = c;
        grp.add(padMesh);

        // Crisp border outline (disable raycasting on lines so they never intercept clicks)
        const hw = c.w / 2, hd = c.d / 2;
        const bPts = [
          new T.Vector3(-hw, 0.04, -hd),
          new T.Vector3(hw, 0.04, -hd),
          new T.Vector3(hw, 0.04, hd),
          new T.Vector3(-hw, 0.04, hd),
          new T.Vector3(-hw, 0.04, -hd)
        ];
        const bGeo = new T.BufferGeometry().setFromPoints(bPts);
        const bMat = new T.LineBasicMaterial({ color: isSel ? 0xffffff : 0xfed7aa, depthWrite: false });
        const bLine = new T.Line(bGeo, bMat);
        bLine.raycast = () => {};
        grp.add(bLine);

        // Center Orange Box Handle - 50% smaller (0.55m x 0.30m x 0.55m)
        const centerGeo = new T.BoxGeometry(0.55, 0.30, 0.55);
        const centerMat = new T.MeshBasicMaterial({ color: isSel ? 0x10b981 : 0xea580c });
        const centerHandle = new T.Mesh(centerGeo, centerMat);
        centerHandle.position.y = 0.2;
        centerHandle.userData.isNativeCourtHandle = true;
        centerHandle.userData.courtRef = c;
        grp.add(centerHandle);

        grp.userData.isNativeCourtHandle = true;
        grp.userData.courtRef = c;
        nativeHandlesGroup.add(grp);
      }
    }

    // 2. Build Yellow Sphere Handles & guide lines for all active Yellow Walkways (roads.paths where class === 1)
    if (roads && roads.paths) {
      for (const p of roads.paths) {
        if (p.hidden || p.class !== 1 || !p.points || p.points.length < 2) continue;
        const isWalkSel = selectedNativeWalk && selectedNativeWalk.path === p;

        // Guide line (disable raycasting on guide line)
        const linePts = p.points.map(pt => new T.Vector3(pt[0], terrain.height(pt[0], pt[1]) + 0.22, pt[1]));
        const lGeo = new T.BufferGeometry().setFromPoints(linePts);
        const lMat = new T.LineBasicMaterial({ color: isWalkSel ? 0xffffff : 0xfde047, depthWrite: false });
        const guideLine = new T.Line(lGeo, lMat);
        guideLine.raycast = () => {};
        nativeHandlesGroup.add(guideLine);

        // Control point spheres - 50% SMALLER (radius 0.32m, selected 0.45m - fits cleanly inside 1m grid cell!)
        p.points.forEach((pt, idx) => {
          // If this is a building door connector, skip index 0 (the anchor inside the building door) so rooftop is not cluttered
          if (p.id && p.id.startsWith('door:') && idx === 0) return;

          const isPtSel = isWalkSel && selectedNativeWalk.pointIndex === idx;
          const spRadius = isPtSel ? 0.45 : 0.32;
          const spGeo = new T.SphereGeometry(spRadius, 16, 16);
          const spMat = new T.MeshBasicMaterial({ color: isPtSel ? 0x10b981 : 0xfacc15, depthTest: false });
          const sp = new T.Mesh(spGeo, spMat);
          const handleBaseY = (typeof sampleGroundSurfaceY === 'function') ? sampleGroundSurfaceY(pt[0], pt[1]) : terrain.height(pt[0], pt[1]);
          sp.position.set(pt[0], handleBaseY + 0.45, pt[1]);
          sp.renderOrder = 9999;
          sp.userData.isNativeWalkHandle = true;
          sp.userData.walkRef = p;
          sp.userData.pointIndex = idx;
          nativeHandlesGroup.add(sp);
        });
      }
    }
  }

  function syncNativeSurfaceUI() {
    const statusEl = document.querySelector('#native-target-status');
    const courtBox = document.querySelector('#native-court-controls');
    const walkBox = document.querySelector('#native-walk-controls');

    if (selectedNativeCourt) {
      const c = selectedNativeCourt;
      if (statusEl) {
        statusEl.innerHTML = `🟠 Đang chọn Hộp Cam: <b>${c.id}</b> [${c.x.toFixed(1)}, ${c.z.toFixed(1)}]`;
      }
      if (courtBox) courtBox.hidden = false;
      if (walkBox) walkBox.hidden = true;

      const lblW = document.querySelector('#lbl-court-w');
      const rngW = document.querySelector('#rng-court-w');
      const inpW = document.querySelector('#inp-court-w');
      if (lblW) lblW.textContent = `${Number(c.w).toFixed(1)}m`;
      if (rngW && document.activeElement !== rngW) rngW.value = c.w;
      if (inpW && document.activeElement !== inpW) inpW.value = c.w;

      const lblD = document.querySelector('#lbl-court-d');
      const rngD = document.querySelector('#rng-court-d');
      const inpD = document.querySelector('#inp-court-d');
      if (lblD) lblD.textContent = `${Number(c.d).toFixed(1)}m`;
      if (rngD && document.activeElement !== rngD) rngD.value = c.d;
      if (inpD && document.activeElement !== inpD) inpD.value = c.d;

      const lblR = document.querySelector('#lbl-court-r');
      const rngR = document.querySelector('#rng-court-r');
      const cr = c.r !== undefined ? c.r : 1.5;
      if (lblR) lblR.textContent = `${Number(cr).toFixed(1)}m`;
      if (rngR && document.activeElement !== rngR) rngR.value = cr;

      const lblRot = document.querySelector('#lbl-court-rot');
      const deg = Math.round(((c.rotY || 0) * 180) / Math.PI) % 360;
      if (lblRot) lblRot.textContent = `${deg}°`;
    } else if (selectedNativeWalk) {
      const { path, pointIndex } = selectedNativeWalk;
      const pt = path.points[pointIndex] || [0, 0];
      if (statusEl) {
        statusEl.innerHTML = `🟡 Đang chọn Đường Vàng: <b>${path.id}</b> (Mốc #${pointIndex + 1}: [${pt[0].toFixed(1)}, ${pt[1].toFixed(1)}])`;
      }
      if (courtBox) courtBox.hidden = true;
      if (walkBox) walkBox.hidden = false;

      const lblW = document.querySelector('#lbl-walk-w');
      const rngW = document.querySelector('#rng-walk-w');
      const w = path.width || 2.0;
      if (lblW) lblW.textContent = `${Number(w).toFixed(1)}m`;
      if (rngW && document.activeElement !== rngW) rngW.value = w;
    } else {
      if (statusEl) {
        statusEl.innerHTML = '👉 Click vào <b>Hộp màu cam (🟠)</b> hoặc <b>Nút tròn màu vàng (🟡)</b> trên mặt đất để kéo dời / chỉnh kích thước!';
      }
      if (courtBox) courtBox.hidden = true;
      if (walkBox) walkBox.hidden = true;
    }
  }

  function selectNativeCourt(courtObj) {
    setTimeout(updateSelectTargetInfoUI, 10);
    if (!courtObj) return null;
    selectedNativeCourt = courtObj;
    selectedNativeWalk = null;

    nativeProxyObj.position.set(courtObj.x, terrain.height(courtObj.x, courtObj.z) + 0.2, courtObj.z);
    nativeProxyObj.rotation.set(0, courtObj.rotY || 0, 0);
    nativeProxyObj.userData.isNativeCourtProxy = true;
    nativeProxyObj.userData.isNativeWalkPointProxy = false;

    selectedObject = nativeProxyObj;
    transformControls.attach(nativeProxyObj);
    transformControls.setMode('translate');
    transformControls.showX = true;
    transformControls.showZ = true;
    transformControls.showY = false;
    helper.visible = true;

    nativeHandlesGroup.visible = true;
    rebuildNativeSurfaceHandles();
    syncNativeSurfaceUI();
    showToast(`🟠 Đã chọn Hộp màu cam: ${courtObj.id} (Kéo mũi tên Đỏ/Xanh để dời vị trí!)`, '#ea580c');
    return courtObj;
  }

  function selectNativeWalkPoint(walkPath, pointIndex = 0) {
    if (!walkPath || !walkPath.points || !walkPath.points[pointIndex]) return null;
    selectedNativeWalk = { path: walkPath, pointIndex };
    selectedNativeCourt = null;

    const pt = walkPath.points[pointIndex];
    nativeProxyObj.position.set(pt[0], terrain.height(pt[0], pt[1]) + 0.25, pt[1]);
    nativeProxyObj.rotation.set(0, 0, 0);
    nativeProxyObj.userData.isNativeCourtProxy = false;
    nativeProxyObj.userData.isNativeWalkPointProxy = true;

    selectedObject = nativeProxyObj;
    transformControls.attach(nativeProxyObj);
    transformControls.setMode('translate');
    transformControls.showX = true;
    transformControls.showZ = true;
    transformControls.showY = false;
    helper.visible = true;

    nativeHandlesGroup.visible = true;
    rebuildNativeSurfaceHandles();
    syncNativeSurfaceUI();
    showToast(`🟡 Đã chọn Mốc #${pointIndex + 1} của Đường vàng (${walkPath.id}) — Kéo mũi tên để uốn đường!`, '#ca8a04');
    return selectedNativeWalk;
  }

  function addRoadControlPoint(point) {
    // Use smooth exact coordinates in curved road mode so closely-spaced clicks never collapse onto the same grid corner
    // Always snap road control points / nodes to the exact center of 1m grid cell
    const snapX = Math.floor(point.x) + 0.5;
    const snapZ = Math.floor(point.z) + 0.5;
    const pt = [snapX, snapZ];
    if (currentRoadPoints.length > 0) {
      const prev = currentRoadPoints[currentRoadPoints.length - 1];
      if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) < 0.35) {
        return prev;
      }
    }
    currentRoadPoints.push(pt);

    const handleGeo = new T.SphereGeometry(0.48, 14, 14);
    const isYellow = activeRoadType === 'road_yellow' || activeRoadType === 'road_walk';
    const handleMat = new T.MeshBasicMaterial({ color: isYellow ? 0xfacc15 : 0x0284c7 });
    const handle = new T.Mesh(handleGeo, handleMat);
    handle.position.set(pt[0], sampleGroundSurfaceY(pt[0], pt[1]) + 0.45, pt[1]);
    handle.userData.isRoadHandle = true;
    handle.userData.pointIndex = currentRoadPoints.length - 1;
    scene.add(handle);
    currentControlHandles.push(handle);
    clickable.push(handle);

    rebuildCurrentRoadPreview();
    const ptCountEl = document.querySelector('#road-points-count');
    if (ptCountEl) {
      ptCountEl.innerHTML = `📍 Đã chấm <b>${currentRoadPoints.length} điểm</b>. Click tiếp để uốn đường, hoặc bấm 'Hoàn tất' (Enter)!`;
    }
    const btnFinish = document.querySelector('#btn-finish-road');
    if (btnFinish) {
      btnFinish.textContent = `✅ Hoàn tất (${currentRoadPoints.length} điểm) [Enter]`;
    }
    return pt;
  }

  function undoLastRoadPoint() {
    if (currentRoadPoints.length === 0) {
      showToast('Không còn điểm mốc nào để lùi!', '#64748b');
      return false;
    }
    currentRoadPoints.pop();
    const lastHandle = currentControlHandles.pop();
    if (lastHandle) {
      scene.remove(lastHandle);
      const idx = clickable.indexOf(lastHandle);
      if (idx > -1) clickable.splice(idx, 1);
    }
    rebuildCurrentRoadPreview();
    const ptCountEl = document.querySelector('#road-points-count');
    if (ptCountEl) {
      ptCountEl.innerHTML = currentRoadPoints.length > 0
        ? `📍 Đã lùi 1 điểm (còn <b>${currentRoadPoints.length} điểm</b>). Click tiếp hoặc bấm Hoàn tất!`
        : '• Đã xóa hết điểm. Click xuống đất để chấm điểm bắt đầu đường cong!';
    }
    const btnFinish = document.querySelector('#btn-finish-road');
    if (btnFinish) {
      btnFinish.textContent = currentRoadPoints.length > 0
        ? `✅ Hoàn tất (${currentRoadPoints.length} điểm) [Enter]`
        : '✅ Hoàn tất [Enter]';
    }
    showToast('↩️ Đã lùi 1 điểm vẽ đường cong', '#0284c7');
    return true;
  }

  function shouldClipNativeWalkwayQuad(x, z) {
    // 1. Do not draw yellow walkway over the 3D grey HQ Arrival Stair steps (width=5.0 => x in [-2.48, 2.48], z in [10.02, 14.98])
    if (Math.abs(x) <= 2.48 && z >= 10.02 && z <= 14.98) return true;
    // 2. Do not draw yellow walkway inside the U-turn asphalt road (tucks cleanly under outer cream sidewalk at r=2.95m)
    if (z >= 15.45 && z <= 31.85 && Math.abs(x) <= 11.5) {
      const uRoad = roads && roads.paths ? roads.paths.find(p => p.id === 'road:HQ-arrival' || p.class === 2) : null;
      if (uRoad && uRoad.curve) {
        let minDist = Infinity;
        const steps = 48;
        for (let i = 0; i <= steps; i++) {
          const q = uRoad.curve.getPointAt(i / steps);
          const d = Math.hypot(q.x - x, q.z - z);
          if (d < minDist) minDist = d;
        }
        if (minDist <= 2.85) return true;
      }
    }
    return false;
  }

  // Lọc điểm trùng và tách polyline tại các khúc quay đầu gấp: dùng chung cho mesh mặt đường và vạch kẻ đường
  function splitRoadChains(points) {
    if (!points || points.length < 2) return null;
    // 1. Deduplicate consecutive points
    const cleanPts = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = cleanPts[cleanPts.length - 1];
      if (Math.hypot(points[i][0] - prev[0], points[i][1] - prev[1]) >= 0.12) {
        cleanPts.push(points[i]);
      }
    }
    if (cleanPts.length < 2) return null;

    // 2. Split polyline at sharp hairpin reversals (dot < -0.30)
    const rawChains = [];
    let currentChain = [cleanPts[0]];
    for (let i = 1; i < cleanPts.length; i++) {
      currentChain.push(cleanPts[i]);
      if (i < cleanPts.length - 1) {
        const p0 = cleanPts[i - 1];
        const p1 = cleanPts[i];
        const p2 = cleanPts[i + 1];
        const dx1 = p1[0] - p0[0], dz1 = p1[1] - p0[1];
        const dx2 = p2[0] - p1[0], dz2 = p2[1] - p1[1];
        const l1 = Math.hypot(dx1, dz1) || 1;
        const l2 = Math.hypot(dx2, dz2) || 1;
        const dot = (dx1 * dx2 + dz1 * dz2) / (l1 * l2);
        if (dot < -0.30) {
          rawChains.push(currentChain);
          currentChain = [cleanPts[i]];
        }
      }
    }
    if (currentChain.length >= 2) rawChains.push(currentChain);
    if (rawChains.length === 0) return null;
    return { cleanPts, rawChains };

  }

    // Seamless rounded end cap for walkway ribbon
    // =========================================================================
  // ULTRA-CLEAN SINGLE-MESH ROAD & WALKWAY GENERATOR (ZERO-Z-FIGHTING)
  // - 1 single BufferGeometry with vertex colors
  // - 100% CCW upward normals: Tri 1 (p00, p01, p10), Tri 2 (p01, p11, p10)
  // - Crisp borders with shared edge coordinates (zero gap, zero tearing)
  // - Zero brown spots / zero overlapping disks or rings
  // =========================================================================
  function generateRoadMesh(points, width, type = 'road_yellow', options = {}) {
    if (!points || points.length < 2) return null;
    const isYellowWalk = type === 'road_yellow' || type === 'road_walk';

    const chains = splitRoadChains(points);
    if (!chains) return null;
    const { cleanPts, rawChains } = chains;

    // 3. Setup styling and dimensions
    const roadW = Math.max(0.6, width || 2.0);
    const halfW = roadW / 2;
    const roadYOffset = 0.080; // Safe elevation above terrain triangles (zero z-fighting)

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    const stripePositions = [];
    const stripeNormals = [];
    const stripeIndices = [];

    const cols = 4; // 4 lateral segments across width for smooth terrain drape

    for (const chain of rawChains) {
      const curvePoints = chain.map(p => new T.Vector3(p[0], 0, p[1]));
      const curve = new T.CatmullRomCurve3(curvePoints, false, 'centripetal');
      const totalLen = curve.getLength();
      if (totalLen < 0.12) continue;

      const segments = Math.max(24, Math.ceil(totalLen / 0.16));

      const centerPts = [];
      const rawTangents = [];
      for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        centerPts.push(curve.getPointAt(u));
        const t = curve.getTangentAt(u);
        t.y = 0;
        if (t.lengthSq() < 1e-6) t.set(0, 0, 1);
        else t.normalize();
        rawTangents.push(t);
      }

      // 5-point moving average smoothing for silky tangents
      const smoothTangents = [];
      for (let i = 0; i <= segments; i++) {
        const sum = new T.Vector3();
        for (let k = -2; k <= 2; k++) {
          const idx = Math.max(0, Math.min(segments, i + k));
          sum.add(rawTangents[idx]);
        }
        if (sum.lengthSq() < 1e-6) sum.copy(rawTangents[i]);
        else sum.normalize();
        smoothTangents.push(sum);
      }

      const baseVertex = positions.length / 3;

      for (let i = 0; i <= segments; i++) {
        const pt = centerPts[i];
        const tan = smoothTangents[i];
        const norm = new T.Vector3(-tan.z, 0, tan.x).normalize();

        for (let j = 0; j <= cols; j++) {
          const frac = j / cols;
          const w = -halfW + roadW * frac;
          const vx = pt.x + norm.x * w;
          const vz = pt.z + norm.z * w;
          const vy = sampleGroundSurfaceY(vx, vz) + roadYOffset;
          positions.push(vx, vy, vz);
          const [nx, ny, nz] = computeTerrainUpwardNormal(vx, vz);
          normals.push(nx, ny, nz);
          uvs.push(frac, (i / segments) * Math.max(1, totalLen / 2));
        }

        if (i < segments) {
          const row0 = baseVertex + i * (cols + 1);
          const row1 = baseVertex + (i + 1) * (cols + 1);
          for (let j = 0; j < cols; j++) {
            const p00 = row0 + j;
            const p01 = row0 + j + 1;
            const p10 = row1 + j;
            const p11 = row1 + j + 1;
            // CCW upward normal winding:
            indices.push(p00, p01, p10);
            indices.push(p01, p11, p10);
          }
        }
      }

      // Asphalt center dashed stripe
      if (type === 'road_asphalt' || type === 'road_car') {
        const stripeBase = stripePositions.length / 3;
        const stripeW = 0.10;
        for (let i = 0; i <= segments; i++) {
          const pt = centerPts[i];
          const tan = smoothTangents[i];
          const norm = new T.Vector3(-tan.z, 0, tan.x).normalize();

          const sRight = pt.clone().addScaledVector(norm, -stripeW);
          const sLeft = pt.clone().addScaledVector(norm, stripeW);
          const yR = sampleGroundSurfaceY(sRight.x, sRight.z) + roadYOffset + 0.008;
          const yL = sampleGroundSurfaceY(sLeft.x, sLeft.z) + roadYOffset + 0.008;

          stripePositions.push(sRight.x, yR, sRight.z);
          stripePositions.push(sLeft.x, yL, sLeft.z);
          const [nx, ny, nz] = computeTerrainUpwardNormal(pt.x, pt.z);
          stripeNormals.push(nx, ny, nz, nx, ny, nz);

          if (i < segments) {
            const b = stripeBase + i * 2;
            stripeIndices.push(b, b + 1, b + 2);
            stripeIndices.push(b + 1, b + 3, b + 2);
          }
        }
      }
    }

    if (indices.length === 0) return null;

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    // Select rich, warm, authentic campus material directly (No vertex-color washing out!)
    let mat = roadMaterials.campusYellow;
    if (isYellowWalk) mat = roadMaterials.campusYellow;
    else if (type === 'road_orange') mat = roadMaterials.campusOrange;
    else if (type === 'road_asphalt' || type === 'road_car') mat = roadMaterials.asphalt;
    else if (type === 'road_concrete') mat = roadMaterials.concrete;
    else if (type === 'road_brick') mat = roadMaterials.brickTerracotta;
    else if (type === 'plaza_park') mat = roadMaterials.plazaGranite;

    const mesh = new T.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2; // Render above terrain (0) and borders (1)
    mesh.name = 'custom_road_' + Date.now();
    mesh.userData.roadPoints = cleanPts;
    mesh.userData.roadType = type;
    mesh.userData.roadWidth = width;

    if ((type === 'road_asphalt' || type === 'road_car') && stripeIndices.length > 0) {
      const sGeo = new T.BufferGeometry();
      sGeo.setAttribute('position', new T.Float32BufferAttribute(stripePositions, 3));
      sGeo.setAttribute('normal', new T.Float32BufferAttribute(stripeNormals, 3));
      sGeo.setIndex(stripeIndices);
      const stripeMesh = new T.Mesh(sGeo, roadMaterials.roadMarking || roadMaterials.asphaltStripe);
      stripeMesh.receiveShadow = true;
      stripeMesh.renderOrder = 4; // Render above road base (2)
      stripeMesh.name = 'road_lane_stripes';
      mesh.add(stripeMesh);
    }

    return mesh;
  }

  function rebuildCurrentRoadPreview() {
    if (currentRoadMesh) {
      roadsGroup.remove(currentRoadMesh);
      currentRoadMesh.geometry?.dispose();
      currentRoadMesh = null;
    }

    if (currentRoadPoints.length < 2) return;

    const width = ROAD_WIDTH_PRESETS[activeRoadType] || customRoadWidth || 2.0;
    currentRoadMesh = generateRoadMesh(currentRoadPoints, width, activeRoadType);
    if (currentRoadMesh) {
      roadsGroup.add(currentRoadMesh);
    }
  }

  function finishCurrentRoad() {
    if (currentRoadPoints.length < 2) {
      alert('Cần ít nhất 2 điểm để tạo đường!');
      return null;
    }

    const roadWidth = ROAD_WIDTH_PRESETS[activeRoadType] || customRoadWidth || 2.0;
    const ptsCopy = currentRoadPoints.map(p => [p[0], p[1]]);
    const roadRecord = {
      id: `road_${Date.now()}`,
      name: (activeRoadType === 'road_asphalt' || activeRoadType === 'road_car') ? 'Đường xe chạy' : 'Đường đi bộ vàng',
      type: activeRoadType,
      width: roadWidth,
      points: ptsCopy,
      mesh: currentRoadMesh
    };
    customRoadsList.push(roadRecord);

    // Also register in roads.paths (marked isCustomRoad: true so nativeWalkwaysGroup doesn't duplicate it)
    if (roads && roads.paths && ptsCopy.length >= 2) {
      const curve = new T.CatmullRomCurve3(ptsCopy.map(p => new T.Vector3(p[0], 0, p[1])), false, 'centripetal');
      const matKind = (activeRoadType === 'road_asphalt' || activeRoadType === 'road_car') ? 1
        : (activeRoadType === 'road_orange' || activeRoadType === 'road_brick') ? 3
        : (activeRoadType === 'plaza_park' || activeRoadType === 'road_concrete') ? 4 : 2;
      roads.paths.push({
        id: roadRecord.id,
        points: ptsCopy,
        width: roadWidth,
        class: matKind === 2 ? 1 : 2,
        materialKind: matKind,
        isCustomRoad: true,
        hidden: false,
        curve
      });
      terrain.rebuild(roads.paths);
    }

    for (const h of currentControlHandles) {
      scene.remove(h);
      const idx = clickable.indexOf(h);
      if (idx > -1) clickable.splice(idx, 1);
    }
    currentControlHandles = [];
    currentRoadPoints = [];
    currentRoadMesh = null;

    // The path registered in roads.paths goes with the road on undo / redo, as in deleteCustomRoad
    const createdPath = roads?.paths?.find(p => p.id === roadRecord.id) || null;
    const setCreatedPath = attached => {
      if (!createdPath) return;
      const pIdx = roads.paths.indexOf(createdPath);
      if (attached && pIdx === -1) roads.paths.push(createdPath);
      else if (!attached && pIdx > -1) roads.paths.splice(pIdx, 1);
      else return;
      terrain.rebuild(roads.paths);
    };
    pushUndo({
      type: 'road_create',
      undo: () => {
        const rIdx = customRoadsList.findIndex(r => r.id === roadRecord.id);
        if (rIdx > -1) {
          const r = customRoadsList.splice(rIdx, 1)[0];
          if (r.mesh) roadsGroup.remove(r.mesh);
        }
        setCreatedPath(false);
        updateHierarchyUI();
        saveStudioState();
      },
      redo: () => {
        if (roadRecord.mesh) roadsGroup.add(roadRecord.mesh);
        if (!customRoadsList.includes(roadRecord)) customRoadsList.push(roadRecord);
        setCreatedPath(true);
        updateHierarchyUI();
        saveStudioState();
      }
    });

    if (roadRecord.mesh) {
      roadRecord.mesh.userData.isCustomRoad = true;
      roadRecord.mesh.userData.roadId = roadRecord.id;
      clickable.push(roadRecord.mesh);
    }
    const ptCountEl = document.querySelector('#road-points-count');
    if (ptCountEl) ptCountEl.textContent = '• Đã hoàn tất! Click xuống đất để vẽ tuyến đường tiếp theo.';
    const btnFinish = document.querySelector('#btn-finish-road');
    if (btnFinish) btnFinish.textContent = '✅ Hoàn tất đường [Enter]';
    selectCustomRoad(roadRecord.id);
    renderRoadsDynamicList();
    showToast('✅ Đã tạo xong đường!', '#059669');
    updateHierarchyUI();
    return roadRecord;
  }

  function refreshAllRoadsOnTerrainChange() {
    for (const [key, entry] of gridRoadsMap) {
      refreshGridRoadTile(entry.gx, entry.gz);
    }
    for (const r of customRoadsList) {
      if (r.mesh) {
        roadsGroup.remove(r.mesh);
        r.mesh.traverse(o => { if (o.isMesh) o.geometry?.dispose(); });
      }
      r.mesh = generateRoadMesh(r.points, r.width, r.type);
      if (r.mesh) {
        r.mesh.userData.isCustomRoad = true;
        r.mesh.userData.roadId = r.id;
        roadsGroup.add(r.mesh);
      }
    }
    rebuildNativeWalkwaysAndCourtsMeshes();
    syncRoadMarkings(true);
  }

  // Dựng lại mesh của một tuyến tự vẽ sau khi points đổi (ủi một khúc, undo)
  function updateCustomRoadMesh(r) {
    const clickIdx = r.mesh ? clickable.indexOf(r.mesh) : -1;
    if (r.mesh) {
      roadsGroup.remove(r.mesh);
      r.mesh.traverse(o => { if (o.isMesh) o.geometry?.dispose(); });
    }
    r.mesh = generateRoadMesh(r.points, r.width, r.type);
    if (r.mesh) {
      r.mesh.userData.isCustomRoad = true;
      r.mesh.userData.roadId = r.id;
      roadsGroup.add(r.mesh);
    }
    if (clickIdx > -1) {
      if (r.mesh) clickable[clickIdx] = r.mesh;
      else clickable.splice(clickIdx, 1);
    }
    if (!customRoadsList.includes(r)) customRoadsList.push(r);
    const path = roads?.paths?.find(x => x.id === r.id);
    if (path) {
      path.points = r.points.map(pt => [...pt]);
      path.curve = new T.CatmullRomCurve3(path.points.map(pt => new T.Vector3(pt[0], 0, pt[1])), false, 'centripetal');
      terrain.rebuild(roads.paths);
    }
    updateHierarchyUI();
  }

  // Gắn / gỡ một tuyến tự vẽ khỏi scene và danh sách (dùng cho undo/redo, không ghi thêm mục undo)
  function setCustomRoadAttached(rec, attached) {
    const k = customRoadsList.indexOf(rec);
    if (attached) {
      if (k === -1) customRoadsList.push(rec);
      if (rec.mesh) roadsGroup.add(rec.mesh);
    } else {
      if (k > -1) customRoadsList.splice(k, 1);
      if (rec.mesh) roadsGroup.remove(rec.mesh);
    }
    if (rec.path && roads?.paths) {
      const pIdx = roads.paths.indexOf(rec.path);
      if (attached && pIdx === -1) roads.paths.push(rec.path);
      else if (!attached && pIdx > -1) roads.paths.splice(pIdx, 1);
      terrain.rebuild(roads.paths);
    }
    updateHierarchyUI();
  }

  // routeLike: tuyến gốc đang có trong roads.paths (đường vẽ bằng chuột) -> nhánh tách ra cũng được đăng ký để người đi bộ / địa hình dùng tiếp
  function createCustomSplineRoad(points, width, type, routeLike = null) {
    const mesh = generateRoadMesh(points, width, type);
    if (!mesh) return null;
    const roadRecord = {
      id: `road_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: (type === 'road_asphalt' || type === 'road_car') ? 'Đường xe chạy' : 'Lối đi bộ',
      type,
      width,
      points: points.map(pt => [...pt]),
      mesh
    };
    mesh.userData.isCustomRoad = true;
    mesh.userData.roadId = roadRecord.id;
    roadsGroup.add(mesh);
    customRoadsList.push(roadRecord);
    if (routeLike && roads?.paths) {
      roadRecord.path = {
        ...routeLike,
        id: roadRecord.id,
        points: roadRecord.points.map(pt => [...pt]),
        curve: new T.CatmullRomCurve3(roadRecord.points.map(pt => new T.Vector3(pt[0], 0, pt[1])), false, 'centripetal')
      };
      roads.paths.push(roadRecord.path);
      terrain.rebuild(roads.paths);
    }
    updateHierarchyUI();
    return roadRecord;
  }

  function deleteCustomRoad(roadId) {
    const idx = customRoadsList.findIndex(r => r.id === roadId);
    if (idx === -1) return false;
    const roadRecord = customRoadsList.splice(idx, 1)[0];
    if (roadRecord.mesh) roadsGroup.remove(roadRecord.mesh);
    // Tuyến có đăng ký trong roads.paths (vẽ bằng chuột) thì đi cùng: xóa, undo, redo đều giữ đồng bộ
    const path = roads?.paths?.find(p => p.id === roadId) || null;
    const setPath = attached => {
      if (!path) return;
      const pIdx = roads.paths.indexOf(path);
      if (attached && pIdx === -1) roads.paths.push(path);
      else if (!attached && pIdx > -1) roads.paths.splice(pIdx, 1);
      else return;
      terrain.rebuild(roads.paths);
    };
    setPath(false);

    pushUndo({
      type: 'road_delete',
      undo: () => {
        if (roadRecord.mesh) roadsGroup.add(roadRecord.mesh);
        if (!customRoadsList.includes(roadRecord)) customRoadsList.push(roadRecord);
        setPath(true);
        updateHierarchyUI();
        saveStudioState();
      },
      redo: () => {
        const i = customRoadsList.findIndex(r => r.id === roadId);
        if (i > -1) {
          customRoadsList.splice(i, 1);
          if (roadRecord.mesh) roadsGroup.remove(roadRecord.mesh);
        }
        setPath(false);
        updateHierarchyUI();
        saveStudioState();
      }
    });

    updateHierarchyUI();
    renderRoadsDynamicList();
    showToast('Đã xóa tuyến đường', '#ef4444');
    return true;
  }

  function clearCustomRoads() {
    for (const r of customRoadsList) {
      if (r.mesh) roadsGroup.remove(r.mesh);
      if (roads && roads.paths) {
        const pIdx = roads.paths.findIndex(p => p.id === r.id);
        if (pIdx > -1) roads.paths.splice(pIdx, 1);
      }
    }
    customRoadsList.length = 0;
    if (roads && roads.paths && terrain && typeof terrain.rebuild === 'function') {
      terrain.rebuild(roads.paths);
    }
    for (const [, tile] of gridRoadsMap) {
      if (tile.mesh) {
        roadsGroup.remove(tile.mesh);
        tile.mesh.traverse(c => { if (c.isMesh) c.geometry?.dispose(); });
      }
    }
    gridRoadsMap.clear();
    if (currentRoadMesh) {
      roadsGroup.remove(currentRoadMesh);
      currentRoadMesh = null;
    }
    for (const h of currentControlHandles) {
      scene.remove(h);
      const idx = clickable.indexOf(h);
      if (idx > -1) clickable.splice(idx, 1);
    }
    currentControlHandles = [];
    currentRoadPoints = [];
    updateHierarchyUI();
    showToast('Đã xóa tất cả đường mới vẽ', '#64748b');
    deselectRoad();
    renderRoadsDynamicList();
    saveStudioState();
  }

  function renderRoadsDynamicList() {
    const listEl = document.querySelector('#roads-dynamic-list');
    if (!listEl) return;
    const roadMode = document.querySelector('input[name="road-draw-mode"]:checked')?.value || 'grid';

    // When in 'native' mode ("🟧 Hộp Cam & 🟨 Vàng"), show all active Orange Courts & Yellow Walkways for 1-click selection/deletion!
    if (roadMode === 'native') {
      let html = '';
      if (terrain && terrain.courts) {
        html += '<div style="font-weight:bold;color:#9a3412;margin:2px 0;">🟧 Danh sách Hộp/Sân Màu Cam:</div>';
        terrain.courts.forEach((c, idx) => {
          if (c.hidden) return;
          const isSel = selectedNativeCourt === c;
          html += `<div class="native-court-row" data-court-idx="${idx}" style="display:flex;justify-content:space-between;align-items:center;padding:3px 5px;margin-bottom:2px;border-radius:3px;cursor:pointer;background:${isSel ? '#ffedd5' : '#ffffff'};border:1px solid ${isSel ? '#ea580c' : '#fed7aa'};">
            <span style="font-weight:${isSel ? 'bold' : 'normal'};color:#9a3412;">🟠 ${c.id} (${c.w}×${c.d}m)</span>
            <button class="btn-del-native-court" data-court-idx="${idx}" style="background:#dc2626;color:#fff;border:none;border-radius:3px;font-size:8px;padding:2px 5px;cursor:pointer;">🗑️ Xóa</button>
          </div>`;
        });
      }
      if (roads && roads.paths) {
        html += '<div style="font-weight:bold;color:#854d0e;margin:5px 0 2px 0;">🟨 Danh sách Đường Màu Vàng:</div>';
        roads.paths.forEach((p, idx) => {
          if (p.hidden || p.class !== 1) return;
          const isSel = selectedNativeWalk && selectedNativeWalk.path === p;
          html += `<div class="native-walk-row" data-walk-idx="${idx}" style="display:flex;justify-content:space-between;align-items:center;padding:3px 5px;margin-bottom:2px;border-radius:3px;cursor:pointer;background:${isSel ? '#fef9c3' : '#ffffff'};border:1px solid ${isSel ? '#ca8a04' : '#fef08a'};">
            <span style="font-weight:${isSel ? 'bold' : 'normal'};color:#854d0e;">🟡 ${p.id} (${(p.points || []).length} mốc)</span>
            <button class="btn-del-native-walk" data-walk-idx="${idx}" style="background:#dc2626;color:#fff;border:none;border-radius:3px;font-size:8px;padding:2px 5px;cursor:pointer;">🗑️ Xóa</button>
          </div>`;
        });
      }
      listEl.innerHTML = html || '<span style="color:#94a3b8;">Đã ẩn hết sân cam & đường vàng.</span>';

      listEl.querySelectorAll('.native-court-row').forEach(row => {
        row.addEventListener('click', e => {
          if (e.target.classList.contains('btn-del-native-court')) return;
          const c = terrain.courts[parseInt(row.dataset.courtIdx, 10)];
          if (c) selectNativeCourt(c);
        });
      });
      listEl.querySelectorAll('.btn-del-native-court').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const c = terrain.courts[parseInt(btn.dataset.courtIdx, 10)];
          if (c) {
            c.hidden = true;
            if (selectedNativeCourt === c) { selectedNativeCourt = null; deselect(); }
            rebuildTerrainSurfaces();
            syncNativeSurfaceUI();
            saveStudioState();
          }
        });
      });
      listEl.querySelectorAll('.native-walk-row').forEach(row => {
        row.addEventListener('click', e => {
          if (e.target.classList.contains('btn-del-native-walk')) return;
          const p = roads.paths[parseInt(row.dataset.walkIdx, 10)];
          if (p) selectNativeWalkPoint(p, 0);
        });
      });
      listEl.querySelectorAll('.btn-del-native-walk').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const p = roads.paths[parseInt(btn.dataset.walkIdx, 10)];
          if (p) {
            p.hidden = true;
            if (selectedNativeWalk && selectedNativeWalk.path === p) { selectedNativeWalk = null; deselect(); }
            rebuildTerrainSurfaces();
            syncNativeSurfaceUI();
            saveStudioState();
          }
        });
      });
      return;
    }

    const gridCount = gridRoadsMap.size;
    if (customRoadsList.length === 0 && gridCount === 0) {
      listEl.innerHTML = '<span style="color:#94a3b8;font-style:italic;">Chưa có ô đường mới nào. Click/Kéo trên lưới để lát đường!</span>';
      return;
    }
    let summaryHtml = '';
    if (gridCount > 0) {
      summaryHtml += `<div style="padding:4px 6px;margin-bottom:3px;border-radius:4px;background:#ecfdf5;border:1px solid #10b981;color:#065f46;font-weight:bold;display:flex;justify-content:space-between;align-items:center;">
        <span>🔲 Đã lát: ${gridCount} ô đường SimCity</span>
        <span style="font-size:8px;color:#047857;">Tự động nối 4 hướng</span>
      </div>`;
    }
    if (customRoadsList.length === 0) {
      listEl.innerHTML = summaryHtml;
      return;
    }
    let html = '';
    customRoadsList.forEach((r, idx) => {
      const isSel = selectedRoad && selectedRoad.id === r.id;
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 5px;margin-bottom:2px;border-radius:3px;background:${isSel ? '#fee2e2' : '#ffffff'};border:1px solid ${isSel ? '#f87171' : '#e2e8f0'};cursor:pointer;" class="road-list-row" data-road-id="${r.id}">
        <span style="font-weight:${isSel ? 'bold' : 'normal'};color:${isSel ? '#991b1b' : '#334155'};">🛣️ ${r.name || ('Đường #' + (idx+1))} (${r.width}m)</span>
        <button class="btn-del-single-road" data-road-id="${r.id}" style="background:#ef4444;color:#fff;border:none;border-radius:3px;font-size:8px;padding:2px 5px;cursor:pointer;">🗑️ Xóa</button>
      </div>`;
    });
    listEl.innerHTML = html;

    listEl.querySelectorAll('.road-list-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.classList.contains('btn-del-single-road')) return;
        selectCustomRoad(row.dataset.roadId);
      });
    });

    listEl.querySelectorAll('.btn-del-single-road').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteCustomRoad(btn.dataset.roadId);
      });
    });
  }

  function selectCustomRoad(roadIdOrMesh) {
    let road = null;
    if (typeof roadIdOrMesh === 'string') {
      road = customRoadsList.find(r => r.id === roadIdOrMesh);
    } else if (roadIdOrMesh) {
      const rId = roadIdOrMesh.userData?.roadId;
      road = customRoadsList.find(r => r.id === rId || r.mesh === roadIdOrMesh);
    }
    if (!road) return null;
    selectedRoad = road;

    const infoBox = document.querySelector('#selected-road-info');
    const nameEl = document.querySelector('#selected-road-name');
    if (infoBox && nameEl) {
      infoBox.style.display = 'block';
      nameEl.textContent = `${road.name || 'Đường tự vẽ'} (${road.width}m, ${road.points.length} mốc)`;
    }
    renderRoadsDynamicList();
    showToast(`Đã chọn: ${road.name || 'Tuyến đường'}`, '#0284c7');
    return road;
  }

  function deselectRoad() {
    selectedRoad = null;
    const infoBox = document.querySelector('#selected-road-info');
    if (infoBox) infoBox.style.display = 'none';
    renderRoadsDynamicList();
  }

  // =========================================================================
  // 6. FOLIAGE & PROPS BRUSH ENGINE (ProceduralTerrains style)
  // =========================================================================
  const assetMaterials = {
    trunk: new T.MeshStandardMaterial({ color: 0x544738, roughness: 0.95 }),
    leavesRound: new T.MeshStandardMaterial({ color: 0x2e6630, roughness: 0.85 }),
    leavesPine: new T.MeshStandardMaterial({ color: 0x1f4722, roughness: 0.9 }),
    leavesFlower: new T.MeshStandardMaterial({ color: 0x367339, roughness: 0.85 }),
    flowerPetals: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
    shrubLeaf: new T.MeshStandardMaterial({ color: 0x3a6b35, roughness: 0.88 }),
    grassBlade: new T.MeshStandardMaterial({ color: 0x4f772d, roughness: 0.8 }),
    rock: new T.MeshStandardMaterial({ color: 0x7c786d, roughness: 0.92 }),
    woodOrange: new T.MeshStandardMaterial({ color: 0xed8038, roughness: 0.72 }),
    metalDark: new T.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.8 }),
    lampPost: new T.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.7 }),
    lampGlow: new T.MeshStandardMaterial({ color: 0xfffbeb, emissive: 0xfff7ed, emissiveIntensity: 0.8, roughness: 0.3 })
  };

  function spawnAsset(type, x, z, scaleMultiplier = 1.0, rotationY = null, customId = null) {
    const y = terrain.height(x, z);
    const group = new T.Group();
    group.name = customId || `asset_${type}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    group.position.set(x, y, z);

    // 3D GLTF Model Foliage Types & 1-Click Park Presets (SimCity style)
    if (type === 'park_mini_oasis') {
      // Tiểu cảnh Công viên: Ghế gỗ + Đèn + 3 Bụi cây
      const bench = spawnAsset('bench', 0, 0, 1.0, 0);
      scene.remove(bench); customPlacedObjects.pop(); clickable.pop();
      bench.position.set(0, 0, 0);
      group.add(bench);

      const lamp = spawnAsset('lamp', 0, 0, 1.0, 0);
      scene.remove(lamp); customPlacedObjects.pop(); clickable.pop();
      lamp.position.set(1.4, 0, 0.2);
      group.add(lamp);

      for (const [bx, bz, sc] of [[-1.3, -0.4, 0.9], [0, -1.1, 1.1], [1.2, -0.8, 0.85]]) {
        const bush = new T.Mesh(new T.SphereGeometry(0.55 * sc, 8, 6), assetMaterials.shrubLeaf);
        bush.position.set(bx, 0.45 * sc, bz);
        bush.castShadow = true;
        group.add(bush);
      }
      group.userData.isFoliage = true;
      group.userData.assetType = type;
    } else if (type === 'park_tree_grove') {
      // Rừng tiểu cảnh: 2 Cây lớn + 4 Bụi nhỏ + Tảng đá
      const t1 = spawnAsset('tree_round', 0, 0, 1.05, 0);
      scene.remove(t1); customPlacedObjects.pop(); clickable.pop();
      t1.position.set(-1.1, 0, -0.6);
      group.add(t1);

      const t2 = spawnAsset('tree_pine', 0, 0, 0.95, 1.2);
      scene.remove(t2); customPlacedObjects.pop(); clickable.pop();
      t2.position.set(1.2, 0, 0.5);
      group.add(t2);

      const rk = spawnAsset('rock', 0, 0, 0.9, 0.5);
      scene.remove(rk); customPlacedObjects.pop(); clickable.pop();
      rk.position.set(0.2, 0, 1.1);
      group.add(rk);

      for (const [bx, bz, sc] of [[-0.2, -1.2, 0.9], [-1.5, 0.8, 0.8], [1.4, -0.9, 1.0], [0.1, 0.1, 0.75]]) {
        const bush = new T.Mesh(new T.SphereGeometry(0.5 * sc, 8, 6), assetMaterials.shrubLeaf);
        bush.position.set(bx, 0.4 * sc, bz);
        bush.castShadow = true;
        group.add(bush);
      }
      group.userData.isFoliage = true;
      group.userData.assetType = type;
    } else if (['garden1', 'plant_bushSmall', 'plant_bush', 'plant_bushDetailed', 'tree2', 'tree6'].includes(type)) {
      const gltfUrlMap = {
        garden1: './assets/city-pack/garden1.glb',
        plant_bushSmall: './assets/city-pack/plant_bushSmall.glb',
        plant_bush: './assets/city-pack/plant_bush.glb',
        plant_bushDetailed: './assets/city-pack/plant_bushDetailed.glb',
        tree2: './assets/city-pack/tree2.glb',
        tree6: './assets/city-pack/tree6.glb'
      };
      const kindMap = {
        garden1: 'garden',
        plant_bushSmall: 'shrub',
        plant_bush: 'shrub',
        plant_bushDetailed: 'shrub',
        tree2: 'tree',
        tree6: 'tree'
      };
      const scaleMap = {
        garden1: 0.95,
        plant_bushSmall: 1.15,
        plant_bush: 1.25,
        plant_bushDetailed: 1.3,
        tree2: 1.6,
        tree6: 1.9
      };
      const url = gltfUrlMap[type];
      const sc = scaleMap[type] || 1.0;
      const attachModel = srcModel => {
        if (!srcModel) return;
        const root = srcModel.clone(true);
        const box = new T.Box3().setFromObject(root);
        const center = box.getCenter(new T.Vector3());
        const minY = box.min.y;
        root.position.set(-center.x * sc, -minY * sc, -center.z * sc);
        root.scale.setScalar(sc);
        root.traverse(c => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            c.userData.isFoliage = true;
          }
        });
        group.add(root);
      };
      if (registry && typeof registry.load === 'function') {
        registry.load(url, kindMap[type] || 'shrub').then(attachModel).catch(() => {});
      } else {
        const loader = new GLTFLoader();
        loader.load(url, gltf => attachModel(gltf.scene));
      }
      group.userData.isFoliage = true;
      group.userData.assetType = type;
    } else if (type === 'tree_round') {
      const trunk = new T.Mesh(new T.CylinderGeometry(0.18, 0.28, 2.2, 8), assetMaterials.trunk);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      group.add(trunk);

      for (const [ox, oy, oz, r] of [
        [0, 2.6, 0, 1.4],
        [-0.45, 2.9, 0.3, 1.05],
        [0.45, 2.8, -0.3, 1.1],
        [0, 3.4, 0, 0.95]
      ]) {
        const foliage = new T.Mesh(new T.SphereGeometry(r, 10, 8), assetMaterials.leavesRound);
        foliage.position.set(ox, oy, oz);
        foliage.castShadow = true;
        group.add(foliage);
      }
    } else if (type === 'tree_pine') {
      const trunk = new T.Mesh(new T.CylinderGeometry(0.15, 0.25, 3.2, 8), assetMaterials.trunk);
      trunk.position.y = 1.6;
      trunk.castShadow = true;
      group.add(trunk);

      for (let i = 0; i < 4; i++) {
        const cone = new T.Mesh(new T.ConeGeometry(1.6 - i * 0.32, 1.25, 8), assetMaterials.leavesPine);
        cone.position.y = 1.8 + i * 0.75;
        cone.castShadow = true;
        group.add(cone);
      }
    } else if (type === 'tree_flower') {
      const trunk = new T.Mesh(new T.CylinderGeometry(0.16, 0.24, 2.0, 8), assetMaterials.trunk);
      trunk.position.y = 1.0;
      trunk.castShadow = true;
      group.add(trunk);

      const crown = new T.Mesh(new T.SphereGeometry(1.35, 10, 8), assetMaterials.leavesFlower);
      crown.position.y = 2.4;
      crown.castShadow = true;
      group.add(crown);

      for (let i = 0; i < 14; i++) {
        const a1 = Math.random() * Math.PI * 2;
        const a2 = (Math.random() - 0.5) * Math.PI * 0.8;
        const pr = 1.36;
        const px = Math.cos(a1) * Math.cos(a2) * pr;
        const py = 2.4 + Math.sin(a2) * pr;
        const pz = Math.sin(a1) * Math.cos(a2) * pr;
        const fl = new T.Mesh(new T.SphereGeometry(0.1, 6, 6), assetMaterials.flowerPetals);
        fl.position.set(px, py, pz);
        group.add(fl);
      }
    } else if (type === 'shrub') {
      for (const [ox, oy, oz, r] of [
        [0, 0.5, 0, 0.65],
        [-0.3, 0.45, 0.2, 0.5],
        [0.3, 0.48, -0.2, 0.52],
        [0, 0.75, 0, 0.42]
      ]) {
        const bush = new T.Mesh(new T.SphereGeometry(r, 8, 6), assetMaterials.shrubLeaf);
        bush.position.set(ox, oy, oz);
        bush.castShadow = true;
        group.add(bush);
      }
    } else if (type === 'grass_patch') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rad = 0.4 + Math.random() * 0.3;
        const tuft = new T.Mesh(new T.ConeGeometry(0.2, 0.6 + Math.random() * 0.2, 5), assetMaterials.grassBlade);
        tuft.position.set(Math.cos(a) * rad, 0.3, Math.sin(a) * rad);
        tuft.rotation.z = (Math.random() - 0.5) * 0.4;
        group.add(tuft);
      }
    } else if (type === 'rock') {
      const rock = new T.Mesh(new T.DodecahedronGeometry(0.85, 1), assetMaterials.rock);
      rock.scale.set(1.2, 0.7, 0.9);
      rock.position.y = 0.45;
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      group.add(rock);
    } else if (type === 'trash_can') {
      const bin = new T.Mesh(new T.CylinderGeometry(0.28, 0.24, 0.75, 12), assetMaterials.metalDark);
      bin.position.y = 0.375;
      bin.castShadow = true;
      group.add(bin);
      const lid = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.08, 12), assetMaterials.woodOrange);
      lid.position.y = 0.77;
      group.add(lid);
    } else if (type === 'signpost') {
      const post = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 1.5, 8), assetMaterials.trunk);
      post.position.y = 0.75;
      post.castShadow = true;
      group.add(post);
      const sign = new T.Mesh(new T.BoxGeometry(0.8, 0.3, 0.05), assetMaterials.woodOrange);
      sign.position.set(0.2, 1.25, 0);
      sign.castShadow = true;
      group.add(sign);
    } else if (type === 'bench') {
      const seat = new T.Mesh(new T.BoxGeometry(1.6, 0.08, 0.5), assetMaterials.woodOrange);
      seat.position.y = 0.42;
      group.add(seat);
      const back = new T.Mesh(new T.BoxGeometry(1.6, 0.45, 0.08), assetMaterials.woodOrange);
      back.position.set(0, 0.68, -0.22);
      group.add(back);
      for (const bx of [-0.65, 0.65]) {
        const leg = new T.Mesh(new T.BoxGeometry(0.08, 0.42, 0.46), assetMaterials.metalDark);
        leg.position.set(bx, 0.21, 0);
        group.add(leg);
      }
    } else if (type === 'lamp') {
      const base = new T.Mesh(new T.CylinderGeometry(0.12, 0.16, 0.2, 8), assetMaterials.lampPost);
      base.position.y = 0.1;
      group.add(base);
      const pole = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 1.4, 8), assetMaterials.lampPost);
      pole.position.y = 0.8;
      group.add(pole);
      const lantern = new T.Mesh(new T.CylinderGeometry(0.14, 0.11, 0.25, 8), assetMaterials.lampGlow);
      lantern.position.y = 1.55;
      group.add(lantern);
      const cap = new T.Mesh(new T.ConeGeometry(0.2, 0.12, 8), assetMaterials.lampPost);
      cap.position.y = 1.72;
      group.add(cap);
    } else if (String(type).startsWith('#')) {
      getStudioModelById(type, { scale: 1.0, addEntrySocket: false })
        .then(studioRoot => {
          if (!studioRoot) return;
          group.add(studioRoot);
          if (studioRoot.userData.studioCat === 'landscape') {
            group.userData.isFoliage = true;
            group.userData.isProp = false;
          } else {
            group.userData.isProp = true;
            group.userData.isFoliage = false;
          }
          updatePropsListUI();
          updateFoliageListUI();
        })
        .catch(() => {});
    }

    const isStudioItem = String(type).startsWith('#');
    group.rotation.y = rotationY !== null ? rotationY : (isStudioItem ? 0 : Math.random() * Math.PI * 2);
    const finalScale = isStudioItem ? scaleMultiplier : ((0.85 + Math.random() * 0.3) * scaleMultiplier);
    group.scale.set(finalScale, finalScale, finalScale);

    const isProp = ['bench', 'lamp', 'rock', 'trash_can', 'signpost'].includes(type) || isStudioItem;
    group.userData.isCustomAsset = true;
    group.userData.isProp = isProp;
    group.userData.isFoliage = !isProp;
    group.userData.assetType = type;
    scene.add(group);
    customPlacedObjects.push(group);
    clickable.push(group);

    updateHierarchyUI();
    updatePropsListUI();
    updateFoliageListUI();
    return group;
  }

  function scatterVegetation({
    type = 'tree_round',
    center = [0, 0],
    radius = 8.0,
    count = 4,
    minDistance = 2.0,
    autoAvoidRoads = true
  }) {
    const placed = [];
    const xc = center[0], zc = center[1];

    for (let c = 0; c < count * 3 && placed.length < count; c++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const px = xc + Math.cos(angle) * r;
      const pz = zc + Math.sin(angle) * r;

      let tooClose = false;
      for (const obj of customPlacedObjects) {
        if (Math.hypot(obj.position.x - px, obj.position.z - pz) < minDistance) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      if (autoAvoidRoads && turf) {
        const ptGeo = turf.point([px, pz]);
        let hitRoad = false;
        for (const rBuf of roadBuffers) {
          try {
            if (turf.booleanPointInPolygon(ptGeo, rBuf.feature)) {
              hitRoad = true;
              break;
            }
          } catch (e) {}
        }
        if (hitRoad) continue;
      }

      const obj = spawnAsset(type, px, pz);
      if (obj) placed.push(obj);
    }

    if (placed.length > 0) {
      pushUndo({
        type: 'scatter_vegetation',
        undo: () => {
          for (const obj of placed) {
            scene.remove(obj);
            const idx = customPlacedObjects.indexOf(obj);
            if (idx > -1) customPlacedObjects.splice(idx, 1);
            const cIdx = clickable.indexOf(obj);
            if (cIdx > -1) clickable.splice(cIdx, 1);
          }
          updateHierarchyUI();
        },
        redo: () => {
          for (const obj of placed) {
            scene.add(obj);
            customPlacedObjects.push(obj);
            clickable.push(obj);
          }
          updateHierarchyUI();
        }
      });
    }

    return placed;
  }

  function deleteSelectedAsset() {
    if (!selectedObject) return false;
    const target = selectedObject.group || selectedObject;
    if (target === tMesh || target.name === 'continuous-ground' || target.name === 'river-only' ||
        target === nativeWalkwaysGroup || target === nativeCourtsSmoothGroup || target === roadsGroup ||
        target.name === 'native_campus_walkways_smooth' || target.name === 'native_campus_courts_smooth' ||
        target.name === 'city_builder_custom_roads' ||
        (layers && Object.values(layers).includes(target))) {
      showToast('Không thể xóa hệ thống nền / đường chính!', '#dc2626');
      return false;
    }

    const parent = target.parent || scene;
    parent.remove(target);

    let nativeRec = null;
    const idx = customPlacedObjects.indexOf(target);
    if (idx > -1) {
      customPlacedObjects.splice(idx, 1);
    } else {
      const box = new T.Box3().setFromObject(target);
      const center = box.getCenter(new T.Vector3());
      const sz = box.getSize(new T.Vector3());
      const radius = Math.max(0.6, Math.max(sz.x, sz.z) / 2);
      if (Math.max(sz.x, sz.z) <= 8.0) {
        nativeRec = {
          kind: 'sceneObject',
          name: target.name || '',
          pos: [Number(center.x.toFixed(2)), Number(center.z.toFixed(2))],
          radius: Number(Math.min(radius, 3.5).toFixed(2))
        };
        demolishedNativeItems.push(nativeRec);
      }
    }
    const cIdx = clickable.indexOf(target);
    if (cIdx > -1) clickable.splice(cIdx, 1);

    pushUndo({
      type: 'delete_asset',
      undo: () => {
        parent.add(target);
        if (target.userData?.isCustomAsset) customPlacedObjects.push(target);
        clickable.push(target);
        if (nativeRec) {
          const rIdx = demolishedNativeItems.indexOf(nativeRec);
          if (rIdx > -1) demolishedNativeItems.splice(rIdx, 1);
        }
        selectCustomObject(target);
        updateHierarchyUI();
      },
      redo: () => {
        parent.remove(target);
        const i = customPlacedObjects.indexOf(target);
        if (i > -1) customPlacedObjects.splice(i, 1);
        const ci = clickable.indexOf(target);
        if (ci > -1) clickable.splice(ci, 1);
        deselect();
        updateHierarchyUI();
      }
    });

    deselect();
    updateHierarchyUI();
    updatePropsListUI();
    updateFoliageListUI();
    saveStudioState();
    showToast('🗑️ Đã xóa đối tượng!', '#ef4444');
    return true;
  }

  function duplicateSelected(offset = [1.5, 0, 1.5]) {
    if (!selectedObject) return null;
    const target = selectedObject.group || selectedObject;
    if (target.userData && (target.userData.isCustomAsset || target.userData.isNativeProp)) {
      const type = target.userData.assetType || 'bench';
      const nx = target.position.x + offset[0];
      const nz = target.position.z + offset[2];
      const scale = target.scale.x;
      const rotY = target.rotation.y;

      const clone = spawnAsset(type, nx, nz, scale, rotY);
      selectCustomObject(clone);

      pushUndo({
        type: 'duplicate_asset',
        undo: () => {
          scene.remove(clone);
          const idx = customPlacedObjects.indexOf(clone);
          if (idx > -1) customPlacedObjects.splice(idx, 1);
          const cIdx = clickable.indexOf(clone);
          if (cIdx > -1) clickable.splice(cIdx, 1);
          deselect();
          updateHierarchyUI();
          updatePropsListUI();
          updateFoliageListUI();
          saveStudioState();
        },
        redo: () => {
          scene.add(clone);
          customPlacedObjects.push(clone);
          clickable.push(clone);
          selectCustomObject(clone);
          updateHierarchyUI();
          updatePropsListUI();
          updateFoliageListUI();
          saveStudioState();
        }
      });

      showToast('📋 Đã nhân bản đối tượng', '#0284c7');
      updateHierarchyUI();
      updatePropsListUI();
      updateFoliageListUI();
      saveStudioState();
      return clone;
    }
    return null;
  }

  function clearAllCustomAssets() {
    for (const obj of customPlacedObjects) {
      scene.remove(obj);
      const cIdx = clickable.indexOf(obj);
      if (cIdx > -1) clickable.splice(cIdx, 1);
    }
    customPlacedObjects.length = 0;
    deselect();
    updateHierarchyUI();
    updatePropsListUI();
    updateFoliageListUI();
    saveStudioState();
    showToast('Đã dọn dẹp tất cả cảnh quan tự đặt', '#64748b');
  }

  // =========================================================================
  // 7. MATERIAL EDITOR (Real-time color, roughness, metalness)
  // =========================================================================
  function getObjectPrimaryMaterial(target) {
    if (!target) return null;
    let foundMat = null;
    target.traverse(child => {
      if (!foundMat && child.isMesh && child.material) {
        foundMat = Array.isArray(child.material) ? child.material[0] : child.material;
      }
    });
    return foundMat;
  }

  function syncMaterialUI(target) {
    const mat = getObjectPrimaryMaterial(target.group || target);
    if (!mat) return;

    const colInput = document.querySelector('#mat-color-picker');
    const roughInput = document.querySelector('#mat-roughness-slider');
    const metalInput = document.querySelector('#mat-metalness-slider');

    if (colInput && mat.color) {
      colInput.value = '#' + mat.color.getHexString();
    }
    if (roughInput && mat.roughness !== undefined) {
      roughInput.value = mat.roughness;
      const lbl = document.querySelector('#lbl-mat-roughness');
      if (lbl) lbl.textContent = mat.roughness.toFixed(2);
    }
    if (metalInput && mat.metalness !== undefined) {
      metalInput.value = mat.metalness;
      const lbl = document.querySelector('#lbl-mat-metalness');
      if (lbl) lbl.textContent = mat.metalness.toFixed(2);
    }
  }

  function setMaterialProperties(target, { color, roughness, metalness, opacity }) {
    if (!target) return false;
    const grp = target.group || target;
    const applied = [];

    grp.traverse(child => {
      if (child.isMesh && child.material) {
        const m = Array.isArray(child.material) ? child.material[0] : child.material;
        if (!m.userData.originalMatParams) {
          m.userData.originalMatParams = {
            color: m.color ? m.color.getHex() : null,
            roughness: m.roughness,
            metalness: m.metalness
          };
        }
        if (color !== undefined && m.color) {
          m.color.set(color);
        }
        if (roughness !== undefined && m.roughness !== undefined) {
          m.roughness = roughness;
        }
        if (metalness !== undefined && m.metalness !== undefined) {
          m.metalness = metalness;
        }
        if (opacity !== undefined) {
          m.opacity = opacity;
          m.transparent = opacity < 1.0;
        }
        applied.push(m);
      }
    });

    syncMaterialUI(target);
    return applied.length > 0;
  }

  // =========================================================================
  // 8. SCENE HIERARCHY (Tree Inspector)
  // =========================================================================
  function getSceneHierarchy() {
    const buildings = [];
    for (const [id, fp] of buildingFootprints) {
      const p = fp.group.position;
      buildings.push({
        id,
        name: fp.name,
        type: 'building',
        grade: fp.grade,
        position: [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))],
        rotationY: Number(fp.group.rotation.y.toFixed(3)),
        dimensions: [fp.w, fp.d]
      });
    }

    const roadsData = customRoadsList.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      width: r.width,
      pointsCount: r.points.length,
      points: r.points
    }));

    const assetsData = customPlacedObjects.map(obj => ({
      id: obj.name,
      name: obj.userData?.assetType || 'Đạo cụ',
      type: obj.userData?.assetType,
      position: [Number(obj.position.x.toFixed(2)), Number(obj.position.y.toFixed(2)), Number(obj.position.z.toFixed(2))],
      rotationY: Number(obj.rotation.y.toFixed(3)),
      scale: Number(obj.scale.x.toFixed(2))
    }));

    return {
      buildings,
      customRoads: roadsData,
      customAssets: assetsData,
      summary: {
        totalBuildings: buildings.length,
        totalCustomRoads: roadsData.length,
        totalCustomAssets: assetsData.length
      }
    };
  }

  function updateHierarchyUI() {
    syncRoadMarkings(); // mọi thay đổi danh sách đường đều đi qua đây
    const listEl = document.querySelector('#hierarchy-list');
    if (!listEl) return;

    const searchTerm = (document.querySelector('#inp-hierarchy-search')?.value || '').toLowerCase();
    const data = getSceneHierarchy();

    let html = '';

    // Buildings
    html += `<div style="font-weight:bold;color:#047857;margin:4px 0 2px 0;font-size:10px;">🏛️ Công trình (${data.buildings.length})</div>`;
    for (const b of data.buildings) {
      if (searchTerm && !b.name.toLowerCase().includes(searchTerm) && !b.id.toLowerCase().includes(searchTerm)) continue;
      const isSelected = selectedObject && (selectedObject.id === b.id || selectedObject.name === b.id);
      html += `
        <div class="hierarchy-item" data-type="building" data-id="${b.id}" style="padding:3px 6px;margin-bottom:2px;font-size:10px;cursor:pointer;border-radius:4px;background:${isSelected ? '#d1fae5' : '#fff'};border:1px solid ${isSelected ? '#059669' : '#e2e8f0'};display:flex;justify-content:space-between;">
          <span>${b.name}</span>
          <span style="font-family:monospace;color:#64748b;font-size:9px;">[${b.position[0]}, ${b.position[2]}]</span>
        </div>`;
    }

    // Roads
    html += `<div style="font-weight:bold;color:#0284c7;margin:6px 0 2px 0;font-size:10px;">🛣️ Tuyến đường tự vẽ (${data.customRoads.length})</div>`;
    for (const r of data.customRoads) {
      if (searchTerm && !r.name.toLowerCase().includes(searchTerm) && !r.id.toLowerCase().includes(searchTerm)) continue;
      html += `
        <div class="hierarchy-item" data-type="road" data-id="${r.id}" style="padding:3px 6px;margin-bottom:2px;font-size:10px;cursor:pointer;border-radius:4px;background:#fff;border:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
          <span>${r.name} (${r.pointsCount} điểm)</span>
          <button class="btn-del-road-item" data-road-id="${r.id}" style="background:#ef4444;color:#fff;border:none;border-radius:3px;font-size:8px;padding:2px 4px;cursor:pointer;">Xóa</button>
        </div>`;
    }

    // Assets
    html += `<div style="font-weight:bold;color:#d97706;margin:6px 0 2px 0;font-size:10px;">🌳 Cây cối & Đạo cụ (${data.customAssets.length})</div>`;
    for (const a of data.customAssets) {
      if (searchTerm && !a.name.toLowerCase().includes(searchTerm) && !a.id.toLowerCase().includes(searchTerm)) continue;
      const isSelected = selectedObject && (selectedObject.name === a.id);
      html += `
        <div class="hierarchy-item" data-type="asset" data-id="${a.id}" style="padding:3px 6px;margin-bottom:2px;font-size:10px;cursor:pointer;border-radius:4px;background:${isSelected ? '#fef3c7' : '#fff'};border:1px solid ${isSelected ? '#d97706' : '#e2e8f0'};display:flex;justify-content:space-between;">
          <span>${a.name}</span>
          <span style="font-family:monospace;color:#64748b;font-size:9px;">[${a.position[0]}, ${a.position[2]}]</span>
        </div>`;
    }

    listEl.innerHTML = html;

    listEl.querySelectorAll('.hierarchy-item').forEach(el => {
      el.onclick = e => {
        if (e.target.classList.contains('btn-del-road-item')) return;
        const type = el.dataset.type;
        const id = el.dataset.id;
        focusOnHierarchyItem(type, id);
      };
    });

    listEl.querySelectorAll('.btn-del-road-item').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        deleteCustomRoad(btn.dataset.roadId);
      };
    });
  }

  function focusOnHierarchyItem(type, id) {
    if (type === 'building') {
      const bld = selectBuilding(id);
      if (bld) {
        const p = bld.group.position;
        controls.target.set(p.x, p.y + 4, p.z);
        camera.position.set(p.x + 24, p.y + 26, p.z + 24);
        controls.update();
      }
    } else if (type === 'asset') {
      const obj = customPlacedObjects.find(o => o.name === id);
      if (obj) {
        selectCustomObject(obj);
        controls.target.set(obj.position.x, obj.position.y + 1.5, obj.position.z);
        camera.position.set(obj.position.x + 12, obj.position.y + 14, obj.position.z + 12);
        controls.update();
      }
    } else if (type === 'road') {
      const r = customRoadsList.find(rd => rd.id === id);
      if (r && r.points.length > 0) {
        const p = r.points[0];
        controls.target.set(p[0], terrain.height(p[0], p[1]) + 2, p[1]);
        camera.position.set(p[0] + 20, terrain.height(p[0], p[1]) + 22, p[1] + 20);
        controls.update();
      }
    }
    updateHierarchyUI();
  }

  // =========================================================================
  // 9. SERIALIZATION & PERSISTENCE
  // =========================================================================
  const STORAGE_KEY = 'ANPHIM_CAMPUS_STUDIO_STATE_V146';
  try {
    localStorage.removeItem('ANPHIM_CAMPUS_STUDIO_STATE_V28');
    localStorage.removeItem('ANPHIM_CAMPUS_STUDIO_STATE_V27');
    localStorage.removeItem('ANPHIM_CAMPUS_STUDIO_STATE_V26');
    localStorage.removeItem('ANPHIM_CAMPUS_STUDIO_STATE_V25');
  } catch(e) {}

  function serializeStudioState() {
    const heightDiffs = [];
    for (const i of modifiedHeightIndices) {
      if (i < baseCount) {
        heightDiffs.push([i, Number(basePosArray[i * 3 + 1].toFixed(3))]);
      }
    }

    const colorDiffs = [];
    if (baseColorArray) {
      for (const i of modifiedColorIndices) {
        if (i < baseCount) {
          colorDiffs.push([
            i,
            Number(baseColorArray[i * 3].toFixed(3)),
            Number(baseColorArray[i * 3 + 1].toFixed(3)),
            Number(baseColorArray[i * 3 + 2].toFixed(3))
          ]);
        }
      }
    }

    const roadsData = customRoadsList.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      width: r.width,
      points: r.points
    }));

    const gridRoadsData = [];
    for (const [, tile] of gridRoadsMap) {
      gridRoadsData.push({
        gx: tile.gx,
        gz: tile.gz,
        step: tile.step,
        type: tile.type
      });
    }

    const assetsData = customPlacedObjects.map(obj => ({
      id: obj.name,
      type: obj.userData?.assetType,
      position: [Number(obj.position.x.toFixed(2)), Number(obj.position.y.toFixed(2)), Number(obj.position.z.toFixed(2))],
      rotationY: Number(obj.rotation.y.toFixed(3)),
      scale: Number(obj.scale.x.toFixed(2))
    }));

    const buildingTransforms = {};
    for (const [id, fp] of buildingFootprints) {
      const p = fp.group.position;
      const r = fp.group.rotation.y;
      buildingTransforms[id] = {
        position: [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))],
        rotationY: Number(r.toFixed(3))
      };
    }

    const nativeCourtsState = (terrain && terrain.courts) ? terrain.courts.map(c => ({
      id: c.id,
      x: Number(c.x.toFixed(2)),
      z: Number(c.z.toFixed(2)),
      w: Number(c.w.toFixed(2)),
      d: Number(c.d.toFixed(2)),
      r: Number((c.r ?? 1.5).toFixed(2)),
      rotY: Number((c.rotY || 0).toFixed(3)),
      hidden: Boolean(c.hidden)
    })) : [];

    const nativeWalksState = (roads && roads.paths) ? roads.paths.filter(p => p.class === 1).map(p => ({
      id: p.id,
      width: Number((p.width || 2.0).toFixed(2)),
      points: (p.points || []).map(pt => [Number(pt[0].toFixed(2)), Number(pt[1].toFixed(2))]),
      hidden: Boolean(p.hidden)
    })) : [];

    return {
      version: '2.6',
      layoutRevision: LAYOUT_REVISION,
      timestamp: Date.now(),
      grid: [nx, nz],
      heightDiffs,
      colorDiffs,
      roadsData,
      gridRoadsData,
      nativeCourtsState,
      nativeWalksState,
      demolishedNativeItems,
      assetsData,
      buildingTransforms
    };
  }

  let isStudioDirty = false;
  function markStudioDirty() {
    isStudioDirty = true;
    const toast = document.querySelector('#save-status-toast');
    if (toast) {
      toast.innerHTML = '<span style="color:#f59e0b;font-weight:bold;">● Unsaved changes (Press Ctrl+S or click Save)</span>';
    }
  }

  let saveDebounceTimer = null;
  // Đưa các đường xe chạy do Studio vẽ vào cơ chế vạch kẻ chung (road-markings.js): chỗ chúng chạm / cắt nhau
  // hoặc chạm vành đai sẽ tự có vạch dừng và vạch qua đường; vạch tim liền cũ của mesh được ẩn đi.
  function syncRoadMarkings(force = false) {
    if (!roads?.syncRoadNetwork) return;
    const defs = [];
    for (const r of customRoadsList) {
      const drivable = r.type === 'road_asphalt' || r.type === 'road_car';
      if (!drivable || !r.mesh?.parent || r.mesh.visible === false || (r.width || 6) < 3) continue;
      const chains = splitRoadChains(r.points);
      if (!chains) continue;
      const stripe = r.mesh.getObjectByName('road_lane_stripes');
      if (stripe) stripe.visible = false;
      // Cùng cách tách khúc với generateRoadMesh để vạch nằm đúng trên mặt nhựa ở khúc quay đầu gấp
      chains.rawChains.forEach((chain, i) => defs.push({
        id: `${r.id}#${i}`, group: r.id, halfW: (r.width || 6) / 2, signature: JSON.stringify(chain),
        curve: new T.CatmullRomCurve3(chain.map(p => new T.Vector3(p[0], 0, p[1])), false, 'centripetal')
      }));
    }
    roads.syncRoadNetwork(defs, force);
  }

  function saveStudioState(force = false) {
    markStudioDirty();
    syncRoadMarkings();
    if (force) {
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      return doActualSave(true);
    } else {
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      saveDebounceTimer = setTimeout(() => {
        doActualSave(false);
      }, 350);
    }
  }

  async function syncMasterPlanToDisk(state, showSuccessToast) {
    try {
      const res = await fetch('/api/save-masterplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
      if (res.ok) {
        const toast = document.querySelector('#save-status-toast');
        if (toast) {
          toast.innerHTML = '<span style="color:#10b981;font-weight:bold;">✔ Đã lưu vĩnh viễn vào Code Master trên ổ cứng!</span>';
        }
        if (showSuccessToast) {
          showToast('💾 Đã đồng bộ trực tiếp vào File Master trên ổ đĩa!', '#059669');
        }
      }
    } catch (err) {
      console.warn('[Editor] Sync to disk warning:', err);
    }
  }

  function doActualSave(showSuccessToast = false) {
    try {
      const state = serializeStudioState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      isStudioDirty = false;
      const toast = document.querySelector('#save-status-toast');
      if (toast) {
        toast.innerHTML = '<span style="color:#10b981;font-weight:bold;">✔ Đã tự động lưu Campus</span>';
      }
      if (showSuccessToast) {
        showToast('💾 Đã lưu Campus vào trình duyệt!', '#059669');
      }
      syncMasterPlanToDisk(state, showSuccessToast);
      return { ok: true, state };
    } catch (e) {
      console.error('[Editor] Save error:', e);
      showToast('Lỗi lưu trình duyệt: ' + e.message, '#ef4444');
      return { ok: false, error: e.message };
    }
  }

  function loadStudioState(savedState) {
    if (!savedState) return { ok: false };

    // Bản lưu làm trên bố cục cũ (physical-topology.json đã dời nhà sau đó): vị trí tòa, sân và lối đi gốc lấy theo bố cục hiện tại,
    // nếu không tòa mới sẽ bị kéo về chỗ cũ. Sân / lối đi người dùng tự thêm (id không thuộc bố cục gốc), đường, địa hình và vật thể vẫn giữ.
    if ((savedState.layoutRevision || null) !== LAYOUT_REVISION) {
      const courtIds = new Set(initialNativeCourts.map(c => c.id)), walkIds = new Set(initialNativeWalks.map(w => w.id));
      savedState = {...savedState, buildingTransforms: null};
      if (Array.isArray(savedState.nativeCourtsState)) {
        savedState.nativeCourtsState = [...initialNativeCourts.map(c => ({...c})), ...savedState.nativeCourtsState.filter(c => c && !courtIds.has(c.id))];
      }
      if (Array.isArray(savedState.nativeWalksState)) {
        savedState.nativeWalksState = [
          ...initialNativeWalks.map(w => ({...w, points: w.points.map(pt => [pt[0], pt[1]])})),
          ...savedState.nativeWalksState.filter(w => w && !walkIds.has(w.id))
        ];
      }
    }

    // 1. Restore heights
    let needPosSync = false;
    if (savedState.heightDiffs) {
      for (const [saved, y] of savedState.heightDiffs) {
        const i = gridIndex(saved, savedState.grid);
        if (i >= 0 && i < baseCount) {
          basePosArray[i * 3 + 1] = y;
          modifiedHeightIndices.add(i);
          needPosSync = true;
        }
      }
    }

    // 2. Restore colors
    let needColSync = false;
    if (baseColorArray && savedState.colorDiffs) {
      for (const [saved, r, g, b] of savedState.colorDiffs) {
        const i = gridIndex(saved, savedState.grid);
        if (i >= 0 && i < baseCount) {
          baseColorArray[i * 3] = r;
          baseColorArray[i * 3 + 1] = g;
          baseColorArray[i * 3 + 2] = b;
          modifiedColorIndices.add(i);
          needColSync = true;
        }
      }
    }
    if (needPosSync || needColSync) {
      terrain.syncLiveBuffers(needPosSync, needColSync);
    }

    // 3. Restore roads (both Spline roads and SimCity Grid-Tile roads)
    if (savedState.roadsData || savedState.gridRoadsData) {
      clearCustomRoads();
      if (savedState.roadsData) {
        for (const r of savedState.roadsData) {
          const mesh = generateRoadMesh(r.points, r.width || 6.0, r.type);
          if (mesh) {
            roadsGroup.add(mesh);
            mesh.userData.isCustomRoad = true;
            mesh.userData.roadId = r.id;
            customRoadsList.push({
              id: r.id || `road_${Date.now()}`,
              name: r.name || (r.type === 'road_car' ? 'Đường xe' : 'Lối đi bộ'),
              type: r.type,
              width: r.width || 6.0,
              points: [...r.points],
              mesh
            });
          }
        }
      }
      if (savedState.gridRoadsData) {
        for (const gr of savedState.gridRoadsData) {
          gridRoadsMap.set(`${gr.gx},${gr.gz}`, {
            key: `${gr.gx},${gr.gz}`,
            gx: gr.gx,
            gz: gr.gz,
            step: gr.step || gridStep,
            type: gr.type || 'road_asphalt',
            mesh: null
          });
        }
        for (const [, tile] of gridRoadsMap) {
          refreshGridRoadTile(tile.gx, tile.gz);
        }
        renderRoadsDynamicList();
      }
    }

    // 4. Restore assets
    if (savedState.assetsData) {
      clearAllCustomAssets();
      for (const a of savedState.assetsData) {
        // AAA Urban Integrity: loại bỏ vĩnh viễn cây cối/asset xâm lấn đường U-turn hoặc trước sảnh
        if (Math.abs(a.position[0]) < 10.5 && a.position[2] > 14 && a.position[2] < 34) {
          console.warn('[Urban Planning] Pruned legacy asset violating arrival corridor:', a);
          continue;
        }
        const obj = spawnAsset(a.type, a.position[0], a.position[2], a.scale || 1.0, a.rotationY, a.id);
        if (obj) {
          obj.position.y = a.position[1];
        }
      }
    }

    // 5. Restore buildings
    if (savedState.buildingTransforms) {
      for (const [id, t] of Object.entries(savedState.buildingTransforms)) {
        const fp = buildingFootprints.get(id);
        if (fp) {
          fp.group.position.set(t.position[0], t.position[1], t.position[2]);
          fp.group.rotation.y = t.rotationY;
        }
      }
    }

    // 6. Restore demolished native Campus trees/bushes/objects
    if (savedState.demolishedNativeItems && Array.isArray(savedState.demolishedNativeItems)) {
      demolishedNativeItems.length = 0;
      for (const item of savedState.demolishedNativeItems) {
        if (!item || !item.pos || !Array.isArray(item.pos)) continue;
        if (item.radius && item.radius > 8.0) continue;
        demolishedNativeItems.push(item);
      }
      const applyDemolished = () => {
        const m = new T.Matrix4();
        const p = new T.Vector3();
        const q = new T.Quaternion();
        const s = new T.Vector3();
        const zMat = new T.Matrix4().makeScale(0, 0, 0);
        for (const item of demolishedNativeItems) {
          if (item.kind === 'instanced' && item.pos) {
            scene.traverse(obj => {
              if (obj.isInstancedMesh) {
                let updated = false;
                for (let i = 0; i < obj.count; i++) {
                  obj.getMatrixAt(i, m);
                  m.decompose(p, q, s);
                  if (s.lengthSq() < 0.0001) continue;
                  p.applyMatrix4(obj.matrixWorld);
                  if (Math.hypot(p.x - item.pos[0], p.z - item.pos[1]) < 0.45) {
                    obj.setMatrixAt(i, zMat);
                    updated = true;
                  }
                }
                if (updated) obj.instanceMatrix.needsUpdate = true;
              }
            });
          } else if (item.kind === 'sceneObject') {
            scene.traverse(obj => {
              if (!obj || !obj.visible || obj === scene || obj === tMesh) return;
              if (obj === nativeWalkwaysGroup || obj === nativeCourtsSmoothGroup || obj === roadsGroup) return;
              if (obj.name && (
                obj.name === 'native_campus_walkways_smooth' ||
                obj.name === 'native_campus_courts_smooth' ||
                obj.name === 'city_builder_custom_roads' ||
                obj.name === 'continuous-ground' ||
                obj.name === 'river-only' ||
                obj.name.startsWith('native_walk_') ||
                obj.name.startsWith('smooth_court_')
              )) return;
              if (layers && Object.values(layers).includes(obj)) return;
              // Do not hide container groups with children (unless it's an explicit custom placed object)
              if (obj.isGroup && !obj.userData?.isCustomAsset && obj.children.length > 0) return;

              if (item.name && obj.name === item.name) {
                obj.visible = false;
                return;
              }
              if (item.pos) {
                const b = new T.Box3().setFromObject(obj);
                const sz = b.getSize(new T.Vector3());
                // Object must be a single discrete prop (<= 6m), not a whole district or compound group!
                if (Math.max(sz.x, sz.z) > 6.0) return;
                const c = b.getCenter(new T.Vector3());
                const r = Math.min(item.radius || 1.2, 2.5);
                if (Math.hypot(c.x - item.pos[0], c.z - item.pos[1]) <= r) {
                  obj.visible = false;
                }
              }
            });
          }
        }
        // Force critical infrastructure groups to remain visible
        nativeWalkwaysGroup.visible = true;
        nativeCourtsSmoothGroup.visible = true;
        roadsGroup.visible = true;
        if (layers) {
          for (const l of Object.values(layers)) {
            if (l) l.visible = true;
          }
        }
      };
      applyDemolished();
      setTimeout(applyDemolished, 1200); // Re-apply after async GLB bushes finish loading
    }

    // 7. Restore Native Orange Courts & Yellow Walkways
    let needSurfaceRebuild = false;
    if (savedState.nativeCourtsState && Array.isArray(savedState.nativeCourtsState) && terrain && terrain.courts) {
      const validCourts = savedState.nativeCourtsState.filter(sc => sc && typeof sc.x === 'number');
      const visibleCourts = validCourts.filter(sc => !sc.hidden);
      terrain.courts.length = 0;
      if (visibleCourts.length > 0) {
        for (const sc of validCourts) {
          terrain.courts.push({
            id: sc.id,
            x: sc.x,
            z: sc.z,
            w: sc.w,
            d: sc.d,
            r: sc.r ?? 1.5,
            rotY: sc.rotY || 0,
            hidden: Boolean(sc.hidden),
            ...courtPaintMeta(initialNativeCourts.find(ic => ic.id === sc.id) || {})
          });
        }
      } else {
        // Fallback to baseline
        console.warn('[Editor] nativeCourtsState had 0 visible courts, restoring initial baseline.');
        for (const ic of initialNativeCourts) {
          terrain.courts.push({ ...ic });
        }
      }
      needSurfaceRebuild = true;
    }
    if (savedState.nativeWalksState && Array.isArray(savedState.nativeWalksState) && roads && roads.paths) {
      const validWalks = savedState.nativeWalksState.filter(sw => sw && sw.points && sw.points.length >= 2 && !['walk:dropoff-commons', 'walk:arrival-ramp-west', 'walk:arrival-ramp-east'].includes(sw.id));
      const visibleWalks = validWalks.filter(sw => !sw.hidden);
      const preservedDoorPaths = roads.paths.filter(p => p.class === 1 && p.id && p.id.startsWith('door:'));
      for (let i = roads.paths.length - 1; i >= 0; i--) {
        if (roads.paths[i].class === 1) roads.paths.splice(i, 1);
      }
      if (visibleWalks.length > 0) {
        for (const sw of validWalks) {
          const curve = new T.CatmullRomCurve3(sw.points.map(pt => new T.Vector3(pt[0], 0, pt[1])), false, 'centripetal');
          roads.paths.push({
            id: sw.id,
            points: sw.points.map(pt => [pt[0], pt[1]]),
            width: sw.width || 2.0,
            class: 1,
            hidden: Boolean(sw.hidden),
            curve
          });
        }
        for (const dp of preservedDoorPaths) {
          if (!roads.paths.some(p => p.id === dp.id)) {
            roads.paths.push(dp);
          }
        }
      } else {
        // Fallback to baseline
        console.warn('[Editor] nativeWalksState had 0 visible walks, restoring initial baseline.');
        for (const iw of initialNativeWalks) {
          const pts = iw.points.map(pt => [pt[0], pt[1]]);
          const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], 0, p[1])), false, 'centripetal');
          roads.paths.push({
            id: iw.id,
            points: pts,
            width: iw.width || 2.0,
            class: 1,
            hidden: false,
            curve
          });
        }
      }
      needSurfaceRebuild = true;
    }
    if (needSurfaceRebuild) {
      rebuildTerrainSurfaces();
    }
    if (typeof window.rebuildCirculationNetwork === 'function') {
      window.rebuildCirculationNetwork();
    }

    syncRoadMarkings();
    updateHierarchyUI();
    showToast('✅ Đã phục hồi dữ liệu Campus!', '#0284c7');
    return { ok: true };
  }

  // Auto-restore on startup & immediately build smooth 3D Ribbon Walkways (with lighter-yellow borders) + Smooth Courts
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      loadStudioState(JSON.parse(cached));
    }
  } catch (e) {
    console.warn('[Editor] Auto-restore warning:', e);
  }

  // Safety Auto-Heal: ensure native walkways and courts are NEVER 0 or hidden on load
  if (roads && roads.paths) {
    const activeWalkCount = roads.paths.filter(p => p.class === 1 && !p.hidden).length;
    if (activeWalkCount === 0 && initialNativeWalks.length > 0) {
      console.warn('[Editor] Auto-healing missing walkways...');
      for (let i = roads.paths.length - 1; i >= 0; i--) {
        if (roads.paths[i].class === 1) roads.paths.splice(i, 1);
      }
      for (const iw of initialNativeWalks) {
        const pts = iw.points.map(pt => [pt[0], pt[1]]);
        const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], 0, p[1])), false, 'centripetal');
        roads.paths.push({
          id: iw.id,
          points: pts,
          width: iw.width || 2.0,
          class: 1,
          hidden: false,
          curve
        });
      }
    }
  }
  if (terrain && terrain.courts) {
    const activeCourtsCount = terrain.courts.filter(c => !c.hidden).length;
    if (activeCourtsCount === 0 && initialNativeCourts.length > 0) {
      console.warn('[Editor] Auto-healing missing courts...');
      terrain.courts.length = 0;
      for (const ic of initialNativeCourts) {
        terrain.courts.push({ ...ic });
      }
    }
  }

  // Ensure groups and layers are visible
  nativeWalkwaysGroup.visible = true;
  nativeCourtsSmoothGroup.visible = true;
  roadsGroup.visible = true;
  if (layers) {
    for (const l of Object.values(layers)) {
      if (l) l.visible = true;
    }
  }

  rebuildTerrainSurfaces();

  // =========================================================================
  // 10. UNIFIED AGENT API (window.CampusAgentAPI)
  // =========================================================================
  const agentAPI = {
    // 1. Roads
    toggleGrid: ({ visible = null, snap = null, step = null } = {}) => {
      setGridState({ visible, snap, step });
      return { ok: true, gridVisible, gridSnapEnabled, gridStep };
    },

    getGridState: () => ({ ok: true, visible: gridVisible, snap: gridSnapEnabled, step: gridStep }),

    placeGridRoad: ({ gx, gz, type = 'road_asphalt', step = null }) => {
      const st = step || gridStep;
      placeGridRoadTile(gx, gz, type, st, true);
      saveStudioState();
      return { ok: true, gx, gz, type, totalGridRoads: gridRoadsMap.size };
    },

    placeGridRoadLine: ({ from = [0, 0], to = [0, 5], type = 'road_asphalt', step = null }) => {
      const st = step || gridStep;
      const path = getOrthogonalTilePath(from[0], from[1], to[0], to[1]);
      for (const [gx, gz] of path) {
        placeGridRoadTile(gx, gz, type, st, false);
      }
      saveStudioState();
      return { ok: true, placedCount: path.length, totalGridRoads: gridRoadsMap.size, path };
    },

    removeGridRoad: ({ gx, gz }) => {
      const removed = removeGridRoadTile(gx, gz, true);
      saveStudioState();
      return { ok: removed, gx, gz, totalGridRoads: gridRoadsMap.size };
    },

    getGridRoads: () => {
      const list = [];
      for (const [, t] of gridRoadsMap) {
        list.push({ gx: t.gx, gz: t.gz, step: t.step, type: t.type });
      }
      return { ok: true, count: list.length, tiles: list };
    },

    // Giao lộ mà cơ chế vạch kẻ đang nhận diện: toạ độ, số nhánh (3 = ngã ba, 4 = ngã tư), số vạch qua đường
    getRoadJunctions: () => ({ ok: true, junctions: roads?.getJunctions ? roads.getJunctions() : [] }),

    createPlaza: async ({ points = [], width = 12.0, name = null }) => {
      return await agentAPI.createRoad({ type: 'plaza_park', points, width, name: name || 'Sàn công viên' });
    },

    createRoad: async ({ type = 'road_asphalt', points = [], width = 6.0, name = null }) => {
      if (!points || points.length < 2) {
        return { ok: false, error: 'Points array must contain at least 2 points [x, z]' };
      }
      const roadMesh = generateRoadMesh(points, width, type);
      if (!roadMesh) return { ok: false, error: 'Failed to generate road mesh' };
      roadsGroup.add(roadMesh);
      roadMesh.userData.isCustomRoad = true;

      const roadRecord = {
        id: `road_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: name || (type === 'road_car' ? 'Đường xe chạy' : 'Lối đi bộ'),
        type,
        width,
        points: [...points],
        mesh: roadMesh
      };
      customRoadsList.push(roadRecord);
      roadMesh.userData.roadId = roadRecord.id;
      syncRoadMarkings();

      pushUndo({
        type: 'agent_road_create',
        undo: () => {
          const idx = customRoadsList.findIndex(r => r.id === roadRecord.id);
          if (idx > -1) {
            customRoadsList.splice(idx, 1);
            roadsGroup.remove(roadMesh);
          }
          updateHierarchyUI();
        },
        redo: () => {
          roadsGroup.add(roadMesh);
          customRoadsList.push(roadRecord);
          updateHierarchyUI();
        }
      });

      updateHierarchyUI();
      return { ok: true, id: roadRecord.id, type, width, pointsCount: points.length };
    },

    editRoad: async ({ roadId, points = null, type = null, width = null }) => {
      const road = customRoadsList.find(r => r.id === roadId);
      if (!road) return { ok: false, error: `Road ${roadId} not found` };

      const oldPoints = [...road.points];
      const oldType = road.type;
      const oldWidth = road.width;

      if (points) road.points = [...points];
      if (type) road.type = type;
      if (width) road.width = width;

      if (road.mesh) {
        roadsGroup.remove(road.mesh);
        road.mesh.geometry?.dispose();
      }
      road.mesh = generateRoadMesh(road.points, road.width, road.type);
      if (road.mesh) roadsGroup.add(road.mesh);

      pushUndo({
        type: 'agent_road_edit',
        undo: () => {
          road.points = oldPoints;
          road.type = oldType;
          road.width = oldWidth;
          if (road.mesh) { roadsGroup.remove(road.mesh); road.mesh.geometry?.dispose(); }
          road.mesh = generateRoadMesh(oldPoints, oldWidth, oldType);
          if (road.mesh) roadsGroup.add(road.mesh);
          updateHierarchyUI();
        },
        redo: () => {
          if (road.mesh) { roadsGroup.remove(road.mesh); road.mesh.geometry?.dispose(); }
          road.mesh = generateRoadMesh(road.points, road.width, road.type);
          if (road.mesh) roadsGroup.add(road.mesh);
          updateHierarchyUI();
        }
      });

      updateHierarchyUI();
      return { ok: true, roadId, updated: true };
    },

    deleteRoad: async (roadId) => {
      const res = deleteCustomRoad(roadId);
      return { ok: res, roadId };
    },

    listRoads: () => {
      const custom = customRoadsList.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        width: r.width,
        points: r.points
      }));
      const baseline = (roads && roads.paths) ? roads.paths.map(p => ({
        id: p.id,
        class: p.class,
        width: p.width
      })) : [];
      return { ok: true, customRoads: custom, baselineRoads: baseline };
    },

    // 2. Terrain & Ground
    paintGround: async ({ type = 'dirt', center = [0, 0], radius = 5.0, intensity = 0.4 }) => {
      const hitPoint = new T.Vector3(center[0], terrain.height(center[0], center[1]), center[1]);
      const res = applyPaint(hitPoint, type, radius, intensity);

      pushUndo({
        type: 'agent_paint',
        undo: () => {
          if (baseColorArray && res.prevColors) {
            for (const [k, r, g, b] of res.prevColors) {
              baseColorArray[k * 3] = r;
              baseColorArray[k * 3 + 1] = g;
              baseColorArray[k * 3 + 2] = b;
            }
            terrain.syncLiveBuffers(false, true);
            saveStudioState();
          }
        },
        redo: () => {
          applyPaint(hitPoint, type, radius, intensity);
          saveStudioState();
        }
      });

      saveStudioState();
      return { ok: true, type, center, radius, affectedVertices: res.affectedVertices };
    },

    sculptTerrain: async ({ mode = 'raise', center = [0, 0], radius = 6.0, strength = 0.4, targetHeight = null }) => {
      const hitPoint = new T.Vector3(center[0], terrain.height(center[0], center[1]), center[1]);
      const prevSnaps = activeSculptSnaps = new Map();
      const res = applySculpt(hitPoint, mode, radius, strength, targetHeight);
      activeSculptSnaps = null;
      rebuildTerrainGrid();

      pushUndo({
        type: 'agent_sculpt',
        undo: () => {
          if (res.previousHeights) {
            for (const [k, y] of res.previousHeights) basePosArray[k * 3 + 1] = y;
            terrain.syncLiveBuffers(true, false);
            setSnappedHeights(prevSnaps);
            rebuildTerrainGrid();
            saveStudioState();
          }
        },
        redo: () => {
          applySculpt(hitPoint, mode, radius, strength, targetHeight);
          rebuildTerrainGrid();
          saveStudioState();
        }
      });

      saveStudioState();
      return { ok: true, mode, center, radius, affectedVertices: res.affectedVertices };
    },

    getTerrainHeight: (x, z) => terrain.height(x, z),
    resetTerrain: () => { resetTerrainHeights(); return { ok: true }; },
    resetPaint: () => { resetGroundPaint(); return { ok: true }; },

    // 3. Foliage & Props
    scatterVegetation: async ({
      type = 'tree_round',
      center = [0, 0],
      radius = 10.0,
      count = 5,
      minDistance = 2.0,
      autoAvoidRoads = true
    }) => {
      const placed = scatterVegetation({ type, center, radius, count, minDistance, autoAvoidRoads });
      return {
        ok: true,
        placedCount: placed.length,
        assets: placed.map(p => ({
          id: p.name,
          type: p.userData?.assetType,
          position: [Number(p.position.x.toFixed(2)), Number(p.position.y.toFixed(2)), Number(p.position.z.toFixed(2))]
        }))
      };
    },

    placeObject: async ({ type = 'tree_round', position = [0, 0, 0], rotationY = 0, scale = 1.0, name = null }) => {
      const obj = spawnAsset(type, position[0], position[2], scale, rotationY, name);
      if (position[1] !== 0) obj.position.y = position[1];

      pushUndo({
        type: 'agent_place_object',
        undo: () => {
          scene.remove(obj);
          const idx = customPlacedObjects.indexOf(obj);
          if (idx > -1) customPlacedObjects.splice(idx, 1);
          const cIdx = clickable.indexOf(obj);
          if (cIdx > -1) clickable.splice(cIdx, 1);
          updateHierarchyUI();
        },
        redo: () => {
          scene.add(obj);
          customPlacedObjects.push(obj);
          clickable.push(obj);
          updateHierarchyUI();
        }
      });

      updateHierarchyUI();
      return {
        ok: true,
        id: obj.name,
        type,
        position: [Number(obj.position.x.toFixed(2)), Number(obj.position.y.toFixed(2)), Number(obj.position.z.toFixed(2))],
        rotationY: Number(obj.rotation.y.toFixed(3)),
        scale: Number(obj.scale.x.toFixed(2))
      };
    },

    deleteObject: async (idOrObject) => {
      const target = typeof idOrObject === 'string'
        ? customPlacedObjects.find(o => o.name === idOrObject)
        : idOrObject;
      if (!target) return { ok: false, error: 'Object not found' };

      selectCustomObject(target);
      const res = deleteSelectedAsset();
      return { ok: res, deletedId: target.name };
    },

    duplicateObject: async (idOrObject, offset = [1.5, 0, 1.5]) => {
      const target = typeof idOrObject === 'string'
        ? customPlacedObjects.find(o => o.name === idOrObject)
        : idOrObject;
      if (!target) return { ok: false, error: 'Object not found' };

      selectCustomObject(target);
      const clone = duplicateSelected(offset);
      return {
        ok: !!clone,
        originalId: target.name,
        cloneId: clone ? clone.name : null,
        position: clone ? [clone.position.x, clone.position.y, clone.position.z] : null
      };
    },

    clearVegetation: () => {
      clearAllCustomAssets();
      return { ok: true };
    },

    // 4. Object Transformations
    selectObject: (idOrObject) => {
      if (typeof idOrObject === 'string') {
        if (buildingFootprints.has(idOrObject)) {
          selectBuilding(idOrObject);
          return { ok: true, type: 'building', id: idOrObject };
        }
        const custom = customPlacedObjects.find(o => o.name === idOrObject);
        if (custom) {
          selectCustomObject(custom);
          return { ok: true, type: 'custom_asset', id: idOrObject };
        }
        return { ok: false, error: `Object ${idOrObject} not found` };
      }
      selectCustomObject(idOrObject);
      return { ok: true, id: idOrObject.name };
    },

    deselect: () => {
      deselect();
      return { ok: true };
    },

    getSelectedObject: () => {
      if (!selectedObject) return { ok: true, selected: null };
      const grp = selectedObject.group || selectedObject;
      return {
        ok: true,
        selected: {
          id: selectedObject.id || grp.name,
          name: selectedObject.name || grp.name,
          type: selectedObject.grade ? 'building' : (grp.userData?.assetType || 'custom_prop'),
          position: [Number(grp.position.x.toFixed(2)), Number(grp.position.y.toFixed(2)), Number(grp.position.z.toFixed(2))],
          rotationY: Number(grp.rotation.y.toFixed(3)),
          scale: Number(grp.scale.x.toFixed(2))
        }
      };
    },

    rotateObject: async (idOrObject, angleDeg = 90) => {
      let target = null;
      if (typeof idOrObject === 'string') {
        if (buildingFootprints.has(idOrObject)) target = buildingFootprints.get(idOrObject);
        else target = customPlacedObjects.find(o => o.name === idOrObject);
      } else {
        target = idOrObject;
      }
      if (!target) return { ok: false, error: 'Target object not found' };
      const grp = target.group || target;
      selectedObject = target;
      rotateSelectedObject(angleDeg);
      const deg = Math.round((grp.rotation.y * 180) / Math.PI) % 360;
      return { ok: true, id: target.id || target.name, rotationDeg: deg };
    },

    moveObject: async (idOrObject, { position = null, rotationY = null, scale = null }) => {
      let target = null;
      if (typeof idOrObject === 'string') {
        if (buildingFootprints.has(idOrObject)) target = buildingFootprints.get(idOrObject);
        else target = customPlacedObjects.find(o => o.name === idOrObject);
      } else {
        target = idOrObject;
      }
      if (!target) return { ok: false, error: 'Target object not found' };

      const grp = target.group || target;
      const oldPos = [grp.position.x, grp.position.y, grp.position.z];
      const oldRot = grp.rotation.y;
      const oldScale = grp.scale.x;

      if (position) {
        grp.position.set(position[0], position[1] !== undefined ? position[1] : terrain.height(position[0], position[2]), position[2]);
      }
      if (rotationY !== null && rotationY !== undefined) {
        grp.rotation.y = rotationY;
      }
      if (scale !== null && scale !== undefined) {
        grp.scale.set(scale, scale, scale);
      }

      onTransformChange();

      pushUndo({
        type: 'agent_move_object',
        undo: () => {
          grp.position.set(...oldPos);
          grp.rotation.y = oldRot;
          grp.scale.set(oldScale, oldScale, oldScale);
          onTransformChange();
        },
        redo: () => {
          if (position) grp.position.set(position[0], position[1], position[2]);
          if (rotationY !== null) grp.rotation.y = rotationY;
          if (scale !== null) grp.scale.set(scale, scale, scale);
          onTransformChange();
        }
      });

      const col = evaluateCollision(target);
      return {
        ok: true,
        id: target.id || grp.name,
        newPosition: [grp.position.x, grp.position.y, grp.position.z],
        rotationY: grp.rotation.y,
        scale: grp.scale.x,
        collision: col
      };
    },

    // 5. Materials
    setMaterial: (idOrObject, props) => {
      let target = null;
      if (typeof idOrObject === 'string') {
        if (buildingFootprints.has(idOrObject)) target = buildingFootprints.get(idOrObject).group;
        else target = customPlacedObjects.find(o => o.name === idOrObject);
      } else {
        target = idOrObject;
      }
      if (!target) return { ok: false, error: 'Target not found' };

      const res = setMaterialProperties(target, props);
      return { ok: res, targetId: idOrObject, updatedProps: props };
    },

    getMaterial: (idOrObject) => {
      let target = null;
      if (typeof idOrObject === 'string') {
        if (buildingFootprints.has(idOrObject)) target = buildingFootprints.get(idOrObject).group;
        else target = customPlacedObjects.find(o => o.name === idOrObject);
      } else {
        target = idOrObject;
      }
      if (!target) return { ok: false, error: 'Target not found' };
      const mat = getObjectPrimaryMaterial(target);
      if (!mat) return { ok: false, error: 'No material found' };
      return {
        ok: true,
        color: mat.color ? '#' + mat.color.getHexString() : null,
        roughness: mat.roughness,
        metalness: mat.metalness,
        opacity: mat.opacity
      };
    },

    // 6. Scene Hierarchy & Inspection
    getSceneHierarchy,
    getObjectInfo: (idOrObject) => {
      let target = null;
      let isBld = false;
      if (typeof idOrObject === 'string') {
        if (buildingFootprints.has(idOrObject)) {
          target = buildingFootprints.get(idOrObject);
          isBld = true;
        } else {
          target = customPlacedObjects.find(o => o.name === idOrObject);
        }
      } else {
        target = idOrObject;
      }
      if (!target) return { ok: false, error: 'Object not found' };

      const grp = target.group || target;
      const box = new T.Box3().setFromObject(grp);
      const size = new T.Vector3();
      box.getSize(size);

      const col = evaluateCollision(target);

      return {
        ok: true,
        id: target.id || grp.name,
        name: target.name || grp.name,
        isBuilding: isBld,
        position: [grp.position.x, grp.position.y, grp.position.z],
        rotationY: grp.rotation.y,
        scale: [grp.scale.x, grp.scale.y, grp.scale.z],
        bounds: {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
          dimensions: [size.x, size.y, size.z]
        },
        collision: col
      };
    },

    // 7. Spatial & Collision Validation
    validateCollisions: (targetIdOrObject = null) => {
      if (targetIdOrObject) {
        let target = null;
        if (typeof targetIdOrObject === 'string') {
          if (buildingFootprints.has(targetIdOrObject)) target = buildingFootprints.get(targetIdOrObject);
          else target = customPlacedObjects.find(o => o.name === targetIdOrObject);
        } else {
          target = targetIdOrObject;
        }
        if (!target) return { ok: false, error: 'Target not found' };
        const res = evaluateCollision(target);
        return { ok: true, safe: res.safe, result: res };
      }
      return evaluateAllCollisions();
    },

    // 8. Undo, Redo, Persistence
    undo: () => executeUndo(),
    redo: () => executeRedo(),
    saveScene: () => saveStudioState(),
    loadScene: (state) => { const r = loadStudioState(state); return { ok: r.ok }; },
    getSceneState: () => ({ ok: true, state: serializeStudioState() }),
    resetScene: () => {
      resetTerrainHeights();
      resetGroundPaint();
      clearCustomRoads();
      clearAllCustomAssets();
      localStorage.removeItem(STORAGE_KEY);
      showToast('Đã đặt lại toàn bộ Campus về mặc định', '#64748b');
      return { ok: true };
    },

    // 9. Camera & Rendering
    renderView: (viewName) => {
      if (views && views[viewName] && viewFn) {
        viewFn(viewName, { immediate: true });
        return { ok: true, view: viewName, camera: views[viewName] };
      }
      return { ok: false, error: `View '${viewName}' not found` };
    },

    setCamera: ({ position, target, span = null }) => {
      if (position) camera.position.set(...position);
      if (target) {
        controls.target.set(...target);
        camera.lookAt(...target);
      }
      if (span && sync) sync();
      controls.update();
      return { ok: true, position, target };
    },

    captureScreenshot: async (filename = 'campus_screenshot.png') => {
      try {
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');
        if (filename) {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = filename;
          a.click();
        }
        return { ok: true, dataUrlLength: dataUrl.length };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    compareSceneWithBaseline: () => {
      const shifts = [];
      for (const b of L.buildings) {
        const fp = buildingFootprints.get(b.id);
        if (fp) {
          const p = fp.group.position;
          const orig = b.position || [0, 0, 0];
          const dist = Math.hypot(p.x - orig[0], p.z - orig[2]);
          if (dist > 0.1) {
            shifts.push({
              id: b.id,
              name: b.name,
              originalPosition: orig,
              currentPosition: [p.x, p.y, p.z],
              shiftDistance: Number(dist.toFixed(2))
            });
          }
        }
      }
      return {
        ok: true,
        identical: shifts.length === 0,
        shiftedBuildingsCount: shifts.length,
        shifts
      };
    }
  };


  // =========================================================================
  // QUICK LIST HELPERS: BUILDINGS & PROPS
  // =========================================================================
  function updateBuildingsQuickList() {
    const listEl = document.querySelector('#buildings-quick-list');
    if (!listEl) return;
    let html = '';
    for (const [id, fp] of buildingFootprints) {
      const isSelected = selectedObject && (selectedObject.id === id || selectedObject.name === id);
      const p = fp.group.position;
      html += `
        <div class="bld-quick-item" data-id="${id}" style="padding:4px 6px;margin-bottom:2px;cursor:pointer;border-radius:4px;background:${isSelected ? '#dcfce7' : '#ffffff'};border:1px solid ${isSelected ? '#059669' : '#e2e8f0'};display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:${isSelected ? 'bold' : 'normal'};color:${isSelected ? '#065f46' : '#1e293b'};">${fp.name}</span>
          <span style="font-family:monospace;color:#64748b;font-size:8px;">[${p.x.toFixed(1)}, ${p.z.toFixed(1)}]</span>
        </div>`;
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll('.bld-quick-item').forEach(el => {
      el.onclick = () => {
        const id = el.dataset.id;
        const bld = selectBuilding(id);
        if (bld) {
          const p = bld.group.position;
          controls.target.set(p.x, p.y + 4, p.z);
          camera.position.set(p.x + 22, p.y + 24, p.z + 22);
          controls.update();
        }
      };
    });
  }

  function updatePropsListUI() {
    const listEl = document.querySelector('#props-placed-list');
    if (!listEl) return;
    const props = customPlacedObjects.filter(o => o.userData?.isProp);
    if (props.length === 0) {
      listEl.innerHTML = '<span style="color:#94a3b8;font-style:italic;">Chưa có đồ trang trí nào. Click xuống đất để đặt!</span>';
      return;
    }
    let html = '';
    for (const obj of props) {
      const isSelected = selectedObject === obj;
      const p = obj.position;
      const typeLabel = {
        bench: '🪑 Ghế ngồi gỗ',
        lamp: '💡 Đèn sân vườn',
        rock: '🪨 Tảng đá cảnh',
        trash_can: '🗑️ Thùng rác',
        signpost: '🪧 Biển chỉ dẫn'
      }[obj.userData?.assetType] || 'Đạo cụ';
      html += `
        <div class="prop-list-item" data-name="${obj.name}" style="padding:3px 5px;margin-bottom:2px;cursor:pointer;border-radius:4px;background:${isSelected ? '#fef3c7' : '#ffffff'};border:1px solid ${isSelected ? '#d97706' : '#e2e8f0'};display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:${isSelected ? 'bold' : 'normal'};color:${isSelected ? '#92400e' : '#1e293b'};">${typeLabel}</span>
          <span style="font-family:monospace;color:#64748b;font-size:8px;">[${p.x.toFixed(1)}, ${p.z.toFixed(1)}]</span>
        </div>`;
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll('.prop-list-item').forEach(el => {
      el.onclick = () => {
        const name = el.dataset.name;
        const target = customPlacedObjects.find(o => o.name === name);
        if (target) {
          selectCustomObject(target);
          controls.target.set(target.position.x, target.position.y + 1.5, target.position.z);
          controls.update();
        }
      };
    });
  }

  function updateFoliageListUI() {
    const listEl = document.querySelector('#foliage-placed-list');
    if (!listEl) return;
    const foliage = customPlacedObjects.filter(o => o.userData?.isFoliage);
    if (foliage.length === 0) {
      listEl.innerHTML = '<span style="color:#94a3b8;font-style:italic;">Chưa có cây tự trồng nào. Click xuống đất để trồng!</span>';
      return;
    }
    let html = '';
    for (const obj of foliage) {
      const isSelected = selectedObject === obj;
      const p = obj.position;
      const typeLabel = {
        garden1: '🌿 Bụi cây Garden 1',
        plant_bushSmall: '🌱 Bụi cỏ nhỏ',
        plant_bush: '🌿 Bụi cây tròn',
        plant_bushDetailed: '🍀 Bụi cây lá dày',
        tree2: '🌳 Cây tán tròn (Tree 2)',
        tree6: '🌲 Cây tùng (Tree 6)',
        tree_round: '🌳 Cây tán tròn',
        tree_pine: '🌲 Cây thông cao',
        bush: '🌿 Bụi cây cảnh',
        flower_patch: '🌸 Khóm hoa'
      }[obj.userData?.assetType] || 'Cây xanh';
      html += `
        <div class="foliage-list-item" data-name="${obj.name}" style="padding:3px 5px;margin-bottom:2px;cursor:pointer;border-radius:4px;background:${isSelected ? '#dcfce7' : '#ffffff'};border:1px solid ${isSelected ? '#059669' : '#e2e8f0'};display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:${isSelected ? 'bold' : 'normal'};color:${isSelected ? '#065f46' : '#1e293b'};">${typeLabel}</span>
          <span style="font-family:monospace;color:#64748b;font-size:8px;">[${p.x.toFixed(1)}, ${p.z.toFixed(1)}]</span>
        </div>`;
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll('.foliage-list-item').forEach(el => {
      el.onclick = () => {
        const name = el.dataset.name;
        const target = customPlacedObjects.find(o => o.name === name);
        if (target) {
          selectCustomObject(target);
          controls.target.set(target.position.x, target.position.y + 1.5, target.position.z);
          controls.update();
          updateFoliageListUI();
        }
      };
    });
  }

    // Expose global Agent API
  window.CampusAgentAPI = agentAPI;
  window.campusAPI = agentAPI;
  window.CampusEditor = {
    api: agentAPI,
    save: saveStudioState,
    load: loadStudioState,
    undo: executeUndo,
    redo: executeRedo
  };

  // =========================================================================
  // 11. MOUSE & POINTER DISPATCHER
  // =========================================================================
  const raycaster = new T.Raycaster();
  const mouse = new T.Vector2();
  let isPointerDown = false;
  let isShiftDown = false;
  let lastSprayTime = 0;

    function nudgeSelectedObject(direction) {
    if (!selectedObject) {
      showToast('ℹ️ Please click/select an object, building, or road handle first to nudge with WASD!', '#64748b');
      return false;
    }

    const step = (typeof gridStep === 'number' && gridStep > 0) ? gridStep : 1.0;

    // Determine grid step direction relative to camera
    const camRight = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    camRight.y = 0;
    if (camRight.lengthSq() < 0.0001) camRight.set(1, 0, 0);
    else camRight.normalize();

    const screenFwd = new T.Vector3(0, 1, 0).cross(camRight).normalize();

    let targetVec = new T.Vector3();
    if (direction === 'up') targetVec.copy(screenFwd);
    else if (direction === 'down') targetVec.copy(screenFwd).negate();
    else if (direction === 'left') targetVec.copy(camRight).negate();
    else if (direction === 'right') targetVec.copy(camRight);

    let dx = 0, dz = 0;
    if (Math.abs(targetVec.x) > Math.abs(targetVec.z)) {
      dx = targetVec.x > 0 ? step : -step;
    } else {
      dz = targetVec.z > 0 ? step : -step;
    }

    // 1. If selectedObject is nativeProxyObj (Walkway node or Orange court)
    if (selectedObject === nativeProxyObj) {
      if (selectedNativeWalk) {
        const { path, pointIndex } = selectedNativeWalk;
        const curPt = path.points[pointIndex];
        const oldX = curPt[0], oldZ = curPt[1];
        const newX = Math.round((oldX + dx) * 10) / 10;
        const newZ = Math.round((oldZ + dz) * 10) / 10;

        // Find connected junction nodes
        const connectedNodes = [];
        if (roads && roads.paths) {
          for (const p of roads.paths) {
            if (p.hidden || p.class !== 1 || !p.points) continue;
            p.points.forEach((pcoord, idx) => {
              if (Math.hypot(pcoord[0] - oldX, pcoord[1] - oldZ) < 0.25) {
                connectedNodes.push({ path: p, pointIndex: idx, origPt: [pcoord[0], pcoord[1]] });
              }
            });
          }
        }

        // Apply new position to all connected nodes
        for (const node of connectedNodes) {
          if (node.path.points && node.path.points[node.pointIndex]) {
            node.path.points[node.pointIndex] = [newX, newZ];
          }
        }

        nativeProxyObj.position.set(newX, terrain.height(newX, newZ) + 0.22, newZ);
        rebuildTerrainSurfaces();
        syncNativeSurfaceUI();
        updateSelectTargetInfoUI();

        pushUndo({
          type: 'nudge_walk',
          undo: () => {
            for (const node of connectedNodes) {
              if (node.path.points && node.path.points[node.pointIndex]) {
                node.path.points[node.pointIndex] = [node.origPt[0], node.origPt[1]];
              }
            }
            nativeProxyObj.position.set(oldX, terrain.height(oldX, oldZ) + 0.22, oldZ);
            rebuildTerrainSurfaces();
            syncNativeSurfaceUI();
            updateSelectTargetInfoUI();
            saveStudioState();
          },
          redo: () => {
            for (const node of connectedNodes) {
              if (node.path.points && node.path.points[node.pointIndex]) {
                node.path.points[node.pointIndex] = [newX, newZ];
              }
            }
            nativeProxyObj.position.set(newX, terrain.height(newX, newZ) + 0.22, newZ);
            rebuildTerrainSurfaces();
            syncNativeSurfaceUI();
            updateSelectTargetInfoUI();
            saveStudioState();
          }
        });

        showToast(`🟡 Moved walk node #${pointIndex + 1} to [${newX.toFixed(1)}, ${newZ.toFixed(1)}]`, '#ca8a04');
        return true;
      } else if (selectedNativeCourt) {
        const c = selectedNativeCourt;
        const oldX = c.x, oldZ = c.z;
        const newX = Math.round((oldX + dx) * 10) / 10;
        const newZ = Math.round((oldZ + dz) * 10) / 10;
        c.x = newX; c.z = newZ;
        nativeProxyObj.position.set(newX, terrain.height(newX, newZ) + 0.22, newZ);
        rebuildTerrainSurfaces();
        syncNativeSurfaceUI();
        updateSelectTargetInfoUI();

        pushUndo({
          type: 'nudge_court',
          undo: () => {
            c.x = oldX; c.z = oldZ;
            nativeProxyObj.position.set(oldX, terrain.height(oldX, oldZ) + 0.22, oldZ);
            rebuildTerrainSurfaces();
            syncNativeSurfaceUI();
            updateSelectTargetInfoUI();
            saveStudioState();
          },
          redo: () => {
            c.x = newX; c.z = newZ;
            nativeProxyObj.position.set(newX, terrain.height(newX, newZ) + 0.22, newZ);
            rebuildTerrainSurfaces();
            syncNativeSurfaceUI();
            updateSelectTargetInfoUI();
            saveStudioState();
          }
        });

        showToast(`🟠 Moved court ${c.id} to [${newX.toFixed(1)}, ${newZ.toFixed(1)}]`, '#ea580c');
        return true;
      }
    }

    // 2. If selectedObject is building, prop, or foliage
    const grp = selectedObject.group || selectedObject;
    if (grp && grp.position) {
      const oldPos = grp.position.clone();
      const newX = Math.round((oldPos.x + dx) * 10) / 10;
      const newZ = Math.round((oldPos.z + dz) * 10) / 10;
      grp.position.x = newX;
      grp.position.z = newZ;
      if (groundSnapEnabled && !transformControls.showY) {
        grp.position.y = terrain.height(newX, newZ);
      }
      if (grp.userData?.footprint) {
        grp.userData.footprint.position.set(newX, grp.position.y + 0.04, newZ);
      }
      onTransformChange();
      if (typeof evaluateAllCollisions === 'function') evaluateAllCollisions();

      pushUndo({
        type: 'nudge_object',
        undo: () => {
          grp.position.copy(oldPos);
          if (grp.userData?.footprint) grp.userData.footprint.position.set(oldPos.x, oldPos.y + 0.04, oldPos.z);
          onTransformChange();
          if (typeof evaluateAllCollisions === 'function') evaluateAllCollisions();
          saveStudioState();
        },
        redo: () => {
          grp.position.x = newX;
          grp.position.z = newZ;
          if (groundSnapEnabled && !transformControls.showY) grp.position.y = terrain.height(newX, newZ);
          if (grp.userData?.footprint) grp.userData.footprint.position.set(newX, grp.position.y + 0.04, newZ);
          onTransformChange();
          if (typeof evaluateAllCollisions === 'function') evaluateAllCollisions();
          saveStudioState();
        }
      });

      showToast(`📦 Moved object to [${newX.toFixed(1)}, ${newZ.toFixed(1)}]`, '#10b981');
      return true;
    }

    return false;
  }


  window.addEventListener('keydown', e => {
    // 1. ARROW KEYS: Camera navigation controls
    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
    if (!isTyping && (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      // camera-director.js moves the camera for arrow keys, once per frame
      e.preventDefault();
      return;
    }

    // 2. WASD KEYS: Nudge selected object by 1 grid cell (Up, Down, Left, Right)
    if (!isTyping && !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'KeyA' || e.code === 'KeyD')) {
      if (e.code === 'KeyW') nudgeSelectedObject('up');
      else if (e.code === 'KeyS') nudgeSelectedObject('down');
      else if (e.code === 'KeyA') nudgeSelectedObject('left');
      else if (e.code === 'KeyD') nudgeSelectedObject('right');
      e.preventDefault();
      return;
    }

    if (editModeActive && e.key === 'Enter') {
      if (activeTab === 'roads' && currentRoadPoints.length >= 2) {
        finishCurrentRoad();
      }
    }
    if (editModeActive && e.key === 'Escape') {
      if (activeTab === 'roads' && currentRoadPoints.length > 0) {
        for (const h of currentControlHandles) scene.remove(h);
        currentControlHandles = [];
        currentRoadPoints = [];
        rebuildCurrentRoadPreview();
        const ptCountEl = document.querySelector('#road-points-count');
        if (ptCountEl) ptCountEl.textContent = '• Đã hủy vẽ đường. Click để vẽ lại từ đầu.';
      } else {
        deselect();
        deselectRoad();
      }
    }
    if (e.key === 'Shift') {
      isShiftDown = true;
      if (editModeActive && activeTab === 'terrain') {
        controls.enabled = false;
        document.body.style.cursor = 'crosshair';
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editModeActive) {
        if (selectedRoad) {
          deleteCustomRoad(selectedRoad.id);
          deselectRoad();
        } else if (selectedObject) {
          deleteSelectedAsset();
        } else if (activeTab === 'roads' && currentRoadPoints.length > 0) {
          undoLastRoadPoint();
        }
      }
    } else if (e.key === 'Escape') {
      deselect();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) executeRedo();
      else executeUndo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      executeRedo();
    } else if (e.key === 'g' || e.key === 'G') {
      setGridState({ visible: !gridVisible });
      showToast(gridVisible ? '📐 Đã bật lưới Grid' : '📐 Đã tắt lưới Grid', '#0284c7');
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      duplicateSelected();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveStudioState(true);
      showToast('💾 Saved campus studio successfully! [Ctrl+S]', '#059669');
    } else if (e.key === 'w' || e.key === 'W') {
      document.querySelector('#btn-mode-translate')?.click();
    } else if (e.key === 'e' || e.key === 'E') {
      document.querySelector('#btn-mode-rotate')?.click();
    } else if (e.key === 'r' || e.key === 'R') {
      if (selectedObject) {
        rotateSelectedObject(90);
      } else {
        document.querySelector('#btn-mode-rotate')?.click();
      }
    }
  });

  window.addEventListener('keyup', e => {
    if (e.key === 'Shift') {
      isShiftDown = false;
      flattenTargetY = null;
      if (editModeActive && activeTab === 'terrain') {
        controls.enabled = true;
        document.body.style.cursor = 'default';
      }
    }
  });

  // =========================================================================
  // SIMCITY-STYLE GHOST PREVIEW, UNIVERSAL BULLDOZER & GRID ROAD DISPATCHER
  // =========================================================================
  const ghostGroup = new T.Group();
  ghostGroup.name = 'simcity-placement-ghost';
  ghostGroup.visible = false;
  scene.add(ghostGroup);

  const ghostRingGeo = new T.RingGeometry(1.05, 1.32, 32);
  ghostRingGeo.rotateX(-Math.PI / 2);
  const ghostRingMat = new T.MeshBasicMaterial({ color: 0x10b981, side: T.DoubleSide, transparent: true, opacity: 0.88 });
  const ghostRing = new T.Mesh(ghostRingGeo, ghostRingMat);
  ghostGroup.add(ghostRing);

  const ghostBoxGeo = new T.CylinderGeometry(0.75, 0.85, 1.5, 16);
  const ghostBoxMat = new T.MeshBasicMaterial({ color: 0x34d399, wireframe: true, transparent: true, opacity: 0.65 });
  const ghostBody = new T.Mesh(ghostBoxGeo, ghostBoxMat);
  ghostBody.position.y = 0.75;
  ghostGroup.add(ghostBody);

  let ghostRotationY = 0;
  let bulldozeHoveredTarget = null; // { kind: 'gridRoad'|'splineRoad'|'customAsset'|'instancedMesh'|'sceneObject', ... }
  let isDraggingRoad = false;
  let lastDragTile = null;
  let boxStartTile = null;
  let dragRoadBatch = [];
  let eyedropperActive = false;
  let isDraggingAssetLine = false;
  let assetLineStartPt = null;
  const _demolishedRuntimeSnapshots = [];

  const linePreviewGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
  const linePreviewMat = new T.LineBasicMaterial({ color: 0x0284c7, depthTest: false, transparent: true, opacity: 0.9 });
  const linePreviewMesh = new T.Line(linePreviewGeo, linePreviewMat);
  linePreviewMesh.renderOrder = 35;
  linePreviewMesh.visible = false;
  scene.add(linePreviewMesh);

  function placeAssetLine(type, p0, p1, spacing = 4.0) {
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.floor(dist / Math.max(1.0, spacing)));
    const rotY = dist > 0.2 ? Math.atan2(dx, dz) : ghostRotationY;
    const placed = [];
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = Number((p0.x + dx * t).toFixed(2));
      const z = Number((p0.z + dz * t).toFixed(2));
      const obj = spawnAsset(type, x, z, 1.0, rotY);
      if (obj) placed.push(obj);
    }
    if (placed.length > 0) {
      pushUndo({
        type: 'place_asset_line',
        undo: () => {
          for (const o of placed) {
            scene.remove(o);
            const idx = customPlacedObjects.indexOf(o);
            if (idx > -1) customPlacedObjects.splice(idx, 1);
            const cIdx = clickable.indexOf(o);
            if (cIdx > -1) clickable.splice(cIdx, 1);
          }
          deselect();
          updateHierarchyUI();
          updatePropsListUI();
          updateFoliageListUI();
          saveStudioState();
        },
        redo: () => {
          for (const o of placed) {
            scene.add(o);
            customPlacedObjects.push(o);
            clickable.push(o);
          }
          updateHierarchyUI();
          updatePropsListUI();
          updateFoliageListUI();
          saveStudioState();
        }
      });
      selectCustomObject(placed[placed.length - 1]);
      updatePropsListUI();
      updateFoliageListUI();
      saveStudioState();
      showToast(`📏 Đã rải hàng ${placed.length} đối tượng thẳng tắp! (Bấm Ctrl+Z để hoàn tác)`, '#0284c7');
    }
    return placed;
  }

  function restoreAllDemolishedNativeItems() {
    for (const snap of _demolishedRuntimeSnapshots) {
      if (snap.kind === 'instanced' && snap.mesh) {
        snap.mesh.setMatrixAt(snap.instanceId, snap.origMatrix);
        snap.mesh.instanceMatrix.needsUpdate = true;
      } else if (snap.kind === 'sceneObject' && snap.object) {
        snap.object.visible = true;
      }
    }
    _demolishedRuntimeSnapshots.length = 0;
    demolishedNativeItems.length = 0;
    scene.traverse(obj => {
      if (obj.userData?.isNativeProp) obj.visible = true;
    });
    if (roads && roads.paths) {
      for (const p of roads.paths) {
        if (p.class === 1) p.hidden = false;
      }
    }
    if (terrain && terrain.courts) {
      for (const c of terrain.courts) {
        c.hidden = false;
      }
    }
    nativeWalkwaysGroup.visible = true;
    nativeCourtsSmoothGroup.visible = true;
    roadsGroup.visible = true;
    if (layers) {
      for (const l of Object.values(layers)) {
        if (l) l.visible = true;
      }
    }
    rebuildTerrainSurfaces();
    saveStudioState();
    showToast('✨ Đã khôi phục 100% đường xá, cây cối & cảnh quan gốc!', '#059669');
  }

  function promoteNativeTargetToEditable(target) {
    if (!target) return null;
    if (target.kind === 'instancedMesh') {
      const instMesh = target.object;
      const instId = target.instanceId;
      const savedMat = target.origMatrix.clone();
      const rec = {
        kind: 'instanced',
        pos: [Number(target.worldPos.x.toFixed(2)), Number(target.worldPos.z.toFixed(2))]
      };
      demolishedNativeItems.push(rec);
      _demolishedRuntimeSnapshots.push({ kind: 'instanced', mesh: instMesh, instanceId: instId, origMatrix: savedMat });
      instMesh.setMatrixAt(instId, _zeroMat);
      instMesh.instanceMatrix.needsUpdate = true;

      // Create an individual editable 3D Mesh at that exact world transform
      const pos = new T.Vector3();
      const quat = new T.Quaternion();
      const scl = new T.Vector3();
      savedMat.decompose(pos, quat, scl);
      pos.applyMatrix4(instMesh.matrixWorld);

      const group = new T.Group();
      group.name = `native_promoted_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      group.position.copy(pos);
      const euler = new T.Euler().setFromQuaternion(quat, 'YXZ');
      group.rotation.y = euler.y;
      group.scale.copy(scl);

      const clonedMat = Array.isArray(instMesh.material)
        ? instMesh.material.map(m => m.clone())
        : instMesh.material.clone();
      const singleMesh = new T.Mesh(instMesh.geometry, clonedMat);
      singleMesh.castShadow = true;
      singleMesh.receiveShadow = true;
      group.add(singleMesh);

      group.userData.isCustomAsset = true;
      group.userData.isFoliage = true;
      group.userData.assetType = 'tree_round';
      scene.add(group);
      customPlacedObjects.push(group);
      clickable.push(group);

      selectCustomObject(group);
      updateFoliageListUI();
      saveStudioState();
      showToast('👆 Đã tách cây cảnh quan gốc để Sếp tự do Kéo / Xoay / Nhân bản!', '#059669');
      return group;
    }

    if (target.kind === 'sceneObject' && target.object) {
      const obj = target.object;
      // If obj has position (0,0,0) with baked geometry, or is a positioned group:
      const box = new T.Box3().setFromObject(obj);
      const center = box.getCenter(new T.Vector3());
      if (Math.hypot(obj.position.x, obj.position.z) < 0.01 && Math.hypot(center.x, center.z) > 0.5) {
        // Wrap in a pivot group centered at bounding box bottom-center so Gizmo arrows appear right at the object!
        const pivot = new T.Group();
        pivot.name = obj.name || `native_bush_${Date.now()}`;
        const groundY = terrain.height(center.x, center.z);
        pivot.position.set(center.x, groundY, center.z);
        const parent = obj.parent || scene;
        parent.add(pivot);
        obj.position.set(-center.x, -groundY, -center.z);
        pivot.add(obj);
        pivot.userData.isCustomAsset = true;
        pivot.userData.isFoliage = true;
        pivot.userData.assetType = 'garden1';
        customPlacedObjects.push(pivot);
        clickable.push(pivot);
        selectCustomObject(pivot);
        updateFoliageListUI();
        showToast('👆 Đã chọn cụm cây cảnh quan — Kéo mũi tên để di chuyển!', '#059669');
        return pivot;
      } else {
        obj.userData.isCustomAsset = true;
        if (!obj.userData.isProp) obj.userData.isFoliage = true;
        if (!obj.userData.assetType) obj.userData.assetType = obj.userData.isProp ? 'bench' : 'garden1';
        if (!customPlacedObjects.includes(obj)) customPlacedObjects.push(obj);
        if (!clickable.includes(obj)) clickable.push(obj);
        selectCustomObject(obj);
        updatePropsListUI();
        updateFoliageListUI();
        showToast('👆 Đã chọn đối tượng — Kéo mũi tên để di chuyển!', '#059669');
        return obj;
      }
    }
    return null;
  }

  function setEyedropperMode(active) {
    eyedropperActive = active;
    const btn = document.querySelector('#dock-btn-eyedropper');
    if (btn) {
      btn.style.background = active ? '#ec4899' : '#7c3aed';
      btn.style.borderColor = active ? '#fdf2f8' : '#a78bfa';
      btn.textContent = active ? '🧪 Đang hút...' : '🧪 Hút mẫu [I]';
    }
    document.body.style.cursor = active ? 'crosshair' : 'default';
    if (active) {
      showToast('🧪 Chế độ Hút Mẫu: Click vào bất kỳ Cây, Ghế, Ô đường hoặc Hộp cam nào để lấy mẫu!', '#7c3aed');
    }
  }

  function executeEyedropper(raycasterInstance, groundPt) {
    const target = findBulldozeTarget(raycasterInstance, groundPt);
    setEyedropperMode(false);
    if (!target) {
      showToast('⚠️ Không tìm thấy đối tượng tại vị trí vừa click!', '#f59e0b');
      return false;
    }
    if (target.kind === 'gridRoad') {
      const entry = gridRoadsMap.get(`${target.gx},${target.gz}`);
      if (entry) {
        switchTab('roads');
        const rad = document.querySelector('input[name="road-draw-mode"][value="grid"]');
        if (rad) { rad.checked = true; rad.dispatchEvent(new Event('change')); }
        const sel = document.querySelector('#sel-road-type');
        if (sel) { sel.value = entry.type; activeRoadType = entry.type; }
        showToast(`🧪 Đã hút mẫu ô đường (${entry.type}) — Kéo chuột để lát tiếp!`, '#7c3aed');
        return true;
      }
    }
    if (target.kind === 'nativeCourt') {
      switchTab('roads');
      const rad = document.querySelector('input[name="road-draw-mode"][value="native"]');
      if (rad) { rad.checked = true; rad.dispatchEvent(new Event('change')); }
      selectNativeCourt(target.court);
      showToast(`🧪 Đã chọn Hộp màu cam (${target.court.id})!`, '#ea580c');
      return true;
    }
    if (target.kind === 'nativeWalk') {
      switchTab('roads');
      const rad = document.querySelector('input[name="road-draw-mode"][value="native"]');
      if (rad) { rad.checked = true; rad.dispatchEvent(new Event('change')); }
      selectNativeWalkPoint(target.path, 0);
      showToast(`🧪 Đã chọn Đường màu vàng (${target.path.id})!`, '#ca8a04');
      return true;
    }
    if (target.kind === 'customAsset' && target.object) {
      const obj = target.object;
      const aType = obj.userData?.assetType || 'garden1';
      ghostRotationY = obj.rotation.y || 0;
      if (obj.userData?.isProp) {
        switchTab('props');
        const sel = document.querySelector('#sel-prop-type');
        if (sel) sel.value = aType;
      } else {
        switchTab('foliage');
        const sel = document.querySelector('#sel-foliage-type');
        if (sel) sel.value = aType;
      }
      showToast(`🧪 Đã hút mẫu "${aType}" — Click xuống đất để đặt tiếp!`, '#7c3aed');
      return true;
    }
    if (target.kind === 'instancedMesh' || target.kind === 'sceneObject') {
      const isBench = target.object?.userData?.isProp || target.object?.name?.includes('bench');
      if (isBench) {
        switchTab('props');
        const sel = document.querySelector('#sel-prop-type');
        if (sel) sel.value = 'bench';
        showToast('🧪 Đã hút mẫu Ghế gỗ công viên — Click xuống đất để đặt tiếp!', '#7c3aed');
      } else {
        switchTab('foliage');
        const sel = document.querySelector('#sel-foliage-type');
        const aType = target.kind === 'sceneObject' ? 'garden1' : 'tree_round';
        if (sel) sel.value = aType;
        showToast(`🧪 Đã hút mẫu Cây cảnh quan (${aType}) — Click xuống đất để trồng tiếp!`, '#7c3aed');
      }
      return true;
    }
    return false;
  }

  const _tmpMat = new T.Matrix4();
  const _tmpPos = new T.Vector3();
  const _tmpQuat = new T.Quaternion();
  const _tmpScale = new T.Vector3();
  const _zeroMat = new T.Matrix4().makeScale(0, 0, 0);

  function isProtectedBuildingObject(obj) {
    let cur = obj;
    while (cur && cur !== scene) {
      if (cur.userData?.buildingId && buildingFootprints.has(cur.userData.buildingId)) return true;
      for (const [, fp] of buildingFootprints) {
        if (fp.group === cur) return true;
      }
      cur = cur.parent;
    }
    return false;
  }

  function countMeshesInObject(obj) {
    let count = 0;
    obj.traverse(c => { if (c.isMesh) count++; });
    return count;
  }

  
  // Reusable red ribbon overlay for highlighting specific road segments in Bulldozer mode
  const _bulldozeSegGeo = new T.BufferGeometry();
  const _bulldozeSegMat = new T.MeshBasicMaterial({
    color: 0xdc2626,
    transparent: true,
    opacity: 0.85,
    side: T.DoubleSide,
    depthTest: false
  });
  const bulldozeRoadSegMesh = new T.Mesh(_bulldozeSegGeo, _bulldozeSegMat);
  bulldozeRoadSegMesh.name = 'bulldoze-road-segment-highlighter';
  bulldozeRoadSegMesh.renderOrder = 9999;
  bulldozeRoadSegMesh.visible = false;
  scene.add(bulldozeRoadSegMesh);

  function updateRoadSegmentHighlightMesh(ptA, ptB, width = 2.0) {
    const ax = ptA[0], az = ptA[1];
    const bx = ptB[0], bz = ptB[1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const hw = (width / 2) + 0.12;
    const nx = -dz / len * hw;
    const nz = dx / len * hw;

    const N = Math.max(6, Math.ceil(len / 0.5));
    const positions = [];
    const indices = [];

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const mx = ax + t * dx;
      const mz = az + t * dz;

      const p1x = mx + nx, p1z = mz + nz;
      const p1y = (sampleGroundSurfaceY ? sampleGroundSurfaceY(p1x, p1z) : (terrain.height ? terrain.height(p1x, p1z) : 0)) + 0.085;

      const p2x = mx - nx, p2z = mz - nz;
      const p2y = (sampleGroundSurfaceY ? sampleGroundSurfaceY(p2x, p2z) : (terrain.height ? terrain.height(p2x, p2z) : 0)) + 0.085;

      positions.push(p1x, p1y, p1z, p2x, p2y, p2z);

      if (i < N) {
        const v = i * 2;
        indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }

    _bulldozeSegGeo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    _bulldozeSegGeo.setIndex(indices);
    _bulldozeSegGeo.computeVertexNormals();
    _bulldozeSegGeo.attributes.position.needsUpdate = true;
  }

  function findNearestRoadSegment(path, px, pz) {
    if (!path || !path.points || path.points.length < 2) return null;
    let bestIdx = 0;
    let minD = Infinity;
    for (let i = 0; i < path.points.length - 1; i++) {
      const ax = path.points[i][0], az = path.points[i][1];
      const bx = path.points[i + 1][0], bz = path.points[i + 1][1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const projX = ax + t * dx;
      const projZ = az + t * dz;
      const d = Math.hypot(px - projX, pz - projZ);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    return { segIdx: bestIdx, dist: minD };
  }

  function setBulldozeHighlight(targetInfo, highlight) {
    if (bulldozeRoadSegMesh) {
      bulldozeRoadSegMesh.visible = false;
    }
    if (!targetInfo) return;

    if (targetInfo.kind === 'roadSegment') {
      if (highlight && targetInfo.ptA && targetInfo.ptB) {
        updateRoadSegmentHighlightMesh(targetInfo.ptA, targetInfo.ptB, targetInfo.width || 2.0);
        bulldozeRoadSegMesh.visible = true;
      }
      return;
    }

    const obj = targetInfo.object;
    if (!obj || targetInfo.kind === 'instancedMesh') return;
    obj.traverse(c => {
      if (c.isMesh && c.material) {
        // Clone shared material on first highlight so we don't turn all bushes/trees red at once
        if (highlight && !c.userData._matClonedForHighlight) {
          // Material.clone() bỏ onBeforeCompile: giữ lại để bản sao vẫn có lưới gạch (paving-pattern.js)
          const cloneKeepingShader = m => {
            const k = m.clone();
            k.onBeforeCompile = m.onBeforeCompile;
            k.customProgramCacheKey = m.customProgramCacheKey;
            return k;
          };
          c.material = Array.isArray(c.material) ? c.material.map(cloneKeepingShader) : cloneKeepingShader(c.material);
          c.userData._matClonedForHighlight = true;
        }
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) {
          if (highlight) {
            if (m.userData._origColor === undefined && m.color) {
              m.userData._origColor = m.color.getHex();
            }
            if (m.userData._origEmissive === undefined && m.emissive) {
              m.userData._origEmissive = m.emissive.getHex();
            }
            if (m.emissive) m.emissive.setHex(0xdc2626);
            else if (m.color) m.color.setHex(0xef4444);
          } else {
            if (m.userData._origEmissive !== undefined && m.emissive) {
              m.emissive.setHex(m.userData._origEmissive);
            }
            if (m.userData._origColor !== undefined && m.color) {
              m.color.setHex(m.userData._origColor);
            }
          }
        }
      }
    });
  }

  // Helper: check if a group is a large container (island, courtyard, district) so we DO NOT climb into it
  function isBulldozeContainerGroup(group) {
    if (!group || group === scene || group === roadsGroup) return true;
    const name = (group.name || '').toLowerCase();
    if (
      name.includes('island') || name.includes('courtyard') || name.includes('plaza') || 
      name.includes('gardens') || name.includes('polish') || name.includes('commons') || 
      name.includes('step') || name.includes('district') || name.includes('greens') || 
      name.includes('layer') || name.includes('smooth') || name.includes('container') ||
      name.includes('root') || name.includes('foliage') || name.includes('bays') ||
      name.includes('road-and-curbs')
    ) {
      return true;
    }
    if (group.children && group.children.length > 3) return true;
    if (group.children && group.children.length > 1) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      let count = 0;
      for (const ch of group.children) {
        if (ch.isMesh || ch.isGroup) {
          count++;
          const wp = new ch.position.constructor();
          ch.getWorldPosition(wp);
          if (wp.x < minX) minX = wp.x;
          if (wp.x > maxX) maxX = wp.x;
          if (wp.z < minZ) minZ = wp.z;
          if (wp.z > maxZ) maxZ = wp.z;
        }
      }
      if (count > 1 && Math.hypot(maxX - minX, maxZ - minZ) > 1.2) {
        return true;
      }
    }
    return false;
  }

  // Universal Bulldozer Target Finder: finds Grid Road Tiles, Granular Road Segments, Individual Trees/Bushes, and Plazas/Courts
  function findBulldozeTarget(raycasterInstance, groundPt) {
    // 1. Raycast all scene objects first (trees, bushes, benches, road meshes)
    const allHits = raycasterInstance.intersectObjects(scene.children, true);
    for (const h of allHits) {
      // Bấm vào bó vỉa = bấm vào chính sân của nó
      const o = h.object?.userData?.isCourtCurb ? h.object.parent : h.object;
      if (!o || !o.visible) continue;
      if (
        o === tMesh ||
        o.name === 'continuous-ground' ||
        o.name === 'river-only' ||
        o.name === 'grid-helper' ||
        o === brushMarker ||
        o === bulldozeRoadSegMesh ||
        ghostGroup.children.includes(o) ||
        tileCursorGroup.children.includes(o) ||
        isTransformGizmoObject(o)
      ) {
        continue;
      }
      // Check if any ancestor is invisible or is a protected building
      let anc = o;
      let hiddenAncestor = false;
      while (anc && anc !== scene) {
        if (!anc.visible || anc === gridHelper || anc === ghostGroup || anc === tileCursorGroup) {
          hiddenAncestor = true;
          break;
        }
        anc = anc.parent;
      }
      if (hiddenAncestor) continue;
      if (isProtectedBuildingObject(o)) continue;
      if (o.userData?.studioPassThrough) continue; // vạch sơn / mặt nhựa vành đai: nhìn xuyên qua để chọn đúng thứ bên dưới

      // Case A0: mặt sân cam dựng mesh riêng -> ủi qua trạng thái court.hidden (được lưu và dựng lại), không chỉ ẩn mesh
      if (o.userData?.isSmoothCourtMesh) {
        const court = terrain?.courts?.find(c => c.id === o.userData.courtId);
        if (court) {
          return {
            kind: 'nativeCourt',
            court,
            object: o,
            label: `🟧 Hộp sân màu cam (${court.id})`,
            point: h.point
          };
        }
      }

      // Case A1: SimCity Grid Road Tile Mesh
      let cur = o;
      while (cur && cur !== scene) {
        if (cur.userData?.isGridRoadTile && cur.userData?.tileKey) {
          const entry = gridRoadsMap.get(cur.userData.tileKey);
          if (entry) {
            return {
              kind: 'gridRoad',
              gx: entry.gx,
              gz: entry.gz,
              object: entry.mesh,
              label: `Ô đường [${entry.gx}, ${entry.gz}]`,
              point: h.point
            };
          }
        }

        // Case A2: Granular Native Yellow Walkway Segment (Tách thành từng khúc nhỏ ngưng ở mối nối)
        if (cur.userData?.isNativeWalkMesh || cur.parent?.name === 'native_campus_walkways_smooth') {
          const wId = cur.userData?.walkId;
          const p = (roads && roads.paths) ? roads.paths.find(x => x.id === wId) : null;
          if (p && p.points && p.points.length >= 2) {
            const segInfo = findNearestRoadSegment(p, h.point.x, h.point.z);
            const sIdx = segInfo ? Math.min(segInfo.segIdx, p.points.length - 2) : 0;
            return {
              kind: 'roadSegment',
              isNative: true,
              path: p,
              roadId: p.id,
              segIdx: sIdx,
              ptA: p.points[sIdx],
              ptB: p.points[sIdx + 1],
              width: p.width || 2.0,
              label: `Khúc đường vàng [${sIdx + 1}/${p.points.length - 1}] (${p.id})`,
              point: h.point
            };
          }
        }

        // Case A3: Granular Custom Spline Road Segment (Đường tự vẽ tách thành từng khúc)
        if (cur.userData?.isCustomRoad || cur.name?.startsWith('custom_road_')) {
          const r = customRoadsList.find(x => x.mesh === cur || x.id === cur.userData?.roadId);
          if (r && r.points && r.points.length >= 2) {
            const segInfo = findNearestRoadSegment(r, h.point.x, h.point.z);
            const sIdx = segInfo ? Math.min(segInfo.segIdx, r.points.length - 2) : 0;
            return {
              kind: 'roadSegment',
              isNative: false,
              customRoad: r,
              roadId: r.id,
              segIdx: sIdx,
              ptA: r.points[sIdx],
              ptB: r.points[sIdx + 1],
              width: r.width || 2.0,
              label: `Khúc đường tự vẽ [${sIdx + 1}/${r.points.length - 1}]`,
              point: h.point
            };
          }
        }

        // Case A4: Custom Placed Props/Trees
        if (cur.userData?.isCustomAsset) {
          return {
            kind: 'customAsset',
            object: cur,
            label: `Cây/Đồ vật (${cur.userData.assetType || cur.name})`,
            point: h.point
          };
        }
        cur = cur.parent;
      }

      // Case B: InstancedMesh (Campus native trees, shrubs, flowers, rocks)
      if (o.isInstancedMesh && h.instanceId !== undefined) {
        o.getMatrixAt(h.instanceId, _tmpMat);
        _tmpMat.decompose(_tmpPos, _tmpQuat, _tmpScale);
        if (_tmpScale.lengthSq() < 0.0001) continue; // Already demolished instance
        _tmpPos.applyMatrix4(o.matrixWorld);
        return {
          kind: 'instancedMesh',
          object: o,
          instanceId: h.instanceId,
          origMatrix: _tmpMat.clone(),
          worldPos: _tmpPos.clone(),
          label: `Cây/Bụi đơn lẻ (#${h.instanceId})`,
          point: _tmpPos.clone()
        };
      }

      // Case C: Granular Existing Landscape Object (Tách từng CÂY ĐƠN LẺ, từng BỒN HOA, từng GHẾ ĐÁ, từng NỀN SÂN)
      let targetObj = o;
      let p = o.parent;
      while (p && p !== scene && p !== roadsGroup) {
        if (isBulldozeContainerGroup(p)) {
          break; // Dừng lại ở cấp độ cây đơn lẻ / bồn hoa đơn lẻ, không leo lên cả cụm đảo hay cả sân!
        }
        targetObj = p;
        p = p.parent;
      }
      // Skip water/sky/labels
      if (targetObj.name?.includes('water') || targetObj.name?.includes('river') || targetObj.name?.includes('label')) continue;
      return {
        kind: 'sceneObject',
        object: targetObj,
        label: `Tiểu cảnh đơn lẻ (${targetObj.name || 'Cây / Bồn cây / Khối gạch'})`,
        point: h.point
      };
    }

    // 2. Fallback: Check if ground point is inside a Grid Road Tile OR a Native Yellow Walkway / Orange Court Box!
    if (groundPt) {
      const { gx, gz } = worldToTile(groundPt.x, groundPt.z, gridStep);
      const key = `${gx},${gz}`;
      if (gridRoadsMap.has(key)) {
        const entry = gridRoadsMap.get(key);
        return {
          kind: 'gridRoad',
          gx,
          gz,
          object: entry.mesh,
          label: `Ô đường [${gx}, ${gz}]`,
          point: groundPt
        };
      }
      const nativeSurf = findNativeSurfaceAtPoint(groundPt.x, groundPt.z);
      if (nativeSurf) {
        if (nativeSurf.kind === 'walk') {
          const p = nativeSurf.path;
          if (p && p.points && p.points.length >= 2) {
            const segInfo = findNearestRoadSegment(p, groundPt.x, groundPt.z);
            const sIdx = segInfo ? Math.min(segInfo.segIdx, p.points.length - 2) : 0;
            return {
              kind: 'roadSegment',
              isNative: true,
              path: p,
              roadId: p.id,
              segIdx: sIdx,
              ptA: p.points[sIdx],
              ptB: p.points[sIdx + 1],
              width: p.width || 2.0,
              label: `Khúc đường vàng [${sIdx + 1}/${p.points.length - 1}] (${p.id})`,
              point: groundPt
            };
          }
        }
        if (nativeSurf.kind === 'court') {
          return {
            kind: 'nativeCourt',
            court: nativeSurf.court,
            label: `🟧 Hộp sân màu cam (${nativeSurf.court.id})`,
            point: groundPt
          };
        }
      }
    }

    return null;
  }

  function executeBulldozeTarget(target) {
    if (!target) return false;
    setBulldozeHighlight(target, false);

    // 1. ỦI Ô ĐƯỜNG LƯỚI (SimCity Grid Road Tile: 1 ô 2x2m duy nhất)
    if (target.kind === 'gridRoad') {
      removeGridRoadTile(target.gx, target.gz, true);
      saveStudioState();
      showToast(`🚜 Đã ủi ô đường [${target.gx}, ${target.gz}]!`, '#dc2626');
      return true;
    }

    // 2. ỦI ĐOẠN ĐƯỜNG NGẮN GIỮA 2 MỐI NỐI (Granular Road Segment: Tách khúc nhỏ ngưng ở các mối nối)
    if (target.kind === 'roadSegment') {
      if (target.isNative && target.path) {
        const p = target.path;
        const pts = p.points;
        const i = target.segIdx;
        const oldPts = pts.map(pt => [...pt]);
        let addedBranch = null;

        if (!pts || pts.length <= 2) {
          p.hidden = true;
          if (selectedNativeWalk && selectedNativeWalk.path === p) {
            selectedNativeWalk = null;
            deselect();
          }
        } else if (i === 0) {
          p.points = pts.slice(1);
          p.curve = new T.CatmullRomCurve3(p.points.map(pt => new T.Vector3(pt[0], 0, pt[1])), false, 'centripetal');
        } else if (i >= pts.length - 2) {
          p.points = pts.slice(0, -1);
          p.curve = new T.CatmullRomCurve3(p.points.map(pt => new T.Vector3(pt[0], 0, pt[1])), false, 'centripetal');
        } else {
          // Đoạn giữa: Tách làm 2 nhánh độc lập dừng ở mối nối
          const branch1 = pts.slice(0, i + 1);
          const branch2 = pts.slice(i + 1);
          p.points = branch1;
          p.curve = new T.CatmullRomCurve3(branch1.map(pt => new T.Vector3(pt[0], 0, pt[1])), false, 'centripetal');
          addedBranch = {
            id: `${p.id}_split_${Date.now()}`,
            points: branch2,
            width: p.width || 2.0,
            class: 1,
            curve: new T.CatmullRomCurve3(branch2.map(pt => new T.Vector3(pt[0], 0, pt[1])), false, 'centripetal')
          };
          roads.paths.push(addedBranch);
        }

        rebuildTerrainSurfaces();
        rebuildNativeWalkwaysAndCourtsMeshes();
        saveStudioState();
        pushUndo({
          type: 'bulldoze_road_segment',
          undo: () => {
            p.hidden = false;
            p.points = oldPts;
            p.curve = new T.CatmullRomCurve3(oldPts.map(pt => new T.Vector3(pt[0], 0, pt[1])), false, 'centripetal');
            if (addedBranch) {
              const bIdx = roads.paths.indexOf(addedBranch);
              if (bIdx > -1) roads.paths.splice(bIdx, 1);
            }
            rebuildTerrainSurfaces();
            rebuildNativeWalkwaysAndCourtsMeshes();
            saveStudioState();
          },
          redo: () => {
            executeBulldozeTarget(target);
          }
        });
        showToast(`🚜 Đã ủi khúc đường [${i + 1}] giữa 2 mối nối! (Ctrl+Z để khôi phục)`, '#dc2626');
        return true;
      } else if (!target.isNative && target.customRoad) {
        const r = target.customRoad;
        const pts = r.points;
        const i = target.segIdx;
        const oldPts = pts.map(pt => [...pt]);
        let addedRoad = null;

        if (!pts || pts.length <= 2) {
          deleteCustomRoad(r.id); // tự ghi undo và báo toast
          saveStudioState();
          return true;
        } else if (i === 0) {
          r.points = pts.slice(1);
          updateCustomRoadMesh(r);
        } else if (i >= pts.length - 2) {
          r.points = pts.slice(0, -1);
          updateCustomRoadMesh(r);
        } else {
          const branch1 = pts.slice(0, i + 1);
          const branch2 = pts.slice(i + 1);
          r.points = branch1;
          updateCustomRoadMesh(r);
          addedRoad = createCustomSplineRoad(branch2, r.width, r.type, roads?.paths?.find(x => x.id === r.id) || null);
        }

        saveStudioState();
        const newPts = r.points.map(pt => [...pt]);
        pushUndo({
          type: 'bulldoze_custom_road_segment',
          undo: () => {
            if (addedRoad) setCustomRoadAttached(addedRoad, false);
            r.points = oldPts.map(pt => [...pt]);
            updateCustomRoadMesh(r);
            saveStudioState();
          },
          // Dựng lại đúng kết quả đã ủi (không gọi lại executeBulldozeTarget: nó sẽ tạo thêm một nhánh và một mục undo mới)
          redo: () => {
            r.points = newPts.map(pt => [...pt]);
            updateCustomRoadMesh(r);
            if (addedRoad) setCustomRoadAttached(addedRoad, true);
            saveStudioState();
          }
        });
        showToast(`🚜 Đã ủi khúc đường tự vẽ [${i + 1}] giữa 2 mối nối! (Ctrl+Z để khôi phục)`, '#dc2626');
        return true;
      }
    }

    // 3. ỦI ĐỒ VẬT TỰ ĐẶT (Custom Asset: 1 đồ vật duy nhất)
    if (target.kind === 'customAsset') {
      selectCustomObject(target.object);
      deleteSelectedAsset();
      updatePropsListUI();
      saveStudioState();
      showToast(`🚜 Đã ủi ${target.label}!`, '#dc2626');
      return true;
    }

    // 4. ỦI CÂY/BỤI INSTANCED (1 cây đơn lẻ duy nhất)
    if (target.kind === 'instancedMesh') {
      const instMesh = target.object;
      const instId = target.instanceId;
      const savedMat = target.origMatrix.clone();
      const rec = {
        kind: 'instanced',
        pos: [Number(target.worldPos.x.toFixed(2)), Number(target.worldPos.z.toFixed(2))]
      };
      demolishedNativeItems.push(rec);
      _demolishedRuntimeSnapshots.push({ kind: 'instanced', mesh: instMesh, instanceId: instId, origMatrix: savedMat });
      instMesh.setMatrixAt(instId, _zeroMat);
      instMesh.instanceMatrix.needsUpdate = true;
      saveStudioState();
      pushUndo({
        type: 'bulldoze_instance',
        undo: () => {
          instMesh.setMatrixAt(instId, savedMat);
          instMesh.instanceMatrix.needsUpdate = true;
          const idx = demolishedNativeItems.indexOf(rec);
          if (idx > -1) demolishedNativeItems.splice(idx, 1);
          saveStudioState();
        },
        redo: () => {
          instMesh.setMatrixAt(instId, _zeroMat);
          instMesh.instanceMatrix.needsUpdate = true;
          demolishedNativeItems.push(rec);
          saveStudioState();
        }
      });
      showToast(`🚜 Đã ủi ${target.label}! (Bấm Ctrl+Z để khôi phục)`, '#dc2626');
      return true;
    }

    // 5. ỦI TIỂU CẢNH ĐƠN LẺ / CÂY ĐƠN LẺ / BỒN GẠCH ĐƠN LẺ (SceneObject: Tách từng cái một, không mất cả cụm)
    if (target.kind === 'sceneObject') {
      const obj = target.object;
      const box = new T.Box3().setFromObject(obj);
      const center = box.getCenter(new T.Vector3());
      const sz = box.getSize(new T.Vector3());
      const radius = Math.max(0.6, Math.max(sz.x, sz.z) / 2);
      const rec = {
        kind: 'sceneObject',
        name: obj.name || '',
        pos: [Number(center.x.toFixed(2)), Number(center.z.toFixed(2))],
        radius: Number(radius.toFixed(2))
      };
      demolishedNativeItems.push(rec);
      _demolishedRuntimeSnapshots.push({ kind: 'sceneObject', object: obj });
      obj.visible = false;
      saveStudioState(true);
      pushUndo({
        type: 'bulldoze_scene_object',
        undo: () => {
          obj.visible = true;
          const idx = demolishedNativeItems.indexOf(rec);
          if (idx > -1) demolishedNativeItems.splice(idx, 1);
          saveStudioState();
        },
        redo: () => {
          obj.visible = false;
          demolishedNativeItems.push(rec);
          saveStudioState();
        }
      });
      showToast(`🚜 Đã ủi ${target.label}! (Bấm Ctrl+Z để khôi phục)`, '#dc2626');
      return true;
    }

    // 6. ỦI HỘP SÂN MÀU CAM (Native Court Box: 1 hộp duy nhất)
    if (target.kind === 'nativeCourt') {
      const c = target.court;
      c.hidden = true;
      if (selectedNativeCourt === c) {
        selectedNativeCourt = null;
        deselect();
      }
      rebuildTerrainSurfaces();
      syncNativeSurfaceUI();
      saveStudioState();
      pushUndo({
        type: 'bulldoze_native_court',
        undo: () => {
          c.hidden = false;
          rebuildTerrainSurfaces();
          syncNativeSurfaceUI();
          saveStudioState();
        },
        redo: () => {
          c.hidden = true;
          rebuildTerrainSurfaces();
          syncNativeSurfaceUI();
          saveStudioState();
        }
      });
      showToast(`🚜 Đã ủi Hộp Sân Cam (${c.id})! (Ctrl+Z để khôi phục)`, '#dc2626');
      return true;
    }

    return false;
  }

  function smartAlignSelectedBuildingToRoad() {
    if (!selectedObject || !selectedObject.group) {
      showToast('⚠️ Hãy click chọn một tòa nhà trước!', '#f59e0b');
      return;
    }
    const grp = selectedObject.group;
    const bx = grp.position.x, bz = grp.position.z;
    let bestDist = Infinity;
    let bestPt = null;

    if (roads && roads.paths) {
      for (const p of roads.paths) {
        if (!p.curve) continue;
        for (let i = 0; i <= 40; i++) {
          const q = p.curve.getPointAt(i / 40);
          const d = Math.hypot(q.x - bx, q.z - bz);
          if (d < bestDist) {
            bestDist = d;
            bestPt = q;
          }
        }
      }
    }
    for (const [, tile] of gridRoadsMap) {
      const tx = tile.gx * tile.step, tz = tile.gz * tile.step;
      const d = Math.hypot(tx - bx, tz - bz);
      if (d < bestDist) {
        bestDist = d;
        bestPt = { x: tx, z: tz };
      }
    }
    for (const r of customRoadsList) {
      for (const pt of r.points) {
        const d = Math.hypot(pt[0] - bx, pt[1] - bz);
        if (d < bestDist) {
          bestDist = d;
          bestPt = { x: pt[0], z: pt[1] };
        }
      }
    }

    if (bestPt) {
      const angle = Math.atan2(bestPt.x - bx, bestPt.z - bz);
      const stepRad = Math.PI / 4;
      const snappedAngle = Math.round(angle / stepRad) * stepRad;
      grp.rotation.y = snappedAngle;
      onTransformChange();
      saveStudioState();
      const deg = Math.round((snappedAngle * 180) / Math.PI);
      showToast(`🧲 Đã tự động xoay mặt tiền hướng ra đường (${deg}°)!`, '#0284c7');
    }
  }

  renderer.domElement.addEventListener('pointerup', e => {
    isPointerDown = false;
    flattenTargetY = null;

    if (isDraggingAssetLine && assetLineStartPt) {
      isDraggingAssetLine = false;
      linePreviewMesh.visible = false;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const hp = intersectGround(raycaster) || assetLineStartPt;
      const startPt = assetLineStartPt;
      assetLineStartPt = null;
      if (activeTab === 'props') {
        const selType = document.querySelector('#sel-prop-type')?.value || 'bench';
        const spacing = parseFloat(document.querySelector('#sel-prop-line-spacing')?.value) || 4.0;
        placeAssetLine(selType, startPt, hp, spacing);
      } else if (activeTab === 'foliage') {
        const selType = document.querySelector('#sel-foliage-type')?.value || 'garden1';
        const spacing = parseFloat(document.querySelector('#sel-foliage-line-spacing')?.value) || 4.0;
        placeAssetLine(selType, startPt, hp, spacing);
      }
      return;
    }

    const sculptStroke = activeSculptStroke;
    const prevSnaps = activeSculptSnaps || new Map();
    activeSculptStroke = null;
    activeSculptSnaps = null;
    if (sculptStroke && sculptStroke.size > 0) {
      const prevMap = sculptStroke;
      const nextMap = new Map();
      for (const [idx] of prevMap) {
        nextMap.set(idx, basePosArray[idx * 3 + 1]);
      }
      const nextSnaps = new Map();
      for (const [obj] of prevSnaps) nextSnaps.set(obj, obj.position.y);
      rebuildTerrainGrid();
      refreshAllRoadsOnTerrainChange();
      pushUndo({
        type: 'terrain_sculpt_stroke',
        undo: () => {
          for (const [idx, y] of prevMap) basePosArray[idx * 3 + 1] = y;
          terrain.syncLiveBuffers(true, false);
          setSnappedHeights(prevSnaps);
          rebuildTerrainGrid();
          refreshAllRoadsOnTerrainChange();
          saveStudioState();
        },
        redo: () => {
          for (const [idx, y] of nextMap) basePosArray[idx * 3 + 1] = y;
          terrain.syncLiveBuffers(true, false);
          setSnappedHeights(nextSnaps);
          rebuildTerrainGrid();
          refreshAllRoadsOnTerrainChange();
          saveStudioState();
        }
      });
      saveStudioState();
    }

    const paintStroke = activePaintStroke;
    activePaintStroke = null;
    if (paintStroke && paintStroke.size > 0) {
      const prevMap = paintStroke;
      const nextMap = new Map();
      for (const [idx] of prevMap) {
        nextMap.set(idx, [baseColorArray[idx * 3], baseColorArray[idx * 3 + 1], baseColorArray[idx * 3 + 2]]);
      }
      pushUndo({
        type: 'terrain_paint_stroke',
        undo: () => {
          for (const [idx, [r, g, b]] of prevMap) {
            baseColorArray[idx * 3] = r;
            baseColorArray[idx * 3 + 1] = g;
            baseColorArray[idx * 3 + 2] = b;
          }
          terrain.syncLiveBuffers(false, true);
          saveStudioState();
        },
        redo: () => {
          for (const [idx, [r, g, b]] of nextMap) {
            baseColorArray[idx * 3] = r;
            baseColorArray[idx * 3 + 1] = g;
            baseColorArray[idx * 3 + 2] = b;
          }
          terrain.syncLiveBuffers(false, true);
          saveStudioState();
        }
      });
      saveStudioState();
    }

    if (isDraggingRoad) {
      isDraggingRoad = false;
      lastDragTile = null;
      boxStartTile = null;
      if (dragRoadBatch.length > 0) {
        const batch = [...dragRoadBatch];
        dragRoadBatch = [];
        pushUndo({
          type: 'grid_road_batch',
          undo: () => {
            for (const item of batch) {
              if (item.action === 'place') {
                if (item.prevType) placeGridRoadTile(item.gx, item.gz, item.prevType, item.step, false);
                else removeGridRoadTile(item.gx, item.gz, false);
              } else if (item.action === 'remove' && item.prevType) {
                placeGridRoadTile(item.gx, item.gz, item.prevType, item.step, false);
              }
            }
            renderRoadsDynamicList();
            saveStudioState();
          },
          redo: () => {
            for (const item of batch) {
              if (item.action === 'place') {
                placeGridRoadTile(item.gx, item.gz, item.newType, item.step, false);
              } else if (item.action === 'remove') {
                removeGridRoadTile(item.gx, item.gz, false);
              }
            }
            renderRoadsDynamicList();
            saveStudioState();
          }
        });
        saveStudioState();
        showToast(`🛣️ Đã lát xong ${batch.length} ô đường SimCity!`, '#059669');
      }
    }
  });

  renderer.domElement.addEventListener('pointermove', e => {
    if (!editModeActive) {
      ghostGroup.visible = false;
      tileCursorGroup.visible = false;
      linePreviewMesh.visible = false;
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);
    const hp = intersectGround(raycaster);

    // 1. BULLDOZER MODE HOVER & DRAG-DEMOLISH
    if (activeTab === 'bulldoze') {
      brushMarker.visible = false;
      linePreviewMesh.visible = false;
      const target = findBulldozeTarget(raycaster, hp);

      if (bulldozeHoveredTarget !== target) {
        if (bulldozeHoveredTarget) setBulldozeHighlight(bulldozeHoveredTarget, false);
        bulldozeHoveredTarget = target;
        if (bulldozeHoveredTarget) setBulldozeHighlight(bulldozeHoveredTarget, true);
      }

      if (target) {
        if (target.kind === 'gridRoad') {
          ghostGroup.visible = false;
          updateTileCursor(target.gx, target.gz, 0xdc2626, true);
        } else {
          tileCursorGroup.visible = false;
          ghostGroup.visible = true;
          const p = target.point || hp;
          if (p) ghostGroup.position.set(p.x, terrain.height(p.x, p.z) + 0.08, p.z);
          ghostRingMat.color.setHex(0xdc2626);
          ghostBoxMat.color.setHex(0xef4444);
          ghostBody.visible = true;
        }
        // Hold left mouse button to sweep-bulldoze!
        if (isPointerDown) {
          executeBulldozeTarget(target);
          bulldozeHoveredTarget = null;
        }
      } else {
        ghostGroup.visible = false;
        if (hp) {
          const { gx, gz } = worldToTile(hp.x, hp.z, gridStep);
          updateTileCursor(gx, gz, 0xfca5a5, true);
        } else {
          tileCursorGroup.visible = false;
        }
      }

      const infoEl = document.querySelector('#bulldoze-hover-info');
      if (infoEl) {
        if (target) {
          infoEl.innerHTML = `🚜 Click chuột trái để <b>ỦI NGAY: ${target.label}</b>!`;
          infoEl.style.background = '#fee2e2';
          document.body.style.cursor = 'pointer';
        } else {
          infoEl.innerHTML = '🎯 Rê chuột vào <b>cây cối, bụi cây, ghế đá</b> hoặc <b>ô đường</b> để ủi!';
          infoEl.style.background = '#ffffff';
          document.body.style.cursor = 'crosshair';
        }
      }
      return;
    } else if (bulldozeHoveredTarget) {
      setBulldozeHighlight(bulldozeHoveredTarget, false);
      bulldozeHoveredTarget = null;
    }

    if (hp) {
      const { gx, gz } = worldToTile(hp.x, hp.z, gridStep);
      const sx = gx * gridStep;
      const sz = gz * gridStep;
      const sy = terrain.height(sx, sz);

      if (activeTab === 'terrain') {
        ghostGroup.visible = false;
        tileCursorGroup.visible = false;
        linePreviewMesh.visible = false;
        const useSculpt = isShiftDown || terrainSubMode === 'sculpt';
        const rad = useSculpt ? sculptRadius : paintRadius;
        updateBrushMarkerGeometry(rad);
        brushMarker.position.set(hp.x, hp.y + 0.08, hp.z);
        brushMarker.visible = true;
        if (isPointerDown) {
          if (useSculpt) applySculpt(hp);
          else applyPaint(hp);
        }
      } else if (activeTab === 'roads') {
        brushMarker.visible = false;
        ghostGroup.visible = false;
        linePreviewMesh.visible = false;
        const roadMode = document.querySelector('input[name="road-draw-mode"]:checked')?.value || 'grid';
        const roadBrush = document.querySelector('input[name="grid-road-brush"]:checked')?.value || 'line';
        const selRoadType = document.querySelector('#sel-road-type')?.value || activeRoadType;
        activeRoadType = selRoadType;

        // Highlight current Grid Tile in Sky Blue (or Red if holding Shift to erase)
        updateTileCursor(gx, gz, isShiftDown ? 0xef4444 : 0x0ea5e9, true);

        if (roadMode === 'grid' && isPointerDown && isDraggingRoad) {
          if (!lastDragTile || lastDragTile[0] !== gx || lastDragTile[1] !== gz) {
            if (roadBrush === 'box' && boxStartTile) {
              const minX = Math.min(boxStartTile[0], gx);
              const maxX = Math.max(boxStartTile[0], gx);
              const minZ = Math.min(boxStartTile[1], gz);
              const maxZ = Math.max(boxStartTile[1], gz);
              for (let tx = minX; tx <= maxX; tx++) {
                for (let tz = minZ; tz <= maxZ; tz++) {
                  const key = `${tx},${tz}`;
                  const existing = gridRoadsMap.get(key);
                  if (isShiftDown) {
                    if (existing) {
                      dragRoadBatch.push({ action: 'remove', gx: tx, gz: tz, prevType: existing.type, step: existing.step });
                      removeGridRoadTile(tx, tz, false);
                    }
                  } else if (!existing || existing.type !== selRoadType) {
                    dragRoadBatch.push({
                      action: 'place',
                      gx: tx,
                      gz: tz,
                      prevType: existing ? existing.type : null,
                      newType: selRoadType,
                      step: gridStep
                    });
                    placeGridRoadTile(tx, tz, selRoadType, gridStep, false);
                  }
                }
              }
            } else {
              const path = lastDragTile
                ? getOrthogonalTilePath(lastDragTile[0], lastDragTile[1], gx, gz)
                : [[gx, gz]];
              for (const [tx, tz] of path) {
                const key = `${tx},${tz}`;
                const existing = gridRoadsMap.get(key);
                if (isShiftDown) {
                  if (existing) {
                    dragRoadBatch.push({ action: 'remove', gx: tx, gz: tz, prevType: existing.type, step: existing.step });
                    removeGridRoadTile(tx, tz, false);
                  }
                } else {
                  if (!existing || existing.type !== selRoadType) {
                    dragRoadBatch.push({
                      action: 'place',
                      gx: tx,
                      gz: tz,
                      prevType: existing ? existing.type : null,
                      newType: selRoadType,
                      step: gridStep
                    });
                    placeGridRoadTile(tx, tz, selRoadType, gridStep, false);
                  }
                }
              }
            }
            lastDragTile = [gx, gz];
          }
        }
      } else if (activeTab === 'foliage' || activeTab === 'props') {
        const placeMode = activeTab === 'foliage'
          ? (document.querySelector('input[name="foliage-place-mode"]:checked')?.value || 'single')
          : (document.querySelector('input[name="prop-place-mode"]:checked')?.value || 'single');

        if (isDraggingAssetLine && assetLineStartPt) {
          linePreviewMesh.geometry.setFromPoints([
            new T.Vector3(assetLineStartPt.x, terrain.height(assetLineStartPt.x, assetLineStartPt.z) + 0.35, assetLineStartPt.z),
            new T.Vector3(hp.x, terrain.height(hp.x, hp.z) + 0.35, hp.z)
          ]);
          linePreviewMesh.visible = true;
        } else {
          linePreviewMesh.visible = false;
        }

        if (activeTab === 'foliage' && placeMode === 'brush') {
          ghostGroup.visible = false;
          tileCursorGroup.visible = false;
          brushMarker.position.set(hp.x, hp.y + 0.08, hp.z);
          brushMarker.visible = true;
          if (isPointerDown && Date.now() - lastSprayTime > 180) {
            const selType = document.querySelector('#sel-foliage-type')?.value || 'tree_round';
            scatterVegetation({ type: selType, center: [hp.x, hp.z], radius: 6.0, count: 2 });
            lastSprayTime = Date.now();
          }
        } else {
          brushMarker.visible = false;
          updateTileCursor(gx, gz, 0x10b981, true);
          ghostGroup.visible = true;
          ghostGroup.position.set(sx, sy + 0.05, sz);
          ghostGroup.rotation.y = ghostRotationY;
          ghostBody.visible = true;

          const dummyTarget = { group: { position: { x: sx, z: sz }, rotation: { y: ghostRotationY } }, w: 1.6, d: 1.6 };
          const col = evaluateCollision(dummyTarget);
          ghostRingMat.color.setHex(col.safe ? 0x10b981 : 0xef4444);
          ghostBoxMat.color.setHex(col.safe ? 0x34d399 : 0xf87171);
        }
      } else {
        brushMarker.visible = false;
        ghostGroup.visible = false;
        linePreviewMesh.visible = false;
        updateTileCursor(gx, gz, 0x10b981, gridVisible);
      }
    } else {
      brushMarker.visible = false;
      ghostGroup.visible = false;
      tileCursorGroup.visible = false;
      linePreviewMesh.visible = false;
    }
  });

  renderer.domElement.addEventListener('pointerdown', e => {
        if (!editModeActive) return;
    if (e.button !== 0) return; // Only left click triggers placement/action; right/middle click rotates/pans camera freely
    isPointerDown = true;

    if (transformControls.axis !== null || transformControls.dragging) {
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    const allHits = raycaster.intersectObjects(scene.children, true);
    // Only return early if mouse is actively interacting with a transform gizmo axis
    if (transformControls.axis !== null || transformControls.dragging) {
      return;
    }

    const hp = intersectGround(raycaster);

    
  // -------------------------------------------------------------------------
    // EYEDROPPER / PIPETTE TOOL (Hotkey [I] or Hold [Alt] + Left Click)
    // -------------------------------------------------------------------------
    if (eyedropperActive || e.altKey) {
      executeEyedropper(raycaster, hp);
      isPointerDown = false;
      return;
    }

    // -------------------------------------------------------------------------
    // UNIVERSAL HANDLE PICKING (Priority 1 whenever handles are visible!)
    // -------------------------------------------------------------------------
    const currentRoadMode = (activeTab === 'roads') ? (document.querySelector('input[name="road-draw-mode"]:checked')?.value || 'grid') : null;
    const allowHandlePicking = (activeTab === 'select') || (activeTab === 'roads' && currentRoadMode === 'native');
    if (allowHandlePicking && nativeHandlesGroup && nativeHandlesGroup.visible) {
      // 1. Direct 3D Raycasting against all handle group children
      const handleHits = raycaster.intersectObjects(nativeHandlesGroup.children, true);
      for (const h of handleHits) {
        let cur = h.object;
        while (cur && cur !== scene) {
          if (cur.userData?.isNativeWalkHandle && cur.userData?.walkRef) {
            selectNativeWalkPoint(cur.userData.walkRef, cur.userData.pointIndex);
            return;
          }
          if (cur.userData?.isNativeCourtHandle && cur.userData?.courtRef && cur.geometry?.type === 'BoxGeometry') {
            selectNativeCourt(cur.userData.courtRef);
            return;
          }
          cur = cur.parent;
        }
      }

      // 2. 2D Screen-space Proximity Picking (Tolerance 28px around cursor)
      const nearHandle = findHandleNearScreenPoint(e.clientX, e.clientY, 28);
      if (nearHandle) {
        if (nearHandle.kind === 'walk') {
          selectNativeWalkPoint(nearHandle.walkRef, nearHandle.pointIndex);
        } else if (nearHandle.kind === 'court') {
          selectNativeCourt(nearHandle.courtRef);
        }
        return;
      }
    }

    // -------------------------------------------------------------------------
    // TAB 0: UNIVERSAL SELECT & TRANSFORM TOOL [V]
    // -------------------------------------------------------------------------
    if (activeTab === 'select') {
      // 1. Check Native Handles (Yellow dots or Court handles)
      const handleHits = raycaster.intersectObjects(nativeHandlesGroup.children, true);
      if (handleHits.length > 0) {
        let cur = handleHits[0].object;
        while (cur && cur !== scene) {
          if (cur.userData?.isNativeWalkHandle && cur.userData?.walkRef) {
            selectNativeWalkPoint(cur.userData.walkRef, cur.userData.pointIndex);
            return;
          }
          if (cur.userData?.isNativeCourtHandle && cur.userData?.courtRef) {
            selectNativeCourt(cur.userData.courtRef);
            return;
          }
          cur = cur.parent;
        }
      }

      // 2. Check Custom Placed Props / Trees
      for (const h of allHits) {
        let cur = h.object;
        while (cur && cur !== scene) {
          if (cur.userData?.isCustomAsset) {
            selectCustomObject(cur);
            return;
          }
          if (cur.userData?.buildingId && buildingFootprints.has(cur.userData.buildingId)) {
            selectBuilding(cur.userData.buildingId);
            return;
          }
          cur = cur.parent;
        }
      }

      // 3. Check Native Trees or Props (Promote to editable on click)
      const nativeHit = findBulldozeTarget(raycaster, null);
      if (nativeHit && (nativeHit.kind === 'instancedMesh' || nativeHit.kind === 'sceneObject')) {
        promoteNativeTargetToEditable(nativeHit);
        return;
      }

      // 4. Check Walkways and Courts
      if (hp) {
        let bestDist = 2.5;
        let bestPt = null;
        if (roads && roads.paths) {
          for (const p of roads.paths) {
            if (p.hidden || p.class !== 1 || !p.points) continue;
            p.points.forEach((pt, idx) => {
              const d = Math.hypot(pt[0] - hp.x, pt[1] - hp.z);
              if (d < bestDist) {
                bestDist = d;
                bestPt = { path: p, pointIndex: idx };
              }
            });
          }
        }
        if (bestPt) {
          selectNativeWalkPoint(bestPt.path, bestPt.pointIndex);
          return;
        }

        const surf = findNativeSurfaceAtPoint(hp.x, hp.z);
        if (surf) {
          if (surf.kind === 'walk') selectNativeWalkPoint(surf.path, surf.pointIndex);
          else if (surf.kind === 'court') selectNativeCourt(surf.court);
          return;
        }
      }
      return;
    }

    // TAB 1: BUILDINGS TAB - SELECT & MOVE BUILDINGS OR ANY NATIVE TREE/PROP/SURFACE
    // -------------------------------------------------------------------------
    if (activeTab === 'buildings') {
      let hitBldId = null;
      for (const h of allHits) {
        const obj = h.object;
        if (!obj || obj === tMesh || obj.name === 'continuous-ground' || obj.name === 'river-only' || obj.name === 'grid-helper' || obj === brushMarker || isTransformGizmoObject(obj)) continue;
        let bldId = obj.userData?.buildingId;
        if (!bldId) {
          let p = obj.parent;
          while (p && p !== scene) {
            if (p.userData?.buildingId) { bldId = p.userData.buildingId; break; }
            p = p.parent;
          }
        }
        if (bldId && buildingFootprints.has(bldId)) {
          hitBldId = bldId;
          break;
        }
      }
      if (hitBldId) {
        selectedNativeCourt = null;
        selectedNativeWalk = null;
        selectBuilding(hitBldId);
        return;
      }
      // Also allow clicking custom props (like orange benches) or Orange Courts / Yellow Paths directly!
      for (const h of allHits) {
        let cur = h.object;
        while (cur && cur !== scene) {
          if (cur.userData?.isCustomAsset) {
            selectCustomObject(cur);
            return;
          }
          if (cur.userData?.isNativeCourtHandle && cur.userData?.courtRef) {
            selectNativeCourt(cur.userData.courtRef);
            return;
          }
          if (cur.userData?.isNativeWalkHandle && cur.userData?.walkRef) {
            selectNativeWalkPoint(cur.userData.walkRef, cur.userData.pointIndex);
            return;
          }
          cur = cur.parent;
        }
      }
      // Universal Pointer: Allow clicking ANY native tree, bush, or garden cluster to promote & move it!
      const nativeHit = findBulldozeTarget(raycaster, null);
      if (nativeHit && (nativeHit.kind === 'instancedMesh' || nativeHit.kind === 'sceneObject')) {
        promoteNativeTargetToEditable(nativeHit);
        return;
      }
      if (hp) {
        const surf = findNativeSurfaceAtPoint(hp.x, hp.z);
        if (surf) {
          if (surf.kind === 'court') {
            switchTab('roads');
            const rad = document.querySelector('input[name="road-draw-mode"][value="native"]');
            if (rad) { rad.checked = true; rad.dispatchEvent(new Event('change')); }
            selectNativeCourt(surf.court);
          } else if (surf.kind === 'walk') {
            switchTab('roads');
            const rad = document.querySelector('input[name="road-draw-mode"][value="native"]');
            if (rad) { rad.checked = true; rad.dispatchEvent(new Event('change')); }
            selectNativeWalkPoint(surf.path, surf.pointIndex);
          }
        }
      }
      return;
    }

    // -------------------------------------------------------------------------
    // TAB 2: PROPS TAB - SELECT OR PLACE PROPS ON GRID TILE OR DRAG LINE
    // -------------------------------------------------------------------------
    if (activeTab === 'props') {
      const propPlaceMode = document.querySelector('input[name="prop-place-mode"]:checked')?.value || 'single';
      let hitProp = null;
      for (const h of allHits) {
        const obj = h.object;
        if (!obj || obj === tMesh || obj.name === 'continuous-ground' || obj.name === 'river-only' || obj.name === 'grid-helper' || obj === brushMarker || isTransformGizmoObject(obj)) continue;
        let cur = obj;
        while (cur && cur !== scene) {
          if (cur.userData?.isProp) { hitProp = cur; break; }
          cur = cur.parent;
        }
        if (hitProp) break;
      }
      if (hitProp && propPlaceMode === 'single') {
        selectCustomObject(hitProp);
      } else if (hp) {
        if (propPlaceMode === 'line') {
          isDraggingAssetLine = true;
          assetLineStartPt = new T.Vector3(snapCoord(hp.x), hp.y, snapCoord(hp.z));
          return;
        }
        const sx = snapCoord(hp.x), sz = snapCoord(hp.z);
        const selType = document.querySelector('#sel-prop-type')?.value || 'bench';
        const newObj = spawnAsset(selType, sx, sz, 1.0, ghostRotationY);
        pushUndo({
          type: 'spawn_asset',
          undo: () => {
            scene.remove(newObj);
            const idx = customPlacedObjects.indexOf(newObj);
            if (idx > -1) customPlacedObjects.splice(idx, 1);
            updatePropsListUI();
          },
          redo: () => {
            scene.add(newObj);
            customPlacedObjects.push(newObj);
            updatePropsListUI();
          }
        });
        selectCustomObject(newObj);
        saveStudioState();
      }
      return;
    }

    // -------------------------------------------------------------------------
    // TAB 3: FOLIAGE TAB - SELECT OR PLACE FOLIAGE/PARKS ON GRID TILE OR DRAG LINE
    // -------------------------------------------------------------------------
    if (activeTab === 'foliage') {
      const placeMode = document.querySelector('input[name="foliage-place-mode"]:checked')?.value || 'single';
      let hitFoliage = null;
      for (const h of allHits) {
        const obj = h.object;
        if (!obj || obj === tMesh || obj.name === 'continuous-ground' || obj.name === 'river-only' || obj.name === 'grid-helper' || obj === brushMarker || isTransformGizmoObject(obj)) continue;
        let cur = obj;
        while (cur && cur !== scene) {
          if (cur.userData?.isFoliage && cur.userData?.isCustomAsset) { hitFoliage = cur; break; }
          cur = cur.parent;
        }
        if (hitFoliage) break;
      }
      if (hitFoliage && placeMode === 'single') {
        selectCustomObject(hitFoliage);
        updateFoliageListUI();
        return;
      }
      // If clicking directly on an existing native tree/bush in 'single' mode while holding Ctrl, promote it!
      if (placeMode === 'single' && e.ctrlKey) {
        const nativeHit = findBulldozeTarget(raycaster, null);
        if (nativeHit && (nativeHit.kind === 'instancedMesh' || nativeHit.kind === 'sceneObject')) {
          promoteNativeTargetToEditable(nativeHit);
          return;
        }
      }
      if (hp) {
        const selType = document.querySelector('#sel-foliage-type')?.value || 'garden1';
        if (placeMode === 'line') {
          isDraggingAssetLine = true;
          assetLineStartPt = new T.Vector3(snapCoord(hp.x), hp.y, snapCoord(hp.z));
          return;
        }
        if (placeMode === 'single') {
          const sx = snapCoord(hp.x), sz = snapCoord(hp.z);
          const newObj = spawnAsset(selType, sx, sz, 1.0, ghostRotationY);
          pushUndo({
            type: 'spawn_asset',
            undo: () => {
              scene.remove(newObj);
              const idx = customPlacedObjects.indexOf(newObj);
              if (idx > -1) customPlacedObjects.splice(idx, 1);
              updateFoliageListUI();
            },
            redo: () => {
              scene.add(newObj);
              customPlacedObjects.push(newObj);
              updateFoliageListUI();
            }
          });
          selectCustomObject(newObj);
          updateFoliageListUI();
          saveStudioState();
        } else {
          scatterVegetation({ type: selType, center: [hp.x, hp.z], radius: 6.0, count: 2 });
          updateFoliageListUI();
          saveStudioState();
        }
      }
      return;
    }

    // -------------------------------------------------------------------------
    // TAB 6: UNIVERSAL BULLDOZER TAB (DEMOLISHES ROADS, TREES, BUSHES, PROPS)
    // -------------------------------------------------------------------------
    if (activeTab === 'bulldoze') {
      const target = bulldozeHoveredTarget || findBulldozeTarget(raycaster, hp);
      if (target) {
        executeBulldozeTarget(target);
        bulldozeHoveredTarget = null;
      }
      return;
    }

    // -------------------------------------------------------------------------
    // TAB 4: ROADS TAB (SIMCITY GRID-TILE ROAD PAINTING & SPLINE ROADS)
    // -------------------------------------------------------------------------
    if (activeTab === 'roads') {
      const roadMode = document.querySelector('input[name="road-draw-mode"]:checked')?.value || 'grid';
      const selRoadType = document.querySelector('#sel-road-type')?.value || activeRoadType;
      activeRoadType = selRoadType;

      // In 'native' mode (Chỉnh Hộp Cam & Đường Vàng), check handles directly with high priority and proximity snap
      if (roadMode === 'native') {
        // Direct raycast on handle group first!
        const handleHits = raycaster.intersectObjects(nativeHandlesGroup.children, true);
        if (handleHits.length > 0) {
          let cur = handleHits[0].object;
          while (cur && cur !== scene) {
            if (cur.userData?.isNativeWalkHandle && cur.userData?.walkRef) {
              selectNativeWalkPoint(cur.userData.walkRef, cur.userData.pointIndex);
              return;
            }
            if (cur.userData?.isNativeCourtHandle && cur.userData?.courtRef) {
              selectNativeCourt(cur.userData.courtRef);
              return;
            }
            cur = cur.parent;
          }
        }

        // Also check allHits
        for (const h of allHits) {
          let cur = h.object;
          while (cur && cur !== scene) {
            if (cur.userData?.isNativeWalkHandle && cur.userData?.walkRef) {
              selectNativeWalkPoint(cur.userData.walkRef, cur.userData.pointIndex);
              return;
            }
            if (cur.userData?.isNativeCourtHandle && cur.userData?.courtRef) {
              selectNativeCourt(cur.userData.courtRef);
              return;
            }
            cur = cur.parent;
          }
        }

        // Proximity snap within 2.5m of any walkway node or court
        if (hp) {
          let bestDist = 2.5;
          let bestPt = null;
          if (roads && roads.paths) {
            for (const p of roads.paths) {
              if (p.hidden || p.class !== 1 || !p.points) continue;
              p.points.forEach((pt, idx) => {
                const d = Math.hypot(pt[0] - hp.x, pt[1] - hp.z);
                if (d < bestDist) {
                  bestDist = d;
                  bestPt = { path: p, pointIndex: idx };
                }
              });
            }
          }
          if (bestPt) {
            selectNativeWalkPoint(bestPt.path, bestPt.pointIndex);
            return;
          }

          const surf = findNativeSurfaceAtPoint(hp.x, hp.z);
          if (surf) {
            if (surf.kind === 'walk') selectNativeWalkPoint(surf.path, surf.pointIndex);
            else if (surf.kind === 'court') selectNativeCourt(surf.court);
            return;
          }
        }
        return;
      }

      if (roadMode === 'grid') {
                if (hp) {
          const { gx, gz } = worldToTile(hp.x, hp.z, gridStep);
          const key = `${gx},${gz}`;
          const existing = gridRoadsMap.get(key);
          isDraggingRoad = true;
          lastDragTile = [gx, gz];
          boxStartTile = [gx, gz];
          dragRoadBatch = [];

          if (isShiftDown) {
            if (existing) {
              dragRoadBatch.push({ action: 'remove', gx, gz, prevType: existing.type, step: existing.step });
              removeGridRoadTile(gx, gz, false);
            }
          } else {
            if (!existing || existing.type !== selRoadType) {
              dragRoadBatch.push({
                action: 'place',
                gx,
                gz,
                prevType: existing ? existing.type : null,
                newType: selRoadType,
                step: gridStep
              });
              placeGridRoadTile(gx, gz, selRoadType, gridStep, false);
            }
          }
        }
        return;
      }

      // Spline points mode
      for (const h of allHits) {
        const obj = h.object;
        if (obj.userData?.isRoadHandle) return;
        if (obj.userData?.isCustomRoad || obj.name?.startsWith('custom_road_') || obj.parent?.userData?.isCustomRoad) {
          selectCustomRoad(obj.userData?.isCustomRoad ? obj : (obj.parent?.userData?.isCustomRoad ? obj.parent : obj));
          return;
        }
      }
      if (hp) {
        addRoadControlPoint(hp);
      }
      return;
    }

    // -------------------------------------------------------------------------
    // TAB 5: TERRAIN & PAINT TAB
    // -------------------------------------------------------------------------
    if (activeTab === 'terrain') {
      if (hp) {
        const useSculpt = isShiftDown || terrainSubMode === 'sculpt';
        if (useSculpt) {
          activeSculptStroke = new Map();
          activeSculptSnaps = new Map();
          applySculpt(hp);
        } else {
          activePaintStroke = new Map();
          applyPaint(hp);
        }
      }
      return;
    }
  });

  // =========================================================================
  // CITY BUILDER TABS & EDIT MODE CONTROLLER
  // =========================================================================
  const toggleBtn = document.querySelector('#btn-toggle-edit');
  const editPanel = document.querySelector('#edit-panel');
  const simDock = document.querySelector('#simcity-dock');
  const bottomDrawer = document.querySelector('#bottom-editor-drawer');
  const tabs = ['select', 'buildings', 'props', 'foliage', 'roads', 'terrain', 'bulldoze'];

  function switchTab(targetTab) {
    activeTab = targetTab;
    tabs.forEach(t => {
      const b = document.getElementById('tab-btn-' + t);
      const c = document.getElementById('tab-content-' + t);
      if (b) {
        const isBull = t === 'bulldoze';
        b.style.background = t === targetTab ? (isBull ? '#dc2626' : '#059669') : '#cbd5e1';
        b.style.color = t === targetTab ? '#ffffff' : (isBull ? '#dc2626' : '#334155');
      }
      if (c) c.hidden = t !== targetTab;
    });

    // Sync SimCity Floating Bottom Dock buttons
    document.querySelectorAll('.sim-dock-btn').forEach(btn => {
      const dt = btn.getAttribute('data-dock-tab');
      const isAct = dt === targetTab;
      if (dt === 'bulldoze') {
        btn.style.background = isAct ? '#dc2626' : '#450a0a';
        btn.style.color = isAct ? '#ffffff' : '#fca5a5';
        btn.style.borderColor = isAct ? '#fef2f2' : '#ef4444';
      } else {
        btn.style.background = isAct ? '#059669' : '#1e293b';
        btn.style.color = isAct ? '#ffffff' : '#e2e8f0';
        btn.style.borderColor = isAct ? '#34d399' : '#475569';
      }
    });

    // The options drawer stays hidden for every tool except Roads, where it holds the road type and the drawing mode
    if (bottomDrawer) {
      const showDrawer = editModeActive && targetTab === 'roads';
      bottomDrawer.hidden = !showDrawer;
      bottomDrawer.style.display = showDrawer ? 'block' : 'none';
      // Sit just above the dock, whatever height the dock has at this window size
      const dockTop = document.querySelector('#simcity-dock')?.getBoundingClientRect().top;
      if (showDrawer && dockTop > 0) bottomDrawer.style.bottom = Math.round(window.innerHeight - dockTop + 8) + 'px';
    }

    const roadMode = document.querySelector('input[name="road-draw-mode"]:checked')?.value || 'grid';
    const propMode = document.querySelector('input[name="prop-place-mode"]:checked')?.value || 'single';
    const folMode = document.querySelector('input[name="foliage-place-mode"]:checked')?.value || 'single';

    if (targetTab === 'roads' && roadMode === 'native') {
      nativeHandlesGroup.visible = true;
      rebuildNativeSurfaceHandles();
      syncNativeSurfaceUI();
      controls.mouseButtons.LEFT = -1;
    } else {
      nativeHandlesGroup.visible = false;
      selectedNativeCourt = null;
      selectedNativeWalk = null;
      controls.mouseButtons.LEFT = -1;
    }
    controls.mouseButtons.MIDDLE = T.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = T.MOUSE.PAN;

    if (targetTab === 'terrain') {
      const rad = terrainSubMode === 'sculpt' ? sculptRadius : paintRadius;
      updateBrushMarkerGeometry(rad);
      brushMarker.visible = true;
      transformControls.detach();
      helper.visible = false;
    } else if (targetTab === 'foliage') {
      updateFoliageListUI();
      if (folMode === 'brush') {
        updateBrushMarkerGeometry(6.0);
        brushMarker.visible = true;
      } else {
        brushMarker.visible = false;
      }
      if (selectedObject && selectedObject.userData?.isFoliage) {
        transformControls.attach(selectedObject);
        syncTransformGizmoAxes();
        helper.visible = true;
      }
    } else if (targetTab === 'props') {
      brushMarker.visible = false;
      updatePropsListUI();
      if (selectedObject && selectedObject.userData?.isProp) {
        transformControls.attach(selectedObject);
        syncTransformGizmoAxes();
        helper.visible = true;
      }
    } else if (targetTab === 'buildings') {
      brushMarker.visible = false;
      updateBuildingsQuickList();
      if (selectedObject && selectedObject.group) {
        transformControls.attach(selectedObject.group);
        transformControls.setMode('translate');
        syncTransformGizmoAxes();
        helper.visible = true;
      }
    } else {
      brushMarker.visible = false;
      if (selectedObject) {
        transformControls.attach(selectedObject.group || selectedObject);
        syncTransformGizmoAxes();
        helper.visible = true;
      }
    }
  }

  tabs.forEach(t => {
    const b = document.getElementById('tab-btn-' + t);
    if (b) b.onclick = () => switchTab(t);
  });

  function setEditMode(active) {
    editModeActive = active;
    if (toggleBtn) {
      toggleBtn.innerHTML = active
        ? '<span>🛠️</span> <span>Chế độ Biên tập: ĐANG BẬT</span>'
        : '<span>🛠️</span> <span>Chế độ Biên tập: TẮT</span>';
      toggleBtn.style.background = active ? '#dc2626' : '#059669';
    }
    if (editPanel) editPanel.hidden = !active;

    if (simDock) {
      simDock.hidden = !active;
      simDock.style.display = active ? 'flex' : 'none';
    }
    if (bottomDrawer) {
      bottomDrawer.hidden = true;
      bottomDrawer.style.display = 'none';
    }

    if (!active) {
      deselect();
      setEyedropperMode(false);
      brushMarker.visible = false;
      ghostGroup.visible = false;
      tileCursorGroup.visible = false;
      linePreviewMesh.visible = false;
      if (nativeHandlesGroup) {
        nativeHandlesGroup.visible = false;
      }
      selectedNativeCourt = null;
      selectedNativeWalk = null;
      if (helper) helper.visible = false;
      transformControls.detach();
      setGridState({ visible: false });
      if (gridHelper) gridHelper.visible = false;
      if (bulldozeHoveredTarget) {
        setBulldozeHighlight(bulldozeHoveredTarget, false);
        bulldozeHoveredTarget = null;
      }
      controls.enabled = true;
      controls.mouseButtons.LEFT = -1;
      controls.mouseButtons.MIDDLE = T.MOUSE.ROTATE;
      controls.mouseButtons.RIGHT = T.MOUSE.PAN;
      document.body.style.cursor = 'default';
    } else {
      // Automatically turn on the 3D Terrain Grid when entering Edit Mode!
      setGridState({ visible: true });
      switchTab(activeTab);
      updateBuildingsQuickList();
      updatePropsListUI();
      updateFoliageListUI();
      renderRoadsDynamicList();
    }
  }

  if (toggleBtn) toggleBtn.onclick = () => setEditMode(!editModeActive);

  // Grid & Road UI bindings
  document.querySelector('#chk-show-grid')?.addEventListener('change', e => {
    setGridState({ visible: e.target.checked });
  });
  document.querySelector('#chk-grid-snap')?.addEventListener('change', e => {
    setGridState({ snap: e.target.checked });
  });
  document.querySelector('#sel-grid-step')?.addEventListener('change', e => {
    setGridState({ step: parseFloat(e.target.value) });
  });
  document.querySelector('#sel-road-type')?.addEventListener('change', e => {
    activeRoadType = e.target.value;
  });
  document.querySelectorAll('input[name="road-draw-mode"]').forEach(radio => {
    radio.addEventListener('change', e => {
      const mode = e.target.value;
      const splineBtns = document.querySelector('#spline-road-btns');
      const gridPanel = document.querySelector('#road-grid-panel');
      const nativePanel = document.querySelector('#native-surface-panel');
      if (splineBtns) splineBtns.style.display = mode === 'points' ? 'flex' : 'none';
      if (gridPanel) gridPanel.hidden = (mode === 'native');
      if (nativePanel) nativePanel.hidden = (mode !== 'native');

      if (mode === 'native') {
        nativeHandlesGroup.visible = true;
        rebuildNativeSurfaceHandles();
        syncNativeSurfaceUI();
        controls.mouseButtons.LEFT = -1;
        renderRoadsDynamicList();
        showToast('🟧 Bấm vào bất kỳ Hộp màu cam hoặc Nút tròn màu vàng nào trên mặt đất để chỉnh!', '#d97706');
      } else {
        nativeHandlesGroup.visible = false;
        selectedNativeCourt = null;
        selectedNativeWalk = null;
        if (selectedObject === nativeProxyObj) deselect();
        controls.mouseButtons.LEFT = -1;
      }
    });
  });

  // Orange Court Sliders & Buttons
  function updateSelectedCourtDimension(prop, val) {
    if (!selectedNativeCourt) return;
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return;
    selectedNativeCourt[prop] = num;
    rebuildTerrainSurfaces();
    syncNativeSurfaceUI();
    saveStudioState();
  }
  document.querySelector('#rng-court-w')?.addEventListener('change', e => updateSelectedCourtDimension('w', e.target.value));
  document.querySelector('#rng-court-w')?.addEventListener('input', e => {
    const lbl = document.querySelector('#lbl-court-w');
    if (lbl) lbl.textContent = `${parseFloat(e.target.value).toFixed(1)}m`;
  });
  document.querySelector('#inp-court-w')?.addEventListener('change', e => updateSelectedCourtDimension('w', e.target.value));

  document.querySelector('#rng-court-d')?.addEventListener('change', e => updateSelectedCourtDimension('d', e.target.value));
  document.querySelector('#rng-court-d')?.addEventListener('input', e => {
    const lbl = document.querySelector('#lbl-court-d');
    if (lbl) lbl.textContent = `${parseFloat(e.target.value).toFixed(1)}m`;
  });
  document.querySelector('#inp-court-d')?.addEventListener('change', e => updateSelectedCourtDimension('d', e.target.value));

  document.querySelector('#rng-court-r')?.addEventListener('change', e => updateSelectedCourtDimension('r', e.target.value));
  document.querySelector('#rng-court-r')?.addEventListener('input', e => {
    const lbl = document.querySelector('#lbl-court-r');
    if (lbl) lbl.textContent = `${parseFloat(e.target.value).toFixed(1)}m`;
  });

  document.querySelector('#btn-court-rot-ccw')?.addEventListener('click', () => {
    if (!selectedNativeCourt) return;
    selectedNativeCourt.rotY = (selectedNativeCourt.rotY || 0) - Math.PI / 4;
    nativeProxyObj.rotation.y = selectedNativeCourt.rotY;
    rebuildTerrainSurfaces();
    syncNativeSurfaceUI();
    saveStudioState();
  });
  document.querySelector('#btn-court-rot-cw')?.addEventListener('click', () => {
    if (!selectedNativeCourt) return;
    selectedNativeCourt.rotY = (selectedNativeCourt.rotY || 0) + Math.PI / 4;
    nativeProxyObj.rotation.y = selectedNativeCourt.rotY;
    rebuildTerrainSurfaces();
    syncNativeSurfaceUI();
    saveStudioState();
  });
  document.querySelector('#btn-court-add-new')?.addEventListener('click', () => {
    const camTarget = (controls && controls.target) ? controls.target : { x: 0, z: 0 };
    if (!terrain.courts) terrain.courts = [];
    const newCourt = {
      id: `Court_${terrain.courts.length + 1}`,
      x: Number(camTarget.x.toFixed(1)),
      z: Number(camTarget.z.toFixed(1)),
      w: 12,
      d: 10,
      r: 2.0,
      rotY: 0,
      hidden: false
    };
    terrain.courts.push(newCourt);
    rebuildTerrainSurfaces();
    selectNativeCourt(newCourt);
    saveStudioState();
    showToast(`🟧 Đã tạo Hộp Cam mới (${newCourt.id})! Kéo di chuyển hoặc chỉnh W/D bên dưới.`, '#ea580c');
  });

  document.querySelector('#btn-court-duplicate')?.addEventListener('click', () => {
    if (!selectedNativeCourt) return;
    const src = selectedNativeCourt;
    const dup = {
      id: `Court_${terrain.courts.length + 1}`,
      x: Number((src.x + 4).toFixed(2)),
      z: Number((src.z + 4).toFixed(2)),
      w: src.w,
      d: src.d,
      r: src.r,
      rotY: src.rotY || 0,
      hidden: false
    };
    terrain.courts.push(dup);
    rebuildTerrainSurfaces();
    selectNativeCourt(dup);
    saveStudioState();
    showToast(`📋 Đã nhân bản Hộp màu cam (${dup.id})!`, '#0284c7');
  });
  document.querySelector('#btn-court-delete')?.addEventListener('click', () => {
    if (!selectedNativeCourt) return;
    const c = selectedNativeCourt;
    c.hidden = true;
    selectedNativeCourt = null;
    deselect();
    rebuildTerrainSurfaces();
    syncNativeSurfaceUI();
    saveStudioState();
    pushUndo({
      type: 'delete_native_court',
      undo: () => { c.hidden = false; rebuildTerrainSurfaces(); saveStudioState(); },
      redo: () => { c.hidden = true; rebuildTerrainSurfaces(); saveStudioState(); }
    });
    showToast(`🗑️ Đã xóa Hộp màu cam (${c.id})!`, '#dc2626');
  });

  // Yellow Walkway Sliders & Buttons
  document.querySelector('#rng-walk-w')?.addEventListener('change', e => {
    if (!selectedNativeWalk) return;
    selectedNativeWalk.path.width = parseFloat(e.target.value) || 2.0;
    rebuildTerrainSurfaces();
    syncNativeSurfaceUI();
    saveStudioState();
  });
  document.querySelector('#rng-walk-w')?.addEventListener('input', e => {
    const lbl = document.querySelector('#lbl-walk-w');
    if (lbl) lbl.textContent = `${parseFloat(e.target.value).toFixed(1)}m`;
  });

  document.querySelector('#btn-walk-add-pt')?.addEventListener('click', () => {
    if (!selectedNativeWalk) return;
    const { path, pointIndex } = selectedNativeWalk;
    const cur = path.points[pointIndex];
    const newPt = [Number((cur[0] + 3).toFixed(1)), Number((cur[1] + 2).toFixed(1))];
    const insertIdx = pointIndex + 1;
    path.points.splice(insertIdx, 0, newPt);
    rebuildTerrainSurfaces();
    selectNativeWalkPoint(path, insertIdx);
    saveStudioState();
    showToast('➕ Đã thêm mốc mới vào Đường vàng — Kéo mũi tên để dẫn tới vị trí mới!', '#ca8a04');
  });

  document.querySelector('#btn-walk-split-seg')?.addEventListener('click', () => {
    if (!selectedNativeWalk) return;
    const { path, pointIndex } = selectedNativeWalk;
    const nextIdx = pointIndex < path.points.length - 1 ? pointIndex + 1 : Math.max(0, pointIndex - 1);
    const pA = path.points[Math.min(pointIndex, nextIdx)];
    const pB = path.points[Math.max(pointIndex, nextIdx)];
    const midPt = [Number(((pA[0] + pB[0]) / 2).toFixed(2)), Number(((pA[1] + pB[1]) / 2).toFixed(2))];
    const insertAt = Math.min(pointIndex, nextIdx) + 1;
    path.points.splice(insertAt, 0, midPt);
    rebuildTerrainSurfaces();
    selectNativeWalkPoint(path, insertAt);
    saveStudioState();
    showToast('🔹 Đã chèn điểm giữa đoạn Đường vàng để uốn cong!', '#0284c7');
  });

  document.querySelector('#btn-walk-straighten')?.addEventListener('click', () => {
    if (!selectedNativeWalk) return;
    const { path } = selectedNativeWalk;
    if (path.points.length <= 2) {
      showToast('📏 Nhánh đường vàng này đã là đường thẳng 2 đầu!', '#0d9488');
      return;
    }
    const first = path.points[0];
    const last = path.points[path.points.length - 1];
    const n = path.points.length;
    for (let i = 1; i < n - 1; i++) {
      const t = i / (n - 1);
      path.points[i][0] = Number((first[0] + (last[0] - first[0]) * t).toFixed(2));
      path.points[i][1] = Number((first[1] + (last[1] - first[1]) * t).toFixed(2));
    }
    rebuildTerrainSurfaces();
    selectNativeWalkPoint(path, selectedNativeWalk.pointIndex);
    saveStudioState();
    showToast('📏 Đã căn thẳng tắp toàn bộ các điểm của nhánh Đường vàng!', '#0d9488');
  });

  document.querySelector('#btn-walk-del-pt')?.addEventListener('click', () => {
    if (!selectedNativeWalk) return;
    const { path, pointIndex } = selectedNativeWalk;
    if (path.points.length <= 2) {
      path.hidden = true;
      selectedNativeWalk = null;
      deselect();
      rebuildTerrainSurfaces();
      syncNativeSurfaceUI();
      saveStudioState();
      showToast('🗑️ Đã xóa tuyến Đường vàng (do chỉ còn < 2 điểm)!', '#dc2626');
      return;
    }
    path.points.splice(pointIndex, 1);
    const nextIdx = Math.max(0, pointIndex - 1);
    rebuildTerrainSurfaces();
    selectNativeWalkPoint(path, nextIdx);
    saveStudioState();
    showToast('✂️ Đã xóa 1 mốc của Đường vàng!', '#ea580c');
  });

  document.querySelector('#btn-walk-delete')?.addEventListener('click', () => {
    if (!selectedNativeWalk) return;
    const p = selectedNativeWalk.path;
    p.hidden = true;
    selectedNativeWalk = null;
    deselect();
    rebuildTerrainSurfaces();
    syncNativeSurfaceUI();
    saveStudioState();
    pushUndo({
      type: 'delete_native_walk',
      undo: () => { p.hidden = false; rebuildTerrainSurfaces(); saveStudioState(); },
      redo: () => { p.hidden = true; rebuildTerrainSurfaces(); saveStudioState(); }
    });
    showToast(`🗑️ Đã xóa tuyến Đường màu vàng (${p.id})!`, '#dc2626');
  });

  // Add new Orange Court or Yellow Walkway
  document.querySelector('#btn-add-new-court')?.addEventListener('click', () => {
    const cx = Math.round(controls.target.x);
    const cz = Math.round(controls.target.z);
    const newCourt = {
      id: `Court_${terrain.courts.length + 1}`,
      x: cx,
      z: cz,
      w: 8,
      d: 6,
      r: 1.5,
      rotY: 0,
      hidden: false
    };
    terrain.courts.push(newCourt);
    rebuildTerrainSurfaces();
    selectNativeCourt(newCourt);
    saveStudioState();
  });

  document.querySelector('#btn-add-new-walk')?.addEventListener('click', () => {
    const cx = Math.round(controls.target.x);
    const cz = Math.round(controls.target.z);
    const pts = [[cx - 4, cz], [cx + 4, cz]];
    const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], 0, p[1])), false, 'centripetal');
    const newWalk = {
      id: `walk:custom_${Date.now().toString().slice(-4)}`,
      points: pts,
      width: 2.0,
      class: 1,
      hidden: false,
      curve
    };
    roads.paths.push(newWalk);
    rebuildTerrainSurfaces();
    selectNativeWalkPoint(newWalk, 1);
    saveStudioState();
  });

  document.querySelector('#btn-reset-native-surfaces')?.addEventListener('click', () => {
    if (!confirm('Khôi phục toàn bộ Hộp màu cam & Đường màu vàng về trạng thái mặc định ban đầu?')) return;
    if (terrain && terrain.courts) {
      terrain.courts.length = 0;
      for (const ic of initialNativeCourts) terrain.courts.push({ ...ic });
    }
    if (roads && roads.paths) {
      for (let i = roads.paths.length - 1; i >= 0; i--) {
        if (roads.paths[i].class === 1) roads.paths.splice(i, 1);
      }
      for (const iw of initialNativeWalks) {
        const pts = iw.points.map(pt => [pt[0], pt[1]]);
        const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], 0, p[1])), false, 'centripetal');
        roads.paths.push({
          id: iw.id,
          points: pts,
          width: iw.width || 2.0,
          class: 1,
          hidden: false,
          curve
        });
      }
    }
    selectedNativeCourt = null;
    selectedNativeWalk = null;
    deselect();
    rebuildTerrainSurfaces();
    syncNativeSurfaceUI();
    saveStudioState();
    showToast('🔄 Đã khôi phục Hộp màu cam & Đường màu vàng về gốc!', '#0284c7');
  });

  document.querySelector('#btn-finish-road')?.addEventListener('click', finishCurrentRoad);
  document.querySelector('#btn-undo-road-pt')?.addEventListener('click', undoLastRoadPoint);
  document.querySelector('#btn-delete-selected-road')?.addEventListener('click', () => {
    if (selectedRoad) {
      deleteCustomRoad(selectedRoad.id);
    } else if (selectedNativeWalk) {
      const p = selectedNativeWalk.path;
      p.hidden = true;
      selectedNativeWalk = null;
      deselect();
      rebuildTerrainSurfaces();
      syncNativeSurfaceUI();
      saveStudioState();
      showToast('🗑️ Đã xóa tuyến đường vàng được chọn!', '#dc2626');
    } else {
      showToast('⚠️ Chưa chọn tuyến đường nào để xóa! Hãy click vào đường cần xóa hoặc chọn từ danh sách.', '#f59e0b');
    }
  });
  document.querySelector('#btn-clear-roads')?.addEventListener('click', () => {
    if (confirm('Xóa toàn bộ các ô đường và tuyến đường mới vẽ?')) clearCustomRoads();
  });

  // Tab 5: Terrain Sculpting & Ground Painting UI Bindings
  function updateTerrainBadgeUI() {
    const badge = document.querySelector('#terrain-active-badge');
    if (badge) {
      if (terrainSubMode === 'sculpt') {
        const modeNames = {
          raise: '⬆️ Nâng cao đất',
          lower: '⬇️ Hạ thấp đất',
          flatten: '➖ San phẳng',
          smooth: '〰️ Làm mịn'
        };
        badge.innerHTML = `⛰️ Đang chọn: <b>Cọ Nắn Địa Hình (${modeNames[sculptMode] || sculptMode})</b> — Kéo chuột trái trên đất để nắn!`;
        badge.style.background = '#dcfce7';
        badge.style.color = '#065f46';
        badge.style.borderColor = '#10b981';
      } else {
        const paintNames = {
          grass: '🟢 Cỏ xanh',
          dirt: '🟠 Đất cam',
          gravel: '🟡 Cát vàng',
          stone: '⚪ Đá sỏi'
        };
        badge.innerHTML = `🎨 Đang chọn: <b>Cọ Sơn Mặt Đất (${paintNames[paintMaterialType] || paintMaterialType})</b> — Kéo chuột trái để sơn màu!`;
        badge.style.background = '#fef3c7';
        badge.style.color = '#92400e';
        badge.style.borderColor = '#f59e0b';
      }
    }
    const sculptBtns = {
      raise: document.querySelector('#btn-sculpt-raise'),
      lower: document.querySelector('#btn-sculpt-lower'),
      flatten: document.querySelector('#btn-sculpt-flatten'),
      smooth: document.querySelector('#btn-sculpt-smooth')
    };
    for (const [m, btn] of Object.entries(sculptBtns)) {
      if (!btn) continue;
      const isAct = terrainSubMode === 'sculpt' && sculptMode === m;
      btn.style.background = isAct ? '#047857' : '#05966930';
      btn.style.color = isAct ? '#ffffff' : '#065f46';
    }
    const paintBtns = {
      grass: document.querySelector('#btn-paint-grass'),
      dirt: document.querySelector('#btn-paint-dirt'),
      gravel: document.querySelector('#btn-paint-gravel'),
      stone: document.querySelector('#btn-paint-stone')
    };
    for (const [pt, btn] of Object.entries(paintBtns)) {
      if (!btn) continue;
      const isAct = terrainSubMode === 'paint' && paintMaterialType === pt;
      btn.style.outline = isAct ? '2px solid #047857' : 'none';
      btn.style.fontWeight = isAct ? 'bold' : 'normal';
    }
  }

  ['raise', 'lower', 'flatten', 'smooth'].forEach(mode => {
    document.querySelector(`#btn-sculpt-${mode}`)?.addEventListener('click', () => {
      terrainSubMode = 'sculpt';
      sculptMode = mode;
      updateBrushMarkerGeometry(sculptRadius);
      updateTerrainBadgeUI();
    });
  });

  document.querySelector('#rng-brush-size')?.addEventListener('input', e => {
    sculptRadius = parseFloat(e.target.value) || 6.0;
    const lbl = document.querySelector('#lbl-brush-size');
    if (lbl) lbl.textContent = `${sculptRadius.toFixed(1)}m`;
    if (terrainSubMode === 'sculpt') updateBrushMarkerGeometry(sculptRadius);
  });

  document.querySelector('#rng-brush-strength')?.addEventListener('input', e => {
    sculptStrength = parseFloat(e.target.value) || 0.4;
    const lbl = document.querySelector('#lbl-brush-strength');
    if (lbl) lbl.textContent = sculptStrength.toFixed(2);
  });

  ['grass', 'dirt', 'gravel', 'stone'].forEach(pt => {
    document.querySelector(`#btn-paint-${pt}`)?.addEventListener('click', () => {
      terrainSubMode = 'paint';
      paintMaterialType = pt;
      updateBrushMarkerGeometry(paintRadius);
      updateTerrainBadgeUI();
    });
  });

  document.querySelector('#rng-paint-size')?.addEventListener('input', e => {
    paintRadius = parseFloat(e.target.value) || 5.0;
    const lbl = document.querySelector('#lbl-paint-size');
    if (lbl) lbl.textContent = `${paintRadius.toFixed(1)}m`;
    if (terrainSubMode === 'paint') updateBrushMarkerGeometry(paintRadius);
  });

  document.querySelector('#rng-paint-intensity')?.addEventListener('input', e => {
    paintIntensity = parseFloat(e.target.value) || 0.35;
    const lbl = document.querySelector('#lbl-paint-intensity');
    if (lbl) lbl.textContent = paintIntensity.toFixed(2);
  });

  document.querySelector('#btn-reset-terrain')?.addEventListener('click', () => {
    resetTerrainHeights();
    rebuildTerrainGrid();
    saveStudioState();
  });

  document.querySelector('#btn-reset-paint')?.addEventListener('click', () => {
    resetGroundPaint();
    saveStudioState();
  });

  // Tab 4: Assets bindings
  document.querySelector('#btn-delete-asset')?.addEventListener('click', deleteSelectedAsset);
  document.querySelector('#btn-duplicate-asset')?.addEventListener('click', () => duplicateSelected());
  document.querySelector('#btn-clear-assets')?.addEventListener('click', () => {
    if (confirm('Dọn dẹp toàn bộ cây cối và đồ vật đã tự đặt?')) clearAllCustomAssets();
  });

  // Tab 1: Buildings & Object Inspector bindings
  const btnTranslate = document.querySelector('#btn-mode-translate');
  const btnRotate = document.querySelector('#btn-mode-rotate');
  const btnScale = document.querySelector('#btn-mode-scale');
  const btnDuplicateObj = document.querySelector('#btn-duplicate-object');
  const btnDeleteObj = document.querySelector('#btn-delete-object');
  const chkGroundSnap = document.querySelector('#chk-ground-snap');

  if (chkGroundSnap) {
    chkGroundSnap.onchange = e => {
      groundSnapEnabled = e.target.checked;
      syncTransformGizmoAxes();
    };
  }

  if (btnTranslate) {
    btnTranslate.onclick = () => {
      transformControls.setMode('translate');
      syncTransformGizmoAxes();
      btnTranslate.style.background = '#047857';
      btnTranslate.style.color = '#fff';
      if (btnRotate) { btnRotate.style.background = '#05966930'; btnRotate.style.color = '#065f46'; }
      if (btnScale) { btnScale.style.background = '#05966930'; btnScale.style.color = '#065f46'; }
    };
  }

  if (btnRotate) {
    btnRotate.onclick = () => {
      transformControls.setMode('rotate');
      syncTransformGizmoAxes();
      btnRotate.style.background = '#047857';
      btnRotate.style.color = '#fff';
      if (btnTranslate) { btnTranslate.style.background = '#05966930'; btnTranslate.style.color = '#065f46'; }
      if (btnScale) { btnScale.style.background = '#05966930'; btnScale.style.color = '#065f46'; }
    };
  }

  if (btnScale) {
    btnScale.onclick = () => {
      transformControls.setMode('scale');
      syncTransformGizmoAxes();
      btnScale.style.background = '#047857';
      btnScale.style.color = '#fff';
      if (btnTranslate) { btnTranslate.style.background = '#05966930'; btnTranslate.style.color = '#065f46'; }
      if (btnRotate) { btnRotate.style.background = '#05966930'; btnRotate.style.color = '#065f46'; }
    };
  }

  if (btnDuplicateObj) {
    btnDuplicateObj.onclick = () => duplicateSelected();
  }

  if (btnDeleteObj) {
    btnDeleteObj.onclick = () => deleteSelectedAsset();
  }

  // Material Editor inputs
  document.querySelector('#mat-color-picker')?.addEventListener('input', e => {
    if (selectedObject) setMaterialProperties(selectedObject, { color: e.target.value });
  });
  document.querySelector('#mat-roughness-slider')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.querySelector('#lbl-mat-roughness').textContent = v.toFixed(2);
    if (selectedObject) setMaterialProperties(selectedObject, { roughness: v });
  });
  document.querySelector('#mat-metalness-slider')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.querySelector('#lbl-mat-metalness').textContent = v.toFixed(2);
    if (selectedObject) setMaterialProperties(selectedObject, { metalness: v });
  });

  document.querySelector('#inp-hierarchy-search')?.addEventListener('input', () => updateHierarchyUI());


  // Rotate Quick Buttons & Controls for Buildings
  document.querySelector('#btn-rotate-ccw')?.addEventListener('click', () => rotateSelectedObject(-90));
  document.querySelector('#btn-rotate-cw')?.addEventListener('click', () => rotateSelectedObject(90));
  document.querySelector('#btn-rotate-45')?.addEventListener('click', () => rotateSelectedObject(45));
  document.querySelector('#btn-rotate-180')?.addEventListener('click', () => rotateSelectedObject(180));
  document.querySelector('#slider-rotate-y')?.addEventListener('input', e => setRotationSelectedObject(e.target.value));
  document.querySelector('#inp-rotate-y')?.addEventListener('change', e => setRotationSelectedObject(e.target.value));

  // Rotate Quick Buttons for Props
  document.querySelector('#btn-prop-rot-ccw')?.addEventListener('click', () => rotateSelectedObject(-90));
  document.querySelector('#btn-prop-rot-cw')?.addEventListener('click', () => rotateSelectedObject(90));
  document.querySelector('#btn-prop-rot-45')?.addEventListener('click', () => rotateSelectedObject(45));

  // Rotate Quick Buttons for Foliage
  document.querySelector('#btn-foliage-rot-ccw')?.addEventListener('click', () => rotateSelectedObject(-90));
  document.querySelector('#btn-foliage-rot-cw')?.addEventListener('click', () => rotateSelectedObject(90));
  document.querySelector('#btn-foliage-rot-45')?.addEventListener('click', () => rotateSelectedObject(45));

  // Tab 1: Buildings Buttons
  document.querySelector('#btn-copy-coords')?.addEventListener('click', () => {
    if (!selectedObject) {
      showToast('Chưa chọn tòa nhà nào để copy!', '#f59e0b');
      return;
    }
    const grp = selectedObject.group || selectedObject;
    const x = grp.position.x.toFixed(2);
    const y = grp.position.y.toFixed(2);
    const z = grp.position.z.toFixed(2);
    const rot = ((grp.rotation.y * 180) / Math.PI).toFixed(1);
    const text = `Tòa nhà: ${selectedObject.name || grp.name}\nPosition: [${x}, ${y}, ${z}]\nRotation: ${rot}°`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(`Đã copy tọa độ [${x}, ${z}]!`, '#059669');
      }).catch(() => prompt('Tọa độ:', text));
    } else {
      prompt('Tọa độ:', text);
    }
  });

  document.querySelector('#btn-download-layout')?.addEventListener('click', () => {
    const layoutExport = {
      schemaVersion: '2.5.0-art-review-d',
      timestamp: new Date().toISOString(),
      buildings: []
    };
    for (const [id, fp] of buildingFootprints) {
      const p = fp.group.position;
      layoutExport.buildings.push({
        id,
        name: fp.name,
        position: [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))],
        rotationY: Number(fp.group.rotation.y.toFixed(3))
      });
    }
    const blob = new Blob([JSON.stringify(layoutExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campus-layout-topology-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Đã lưu file Topology thành công!', '#059669');
  });

  // Tab 2: Props Buttons & Line Mode
  document.querySelector('#btn-prop-translate')?.addEventListener('click', () => {
    transformControls.setMode('translate');
    syncTransformGizmoAxes();
  });
  document.querySelector('#btn-prop-rotate')?.addEventListener('click', () => {
    transformControls.setMode('rotate');
    syncTransformGizmoAxes();
  });
  document.querySelector('#btn-prop-scale')?.addEventListener('click', () => {
    transformControls.setMode('scale');
    syncTransformGizmoAxes();
  });
  document.querySelector('#btn-prop-duplicate')?.addEventListener('click', () => {
    duplicateSelected();
    updatePropsListUI();
  });
  document.querySelector('#btn-prop-delete')?.addEventListener('click', () => {
    deleteSelectedAsset();
    updatePropsListUI();
  });
  document.querySelectorAll('input[name="prop-place-mode"]').forEach(rad => {
    rad.addEventListener('change', e => {
      const spRow = document.querySelector('#prop-line-spacing-row');
      if (spRow) spRow.style.display = e.target.value === 'line' ? 'flex' : 'none';
      if (activeTab === 'props') switchTab('props');
    });
  });

  // Tab 3: Foliage Buttons & Line Mode
  document.querySelector('#btn-foliage-translate')?.addEventListener('click', () => {
    transformControls.setMode('translate');
    syncTransformGizmoAxes();
  });
  document.querySelector('#btn-foliage-rotate')?.addEventListener('click', () => {
    transformControls.setMode('rotate');
    syncTransformGizmoAxes();
  });
  document.querySelector('#btn-foliage-scale')?.addEventListener('click', () => {
    transformControls.setMode('scale');
    syncTransformGizmoAxes();
  });
  document.querySelector('#btn-foliage-duplicate')?.addEventListener('click', () => {
    duplicateSelected();
    updateFoliageListUI();
  });
  document.querySelector('#btn-foliage-delete')?.addEventListener('click', () => {
    deleteSelectedAsset();
    updateFoliageListUI();
  });
  document.querySelector('#btn-foliage-clear')?.addEventListener('click', () => {
    if (confirm('Dọn dẹp toàn bộ cây cối mới trồng?')) clearAllCustomAssets();
  });
  document.querySelectorAll('input[name="foliage-place-mode"]').forEach(rad => {
    rad.addEventListener('change', e => {
      const spRow = document.querySelector('#foliage-line-spacing-row');
      if (spRow) spRow.style.display = e.target.value === 'line' ? 'flex' : 'none';
      if (activeTab === 'foliage') switchTab('foliage');
    });
  });

  // SimCity Dock & New Tools Bindings
  document.querySelectorAll('.sim-dock-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-dock-tab');
      if (target) switchTab(target);
    });
  });
  document.querySelector('#dock-btn-eyedropper')?.addEventListener('click', () => {
    setEyedropperMode(!eyedropperActive);
  });
  
  // Select Tool Actions (Rotate & Delete & Target Info UI)
  function updateSelectTargetInfoUI() {
    const infoEl = document.querySelector('#select-active-target-info');
    if (!infoEl) return;
    if (selectedObject && selectedObject.userData?.buildingId) {
      infoEl.innerHTML = `🏛️ Selected Building: <b style="color:#38bdf8;">${selectedObject.userData.buildingId}</b> [Pos: ${selectedObject.group?.position.x.toFixed(1)}, ${selectedObject.group?.position.z.toFixed(1)}]`;
    } else if (selectedObject && selectedObject.userData?.isCustomAsset) {
      infoEl.innerHTML = `🌳 Selected Prop/Tree: <b style="color:#34d399;">${selectedObject.name || selectedObject.userData?.assetType}</b> [Pos: ${selectedObject.position.x.toFixed(1)}, ${selectedObject.position.z.toFixed(1)}]`;
    } else if (selectedNativeCourt) {
      infoEl.innerHTML = `🟧 Selected Orange Court: <b style="color:#fb923c;">${selectedNativeCourt.id}</b> [W: ${selectedNativeCourt.w}m, D: ${selectedNativeCourt.d}m, Rot: ${(selectedNativeCourt.rotY || 0).toFixed(2)}]`;
    } else if (selectedNativeWalk) {
      infoEl.innerHTML = `🟡 Selected Walkway Handle: <b style="color:#facc15;">${selectedNativeWalk.path?.id}</b> [Node #${selectedNativeWalk.pointIndex + 1}]`;
    } else {
      infoEl.innerHTML = `🎯 Current Target: <i style="color:#94a3b8;">(Click on any object in the 3D scene)</i>`;
    }
  }

  document.querySelector('#btn-select-tool-rot')?.addEventListener('click', () => {
    if (selectedObject) {
      rotateSelectedObject(90);
    } else if (selectedNativeCourt) {
      selectedNativeCourt.rotY = (selectedNativeCourt.rotY || 0) + Math.PI / 2;
      nativeProxyObj.rotation.y = selectedNativeCourt.rotY;
      rebuildTerrainSurfaces();
      rebuildNativeWalkwaysAndCourtsMeshes();
      syncNativeSurfaceUI();
      updateSelectTargetInfoUI();
    }
  });

  document.querySelector('#btn-select-tool-del')?.addEventListener('click', () => {
    if (selectedObject && selectedObject.userData?.isCustomAsset) {
      deleteSelectedAsset();
      updateSelectTargetInfoUI();
    } else if (selectedNativeCourt) {
      selectedNativeCourt.hidden = true;
      selectedNativeCourt = null;
      deselect();
      rebuildTerrainSurfaces();
      rebuildNativeWalkwaysAndCourtsMeshes();
      syncNativeSurfaceUI();
      updateSelectTargetInfoUI();
      showToast('🗑️ Deleted selected court!', '#dc2626');
    } else if (selectedNativeWalk) {
      const p = selectedNativeWalk.path;
      p.hidden = true;
      selectedNativeWalk = null;
      deselect();
      rebuildTerrainSurfaces();
      rebuildNativeWalkwaysAndCourtsMeshes();
      syncNativeSurfaceUI();
      updateSelectTargetInfoUI();
      showToast('🗑️ Deleted selected walkway!', '#dc2626');
    }
  });

  document.querySelector('#dock-btn-rotate')?.addEventListener('click', () => {
    if (selectedObject) rotateSelectedObject(90);
    else {
      ghostRotationY = (ghostRotationY + Math.PI / 2) % (Math.PI * 2);
      showToast('🔄 Đã xoay hướng đặt đối tượng +90°', '#0284c7');
    }
  });
  document.querySelector('#dock-btn-undo')?.addEventListener('click', executeUndo);
  document.querySelector('#dock-btn-save')?.addEventListener('click', () => saveStudioState(true));
  document.querySelector('#dock-btn-close-clean')?.addEventListener('click', () => setEditMode(false));
  document.querySelector('#btn-smart-align-road')?.addEventListener('click', smartAlignSelectedBuildingToRoad);
  document.querySelector('#btn-bulldoze-all-foliage')?.addEventListener('click', () => {
    if (confirm('Ủi sạch toàn bộ cây cối & đồ trang trí mới đặt?')) clearAllCustomAssets();
  });
  document.querySelector('#btn-bulldoze-all-roads')?.addEventListener('click', () => {
    if (confirm('Ủi sạch toàn bộ đường tự vẽ?')) clearCustomRoads();
  });
  document.querySelector('#btn-restore-demolished')?.addEventListener('click', () => {
    restoreAllDemolishedNativeItems();
  });
  document.querySelector('#btn-reset-all-campus')?.addEventListener('click', () => {
    if (!confirm('Khôi phục TOÀN BỘ Campus về trạng thái mặc định ban đầu?')) return;
    localStorage.removeItem(STORAGE_KEY);
    restoreAllDemolishedNativeItems();
    clearAllCustomAssets();
    clearCustomRoads();
    resetTerrainHeights();
    resetGroundPaint();
    showToast('🔄 Đã Reset Toàn Bộ Campus về mặc định gốc!', '#0284c7');
  });

  // Number hotkeys [1-6], [B], and [I] for SimCity-like instant tool switching
  window.addEventListener('keydown', e => {


    if (!editModeActive || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === '1') switchTab('buildings');
    else if (e.key === '2') switchTab('props');
    else if (e.key === '3') switchTab('foliage');
    else if (e.key === '4') switchTab('roads');
    else if (e.key === '5') switchTab('terrain');
    else if (e.key === '6' || e.key === 'b' || e.key === 'B') switchTab('bulldoze');
    else if (e.key === 'i' || e.key === 'I') setEyedropperMode(!eyedropperActive);
  });

  // Global Footer Actions: Undo, Redo, Save, Export, Import
  document.querySelector('#btn-global-undo')?.addEventListener('click', executeUndo);
  document.querySelector('#btn-global-redo')?.addEventListener('click', executeRedo);
  document.querySelector('#btn-global-save')?.addEventListener('click', () => saveStudioState(true));

  document.querySelector('#btn-export-full')?.addEventListener('click', () => {
    const state = serializeStudioState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anphim-campus-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector('#file-import-full')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        loadStudioState(parsed);
        saveStudioState();
      } catch (err) {
        alert('File JSON không hợp lệ!');
      }
    };
    reader.readAsText(file);
  });

  function syncUI() {
    if (selectedObject) onTransformChange();
    updateHierarchyUI();
  }

  window.editorSwitchTab = switchTab;

  // Toggle collapse drawer
  document.querySelector('#btn-toggle-drawer-collapse')?.addEventListener('click', (e) => {
    const contentEl = document.querySelector('#bottom-drawer-content');
    const btn = e.target;
    if (contentEl) {
      const isCollapsed = contentEl.style.display === 'none';
      contentEl.style.display = isCollapsed ? 'block' : 'none';
      btn.textContent = isCollapsed ? 'Thu gọn ▼' : 'Mở rộng ▲';
    }
  });

  // Expose new helper methods on agentAPI for automated testing & agent usage
  
  function clearGridRoadsInRegion(minX, minZ, maxX, maxZ) {
    const toRemove = [];
    gridRoadsMap.forEach((entry, key) => {
      const wx = entry.gx * entry.step;
      const wz = entry.gz * entry.step;
      if (wx >= minX && wx <= maxX && wz >= minZ && wz <= maxZ) {
        toRemove.push([entry.gx, entry.gz]);
      }
    });
    for (const [gx, gz] of toRemove) {
      removeGridRoadTile(gx, gz, false);
    }
    saveStudioState();
    return toRemove.length;
  }
  agentAPI.clearGridRoadsInRegion = clearGridRoadsInRegion;
agentAPI.placeGridRoadTile = (gx, gz, type, stepSize) => placeGridRoadTile(gx, gz, type, stepSize, true);
  agentAPI.removeGridRoadTile = (gx, gz) => removeGridRoadTile(gx, gz, true);
  agentAPI.placeAssetLine = (type, p0, p1, spacing) => placeAssetLine(type, p0, p1, spacing);
  agentAPI.restoreAllDemolishedNativeItems = restoreAllDemolishedNativeItems;
  agentAPI.promoteNativeTargetToEditable = promoteNativeTargetToEditable;
  agentAPI.setEyedropperMode = setEyedropperMode;
  agentAPI.executeEyedropper = executeEyedropper;

  const editorInstance = {
    isEditMode: () => editModeActive,
    toggleEditMode: () => setEditMode(!editModeActive),
    setEditMode,
    selectBuilding,
    selectCustomObject,
    deselect,
    evaluateCollision,
    evaluateAllCollisions,
    transformControls,
    saveStudioState,
    loadStudioState,
    placeGridRoadTile,
    removeGridRoadTile,
    placeAssetLine,
    restoreAllDemolishedNativeItems,
    promoteNativeTargetToEditable,
    setEyedropperMode,
    executeEyedropper,
    getSelectedNativeWalk: () => selectedNativeWalk,
    getSelectedNativeCourt: () => selectedNativeCourt,
    selectNativeHandle: selectNativeWalkPoint,
    nudgeSelectedObject,
    agentAPI
  };
  agentAPI.getSelectedNativeWalk = () => selectedNativeWalk;
  agentAPI.getSelectedNativeCourt = () => selectedNativeCourt;
  agentAPI.selectNativeHandle = selectNativeWalkPoint;
  agentAPI.nudgeSelectedObject = nudgeSelectedObject;

  // --- KẾT NỐI TƯƠNG TÁC FLOATING TOP BAR & LIVE COORDINATE HUD ---
  // 1. Live Coordinate Tracker khi rê chuột trên mặt đất
  const mouseRay = new T.Raycaster();
  const screenMouse = new T.Vector2();
  const coordTextEl = document.querySelector('#live-coord-text');
  const coordBadgeEl = document.querySelector('#live-coord-badge');

  window.addEventListener('pointermove', (evt) => {
    if (!coordTextEl) return;
    const rect = renderer.domElement.getBoundingClientRect();
    screenMouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    screenMouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    mouseRay.setFromCamera(screenMouse, camera);
    const hit = mouseRay.intersectObject(tMesh, false)[0];
    if (hit) {
      const curX = hit.point.x.toFixed(1);
      const curZ = hit.point.z.toFixed(1);
      coordTextEl.textContent = `X: ${curX} | Z: ${curZ}`;
      coordBadgeEl.dataset.curCoord = `[${curX}, ${curZ}]`;
    }
  });

  // Click vào badge là copy ngay tọa độ vào clipboard
  coordBadgeEl?.addEventListener('click', () => {
    const coordStr = coordBadgeEl.dataset.curCoord || coordTextEl.textContent;
    navigator.clipboard.writeText(coordStr).then(() => {
      showToast(`📋 Đã copy tọa độ: ${coordStr}`, '#0284c7');
    });
  });

  // 2. Nút toggle Lưới Tọa Độ [G] trên Top Bar
  document.querySelector('#btn-toggle-grid-hud')?.addEventListener('click', () => {
    setGridState({ visible: !gridVisible });
    showToast(gridVisible ? '📐 Đã bật Lưới & Số Tọa Độ 5m' : '📐 Đã tắt Lưới Tọa Độ', '#0284c7');
  });

  // 3. Nút toggle Công Cụ Sửa [E] trên Top Bar
  document.querySelector('#btn-toggle-editor-hud')?.addEventListener('click', () => {
    setEditMode(!editModeActive);
    const isNow = editModeActive;
    const hudBtn = document.querySelector('#btn-toggle-editor-hud');
    if (hudBtn) {
      hudBtn.style.background = isNow ? '#059669' : '#1e293b';
      hudBtn.style.color = isNow ? '#ffffff' : '#94a3b8';
      hudBtn.style.borderColor = isNow ? '#34d399' : '#475569';
    }
    showToast(isNow ? '🛠️ Đã mở Khay Công Cụ Sửa SimCity' : '🛠️ Đã đóng Khay Công Cụ Sửa', '#059669');
  });

  // Phím tắt E để bật tắt Editor
  window.addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E') {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      document.querySelector('#btn-toggle-editor-hud')?.click();
    }
  });

  // 4. Nút toggle Bảng Thông Số Phải
  document.querySelector('#btn-toggle-aside-hud')?.addEventListener('click', () => {
    const aside = document.querySelector('#main-aside-panel');
    if (aside) {
      const isHidden = aside.style.display === 'none' || aside.getAttribute('style')?.includes('none');
      aside.style.setProperty('display', isHidden ? 'block' : 'none', 'important');
    }
  });

  // 5. Kết nối các nút Quick View góc camera
  document.querySelectorAll('[data-quick-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.quickView;
      const targetBtn = document.querySelector(`nav.panel button[data-view="${v}"]`);
      if (targetBtn) targetBtn.click();
      else if (viewFn) viewFn(v);
    });
  });

  // 6. Tự động nạp toàn bộ 146 Models Chuẩn Hóa vào Dropdown Props & Foliage của SimCity Studio Editor
  loadStudioCatalog().then(catalog => {
    if (!Array.isArray(catalog) || catalog.length === 0) return;
    const propSelect = document.querySelector('#sel-prop-type');
    const foliageSelect = document.querySelector('#sel-foliage-type');

    if (propSelect) {
      const groups = [
        { key: 'shop_building', label: '🏬 Kiến Trúc & Tiệm (Studio 146 Models)' },
        { key: 'vehicle', label: '🚗 Phương Tiện & Xe Cộ (Studio 146 Models)' },
        { key: 'street_prop', label: '🪑 Tiện Ích Vỉa Hè (Studio 146 Models)' },
        { key: 'traffic_safety', label: '🚧 An Toàn Thi Công (Studio 146 Models)' },
        { key: 'lighting', label: '💡 Đèn & Kỹ Thuật (Studio 146 Models)' },
        { key: 'road', label: '🛣️ Đường & Vỉa Hè Modular (Studio 146 Models)' }
      ];
      for (const g of groups) {
        const items = catalog.filter(it => it.catKey === g.key);
        if (!items.length) continue;
        const og = document.createElement('optgroup');
        og.label = g.label;
        for (const it of items) {
          const opt = document.createElement('option');
          opt.value = it.id;
          opt.textContent = `${it.id} · ${it.title} (${it.dims})`;
          og.appendChild(opt);
        }
        propSelect.appendChild(og);
      }
    }

    if (foliageSelect) {
      const landItems = catalog.filter(it => it.catKey === 'landscape');
      if (landItems.length) {
        const og = document.createElement('optgroup');
        og.label = '🌳 Cảnh Quan & Cây Xanh (Studio 146 Models)';
        for (const it of landItems) {
          const opt = document.createElement('option');
          opt.value = it.id;
          opt.textContent = `${it.id} · ${it.title} (${it.dims})`;
          og.appendChild(opt);
        }
        foliageSelect.appendChild(og);
      }
    }
  }).catch(() => {});

  window.campusEditor = editorInstance;
  window.connectedCampusEditor = editorInstance;
  window.campusAgentAPI = agentAPI;

  return editorInstance;
}

// Auto enable grid if param set
if (new URLSearchParams(location.search).get('grid') === '1') {
  setTimeout(() => setGridState({ visible: true }), 800);
}
