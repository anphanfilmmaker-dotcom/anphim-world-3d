import * as T from 'three';

/**
 * interior-builder.js
 * Tạo nội thất 3D cắt lớp (Cut-away Interior) phong cách The Sims / Architectural Diorama
 * Hiển thị sàn gỗ, tường thấp cắt lát, bàn làm việc, màn hình hiển thị số liệu phát sáng,
 * ghế xoay, nhân viên AI, tủ tài liệu, máy chủ Server Racks.
 */
export function buildInterior(buildingId, width = 12, depth = 10, height = 3.5) {
  const g = new T.Group();
  g.name = `interior_${buildingId}`;

  // 1. Vật liệu nội thất cao cấp
  const floorMat = new T.MeshStandardMaterial({
    color: 0xedd6b8, // Sàn gỗ sồi parquet ấm cúng
    roughness: 0.65
  });
  const wallMat = new T.MeshStandardMaterial({
    color: 0xf1ece1, // Tường thạch cao trắng ngà kiến trúc
    roughness: 0.90
  });
  const wallBaseMat = new T.MeshStandardMaterial({
    color: 0xb58a63, // Nẹp chân tường gỗ
    roughness: 0.75
  });
  const deskWoodMat = new T.MeshStandardMaterial({
    color: 0xd97736, // Gỗ cam đất thương hiệu AN PHIM ấm áp
    roughness: 0.55
  });
  const chairMat = new T.MeshStandardMaterial({
    color: 0x1e293b, // Ghế da than chì cao cấp
    roughness: 0.70
  });
  const pcBodyMat = new T.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.40
  });
  const screenGlowMat = new T.MeshStandardMaterial({
    color: 0x0ea5e9,
    emissive: 0x38bdf8,
    emissiveIntensity: 1.15, // Màn hình phát sáng hiển thị số liệu sắc nét
    roughness: 0.15
  });
  const plantPotMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const plantLeafMat = new T.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.85 });
  const cabinetMat = new T.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.65 });
  const personMat = new T.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.7 });
  const skinMat = new T.MeshStandardMaterial({ color: 0xfbd38d, roughness: 0.8 });

  const w = Math.max(8, width);
  const d = Math.max(7, depth);

  // Sàn văn phòng cắt lớp
  const floorGeo = new T.BoxGeometry(w, 0.14, d);
  const floorMesh = new T.Mesh(floorGeo, floorMat);
  floorMesh.position.y = 0.07;
  floorMesh.receiveShadow = true;
  g.add(floorMesh);

  // Tường thấp cắt lát (Sims Cut-away Walls: cao 0.85m xung quanh, chừa cửa vào ở mặt tiền)
  const wallH = 0.85;
  const wallThick = 0.18;

  // Tường sau
  const backWall = new T.Mesh(new T.BoxGeometry(w, wallH, wallThick), wallMat);
  backWall.position.set(0, wallH / 2 + 0.14, -d / 2 + wallThick / 2);
  backWall.castShadow = true;
  g.add(backWall);

  // Tường trái
  const leftWall = new T.Mesh(new T.BoxGeometry(wallThick, wallH, d - wallThick * 2), wallMat);
  leftWall.position.set(-w / 2 + wallThick / 2, wallH / 2 + 0.14, 0);
  leftWall.castShadow = true;
  g.add(leftWall);

  // Tường phải
  const rightWall = new T.Mesh(new T.BoxGeometry(wallThick, wallH, d - wallThick * 2), wallMat);
  rightWall.position.set(w / 2 - wallThick / 2, wallH / 2 + 0.14, 0);
  rightWall.castShadow = true;
  g.add(rightWall);

  // Tường trước (thấp hơn 0.35m và chừa khoảng trống lối đi vào)
  const frontWallW = (w - 2.8) / 2;
  for (const dir of [-1, 1]) {
    const fw = new T.Mesh(new T.BoxGeometry(frontWallW, 0.4, wallThick), wallMat);
    fw.position.set(dir * (w / 2 - frontWallW / 2), 0.2 + 0.14, d / 2 - wallThick / 2);
    g.add(fw);
  }

  // Helper: Bàn làm việc văn phòng
  function addDesk(x, z, rotY = 0) {
    const dg = new T.Group();
    dg.position.set(x, 0.14, z);
    dg.rotation.y = rotY;

    // Mặt bàn
    const top = new T.Mesh(new T.BoxGeometry(1.9, 0.08, 0.95), deskWoodMat);
    top.position.y = 0.75;
    top.castShadow = true;
    dg.add(top);

    // Chân bàn kim loại
    for (const [cx, cz] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]]) {
      const leg = new T.Mesh(new T.BoxGeometry(0.06, 0.75, 0.06), chairMat);
      leg.position.set(cx, 0.375, cz);
      dg.add(leg);
    }

    // Màn hình máy tính phát sáng hiển thị dữ liệu
    const screenBase = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 0.03, 16), pcBodyMat);
    screenBase.position.set(0, 0.80, -0.18);
    dg.add(screenBase);

    const screenPole = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.18, 8), pcBodyMat);
    screenPole.position.set(0, 0.88, -0.18);
    dg.add(screenPole);

    const screen = new T.Mesh(new T.BoxGeometry(0.72, 0.42, 0.04), screenGlowMat);
    screen.position.set(0, 1.08, -0.16);
    dg.add(screen);

    // Bàn phím
    const kb = new T.Mesh(new T.BoxGeometry(0.46, 0.02, 0.16), pcBodyMat);
    kb.position.set(0, 0.80, 0.12);
    dg.add(kb);

    // Ghế xoay
    const chair = new T.Mesh(new T.BoxGeometry(0.5, 0.08, 0.5), chairMat);
    chair.position.set(0, 0.45, 0.65);
    dg.add(chair);
    const chairBack = new T.Mesh(new T.BoxGeometry(0.5, 0.52, 0.06), chairMat);
    chairBack.position.set(0, 0.72, 0.88);
    dg.add(chairBack);

    // Nhân vật AI Agent đang ngồi làm việc
    const agentBody = new T.Mesh(new T.BoxGeometry(0.4, 0.46, 0.28), personMat);
    agentBody.position.set(0, 0.68, 0.62);
    dg.add(agentBody);

    const agentHead = new T.Mesh(new T.SphereGeometry(0.15, 16, 16), skinMat);
    agentHead.position.set(0, 1.04, 0.62);
    dg.add(agentHead);

    g.add(dg);
    return dg;
  }

  // Helper: Tủ hồ sơ / Kệ sách
  function addCabinet(x, z, rotY = 0) {
    const cg = new T.Group();
    cg.position.set(x, 0.14, z);
    cg.rotation.y = rotY;
    const body = new T.Mesh(new T.BoxGeometry(1.4, 1.8, 0.55), cabinetMat);
    body.position.y = 0.9;
    body.castShadow = true;
    cg.add(body);
    g.add(cg);
  }

  // Helper: Chậu cây xanh văn phòng
  function addPlant(x, z) {
    const pg = new T.Group();
    pg.position.set(x, 0.14, z);
    const pot = new T.Mesh(new T.CylinderGeometry(0.24, 0.18, 0.45, 16), plantPotMat);
    pot.position.y = 0.225;
    pg.add(pot);
    const bush = new T.Mesh(new T.SphereGeometry(0.35, 12, 12), plantLeafMat);
    bush.position.y = 0.58;
    pg.add(bush);
    g.add(pg);
  }

  // Tùy biến nội thất theo từng tòa nhà
  if (buildingId.includes('hq')) {
    // Sảnh điều hành HQ: Cụm bàn điều hành CEO + Bàn họp + Tủ tài liệu + Cây cảnh
    addDesk(-2.6, -0.6, 0);
    addDesk(2.6, -0.6, 0);
    addDesk(-2.6, 2.2, Math.PI);
    addDesk(2.6, 2.2, Math.PI);

    // Bàn họp lớn ở giữa
    const meetingTable = new T.Mesh(new T.BoxGeometry(3.6, 0.1, 1.6), deskWoodMat);
    meetingTable.position.set(0, 0.75 + 0.14, 0.8);
    g.add(meetingTable);

    // Ghế họp xung quanh
    for (const mx of [-1.2, 0, 1.2]) {
      const chair1 = new T.Mesh(new T.BoxGeometry(0.42, 0.08, 0.42), chairMat);
      chair1.position.set(mx, 0.45 + 0.14, -0.3);
      g.add(chair1);
      const chair2 = new T.Mesh(new T.BoxGeometry(0.42, 0.08, 0.42), chairMat);
      chair2.position.set(mx, 0.45 + 0.14, 1.9);
      g.add(chair2);
    }

    // Màn hình trình chiếu Dashboard lớn treo tường sau
    const bigScreen = new T.Mesh(new T.BoxGeometry(4.2, 1.8, 0.08), screenGlowMat);
    bigScreen.position.set(0, 1.8 + 0.14, -d / 2 + 0.28);
    g.add(bigScreen);

    addCabinet(-w / 2 + 1.2, -d / 2 + 0.6, 0);
    addCabinet(w / 2 - 1.2, -d / 2 + 0.6, 0);
    addPlant(-w / 2 + 1.0, d / 2 - 1.0);
    addPlant(w / 2 - 1.0, d / 2 - 1.0);

  } else if (buildingId.includes('finance') || buildingId.includes('bank')) {
    // Ngân hàng / Tài chính: Bàn kế toán, quầy giao dịch, các két sắt
    addDesk(-2.2, -0.2, 0);
    addDesk(2.2, -0.2, 0);
    addDesk(0, 1.8, Math.PI);

    // Két sắt bảo mật Master Ledger
    const vault = new T.Mesh(new T.BoxGeometry(1.6, 1.6, 1.2), pcBodyMat);
    vault.position.set(-w / 2 + 1.3, 0.8 + 0.14, -d / 2 + 1.0);
    g.add(vault);

    addCabinet(w / 2 - 1.2, -d / 2 + 0.6, 0);
    addPlant(-w / 2 + 1.0, d / 2 - 1.0);
    addPlant(w / 2 - 1.0, d / 2 - 1.0);

  } else if (buildingId.includes('it') || buildingId.includes('ai') || buildingId.includes('oracle')) {
    // Phòng AI / IT: Bàn lập trình, dàn máy chủ Server Racks phát sáng
    addDesk(-2.4, 0.2, 0);
    addDesk(2.4, 0.2, 0);

    // Dàn tủ Server Racks với đèn tín hiệu LED
    for (let i = -1; i <= 1; i++) {
      const rack = new T.Mesh(new T.BoxGeometry(0.8, 2.1, 0.7), pcBodyMat);
      rack.position.set(i * 1.1, 1.05 + 0.14, -d / 2 + 0.7);
      g.add(rack);
      const led = new T.Mesh(new T.BoxGeometry(0.65, 1.7, 0.04), screenGlowMat);
      led.position.set(i * 1.1, 1.05 + 0.14, -d / 2 + 1.06);
      g.add(led);
    }
    addPlant(w / 2 - 1.0, d / 2 - 1.0);

  } else {
    // Dự án tiêu chuẩn (The Wincity, Winterland...)
    addDesk(-2.0, 0, 0);
    addDesk(2.0, 0, 0);
    addCabinet(0, -d / 2 + 0.6, 0);
    addPlant(-w / 2 + 1.0, d / 2 - 1.0);
    addPlant(w / 2 - 1.0, d / 2 - 1.0);
  }

  return g;
}
