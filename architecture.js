import * as T from 'three';

export function createArchitecture(P) {
  const mat = (key, rough = 0.8) => new T.MeshStandardMaterial({
    color: P.colors[key] || '#ffffff',
    roughness: rough,
    metalness: key === 'glass' ? 0.12 : 0
  });

  const M = {
    cream: mat('plaster'),
    stone: mat('stone'),
    glass: mat('glass', 0.24),
    moss: mat('brandMoss'),
    orange: mat('brandOrange', 0.6),
    dark: mat('frame'),
    metal: mat('asphalt'),
    white: mat('roadMarking'),
    walk: new T.MeshStandardMaterial({ color: P.colors.walk || '#dca658', roughness: 0.90 }),
    terracotta: new T.MeshStandardMaterial({ color: P.colors.terracotta || '#b76e4b', roughness: 0.90 }),
    roofDark: new T.MeshStandardMaterial({ color: '#1e293b', roughness: 0.35, metalness: 0.20 }),
    solarFrame: new T.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.35, metalness: 0.60 }),
    solarCell: new T.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.15, metalness: 0.85 }),
    bankGreen: new T.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.45 }),
    supabaseGreen: new T.MeshStandardMaterial({ color: '#3ECF8E', roughness: 0.20, metalness: 0.20, emissive: '#166534', emissiveIntensity: 0.25 }),
    supabaseDark: new T.MeshStandardMaterial({ color: '#249361', roughness: 0.25, metalness: 0.20, emissive: '#0f3f20', emissiveIntensity: 0.15 }),
    metaBlue: new T.MeshStandardMaterial({ color: '#0081FB', roughness: 0.25, metalness: 0.35 }),
    gold: new T.MeshStandardMaterial({ color: P.colors.brass || '#C4A469', roughness: 0.30, metalness: 0.80 })
  };
  M.glass.color.set(P.colors.referenceGlass || '#2D8781'); // approved reference teal glass

  const boxes = new Map();
  // Khối lớn (thân nhà, cánh nhà, tấm mái) được bo 4 cạnh đứng để ra dáng "chunky" như ảnh tham chiếu; chi tiết nhỏ vẫn là hộp vuông.
  // Hình bo nằm trong mặt phẳng XZ, đùn theo Y và canh giữa quanh gốc, đúng quy ước của BoxGeometry.
  // Mặt bên lùi vào 0.008: nhiều chi tiết (cánh kính, băng tường) được dựng trùng mặt với thân nhà, lùi vào để chúng luôn nằm trên, không bị chớp mặt.
  function chunkyBox(w, h, d) {
    const r = Math.min(0.45, w * 0.12, d * 0.12), hw = w / 2 - 0.008, hd = d / 2 - 0.008, shape = new T.Shape();
    shape.moveTo(-hw + r, -hd);
    shape.lineTo(hw - r, -hd);
    shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0);
    shape.lineTo(hw, hd - r);
    shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2);
    shape.lineTo(-hw + r, hd);
    shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI);
    shape.lineTo(-hw, -hd + r);
    shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5);
    const geo = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 3 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -h / 2, 0);
    // Trả về BufferGeometry thường: main.js nhận diện "vai" HQ bằng geometry.type === 'ExtrudeGeometry'
    return new T.BufferGeometry().copy(geo);
  }
  function box(g, w, h, d, x, y, z, m = M.cream) {
    const chunky = w >= 2.4 && d >= 2.4 && h >= 0.15 && m !== M.glass, k = [w, h, d, chunky].join('/');
    if (!boxes.has(k)) boxes.set(k, chunky ? chunkyBox(w, h, d) : new T.BoxGeometry(w, h, d));
    const b = new T.Mesh(boxes.get(k), m);
    b.position.set(x, y + h / 2, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    return b;
  }

  function cylinder(g, r, h, x, y, z, m = M.stone, n = 16) {
    const b = new T.Mesh(new T.CylinderGeometry(r, r, h, n), m);
    b.position.set(x, y + h / 2, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    return b;
  }

  function beam(g, a, b, w, d, m) {
    const A = new T.Vector3(...a), B = new T.Vector3(...b);
    const mesh = new T.Mesh(new T.BoxGeometry(w, A.distanceTo(B), d), m);
    mesh.position.copy(A.clone().add(B).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), B.sub(A).normalize());
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  }

  function sign(g, text, w, h, x, y, z, bgColor = P.colors.brandMoss, textColor = P.colors.plaster) {
    if (typeof document === 'undefined') {
      const mesh = new T.Mesh(new T.PlaneGeometry(w, h), M.moss);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    }
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 192;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 1024, 192);
    ctx.fillStyle = textColor;
    ctx.font = 'bold 125px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 100, 980);
    const tx = new T.CanvasTexture(c);
    tx.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tx }));
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  }

  function windows(g, w, h, d, x, y, z, rows = 2, cols = 4) {
    box(g, w, h, d, x, y, z, M.glass);
    for (let i = 0; i <= cols; i++) box(g, 0.07, h + 0.1, d + 0.04, x - w / 2 + i * w / cols, y - 0.04, z, M.cream);
    for (let i = 1; i < rows; i++) box(g, w + 0.06, 0.065, d + 0.05, x, y + i * h / rows, z, M.cream);
  }

  function front(g, w, h, d, rows = 2, cols = 4) {
    windows(g, w - 0.45, h - 0.6, 0.07, 0, 0.3, d / 2 + 0.025, rows, cols);
  }

  function entry(g, w, z, h = 2) {
    windows(g, w, h, 0.12, 0, 0.1, z, 1, 2);
    box(g, w + 0.5, 0.18, 1.1, 0, h + 0.12, z + 0.35, M.orange);
  }

  function shell(g, w, h, d, rows = 2, cols = 4) {
    box(g, w, h, d, 0, 0, 0);
    g.userData.shellFootprint = [w, d];
    front(g, w, h, d, rows, cols);
    windows(g, 0.07, h - 0.7, d - 0.5, w / 2 + 0.025, 0.3, 0, rows, cols);
    box(g, w + 0.25, 0.2, d + 0.25, 0, h, 0);
  }

  // ==========================================
  // --- STYLIZED 5-LAYER PARCEL PREFAB KIT ---
  // ==========================================

  // Layer 1: Courtyard Apron Pad with Curb & Perimeter Shading
  function apronPad(g, w, d, options = {}) {
    const curbW = options.curbWidth || 0.22;
    const curbH = options.curbHeight || 0.08;
    const padThickness = options.padThickness || 0.12;
    const padMat = options.material || M.walk;
    const curbMat = options.curbMaterial || M.stone;
    const entranceW = options.entranceWidth || 3.2;

    // 1. Warm Apron Slab (Tầng sân gạch cam ấm tiếp địa)
    box(g, w, padThickness, d, 0, 0, 0, padMat);

    // 2. Perimeter Stone Curb (Bó vỉa đá xám ấm)
    // Back curb
    box(g, w + curbW * 2, curbH, curbW, 0, padThickness, -d / 2 - curbW / 2, curbMat);
    // Left curb
    box(g, curbW, curbH, d, -w / 2 - curbW / 2, padThickness, 0, curbMat);
    // Right curb
    box(g, curbW, curbH, d, w / 2 + curbW / 2, padThickness, 0, curbMat);
    // Front curb wings
    const frontWingW = (w - entranceW) / 2;
    if (frontWingW > 0.3) {
      box(g, frontWingW, curbH, curbW, -w / 2 + frontWingW / 2, padThickness, d / 2 + curbW / 2, curbMat);
      box(g, frontWingW, curbH, curbW, w / 2 - frontWingW / 2, padThickness, d / 2 + curbW / 2, curbMat);
    }
  }

  // Layer 2 & 3: Chunky Stylized Massing Body & Parapet
  function stylizedShell(g, w, h, d, options = {}) {
    const plinthH = options.plinthHeight || 0.40;
    const plinthExt = options.plinthExtend || 0.16;
    const parapetH = options.parapetHeight || 0.42;
    const parapetExt = options.parapetExtend || 0.30; // >= 0.28m chunky overhang
    const beltLevels = options.beltLevels || [];
    const bodyMat = options.bodyMaterial || M.cream;
    const plinthMat = options.plinthMaterial || M.stone;
    const trimMat = options.trimMaterial || M.orange;

    // Plinth base
    box(g, w + plinthExt * 2, plinthH, d + plinthExt * 2, 0, 0, 0, plinthMat);
    // Main wall body
    const bodyH = h - plinthH;
    box(g, w, bodyH, d, 0, plinthH, 0, bodyMat);

    // Dark belt courses
    for (const by of beltLevels) {
      if (by > plinthH && by < h) {
        box(g, w + 0.10, 0.14, d + 0.10, 0, by, 0, M.moss);
        box(g, w + 0.14, 0.05, d + 0.14, 0, by + 0.045, 0, trimMat);
      }
    }

    // Chunky Parapet
    box(g, w + parapetExt * 1.4, 0.16, d + parapetExt * 1.4, 0, h - 0.04, 0, plinthMat);
    box(g, w + parapetExt * 2, parapetH, d + parapetExt * 2, 0, h + 0.10, 0, bodyMat);
    box(g, w + parapetExt * 2 + 0.06, 0.08, d + parapetExt * 2 + 0.06, 0, h + 0.10 + parapetH, 0, trimMat);
    // Recessed roof surface
    box(g, w + 0.08, 0.04, d + 0.08, 0, h + 0.06, 0, M.stone);
  }

  // Layer 4: Recessed Glazing (Deep Teal Window Units)
  function recessedWindows(g, w, h, d, x, y, z, rows = 2, cols = 4, options = {}) {
    const glassMat = options.glassMaterial || M.glass;
    const mullionMat = options.mullionMaterial || M.cream;
    const sillMat = M.stone;
    const isSide = options.axis === 'z';
    const depth = options.depth || 0.14;
    const bottomY = y - h / 2;
    const topY = y + h / 2;

    if (!isSide) {
      // Mặt trước / sau (Front / Back): w theo trục X, h theo trục Y
      // 1. Tấm kính teal thanh mảnh phẳng chuẩn ở cao độ từ bottomY tới topY
      box(g, w, h, 0.06, x, bottomY, z, glassMat);

      // 2. Nan chia ô cửa sổ (mullions) viền nổi chia khung thanh thoát
      for (let c = 1; c < cols; c++) {
        box(g, 0.08, h, 0.08, x - w / 2 + c * (w / cols), bottomY, z, mullionMat);
      }
      for (let r = 1; r < rows; r++) {
        box(g, w, 0.08, 0.08, x, bottomY + r * (h / rows) - 0.04, z, mullionMat);
      }

      // 3. Gờ bậu cửa đá (sill) và nẹp trên (lintel) ôm khít chuẩn xác
      box(g, w + 0.16, 0.14, depth + 0.08, x, bottomY - 0.14, z, sillMat);
      box(g, w + 0.16, 0.12, depth + 0.04, x, topY, z, mullionMat);
    } else {
      // Mặt bên hông (Side facade): thickness theo trục X, h theo trục Y, w theo trục Z
      // 1. Tấm kính teal thanh mảnh phẳng chuẩn
      box(g, 0.06, h, w, x, bottomY, z, glassMat);

      // 2. Nan chia ô cửa sổ
      for (let c = 1; c < cols; c++) {
        box(g, 0.08, h, 0.08, x, bottomY, z - w / 2 + c * (w / cols), mullionMat);
      }
      for (let r = 1; r < rows; r++) {
        box(g, 0.08, 0.08, w, x, bottomY + r * (h / rows) - 0.04, z, mullionMat);
      }

      // 3. Gờ bậu cửa đá (sill) và nẹp trên (lintel)
      box(g, depth + 0.08, 0.14, w + 0.16, x, bottomY - 0.14, z, sillMat);
      box(g, depth + 0.04, 0.12, w + 0.16, x, topY, z, mullionMat);
    }
  }

  // Layer 5: Roof Kitbash (Solar Arrays, HVAC Chillers, Planters)
  function roofKitbash(g, w, d, y, options = {}) {
    // Photovoltaic Solar Array
    if (options.solar !== false) {
      const numPanels = options.solarCount || 2;
      const startX = options.solarStartX || -w * 0.22;
      for (let i = 0; i < numPanels; i++) {
        const sx = startX + i * 2.1;
        const sz = options.solarZ || -d * 0.14;
        box(g, 1.8, 0.08, 2.6, sx, y + 0.28, sz, M.solarFrame);
        box(g, 1.65, 0.06, 2.45, sx, y + 0.34, sz, M.solarCell);
        for (let gx = -0.55; gx <= 0.55; gx += 0.38) {
          box(g, 0.02, 0.02, 2.45, sx + gx, y + 0.38, sz, M.white);
        }
      }
    }

    // Heavy Industrial HVAC Unit
    if (options.hvac !== false) {
      const hx = options.hvacX || w * 0.24;
      const hz = options.hvacZ || -d * 0.18;
      box(g, 2.0, 1.2, 1.6, hx, y + 0.08, hz, M.metal);
      box(g, 2.1, 0.10, 1.7, hx, y + 1.28, hz, M.dark);
      cylinder(g, 0.40, 0.12, hx - 0.50, y + 1.32, hz, M.dark, 16);
      cylinder(g, 0.40, 0.12, hx + 0.50, y + 1.32, hz, M.dark, 16);
      cylinder(g, 0.32, 0.04, hx - 0.50, y + 1.40, hz, M.stone, 12);
      cylinder(g, 0.32, 0.04, hx + 0.50, y + 1.40, hz, M.stone, 12);
    }

    // Rooftop Greenery Planter
    if (options.planter) {
      const px = options.planterX || -w * 0.24;
      const pz = options.planterZ || d * 0.22;
      box(g, 2.2, 0.38, 1.1, px, y + 0.08, pz, M.cream);
      box(g, 2.0, 0.08, 0.9, px, y + 0.42, pz, M.stone);
      cylinder(g, 0.42, 0.50, px - 0.55, y + 0.46, pz, M.moss, 12);
      cylinder(g, 0.46, 0.60, px + 0.45, y + 0.46, pz, M.moss, 12);
    }
  }


  // -------------------------------------------------------------
  // HELPER DỰNG BỤI CÂY LOW-POLY CRYSTAL / FACETED BUSH (CHUẨN THEO ẢNH MẪU SẾP GỬI)
  // -------------------------------------------------------------
  function createFacetedBush(options = {}) {
    const bush = new T.Group();
    bush.name = 'faceted-crystal-bush';

    // Tông màu xanh gradient low-poly: xanh lục bảo tươi, xanh ngọc sáng và xanh rừng sâu
    const bushGreenMat = new T.MeshStandardMaterial({
      color: 0x2FA84F,
      roughness: 0.62,
      metalness: 0.05,
      flatShading: true
    });

    const bushBrightMat = new T.MeshStandardMaterial({
      color: 0x4CD97B,
      roughness: 0.55,
      metalness: 0.05,
      flatShading: true
    });

    const bushDeepMat = new T.MeshStandardMaterial({
      color: 0x1A5C30,
      roughness: 0.70,
      metalness: 0.05,
      flatShading: true
    });

    const trunkMat = new T.MeshStandardMaterial({
      color: 0x4A3728,
      roughness: 0.85,
      flatShading: true
    });

    const potMat = new T.MeshStandardMaterial({
      color: 0xDDD0BA, // Màu chậu đá sa thạch đồng bộ với sảnh đón
      roughness: 0.75,
      flatShading: true
    });

    const s = options.scale || 1.0;
    const rot = options.rotY || 0;

    // 1. Chậu cây đá hình bát giác thanh lịch (Octagonal Planter Pot)
    const potGeo = new T.CylinderGeometry(0.30 * s, 0.24 * s, 0.22 * s, 8);
    const potMesh = new T.Mesh(potGeo, potMat);
    potMesh.position.y = 0.11 * s;
    potMesh.castShadow = true;
    potMesh.receiveShadow = true;
    bush.add(potMesh);

    // Gốc cây gỗ nhỏ
    const trunkGeo = new T.CylinderGeometry(0.06 * s, 0.08 * s, 0.35 * s, 6);
    const trunkMesh = new T.Mesh(trunkGeo, trunkMat);
    trunkMesh.position.y = 0.26 * s;
    trunkMesh.castShadow = true;
    bush.add(trunkMesh);

    // 2. Cụm tán cây Low-poly đa tầng góc cạnh (Faceted Low-Poly Crystal Foliage)
    // Tầng đế tán cây
    const baseGeo = new T.IcosahedronGeometry(0.36 * s, 0);
    const baseMesh = new T.Mesh(baseGeo, bushDeepMat);
    baseMesh.position.y = 0.52 * s;
    baseMesh.scale.set(1.05, 0.90, 1.05);
    baseMesh.rotation.set(0.2, rot + 0.3, -0.1);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    bush.add(baseMesh);

    // Khối tán trung tâm lớn nhất
    const midGeo = new T.IcosahedronGeometry(0.42 * s, 0);
    const midMesh = new T.Mesh(midGeo, bushGreenMat);
    midMesh.position.y = 0.80 * s;
    midMesh.scale.set(0.95, 1.25, 0.95);
    midMesh.rotation.set(-0.15, rot + 1.2, 0.2);
    midMesh.castShadow = true;
    midMesh.receiveShadow = true;
    bush.add(midMesh);

    // Nhánh phụ nhô ra bên hông trái (bất đối xứng tự nhiên)
    const sideLGeo = new T.IcosahedronGeometry(0.24 * s, 0);
    const sideLMesh = new T.Mesh(sideLGeo, bushBrightMat);
    sideLMesh.position.set(-0.18 * s, 0.70 * s, 0.12 * s);
    sideLMesh.scale.set(0.85, 1.10, 0.85);
    sideLMesh.rotation.set(0.4, rot + 2.1, 0.3);
    sideLMesh.castShadow = true;
    bush.add(sideLMesh);

    // Nhánh phụ nhô ra bên hông phải
    const sideRGeo = new T.IcosahedronGeometry(0.22 * s, 0);
    const sideRMesh = new T.Mesh(sideRGeo, bushDeepMat);
    sideRMesh.position.set(0.18 * s, 0.66 * s, -0.10 * s);
    sideRMesh.scale.set(0.90, 1.05, 0.90);
    sideRMesh.rotation.set(-0.3, rot + 3.4, -0.2);
    sideRMesh.castShadow = true;
    bush.add(sideRMesh);

    // Đỉnh chóp nhọn tán cây vươn cao như ảnh mẫu
    const topGeo = new T.IcosahedronGeometry(0.28 * s, 0);
    const topMesh = new T.Mesh(topGeo, bushBrightMat);
    topMesh.position.y = 1.15 * s;
    topMesh.scale.set(0.80, 1.35, 0.80);
    topMesh.rotation.set(0.1, rot + 0.7, 0.15);
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    bush.add(topMesh);

    return bush;
  }

  // -------------------------------------------------------------
  // HELPER DỰNG DẢI HÀNG RÀO BỤI CÂY SHRUB HEDGES (CHUẨN THEO ẢNH MẪU SẾP GỬI)
  // Màu sắc chuẩn 100% theo bảng màu chung dự án AN PHIM (campus-palette.json)
  // -------------------------------------------------------------
  function createShrubHedgeRow(options = {}) {
    const hedge = new T.Group();
    hedge.name = options.name || 'shrub-hedge-row';

    const length = options.length || 5.4;      // Chiều dài dải hàng rào (m)
    const baseHeight = options.height || 0.88; // Chiều cao trung bình (m)
    const baseDepth = options.depth || 0.62;   // Bề dày hàng rào (m)

    // Palette lá cây đồng bộ tuyệt đối với campus-palette.json:
    // canopyDark (#386B43), canopyMid (#4C8050), canopyLight (#79A85F), soil (#8D795A)
    const colDark = P.colors.canopyDark || '#386B43';
    const colMid = P.colors.canopyMid || '#4C8050';
    const colLight = P.colors.canopyLight || '#79A85F';
    const colStem = 0x4A3728;
    const colSoil = P.colors.soil || '#8D795A';

    const matDark = new T.MeshStandardMaterial({
      color: colDark,
      roughness: 0.86,
      metalness: 0.0,
      flatShading: true
    });
    const matMid = new T.MeshStandardMaterial({
      color: colMid,
      roughness: 0.84,
      metalness: 0.0,
      flatShading: true
    });
    const matLight = new T.MeshStandardMaterial({
      color: colLight,
      roughness: 0.80,
      metalness: 0.0,
      flatShading: true
    });
    const stemMat = new T.MeshStandardMaterial({
      color: colStem,
      roughness: 0.92,
      flatShading: true
    });
    const soilMat = new T.MeshStandardMaterial({
      color: colSoil,
      roughness: 0.98,
      flatShading: true
    });

    // 1. Thảm đất / rãnh mùn bồn cây bên dưới (Mulch Soil Bed)
    const soilGeo = new T.BoxGeometry(length + 0.12, 0.04, baseDepth * 0.78);
    const soilMesh = new T.Mesh(soilGeo, soilMat);
    soilMesh.position.y = 0.02;
    soilMesh.receiveShadow = true;
    soilMesh.userData.isShrubHedge = true;
    hedge.add(soilMesh);

    // 2. Các cành nhánh gỗ bên dưới (Woody Branch Stems) lộ ra tự nhiên ở chân bụi cây
    const numStems = Math.floor(length / 0.5);
    const stemStep = length / (numStems + 1);
    for (let i = 1; i <= numStems; i++) {
      const sx = -length / 2 + i * stemStep;
      const branchCount = 2 + (i % 2);
      for (let b = 0; b < branchCount; b++) {
        const branchGeo = new T.CylinderGeometry(0.016, 0.024, 0.34, 5);
        const branchMesh = new T.Mesh(branchGeo, stemMat);
        const angZ = ((b - (branchCount - 1) / 2) * 0.24) + Math.sin(i * 3.1) * 0.12;
        const angX = Math.cos(i * 2.7 + b) * 0.15;
        branchMesh.rotation.z = angZ;
        branchMesh.rotation.x = angX;
        branchMesh.position.set(sx + (b - 0.5) * 0.07, 0.17, Math.sin(i * 4.2 + b) * 0.06);
        branchMesh.castShadow = true;
        branchMesh.receiveShadow = true;
        branchMesh.userData.isShrubHedge = true;
        hedge.add(branchMesh);
      }
    }

    // 3. Khối tán lá cây rậm rạp đan xen tạo hình Shrub Hedge tự nhiên (Lush Multi-Cluster Foliage)
    const count = 18; // 18 trạm tán lá dọc chiều dài
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const cx = -length / 2 + t * length;
      const seed = Math.sin(i * 12.9898 + 45.123) * 43758.5453;
      const rnd1 = seed - Math.floor(seed);
      const rnd2 = ((seed * 1.37) - Math.floor(seed * 1.37));
      const rnd3 = ((seed * 1.73) - Math.floor(seed * 1.73));

      // A. Khối thân dưới & trung tâm (Mid & Dark tones)
      const baseR = 0.33 + rnd1 * 0.07;
      const baseMat = (i % 2 === 0) ? matDark : matMid;
      const baseM = new T.Mesh(new T.IcosahedronGeometry(baseR, 1), baseMat);
      baseM.position.set(cx, 0.40 + rnd3 * 0.06, (rnd2 - 0.5) * 0.12);
      baseM.scale.set(1.1 + rnd1 * 0.15, 0.95 + rnd2 * 0.15, 1.1 + rnd3 * 0.15);
      baseM.rotation.set(rnd1 * Math.PI, rnd2 * Math.PI, rnd3 * Math.PI);
      baseM.castShadow = true;
      baseM.receiveShadow = true;
      baseM.userData.isShrubHedge = true;
      hedge.add(baseM);

      // B. Khối phồng mặt trước (Front organic puff)
      const frontR = 0.23 + rnd2 * 0.06;
      const frontM = new T.Mesh(new T.IcosahedronGeometry(frontR, 1), matMid);
      frontM.position.set(cx + (rnd3 - 0.5) * 0.12, 0.36 + rnd1 * 0.08, baseDepth * 0.26 + rnd1 * 0.05);
      frontM.rotation.set(rnd2, rnd3, rnd1);
      frontM.castShadow = true;
      frontM.receiveShadow = true;
      frontM.userData.isShrubHedge = true;
      hedge.add(frontM);

      // C. Khối phồng mặt sau (Back organic puff)
      const backR = 0.23 + rnd1 * 0.06;
      const backM = new T.Mesh(new T.IcosahedronGeometry(backR, 1), matDark);
      backM.position.set(cx + (rnd2 - 0.5) * 0.12, 0.38 + rnd3 * 0.08, -baseDepth * 0.26 - rnd2 * 0.05);
      backM.rotation.set(rnd3, rnd1, rnd2);
      backM.castShadow = true;
      backM.receiveShadow = true;
      backM.userData.isShrubHedge = true;
      hedge.add(backM);

      // D. Khối ngọn nhấp nhô đón nắng (Top Undulating Sunny Crests - Light & Mid tones)
      const topR = 0.27 + rnd3 * 0.08;
      const topMat = (rnd1 > 0.32) ? matLight : matMid;
      const topM = new T.Mesh(new T.IcosahedronGeometry(topR, 1), topMat);
      const crestH = baseHeight - 0.10 + Math.sin(t * Math.PI * 3.5) * 0.08 + rnd2 * 0.07;
      topM.position.set(cx + (rnd1 - 0.5) * 0.08, crestH, (rnd2 - 0.5) * 0.10);
      topM.scale.set(1.05 + rnd2 * 0.12, 0.92 + rnd1 * 0.12, 1.05 + rnd3 * 0.12);
      topM.rotation.set(rnd1 * 2, rnd2 * 2, rnd3 * 2);
      topM.castShadow = true;
      topM.receiveShadow = true;
      topM.userData.isShrubHedge = true;
      hedge.add(topM);
    }

    // E. Hai đầu bo tròn dải hedge (End Caps)
    for (const sign of [-1, 1]) {
      const endX = sign * (length / 2 + 0.04);
      const capM = new T.Mesh(new T.IcosahedronGeometry(0.26, 1), matMid);
      capM.position.set(endX, 0.42, 0);
      capM.scale.set(0.9, 1.1, 1.1);
      capM.castShadow = true;
      capM.receiveShadow = true;
      capM.userData.isShrubHedge = true;
      hedge.add(capM);
    }

    return hedge;
  }

  // -------------------------------------------------------------
  // HELPER DỰNG BẢNG HIỆU 3D NỔI CHỮ "BANK" (Extruded 3D Titanium Gray Letters on Emerald Fascia)
  // -------------------------------------------------------------
  function create3DBankSignage(targetGroup, posX, posY, posZ) {
    const lettersGroup = new T.Group();
    lettersGroup.name = 'bank-3d-prominent-signage';
    lettersGroup.userData.toggleKey = 'sign';

    // Vật liệu chữ BANK: Xám titan kim loại sang trọng (Titanium / Platinum Metallic Gray) theo yêu cầu của Sếp
    const grayMat = new T.MeshStandardMaterial({
      color: 0xCFD5DC,
      roughness: 0.28,
      metalness: 0.45,
      emissive: 0x22262a,
      emissiveIntensity: 0.20
    });

    // Khung viền bảng hiệu kim loại
    const frameMat = new T.MeshStandardMaterial({
      color: 0x363D45,
      roughness: 0.32,
      metalness: 0.65
    });

    // Nền bảng hiệu: Xanh lục bảo tài chính cao cấp (Financial Deep Emerald Green)
    const emeraldMat = new T.MeshStandardMaterial({
      color: 0x0B4D2B,
      roughness: 0.35,
      metalness: 0.15
    });

    const extrudeSettings = {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.012,
      bevelSegments: 2
    };

    // Chữ B
    function makeB(w = 0.52, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      const r = 0.16;
      const midY = h * 0.5;
      s.moveTo(0, 0);
      s.lineTo(w - r, 0);
      s.quadraticCurveTo(w, 0, w, r * 0.8);
      s.quadraticCurveTo(w, midY - 0.02, w - 0.08, midY);
      s.quadraticCurveTo(w, midY + 0.02, w, midY + r * 0.8);
      s.quadraticCurveTo(w, h, w - r, h);
      s.lineTo(0, h);
      s.closePath();

      const topHole = new T.Path();
      const pad = t * 0.95;
      topHole.moveTo(t, midY + 0.04);
      topHole.lineTo(w - t - 0.08, midY + 0.04);
      topHole.quadraticCurveTo(w - t, midY + 0.04, w - t, midY + 0.10);
      topHole.lineTo(w - t, h - pad - 0.06);
      topHole.quadraticCurveTo(w - t, h - pad, w - t - 0.08, h - pad);
      topHole.lineTo(t, h - pad);
      topHole.closePath();
      s.holes.push(topHole);

      const botHole = new T.Path();
      botHole.moveTo(t, pad);
      botHole.lineTo(w - t - 0.08, pad);
      botHole.quadraticCurveTo(w - t, pad, w - t, pad + 0.06);
      botHole.lineTo(w - t, midY - 0.10);
      botHole.quadraticCurveTo(w - t, midY - 0.04, w - t - 0.08, midY - 0.04);
      botHole.lineTo(t, midY - 0.04);
      botHole.closePath();
      s.holes.push(botHole);
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // Chữ A
    function makeA(w = 0.52, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      const hw = w * 0.5;
      const topW = 0.14;
      const htw = topW * 0.5;
      s.moveTo(0, 0);
      s.lineTo(t * 1.15, 0);
      s.lineTo(w * 0.26, h * 0.30);
      s.lineTo(w * 0.74, h * 0.30);
      s.lineTo(w - t * 1.15, 0);
      s.lineTo(w, 0);
      s.lineTo(hw + htw, h);
      s.lineTo(hw - htw, h);
      s.closePath();

      const hole = new T.Path();
      hole.moveTo(w * 0.31, h * 0.41);
      hole.lineTo(w * 0.69, h * 0.41);
      hole.lineTo(hw, h - t * 1.2);
      hole.closePath();
      s.holes.push(hole);
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // Chữ N
    function makeN(w = 0.50, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      s.moveTo(0, 0);
      s.lineTo(t, 0);
      s.lineTo(t, h - t * 1.8);
      s.lineTo(w - t, 0);
      s.lineTo(w, 0);
      s.lineTo(w, h);
      s.lineTo(w - t, h);
      s.lineTo(w - t, t * 1.8);
      s.lineTo(t, h);
      s.lineTo(0, h);
      s.closePath();
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // Chữ K
    function makeK(w = 0.48, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      s.moveTo(0, 0);
      s.lineTo(t, 0);
      s.lineTo(t, h * 0.36);
      s.lineTo(w - t * 0.8, 0);
      s.lineTo(w, 0);
      s.lineTo(t + 0.14, h * 0.46);
      s.lineTo(w, h);
      s.lineTo(w - t * 0.9, h);
      s.lineTo(t, h * 0.56);
      s.lineTo(t, h);
      s.lineTo(0, h);
      s.closePath();
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // 1. Hộp bảng hiệu nổi 3D (3D Facade Sign Box)
    // Khung viền kim loại xám sẫm
    box(lettersGroup, 4.20, 1.05, 0.22, 0, 0, 0, frameMat);
    // Tấm nền xanh lục bảo tài chính lọt lòng
    box(lettersGroup, 3.98, 0.86, 0.25, 0, 0, 0.02, emeraldMat);
    // Gờ chỉ vát viền xám sáng trang trí trên và dưới
    box(lettersGroup, 4.24, 0.05, 0.27, 0, 0.49, 0.02, grayMat);
    box(lettersGroup, 4.24, 0.05, 0.27, 0, -0.49, 0.02, grayMat);
    // 2 chấu đèn chiếu LED nhỏ trên nóc bảng
    box(lettersGroup, 0.14, 0.06, 0.16, -1.2, 0.54, 0.08, grayMat);
    box(lettersGroup, 0.14, 0.06, 0.16, 1.2, 0.54, 0.08, grayMat);

    // 2. Lắp đặt 4 con chữ 3D BANK nổi màu xám
    const letters = [
      { geo: makeB(), w: 0.52 },
      { geo: makeA(), w: 0.52 },
      { geo: makeN(), w: 0.50 },
      { geo: makeK(), w: 0.48 }
    ];

    const gap = 0.24;
    const totalW = letters.reduce((sum, item) => sum + item.w, 0) + (letters.length - 1) * gap;
    let currX = -totalW * 0.5;

    letters.forEach(item => {
      const mesh = new T.Mesh(item.geo, grayMat);
      mesh.position.set(currX, -0.31, 0.12);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      lettersGroup.add(mesh);
      currX += item.w + gap;
    });

    lettersGroup.position.set(posX, posY, posZ);
    targetGroup.add(lettersGroup);
  }

  // ==========================================
  // --- PILOT 1A: APPROVED STYLIZED BANK ---
  // ==========================================
  function bankBuilding() {
    const g = new T.Group();
    g.name = 'approved-stylized-bank';

    // 1. Tầng 1: Courtyard Apron & Curb (14.2m x 12.0m)
    apronPad(g, 14.2, 12.0, { entranceWidth: 4.2 });

    // 2. Stepped Plinth (Bậc tam cấp sảnh chính chuẩn xác, phẳng phiu)
    // Bậc 1 (chân thềm thấp nhất, vươn ra xa nhất đón khách):
    box(g, 7.2, 0.12, 0.60, 0, 0.00, 5.50, M.stone);
    // Bậc 2 (bậc giữa):
    box(g, 6.8, 0.12, 0.60, 0, 0.12, 4.95, M.stone);
    // Bậc 3 (sảnh dừng trên cùng rộng rãi, cốt sàn cao nhất):
    box(g, 6.4, 0.14, 1.25, 0, 0.24, 4.35, M.stone);
    box(g, 6.2, 0.02, 1.15, 0, 0.31, 4.35, M.walk);

    // 3. Khối sảnh giao dịch chính (Main Banking Hall: 9.6m x 6.4m x 8.0m)
    stylizedShell(g, 9.6, 6.4, 8.0, {
      parapetExtend: 0.32,
      beltLevels: [3.4]
    });

    // 4. Khối văn phòng phụ (Executive Wing bên phải giật cấp: 4.0m x 4.8m x 6.2m)
    const wingG = new T.Group();
    wingG.userData.toggleKey = 'executiveWing';
    box(wingG, 4.0, 0.35, 6.2, 5.6, 0, -0.6, M.stone);
    box(wingG, 3.8, 4.4, 6.0, 5.6, 0.35, -0.6, M.cream);
    box(wingG, 4.2, 0.38, 6.4, 5.6, 4.75, -0.6, M.stone);
    box(wingG, 4.3, 0.08, 6.5, 5.6, 5.10, -0.6, M.orange);
    // Side wing punch windows
    recessedWindows(wingG, 2.6, 1.4, 0.1, 5.6, 2.4, 2.42, 1, 2);
    recessedWindows(wingG, 2.6, 1.4, 0.1, 5.6, 4.0, 2.42, 1, 2);
    g.add(wingG);

    // 5. Cổng sảnh Colonnade Bề Thế & Mái đón AN PHIM Orange Canopy
    const porticoG = new T.Group();
    porticoG.userData.toggleKey = 'portico';
    // Bố trí 4 cột trụ cổ điển chia 2 cặp đối xứng hai bên, giải phóng hoàn toàn lối vào chính giữa rộng 3.3m:
    const columnPositions = [-2.55, -1.65, 1.65, 2.55];
    for (const x of columnPositions) {
      // Chân đế cột đá sa thạch
      box(porticoG, 0.54, 0.22, 0.54, x, 0.35, 4.45, M.stone);
      // Thân cột chính vững chãi màu kem sa thạch
      box(porticoG, 0.44, 3.85, 0.44, x, 0.57, 4.45, M.cream);
      // Vòng chỉ cam thanh lịch dưới đầu cột
      box(porticoG, 0.48, 0.06, 0.48, x, 4.36, 4.45, M.orange);
      // Đầu cột vát gờ trang trí (Abacus Capital)
      box(porticoG, 0.56, 0.18, 0.56, x, 4.42, 4.45, M.stone);
    }
    // Dầm văng chính (Architrave / Cornice) kết nối qua đỉnh các cột:
    box(porticoG, 6.6, 0.45, 1.25, 0, 4.60, 4.45, M.stone);
    box(porticoG, 6.7, 0.08, 1.30, 0, 4.83, 4.45, M.orange);

    // Mái đón sảnh chữ U màu cam AN PHIM Canopy:
    box(porticoG, 6.2, 0.22, 1.70, 0, 3.55, 4.75, M.orange);
    box(porticoG, 5.9, 0.06, 0.10, 0, 3.64, 5.58, M.white); // Gờ chỉ LED trắng mặt trước
    // Cụm đèn downlight âm trần sảnh chiếu sáng lối vào:
    cylinder(porticoG, 0.18, 0.04, -0.90, 3.42, 4.70, M.white, 12);
    cylinder(porticoG, 0.18, 0.04, 0.90, 3.42, 4.70, M.white, 12);
    g.add(porticoG);

    // 6. BỘ CHỮ 3D NỔI "BANK" ĐÙN KHỐI VÀNG KIM TRÊN NỀN LỤC BẢO SANG TRỌNG
    create3DBankSignage(g, 0, 5.30, 4.50);

    // 7. Cửa sảnh kính ra vào chính và vách kính thông tầng
    // Khung vòm sảnh bao quanh cửa
    box(g, 0.12, 2.75, 0.16, -1.55, 0.35, 4.05, M.stone);
    box(g, 0.12, 2.75, 0.16, 1.55, 0.35, 4.05, M.stone);
    box(g, 3.22, 0.14, 0.16, 0, 3.05, 4.05, M.stone);
    // Cửa kính lớn 2 cánh ra vào sảnh:
    windows(g, 2.98, 2.70, 0.10, 0, 0.35, 4.04, 1, 2);
    // Tay nắm kim loại màu cam thương hiệu cho 2 cánh cửa:
    box(g, 0.04, 0.65, 0.06, -0.08, 1.30, 4.12, M.orange);
    box(g, 0.04, 0.65, 0.06, 0.08, 1.30, 4.12, M.orange);

    // Dải cửa sổ kính tầng trên và vách hông
    recessedWindows(g, 7.8, 1.6, 0.1, 0, 5.1, 4.02, 1, 4, { depth: 0.18 });
    recessedWindows(g, 5.8, 1.8, 0.1, -4.82, 3.6, 0, 1, 3, { depth: 0.18, axis: 'z' });

    // 8. BỤI CÂY LOW-POLY CRYSTAL FACETED (CÂY TINH THỂ ĐA DIỆN) THEO YÊU CẦU CỦA SẾP
    const bushesG = new T.Group();
    bushesG.userData.toggleKey = 'bushes';
    // Cụm cây tinh thể phía bên trái thềm sảnh đối xứng gọn gàng:
    const bushL1 = createFacetedBush({ scale: 1.25, rotY: 0.4 });
    bushL1.position.set(-3.5, 0.12, 4.8);
    bushesG.add(bushL1);
    const bushL2 = createFacetedBush({ scale: 0.95, rotY: 1.9 });
    bushL2.position.set(-3.5, 0.12, 5.5);
    bushesG.add(bushL2);

    // Cụm cây tinh thể phía bên phải thềm sảnh đối xứng:
    const bushR1 = createFacetedBush({ scale: 1.25, rotY: 2.5 });
    bushR1.position.set(3.5, 0.12, 4.8);
    bushesG.add(bushR1);
    const bushR2 = createFacetedBush({ scale: 0.95, rotY: 4.1 });
    bushR2.position.set(3.5, 0.12, 5.5);
    bushesG.add(bushR2);
    g.add(bushesG);

    // Outdoor ATM Kiosk đặt gọn vào góc phải, tách rời hoàn toàn không dính tường (Clearance > 20cm)
    const atmG = new T.Group();
    atmG.userData.toggleKey = 'atm';
    const atmX = 5.50;
    const atmZ = 3.60;
    box(atmG, 1.0, 2.2, 0.8, atmX, 0.12, atmZ, M.dark);
    box(atmG, 1.15, 0.14, 0.95, atmX, 2.32, atmZ, M.orange); // Mái che vát cam
    box(atmG, 0.70, 0.50, 0.04, atmX, 1.35, atmZ + 0.42, M.glass); // Màn hình ATM kính xanh
    box(atmG, 0.55, 0.12, 0.20, atmX, 0.95, atmZ + 0.46, M.metal); // Bàn phím & khe thẻ kim loại
    box(atmG, 0.70, 0.06, 0.04, atmX, 1.85, atmZ + 0.42, M.orange); // Dải đèn LED thương hiệu
    g.add(atmG);

    // Patio Table & Yellow Umbrella tách biệt hoàn toàn ra khỏi tường (Cách tường > 1.0m)
    const patioG = new T.Group();
    patioG.userData.toggleKey = 'patio';
    const patioX = -5.80;
    const patioZ = 5.20;
    cylinder(patioG, 0.50, 0.06, patioX, 0.75, patioZ, M.stone, 16);
    cylinder(patioG, 0.05, 0.70, patioX, 0.12, patioZ, M.metal, 8);
    cylinder(patioG, 0.22, 0.38, patioX, 0.12, patioZ - 0.65, M.orange, 12);
    cylinder(patioG, 0.22, 0.38, patioX, 0.12, patioZ + 0.65, M.orange, 12);
    cylinder(patioG, 0.04, 2.4, patioX, 0.12, patioZ, M.white, 8);
    const umbrellaCone = new T.Mesh(new T.ConeGeometry(1.05, 0.45, 16), M.walk);
    umbrellaCone.position.set(patioX, 2.35, patioZ);
    umbrellaCone.castShadow = true;
    patioG.add(umbrellaCone);
    g.add(patioG);


    // 9. Rooftop Kitbash
    const roofG = new T.Group();
    roofG.userData.toggleKey = 'roofEquipment';
    roofKitbash(roofG, 9.6, 8.0, 6.4, {
      solar: true,
      solarCount: 2,
      solarStartX: -2.8,
      hvac: true,
      hvacX: 2.2,
      hvacZ: -1.6,
      planter: true,
      planterX: -2.4,
      planterZ: 1.8
    });
    g.add(roofG);

    // 10. Navigation Socket
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(0, 0, 5.8);
    g.add(socket);

    return g;
  }

  // ==========================================
  // --- PILOT 1B: CENTRAL CASH VAULT ---
  // ==========================================
  function vaultBuilding() {
    const g = new T.Group();
    g.name = 'secure-cash-vault';

    // 1. Tầng 1: Courtyard Apron & Curb (9.8m x 9.8m)
    apronPad(g, 9.8, 9.8, { entranceWidth: 3.4 });

    // 2. Fortified Plinth & Bunker Body (8.4m x 5.4m x 8.4m)
    box(g, 9.0, 0.45, 9.0, 0, 0, 0, M.stone);
    box(g, 8.0, 4.8, 8.0, 0, 0.45, -0.2, M.cream); // thân kem theo ảnh tham chiếu; mặt cửa kho giữ tông tối

    // 3. 4 Heavy Corner Reinforcement Buttresses
    const buttressesG = new T.Group();
    buttressesG.userData.toggleKey = 'buttresses';
    for (const [cx, cz] of [[-3.9, -4.1], [3.9, -4.1], [-3.9, 3.7], [3.9, 3.7]]) {
      box(buttressesG, 1.25, 5.4, 1.25, cx, 0.45, cz, M.stone);
      box(buttressesG, 1.35, 0.15, 1.35, cx, 5.85, cz, M.orange);
    }
    g.add(buttressesG);

    // 4. Chunky Parapet & Cornice
    box(g, 8.8, 0.45, 8.8, 0, 5.25, -0.2, M.stone);
    box(g, 9.0, 0.30, 9.0, 0, 5.50, -0.2, M.orange); // dày 0.3: tấm 0.1 quá mỏng nên mặt mái tự đổ bóng lốm đốm

    // 5. Massive Circular Vault Portal Structure
    const blastDoorG = new T.Group();
    blastDoorG.userData.toggleKey = 'blastDoor';
    box(blastDoorG, 5.6, 4.2, 0.7, 0, 0.5, 3.9, M.metal);
    const portal = new T.Mesh(new T.CylinderGeometry(2.1, 2.1, 0.55, 32), M.metal);
    portal.rotation.x = Math.PI / 2;
    portal.position.set(0, 2.7, 4.3);
    portal.castShadow = true;
    blastDoorG.add(portal);

    // Brushed Steel Main Vault Door
    const doorMat = new T.MeshStandardMaterial({ color: 0x9098a5, metalness: 0.90, roughness: 0.22 });
    const door = new T.Mesh(new T.CylinderGeometry(1.75, 1.75, 0.45, 32), doorMat);
    door.rotation.x = Math.PI / 2;
    door.position.set(0, 2.7, 4.6);
    door.castShadow = true;
    blastDoorG.add(door);

    // 16 Chrome Radial Locking Bolts
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const bx = Math.cos(ang) * 1.55;
      const by = 2.7 + Math.sin(ang) * 1.55;
      cylinder(blastDoorG, 0.08, 0.45, bx, by - 0.22, 4.8, M.white, 8);
    }

    // Heavy Hinges at Left
    box(blastDoorG, 0.55, 1.1, 0.55, -1.9, 3.2, 4.55, M.dark);
    box(blastDoorG, 0.55, 1.1, 0.55, -1.9, 1.8, 4.55, M.dark);

    // Central 4-Spoke Handwheel in AN PHIM Orange
    const wheelHub = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 0.22, 16), M.orange);
    wheelHub.rotation.x = Math.PI / 2;
    wheelHub.position.set(0, 2.7, 4.9);
    blastDoorG.add(wheelHub);
    const rim = new T.Mesh(new T.TorusGeometry(0.85, 0.08, 12, 32), M.orange);
    rim.position.set(0, 2.7, 4.95);
    blastDoorG.add(rim);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      beam(blastDoorG, [0, 2.7, 4.95], [Math.cos(ang) * 0.85, 2.7 + Math.sin(ang) * 0.85, 4.95], 0.09, 0.09, M.white);
    }

    // Digital Keypad & Biometrics Panel at Right
    box(blastDoorG, 0.50, 1.2, 0.35, 2.1, 0.5, 4.5, M.metal);
    box(blastDoorG, 0.35, 0.45, 0.08, 2.1, 1.25, 4.7, M.orange);
    const ledMat = new T.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 1.5 });
    const led = new T.Mesh(new T.SphereGeometry(0.06, 8, 8), ledMat);
    led.position.set(2.1, 1.6, 4.75);
    blastDoorG.add(led);
    g.add(blastDoorG);

    // 6. Gold Bar Pedestals Flanking the Entrance
    const goldPedestalsG = new T.Group();
    goldPedestalsG.userData.toggleKey = 'goldPedestals';
    for (const [gx, gz] of [[-2.5, 4.5], [2.5, 4.5]]) {
      box(goldPedestalsG, 0.85, 0.55, 0.85, gx, 0.12, gz, M.stone);
      for (let l = 0; l < 3; l++) {
        box(goldPedestalsG, 0.55 - l * 0.08, 0.09, 0.35 - l * 0.06, gx, 0.67 + l * 0.09, gz, M.gold);
      }
    }
    g.add(goldPedestalsG);

    // 7. 3D Prominent Signage "CENTRAL CASH VAULT"
    const signG = new T.Group();
    signG.userData.toggleKey = 'sign';
    sign(signG, 'CENTRAL CASH VAULT', 4.2, 0.7, 0, 5.0, 4.5);
    g.add(signG);

    // 8. Rooftop Engineering: Chiller, Air Duct, Security Beacon
    const roofEquipmentG = new T.Group();
    roofEquipmentG.userData.toggleKey = 'roofEquipment';
    box(roofEquipmentG, 3.8, 1.0, 3.8, 0, 5.75, -0.2, M.metal);
    cylinder(roofEquipmentG, 0.75, 1.1, 0, 6.75, -0.2, M.dark, 16);
    cylinder(roofEquipmentG, 0.06, 1.4, 2.6, 5.75, 2.6, M.white, 8);
    const beaconMat = new T.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff2200, emissiveIntensity: 2.0 });
    const beacon = new T.Mesh(new T.SphereGeometry(0.14, 12, 12), beaconMat);
    beacon.position.set(2.6, 7.15, 2.6);
    roofEquipmentG.add(beacon);
    g.add(roofEquipmentG);

    // 9. Navigation Socket
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(0, 0, 5.0);
    g.add(socket);

    return g;
  }

  // ==========================================
  // --- PILOT 2: AN PHIM HEADQUARTERS (HQ) ---
  // ==========================================
  function HQ() {
    const g = new T.Group();
    g.name = 'approved-slanted-HQ';

    // 1. Tầng 1: Ground Plinth & Apron Pad (27m x 23m)
    box(g, 27, 0.35, 23, 0, 0, 0, M.stone);
    box(g, 26.2, 0.08, 22.2, 0, 0.35, 0, M.stone);

    // 2. Podium Base Level (Y=0.35 to 5.55) - ĐẶC KHÍCH 100%, KHÔNG LỖ LỦNG, KHÔNG LÕM SAU
    // Cánh trái (X: [-12.6, 0.4], Z: [-10.1, 7.9])
    box(g, 13, 5.2, 18, -6.1, 0.35, -1.1, M.cream);
    windows(g, 11.8, 4.6, 0.12, -6.1, 0.65, 7.98, 1, 5);
    windows(g, 0.12, 4.6, 16.7, -12.65, 0.65, -1.1, 1, 7);

    // Khối lõi trung tâm (Central Core: X: [-0.65, 1.35], Z: [-10.1, 7.9]) - Bịt kín 100% khoảng hở/lủng giữa hai cánh
    box(g, 2.0, 5.2, 18, 0.7, 0.35, -1.1, M.cream);

    // Cánh phải phía trước (Right Wing Front: X: [1.1, 12.7], Z: [-3.1, 10.9])
    box(g, 11.6, 3.4, 14, 6.9, 0.35, 3.9, M.cream);
    windows(g, 10.5, 2.9, 0.12, 6.9, 0.65, 10.98, 1, 5);
    windows(g, 0.12, 2.9, 12.8, 12.76, 0.65, 3.9, 1, 5);

    // Cánh phải phía sau (Right Wing Rear: X: [1.1, 12.7], Z: [-10.1, -3.1]) - Khóa phẳng mặt sau, chống lõm 100%
    box(g, 11.6, 5.2, 7.0, 6.9, 0.35, -6.6, M.cream);
    windows(g, 0.12, 4.6, 6.8, 12.76, 0.65, -6.6, 1, 3);

    // Sảnh đón thông tầng (Z: [2.2, 9.3])
    box(g, 8.6, 4.6, 7.1, -0.65, 0.35, 5.75, M.cream);

    // Mặt sau đồng bộ kiến trúc: 2 dải cửa sổ teal có nan moss & dầm cam chạy dọc mặt sau
    windows(g, 11.4, 4.3, 0.10, -6.1, 0.7, -10.15, 2, 5);
    windows(g, 10.2, 4.3, 0.10, 6.9, 0.7, -10.15, 2, 5);
    box(g, 25.6, 0.40, 0.40, 0.4, 5.55, -10.15, M.stone);
    box(g, 25.8, 0.08, 0.42, 0.4, 5.92, -10.15, M.orange);

    // Gờ mái và bo viền cánh phải
    box(g, 11.9, 0.4, 14.3, 6.9, 3.65, 3.9, M.stone);
    box(g, 11.9, 0.4, 7.3, 6.9, 5.55, -6.6, M.stone);

    // 3. Right Wing Stepped Terraces (Tầng thượng giật cấp cánh phải)
    box(g, 10, 3.15, 10, 6.8, 3.75, 2, M.cream);
    windows(g, 9.2, 2.7, 0.12, 6.8, 4, 7.05, 1, 5);
    windows(g, 0.12, 2.7, 9.3, 11.86, 4, 2, 1, 5);
    box(g, 10.35, 0.4, 10.35, 6.8, 6.9, 2, M.stone);

    // Rooftop lantern
    box(g, 4.4, 0.18, 3.2, 7, 7.3, 2, M.moss);
    windows(g, 4.1, 1.15, 0.1, 7, 7.48, 3.55, 1, 3);
    windows(g, 0.1, 1.15, 2.9, 9.05, 7.48, 2, 1, 2);
    windows(g, 4.1, 1.15, 0.1, 7, 7.48, 0.45, 1, 3);
    windows(g, 0.1, 1.15, 2.9, 4.95, 7.48, 2, 1, 2);
    box(g, 4.55, 0.22, 3.35, 7, 8.63, 2, M.cream);
    box(g, 1.9, 0.55, 1.5, 7.1, 8.85, 1.8, M.stone);

    // 4. Iconic Slanted Glass Tower Wedge
    const shape = new T.Shape();
    shape.moveTo(-9.3, 5.55);
    shape.lineTo(2.7, 5.55);
    shape.lineTo(2.7, 25.5);
    shape.lineTo(-5.6, 25.5);
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false });
    geo.translate(0, 0, -7.8);
    const tower = new T.Mesh(geo, M.glass);
    tower.castShadow = tower.receiveShadow = true;
    g.add(tower);

    // Structural perimeter trusses & columns
    for (const z of [-7.85, 2.27]) beam(g, [-9.3, 5.55, z], [-5.6, 25.5, z], 1.1, 0.5, M.cream);
    box(g, 8.9, 0.8, 10.7, -1.6, 25.15, -2.8, M.cream);
    box(g, 0.65, 20.1, 0.45, 2.85, 5.55, 2.3, M.cream);
    box(g, 0.65, 20.1, 0.45, 2.85, 5.55, -7.8, M.cream);

    // Horizontal window mullions (Moss)
    for (let i = 1; i < 9; i++) {
      const y = 5.55 + i * 2.2, left = -9.3 + (y - 5.55) * 3.7 / 19.95;
      box(g, 2.7 - left, 0.09, 0.12, (left + 2.7) / 2, y, 2.29, M.moss);
      box(g, 2.7 - left, 0.09, 0.12, (left + 2.7) / 2, y, -7.86, M.moss);
    }
    // Vertical window mullions front & back
    for (let i = 1; i < 7; i++) {
      const x = -9.3 + i * 1.7, end = x < -5.6 ? 5.55 + (x + 9.3) * 19.95 / 3.7 : 25.3;
      box(g, 0.10, end - 5.55, 0.15, x, 5.55, 2.32, M.moss);
      box(g, 0.10, end - 5.55, 0.15, x, 5.55, -7.88, M.moss);
    }

    // Sloping side glass grid
    for (let i = 1; i < 6; i++) {
      const z = -7.8 + i * 1.65;
      beam(g, [-9.34, 5.55, z], [-5.64, 25.5, z], 0.065, 0.065, M.moss);
    }
    for (let i = 1; i < 8; i++) {
      const y = 5.55 + i * 2.5, x = -9.3 + (y - 5.55) * 3.7 / 19.95;
      box(g, 0.09, 0.09, 10.05, x - 0.02, y, -2.8, M.moss);
    }

    // 5. Middle Stepped Shoulder Volume with Curtain Wall Windows
    box(g, 10.6, 7, 9.2, 1.1, 5.55, 0, M.cream);
    windows(g, 9.7, 6, 0.12, 1.1, 6, 4.66, 2, 5);
    box(g, 10.9, 0.5, 9.5, 1.1, 12.55, 0, M.cream);
    box(g, 5.3, 4.5, 6.6, 1.6, 13.05, -1.2, M.cream);
    box(g, 5.5, 0.18, 6.8, 1.6, 17.55, -1.2, M.cream);

    // Stepped shoulder wedge & ORANGE DIAGONAL ACCENT BEAM
    const shoulderShape = new T.Shape();
    shoulderShape.moveTo(-1, 13);
    shoulderShape.lineTo(1.4, 17.6);
    shoulderShape.lineTo(4.25, 17.6);
    shoulderShape.lineTo(4.25, 13);
    shoulderShape.closePath();
    const shoulder = new T.Mesh(new T.ExtrudeGeometry(shoulderShape, { depth: 2.7, bevelEnabled: false }), M.cream);
    shoulder.position.z = 2.1;
    shoulder.castShadow = true;
    g.add(shoulder);

    // Thanh cam trang trí ở đỉnh tháp: Độ dài 8.4m ôm khít đỉnh tháp [-5.6, 2.7], không bị lòi sang phải
    box(g, 8.4, 0.28, 0.22, -1.45, 25.15, 2.38, M.orange);

    // Nẹp cam chân tháp phẳng đẹp ôm trọn chân tháp
    box(g, 12.2, 0.22, 0.25, -3.3, 5.60, 2.38, M.orange);


    // Vertical glazing ribs
    for (const x of [-4.2, -2.5, -0.8, 0.9]) box(g, 0.115, 19.5, 0.22, x, 5.65, 2.38, M.moss);
    for (const z of [-6.3, -4.4, -2.5, -0.6, 1.3]) box(g, 0.22, 18.8, 0.1, 2.9, 5.7, z, M.moss);

    // Rear upper spandrels
    for (const y of [10, 14.4, 18.8, 23.2]) box(g, 8.5, 0.16, 0.32, -1.45, y, -7.94, M.moss);
    for (const z of [-7, -4.5, -2, 0.5, 3, 5.5]) box(g, 0.20, 4.4, 0.12, -12.72, 0.65, z, M.cream);
    box(g, 11.8, 0.17, 0.35, -6.1, 2.8, 8.04, M.cream);
    box(g, 10.5, 0.17, 0.35, 6.9, 2.1, 11.04, M.cream);

    // 7. Entrance Canopy & Signature Steps
    windows(g, 7.2, 3.6, 0.15, -0.65, 0.7, 9.3, 1, 3);
    box(g, 8.6, 0.45, 3.1, -0.65, 4.4, 9.7, M.orange);
    for (const x of [-4.5, 3.2]) box(g, 0.5, 4.25, 0.55, x, 0.35, 10.7, M.orange);
    box(g, 7.8, 0.055, 0.08, -0.65, 4.55, 11.29, M.white);
    for (const x of [-4.5, 3.2]) box(g, 0.055, 3.6, 0.065, x, 0.65, 11.01, M.white);
    box(g, 7.7, 0.12, 2.45, -0.65, 4.26, 9.7, M.moss);
    for (const x of [-3.8, 2.5]) box(g, 0.16, 3.6, 0.25, x, 0.7, 9.45, M.stone);
    for (const z of [9, 9.5, 10]) box(g, 7.1, 0.04, 0.06, -0.65, 4.23, z, M.stone);

    for (let i = 0; i < 4; i++) {
      box(g, 8.6 - i * 0.25, 0.12, 1.2, -0.65, 0.12 * i, 11.1 - i * 0.65, M.stone);
    }

    // 8. 3 Realistic Solar Panels on Roof
    for (const [x, w] of [[-3.8, 1.6], [-1.7, 2.4], [1, 1.3]]) {
      box(g, w, 0.85, 2.1, x, 25.95, -2.4, M.metal);
    }

    // 9. Vertical Orange Accent Fins
    for (const x of [10.1, 10.55, 11, 11.45, 11.9, 12.35]) {
      box(g, 0.19, 5.9, 0.3, x, 0.6, 11.04, M.orange);
    }
    for (const x of [-1.7, -1.4, -1.1]) {
      box(g, 0.12, 4.5, 0.22, x, 0.65, 8.08, M.orange);
    }

    // Shoulder panel grooves
    for (const x of [1.3, 2.8, 4.1]) box(g, 0.025, 3.7, 0.025, x, 13.25, 4.82, M.stone);
    box(g, 3.8, 0.025, 0.025, 2.3, 15.3, 4.82, M.stone);

    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(-0.65, 0, 12.3);
    g.add(socket);

    return g;
  }

  // ==========================================
  // --- PROCEDURAL DEPARTMENT FACTORY ---
  // ==========================================
  function department(style) {
    if (style === 'bank') return bankBuilding();
    if (style === 'vault') return vaultBuilding();

    const g = new T.Group();
    if (style === 'civic') {
      shell(g, 7, 5.1, 6, 2, 4);
      box(g, 2, 1.2, 5, -2.2, 5.3, 0, M.moss);
      entry(g, 2, 3.2, 2.1);
      box(g, 7.4, 0.2, 6.4, 0, 5.1, 0);
    } else if (style === 'archive') {
      shell(g, 5, 2.8, 4.8, 1, 2);
      box(g, 4.6, 0.2, 4.4, 0, 3, 0, M.moss);
      box(g, 3.4, 1.2, 0.12, 0, 0.5, 2.52, M.metal);
      for (const x of [-1.3, 0, 1.3]) box(g, 0.1, 1.2, 0.15, x, 0.5, 2.6, M.cream);
      entry(g, 1.2, 2.7, 1.8);
    } else if (style === 'ai') {
      shell(g, 9, 7.3, 7.5, 3, 6);
      box(g, 3.3, 2.5, 5, -2.5, 7.5, -0.5, M.moss);
      windows(g, 3, 2.1, 0.1, -2.5, 7.7, 2.1, 1, 2);
      box(g, 4.6, 0.35, 5.8, 2.4, 7.4, 0.5, M.orange);
      entry(g, 2.6, 4, 2.8);
      for (let x = -3.5; x < 4; x += 1.3) box(g, 0.14, 6.7, 0.3, x, 0.5, 3.9, M.cream);
    } else if (style === 'office') {
      shell(g, 6.5, 4.8, 6.1, 2, 4);
      box(g, 4, 1.4, 4.5, -1.1, 5, 0, M.glass);
      box(g, 4.3, 0.2, 4.8, -1.1, 6.4, 0);
      entry(g, 1.8, 3.2, 2.1);
    } else if (style === 'database') {
      box(g, 6.7, 3.8, 6, 0, 0, 0, M.stone);
      for (let i = 0; i < 4; i++) {
        box(g, 1.2, 2.9, 0.2, -2.3 + i * 1.5, 0.5, 3.08, M.moss);
        for (let j = 0; j < 6; j++) box(g, 0.8, 0.05, 0.08, -2.3 + i * 1.5, 0.8 + j * 0.4, 3.23, M.glass);
      }
      box(g, 7, 0.25, 6.3, 0, 3.8, 0);
      cylinder(g, 0.9, 1.3, -1.7, 4.05, -0.8, M.metal);
      cylinder(g, 0.9, 1.3, 1.7, 4.05, -0.8, M.metal);
      entry(g, 1.4, 3.35, 2);
    } else if (style === 'cloud') {
      shell(g, 4.8, 2.9, 4.5, 1, 3);
      box(g, 3.6, 1.1, 2.8, 0, 3.1, -0.4, M.glass);
      box(g, 3.9, 0.2, 3.1, 0, 4.2, -0.4);
      entry(g, 1.2, 2.4, 1.8);
    } else if (style === 'gateway') {
      shell(g, 4.2, 2.8, 4.5, 1, 2);
      box(g, 1.4, 1.4, 1.4, 1.1, 3, -0.8, M.moss);
      const dish = new T.Mesh(new T.SphereGeometry(0.65, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.stone);
      dish.rotation.z = -0.6;
      dish.position.set(1.1, 4.8, -0.8);
      g.add(dish);
      entry(g, 1.2, 2.4, 1.7);
    } else if (style === 'web') {
      shell(g, 4.7, 2.8, 4.5, 1, 3);
      box(g, 5, 0.2, 4.8, 0, 2.8, 0, M.moss);
      entry(g, 1.5, 2.4, 1.9);
      box(g, 2.7, 0.65, 0.1, 0, 2.1, 2.56, M.orange);
    } else if (style === 'studio') {
      box(g, 4.8, 2.6, 4.6, 0, 0, 0, M.moss);
      const roof = new T.Mesh(new T.CylinderGeometry(2.4, 2.4, 4.8, 16, 1, false, 0, Math.PI), M.stone);
      roof.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      roof.scale.y = 0.35;
      roof.position.set(0, 2.6, 0);
      g.add(roof);
      entry(g, 2.2, 2.5, 2);
      box(g, 1.7, 0.7, 0.1, 0, 1.6, 2.65, M.glass);
    } else {
      shell(g, 4.9, 2.8, 4.4, 1, 3);
      box(g, 5.1, 0.2, 4.6, 0, 2.8, 0, M.stone);
      for (const x of [-1.7, 1.7]) box(g, 0.25, 2.6, 0.45, x, 0.1, 2.4);
      entry(g, 1.7, 2.5, 2);
    }
    const b = new T.Box3().setFromObject(g);
    // Chân đế đá cho các tòa nhỏ; thêm sau cùng để partId (đánh theo thứ tự mesh) của các chi tiết cũ không đổi
    if (g.userData.shellFootprint) box(g, g.userData.shellFootprint[0] + 0.3, 0.32, g.userData.shellFootprint[1] + 0.3, 0, 0, 0, M.stone);
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(0, 0, b.max.z + 0.12);
    g.add(socket);
    return g;
  }

  function fit(g, grade, grades) {
    const [w, h, d] = grades[grade];
    g.updateMatrixWorld(true);
    let b = new T.Box3().setFromObject(g), size = b.getSize(new T.Vector3());
    const scale = Math.min(w / size.x, h / size.y, d / size.z);
    g.scale.setScalar(scale);
    g.updateMatrixWorld(true);
    b = new T.Box3().setFromObject(g);
    const center = b.getCenter(new T.Vector3());
    for (const child of g.children) {
      child.position.x -= center.x / scale;
      child.position.y -= b.min.y / scale;
      child.position.z -= center.z / scale;
    }
    g.updateMatrixWorld(true);
    b = new T.Box3().setFromObject(g);
    return { group: g, scale, bbox: b.getSize(new T.Vector3()).toArray(), minY: b.min.y };
  }

  function telegramTower() {
    const g = new T.Group();
    g.name = 'telegram-earth-station';

    // 1. Plinth & Ground Apron (Nền móng đá & Sân trạm viễn thông)
    box(g, 9.6, 0.35, 8.6, 0, 0, 0, M.stone);
    box(g, 9.0, 0.08, 8.0, 0, 0.35, 0, M.walk);

    // 2. Control & Operations Building (Nhà Điều Hành Trạm Viễn Thông Mặt Đất)
    const controlG = new T.Group();
    controlG.userData.toggleKey = 'controlBuilding';
    box(controlG, 4.8, 3.0, 4.4, -1.8, 0.35, 0.4, M.cream);
    box(controlG, 5.1, 0.22, 4.7, -1.8, 3.35, 0.4, M.stone);
    box(controlG, 5.15, 0.08, 4.75, -1.8, 3.57, 0.4, M.orange);

    // Cửa sổ phòng điều hành viễn thông (Teal glass)
    box(controlG, 2.0, 1.3, 0.1, -1.1, 1.4, 2.62, M.glass);
    box(controlG, 2.1, 0.08, 0.12, -1.1, 1.36, 2.62, M.stone);
    box(controlG, 0.08, 1.4, 0.12, -1.1, 1.35, 2.62, M.stone);

    // Biển hiệu Trạm Vệ Tinh Telegram
    sign(controlG, 'TELEGRAM EARTH STATION', 2.8, 0.55, -1.8, 3.05, 2.64, P.colors.brandMoss, P.colors.plaster);
    g.add(controlG);

    // Cửa ra vào kỹ thuật & Mái đón sảnh
    const portalG = new T.Group();
    portalG.userData.toggleKey = 'portal';
    box(portalG, 1.0, 2.1, 0.08, -3.1, 0.35, 2.62, M.dark);
    box(portalG, 0.8, 0.45, 0.08, -3.1, 1.85, 2.63, M.glass);
    box(portalG, 1.5, 0.12, 1.0, -3.1, 2.55, 3.1, M.orange);
    beam(portalG, [-3.7, 2.55, 3.5], [-3.7, 1.7, 2.6], 0.04, 0.04, M.dark);
    beam(portalG, [-2.5, 2.55, 3.5], [-2.5, 1.7, 2.6], 0.04, 0.04, M.dark);
    g.add(portalG);

    // Cụm máy chủ điều hòa / tản nhiệt công nghiệp trên nóc
    const roofEquipmentG = new T.Group();
    roofEquipmentG.userData.toggleKey = 'roofEquipment';
    box(roofEquipmentG, 1.3, 0.75, 1.0, -2.5, 3.65, 0.2, M.metal);
    cylinder(roofEquipmentG, 0.32, 0.15, -2.5, 4.4, 0.2, M.dark, 16);
    box(roofEquipmentG, 0.9, 0.6, 0.7, -1.0, 3.65, -0.6, M.metal);
    g.add(roofEquipmentG);

    // 3. Heavy-duty Satellite Pedestal Tower (Bệ Trụ Đài Xoay Vệ Tinh Tải Nặng)
    cylinder(g, 1.75, 1.8, 2.2, 0.35, -0.4, M.cream, 24);
    cylinder(g, 1.85, 0.2, 2.2, 2.15, -0.4, M.stone, 24);
    cylinder(g, 1.35, 2.4, 2.2, 2.35, -0.4, M.metal, 24);

    // Sàn quan sát & bảo trì kỹ thuật (Catwalk deck)
    cylinder(g, 2.1, 0.22, 2.2, 4.75, -0.4, M.metal, 8);
    box(g, 3.6, 0.7, 0.05, 2.2, 4.97, 1.6, M.metal);
    box(g, 3.6, 0.7, 0.05, 2.2, 4.97, -2.4, M.metal);
    box(g, 0.05, 0.7, 4.0, 4.2, 4.97, -0.4, M.metal);
    box(g, 0.05, 0.7, 4.0, 0.2, 4.97, -0.4, M.metal);

    // Cầu cáp quang dẫn sóng nối từ nóc trạm sang bệ tháp
    box(g, 1.3, 0.12, 0.3, 0.8, 3.9, 0.4, M.dark);
    cylinder(g, 0.07, 1.1, 1.4, 3.9, 0.4, M.orange, 12);

    // Khớp xoay 2 trục Azimuth & Elevation (Fork Mount càng nâng)
    cylinder(g, 1.0, 0.45, 2.2, 4.97, -0.4, M.dark, 16);
    box(g, 0.9, 0.75, 0.75, 2.2, 5.42, -0.4, M.dark);
    box(g, 0.32, 1.3, 0.55, 1.45, 5.75, -0.4, M.stone);
    box(g, 0.32, 1.3, 0.55, 2.95, 5.75, -0.4, M.stone);

    // 4. Hero Parabolic Dish Group (Chảo Parabol Khổng Lồ 4.6m)
    const dishGroup = new T.Group();
    dishGroup.userData.toggleKey = 'dish';
    dishGroup.position.set(2.2, 6.6, -0.4);
    dishGroup.rotation.x = -Math.PI * 0.22;
    dishGroup.rotation.y = Math.PI * 0.12;
    dishGroup.rotation.z = -0.06;

    // Đường cong lòng chảo Paraboloid quang học chuẩn xác y = c * r^2
    const pts = [];
    const R = 2.3;
    const depth = 0.65;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const r = t * R;
      const y = (t * t) * depth;
      pts.push(new T.Vector2(r, -y));
    }
    const dishMesh = new T.Mesh(new T.LatheGeometry(pts, 36), M.white);
    dishMesh.castShadow = dishMesh.receiveShadow = true;
    dishGroup.add(dishMesh);

    // Vành thép bảo vệ mép chảo
    const rim = new T.Mesh(new T.TorusGeometry(R, 0.06, 12, 36), M.dark);
    rim.rotation.x = Math.PI / 2;
    dishGroup.add(rim);

    // Trục đỡ lưng chảo & Vòng giằng gia cố mặt sau
    cylinder(dishGroup, 0.45, 0.5, 0, -0.5, 0, M.dark, 16);
    const backRing = new T.Mesh(new T.TorusGeometry(1.35, 0.045, 8, 24), M.metal);
    backRing.rotation.x = Math.PI / 2;
    backRing.position.y = -0.3;
    dishGroup.add(backRing);

    // 4 nan giằng tỏa tròn sau lưng chảo
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
      const sx = Math.cos(a) * 1.8;
      const sz = Math.sin(a) * 1.8;
      beam(dishGroup, [0, -0.4, 0], [sx, -0.5, sz], 0.05, 0.05, M.metal);
    }

    // 4 chân chống vươn ra tiêu điểm (Quadpod Struts)
    const focalY = 1.35;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
      const sx = Math.cos(a) * (R * 0.88);
      const sz = Math.sin(a) * (R * 0.88);
      beam(dishGroup, [sx, -0.1, sz], [0, focalY, 0], 0.035, 0.035, M.dark);
    }

    // Củ thu sóng tâm chảo & Chóp đối tiêu điểm Cassegrain
    const hornGroup = new T.Group();
    hornGroup.position.set(0, focalY, 0);
    const hornCone = new T.Mesh(new T.ConeGeometry(0.24, 0.38, 16), M.orange);
    hornCone.rotation.x = Math.PI;
    hornGroup.add(hornCone);
    const subRef = new T.Mesh(new T.SphereGeometry(0.15, 12, 8), M.white);
    subRef.position.y = 0.12;
    hornGroup.add(subRef);
    dishGroup.add(hornGroup);

    g.add(dishGroup);

    // 5. Cột Phát Sóng Cao Tần & Cảnh Báo Hàng Không
    const antennaG = new T.Group();
    antennaG.userData.toggleKey = 'antennaMast';
    cylinder(antennaG, 0.09, 5.6, 3.5, 4.97, -1.6, M.metal, 12);
    cylinder(antennaG, 0.42, 0.32, 3.5, 8.2, -1.2, M.white, 16);
    cylinder(antennaG, 0.32, 0.28, 3.1, 7.2, -1.6, M.white, 16);

    for (let r of [0.35, 0.55]) {
      const ring = new T.Mesh(new T.TorusGeometry(r, 0.02, 8, 20), M.white);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(3.5, 9.2 + r * 0.8, -1.6);
      antennaG.add(ring);
    }

    const beaconMat = new T.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff1111,
      emissiveIntensity: 2.8,
      roughness: 0.1
    });
    const beacon = new T.Mesh(new T.SphereGeometry(0.15, 12, 12), beaconMat);
    beacon.position.set(3.5, 10.6, -1.6);
    antennaG.add(beacon);
    g.add(antennaG);

    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(-3.1, 0, 3.6);
    g.add(socket);

    return g;
  }

  function hermesLab() {
    const g = new T.Group();
    g.name = 'hermes-robotics-lab';
    cylinder(g, 4.8, 0.4, 0, 0, 0, M.stone, 8);
    cylinder(g, 4.2, 3.8, 0, 0.4, 0, M.cream, 8);
    cylinder(g, 4.25, 1.6, 0, 1.8, 0, M.glass, 16);
    cylinder(g, 4.45, 0.25, 0, 4.2, 0, M.orange, 8);
    cylinder(g, 3.4, 2.6, 0, 4.45, 0, M.cream, 8);
    cylinder(g, 3.45, 1.2, 0, 5.2, 0, M.glass, 16);

    const domeG = new T.Group();
    domeG.userData.toggleKey = 'glassDome';
    const domeMat = new T.MeshStandardMaterial({ color: P.colors.referenceGlass, roughness: 0.15, metalness: 0.3 });
    const dome = new T.Mesh(new T.SphereGeometry(2.4, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.set(0, 7.05, 0);
    dome.castShadow = true;
    domeG.add(dome);
    cylinder(domeG, 2.5, 0.2, 0, 7.05, 0, M.metal, 24);
    g.add(domeG);

    const armG = new T.Group();
    armG.userData.toggleKey = 'roboticArm';
    const ox = -1.8, oy = 4.45, oz = 2.2;
    cylinder(armG, 0.45, 0.4, ox, oy, oz, M.metal, 16);
    cylinder(armG, 0.35, 0.35, ox, oy + 0.4, oz, M.orange, 16);
    beam(armG, [ox, oy + 0.75, oz], [ox + 0.8, oy + 2.3, oz + 0.6], 0.22, 0.22, M.orange);
    const knuckle = new T.Mesh(new T.SphereGeometry(0.24, 12, 12), M.metal);
    knuckle.position.set(ox + 0.8, oy + 2.3, oz + 0.6);
    knuckle.castShadow = true;
    armG.add(knuckle);
    beam(armG, [ox + 0.8, oy + 2.3, oz + 0.6], [ox + 1.7, oy + 1.8, oz + 1.5], 0.18, 0.18, M.metal);
    const wrist = new T.Mesh(new T.SphereGeometry(0.18, 12, 12), M.orange);
    wrist.position.set(ox + 1.7, oy + 1.8, oz + 1.5);
    wrist.castShadow = true;
    armG.add(wrist);
    box(armG, 0.08, 0.35, 0.12, ox + 1.62, oy + 1.75, oz + 1.85, M.white);
    box(armG, 0.08, 0.35, 0.12, ox + 1.78, oy + 1.75, oz + 1.85, M.white);
    box(armG, 0.22, 0.22, 0.22, ox + 1.7, oy + 1.75, oz + 1.95, M.moss);
    g.add(armG);

    const dishG = new T.Group();
    dishG.userData.toggleKey = 'sensorDish';
    const dish = new T.Mesh(new T.SphereGeometry(0.9, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), M.cream);
    dish.rotation.x = 0.5;
    dish.rotation.y = -0.4;
    dish.position.set(1.6, 7.3, -1.2);
    dish.castShadow = true;
    dishG.add(dish);
    cylinder(dishG, 0.06, 0.6, 1.6, 7.4, -1.2, M.metal);
    g.add(dishG);

    const portalG = new T.Group();
    portalG.userData.toggleKey = 'portal';
    box(portalG, 2.6, 2.4, 0.5, 0, 0.4, 4.1, M.metal);
    windows(portalG, 2.2, 2.0, 0.1, 0, 0.5, 4.36, 1, 2);
    box(portalG, 3.2, 0.2, 1.2, 0, 2.8, 4.4, M.orange);
    g.add(portalG);

    const signG = new T.Group();
    signG.userData.toggleKey = 'sign';
    sign(signG, 'HERMES ROBOTICS LAB', 3.4, 0.65, 0, 3.4, 4.3);
    g.add(signG);
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(0, 0, 4.8);
    g.add(socket);
    return g;
  }

  function officeBuilding() {
    const g = new T.Group();
    g.name = 'ai-office-building';
    box(g, 9.6, 0.35, 8.8, 0, 0, 0, M.stone);
    box(g, 8.8, 6.2, 8.0, 0, 0.35, -0.2, M.cream);
    windows(g, 7.8, 1.4, 0.1, 0, 0.9, 3.82, 1, 5);
    windows(g, 7.8, 1.4, 0.1, 0, 2.8, 3.82, 1, 5);
    windows(g, 7.8, 1.4, 0.1, 0, 4.7, 3.82, 1, 5);
    windows(g, 0.1, 1.4, 6.6, 4.42, 2.8, -0.2, 1, 4);
    windows(g, 0.1, 1.4, 6.6, -4.42, 2.8, -0.2, 1, 4);
    for (let y = 2.3; y <= 6.2; y += 1.9) box(g, 8.4, 0.12, 0.45, 0, y, 4.0, M.orange);
    box(g, 3.4, 0.22, 1.6, 0, 2.4, 4.3, M.orange);
    for (const x of [-1.5, 1.5]) cylinder(g, 0.08, 2.05, x, 0.35, 4.8, M.metal);
    box(g, 5.2, 1.2, 4.8, -1.2, 6.55, -0.6, M.metal);
    box(g, 9.0, 0.45, 0.1, 0, 6.55, 3.75, M.stone);
    for (const [rx, rz] of [[1.8, 1.2], [2.8, 1.2]]) cylinder(g, 0.4, 0.9, rx, 6.55, rz, M.dark);
    sign(g, 'AI INNOVATION HUB', 4.0, 0.65, 0, 2.7, 3.9);
    // Lan can mái bao kín + vườn mái xanh (các tòa trong ảnh tham chiếu đều có mái hoàn thiện); thêm sau cùng để giữ partId cũ
    box(g, 9.0, 0.45, 0.1, 0, 6.55, -4.15, M.stone);
    for (const x of [-4.45, 4.45]) box(g, 0.1, 0.45, 8.0, x, 6.55, -0.2, M.stone);
    box(g, 2.6, 0.2, 3.6, 2.9, 6.55, -2.1, M.moss);
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(0, 0, 4.6);
    g.add(socket);
    return g;
  }

  function scheduleKiosk() {
    const g = new T.Group();
    g.name = 'schedule-operations-kiosk';
    box(g, 6.8, 0.35, 6.8, 0, 0, 0, M.stone);
    box(g, 5.4, 3.6, 5.0, 0, 0.35, -0.3, M.cream);
    windows(g, 4.8, 2.8, 0.1, 0, 0.7, 2.22, 1, 3);
    const schedScreen = new T.Mesh(new T.BoxGeometry(4.2, 2.2, 0.15), M.dark);
    schedScreen.position.set(0, 2.1, 2.3);
    g.add(schedScreen);
    box(g, 4.4, 0.1, 0.25, 0, 3.25, 2.3, M.orange);
    box(g, 6.6, 0.25, 6.4, 0, 3.95, -0.2, M.stone);
    box(g, 6.8, 0.12, 6.6, 0, 4.15, -0.2, M.orange);
    for (const [px, pz] of [[-3.1, -3.0], [3.1, -3.0], [-3.1, 2.8], [3.1, 2.8]]) {
      cylinder(g, 0.14, 3.95, px, 0, pz, M.metal, 12);
    }
    box(g, 1.8, 0.85, 0.6, 0, 0.35, 2.8, M.stone);
    box(g, 1.4, 0.08, 0.45, 0, 1.2, 2.8, M.glass);
    sign(g, 'SCHEDULE & OPERATIONS', 4.4, 0.65, 0, 3.6, 2.5);
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(0, 0, 3.5);
    g.add(socket);
    return g;
  }

  // ==========================================
  // --- REAL ORACLE CORPORATE HEADQUARTERS (OPTION 2: SANDSTONE RIBBON FACADE) ---
  // ==========================================

  // Helper dựng trọn vẹn bộ chữ 3D nổi ORACLE màu đỏ đùn khối nhô ra khỏi tường, đổ bóng thật
  function create3DOracleLetters(targetGroup, posX, posY, posZ) {
    const lettersGroup = new T.Group();
    lettersGroup.name = 'oracle-3d-hero-letters';
    lettersGroup.userData.toggleKey = 'oracleSign';

    const redMat = new T.MeshStandardMaterial({
      color: 0xEA1B25,
      roughness: 0.28,
      metalness: 0.20,
      emissive: 0x3a0000,
      emissiveIntensity: 0.25
    });

    const extrudeSettings = {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.012,
      bevelSegments: 2
    };

    // Chữ O
    function makeO(w = 0.54, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      const r = 0.18;
      s.moveTo(r, 0);
      s.lineTo(w - r, 0);
      s.quadraticCurveTo(w, 0, w, r);
      s.lineTo(w, h - r);
      s.quadraticCurveTo(w, h, w - r, h);
      s.lineTo(r, h);
      s.quadraticCurveTo(0, h, 0, h - r);
      s.lineTo(0, r);
      s.quadraticCurveTo(0, 0, r, 0);

      const hole = new T.Path();
      const hr = Math.max(0.04, r - t * 0.7);
      hole.moveTo(t + hr, t);
      hole.lineTo(w - t - hr, t);
      hole.quadraticCurveTo(w - t, t, w - t, t + hr);
      hole.lineTo(w - t, h - t - hr);
      hole.quadraticCurveTo(w - t, h - t, w - t - hr, h - t);
      hole.lineTo(t + hr, h - t);
      hole.quadraticCurveTo(t, h - t, t, h - t - hr);
      hole.lineTo(t, t + hr);
      hole.quadraticCurveTo(t, t, t + hr, t);
      s.holes.push(hole);
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // Chữ R
    function makeR(w = 0.50, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      const r = 0.14;
      s.moveTo(0, 0);
      s.lineTo(t, 0);
      s.lineTo(t, h * 0.42);
      s.lineTo(w - t * 0.8, 0);
      s.lineTo(w, 0);
      s.lineTo(w * 0.58, h * 0.42);
      s.lineTo(w - r, h * 0.42);
      s.quadraticCurveTo(w, h * 0.42, w, h * 0.42 + r);
      s.lineTo(w, h - r);
      s.quadraticCurveTo(w, h, w - r, h);
      s.lineTo(0, h);
      s.closePath();

      const hole = new T.Path();
      const hr = 0.05;
      const holeBottom = h * 0.42 + t;
      const holeTop = h - t;
      hole.moveTo(t, holeBottom);
      hole.lineTo(w - t - hr, holeBottom);
      hole.quadraticCurveTo(w - t, holeBottom, w - t, holeBottom + hr);
      hole.lineTo(w - t, holeTop - hr);
      hole.quadraticCurveTo(w - t, holeTop, w - t - hr, holeTop);
      hole.lineTo(t, holeTop);
      hole.closePath();
      s.holes.push(hole);
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // Chữ A
    function makeA(w = 0.52, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      const hw = w * 0.5;
      const topW = 0.14;
      const htw = topW * 0.5;
      s.moveTo(0, 0);
      s.lineTo(t * 1.15, 0);
      s.lineTo(w * 0.26, h * 0.30);
      s.lineTo(w * 0.74, h * 0.30);
      s.lineTo(w - t * 1.15, 0);
      s.lineTo(w, 0);
      s.lineTo(hw + htw, h);
      s.lineTo(hw - htw, h);
      s.closePath();

      const hole = new T.Path();
      hole.moveTo(w * 0.31, h * 0.41);
      hole.lineTo(w * 0.69, h * 0.41);
      hole.lineTo(hw, h - t * 1.2);
      hole.closePath();
      s.holes.push(hole);
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // Chữ C
    function makeC(w = 0.50, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      const r = 0.18;
      const cut = 0.14;
      s.moveTo(w, h - cut);
      s.lineTo(w - t, h - cut);
      s.quadraticCurveTo(w - t, h - t, w - r, h - t);
      s.lineTo(r, h - t);
      s.quadraticCurveTo(t, h - t, t, h - r);
      s.lineTo(t, r);
      s.quadraticCurveTo(t, t, r, t);
      s.lineTo(w - r, t);
      s.quadraticCurveTo(w - t, t, w - t, cut);
      s.lineTo(w, cut);
      s.quadraticCurveTo(w, 0, w - r, 0);
      s.lineTo(r, 0);
      s.quadraticCurveTo(0, 0, 0, r);
      s.lineTo(0, h - r);
      s.quadraticCurveTo(0, h, r, h);
      s.lineTo(w - r, h);
      s.quadraticCurveTo(w, h, w, h - cut);
      s.closePath();
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // Chữ L
    function makeL(w = 0.42, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      s.moveTo(0, 0);
      s.lineTo(w, 0);
      s.lineTo(w, t);
      s.lineTo(t, t);
      s.lineTo(t, h);
      s.lineTo(0, h);
      s.closePath();
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    // Chữ E
    function makeE(w = 0.46, h = 0.62, t = 0.11) {
      const s = new T.Shape();
      const midW = w * 0.88;
      const midY = (h - t) * 0.5;
      s.moveTo(0, 0);
      s.lineTo(w, 0);
      s.lineTo(w, t);
      s.lineTo(t, t);
      s.lineTo(t, midY);
      s.lineTo(midW, midY);
      s.lineTo(midW, midY + t);
      s.lineTo(t, midY + t);
      s.lineTo(t, h - t);
      s.lineTo(w, h - t);
      s.lineTo(w, h);
      s.lineTo(0, h);
      s.closePath();
      return new T.ExtrudeGeometry(s, extrudeSettings);
    }

    const letterDefs = [
      { geom: makeO(0.54, 0.62, 0.11), width: 0.54 },
      { geom: makeR(0.50, 0.62, 0.11), width: 0.50 },
      { geom: makeA(0.52, 0.62, 0.11), width: 0.52 },
      { geom: makeC(0.50, 0.62, 0.11), width: 0.50 },
      { geom: makeL(0.42, 0.62, 0.11), width: 0.42 },
      { geom: makeE(0.46, 0.62, 0.11), width: 0.46 }
    ];

    const spacing = 0.10;
    let curX = 0;
    for (const item of letterDefs) {
      const mesh = new T.Mesh(item.geom, redMat);
      mesh.position.set(curX, 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      lettersGroup.add(mesh);
      curX += item.width + spacing;
    }

    lettersGroup.position.set(posX, posY, posZ);
    targetGroup.add(lettersGroup);
  }


  function oracleCloudBuilding() {
    const g = new T.Group();
    g.name = 'oracle-corporate-sandstone-ribbon-campus';

    // 1. Plinth & Forecourt Plaza (Nền móng đá kiên cố & vỉa hè: 13.0m x 10.4m)
    box(g, 13.0, 0.35, 10.4, 0, 0, -0.2, M.stone);
    box(g, 12.4, 0.08, 9.8, 0, 0.35, -0.2, M.walk);

    // Dải hàng rào cây bụi Shrub Hedges chuẩn dự án AN PHIM (Thay thế hàng cây chậu tròn cũ theo đúng ảnh mẫu của Sếp)
    const treesG = new T.Group();
    treesG.userData.toggleKey = 'trees';

    // Dải hàng rào cây bụi Shrub Hedge chạy dọc theo hàng cột mặt tiền bên phải (X: -0.55 -> 4.85, Dài 5.4m)
    const shrubHedge = createShrubHedgeRow({ length: 5.4, height: 0.88, depth: 0.62 });
    shrubHedge.position.set(2.15, 0.35, 4.22);
    treesG.add(shrubHedge);

    // Cột đèn chiếu sáng công viên màu đen ở hai góc lối đi (Khớp chuẩn vị trí sếp đã tinh chỉnh)
    for (const lx of [-5.82, 5.90]) {
      cylinder(treesG, 0.05, 2.2, lx, 0.35, 4.25, M.dark, 8);
      box(treesG, 0.35, 0.08, 0.15, lx, 2.50, 4.25, M.dark);
    }
    g.add(treesG);

    // 2. KHỐI THÂN NHÀ CHÍNH 3 TẦNG (Lùi độ sâu về sau theo yêu cầu của Sếp: Sâu 8.2m, Z = -0.66)
    box(g, 12.2, 6.6, 8.2, 0, 0.35, -0.66, M.cream);

    // 3. KHỐI MẶT TIỀN TRUNG TÂM BÊ TÔNG SA THẠCH 3 TẦNG (Lùi về Z = 3.44m, cách xa hàng cây 0.23m)
    // TẦNG 1: Hệ cột trụ bê tông đứng (Colonnade Piers) cao 1.95m
    box(g, 9.2, 1.95, 0.10, 0, 0.35, 3.32, M.glass); // Kính nền tầng 1 thụt vào
    for (let x = -4.4; x <= 4.4; x += 1.1) {
      box(g, 0.36, 1.95, 0.32, x, 0.35, 3.44, M.cream); // Cột sa thạch tầng 1
    }

    // TẦNG 2 & 3: CÁC DẢI BĂNG KÍNH NGANG (Ribbon Windows Tầng 2 & Tầng 3)
    const ribbonWindowsG = new T.Group();
    ribbonWindowsG.userData.toggleKey = 'ribbonWindows';
    // TẦNG 2:
    box(ribbonWindowsG, 9.2, 0.65, 0.30, 0, 2.30, 3.44, M.cream); // Tường đai tầng 2
    box(ribbonWindowsG, 9.0, 1.05, 0.12, 0, 2.95, 3.42, M.glass); // Dải kính băng ngang tầng 2
    for (let x = -4.2; x <= 4.2; x += 0.75) {
      box(ribbonWindowsG, 0.05, 1.05, 0.16, x, 2.95, 3.44, M.dark); // Nan kính chia ô nhỏ
    }
    // TẦNG 3:
    box(ribbonWindowsG, 9.2, 0.65, 0.30, 0, 4.00, 3.44, M.cream); // Tường đai tầng 3
    box(ribbonWindowsG, 9.0, 1.05, 0.12, 0, 4.65, 3.42, M.glass); // Dải kính băng ngang tầng 3
    for (let x = -4.2; x <= 4.2; x += 0.75) {
      box(ribbonWindowsG, 0.05, 1.05, 0.16, x, 4.65, 3.44, M.dark);
    }
    g.add(ribbonWindowsG);

    // TRÁN TƯỜNG TRÊN CÙNG BÊ TÔNG SA THẠCH (Parapet Fascia: Y = 5.70 -> 6.95m, cao 1.25m)
    box(g, 9.2, 1.25, 0.32, 0, 5.70, 3.44, M.cream);

    // 4. CHỮ THƯƠNG HIỆU "ORACLE" 3D NỔI MÀU ĐỎ NỔI BẬT Ở GÓC PHẢI (Hero 3D Extruded Red Letters)
    // Bộ chữ nổi 3D đùn khối nhô ra khỏi tường, đổ bóng thật
    create3DOracleLetters(g, 0.85, 6.00, 3.61);

    // 5. HAI CÁNH KÍNH HAI BÊN ĐẦU HỒI (Full Glass Curtain Wall Wings: Trái & Phải - Lùi theo độ sâu 8.2m)
    // Cánh trái (X: -6.1 -> -4.6, Rộng 1.5m)
    box(g, 1.5, 6.6, 8.2, -5.35, 0.35, -0.66, M.glass);
    for (let f = 0; f <= 3; f++) {
      const fy = 0.35 + f * 1.95;
      box(g, 1.55, 0.16, 8.25, -5.35, fy, -0.66, M.white); // Dải spandrel trắng ngang cánh trái
      box(g, 1.56, 0.06, 8.26, -5.35, fy + 0.05, -0.66, M.dark);
    }

    // Cánh phải (X: 4.6 -> 6.1, Rộng 1.5m)
    box(g, 1.5, 6.6, 8.2, 5.35, 0.35, -0.66, M.glass);
    for (let f = 0; f <= 3; f++) {
      const fy = 0.35 + f * 1.95;
      box(g, 1.55, 0.16, 8.25, 5.35, fy, -0.66, M.white); // Dải spandrel trắng ngang cánh phải
      box(g, 1.56, 0.06, 8.26, 5.35, fy + 0.05, -0.66, M.dark);
    }

    // 6. CỔNG SẢNH ĐÓN KHÁCH (Entrance Canopy & Door Trim - Lùi hài hòa với mặt tiền)
    const canopyG = new T.Group();
    canopyG.userData.toggleKey = 'canopy';
    // Mái che sảnh đón màu cam AN PHIM rực rỡ
    box(canopyG, 2.6, 0.18, 1.1, -3.2, 2.15, 3.85, M.orange);
    box(canopyG, 2.65, 0.06, 1.15, -3.2, 2.33, 3.85, M.orange);
    // Khung viền cửa sảnh đón màu cam
    box(canopyG, 2.3, 0.08, 0.12, -3.2, 2.08, 3.48, M.orange);
    box(canopyG, 0.08, 1.75, 0.12, -4.3, 0.35, 3.48, M.orange);
    box(canopyG, 0.08, 1.75, 0.12, -2.1, 0.35, 3.48, M.orange);
    windows(canopyG, 2.1, 1.72, 0.10, -3.2, 0.35, 3.46, 1, 2);
    box(canopyG, 2.8, 0.12, 0.6, -3.2, 0.12, 3.85, M.stone);
    g.add(canopyG);

    // 7. TẦNG MÁI PHẲNG & TRẦN MÁI MÀU CAM (Roof Parapet & Soffit Deck - Sâu 8.3m, Z = -0.66)
    box(g, 12.3, 0.30, 8.3, 0, 6.95, -0.66, M.cream);

    // Diềm trần & mặt phẳng trần sàn mái màu cam AN PHIM rực rỡ
    const orangeRoofG = new T.Group();
    orangeRoofG.userData.toggleKey = 'orangeRoof';
    box(orangeRoofG, 12.4, 0.10, 8.4, 0, 7.25, -0.66, M.orange);
    box(orangeRoofG, 12.2, 0.04, 8.2, 0, 7.33, -0.66, M.orange);
    g.add(orangeRoofG);

    // Khối kỹ thuật giật cấp nhô cao phía sau mái (Penthouse Y = 6.95 -> 7.55m)
    const penthouseG = new T.Group();
    penthouseG.userData.toggleKey = 'penthouse';
    box(penthouseG, 8.4, 0.60, 4.8, 0, 6.95, -1.9, M.cream);
    box(penthouseG, 8.5, 0.08, 4.9, 0, 7.55, -1.9, M.orange);
    // Cụm điều hòa HVAC
    box(penthouseG, 2.4, 0.80, 1.6, -1.8, 7.63, -1.9, M.metal);
    cylinder(penthouseG, 0.40, 0.10, -2.4, 8.45, -1.9, M.dark, 16);
    cylinder(penthouseG, 0.40, 0.10, -1.2, 8.45, -1.9, M.dark, 16);
    g.add(penthouseG);

    // Sân mái trước khối kỹ thuật: lan can kem, dàn pin mặt trời và bồn cây (mái trong ảnh tham chiếu không để trống).
    // Thêm sau cùng: partId của Studio đánh theo thứ tự mesh, chi tiết mới không được chen vào giữa.
    const roofDeckG = new T.Group();
    roofDeckG.userData.toggleKey = 'roofEquipment';
    box(roofDeckG, 12.4, 0.32, 0.16, 0, 7.37, 3.46, M.cream);
    for (const x of [-6.12, 6.12]) box(roofDeckG, 0.16, 0.32, 8.4, x, 7.37, -0.66, M.cream);
    roofKitbash(roofDeckG, 12.2, 8.2, 7.33, {
      solarCount: 3, solarStartX: -4.4, solarZ: 2.0,
      hvac: false,
      planter: true, planterX: 3.9, planterZ: 2.1
    });
    g.add(roofDeckG);

    // Socket vị trí nhân vật bước vào sảnh
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(-3.2, 0, 4.3);
    g.add(socket);

    return g;
  }

  // ==========================================
  // --- SILICON VALLEY TECH CAMPUS / META REPOSITORY ---
  // ==========================================
  function databaseBuilding() {
    const g = new T.Group();
    g.name = 'silicon-valley-meta-tech-campus';

    // 1. Forecourt Plinth & Landscaped Plaza (Nền móng đá & Sân đi bộ: 10.4m x 8.6m)
    box(g, 10.4, 0.30, 8.6, 0, 0, -0.2, M.stone);
    box(g, 9.8, 0.08, 8.0, 0, 0.30, -0.2, M.walk);

    // Hàng cột trụ an ninh bảo vệ (Security Bollards) dọc lối vào phía trước
    const bollardsG = new T.Group();
    bollardsG.userData.toggleKey = 'bollards';
    for (let x = -4.2; x <= 4.2; x += 0.95) {
      cylinder(bollardsG, 0.05, 0.55, x, 0.38, 4.0, M.metal, 12);
    }
    // Hai bồn cây xanh tiểu cảnh hai bên lối vào
    box(bollardsG, 1.2, 0.25, 1.2, -4.4, 0.38, 3.3, M.stone);
    cylinder(bollardsG, 0.35, 0.75, -4.4, 0.63, 3.3, M.moss, 12);
    box(bollardsG, 1.2, 0.25, 1.2, 4.4, 0.38, 3.3, M.stone);
    cylinder(bollardsG, 0.35, 0.75, 4.4, 0.63, 3.3, M.moss, 12);
    g.add(bollardsG);

    // 2. Khối Thân Nhà Chính 4 Tầng Hiện Đại (Main Body: Rộng 9.6m x Cao 7.5m x Sâu 7.2m)
    box(g, 9.6, 7.5, 7.2, 0, 0.35, -0.4, M.cream);

    // 3. CÁNH TRÁI & TRUNG TÂM: MẶT DỰNG VÁCH KÍNH TRÀN VIỀN (Full Curtain Wall Facade)
    const curtainG = new T.Group();
    curtainG.userData.toggleKey = 'curtainWall';
    // Tấm kính lớn nguyên khối trong suốt mặt trước (X: -4.8 -> 0.6, Rộng 5.4m, Cao 7.5m)
    box(curtainG, 5.4, 7.5, 0.08, -2.1, 0.35, 3.22, M.glass);
    // Tấm kính bên hông trái
    box(curtainG, 0.08, 7.5, 7.2, -4.8, 0.35, -0.4, M.glass);

    // Lưới nan nhôm đứng (Vertical Mullions) màu kim loại sẫm sắc sảo
    for (let x = -4.8; x <= 0.65; x += 0.9) {
      box(curtainG, 0.06, 7.5, 0.12, x, 0.35, 3.24, M.dark);
    }
    // Nan nhôm bên hông trái
    for (let z = -3.8; z <= 3.0; z += 1.1) {
      box(curtainG, 0.12, 7.5, 0.06, -4.82, 0.35, z, M.dark);
    }

    // Dầm sàn ngang chia 4 tầng (Floor Transoms & Slabs) lộ sau lớp kính
    for (let f = 1; f <= 3; f++) {
      const fy = 0.35 + f * 1.88;
      box(curtainG, 5.4, 0.14, 0.14, -2.1, fy, 3.24, M.dark);
      box(curtainG, 0.14, 0.14, 7.2, -4.82, fy, -0.4, M.dark);
      // Sàn bê tông ẩn hiện sau kính
      box(curtainG, 5.2, 0.10, 7.0, -2.1, fy - 0.05, -0.4, M.stone);
    }
    g.add(curtainG);

    // 4. BIỂU TƯỢNG LOGO 3D SUPABASE NỔI BẬT (Hero 3D Supabase Emerald Bolt Symbol)
    // Gắn nổi bật ngay giữa mặt tiền vách kính ở cao độ tầng 2-3 (y = 4.4m, z = 3.35m)
    const logoGroup = new T.Group();
    logoGroup.name = 'hero-3d-supabase-logo';
    logoGroup.userData.toggleKey = 'supabaseLogo';

    // Mảnh trái (Upper-left emerald shard)
    const s1 = new T.Shape();
    s1.moveTo(0.04, 0.95);
    s1.lineTo(-0.75, -0.05);
    s1.lineTo(-0.75, -0.36);
    s1.lineTo(-0.08, -0.36);
    s1.lineTo(0.04, -0.16);
    s1.closePath();
    const g1 = new T.ExtrudeGeometry(s1, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 });
    const meshL = new T.Mesh(g1, M.supabaseGreen);
    meshL.castShadow = true;
    logoGroup.add(meshL);

    // Mảnh phải (Lower-right dark emerald shard - đối xứng qua tâm và trượt nhẹ)
    const s2 = new T.Shape();
    s2.moveTo(-0.04, -0.95);
    s2.lineTo(0.75, 0.05);
    s2.lineTo(0.75, 0.36);
    s2.lineTo(0.08, 0.36);
    s2.lineTo(-0.04, 0.16);
    s2.closePath();
    const g2 = new T.ExtrudeGeometry(s2, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 });
    const meshR = new T.Mesh(g2, M.supabaseDark);
    meshR.castShadow = true;
    logoGroup.add(meshR);

    logoGroup.position.set(-2.1, 4.4, 3.34);
    g.add(logoGroup);

    // 5. CÁNH PHẢI: KHỐI VĂN PHÒNG BÊ TÔNG HIỆN ĐẠI (Punched Concrete Wing)
    // 4 tầng cửa sổ kính băng ngang hình chữ nhật chia ô (X: 0.6 -> 4.8)
    for (let f = 0; f < 4; f++) {
      const fy = 0.35 + f * 1.88;
      // Cửa sổ mặt trước
      recessedWindows(g, 3.6, 1.25, 0.12, 2.7, fy + 0.94, 3.22, 1, 3, { depth: 0.18 });
      // Cửa sổ mặt bên phải (X = 4.8)
      recessedWindows(g, 5.6, 1.25, 0.12, 4.82, fy + 0.94, -0.4, 1, 4, { depth: 0.18, axis: 'z' });
    }

    // 6. CỔNG SẢNH ĐÓN NHÔ RA PHÍA TRƯỚC (Cantilevered Entrance Portal)
    const portalG = new T.Group();
    portalG.userData.toggleKey = 'portal';
    // Khung cổng màu trắng thanh lịch nhô ra phía trước (Z = 3.6m)
    box(portalG, 2.8, 2.25, 0.85, -2.1, 0.35, 3.65, M.white);
    // Hốc cửa kính 2 cánh khung nhôm tối màu
    windows(portalG, 2.2, 1.95, 0.10, -2.1, 0.35, 4.02, 1, 2);
    // Bậc tam cấp đá đón khách
    box(portalG, 3.4, 0.12, 0.65, -2.1, 0.12, 4.35, M.stone);
    box(portalG, 3.2, 0.12, 0.65, -2.1, 0, 4.75, M.stone);
    g.add(portalG);

    // 7. TẦNG MÁI PHẲNG HIỆN ĐẠI (Modern Minimalist Parapet Roof)
    box(g, 9.8, 0.45, 7.4, 0, 7.85, -0.4, M.cream);
    box(g, 9.9, 0.08, 7.5, 0, 8.28, -0.4, M.white);
    box(g, 9.4, 0.04, 7.0, 0, 7.90, -0.4, M.roofDark); // Sàn mái phẳng

    // Cụm điều hòa công nghiệp HVAC giấu gọn trên mái
    const roofG = new T.Group();
    roofG.userData.toggleKey = 'roofEquipment';
    box(roofG, 2.2, 0.85, 1.6, 2.0, 7.94, -1.6, M.metal);
    cylinder(roofG, 0.38, 0.10, 1.5, 8.80, -1.6, M.dark, 16);
    cylinder(roofG, 0.38, 0.10, 2.5, 8.80, -1.6, M.dark, 16);
    // Dàn pin mặt trời, giếng trời kính và bồn cây mái
    roofKitbash(roofG, 9.4, 7.0, 8.30, {
      solarCount: 2, solarStartX: -3.2, solarZ: -1.7,
      hvac: false,
      planter: true, planterX: -2.6, planterZ: 1.7
    });
    box(roofG, 2.6, 0.22, 1.8, 2.0, 8.36, 1.5, M.stone);
    box(roofG, 2.3, 0.16, 1.5, 2.0, 8.54, 1.5, M.glass);
    box(roofG, 0.08, 0.2, 1.5, 2.0, 8.54, 1.5, M.cream);
    g.add(roofG);

    // Socket vị trí nhân vật bước vào sảnh
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(-2.1, 0, 5.2);
    g.add(socket);

    return g;
  }

  function googleCloudBuilding() {
    const g = new T.Group();
    g.name = 'google-cloud-edge-node';
    box(g, 6.8, 0.35, 5.8, 0, 0, 0, M.stone);
    box(g, 6.0, 3.4, 5.0, 0, 0.35, -0.2, M.cream);
    windows(g, 5.2, 2.6, 0.1, 0, 0.7, 2.32, 2, 4);
    windows(g, 0.1, 2.6, 4.2, 3.02, 0.7, -0.2, 2, 3);
    box(g, 6.6, 0.22, 5.6, 0, 3.75, -0.1, M.cream);
    box(g, 6.75, 0.06, 5.75, 0, 3.93, -0.1, M.orange);
    box(g, 6.4, 0.12, 5.4, 0, 3.97, -0.1, M.moss);
    box(g, 2.6, 0.18, 1.4, 0, 2.4, 2.8, M.orange);
    for (const x of [-1.1, 1.1]) box(g, 0.12, 2.05, 0.12, x, 0.35, 3.3, M.metal);
    sign(g, 'GOOGLE CLOUD', 2.6, 0.5, 0, 2.8, 2.8);
    cylinder(g, 0.5, 0.6, 1.2, 4.09, -1.0, M.metal, 12);
    const socket = new T.Object3D();
    socket.name = 'entry-socket';
    socket.position.set(0, 0, 3.6);
    g.add(socket);
    return g;
  }

  return {
    HQ,
    department,
    bankBuilding,
    telegramTower,
    hermesLab,
    vaultBuilding,
    officeBuilding,
    scheduleKiosk,
    oracleCloudBuilding,
    databaseBuilding,
    googleCloudBuilding,
    fit,
    M,
    box,
    sign,
    cylinder,
    beam,
    windows,
    apronPad,
    stylizedShell,
    recessedWindows,
    roofKitbash
  };
}
