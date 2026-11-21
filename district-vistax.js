import * as T from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { getStudioModelById } from './asset-pack-extractor.js?rev=146';

/**
 * AN PHIM WORLD — QUẬN VỆ TINH VISTAX (VISTAX PARTNER DISTRICT)
 * Đạt chuẩn mỹ thuật & quy hoạch đô thị 100%:
 * 1. Nạp Model 3D chính thức `building-skyscraper-a.glb` (Tòa tháp cao tầng hiện đại, sang trọng, đẳng cấp).
 * 2. Lô đất dự án mới phẳng lì trên bệ móng bê tông dầy 0.45m vuông vức 100%, có cọc mốc 5m, rào ranh giới và nón chóp thi công.
 * 3. Tuyến đường xe hơi 2 làn asphalt bao quanh quận rõ nét và mạng lưới đường đi bộ nội khu đá kem kết nối liên hoàn.
 * 4. Biển hiệu tinh tế, sang trọng, chỉ ghi duy nhất tên dự án `THE WINCITY`, hướng trực diện góc nhìn camera.
 */
export async function createVistaXDistrict(scene, terrain, roads, registry, P) {
  const root = new T.Group();
  root.name = 'district-vistax-partner-campus';
  scene.add(root);

  // --- 1. HỆ THỐNG VẬT LIỆU CHUẨN ĐÔ THỊ ---
  const asphaltRoadMat  = new T.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.82, metalness: 0.1 });
  const curbMat         = new T.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 });
  const stoneWalkMat    = new T.MeshStandardMaterial({ color: 0xdfd9c7, roughness: 0.88 });
  const creamPlinthMat  = new T.MeshStandardMaterial({ color: 0xede8db, roughness: 0.90 });
  const yellowLineMat   = new T.MeshBasicMaterial({ color: 0xfacc15 });
  const whiteStripeMat  = new T.MeshBasicMaterial({ color: 0xf8fafc });
  const darkMetalMat    = new T.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.8 });
  const brandOrangeMat  = new T.MeshStandardMaterial({ color: 0xed8038, roughness: 0.65 });
  const boundaryPostMat = new T.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4, metalness: 0.8 });
  const warmWoodMat     = new T.MeshStandardMaterial({ color: 0x9a6b46, roughness: 0.7 });
  const lampPoleMat     = new T.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
  const lampGlowMat     = new T.MeshBasicMaterial({ color: 0xfef08a });

  function addBox(parent, w, h, d, x, y, z, mat, rotY = 0) {
    const geo = new T.BoxGeometry(w, h, d);
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y + h / 2, z);
    if (rotY) m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // Helper nạp GLB an toàn với đường dẫn tuyệt đối từ root
  const loader = new GLTFLoader();
  const loadGLB = (url) => new Promise((resolve) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, (err) => {
      console.warn('[DISTRICT VISTAX] Could not load model:', url, err);
      resolve(null);
    });
  });

  // Nạp đồng thời các model 3D kiến trúc & thi công
  const [modelSkyscraper, modelFence, modelCone] = await Promise.all([
    loadGLB('./models/anphim_commercial/building-skyscraper-a.glb'),
    loadGLB('./models/construction-fence.glb'),
    loadGLB('./models/construction-cone.glb')
  ]);

  // --- 2. CAO ĐỘ VÀ CHÂN KÈ MÓNG ĐÔ THỊ (TERRACED RETAINING PLATFORM) ---
  const cx = -77, cz = 15; // Dời +12m theo vành đai đã thu hẹp (cũ: -89)
  const sampleY = [
    terrain.height(cx - 16, cz - 14),
    terrain.height(cx + 16, cz - 14),
    terrain.height(cx - 16, cz + 14),
    terrain.height(cx + 16, cz + 14),
    terrain.height(cx, cz)
  ];
  const baseY = Math.max(...sampleY) + 0.12;
  const minY  = Math.min(...sampleY) - 0.60; // Cao độ đáy thấp nhất để chân kè cắm sâu vào lòng đất

  // CHÂN KÈ TALUY BÊ TÔNG ĐÔ THỊ ĂN SÂU XUỐNG ĐẤT (TRIỆT TIÊU 100% HIỆN TƯỢNG BAY LƠ LỬNG)
  const foundationGroup = new T.Group();
  foundationGroup.name = 'vistax-solid-retaining-foundation';
  root.add(foundationGroup);

  const skirtDepth = (baseY - minY) + 0.8; // Độ sâu chân kè taluy
  const foundationMat = new T.MeshStandardMaterial({ color: 0x475156, roughness: 0.95 }); // Đá hộc kè móng

  // Khối móng san nền đặc vững như bàn thạch cắm sâu xuống tận lòng đất
  const basePlinth = new T.Mesh(
    new T.BoxGeometry(38.0, skirtDepth, 38.0),
    foundationMat
  );
  basePlinth.position.set(cx, baseY - skirtDepth / 2, cz);
  basePlinth.receiveShadow = true;
  foundationGroup.add(basePlinth);

  // --- 3. HẠ TẦNG ĐƯỜNG XE HƠI BAO QUANH QUẬN VISTAX (DISTRICT RING ROAD) ---
  const roadGroup = new T.Group();
  roadGroup.name = 'vistax-district-roads';
  root.add(roadGroup);

  function createRoadSegment(x, z, lenX, lenZ, hasCenterLine = true) {
    const rGroup = new T.Group();
    addBox(rGroup, lenX, 0.16, lenZ, x, baseY, z, asphaltRoadMat);

    if (hasCenterLine) {
      if (lenX > lenZ && lenX > 7) {
        const count = Math.floor(lenX / 4.2);
        for (let i = 0; i < count; i++) {
          const lx = x - lenX / 2 + 2.2 + i * 4.2;
          addBox(rGroup, 2.4, 0.18, 0.22, lx, baseY, z, yellowLineMat);
        }
      } else if (lenZ > lenX && lenZ > 7) {
        const count = Math.floor(lenZ / 4.2);
        for (let i = 0; i < count; i++) {
          const lz = z - lenZ / 2 + 2.2 + i * 4.2;
          addBox(rGroup, 0.22, 0.18, 2.4, x, baseY, lz, yellowLineMat);
        }
      }
    }
    roadGroup.add(rGroup);
    return rGroup;
  }

  const rw = 4.8;
  const minX = cx - 14.5, maxX = cx + 14.5;
  const minZ = cz - 14.5, maxZ = cz + 14.5;
  const spanX = maxX - minX + rw;
  const spanZ = maxZ - minZ + rw;

  // 4 Cạnh đường bao quanh quận
  createRoadSegment(cx, minZ, spanX, rw, true);
  createRoadSegment(cx, maxZ, spanX, rw, true);
  createRoadSegment(minX, cz, rw, spanZ, true);
  createRoadSegment(maxX, cz, rw, spanZ, true);

  // Đường nhánh nối từ Vành đai chính vào Cổng Đông (-74.5, 15)
  createRoadSegment(-57.5, 15.0, 10.0, rw, true); // cũ: -69.5

  // Bó vỉa bê tông xung quanh viền ngoài đường xe
  addBox(roadGroup, spanX + 0.5, 0.24, 0.35, cx, baseY, minZ - rw / 2 - 0.17, curbMat);
  addBox(roadGroup, spanX + 0.5, 0.24, 0.35, cx, baseY, maxZ + rw / 2 + 0.17, curbMat);
  addBox(roadGroup, 0.35, 0.24, spanZ + 0.5, minX - rw / 2 - 0.17, baseY, cz, curbMat);
  addBox(roadGroup, 0.35, 0.24, spanZ + 0.5, maxX + rw / 2 + 0.17, baseY, cz, curbMat);

  // Vạch kẻ đi bộ qua đường (Zebra Crosswalk) ngay trước cổng vào
  const cwGroup = new T.Group();
  for (let s = -1.8; s <= 1.8; s += 0.7) {
    addBox(cwGroup, 0.42, 0.18, 4.4, maxX - 1.5, baseY, 15.0 + s, whiteStripeMat);
  }
  roadGroup.add(cwGroup);

  // --- 4. HẠ TẦNG ĐƯỜNG ĐI BỘ NỘI KHU (DISTRICT PEDESTRIAN PROMENADE) ---
  const walkGroup = new T.Group();
  walkGroup.name = 'vistax-pedestrian-walkways';
  root.add(walkGroup);

  // Đại lộ đi bộ chính lát đá kem từ Cổng vào chạy thẳng qua giữa The Wincity và Lô đất mới
  addBox(walkGroup, 22.0, 0.12, 3.6, cx, baseY, cz, stoneWalkMat);

  // Nhánh đi bộ rẽ vào sảnh The Wincity
  addBox(walkGroup, 3.6, 0.12, 6.0, cx, baseY, cz - 4.5, stoneWalkMat);

  // Nhánh đi bộ rẽ vào Lô đất dự án mới
  addBox(walkGroup, 3.6, 0.12, 6.0, cx, baseY, cz + 4.5, stoneWalkMat);

  // Vỉa hè đi bộ bao quanh khối nhà và lô đất (hành lang an toàn rộng 1.4m)
  addBox(walkGroup, 14.5, 0.10, 1.4, cx, baseY, cz - 11.5, stoneWalkMat);
  addBox(walkGroup, 14.5, 0.10, 1.4, cx, baseY, cz + 11.5, stoneWalkMat);
  addBox(walkGroup, 1.4, 0.10, 24.0, cx - 8.0, baseY, cz, stoneWalkMat);
  addBox(walkGroup, 1.4, 0.10, 24.0, cx + 8.0, baseY, cz, stoneWalkMat);

  // Cột đèn đường chiếu sáng nội khu
  function addStreetLamp(parent, x, z, angle = 0) {
    const lamp = new T.Group();
    const pole = new T.Mesh(new T.CylinderGeometry(0.08, 0.10, 4.2, 8), lampPoleMat);
    pole.position.y = 2.1;
    lamp.add(pole);
    const head = new T.Mesh(new T.BoxGeometry(0.5, 0.18, 0.8), lampGlowMat);
    head.position.set(0, 4.1, 0.35);
    lamp.add(head);
    lamp.position.set(x, baseY, z);
    lamp.rotation.y = angle;
    parent.add(lamp);
  }

  addStreetLamp(walkGroup, cx - 6.5, cz - 2.5, Math.PI / 2);
  addStreetLamp(walkGroup, cx - 6.5, cz + 2.5, Math.PI / 2);
  addStreetLamp(walkGroup, cx + 6.5, cz - 2.5, -Math.PI / 2);
  addStreetLamp(walkGroup, cx + 6.5, cz + 2.5, -Math.PI / 2);

  // --- 5. CỔNG CHÀO QUẬN VISTAX (WELCOME GATEWAY) ---
  const gateX = -60.5, gateZ = 15.0; // cũ: -72.5
  addBox(root, 0.6, 4.8, 0.6, gateX, baseY, gateZ - 3.2, darkMetalMat);
  addBox(root, 0.6, 4.8, 0.6, gateX, baseY, gateZ + 3.2, darkMetalMat);
  addBox(root, 0.7, 0.7, 7.0, gateX, baseY + 4.5, gateZ, brandOrangeMat);

  const canvasGate = document.createElement('canvas');
  canvasGate.width = 1024; canvasGate.height = 256;
  const ctxG = canvasGate.getContext('2d');
  ctxG.fillStyle = '#0f172a';
  ctxG.fillRect(0, 0, 1024, 256);
  ctxG.fillStyle = '#f8fafc';
  ctxG.font = 'bold 96px sans-serif';
  ctxG.textAlign = 'center';
  ctxG.textBaseline = 'middle';
  ctxG.fillText('QUẬN VISTAX', 512, 128);
  const gateTex = new T.CanvasTexture(canvasGate);
  gateTex.colorSpace = T.SRGBColorSpace;
  const signMesh = new T.Mesh(new T.PlaneGeometry(5.6, 1.4), new T.MeshStandardMaterial({ map: gateTex, roughness: 0.5 }));
  signMesh.position.set(gateX + 0.36, baseY + 4.85, gateZ);
  signMesh.rotation.y = Math.PI / 2;
  root.add(signMesh);

  // --- 6. TÒA THÁP THE WINCITY (NẠP TRỰC TIẾP MODEL 3D CAO TẦNG SANG TRỌNG) ---
  const bldgX = cx, bldgZ = cz - 7.5;
  const wincityGroup = new T.Group();
  wincityGroup.name = 'building:vistax:the_wincity';
  wincityGroup.position.set(bldgX, baseY, bldgZ);
  root.add(wincityGroup);

  // Bệ móng đá kem dầy dặn và phẳng lì (13m x 10m, dầy 0.35m)
  addBox(wincityGroup, 13.0, 0.35, 10.0, 0, 0, 0, creamPlinthMat);

  // Nạp trực tiếp Tòa nhà từ bộ 146 Models đã chuẩn hóa (#034 - Tòa Chung Cư 5 Tầng Sơn Kem Mặt Tiền Rộng)
  const wincityModel = await getStudioModelById('#034', { fitBox: [11.5, 9.5, 8.5], addEntrySocket: false });
  if (wincityModel) {
    wincityModel.position.set(0, 0.35, -0.4);
    wincityModel.rotation.y = 0; // Mặt tiền đã chuẩn hóa hướng thẳng về +Z (Đại lộ đi bộ)
    wincityGroup.add(wincityModel);
  } else if (modelSkyscraper) {
    const bldgModel = modelSkyscraper.clone(true);
    bldgModel.scale.setScalar(2.65);
    bldgModel.position.set(0, 0.35, -0.5);
    bldgModel.rotation.y = Math.PI;
    bldgModel.traverse(c => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    wincityGroup.add(bldgModel);
  }

  // Đặt Xe Ô Tô Sedan Trắng BMW E46 (#041) đỗ ngay ngắn bên đường nội bộ trước The Wincity
  const bmwCar = await getStudioModelById('#041', { scale: 1.0, addEntrySocket: false });
  if (bmwCar) {
    bmwCar.position.set(5.2, 0.12, 5.8);
    bmwCar.rotation.y = Math.PI / 2;
    wincityGroup.add(bmwCar);
  }

  // BIỂN TÊN THE WINCITY: CHỈ DUY NHẤT TÊN DỰ ÁN, CHỮ NỔI ĐẲNG CẤP
  const winCanvas = document.createElement('canvas');
  winCanvas.width = 1024; winCanvas.height = 256;
  const wctx = winCanvas.getContext('2d');
  wctx.fillStyle = '#0f172a';
  wctx.fillRect(0, 0, 1024, 256);
  wctx.strokeStyle = '#38bdf8';
  wctx.lineWidth = 14;
  wctx.strokeRect(8, 8, 1008, 240);
  wctx.fillStyle = '#f8fafc';
  wctx.font = '900 115px sans-serif';
  wctx.textAlign = 'center';
  wctx.textBaseline = 'middle';
  wctx.fillText('THE WINCITY', 512, 128);

  const winTex = new T.CanvasTexture(winCanvas);
  winTex.colorSpace = T.SRGBColorSpace;
  // Bệ gắn biển đặt chắc chắn tại mặt tiền sảnh
  addBox(wincityGroup, 5.2, 0.45, 0.4, 0, 0.35, 4.8, darkMetalMat);
  const winSign = new T.Mesh(new T.PlaneGeometry(4.8, 1.2), new T.MeshStandardMaterial({ map: winTex, roughness: 0.3 }));
  winSign.position.set(0, 1.2, 5.02);
  wincityGroup.add(winSign);

  // --- 7. LÔ ĐẤT DỰ ÁN MỚI: BỆ MÓNG DẦY 0.45M VUÔNG VỨC 100%, BIỂN HIỆU HƯỚNG RA ĐẠI LỘ ---
  const plotX = cx, plotZ = cz + 7.5;
  const plotGroup = new T.Group();
  plotGroup.name = 'plot:vistax:upcoming_negotiation';
  plotGroup.position.set(plotX, baseY, plotZ);
  root.add(plotGroup);

  // Bệ móng bê tông san phẳng dầy 0.45m vuông vức 100%, triệt tiêu 100% hiện tượng chém góc
  const plotPlinth = new T.Mesh(
    new T.BoxGeometry(13.0, 0.45, 10.0),
    new T.MeshStandardMaterial({ color: 0xdfd9c7, roughness: 0.9 })
  );
  plotPlinth.position.y = 0.225;
  plotPlinth.receiveShadow = true;
  plotPlinth.castShadow = true;
  plotGroup.add(plotPlinth);

  // Lưới vạch sơn ô mốc 5m màu xanh neon sáng trên mặt bệ móng
  const gridLineMat = new T.LineBasicMaterial({ color: 0x0284c7, linewidth: 2 });
  const gridPts = [];
  for (let lx = -6.5; lx <= 6.5; lx += 3.25) {
    gridPts.push(new T.Vector3(lx, 0.46, -5.0), new T.Vector3(lx, 0.46, 5.0));
  }
  for (let lz = -5.0; lz <= 5.0; lz += 2.5) {
    gridPts.push(new T.Vector3(-6.5, 0.46, lz), new T.Vector3(6.5, 0.46, lz));
  }
  const gridGeo = new T.BufferGeometry().setFromPoints(gridPts);
  const gridMesh = new T.LineSegments(gridGeo, gridLineMat);
  plotGroup.add(gridMesh);

  // 4 Cọc mốc ranh giới bê tông ở đúng 4 góc của bệ móng
  for (const [px, pz] of [[-6.3, -4.8], [6.3, -4.8], [-6.3, 4.8], [6.3, 4.8]]) {
    addBox(plotGroup, 0.35, 1.1, 0.35, px, 0.45, pz, boundaryPostMat);
    addBox(plotGroup, 0.28, 0.25, 0.28, px, 1.55, pz, brandOrangeMat);
  }

  // Rào chắn gỗ 2 thanh ngang sọc cam trắng (#045) và Cọc tiêu nón giao thông (#048) từ bộ 146 Models
  const studioFenceProto = await getStudioModelById('#045', { scale: 1.0, addEntrySocket: false });
  const studioConeProto = await getStudioModelById('#048', { scale: 1.15, addEntrySocket: false });
  const studioBarrelProto = await getStudioModelById('#050', { scale: 0.9, addEntrySocket: false });

  if (studioFenceProto) {
    for (let fz of [-2.4, 2.4]) {
      const f = studioFenceProto.clone(true);
      f.position.set(-5.8, 0.45, fz);
      f.rotation.y = Math.PI / 2;
      plotGroup.add(f);
    }
  } else if (modelFence) {
    for (let fz of [-2.5, 2.5]) {
      const f = modelFence.clone(true);
      f.scale.setScalar(1.2);
      f.position.set(-6.1, 0.45, fz);
      f.rotation.y = Math.PI / 2;
      plotGroup.add(f);
    }
  }

  if (studioConeProto) {
    for (let coneX of [-4.5, -1.5, 1.5, 4.5]) {
      const c = studioConeProto.clone(true);
      c.position.set(coneX, 0.45, -4.6);
      plotGroup.add(c);
    }
  } else if (modelCone) {
    for (let coneX of [-4.5, -1.5, 1.5, 4.5]) {
      const c = modelCone.clone(true);
      c.scale.setScalar(1.4);
      c.position.set(coneX, 0.45, -4.6);
      plotGroup.add(c);
    }
  }

  if (studioBarrelProto) {
    for (let bx of [-5.5, 5.5]) {
      const b = studioBarrelProto.clone(true);
      b.position.set(bx, 0.45, -4.4);
      plotGroup.add(b);
    }
  }

  // Biển hiệu cắm đất 3D 2 MẶT ĐỘC LẬP (TRIỆT TIÊU 100% HIỆN TƯỢNG BỊ NGƯỢC CHỮ TỪ MỌI GÓC XOAY)
  const plotCanvas = document.createElement('canvas');
  plotCanvas.width = 1024; plotCanvas.height = 300;
  const pctx = plotCanvas.getContext('2d');
  pctx.fillStyle = '#0f172a';
  pctx.fillRect(0, 0, 1024, 300);
  pctx.strokeStyle = '#f59e0b';
  pctx.lineWidth = 14;
  pctx.strokeRect(7, 7, 1010, 286);

  pctx.fillStyle = '#f59e0b';
  pctx.font = 'bold 80px sans-serif';
  pctx.textAlign = 'center';
  pctx.fillText('⚡ LÔ ĐẤT DỰ ÁN VISTAX', 512, 105);
  pctx.fillStyle = '#f8fafc';
  pctx.font = 'bold 62px sans-serif';
  pctx.fillText('[ ĐANG ĐÀM PHÁN / BÁO GIÁ ]', 512, 215);

  const plotTex = new T.CanvasTexture(plotCanvas);
  plotTex.colorSpace = T.SRGBColorSpace;

  const bx = 0.5, bz = -3.2;
  const boardAngle = Math.PI / 4;
  const cosA = Math.cos(boardAngle), sinA = Math.sin(boardAngle);
  // Cột gỗ cắm đất
  addBox(plotGroup, 0.12, 1.9, 0.12, bx - cosA * 1.8, 0.45, bz + sinA * 1.8, warmWoodMat);
  addBox(plotGroup, 0.12, 1.9, 0.12, bx + cosA * 1.8, 0.45, bz - sinA * 1.8, warmWoodMat);

  const boardHolder = new T.Group();
  boardHolder.position.set(bx, 1.8, bz);
  boardHolder.rotation.y = boardAngle;
  plotGroup.add(boardHolder);

  // Tấm lưng kim loại đen dày dặn
  const backingMesh = new T.Mesh(new T.BoxGeometry(4.45, 1.35, 0.08), darkMetalMat);
  boardHolder.add(backingMesh);

  // Mặt trước (đọc xuôi 100%)
  const frontBoard = new T.Mesh(new T.PlaneGeometry(4.4, 1.3), new T.MeshStandardMaterial({ map: plotTex, roughness: 0.4 }));
  frontBoard.position.z = 0.045;
  boardHolder.add(frontBoard);

  // Mặt sau (cũng xoay 180 độ để đọc xuôi 100% khi sếp xoay camera ra phía sau)
  const backBoard = new T.Mesh(new T.PlaneGeometry(4.4, 1.3), new T.MeshStandardMaterial({ map: plotTex, roughness: 0.4 }));
  backBoard.position.z = -0.045;
  backBoard.rotation.y = Math.PI;
  boardHolder.add(backBoard);

  console.log('[DISTRICT VISTAX] Finished 100% AAA polish with skyscraper and urban infrastructure!');
  return root;
}
