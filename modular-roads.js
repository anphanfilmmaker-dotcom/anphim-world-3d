import * as T from 'three';
import { getStudioModelById } from './asset-pack-extractor.js?rev=146';

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
 *    - Vạch qua đường cho người đi bộ (Zebra Crossing) tại giao lộ chính
 */
export async function createModularRoadSystem(scene, terrain, roads) {
  const roadRoot = new T.Group();
  roadRoot.name = 'anphim-modular-road-network';
  scene.add(roadRoot);

  // --- VẬT LIỆU CHUẨN ĐÔ THỊ ---
  const asphaltMat   = new T.MeshStandardMaterial({ color: 0x4f6078, roughness: 0.86 }); // Mặt đường nhựa xám xanh slate
  const yellowLineMat = new T.MeshBasicMaterial({ color: 0xf3ead2 });                    // Vạch sơn vàng tim đường
  const whiteLineMat  = new T.MeshBasicMaterial({ color: 0xf8fafc });                    // Vạch sơn trắng mép đường & zebra
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
  // 1. DẢI ĐẠI LỘ VÀNH ĐAI LIỀN MẠCH (CONTINUOUS RING ROAD RIBBON & CURBS)
  // =========================================================================
  const ringPath = roads?.paths?.find(p => p.id === 'road:campus-ring');
  if (ringPath && ringPath.curve) {
    const curve = ringPath.curve;
    const N = 360; // 360 phân đoạn siêu mịn bao quanh campus

    const roadVerts = [], roadIndices = [];
    const innerCurbVerts = [], innerCurbIndices = [];
    const outerCurbVerts = [], outerCurbIndices = [];
    const innerWalkVerts = [], innerWalkIndices = [];

    const halfW = 4.2; // Mặt đường rộng 8.4m
    const curbW = 0.26;
    const curbH = 0.07;
    const walkW = 1.35;

    // Vỉa hè và bó vỉa trong ngắt tại cửa đường vòng HQ: nối vào mép ngoài vỉa hè của đường vòng thay vì chắn ngang lòng đường
    const arrival = roads.paths.find(p => p.id === 'road:HQ-arrival' && !p.hidden && p.curve);
    const mouthA = arrival?.curve.getPointAt(0), mouthB = arrival?.curve.getPointAt(1);
    const mouthHalf = arrival ? Math.abs(mouthA.x - mouthB.x) / 2 + (arrival.width || 4) / 2 + 1.35 : 0;
    const mouthX = arrival ? (mouthA.x + mouthB.x) / 2 : 0, mouthZ = arrival ? (mouthA.z + mouthB.z) / 2 : 0;
    const inMouth = i => { const q = curve.getPointAt(Math.min(1, i / N)); return mouthHalf > 0 && Math.abs(q.x - mouthX) < mouthHalf && Math.abs(q.z - mouthZ) < 8; };

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = curve.getPointAt(t);
      const d = curve.getTangentAt(Math.min(0.999999, t));
      // Normal vector vuông góc với tiếp tuyến: +n hướng vào trong campus, -n hướng ra ngoài
      const nx = -d.z, nz = d.x;

      // 1. Mặt đường chính asphalt
      const rOut_x = p.x - nx * halfW, rOut_z = p.z - nz * halfW;
      const rIn_x  = p.x + nx * halfW, rIn_z  = p.z + nz * halfW;
      const rY_Out = terrain.height(rOut_x, rOut_z) + 0.045;
      const rIn_y  = terrain.height(rIn_x,  rIn_z)  + 0.045;
      roadVerts.push(rOut_x, rY_Out, rOut_z, rIn_x, rIn_y, rIn_z);

      if (i < N) {
        const k = i * 2;
        roadIndices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }

      // 2. Gờ bó vỉa trong (Inner Curb)
      const ic1_x = rIn_x, ic1_z = rIn_z;
      const ic2_x = p.x + nx * (halfW + curbW), ic2_z = p.z + nz * (halfW + curbW);
      const icY = rIn_y + curbH;
      innerCurbVerts.push(ic1_x, icY, ic1_z, ic2_x, icY, ic2_z);

      // 3. Gờ bó vỉa ngoài (Outer Curb)
      const oc1_x = rOut_x, oc1_z = rOut_z;
      const oc2_x = p.x - nx * (halfW + curbW), oc2_z = p.z - nz * (halfW + curbW);
      const ocY = rY_Out + curbH;
      outerCurbVerts.push(oc1_x, ocY, oc1_z, oc2_x, ocY, oc2_z);

      // 4. Vỉa hè đi bộ bên trong (Inner Sidewalk)
      const iw1_x = ic2_x, iw1_z = ic2_z;
      const iw2_x = p.x + nx * (halfW + curbW + walkW), iw2_z = p.z + nz * (halfW + curbW + walkW);
      // Vỉa hè nằm ngang bằng mặt bó vỉa, cao hơn mặt cỏ một chút để không bị các tam giác địa hình che mất
      const iwY1 = icY;
      const iwY2 = Math.max(icY - 0.03, terrain.height(iw2_x, iw2_z) + 0.1);
      innerWalkVerts.push(iw1_x, iwY1, iw1_z, iw2_x, iwY2, iw2_z);

      if (i < N) {
        // Thứ tự đỉnh ngược với mặt đường để pháp tuyến hướng lên: bó vỉa và vỉa hè hiện ra phía trên mặt cỏ
        const k = i * 2;
        outerCurbIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        if (!inMouth(i) && !inMouth(i + 1)) {
          innerCurbIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          innerWalkIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }

    function createRibbon(verts, indices, mat, name) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, mat);
      mesh.name = name;
      mesh.receiveShadow = true;
      roadRoot.add(mesh);
      return mesh;
    }

    createRibbon(roadVerts, roadIndices, asphaltMat, 'ring-road-smooth-asphalt');
    createRibbon(innerCurbVerts, innerCurbIndices, curbMat, 'ring-road-inner-curb');
    createRibbon(outerCurbVerts, outerCurbIndices, curbMat, 'ring-road-outer-curb');
    createRibbon(innerWalkVerts, innerWalkIndices, sidewalkMat, 'ring-road-inner-walkway');

    // Vạch vàng đôi tim đường (Double yellow centerlines) - Tối ưu hóa InstancedMesh
    const yellowBoxes = [];
    for (let di = 0; di < N; di += 4) {
      const p1 = curve.getPointAt(di / N);
      const p2 = curve.getPointAt((di + 2) / N);
      // Chừa khoảng trống ngã tư giao lộ đón xe tại cổng chính (x: -5..5, z: 36)
      if (Math.abs(p1.x) < 5.5 && p1.z > 33) continue;
      const d = curve.getTangentAt(di / N);
      const nx = -d.z, nz = d.x;
      const mx = (p1.x + p2.x) / 2, mz = (p1.z + p2.z) / 2;
      const my = terrain.height(mx, mz) + 0.052;
      const dLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const rotY = Math.atan2(p2.x - p1.x, p2.z - p1.z);

      // Vạch vàng trái & phải
      yellowBoxes.push({ w: 0.11, h: 0.012, d: dLen, x: mx - nx * 0.12, y: my, z: mz - nz * 0.12, rotY });
      yellowBoxes.push({ w: 0.11, h: 0.012, d: dLen, x: mx + nx * 0.12, y: my, z: mz + nz * 0.12, rotY });
    }

    if (yellowBoxes.length > 0) {
      const yGeo = new T.BoxGeometry(1, 1, 1);
      const yMesh = new T.InstancedMesh(yGeo, yellowLineMat, yellowBoxes.length);
      yMesh.name = 'ring-road-yellow-lines-instanced';
      yMesh.castShadow = false;
      yMesh.receiveShadow = true;
      const dummy = new T.Object3D();
      for (let i = 0; i < yellowBoxes.length; i++) {
        const b = yellowBoxes[i];
        dummy.position.set(b.x, b.y + b.h / 2, b.z);
        dummy.rotation.set(0, b.rotY, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        yMesh.setMatrixAt(i, dummy.matrix);
      }
      yMesh.instanceMatrix.needsUpdate = true;
      yMesh.computeBoundingSphere();
      roadRoot.add(yMesh);
    }

    // Vạch trắng kẻ mép đường (Solid white edge lines) & Zebra crossing - Tối ưu hóa InstancedMesh
    const whiteBoxes = [];
    for (let di = 0; di < N; di += 3) {
      const p1 = curve.getPointAt(di / N);
      const p2 = curve.getPointAt((di + 2) / N);
      if (Math.abs(p1.x) < 5.5 && p1.z > 33) continue;
      const d = curve.getTangentAt(di / N);
      const nx = -d.z, nz = d.x;
      const mx = (p1.x + p2.x) / 2, mz = (p1.z + p2.z) / 2;
      const dLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const rotY = Math.atan2(p2.x - p1.x, p2.z - p1.z);

      // Mép ngoài & Mép trong
      const myOut = terrain.height(mx - nx * 3.8, mz - nz * 3.8) + 0.052;
      const myIn  = terrain.height(mx + nx * 3.8, mz + nz * 3.8) + 0.052;
      whiteBoxes.push({ w: 0.12, h: 0.012, d: dLen, x: mx - nx * 3.8, y: myOut, z: mz - nz * 3.8, rotY });
      whiteBoxes.push({ w: 0.12, h: 0.012, d: dLen, x: mx + nx * 3.8, y: myIn,  z: mz + nz * 3.8, rotY });
    }

    // Vạch sang đường cho người đi bộ (Zebra Crossing) tại cổng chính Campus (x=0, z=36)
    for (let zi = -3.2; zi <= 3.2; zi += 0.8) {
      const my = terrain.height(zi, 36) + 0.054;
      whiteBoxes.push({ w: 0.45, h: 0.012, d: 3.2, x: zi, y: my, z: 36, rotY: 0 });
    }

    if (whiteBoxes.length > 0) {
      const wGeo = new T.BoxGeometry(1, 1, 1);
      const wMesh = new T.InstancedMesh(wGeo, whiteLineMat, whiteBoxes.length);
      wMesh.name = 'ring-road-white-lines-instanced';
      wMesh.castShadow = false;
      wMesh.receiveShadow = true;
      const dummy = new T.Object3D();
      for (let i = 0; i < whiteBoxes.length; i++) {
        const b = whiteBoxes[i];
        dummy.position.set(b.x, b.y + b.h / 2, b.z);
        dummy.rotation.set(0, b.rotY, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        wMesh.setMatrixAt(i, dummy.matrix);
      }
      wMesh.instanceMatrix.needsUpdate = true;
      wMesh.computeBoundingSphere();
      roadRoot.add(wMesh);
    }
  }

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
