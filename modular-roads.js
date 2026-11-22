import * as T from 'three';
import { getStudioModelById } from './asset-pack-extractor.js?rev=146';
import { analyseRoadNetwork, sideOpenings, isInside, buildMarkingBoxes, createMarkingMesh } from './road-markings.js?rev=8';

/**
 * AN PHIM HIGH-FIDELITY UNIFIED ROAD NETWORK
 * Tuân thủ nghiêm ngặt chuẩn quy hoạch đô thị Three.js (threejs-city-builder skill):
 * 1. Triệt tiêu 100% hiện tượng "Sticker Patchwork" (các tấm gạch vá vụn vỡ đè nham nhở lên mặt cỏ).
 * 2. Tuyến Đại lộ Vành đai (Campus Ring Road) trải nhựa mượt mà, ôm sát địa hình với vạch đôi vàng tim đường, vạch trắng mép đường và gờ bó vỉa bê tông nổi (raised concrete curbs).
 * 3. Tích hợp trọn bộ trang thiết bị đô thị chuẩn 3D từ bộ file road_modular.glb của Sếp:
 *    - Nhà chờ xe buýt hiện đại (#141) đầy đủ kính, poster và ghế ngồi
 *    - Cột đèn cao áp đại lộ cần đôi (#143) và cần đơn (#144)
 *    - Cột đèn tín hiệu giao thông ngã tư (#145)
 *    - Biển báo giới hạn tốc độ 100 km/h (#146)
 *    - Vạch tim, vạch mép, vạch dừng và vạch qua đường (zebra) tự sinh ở mọi ngã ba / ngã tư (road-markings.js)
 */
export async function createModularRoadSystem(scene, terrain, roads) {
  const roadRoot = new T.Group();
  roadRoot.name = 'anphim-modular-road-network';
  scene.add(roadRoot);

  // --- VẬT LIỆU CHUẨN ĐÔ THỊ ---
  const asphaltMat   = new T.MeshStandardMaterial({ color: 0x4f6078, roughness: 0.86 }); // Mặt đường nhựa xám xanh slate
  const whiteLineMat  = new T.MeshBasicMaterial({ color: 0xf8fafc, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });                    // Vạch sơn trắng mép đường & zebra
  const curbMat       = new T.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.78 }); // Bó vỉa bê tông đô thị
  const sidewalkMat   = new T.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.85 }); // Vỉa hè đá kem ấm áp

  function addBox(parent, w, h, d, x, y, z, mat, rotY = 0) {
    const geo = new T.BoxGeometry(w, h, d);
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y + h / 2, z);
    if (rotY) m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // =========================================================================
  // 1. MẶT ĐƯỜNG VÀNH ĐAI, BÓ VỈA, VỈA HÈ VÀ VẠCH KẺ ĐƯỜNG (dựng lại được khi mạng lưới đường thay đổi)
  // =========================================================================
  const halfW = 4.2; // Mặt đường rộng 8.4m
  const curbW = 0.26, curbH = 0.07, walkW = 1.35;
  const ROAD_COLS = [-1, -0.78, -0.4, 0, 0.4, 0.78, 1];
  let dynamicGroup = null, lastSignature = null;

  // Danh sách tuyến đường xe chạy đưa vào cơ chế vạch kẻ: vành đai, đường vòng HQ, các nhánh cố định, và đường do Studio vẽ
  function collectRoadDefs(extra) {
    const defs = [];
    const ring = roads?.paths?.find(p => p.id === 'road:campus-ring' && p.curve && !p.hidden);
    if (ring) defs.push({ id: ring.id, curve: ring.curve, halfW, closed: true, yAt: (x, z) => terrain.height(x, z) + 0.07 });
    const arrival = roads?.paths?.find(p => p.id === 'road:HQ-arrival' && p.curve && !p.hidden);
    if (arrival) defs.push({ id: arrival.id, curve: arrival.curve, halfW: 2.02, walkW, edges: false, yAt: (x, z) => terrain.height(x, z) + 0.088 });
    for (const d of roads?.extraRoadDefs || []) defs.push(d);
    // Đường Studio vẽ dùng polygonOffset để nổi trên địa hình nên vạch phải nằm cao hơn hẳn mặt đường mới không bị che ở góc nhìn xiên
    for (const d of extra || []) defs.push({ yAt: (x, z) => terrain.height(x, z) + 0.15, ...d });
    return defs;
  }

  function buildDynamic(defs) {
    const group = new T.Group();
    group.name = 'road-network-dynamic';
    const net = analyseRoadNetwork(defs);
    const ring = net.roads.find(r => r.id === 'road:campus-ring');
    if (ring) {
      const curve = ring.curve, N = 360, len = ring.len;
      // +1 = phía trong campus (pháp tuyến (-tz, tx)), -1 = phía ngoài
      const openIn = sideOpenings(net, ring, 1, true), openOut = sideOpenings(net, ring, -1, true);
      // Đường do module khác dựng (đường cổng và đường nhánh của các quận) đi qua dải bó vỉa / vỉa hè: ngắt đúng chỗ mặt nhựa của chúng phủ lên
      const crossers = roads?.crossingRoads || [];
      const covered = (x, z) => crossers.some(c => {
        for (let k = 0; k < c.points.length - 1; k++) {
          const [ax, az] = c.points[k], [bx, bz] = c.points[k + 1], dx = bx - ax, dz = bz - az;
          const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          if (Math.hypot(x - ax - dx * u, z - az - dz * u) < c.halfW + 0.15) return true;
        }
        return false;
      });
      const crossed = side => Array.from({length: N + 1}, (_, i) => {
        if (!crossers.length) return false;
        const p = curve.getPointAt(i / N), d = curve.getTangentAt(Math.min(0.999999, i / N));
        return [halfW, halfW + curbW + walkW].some(o => covered(p.x - d.z * o * side, p.z + d.x * o * side));
      });
      const crossIn = crossed(1), crossOut = crossed(-1);
      const cutIn = i => crossIn[i] || isInside(openIn, ring, (i / N) * len), cutOut = i => crossOut[i] || isInside(openOut, ring, (i / N) * len);

      const roadVerts = [], roadIndices = [];
      const innerCurbVerts = [], innerCurbIndices = [], outerCurbVerts = [], outerCurbIndices = [];
      const innerWalkVerts = [], innerWalkIndices = [], outerWalkVerts = [], outerWalkIndices = [];

      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = curve.getPointAt(t);
        const d = curve.getTangentAt(Math.min(0.999999, t));
        const nx = -d.z, nz = d.x;

        const rOut_x = p.x - nx * halfW, rOut_z = p.z - nz * halfW;
        const rIn_x  = p.x + nx * halfW, rIn_z  = p.z + nz * halfW;
        const rY_Out = terrain.height(rOut_x, rOut_z) + 0.045;
        const rIn_y  = terrain.height(rIn_x,  rIn_z)  + 0.045;
        // Mặt nhựa phủ kín tới sát bó vỉa (che mép răng cưa của lớp sơn địa hình), chia nhiều cột ngang để ôm theo độ dốc ngang
        for (const c of ROAD_COLS) {
          const vx = p.x + nx * halfW * c, vz = p.z + nz * halfW * c;
          roadVerts.push(vx, terrain.height(vx, vz) + 0.045, vz);
        }

        const icY = rIn_y + curbH, ocY = rY_Out + curbH;
        const ic2_x = p.x + nx * (halfW + curbW), ic2_z = p.z + nz * (halfW + curbW);
        const oc2_x = p.x - nx * (halfW + curbW), oc2_z = p.z - nz * (halfW + curbW);
        innerCurbVerts.push(rIn_x, icY, rIn_z, ic2_x, icY, ic2_z);
        outerCurbVerts.push(rOut_x, ocY, rOut_z, oc2_x, ocY, oc2_z);

        // Vỉa hè nằm ngang bằng mặt bó vỉa, cao hơn mặt cỏ một chút để không bị các tam giác địa hình che mất
        const iw2_x = p.x + nx * (halfW + curbW + walkW), iw2_z = p.z + nz * (halfW + curbW + walkW);
        innerWalkVerts.push(ic2_x, icY, ic2_z, iw2_x, Math.max(icY - 0.03, terrain.height(iw2_x, iw2_z) + 0.1), iw2_z);
        const ow2_x = p.x - nx * (halfW + curbW + walkW), ow2_z = p.z - nz * (halfW + curbW + walkW);
        outerWalkVerts.push(oc2_x, ocY, oc2_z, ow2_x, Math.max(ocY - 0.03, terrain.height(ow2_x, ow2_z) + 0.1), ow2_z);

        if (i < N) {
          // Dải trong chạy từ mép đường vào tâm, dải ngoài chạy từ mép đường ra ngoài: hai thứ tự đỉnh ngược nhau để cả hai pháp tuyến hướng lên
          const k = i * 2, C = ROAD_COLS.length;
          for (let c = 0; c < C - 1; c++) {
            const a = i * C + c, b = a + C;
            roadIndices.push(a, a + 1, b, a + 1, b + 1, b);
          }
          if (!cutOut(i) && !cutOut(i + 1)) {
            outerCurbIndices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
            outerWalkIndices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
          }
          if (!cutIn(i) && !cutIn(i + 1)) {
            innerCurbIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
            innerWalkIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          }
        }
      }

      const ribbon = (verts, indices, mat, name) => {
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        const mesh = new T.Mesh(geo, mat);
        mesh.name = name;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      };
      // Mặt nhựa vành đai không phải vật thể để chọn / ủi trong Studio (click xuyên xuống địa hình như trước)
      ribbon(roadVerts, roadIndices, asphaltMat, 'ring-road-smooth-asphalt').userData.studioPassThrough = true;
      ribbon(innerCurbVerts, innerCurbIndices, curbMat, 'ring-road-inner-curb');
      ribbon(outerCurbVerts, outerCurbIndices, curbMat, 'ring-road-outer-curb');
      ribbon(innerWalkVerts, innerWalkIndices, sidewalkMat, 'ring-road-inner-walkway');
      ribbon(outerWalkVerts, outerWalkIndices, sidewalkMat, 'ring-road-outer-walkway');
    }
    // Vạch tim, vạch mép, vạch dừng và vạch qua đường của cả mạng lưới trong một InstancedMesh
    group.add(createMarkingMesh(buildMarkingBoxes(net), whiteLineMat, 'road-markings-instanced'));
    group.userData.junctions = net.junctions.map(j => ({ x: +j.x.toFixed(2), z: +j.z.toFixed(2), arms: j.arms.length, crosswalks: j.arms.filter(a => a.zebra).length }));
    return group;
  }

  // Dựng lại mặt đường + vạch khi danh sách đường thay đổi (Studio vẽ / xóa / undo một con đường xe chạy)
  let lastExtra = [];
  function syncRoadNetwork(extra = lastExtra, force = false) {
    lastExtra = extra;
    const defs = collectRoadDefs(extra);
    const signature = JSON.stringify([defs.map(d => [d.id, d.halfW, d.signature ?? null]), roads?.crossingRoads || []]);
    if (signature === lastSignature && !force) return dynamicGroup; // force: địa hình vừa đổi cao độ, vạch phải đo lại
    lastSignature = signature;
    if (dynamicGroup) {
      roadRoot.remove(dynamicGroup);
      dynamicGroup.traverse(o => o.geometry?.dispose());
    }
    dynamicGroup = buildDynamic(defs);
    roadRoot.add(dynamicGroup);
    return dynamicGroup;
  }
  syncRoadNetwork();
  if (roads) {
    roads.syncRoadNetwork = syncRoadNetwork;
    roads.getJunctions = () => dynamicGroup?.userData.junctions || [];
  }
  const ringPath = roads?.paths?.find(p => p.id === 'road:campus-ring');

  // =========================================================================
  // 2. LẮP ĐẶT TRỌN BỘ MODEL 3D TỪ BỘ ROAD_MODULAR CỦA SẾP
  // =========================================================================
  async function placeProp(id, x, z, rotY = 0, scale = 1.0) {
    const model = await getStudioModelById(id, { scale, addEntrySocket: false });
    if (!model) return null;
    const y = terrain.height(x, z);
    model.position.set(x, y, z);
    model.rotation.y = rotY;
    model.userData.isRoadProp = true;
    model.userData.assetType = id;
    roadRoot.add(model);
    return model;
  }

  // 1. Nhà chờ xe buýt hiện đại (#141) đặt tại 2 vị trí vỉa hè đón khách (đặt lùi ra ngoài vỉa hè z=29.5 an toàn)
  await placeProp('#141', -22.0, 29.5, 0, 1.0);
  await placeProp('#141',  22.0, 29.5, 0, 1.0);

  // 2. HỆ THỐNG ĐÈN KHUÔN VIÊN THẤP KIỂU ĐÈN LỒNG (CAMPUS LANTERN LAMPS) DÙNG INSTANCEDMESH
  // - Cao 3-4m, thân mảnh, đầu đèn lồng màu ấm emissive nhẹ, đặt dọc mép ngoài vành đai.
  // - Cách mép nhựa >= curb + 1.0m (tổng khoảng cách >= 5.5m từ tim đường), nằm hoàn toàn trên dải cỏ/vỉa hè.
  // - Khoảng cách 24-28m một cột.
  const lanternLampData = [];
  if (ringPath && ringPath.curve) {
    const curve = ringPath.curve;
    const totalLen = curve.getLength();
    const lampCount = Math.round(totalLen / 26); // Khoảng cách ~26m mỗi cột
    const offsetDist = 5.6; // Nửa đường 4.2m + bó vỉa 0.26m + lùi an toàn 1.14m >= curb + 1.0m

    for (let i = 0; i < lampCount; i++) {
      const t = i / lampCount;
      const p = curve.getPointAt(t);
      // Bỏ qua điểm giao lộ nối sang VistaX (x < -50 và z trong [10, 20]) để tránh xung đột với nhánh nối
      if (p.x < -48.0 && p.z > 8.0 && p.z < 22.0) {
        continue;
      }

      const d = curve.getTangentAt(Math.min(0.999999, t));
      // Vector pháp tuyến ngoài: -n = (d.z, -d.x)
      const nx = -d.z, nz = d.x;
      const lx = p.x - nx * offsetDist;
      const lz = p.z - nz * offsetDist;
      const ly = terrain.height(lx, lz);
      const rotY = Math.atan2(nx, nz);
      lanternLampData.push({ x: lx, y: ly, z: lz, rotY });
    }

    // Thêm đèn dọc nhánh nối VistaX (đặt cách mép nhựa nhánh nối >= 1.2m)
    // Nhánh nối từ x=-52.5 đến x=-62.5 tại z=15.0, bề rộng đường 4.8m -> tim tới mép nhựa 2.4m + 0.26m curb = 2.66m
    // Đặt tại z = 15.0 ± 3.8m -> cách tim 3.8m, cách mép nhựa 1.4m > 1.0m!
    const vistaXBranchLamps = [
      { x: -55.0, z: 15.0 + 4.0, rotY: Math.PI },
      { x: -59.5, z: 15.0 + 4.0, rotY: Math.PI },
      { x: -55.0, z: 15.0 - 4.0, rotY: 0 },
      { x: -59.5, z: 15.0 - 4.0, rotY: 0 }
    ];
    for (const vl of vistaXBranchLamps) {
      lanternLampData.push({ x: vl.x, y: terrain.height(vl.x, vl.z), z: vl.z, rotY: vl.rotY });
    }
  }

  if (lanternLampData.length > 0) {
    const lampPoleMat = new T.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.75 });
    const lampGlowMat = new T.MeshStandardMaterial({
      color: 0xffedd5,
      emissive: 0xffd188,
      emissiveIntensity: 0.65,
      roughness: 0.3
    });
    const lampCapMat = new T.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.8 });

    // 1. Thân cột đèn mảnh cao 3.2m
    const poleGeo = new T.CylinderGeometry(0.065, 0.085, 3.2, 8);
    const poleInst = new T.InstancedMesh(poleGeo, lampPoleMat, lanternLampData.length);
    poleInst.name = 'campus-lamp-poles-instanced';
    poleInst.castShadow = true;
    poleInst.receiveShadow = true;

    // 2. Đầu đèn lồng ấm áp cao 0.45m
    const headGeo = new T.BoxGeometry(0.32, 0.42, 0.32);
    const headInst = new T.InstancedMesh(headGeo, lampGlowMat, lanternLampData.length);
    headInst.name = 'campus-lamp-heads-instanced';
    headInst.castShadow = false; // Tắt shadow để tối ưu hiệu năng
    headInst.receiveShadow = false;

    // 3. Mái chóp đèn lồng
    const capGeo = new T.ConeGeometry(0.28, 0.18, 4);
    const capInst = new T.InstancedMesh(capGeo, lampCapMat, lanternLampData.length);
    capInst.name = 'campus-lamp-caps-instanced';
    capInst.castShadow = false;
    capInst.receiveShadow = true;

    const dummy = new T.Object3D();
    for (let i = 0; i < lanternLampData.length; i++) {
      const l = lanternLampData[i];

      // Pole
      dummy.position.set(l.x, l.y + 1.6, l.z);
      dummy.rotation.set(0, l.rotY, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);

      // Lantern Head
      dummy.position.set(l.x, l.y + 3.2 + 0.21, l.z);
      dummy.updateMatrix();
      headInst.setMatrixAt(i, dummy.matrix);

      // Lantern Cap
      dummy.position.set(l.x, l.y + 3.2 + 0.42 + 0.09, l.z);
      dummy.rotation.set(0, l.rotY + Math.PI / 4, 0);
      dummy.updateMatrix();
      capInst.setMatrixAt(i, dummy.matrix);
    }

    poleInst.instanceMatrix.needsUpdate = true;
    headInst.instanceMatrix.needsUpdate = true;
    capInst.instanceMatrix.needsUpdate = true;
    poleInst.computeBoundingSphere();
    headInst.computeBoundingSphere();
    capInst.computeBoundingSphere();

    roadRoot.add(poleInst);
    roadRoot.add(headInst);
    roadRoot.add(capInst);
  }

  // 4. Biển báo giới hạn tốc độ 100 km/h (#146) lùi an toàn ngoài vỉa hè
  await placeProp('#146', -9.0, 29.5, 0, 1.0);

  // =========================================================================
  // 3. HÀNG RÀO THẤP & HÀNG CÂY DỌC MÉP ĐƯỜNG ĐÔNG (EAST VERGE INSTANCED BUFFER)
  // =========================================================================
  const fencePosts = [];
  const fenceRails = [];
  const eastTrees = [];

  const postMat = new T.MeshStandardMaterial({ color: 0xdfd9cb, roughness: 0.8 }); // Cọc rào đá kem kiến trúc
  const railMat = new T.MeshStandardMaterial({ color: 0xb5ad98, roughness: 0.75 }); // Thanh rào ngang
  const treeTrunkMat = new T.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9 }); // Thân cây
  const treeFoliageMat = new T.MeshStandardMaterial({ color: 0x5c9a3e, roughness: 0.85 }); // Tán cây xanh mát

  const fenceX = 52.1;
  const zStart = -34.0, zEnd = 10.0, postStep = 2.4;

  for (let z = zStart; z <= zEnd; z += postStep) {
    const y = terrain.height(fenceX, z);
    fencePosts.push({ x: fenceX, y, z, w: 0.14, h: 0.65, d: 0.14 });
    if (z + postStep <= zEnd) {
      const nextY = terrain.height(fenceX, z + postStep);
      fenceRails.push({
        x: fenceX,
        y: (y + nextY) / 2 + 0.38,
        z: z + postStep / 2,
        w: 0.07,
        h: 0.08,
        d: postStep
      });
    }
  }

  // Hàng cây xanh tạo dải phân cách sinh thái dọc mép Đông (X = 49.8m, nằm giữa hàng rào và các tòa nhà)
  for (let z = -32.0; z <= 8.0; z += 4.8) {
    // Tránh đặt quá sát footprint proj_05 (Z: -24..-21)
    const treeX = 50.5;
    const y = terrain.height(treeX, z);
    eastTrees.push({ x: treeX, y, z, trunkH: 1.6, crownR: 1.35, scale: 0.95 + (Math.sin(z) * 0.15) });
  }

  // Instanced Posts
  if (fencePosts.length > 0) {
    const postGeo = new T.BoxGeometry(1, 1, 1);
    const postMesh = new T.InstancedMesh(postGeo, postMat, fencePosts.length);
    postMesh.name = 'east-fence-posts-instanced';
    postMesh.castShadow = false;
    postMesh.receiveShadow = true;
    const dummy = new T.Object3D();
    for (let i = 0; i < fencePosts.length; i++) {
      const p = fencePosts[i];
      dummy.position.set(p.x, p.y + p.h / 2, p.z);
      dummy.scale.set(p.w, p.h, p.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      postMesh.setMatrixAt(i, dummy.matrix);
    }
    postMesh.instanceMatrix.needsUpdate = true;
    postMesh.computeBoundingSphere();
    roadRoot.add(postMesh);
  }

  // Instanced Rails
  if (fenceRails.length > 0) {
    const railGeo = new T.BoxGeometry(1, 1, 1);
    const railMesh = new T.InstancedMesh(railGeo, railMat, fenceRails.length);
    railMesh.name = 'east-fence-rails-instanced';
    railMesh.castShadow = false;
    railMesh.receiveShadow = true;
    const dummy = new T.Object3D();
    for (let i = 0; i < fenceRails.length; i++) {
      const r = fenceRails[i];
      dummy.position.set(r.x, r.y, r.z);
      dummy.scale.set(r.w, r.h, r.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      railMesh.setMatrixAt(i, dummy.matrix);
    }
    railMesh.instanceMatrix.needsUpdate = true;
    railMesh.computeBoundingSphere();
    roadRoot.add(railMesh);
  }

  // Instanced East Trees (Trunk + Foliage)
  if (eastTrees.length > 0) {
    const trunkGeo = new T.CylinderGeometry(0.12, 0.16, 1.6, 8);
    const foliageGeo = new T.IcosahedronGeometry(1.15, 1); // Bán kính tán 1.15m: cách cọc rào 0.45m, cách tường 1.85m

    const trunkMesh = new T.InstancedMesh(trunkGeo, treeTrunkMat, eastTrees.length);
    trunkMesh.name = 'east-trees-trunks-instanced';
    trunkMesh.castShadow = false;
    trunkMesh.receiveShadow = true;

    const foliageMesh = new T.InstancedMesh(foliageGeo, treeFoliageMat, eastTrees.length);
    foliageMesh.name = 'east-trees-foliage-instanced';
    foliageMesh.castShadow = true;
    foliageMesh.receiveShadow = true;

    const dummy = new T.Object3D();
    for (let i = 0; i < eastTrees.length; i++) {
      const t = eastTrees[i];
      // Trunk
      dummy.position.set(t.x, t.y + 0.8, t.z);
      dummy.scale.set(t.scale, t.scale, t.scale);
      dummy.rotation.set(0, i * 1.2, 0);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);

      // Foliage
      dummy.position.set(t.x, t.y + 1.8 * t.scale, t.z);
      dummy.scale.set(t.scale, t.scale * 1.15, t.scale);
      dummy.rotation.set(0, i * 1.7, 0);
      dummy.updateMatrix();
      foliageMesh.setMatrixAt(i, dummy.matrix);
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    trunkMesh.computeBoundingSphere();
    foliageMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.computeBoundingSphere();

    roadRoot.add(trunkMesh);
    roadRoot.add(foliageMesh);
  }

  return roadRoot;
}
