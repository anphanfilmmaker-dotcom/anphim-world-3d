import * as T from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';

/**
 * STUDIO CATALOG 146 MODELS LOADER & ASSET PACK EXTRACTOR
 * Chuẩn hóa 100% 146 models từ 6 bộ file GLB của sếp:
 * - Giữ nguyên ma trận thế giới Y-up (sourceNode.matrixWorld.decompose)
 * - Quy chuẩn kích thước thực tế 1 unit = 1 mét (loại bỏ hệ số 100x cm của FBX/Blender trong p1)
 * - Căn chuẩn Bottom-Center Ground Pivot (Tâm X, Z = 0, Mép đáy dưới cùng Y = 0 tại box.min.y)
 * - Xoay đúng góc mặt tiền frontRotY hướng thẳng về +Z
 */

const loader = new GLTFLoader();

const PACK_URLS = {
  bakery: './models/packs/korean_bakery.glb',
  p1: './models/packs/lowpoly_city_street_pack_buildings_stylized.glb',
  p2: './models/packs/low_poly_city_pack.glb',
  p3: './models/packs/free_lowpoly_city_props_pack__by_maha.glb',
  p4: './models/packs/city_props_collection_volume_1.glb',
  p5: './models/packs/neighbourhood_city_modular_lowpoly.glb',
  p6: './models/packs/road_modular.glb'
};

// Kích thước chuẩn thực tế ngoài đời (mét) cho các prop/xe cộ trong bộ p1 (vốn được vẽ phóng đại trong file gốc)
const REAL_WORLD_MAX_DIM_OVERRIDES = {
  '#024': 11.5, // Sân khấu âm nhạc ngoài trời
  '#025': 12.5, // Sân bóng rổ ngoài trời
  '#026': 4.5,  // Xe Ô Tô Van Vàng (dài 4.5m tương đương BMW #041)
  '#027': 14.0, // Tuyến đường ray & tàu điện
  '#028': 1.85, // Xe máy giao bánh Pizza (dài 1.85m chuẩn thực tế)
  '#029': 1.80, // Xe máy tay ga Vespa đỏ (dài 1.80m chuẩn thực tế)
  '#030': 4.8,  // Cây xanh đô thị bồn tròn (cao 4.8m)
  '#031': 1.85, // Ghế băng gỗ công viên (dài 1.85m)
  '#032': 4.2,  // Cột đèn đường đơn (cao 4.2m)
  '#033': 1.15  // Thùng rác nhựa xanh (cao 1.15m)
};

function getTargetMetricMaxDim(item) {
  if (REAL_WORLD_MAX_DIM_OVERRIDES[item.id]) {
    return REAL_WORLD_MAX_DIM_OVERRIDES[item.id];
  }
  if (item.dims && typeof item.dims === 'string') {
    const nums = item.dims
      .split('x')
      .map(s => parseFloat(s.replace(/[^0-9.]/g, '')))
      .filter(n => Number.isFinite(n) && n > 0);
    if (nums.length > 0) {
      return Math.max(...nums);
    }
  }
  return null;
}

const packCache = new Map();
const packLoadingPromises = new Map();
let catalogPromise = null;
let catalogList = null;
const catalogById = new Map();
const prototypeCache = new Map();

export async function loadStudioCatalog() {
  if (catalogList) return catalogList;
  if (!catalogPromise) {
    catalogPromise = fetch('./catalog-146.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        catalogList = Array.isArray(data) ? data : [];
        for (const item of catalogList) {
          catalogById.set(item.id, item);
          catalogById.set(item.id.replace('#', ''), item);
        }
        window.__STUDIO_CATALOG_146__ = catalogList;
        return catalogList;
      })
      .catch(err => {
        console.warn('Failed to load catalog-146.json:', err);
        catalogList = [];
        return [];
      });
  }
  return catalogPromise;
}

export async function loadPackByKey(packKey) {
  const url = PACK_URLS[packKey];
  if (!url) return null;
  if (packCache.has(packKey)) return packCache.get(packKey);
  if (packLoadingPromises.has(packKey)) return packLoadingPromises.get(packKey);

  const p = new Promise((resolve) => {
    loader.load(url, (gltf) => {
      if (gltf && gltf.scene) {
        gltf.scene.updateMatrixWorld(true);
      }
      packCache.set(packKey, gltf);
      resolve(gltf);
    }, undefined, (err) => {
      console.warn(`Failed loading pack ${packKey} (${url}):`, err);
      resolve(null);
    });
  });
  packLoadingPromises.set(packKey, p);
  return p;
}

function normNodeName(s) {
  return (s || '').replace(/[\.\:\s_-]+/g, '').toLowerCase();
}

function findNodeInScene(packScene, rawName, allowSubstring = true) {
  let found = null;
  const targetNorm = normNodeName(rawName);
  packScene.traverse(c => {
    if (!found && c.name === rawName) found = c;
  });
  if (!found && targetNorm) {
    packScene.traverse(c => {
      if (!found && normNodeName(c.name) === targetNorm) found = c;
    });
  }
  if (!found && allowSubstring && targetNorm) {
    packScene.traverse(c => {
      if (!found && c.name && normNodeName(c.name).includes(targetNorm)) {
        found = c;
      }
    });
  }
  return found;
}

function normalizeMaterialsAndShadows(root) {
  root.traverse(c => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => {
        if (!m) return;
        // Giảm phản xạ kim loại & tăng độ nhám để ánh sáng tán xạ êm dịu, không bị chói lóa
        if (typeof m.metalness === 'number' && m.metalness > 0.04) {
          m.metalness = 0.02;
        }
        if (typeof m.roughness === 'number' && m.roughness < 0.80) {
          m.roughness = 0.85;
        }
        
        // Điều chỉnh albedo của vật liệu nhà cửa:
        // 1. Nếu có map texture: hạ nhẹ tint màu xuống 0.88 - 0.90 để texture không bị chói lóa dưới ánh mặt trời
        if (m.map) {
          m.map.colorSpace = T.SRGBColorSpace;
          if (m.color) {
            m.color.setRGB(0.88, 0.88, 0.88);
          }
        } else if (m.color) {
          // 2. Nếu là màu phẳng (không texture): nếu quá sáng (> 0.85) thì làm dịu về tông vữa/sơn kiến trúc thực tế
          if (m.color.r > 0.85 && m.color.g > 0.85 && m.color.b > 0.85) {
            m.color.multiplyScalar(0.85);
          }
        }

        if (m.aoMap) m.aoMapIntensity = 0.55;
        m.needsUpdate = true;
      });
    }
  });
}

/**
 * Dựng model chuẩn hóa từ định nghĩa catalog item (#001..#146)
 * Đảm bảo:
 * - World-space Y-up preserved (matrixWorld.decompose)
 * - Metric normalization (1 unit = 1 meter thực tế)
 * - Bottom-Center Ground Pivot (X=0, Z=0, minY=0)
 * - Front Facade oriented to +Z (frontRotY)
 */
export async function getStudioModelById(modelId, options = {}) {
  await loadStudioCatalog();
  const cleanId = String(modelId).startsWith('#') ? String(modelId) : '#' + String(modelId).padStart(3, '0');
  const item = catalogById.get(cleanId) || catalogById.get(String(modelId));
  if (!item) {
    console.warn(`[StudioCatalog] Model ID not found: ${modelId}`);
    return null;
  }

  let proto = prototypeCache.get(item.id);
  if (!proto) {
    if (item.type === 'whole') {
      const gltf = await loadPackByKey('bakery');
      if (gltf && gltf.scene) {
        gltf.scene.updateMatrixWorld(true);
        const cloned = gltf.scene.clone(true);
        const innerGroup = new T.Group();
        innerGroup.add(cloned);
        const wrapper = new T.Group();
        wrapper.add(innerGroup);
        wrapper.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(innerGroup);
        const center = new T.Vector3();
        box.getCenter(center);
        innerGroup.position.set(-center.x, -box.min.y, -center.z);
        if (typeof item.frontRotY === 'number') {
          wrapper.rotation.y = item.frontRotY;
        }
        wrapper.updateMatrixWorld(true);
        normalizeMaterialsAndShadows(wrapper);
        proto = wrapper;
      }
    } else if (item.packKey) {
      const gltf = await loadPackByKey(item.packKey);
      if (gltf && gltf.scene) {
        const packScene = gltf.scene;
        packScene.updateMatrixWorld(true);

        const targetNames = (Array.isArray(item.meshNames) && item.meshNames.length > 0)
          ? item.meshNames
          : [item.meshName];

        const sourceNodes = [];
        const isMulti = targetNames.length > 1;
        for (const tName of targetNames) {
          const n = findNodeInScene(packScene, tName, !isMulti);
          if (n) sourceNodes.push(n);
        }

        if (sourceNodes.length > 0) {
          const innerGroup = new T.Group();
          for (const sourceNode of sourceNodes) {
            const worldPos = new T.Vector3();
            const worldQuat = new T.Quaternion();
            const worldScale = new T.Vector3();
            sourceNode.matrixWorld.decompose(worldPos, worldQuat, worldScale);

            const clonedSubtree = sourceNode.clone(true);
            clonedSubtree.position.copy(worldPos);
            clonedSubtree.quaternion.copy(worldQuat);
            clonedSubtree.scale.copy(worldScale);
            innerGroup.add(clonedSubtree);
          }

          const wrapper = new T.Group();
          wrapper.add(innerGroup);
          wrapper.updateMatrixWorld(true);

          // Chuẩn hóa kích thước thực tế 1 unit = 1 mét (loại bỏ hệ số 100x cm của p1 và chuẩn hóa prop)
          const rawBox = new T.Box3().setFromObject(innerGroup);
          const rawSz = rawBox.getSize(new T.Vector3());
          const rawMax = Math.max(rawSz.x, rawSz.y, rawSz.z);
          const targetMetricMax = getTargetMetricMaxDim(item);
          if (targetMetricMax && rawMax > 0.001) {
            if (item.packKey === 'p1' || rawMax > targetMetricMax * 1.35) {
              const metricFactor = targetMetricMax / rawMax;
              innerGroup.scale.multiplyScalar(metricFactor);
              wrapper.updateMatrixWorld(true);
            }
          }

          const box = new T.Box3().setFromObject(innerGroup);
          const center = new T.Vector3();
          box.getCenter(center);
          innerGroup.position.set(-center.x, -box.min.y, -center.z);

          if (typeof item.frontRotY === 'number') {
            wrapper.rotation.y = item.frontRotY;
          }
          wrapper.updateMatrixWorld(true);
          normalizeMaterialsAndShadows(wrapper);
          proto = wrapper;
        }
      }
    }

    if (proto) {
      prototypeCache.set(item.id, proto);
    }
  }

  if (!proto) return null;

  // Bọc trong 1 outerGroup mới để giữ nguyên wrapper.rotation.y bên trong
  const instance = new T.Group();
  instance.name = `studio_${item.id.replace('#', '')}`;
  const clonedProto = proto.clone(true);
  instance.add(clonedProto);
  instance.updateMatrixWorld(true);

  let box = new T.Box3().setFromObject(instance);
  let sz = box.getSize(new T.Vector3());

  // Scale theo fitFootprint, fitBox [w, h, d] hoặc targetHeight nếu được yêu cầu
  if (options.fitFootprint && Array.isArray(options.fitFootprint)) {
    const [tw, td] = options.fitFootprint;
    const maxH = options.maxHeight || 22;
    const minH = options.minHeight || 4.2;
    let scale = Math.min(tw / Math.max(sz.x, 0.01), td / Math.max(sz.z, 0.01));
    if (sz.y * scale > maxH) {
      scale = maxH / Math.max(sz.y, 0.01);
    } else if (sz.y * scale < minH) {
      scale = Math.min(minH / Math.max(sz.y, 0.01), (tw * 1.15) / Math.max(sz.x, 0.01), (td * 1.15) / Math.max(sz.z, 0.01));
    }
    clonedProto.scale.multiplyScalar(scale);
    instance.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(instance);
    sz = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    clonedProto.position.x -= center.x;
    clonedProto.position.y -= box.min.y;
    clonedProto.position.z -= center.z;
    instance.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(instance);
    sz = box.getSize(new T.Vector3());
  } else if (options.fitBox && Array.isArray(options.fitBox)) {
    const [tw, th, td] = options.fitBox;
    const scale = Math.min(tw / Math.max(sz.x, 0.01), th / Math.max(sz.y, 0.01), td / Math.max(sz.z, 0.01));
    clonedProto.scale.multiplyScalar(scale);
    instance.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(instance);
    sz = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    clonedProto.position.x -= center.x;
    clonedProto.position.y -= box.min.y;
    clonedProto.position.z -= center.z;
    instance.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(instance);
    sz = box.getSize(new T.Vector3());
  } else if (options.targetHeight && sz.y > 0.001) {
    const scale = options.targetHeight / sz.y;
    clonedProto.scale.multiplyScalar(scale);
    instance.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(instance);
    sz = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    clonedProto.position.x -= center.x;
    clonedProto.position.y -= box.min.y;
    clonedProto.position.z -= center.z;
    instance.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(instance);
    sz = box.getSize(new T.Vector3());
  } else if (options.scale && options.scale !== 1) {
    clonedProto.scale.multiplyScalar(options.scale);
    instance.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(instance);
    sz = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    clonedProto.position.x -= center.x;
    clonedProto.position.y -= box.min.y;
    clonedProto.position.z -= center.z;
    instance.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(instance);
    sz = box.getSize(new T.Vector3());
  }

  // Gắn entry-socket tại chính giữa mặt tiền (+Z) để hệ thống đường đi bộ Campus nối thẳng vào cửa
  if (options.addEntrySocket !== false) {
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(0, 0, box.max.z + 0.14);
    instance.add(socket);
  }

  instance.userData.studioId = item.id;
  instance.userData.studioTitle = item.title;
  instance.userData.studioCat = item.catKey;
  instance.userData.bbox = [sz.x, sz.y, sz.z];

  return instance;
}
