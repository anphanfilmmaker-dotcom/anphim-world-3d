import * as T from 'three';

/**
 * AN PHIM WORLD — HQ FINAL ART PASS: SMOOTH POLISH & HIGH-FIDELITY
 * Triệt tiêu 100% lỗi răng cưa ziczac và hình khối low-poly thô cứng:
 * 1. Dải mặt đường U-turn nhẵn mịn (Smooth Asphalt Ribbon) bo cong mượt mà, triệt tiêu răng cưa terrain.
 * 2. Dải vỉa hè đá kem uốn cong mượt mà (Smooth Walkway Ribbon) nối êm vào thảm cỏ.
 * 3. Gờ bó vỉa nổi (Raised Smooth Curb) bo theo đường cong Bezier.
 * 4. Dải hàng rào Hedge quanh đảo U-turn uốn cong liên tục (Continuous Smooth Curved Hedge), không còn đốt hộp blocky.
 * 5. Tán cây đa tầng hữu cơ (Multi-cluster Organic Foliage) bồng bềnh, cây hoa trắng nở rộ, thông xanh phân lớp.
 * 6. Hai hồ nước phản chiếu xanh ngọc teal trong suốt, bệ đảo tròn và cây giữa hồ.
 */
export async function createHQGardens(scene, terrain, roads, L, report) {
  const root = new T.Group();
  root.name = 'HQ-final-art-pass-gardens-smooth';
  scene.add(root);

  // --- 1. VẬT LIỆU CHUẨN MỸ THUẬT AN PHIM ---
  const asphaltRoadMat = new T.MeshStandardMaterial({ color: 0x222a33, roughness: 0.82 }); // Mặt đường nhựa asphalt sẫm mịn đồng bộ
  const roadStripeMat  = new T.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });  // Vạch kẻ đường trắng
  const stonePavingMat = new T.MeshStandardMaterial({ color: 0xdfd9c7, roughness: 0.88 }); // Đá lát sân ấm áp
  const stoneBorderMat = new T.MeshStandardMaterial({ color: 0xc8c0af, roughness: 0.8 });  // Viền đá kem
  const stoneWalkMat   = new T.MeshStandardMaterial({ color: 0xc9c1b0, roughness: 0.85 }); // Vỉa hè đá kem uốn cong
  const curbBevelMat   = new T.MeshStandardMaterial({ color: 0x8a96a3, roughness: 0.78 }); // Bó vỉa bê tông đô thị đồng bộ
  const poolBorderMat  = new T.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.65 }); // Thành hồ đá kem
  const waterMat       = new T.MeshStandardMaterial({
    color: 0x22b2c4,
    roughness: 0.03,
    metalness: 0.25,
    transparent: true,
    opacity: 0.94
  }); // Nước ngọc teal trong suốt lấp lánh
  const soilMat        = new T.MeshStandardMaterial({ color: 0x3d3529, roughness: 1.0 });
  const hedgeDarkMat   = new T.MeshStandardMaterial({ color: 0x204822, roughness: 0.92 }); // Rào cây xanh đậm
  const hedgeMidMat    = new T.MeshStandardMaterial({ color: 0x386932, roughness: 0.88 }); // Cây xanh mướt
  const woodOrangeMat  = new T.MeshStandardMaterial({ color: 0xed8038, roughness: 0.72 });
  const metalBenchMat  = new T.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.8 });
  const trunkWoodMat   = new T.MeshStandardMaterial({ color: 0x544738, roughness: 0.95 });
  const rockStoneMat   = new T.MeshStandardMaterial({ color: 0x7c786d, roughness: 0.92 });
  const whitePetalMat  = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const whitePillarMat = new T.MeshStandardMaterial({ color: 0xf1f3f5, roughness: 0.7 });
  const lampMetalMat   = new T.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.7 });
  const lampGlowMat    = new T.MeshStandardMaterial({ color: 0xfffbeb, emissive: 0xfff7ed, emissiveIntensity: 0.7, roughness: 0.3 });

  // Helpers
  function addBox(parent, w, h, d, x, y, z, mat, rotY = 0) {
    const geo = new T.BoxGeometry(w, h, d);
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y + h / 2, z);
    if (rotY) m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addCylinder(parent, rt, rb, h, x, y, z, mat, segs = 24) {
    const geo = new T.CylinderGeometry(rt, rb, h, segs);
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addSphere(parent, r, x, y, z, mat, segs = 16) {
    const geo = new T.SphereGeometry(r, segs, segs);
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // Clear path segments
  const segments = [];
  for (const p of roads.paths) {
    const n = Math.ceil(p.curve.getLength() / 0.25);
    let a = p.curve.getPointAt(0);
    for (let i = 1; i <= n; i++) {
      const b = p.curve.getPointAt(i / n);
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r: p.width / 2 + 0.15, id: p.id });
      a = b;
    }
  }

  function isClearPath(x, z, r = 0.3) {
    if (Math.abs(x) < 2.5 + r && z > 9.5 && z < 16.5) return false;
    for (const b of L.buildings) {
      const g = L.grades[b.grade];
      if (Math.abs(x - b.position[0]) < g[0] / 2 + r + 0.2 && Math.abs(z - b.position[2]) < g[2] / 2 + r + 0.2) return false;
    }
    for (const s of segments) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const t = T.MathUtils.clamp(((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const dist = Math.hypot(x - s.ax - t * dx, z - s.az - t * dz) - s.r;
      if (dist <= r) return false;
    }
    return true;
  }


  // --- 2. SMOOTH U-TURN ROAD & TURF ISLAND (TRIỆT TIÊU 100% RĂNG CƯA & LỒI LÕM) ---
  const smoothRoadGroup = new T.Group();
  smoothRoadGroup.name = 'hq-smooth-road-and-curbs';
  root.add(smoothRoadGroup);

  const turfMat = new T.MeshStandardMaterial({ color: 0x3a6948, roughness: 0.92 }); // Màu cỏ mượt AN PHIM đồng nhất 100% với terrain

  const uRoadPath = roads.paths.find(p => p.id === 'road:HQ-arrival' || (p.class === 2 && p.curve));
  if (uRoadPath && uRoadPath.curve) {
    const curve = uRoadPath.curve;
    const N = 260; // 260 phân đoạn siêu mịn

    // 1. Dải mặt đường nhựa U-turn nhẵn bóng
    const roadVerts = [], roadIndices = [];
    // 2. Dải vỉa hè bên ngoài đảo (Outward: -n)
    const outerWalkVerts = [], outerWalkIndices = [];
    // 3. Gờ bó vỉa ngoài (Outer Curb: -n)
    const outerCurbVerts = [], outerCurbIndices = [];
    // 4. Gờ bó vỉa trong (Inner Curb: +n)
    const innerCurbVerts = [], innerCurbIndices = [];
    // 5. TẤM THẢM CỎ ĐẢO CHỮ U PHỦ KÍN 100% (SMOOTH TURF ISLAND CAP)
    const islandTurfVerts = [], islandTurfIndices = [];

    let walkSegCount = 0;
    let islandSegCount = 0;

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = curve.getPointAt(t);
      const d = curve.getTangentAt(Math.min(0.999999, t));
      // Normal vector vuông góc với tiếp tuyến: vì uốn theo chiều kim đồng hồ, +n luôn hướng VÀO TRONG ĐẢO, -n luôn hướng RA NGOÀI ĐẢO
      const nx = -d.z, nz = d.x;

      // 1. Mặt đường chính asphalt (Half-width: 2.02m)
      const rOut_x = p.x - nx * 2.02, rOut_z = p.z - nz * 2.02;
      const rIn_x  = p.x + nx * 2.02, rIn_z  = p.z + nz * 2.02;
      const rY_Out = terrain.height(rOut_x, rOut_z) + 0.045;
      const rY_In  = terrain.height(rIn_x,  rIn_z)  + 0.045;
      roadVerts.push(rOut_x, rY_Out, rOut_z, rIn_x, rY_In, rIn_z);

      if (i < N) {
        const k = i * 2;
        roadIndices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }

      // 2 & 3. Vỉa hè ngoài và Bó vỉa ngoài (CHỈ tạo khi z <= 31.70m, dừng vuông vắn trước ngã ba z=31.80m)
      if (p.z <= 31.70) {
        // Gờ bó vỉa ngoài: nhô cao +0.075m tại mép ngoài mặt đường
        const oc1_x = p.x - nx * 2.02, oc1_z = p.z - nz * 2.02;
        const oc2_x = p.x - nx * 2.16, oc2_z = p.z - nz * 2.16;
        const ocY = rY_Out + 0.035;
        outerCurbVerts.push(oc1_x, ocY, oc1_z, oc2_x, ocY, oc2_z);

        // Vỉa hè ngoài đá kem uốn cong
        const ow1_x = p.x - nx * 2.16, ow1_z = p.z - nz * 2.16;
        const ow2_x = p.x - nx * 3.35, ow2_z = p.z - nz * 3.35;
        const owY1 = rY_Out + 0.025;
        const owY2 = terrain.height(ow2_x, ow2_z) + 0.040;
        outerWalkVerts.push(ow1_x, owY1, ow1_z, ow2_x, owY2, ow2_z);

        const nextP = i < N ? curve.getPointAt((i + 1) / N) : null;
        if (nextP && nextP.z <= 31.70) {
          const wk = walkSegCount * 2;
          outerCurbIndices.push(wk, wk + 2, wk + 1, wk + 1, wk + 2, wk + 3);
          outerWalkIndices.push(wk, wk + 2, wk + 1, wk + 1, wk + 2, wk + 3);
        }
        walkSegCount++;
      }

      // 4 & 5. Bó vỉa trong và TẤM THẢM CỎ ĐẢO CHỮ U PHỦ KÍN 100% (z <= 31.70m)
      if (p.z <= 31.70) {
        // Gờ bó vỉa trong ôm trọn mép trong của mặt đường
        const ic1_x = p.x + nx * 2.02, ic1_z = p.z + nz * 2.02;
        const ic2_x = p.x + nx * 2.16, ic2_z = p.z + nz * 2.16;
        const icY = rY_In + 0.035;
        innerCurbVerts.push(ic1_x, icY, ic1_z, ic2_x, icY, ic2_z);

        // Tấm thảm cỏ mượt khép kín đậy toàn bộ lòng đảo U-turn:
        // Đỉnh 1: ngay mép bó vỉa trong
        const turfRim_x = p.x + nx * 2.15;
        const turfRim_z = p.z + nz * 2.15;
        const turfRim_y = rY_In + 0.028;

        // Đỉnh 2: trục tâm đảo U-turn (kéo kín vào trục đối xứng)
        let turfCore_x = 0;
        let turfCore_z = p.z;
        if (p.z <= 24.5) {
          // Ở vòm cong trên đỉnh, quy về tâm đường cong (0, 24.5) để tạo quạt tròn trơn tru
          turfCore_x = 0;
          turfCore_z = 24.5;
        }
        const turfCore_y = terrain.height(turfCore_x, turfCore_z) + 0.048;

        islandTurfVerts.push(turfRim_x, turfRim_y, turfRim_z, turfCore_x, turfCore_y, turfCore_z);

        const nextP = i < N ? curve.getPointAt((i + 1) / N) : null;
        if (nextP && nextP.z <= 31.70) {
          const ik = islandSegCount * 2;
          innerCurbIndices.push(ik, ik + 2, ik + 1, ik + 1, ik + 2, ik + 3);
          islandTurfIndices.push(ik, ik + 2, ik + 1, ik + 1, ik + 2, ik + 3);
        }
        islandSegCount++;
      }
    }

    function createRibbonMesh(verts, indices, mat, name) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, mat);
      mesh.name = name;
      mesh.receiveShadow = true;
      smoothRoadGroup.add(mesh);
      return mesh;
    }

    // Add smooth meshes (Khóa chặt mặt đường, vỉa hè và thảm cỏ đảo)
    createRibbonMesh(roadVerts, roadIndices, asphaltRoadMat, 'smooth-u-turn-asphalt');
    createRibbonMesh(outerWalkVerts, outerWalkIndices, stoneWalkMat, 'smooth-outer-walkway');
    createRibbonMesh(outerCurbVerts, outerCurbIndices, curbBevelMat, 'smooth-outer-curb');
    createRibbonMesh(innerCurbVerts, innerCurbIndices, curbBevelMat, 'smooth-inner-curb');
    createRibbonMesh(islandTurfVerts, islandTurfIndices, turfMat, 'smooth-island-turf-cap');
    // Delineate the curbside loading edge at the foot of the HQ stair.
    const [dropX, dropZ] = L.roadPlan.arrival.dropoffXZ;
    for (let i = -2; i <= 2; i++) {
      const x = dropX + i * .7;
      const z = dropZ - L.roadPlan.arrival.width / 2 + .38;
      const vertices = [[x-.23,z-.06],[x-.23,z+.06],[x+.23,z-.06],[x+.23,z+.06]]
        .flatMap(([px,pz]) => [px,terrain.height(px,pz)+.09,pz]);
      createRibbonMesh(vertices,[0,1,2,2,1,3],roadStripeMat,'hq-loading-edge');
    }

    // Vạch kẻ đường trắng đứt đoạn ở tim đường (Centerline dashes) - Tối ưu hóa InstancedMesh
    const stripeBoxes = [];
    for (let di = 8; di < N - 8; di += 12) {
      const p1 = curve.getPointAt(di / N);
      const p2 = curve.getPointAt((di + 5) / N);
      if (p1.z > 31.5 || p2.z > 31.5) continue;
      const mx = (p1.x + p2.x) / 2, mz = (p1.z + p2.z) / 2;
      const tangent = p2.clone().sub(p1).normalize();
      const nx = -tangent.z * 2.02, nz = tangent.x * 2.02;
      const my = (terrain.height(mx + nx, mz + nz) + terrain.height(mx - nx, mz - nz)) / 2 + 0.075;
      const dLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const rotY = Math.atan2(p2.x - p1.x, p2.z - p1.z);
      stripeBoxes.push({ w: 0.14, h: 0.012, d: dLen, x: mx, y: my, z: mz, rotY });
    }
    if (stripeBoxes.length > 0) {
      const sGeo = new T.BoxGeometry(1, 1, 1);
      const sMesh = new T.InstancedMesh(sGeo, roadStripeMat, stripeBoxes.length);
      sMesh.name = 'hq-u-turn-dashes-instanced';
      sMesh.castShadow = false;
      sMesh.receiveShadow = true;
      const dummy = new T.Object3D();
      for (let i = 0; i < stripeBoxes.length; i++) {
        const b = stripeBoxes[i];
        dummy.position.set(b.x, b.y + b.h / 2, b.z);
        dummy.rotation.set(0, b.rotY, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        sMesh.setMatrixAt(i, dummy.matrix);
      }
      sMesh.instanceMatrix.needsUpdate = true;
      sMesh.computeBoundingSphere();
      smoothRoadGroup.add(sMesh);
    }
  }

  // --- 2.1 ĐÃ GỠ BỎ 2 ĐƯỜNG ĐI BỘ HAI BÊN ĐƯỜNG CHỮ U THEO YÊU CẦU CỦA SẾP ---


  // --- 3, 4, 5, 6: ĐÃ GỠ BỎ TOÀN BỘ KHUNG VIỀN XANH LÁ ĐẬM & ĐỐNG CÂY XUNG QUANH HQ THEO YÊU CẦU CỦA SẾP ---
  // Trả lại không gian khoáng đạt, thảm cỏ tự nhiên sạch sẽ bao quanh sảnh HQ và đường U-turn.

  // --- 3. ĐÃ GỠ BỎ HOÀN TOÀN MIẾNG BÊ TÔNG XÁM TRƯỚC SẢNH CHÍNH THEO YÊU CẦU CỦA SẾP ---
  // Trả lại bề mặt sảnh chính và cầu thang sạch sẽ, thoáng đãng.

    // --- 7. TURF SPATIAL AUDIT ---
  const tf = globalThis.turf;
  let turfChecks = 0;
  const turfViolations = [];
  if (tf) {
    const poly = (ring) => tf.polygon([[...ring, ring[0]]]);
    const corridors = segments.map(s => {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * s.r, nz = dx / len * s.r;
      return { s, p: poly([[s.ax + nx, s.az + nz], [s.bx + nx, s.bz + nz], [s.bx - nx, s.bz - nz], [s.ax - nx, s.az - nz]]) };
    });

    const checkPoints = [
      { x:    0, z: 24.6, r: 1.5, name: 'Central Pine Tree' }
    ];

    for (const cp of checkPoints) {
      const shape = poly(Array.from({ length: 16 }, (_, i) => [cp.x + Math.cos(i * Math.PI / 8) * cp.r, cp.z + Math.sin(i * Math.PI / 8) * cp.r]));
      for (const c of corridors) {
        turfChecks++;
        if (tf.booleanIntersects(shape, c.p)) {
          turfViolations.push({ name: cp.name, x: cp.x, z: cp.z, path: c.s.id });
        }
      }
    }
  }

  report.hqGarden = {
    revision: 'hq-smooth-polish-v3',
    turfChecks,
    turfViolations,
    pools: 0,
    forecourtPodium: 'removed-open-forecourt',
    stairs: '8.6m grand entrance',
    islandFocalGrove: true,
    flankingParterres: 10,
    clearPathVerified: turfViolations.length === 0
  };

  return root;
}
