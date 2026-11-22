import * as T from 'three';

/**
 * AN PHIM WORLD — URBAN PLANNING & ECOLOGY ENGINE
 * Kiến trúc quy hoạch đô thị chuẩn Strategy / City Builder (Cities: Skylines & Anno)
 * 
 * 1. Right-Of-Way (ROW) Road Corridor Enforcement (Mặt nạ cấm xâm lấn lòng đường)
 * 2. Poisson Disk Biological Sampling (Tán cây 3 tầng, chống dính chùm)
 * 3. Orthogonal Door-to-Road Projection (Khóa cứng lối vào 90 độ)
 * 4. Automated Urban Integrity Audit (Bộ thanh tra quy hoạch tự động)
 */

export function createUrbanPlanningEngine(L, terrain) {
  // 1. MATHEMATICAL ROAD CORRIDORS
  // Vùng đệm an toàn tuyệt đối của đường U-turn (Center: [0, 24.5], TurnRadius: 7.0, Width: 4.0)
  // CẤM TUYỆT ĐỐI 100% CẢ LÒNG ĐƯỜNG VÀ TOÀN BỘ ĐẢO CỎ HẸP (Vì đảo cỏ chỉ rộng 3.5m, cây tán 6m sẽ luôn tràn ra đường)
  function isInsideUTurnCorridor(x, z, clearance = 1.8) {
    // 1. Cấm toàn bộ hình chữ nhật bảo vệ bao trùm từ sảnh chính tới hết ngã ba đường U-turn
    if (Math.abs(x) <= (11.0 + clearance) && z >= (12.0 - clearance) && z <= (35.5 + clearance)) {
      return true;
    }
    return false;
  }

  // Vùng cấm xâm lấn quanh sảnh chính HQ và cầu thang (x: -8..8, z: 8..19)
  function isInsideHQForecourt(x, z, clearance = 1.0) {
    if (Math.abs(x) <= 8.5 + clearance && z >= 8.0 - clearance && z <= 19.0 + clearance) return true;
    return false;
  }

  // Vùng cấm xâm lấn của các tòa nhà (Building Parcels & Footprints)
  function isInsideBuildingFootprint(x, z, clearance = 1.2) {
    if (!L || !L.buildings || !L.grades) return false;
    for (const b of L.buildings) {
      const g = L.grades[b.grade] || [12, 10, 12];
      const hw = g[0] / 2 + clearance;
      const hd = g[2] / 2 + clearance;
      if (Math.abs(x - b.position[0]) <= hw && Math.abs(z - b.position[2]) <= hd) {
        return true;
      }
    }
    // Lô thật của các tòa có mặt bằng vượt ra ngoài ô hạng (vd. tòa nhỏ có cánh chữ L); main.js ghi vào L.builtLots sau khi dựng tòa
    for (const lot of Object.values(L.builtLots || {})) {
      if (x >= lot.minX - clearance && x <= lot.maxX + clearance && z >= lot.minZ - clearance && z <= lot.maxZ + clearance) return true;
    }
    return false;
  }

  // Vùng cấm xâm lấn của toàn bộ hệ thống đường đi (Cả đường xe lẫn đường dạo)
  function isInsideRoadCorridor(x, z, roads, clearance = 1.2) {
    if (isInsideUTurnCorridor(x, z, clearance)) return true;
    if (isInsideHQForecourt(x, z, clearance)) return true;
    if (isInsideBuildingFootprint(x, z, clearance)) return true;

    // Kiểm tra sông
    if (terrain && typeof terrain.riverZ === 'function' && typeof terrain.riverR === 'function') {
      const rz = terrain.riverZ(x);
      const rr = terrain.riverR(x) + clearance + 1.0;
      if (Math.abs(z - rz) <= rr) return true;
    }

    if (!roads || !roads.paths) return false;
    for (const p of roads.paths) {
      if (p.hidden || !p.curve) continue;
      const r = (p.width || 2.0) / 2 + (p.class >= 2 ? clearance + 0.6 : clearance);
      const len = p.curve.getLength();
      const steps = Math.max(8, Math.ceil(len / 0.5));
      for (let i = 0; i <= steps; i++) {
        const pt = p.curve.getPointAt(i / steps);
        if (Math.hypot(x - pt.x, z - pt.z) <= r) {
          return true;
        }
      }
    }
    return false;
  }

  // Kiểm tra vị trí an toàn tuyệt đối để trồng cây / đặt đồ cảnh quan
  function isSafeVegetationSpot(x, z, roads, minDistance = 1.6) {
    return !isInsideRoadCorridor(x, z, roads, minDistance);
  }

  // 2. BRIDSON'S POISSON DISK SAMPLING IN 2D
  // Thuật toán rải cây chuẩn sinh thái, đảm bảo không có 2 cây nào mọc sát nhau
  function generatePoissonDiskDistribution(bounds, minRadius, roads, maxSamples = 200) {
    const { minX, maxX, minZ, maxZ } = bounds;
    const points = [];
    const cellSize = minRadius / Math.SQRT2;
    const gridW = Math.ceil((maxX - minX) / cellSize);
    const gridD = Math.ceil((maxZ - minZ) / cellSize);
    const grid = new Int32Array(gridW * gridD).fill(-1);

    const activeList = [];

    function gridIdx(gx, gz) {
      return gz * gridW + gx;
    }

    function addPoint(x, z) {
      const p = { x, z };
      const idx = points.length;
      points.push(p);
      const gx = Math.floor((x - minX) / cellSize);
      const gz = Math.floor((z - minZ) / cellSize);
      if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridD) {
        grid[gridIdx(gx, gz)] = idx;
      }
      activeList.push(p);
      return p;
    }

    // Điểm khởi đầu ngẫu nhiên hợp lệ
    for (let attempt = 0; attempt < 50; attempt++) {
      const sx = minX + Math.random() * (maxX - minX);
      const sz = minZ + Math.random() * (maxZ - minZ);
      if (isSafeVegetationSpot(sx, sz, roads, minRadius * 0.4)) {
        addPoint(sx, sz);
        break;
      }
    }

    const k = 30; // 30 lần thử quanh mỗi điểm
    while (activeList.length > 0 && points.length < maxSamples) {
      const randIdx = Math.floor(Math.random() * activeList.length);
      const center = activeList[randIdx];
      let found = false;

      for (let attempt = 0; attempt < k; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = minRadius * (1 + Math.random());
        const nx = center.x + Math.cos(angle) * dist;
        const nz = center.z + Math.sin(angle) * dist;

        if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
        if (!isSafeVegetationSpot(nx, nz, roads, minRadius * 0.35)) continue;

        // Kiểm tra khoảng cách với các điểm đã có trong lưới
        const gx = Math.floor((nx - minX) / cellSize);
        const gz = Math.floor((nz - minZ) / cellSize);
        let tooClose = false;

        const searchR = 2;
        for (let ix = Math.max(0, gx - searchR); ix <= Math.min(gridW - 1, gx + searchR); ix++) {
          for (let iz = Math.max(0, gz - searchR); iz <= Math.min(gridD - 1, gz + searchR); iz++) {
            const neighborIdx = grid[gridIdx(ix, iz)];
            if (neighborIdx !== -1) {
              const neighbor = points[neighborIdx];
              if (Math.hypot(nx - neighbor.x, nz - neighbor.z) < minRadius) {
                tooClose = true;
                break;
              }
            }
          }
          if (tooClose) break;
        }

        if (!tooClose) {
          addPoint(nx, nz);
          found = true;
          break;
        }
      }

      if (!found) {
        activeList.splice(randIdx, 1);
      }
    }

    return points;
  }

  return {
    isInsideUTurnCorridor,
    isInsideHQForecourt,
    isInsideBuildingFootprint,
    isInsideRoadCorridor,
    isSafeVegetationSpot,
    generatePoissonDiskDistribution,
    enforceUrbanSpatialClearance: (scene) => {
      if (!scene) return 0;
      scene.updateMatrixWorld(true);
      let purgedCount = 0;
      const zeroMat = new T.Matrix4().makeScale(0, 0, 0);
      const m = new T.Matrix4();
      const p = new T.Vector3();

      scene.traverse(o => {
        // The room of an inspected building stands on the building's own spot and is never scenery to clear
        if (o.userData.interior) return;
        // 1. Quét InstancedMesh (cây cối, đá, bụi cây Kenney/Nature Kit)
        if (o.parent?.name === "hq-smooth-road-and-curbs" ||
            (o.parent?.name === "u-turn-central-island" && o.userData.arrivalMedianPlant)) return;
        if (o.isInstancedMesh) {
          if (o.userData?.keepInArrivalZone) return;
          let updated = false;
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, m);
            p.setFromMatrixPosition(m);
            p.applyMatrix4(o.matrixWorld);

            // Kiểm tra xem vị trí có nằm trong vùng cấm U-turn / sảnh chính (|x| <= 12, z in [10, 36])
            if (Math.abs(p.x) <= 12.0 && p.z >= 10.0 && p.z <= 36.0) {
              o.setMatrixAt(i, zeroMat);
              updated = true;
              purgedCount++;
            }
          }
          if (updated) {
            o.instanceMatrix.needsUpdate = true;
            if (o.boundingSphere) o.computeBoundingSphere();
          }
        } else if (o.isMesh) {
          // 2. Quét dọn dẹp tuyệt đối toàn bộ khu vực U-turn và sảnh chính
          const isAllowedInfrastructure = 
            o.userData?.keepInArrivalZone ||
            o.name === 'continuous-ground' ||
            o.name === 'river-only' ||
            o.name === 'smooth-u-turn-asphalt' ||
            o.name === 'smooth-outer-walkway' ||
            o.name === 'smooth-outer-curb' ||
            o.name === 'smooth-inner-curb' ||
            o.name === 'smooth-island-turf-cap' ||
            o.name?.includes('stair') ||
            o.parent?.name?.includes('stair') ||
            o.name?.includes('road-markings') ||
            o.parent?.name?.includes('road-markings') ||
            o.parent?.name === 'hq-smooth-road-and-curbs' ||
            (o.geometry?.type === 'PlaneGeometry' && o.name?.includes('grid'));

          if (!isAllowedInfrastructure) {
            const wp = new T.Vector3();
            o.getWorldPosition(wp);
            if (Math.abs(wp.x) <= 12.5 && wp.z >= 12.0 && wp.z <= 37.0) {
              o.visible = false;
              o.scale.set(0, 0, 0);
              o.position.set(0, -9999, 0);
              purgedCount++;
              return;
            }

            const box = new T.Box3().setFromObject(o);
            const c = box.getCenter(new T.Vector3());
            if (Math.abs(c.x) <= 12.5 && c.z >= 12.0 && c.z <= 37.0) {
              o.visible = false;
              o.scale.set(0, 0, 0);
              o.position.set(0, -9999, 0);
              purgedCount++;
              return;
            }
          }
        }
      });

      console.log(`[Urban Planning Engine] AAA Spatial Enforcement complete. Purged ${purgedCount} illegal elements.`);
      return purgedCount;
    }
  };
}
