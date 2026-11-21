import * as T from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { getStudioModelById } from './asset-pack-extractor.js?rev=146';

/**
 * 3D Urban District & Architecture Showcase for AN PHIM Macro World
 * Enforces:
 *  1. Cách 3 (Procedural Modular Lego Builder) with DISTINCT ARCHITECTURAL TYPOLOGIES:
 *     - Grade S+ (≥ 250tr): Stepped Twin Tower Complex with Skybridge, Grand Podium & Crown Spire (18m x 15m footprint)
 *     - Grade S (150-250tr): L-Shaped Biophilic Terraced Tower with Sky Gardens & Wooden Pergola (14m x 12m footprint)
 *     - Grade A (60-150tr): Linear Modern Office with Monopitch Angled Solar Roof & Wrap-around Balconies (12m x 7.5m footprint)
 *     - Grade C (< 25tr): Nordic Innovation Pavilion with Gable Roof & Timber Patio Deck (7.5m x 6.5m footprint)
 *  2. Urban Road Hierarchy:
 *     - DATA HIGHWAYS (Trục đường vành đai đen Core Campus)
 *     - ĐƯỜNG KẾT NỐI (Highways Connector Ramp)
 *     - ĐƯỜNG VÀNH ĐAI QUẬN (District Ring Road / Perimeter Highway)
 *     - ĐƯỜNG NỘI BỘ QUẬN (District Internal Roads & Cross Streets)
 *  3. Modular Blocks/Parcels with sidewalks, crosswalks, streetlamps, and building setbacks.
 */
export function createDistrictShowcase(scene, terrain, P, camera, controls) {
  const showcaseRoot = new T.Group();
  showcaseRoot.name = 'district-showcase-root';
  scene.add(showcaseRoot);

  const loader = new GLTFLoader();

  // District Center & Boundary Parameters (Terraced Retaining Platform above sloped terrain)
  const cx = 86, cz = 2;
  const sampleY = terrain.height ? [
    terrain.height(cx - 24, cz - 22),
    terrain.height(cx + 24, cz - 22),
    terrain.height(cx - 24, cz + 22),
    terrain.height(cx + 24, cz + 22),
    terrain.height(cx - 12, cz),
    terrain.height(cx, cz)
  ] : [0];
  const baseY = Math.max(...sampleY) + 0.15;
  const minY = Math.min(...sampleY) - 0.65;

  // 4 Showcase Parcels positioned in 4 quadrants divided by internal roads
  const parcels = [
    {
      id: 'proj_wincity',
      name: 'The Wincity Landmark',
      client: 'VISTAX',
      budget: 280000000,
      grade: 'Grade S+ (≥ 250tr)',
      type: 'titan_complex',
      studioId: '#013', // Tháp Chọc Trời Cánh Buồm Kính Xanh B3
      fitBox: [13.5, 22.0, 11.5],
      x: 75.5,
      z: -7.5,
      modelUrl: './models/anphim_commercial/building-skyscraper-a.glb',
      scale: 1.45,
      color: '#38bdf8' // Cyan Tech
    },
    {
      id: 'proj_forestia',
      name: 'Forestia Master Studio',
      client: 'VISTAX',
      budget: 180000000,
      grade: 'Grade S (150-250tr)',
      type: 'l_terraced_tower',
      studioId: '#037', // Tòa Chung Cư Gạch Đỏ 5 Tầng Lớn
      fitBox: [13.0, 14.0, 11.0],
      x: 96.5,
      z: -7.5,
      modelUrl: './models/anphim_commercial/building-a.glb',
      scale: 1.35,
      color: '#f59e0b' // Amber Creative
    },
    {
      id: 'proj_winterland',
      name: 'Winterland Season 8',
      client: 'K87K',
      budget: 72000000,
      grade: 'Grade A (60-150tr)',
      type: 'linear_solar_office',
      studioId: '#040', // Tòa Cao Ốc Chung Cư 6 Tầng Sơn Kem
      fitBox: [12.5, 13.5, 10.5],
      x: 75.5,
      z: 11.5,
      modelUrl: './models/anphim_commercial/building-c.glb',
      scale: 1.25,
      color: '#10b981' // Green Season
    },
    {
      id: 'proj_ai_lab',
      name: 'AI Agent R&D Pavilion',
      client: 'INTERNAL',
      budget: 20000000,
      grade: 'Grade C (< 25tr)',
      type: 'nordic_pavilion',
      studioId: '#036', // Nhà Phố Hiện Đại 2 Tầng Có Gara & Sân Thượng
      fitBox: [10.0, 7.5, 9.0],
      x: 96.5,
      z: 11.5,
      modelUrl: './models/anphim_commercial/building-k.glb',
      scale: 1.20,
      color: '#a855f7' // Purple Innovation
    }
  ];

  // =========================================================================
  // 1. URBAN DISTRICT INFRASTRUCTURE: ROADS, CURBS, SIDEWALKS & PARCELS
  // =========================================================================
  const infraGroup = new T.Group();
  infraGroup.name = 'district-urban-infrastructure';

  // Materials
  const asphaltMat = new T.MeshStandardMaterial({ color: '#1e2530', roughness: 0.8, metalness: 0.1 });
  const curbMat = new T.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.9 });
  const sidewalkMat = new T.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.85 });
  const parcelMat = new T.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.8 });
  const yellowLineMat = new T.MeshBasicMaterial({ color: '#facc15' });
  const whiteStripeMat = new T.MeshBasicMaterial({ color: '#f8fafc' });

  // 1.1 District Ground / Master Base Slab & Solid Retaining Foundation
  const skirtDepth = (baseY - minY) + 0.8;
  const foundationMat = new T.MeshStandardMaterial({ color: '#475156', roughness: 0.95 });
  const foundationPlinth = new T.Mesh(new T.BoxGeometry(50.6, skirtDepth, 48.6), foundationMat);
  foundationPlinth.position.set(cx, baseY - skirtDepth / 2 - 0.04, cz);
  foundationPlinth.receiveShadow = true;
  infraGroup.add(foundationPlinth);

  const masterBaseGeo = new T.BoxGeometry(50, 0.10, 48);
  const masterBaseMat = new T.MeshStandardMaterial({ color: '#3f624d', roughness: 0.95 }); // Forest lawn
  const masterBase = new T.Mesh(masterBaseGeo, masterBaseMat);
  masterBase.position.set(cx, baseY, cz);
  masterBase.receiveShadow = true;
  infraGroup.add(masterBase);

  // Helper to create road segment with asphalt and optional lines
  function createRoadSegment(x, z, lenX, lenZ, isRing = false) {
    const segGroup = new T.Group();
    const rGeo = new T.BoxGeometry(lenX, 0.14, lenZ);
    const rMesh = new T.Mesh(rGeo, asphaltMat);
    rMesh.position.set(x, baseY + 0.02, z);
    rMesh.receiveShadow = true;
    segGroup.add(rMesh);

    // Center dashed yellow line
    if (lenX > lenZ && lenX > 6) {
      const lineCount = Math.floor(lenX / 4);
      for (let i = 0; i < lineCount; i++) {
        const lx = x - lenX / 2 + 2 + i * 4;
        const lMesh = new T.Mesh(new T.BoxGeometry(2.2, 0.16, 0.25), yellowLineMat);
        lMesh.position.set(lx, baseY + 0.03, z);
        segGroup.add(lMesh);
      }
    } else if (lenZ > lenX && lenZ > 6) {
      const lineCount = Math.floor(lenZ / 4);
      for (let i = 0; i < lineCount; i++) {
        const lz = z - lenZ / 2 + 2 + i * 4;
        const lMesh = new T.Mesh(new T.BoxGeometry(0.25, 0.16, 2.2), yellowLineMat);
        lMesh.position.set(x, baseY + 0.03, lz);
        segGroup.add(lMesh);
      }
    }
    return segGroup;
  }

  // Helper to create street lamp
  function createStreetLamp(x, z, angle = 0) {
    const lamp = new T.Group();
    const poleMat = new T.MeshStandardMaterial({ color: '#334155', metalness: 0.8, roughness: 0.3 });
    const pole = new T.Mesh(new T.CylinderGeometry(0.08, 0.10, 4.2, 8), poleMat);
    pole.position.y = 2.1;
    lamp.add(pole);

    const headMat = new T.MeshBasicMaterial({ color: '#fef08a' });
    const head = new T.Mesh(new T.BoxGeometry(0.5, 0.18, 0.8), headMat);
    head.position.set(0, 4.1, 0.4);
    lamp.add(head);

    lamp.position.set(x, baseY + 0.05, z);
    lamp.rotation.y = angle;
    return lamp;
  }

  // A. ĐƯỜNG VÀNH ĐAI QUẬN
  const ringRoadGroup = new T.Group();
  ringRoadGroup.name = 'district-ring-road';
  ringRoadGroup.add(createRoadSegment(cx, -18, 44, 4.8, true));
  ringRoadGroup.add(createRoadSegment(cx, 22, 44, 4.8, true));
  ringRoadGroup.add(createRoadSegment(64, cz, 4.8, 36, true));
  ringRoadGroup.add(createRoadSegment(108, cz, 4.8, 36, true));

  const curbGeoN = new T.BoxGeometry(47, 0.22, 0.45);
  const curbN = new T.Mesh(curbGeoN, curbMat);
  curbN.position.set(cx, baseY + 0.06, -20.5);
  ringRoadGroup.add(curbN);

  const curbS = new T.Mesh(curbGeoN, curbMat);
  curbS.position.set(cx, baseY + 0.06, 24.5);
  ringRoadGroup.add(curbS);

  const curbGeoW = new T.BoxGeometry(0.45, 0.22, 43);
  const curbW = new T.Mesh(curbGeoW, curbMat);
  curbW.position.set(61.5, baseY + 0.06, cz);
  ringRoadGroup.add(curbW);

  const curbE = new T.Mesh(curbGeoW, curbMat);
  curbE.position.set(110.5, baseY + 0.06, cz);
  ringRoadGroup.add(curbE);
  infraGroup.add(ringRoadGroup);

  // B. ĐƯỜNG NỘI BỘ QUẬN
  const internalRoadGroup = new T.Group();
  internalRoadGroup.name = 'district-internal-roads';
  internalRoadGroup.add(createRoadSegment(cx, cz, 40, 4.2));
  internalRoadGroup.add(createRoadSegment(cx, cz, 4.2, 36));

  const roundGeo = new T.CylinderGeometry(3.2, 3.2, 0.20, 24);
  const roundMat = new T.MeshStandardMaterial({ color: '#334155', roughness: 0.85 });
  const roundabout = new T.Mesh(roundGeo, roundMat);
  roundabout.position.set(cx, baseY + 0.04, cz);
  internalRoadGroup.add(roundabout);

  const innerGrass = new T.Mesh(new T.CylinderGeometry(2.2, 2.2, 0.26, 24), new T.MeshStandardMaterial({ color: '#22c55e', roughness: 0.9 }));
  innerGrass.position.set(cx, baseY + 0.07, cz);
  internalRoadGroup.add(innerGrass);

  const monument = new T.Mesh(new T.CylinderGeometry(0.4, 0.6, 2.8, 8), new T.MeshStandardMaterial({ color: '#f8fafc', metalness: 0.8 }));
  monument.position.set(cx, baseY + 1.45, cz);
  internalRoadGroup.add(monument);

  const crosswalkPositions = [
    { x: cx - 5.5, z: cz, rot: 0 },
    { x: cx + 5.5, z: cz, rot: 0 },
    { x: cx, z: cz - 5.5, rot: Math.PI / 2 },
    { x: cx, z: cz + 5.5, rot: Math.PI / 2 }
  ];
  for (const cp of crosswalkPositions) {
    const cwGroup = new T.Group();
    for (let s = -1.6; s <= 1.6; s += 0.8) {
      const stripe = new T.Mesh(new T.BoxGeometry(0.45, 0.16, 2.8), whiteStripeMat);
      stripe.position.set(s, 0, 0);
      cwGroup.add(stripe);
    }
    cwGroup.position.set(cp.x, baseY + 0.035, cp.z);
    cwGroup.rotation.y = cp.rot;
    internalRoadGroup.add(cwGroup);
  }

  const lampPositions = [
    { x: 67, z: -15, a: 0 },
    { x: 105, z: -15, a: Math.PI },
    { x: 67, z: 19, a: 0 },
    { x: 105, z: 19, a: Math.PI },
    { x: cx - 7, z: cz - 2.5, a: Math.PI / 2 },
    { x: cx + 7, z: cz + 2.5, a: -Math.PI / 2 }
  ];
  for (const lp of lampPositions) {
    internalRoadGroup.add(createStreetLamp(lp.x, lp.z, lp.a));
  }
  infraGroup.add(internalRoadGroup);

  // C. TRỤC KẾT NỐI DATA HIGHWAYS
  const connectorGroup = new T.Group();
  connectorGroup.name = 'data-highways-connector';
  const connRoad = new T.Mesh(new T.BoxGeometry(18, 0.14, 5.6), asphaltMat);
  connRoad.position.set(55, baseY + 0.02, cz);
  connRoad.receiveShadow = true;
  connectorGroup.add(connRoad);

  const connLine1 = new T.Mesh(new T.BoxGeometry(17, 0.16, 0.2), yellowLineMat);
  connLine1.position.set(55, baseY + 0.03, cz - 0.2);
  connectorGroup.add(connLine1);
  const connLine2 = new T.Mesh(new T.BoxGeometry(17, 0.16, 0.2), yellowLineMat);
  connLine2.position.set(55, baseY + 0.03, cz + 0.2);
  connectorGroup.add(connLine2);

  const guardGeo = new T.BoxGeometry(17, 0.35, 0.35);
  const guardMat = new T.MeshStandardMaterial({ color: '#f59e0b', metalness: 0.8 });
  const guardN = new T.Mesh(guardGeo, guardMat);
  guardN.position.set(55, baseY + 0.18, cz - 3.0);
  connectorGroup.add(guardN);
  const guardS = new T.Mesh(guardGeo, guardMat);
  guardS.position.set(55, baseY + 0.18, cz + 3.0);
  connectorGroup.add(guardS);

  const gantryPillarMat = new T.MeshStandardMaterial({ color: '#1e293b' });
  const p1 = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 4.8, 8), gantryPillarMat);
  p1.position.set(50, baseY + 2.4, cz - 3.2);
  connectorGroup.add(p1);
  const p2 = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 4.8, 8), gantryPillarMat);
  p2.position.set(50, baseY + 2.4, cz + 3.2);
  connectorGroup.add(p2);

  const beam = new T.Mesh(new T.BoxGeometry(0.35, 0.45, 6.8), gantryPillarMat);
  beam.position.set(50, baseY + 4.6, cz);
  connectorGroup.add(beam);

  const gantryCanvas = document.createElement('canvas');
  gantryCanvas.width = 512;
  gantryCanvas.height = 128;
  const gctx = gantryCanvas.getContext('2d');
  gctx.fillStyle = '#0284c7';
  gctx.fillRect(0, 0, 512, 128);
  gctx.lineWidth = 6;
  gctx.strokeStyle = '#facc15';
  gctx.strokeRect(4, 4, 504, 120);
  gctx.fillStyle = '#ffffff';
  gctx.font = 'bold 32px sans-serif';
  gctx.textAlign = 'center';
  gctx.fillText('DATA HIGHWAYS ➔ QUẬN VỆ TINH', 256, 52);
  gctx.fillStyle = '#fef08a';
  gctx.font = '22px sans-serif';
  gctx.fillText('AN PHIM INNOVATION DISTRICT', 256, 92);

  const gantryTex = new T.CanvasTexture(gantryCanvas);
  gantryTex.colorSpace = T.SRGBColorSpace;
  const gantrySign = new T.Mesh(
    new T.PlaneGeometry(6.2, 1.4),
    new T.MeshBasicMaterial({ map: gantryTex, side: T.DoubleSide })
  );
  gantrySign.position.set(50, baseY + 4.6, cz);
  gantrySign.rotation.y = -Math.PI / 2;
  connectorGroup.add(gantrySign);
  infraGroup.add(connectorGroup);

  // D. 4 LOTS / PARCELS
  for (const p of parcels) {
    const lotGroup = new T.Group();
    lotGroup.name = `lot_${p.id}`;

    const lotPlaza = new T.Mesh(new T.BoxGeometry(16, 0.12, 14), parcelMat);
    lotPlaza.position.set(p.x, baseY + 0.03, p.z);
    lotPlaza.receiveShadow = true;
    lotGroup.add(lotPlaza);

    const walkGeo = new T.BoxGeometry(17.2, 0.14, 15.2);
    const walkMesh = new T.Mesh(walkGeo, sidewalkMat);
    walkMesh.position.set(p.x, baseY + 0.02, p.z);
    walkMesh.receiveShadow = true;
    lotGroup.add(walkMesh);

    const driveZ = (p.z < cz) ? (p.z + 7.5) : (p.z - 7.5);
    const driveway = new T.Mesh(new T.BoxGeometry(4.2, 0.15, 2.5), asphaltMat);
    driveway.position.set(p.x, baseY + 0.03, driveZ);
    lotGroup.add(driveway);

    infraGroup.add(lotGroup);
  }

  showcaseRoot.add(infraGroup);

  // Project Badge helper
  function createProjectBadge(p, height) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 150;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    if (ctx.roundRect) ctx.roundRect(10, 10, 492, 130, 20);
    else ctx.fillRect(10, 10, 492, 130);
    ctx.fill();

    ctx.lineWidth = 6;
    ctx.strokeStyle = p.color;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, 256, 52);

    ctx.fillStyle = p.color;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`${p.client} • ${p.grade}`, 256, 92);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '20px sans-serif';
    ctx.fillText(`Budget: ${p.budget.toLocaleString('vi-VN')} đ`, 256, 124);

    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(6.2, 1.8),
      new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide, transparent: true })
    );

    const ty = baseY;
    mesh.position.set(p.x, ty + height + 2.0, p.z);
    mesh.rotation.y = Math.PI * 0.18;
    return mesh;
  }

  // Soft contact shadow helper
  function createContactShadow(x, z, radius = 6.0) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new T.CanvasTexture(canvas);
    const mesh = new T.Mesh(
      new T.PlaneGeometry(radius * 2, radius * 2),
      new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false })
    );
    const ty = baseY;
    mesh.position.set(x, ty + 0.08, z);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  // =========================================================================
  // 3. BUILD 3 STYLES
  // =========================================================================
  const mode1Group = new T.Group();
  mode1Group.name = 'showcase-mode1-lowpoly';
  showcaseRoot.add(mode1Group);

  const mode2Group = new T.Group();
  mode2Group.name = 'showcase-mode2-isometric';
  showcaseRoot.add(mode2Group);

  const mode3Group = new T.Group();
  mode3Group.name = 'showcase-mode3-modular-lego';
  showcaseRoot.add(mode3Group);

  // BUILD MODE 1 (3D Studio Models from 146 Standardized Catalog)
  for (const p of parcels) {
    getStudioModelById(p.studioId || '#013', { fitBox: p.fitBox || [12, 12, 10], addEntrySocket: false })
      .then(studioRoot => {
        if (!studioRoot) return;
        const ty = baseY;
        studioRoot.position.set(p.x, ty + 0.1, p.z);
        // Hướng mặt tiền về phía đường nội bộ giữa Quận
        studioRoot.rotation.y = (p.z < cz) ? 0 : Math.PI;
        const h = (studioRoot.userData.bbox && studioRoot.userData.bbox[1]) ? studioRoot.userData.bbox[1] : 12;

        mode1Group.add(createContactShadow(p.x, p.z, 6.5));
        mode1Group.add(studioRoot);
        mode1Group.add(createProjectBadge(p, h));
      })
      .catch(err => console.warn('Could not load studio parcel model:', p.studioId, err));
  }

  // BUILD MODE 2 (2.5D Isometric Card)
  for (const p of parcels) {
    mode2Group.add(createContactShadow(p.x, p.z, 6.0));

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 768;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 512, 768);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.95)');
    grad.addColorStop(1, 'rgba(30, 41, 59, 0.98)');
    ctx.fillStyle = grad;
    if (ctx.roundRect) ctx.roundRect(16, 16, 480, 736, 28);
    else ctx.fillRect(16, 16, 480, 736);
    ctx.fill();

    ctx.lineWidth = 8;
    ctx.strokeStyle = p.color;
    ctx.stroke();

    const bx = 256, by = 160, bw = 240, bh = 420;
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + 110, by + 50);
    ctx.lineTo(bx + 110, by + bh);
    ctx.lineTo(bx, by + bh - 50);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - 110, by + 50);
    ctx.lineTo(bx - 110, by + bh);
    ctx.lineTo(bx, by + bh - 50);
    ctx.closePath();
    ctx.fill();

    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    const cardH = (bh / 500) * 15;
    const cardW = (cardH * 512) / 768;
    const cardGeo = new T.PlaneGeometry(cardW, cardH);
    const cardMat = new T.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.05,
      side: T.DoubleSide,
      roughness: 0.5
    });
    const cardMesh = new T.Mesh(cardGeo, cardMat);
    const ty = terrain.height ? terrain.height(p.x, p.z) : 0;
    cardMesh.position.set(p.x, ty + cardH / 2 + 0.1, p.z);
    cardMesh.rotation.y = Math.PI * 0.18;
    cardMesh.castShadow = true;

    mode2Group.add(cardMesh);
    mode2Group.add(createProjectBadge(p, cardH));
  }

  // =========================================================================
  // BUILD MODE 3: PROCEDURAL ARCHITECTURAL LEGO (4 DISTINCT TYPOLOGIES)
  // =========================================================================

  // Shared Architectural Materials
  const podiumStoneMat = new T.MeshStandardMaterial({ color: '#1e293b', roughness: 0.65 });
  const concreteSlabMat = new T.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.5 });
  const warmWoodMat = new T.MeshStandardMaterial({ color: '#b45309', roughness: 0.7 });
  const darkMetalMat = new T.MeshStandardMaterial({ color: '#0f172a', roughness: 0.8, metalness: 0.4 });
  const solarBlueMat = new T.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.15, metalness: 0.8 });
  const roofGableMat = new T.MeshStandardMaterial({ color: '#334155', roughness: 0.85 });

  // -------------------------------------------------------------------------
  // TYPOLOGY 1: GRADE S+ TITAN COMPLEX (THE WINCITY LANDMARK - 280TR)
  // Stepped Twin Tower with Skybridge, Grand Podium & Crown Spire
  // Footprint: 16m x 13m | Height: 24m | Main Tower (7 fl), Second Tower (5 fl)
  // -------------------------------------------------------------------------
  function buildGradeSPlusComplex(p) {
    const bldg = new T.Group();
    bldg.name = `lego_${p.id}`;

    const glassSPlusMat = new T.MeshStandardMaterial({
      color: '#38bdf8',
      roughness: 0.15,
      metalness: 0.35,
      emissive: new T.Color('#0284c7'),
      emissiveIntensity: 0.4
    });

    // 1. Grand Commercial Podium Base (16m x 13m x 2.8m)
    const podiumGeo = new T.BoxGeometry(15.5, 2.8, 12.5);
    const podium = new T.Mesh(podiumGeo, podiumStoneMat);
    podium.position.y = 1.4;
    podium.castShadow = podium.receiveShadow = true;
    bldg.add(podium);

    // Grand Entrance Glass Atrium
    const atriumGeo = new T.BoxGeometry(6.5, 2.4, 2.5);
    const atrium = new T.Mesh(atriumGeo, glassSPlusMat);
    atrium.position.set(0, 1.4, 6.2);
    atrium.castShadow = true;
    bldg.add(atrium);

    // Front Flying Canopy
    const flyCanopy = new T.Mesh(new T.BoxGeometry(8.5, 0.3, 3.5), new T.MeshStandardMaterial({ color: '#0284c7', metalness: 0.7 }));
    flyCanopy.position.set(0, 2.6, 7.2);
    flyCanopy.castShadow = true;
    bldg.add(flyCanopy);

    // 2. Tower A (Main Skyscraper, 7 Floors, offset X = -2.5m)
    const twA_w = 8.0, twA_d = 7.5;
    let curYA = 2.8;
    for (let f = 1; f <= 7; f++) {
      const slab = new T.Mesh(new T.BoxGeometry(twA_w + 0.4, 0.3, twA_d + 0.4), concreteSlabMat);
      slab.position.set(-2.5, curYA, 0);
      slab.castShadow = true;
      bldg.add(slab);

      const core = new T.Mesh(new T.BoxGeometry(twA_w - 0.2, 2.3, twA_d - 0.2), glassSPlusMat);
      core.position.set(-2.5, curYA + 1.25, 0);
      core.castShadow = true;
      bldg.add(core);

      // Black architectural corner fins
      for (const ox of [-twA_w / 2 + 0.25, twA_w / 2 - 0.25]) {
        for (const oz of [-twA_d / 2 + 0.25, twA_d / 2 - 0.25]) {
          const fin = new T.Mesh(new T.BoxGeometry(0.5, 2.3, 0.5), darkMetalMat);
          fin.position.set(-2.5 + ox, curYA + 1.25, oz);
          fin.castShadow = true;
          bldg.add(fin);
        }
      }
      curYA += 2.6;
    }

    // Tower A Crown Spire & Helipad
    const crown = new T.Mesh(new T.BoxGeometry(twA_w * 0.7, 1.8, twA_d * 0.7), darkMetalMat);
    crown.position.set(-2.5, curYA + 0.9, 0);
    bldg.add(crown);

    const helipad = new T.Mesh(new T.CylinderGeometry(2.8, 2.8, 0.15, 24), new T.MeshStandardMaterial({ color: '#facc15', roughness: 0.4 }));
    helipad.position.set(-2.5, curYA + 1.85, 0);
    bldg.add(helipad);

    const spire = new T.Mesh(new T.CylinderGeometry(0.08, 0.2, 5.5, 8), new T.MeshStandardMaterial({ color: '#f8fafc', metalness: 0.9 }));
    spire.position.set(-2.5 + 2.2, curYA + 3.5, 2.0);
    bldg.add(spire);

    const redBeacon = new T.Mesh(new T.SphereGeometry(0.28, 8, 8), new T.MeshBasicMaterial({ color: '#ef4444' }));
    redBeacon.position.set(-2.5 + 2.2, curYA + 6.3, 2.0);
    bldg.add(redBeacon);

    // 3. Tower B (Secondary Skyscraper, 4 Floors, offset X = +4.2m)
    const twB_w = 5.8, twB_d = 6.2;
    let curYB = 2.8;
    for (let f = 1; f <= 4; f++) {
      const slab = new T.Mesh(new T.BoxGeometry(twB_w + 0.4, 0.3, twB_d + 0.4), concreteSlabMat);
      slab.position.set(4.2, curYB, 0);
      slab.castShadow = true;
      bldg.add(slab);

      const core = new T.Mesh(new T.BoxGeometry(twB_w - 0.2, 2.3, twB_d - 0.2), glassSPlusMat);
      core.position.set(4.2, curYB + 1.25, 0);
      core.castShadow = true;
      bldg.add(core);
      curYB += 2.6;
    }

    // Tower B Rooftop Sky Terrace
    const bRoofSlab = new T.Mesh(new T.BoxGeometry(twB_w + 0.4, 0.3, twB_d + 0.4), darkMetalMat);
    bRoofSlab.position.set(4.2, curYB, 0);
    bldg.add(bRoofSlab);

    const bGarden = new T.Mesh(new T.BoxGeometry(twB_w - 0.6, 0.2, twB_d - 0.6), new T.MeshStandardMaterial({ color: '#22c55e' }));
    bGarden.position.set(4.2, curYB + 0.2, 0);
    bldg.add(bGarden);

    // 4. Skybridge connecting Tower A and Tower B at Level 3 (Height Y ~ 8.0m)
    const bridgeGeo = new T.BoxGeometry(3.6, 1.8, 2.4);
    const bridgeMat = new T.MeshStandardMaterial({ color: '#0284c7', transparent: true, opacity: 0.85, metalness: 0.7 });
    const skybridge = new T.Mesh(bridgeGeo, bridgeMat);
    skybridge.position.set(0.85, 8.8, 0);
    skybridge.castShadow = true;
    bldg.add(skybridge);

    return { bldg, height: curYA + 6.3 };
  }

  // -------------------------------------------------------------------------
  // TYPOLOGY 2: GRADE S MEGA TOWER (FORESTIA MASTER STUDIO - 180TR)
  // L-Shaped Biophilic Terraced Tower with Sky Gardens & Wooden Pergola
  // Footprint: 14m x 12m | Height: 16m | 5 Floors with Stepped Setbacks
  // -------------------------------------------------------------------------
  function buildGradeSTerracedTower(p) {
    const bldg = new T.Group();
    bldg.name = `lego_${p.id}`;

    const glassAmberMat = new T.MeshStandardMaterial({
      color: '#f59e0b',
      roughness: 0.2,
      metalness: 0.25,
      emissive: new T.Color('#d97706'),
      emissiveIntensity: 0.35
    });

    // 1. L-Shaped Base Podium (14m x 12m)
    // Main Body: 9m x 12m
    const baseMain = new T.Mesh(new T.BoxGeometry(9.0, 2.6, 11.5), podiumStoneMat);
    baseMain.position.set(-2.0, 1.3, 0);
    baseMain.castShadow = true;
    bldg.add(baseMain);

    // L-Wing: 5m x 6m
    const baseWing = new T.Mesh(new T.BoxGeometry(4.8, 2.6, 6.0), podiumStoneMat);
    baseWing.position.set(4.8, 1.3, 2.75);
    baseWing.castShadow = true;
    bldg.add(baseWing);

    // Warm Wooden Canopy
    const canopy = new T.Mesh(new T.BoxGeometry(6.0, 0.3, 3.2), warmWoodMat);
    canopy.position.set(-2.0, 2.5, 6.4);
    canopy.castShadow = true;
    bldg.add(canopy);

    // 2. Middle Floors (Levels 2, 3, 4 - Main Body)
    let curY = 2.6;
    for (let f = 2; f <= 4; f++) {
      const slab = new T.Mesh(new T.BoxGeometry(9.4, 0.3, 11.8), concreteSlabMat);
      slab.position.set(-2.0, curY, 0);
      slab.castShadow = true;
      bldg.add(slab);

      const core = new T.Mesh(new T.BoxGeometry(8.8, 2.3, 11.2), glassAmberMat);
      core.position.set(-2.0, curY + 1.25, 0);
      core.castShadow = true;
      bldg.add(core);

      // Warm vertical architectural louvers
      for (let lx = -5.8; lx <= 1.8; lx += 1.4) {
        const louver = new T.Mesh(new T.BoxGeometry(0.12, 2.3, 0.4), warmWoodMat);
        louver.position.set(lx, curY + 1.25, 5.75);
        louver.castShadow = true;
        bldg.add(louver);
      }
      curY += 2.6;
    }

    // Level 3 Terrace on L-Wing (Roof of baseWing at Y = 2.6)
    const wingTerrace = new T.Mesh(new T.BoxGeometry(4.6, 0.15, 5.8), warmWoodMat);
    wingTerrace.position.set(4.8, 2.68, 2.75);
    bldg.add(wingTerrace);

    // Plants on Wing Terrace
    for (const [tx, tz] of [[3.6, 1.5], [5.6, 1.5], [4.6, 4.0]]) {
      const planter = new T.Mesh(new T.BoxGeometry(0.9, 0.6, 0.9), darkMetalMat);
      planter.position.set(tx, 2.9, tz);
      bldg.add(planter);
      const bush = new T.Mesh(new T.SphereGeometry(0.55, 8, 8), new T.MeshStandardMaterial({ color: '#16a34a' }));
      bush.position.set(tx, 3.4, tz);
      bldg.add(bush);
    }

    // 3. Top Penthouse Floor 5 (Stepped Setback, smaller box: 7m x 8m)
    const pSlab = new T.Mesh(new T.BoxGeometry(7.4, 0.3, 8.4), concreteSlabMat);
    pSlab.position.set(-2.0, curY, -1.0);
    bldg.add(pSlab);

    const pCore = new T.Mesh(new T.BoxGeometry(6.8, 2.3, 7.8), glassAmberMat);
    pCore.position.set(-2.0, curY + 1.25, -1.0);
    bldg.add(pCore);
    curY += 2.6;

    // 4. Rooftop Sky Garden & Pergola
    const rSlab = new T.Mesh(new T.BoxGeometry(7.4, 0.3, 8.4), darkMetalMat);
    rSlab.position.set(-2.0, curY, -1.0);
    bldg.add(rSlab);

    const rGarden = new T.Mesh(new T.BoxGeometry(6.8, 0.15, 7.8), warmWoodMat);
    rGarden.position.set(-2.0, curY + 0.16, -1.0);
    bldg.add(rGarden);

    // Timber Pergola Frame
    for (let pz = -4.0; pz <= 2.0; pz += 1.8) {
      const beam = new T.Mesh(new T.BoxGeometry(6.2, 0.18, 0.22), warmWoodMat);
      beam.position.set(-2.0, curY + 2.2, pz);
      bldg.add(beam);
    }

    // Mini Antenna
    const ant = new T.Mesh(new T.CylinderGeometry(0.08, 0.14, 4.0, 8), new T.MeshStandardMaterial({ color: '#f8fafc', metalness: 0.9 }));
    ant.position.set(1.0, curY + 2.1, 1.8);
    bldg.add(ant);

    const bulb = new T.Mesh(new T.SphereGeometry(0.22, 8, 8), new T.MeshBasicMaterial({ color: '#ef4444' }));
    bulb.position.set(1.0, curY + 4.2, 1.8);
    bldg.add(bulb);

    return { bldg, height: curY + 4.2 };
  }

  // -------------------------------------------------------------------------
  // TYPOLOGY 3: GRADE A LINEAR MODERN OFFICE (WINTERLAND SEASON 8 - 72TR)
  // Linear 3-Storey Office with Monopitch Angled Solar Roof & Wrap-around Balconies
  // Footprint: 12.5m x 7.5m | Height: 11.5m | Wide Aspect Ratio
  // -------------------------------------------------------------------------
  function buildGradeALinearOffice(p) {
    const bldg = new T.Group();
    bldg.name = `lego_${p.id}`;

    const glassGreenMat = new T.MeshStandardMaterial({
      color: '#10b981',
      roughness: 0.22,
      metalness: 0.2,
      emissive: new T.Color('#059669'),
      emissiveIntensity: 0.3
    });

    const w = 12.5, d = 7.5;

    // 1. Ground Floor & Cantilever Entrance (12.5m x 7.5m x 2.6m)
    const groundSlab = new T.Mesh(new T.BoxGeometry(w + 0.8, 0.4, d + 0.8), podiumStoneMat);
    groundSlab.position.y = 0.2;
    bldg.add(groundSlab);

    const lobby = new T.Mesh(new T.BoxGeometry(w - 0.4, 2.4, d - 0.4), glassGreenMat);
    lobby.position.y = 1.6;
    lobby.castShadow = true;
    bldg.add(lobby);

    // Minimalist Steel Box Canopy
    const canopy = new T.Mesh(new T.BoxGeometry(4.5, 0.25, 2.6), darkMetalMat);
    canopy.position.set(0, 2.5, d / 2 + 1.1);
    bldg.add(canopy);

    // 2. Levels 2 & 3 with Wrap-around Glass Balconies
    let curY = 2.8;
    for (let f = 2; f <= 3; f++) {
      // Floor Slab extending into balcony
      const slab = new T.Mesh(new T.BoxGeometry(w + 1.0, 0.25, d + 1.0), concreteSlabMat);
      slab.position.y = curY;
      slab.castShadow = true;
      bldg.add(slab);

      // Glass Office Core
      const core = new T.Mesh(new T.BoxGeometry(w - 0.8, 2.3, d - 0.8), glassGreenMat);
      core.position.y = curY + 1.25;
      core.castShadow = true;
      bldg.add(core);

      // Balcony glass railing
      const railGeo = new T.BoxGeometry(w + 0.9, 0.75, 0.1);
      const railMat = new T.MeshStandardMaterial({ color: '#6ee7b7', transparent: true, opacity: 0.75 });
      const railFront = new T.Mesh(railGeo, railMat);
      railFront.position.set(0, curY + 0.45, d / 2 + 0.45);
      bldg.add(railFront);

      curY += 2.6;
    }

    // 3. Monopitch Angled Solar Roof (Mái dốc 1 chiều nghiêng về phía sau)
    const roofSlab = new T.Mesh(new T.BoxGeometry(w + 0.8, 0.35, d + 0.8), darkMetalMat);
    roofSlab.position.set(0, curY, 0);
    bldg.add(roofSlab);

    // Angled Solar Panel Array (Khung mái dốc gắn pin mặt trời)
    const solarFrameGeo = new T.BoxGeometry(w * 0.9, 0.15, d * 0.9);
    const solarFrame = new T.Mesh(solarFrameGeo, solarBlueMat);
    solarFrame.position.set(0, curY + 0.8, 0);
    solarFrame.rotation.x = -Math.PI * 0.08; // 15 degree slope
    bldg.add(solarFrame);

    // HVAC Air Conditioning Units on Roof
    for (const hx of [-4.0, 4.0]) {
      const hvac = new T.Mesh(new T.BoxGeometry(1.4, 0.8, 1.4), new T.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.6 }));
      hvac.position.set(hx, curY + 0.5, -2.0);
      bldg.add(hvac);
    }

    return { bldg, height: curY + 1.6 };
  }

  // -------------------------------------------------------------------------
  // TYPOLOGY 4: GRADE C NORDIC INNOVATION PAVILION (AI AGENT LAB - 20TR)
  // Single-Storey Nordic Cottage / Studio Pavilion with Gable Roof & Timber Patio
  // Footprint: 8m x 7m | Height: 5.5m | Cozy Boutique Architecture
  // -------------------------------------------------------------------------
  function buildGradeCNordicPavilion(p) {
    const bldg = new T.Group();
    bldg.name = `lego_${p.id}`;

    const glassPurpleMat = new T.MeshStandardMaterial({
      color: '#c084fc',
      roughness: 0.18,
      metalness: 0.25,
      emissive: new T.Color('#9333ea'),
      emissiveIntensity: 0.4
    });

    const w = 7.8, d = 6.8;

    // 1. Raised Timber Decking Patio (Sàn gỗ ngoài trời nâng cao)
    const deckGeo = new T.BoxGeometry(w + 2.4, 0.25, d + 2.0);
    const deck = new T.Mesh(deckGeo, warmWoodMat);
    deck.position.set(0, 0.125, 0.6);
    deck.receiveShadow = true;
    bldg.add(deck);

    // 2. Glass Studio Pavilion (Tường kính kịch trần từ sàn đến mái)
    const studioCore = new T.Mesh(new T.BoxGeometry(w, 2.6, d), glassPurpleMat);
    studioCore.position.set(0, 1.425, 0);
    studioCore.castShadow = true;
    bldg.add(studioCore);

    // Structural Timber Posts (4 góc bằng gỗ ấm)
    for (const ox of [-w / 2 + 0.2, w / 2 - 0.2]) {
      for (const oz of [-d / 2 + 0.2, d / 2 - 0.2]) {
        const post = new T.Mesh(new T.BoxGeometry(0.4, 2.6, 0.4), warmWoodMat);
        post.position.set(ox, 1.425, oz);
        post.castShadow = true;
        bldg.add(post);
      }
    }

    // 3. Nordic Modernist Gable Roof (Mái dốc tam giác chữ A 2 mái)
    // Triangular prism via CylinderGeometry (3 sides)
    const roofRadius = (w + 1.2) / 2;
    const roofLen = d + 1.4;
    const gableGeo = new T.CylinderGeometry(roofRadius, roofRadius, roofLen, 3);
    const gableRoof = new T.Mesh(gableGeo, roofGableMat);
    gableRoof.rotation.z = Math.PI / 2;
    gableRoof.rotation.y = Math.PI / 2;
    gableRoof.position.set(0, 2.7 + 1.6, 0);
    gableRoof.castShadow = true;
    bldg.add(gableRoof);

    // Cozy Chimney on the roof
    const chimney = new T.Mesh(new T.BoxGeometry(0.7, 1.8, 0.7), new T.MeshStandardMaterial({ color: '#78716c', roughness: 0.9 }));
    chimney.position.set(1.8, 4.4, -1.2);
    chimney.castShadow = true;
    bldg.add(chimney);

    // Outdoor Café Table & Parasol on Timber Deck
    const table = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 0.7, 16), darkMetalMat);
    table.position.set(2.8, 0.55, 2.6);
    bldg.add(table);

    const parasolPole = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 2.2, 8), darkMetalMat);
    parasolPole.position.set(2.8, 1.3, 2.6);
    bldg.add(parasolPole);

    const parasolTop = new T.Mesh(new T.ConeGeometry(1.4, 0.45, 16), new T.MeshStandardMaterial({ color: '#a855f7' }));
    parasolTop.position.set(2.8, 2.4, 2.6);
    bldg.add(parasolTop);

    return { bldg, height: 4.8 };
  }

  // -------------------------------------------------------------------------
  // INSTANTIATE THE 4 DISTINCT LEGO TYPOLOGIES
  // -------------------------------------------------------------------------
  for (const p of parcels) {
    mode3Group.add(createContactShadow(p.x, p.z, p.budget >= 150000000 ? 8.5 : 6.0));

    let built;
    if (p.type === 'titan_complex') {
      built = buildGradeSPlusComplex(p);
    } else if (p.type === 'l_terraced_tower') {
      built = buildGradeSTerracedTower(p);
    } else if (p.type === 'linear_solar_office') {
      built = buildGradeALinearOffice(p);
    } else {
      built = buildGradeCNordicPavilion(p);
    }

    const ty = baseY;
    built.bldg.position.set(p.x, ty + 0.10, p.z);

    mode3Group.add(built.bldg);
    mode3Group.add(createProjectBadge(p, built.height));
  }

  // -------------------------------------------------------------------------
  // 4. INSTANT TOGGLE FUNCTION
  // -------------------------------------------------------------------------
  function setMode(mode) {
    mode1Group.visible = (mode === 'mode1');
    mode2Group.visible = (mode === 'mode2');
    mode3Group.visible = (mode === 'mode3');

    // Update bottom dock buttons
    document.querySelectorAll('.showcase-btn').forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.style.background = active ? '#0284c7' : '#1e293b';
      btn.style.color = active ? '#ffffff' : '#94a3b8';
      btn.style.borderColor = active ? '#38bdf8' : '#475569';
    });

    // Update top nav buttons
    document.querySelectorAll('.mode-nav-btn').forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.style.background = active ? '#0284c7' : '#1e293b';
      btn.style.color = active ? '#ffffff' : '#94a3b8';
      btn.style.outline = active ? '2px solid #38bdf8' : 'none';
    });

    const infoCard = document.querySelector('#showcase-info-card');
    if (infoCard) {
      if (mode === 'mode3') {
        infoCard.innerHTML = `<b>⭐ CÁCH 3: PROCEDURAL LEGO V2 (4 HÌNH KHỐI KIẾN TRÚC HOÀN TOÀN KHÁC BIỆT):</b><br/>• <b>S+ (≥250tr):</b> Quần thể Tháp Đôi Stepped Twin Tower + Cầu Kính Skybridge + Mái Vương Miện.<br/>• <b>S (150-250tr):</b> Tháp chữ L giật cấp + Vườn Treo Sky Garden + Giàn lam gỗ Pergola.<br/>• <b>A (60-150tr):</b> Khối văn phòng ngang bề thế + Mái dốc pin năng lượng Solar + Ban công dài.<br/>• <b>C (<25tr):</b> Pavilion Bắc Âu trệt + Mái tam giác Gable Roof + Hiên gỗ thưởng trà ngoài trời.`;
      } else if (mode === 'mode1') {
        infoCard.innerHTML = `<b>Cách 1 (3D Low-Poly Mesh):</b> Mô hình 3D (.glb) nguyên khối trên ô đất nội khu.`;
      } else if (mode === 'mode2') {
        infoCard.innerHTML = `<b>Cách 2 (2.5D Isometric Sprite):</b> Billboard minh họa anime/game card.`;
      }
    }

    const statusEl = document.querySelector('#status');
    if (statusEl) {
      statusEl.textContent = `Đang xem: Cách 3 (Procedural Lego V2 - 4 Hình Khối Kiến Trúc Khác Biệt Hoàn Toàn)`;
    }
  }

  // Camera Focus
  function focusShowcaseCamera() {
    if (window.setCameraView) {
      window.setCameraView('showcase');
      return;
    }
    const targetPos = new T.Vector3(cx, 5, cz);
    const camPos = new T.Vector3(138, 44, 52);
    if (controls) {
      controls.target.copy(targetPos);
      camera.position.copy(camPos);
      camera.lookAt(targetPos);
      controls.update();
    }
    if (window.setCameraSpan) {
      window.setCameraSpan(62);
    }
  }

  // Build Floating Bottom Dock (Tắt hiển thị mặc định để giữ màn hình sạch sẽ, chỉ mở khi cần)
  function buildShowcaseUI() {
    const existing = document.querySelector('#showcase-style-dock');
    if (existing) existing.remove();
    // Đã ẩn banner to đùng ở đáy màn hình để trả lại 100% không gian khoáng đạt cho Campus
    return;
  }

  // Hook up Top Nav buttons
  function hookTopNavButtons() {
    document.querySelectorAll('.mode-nav-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        setMode(btn.dataset.mode);
        focusShowcaseCamera();
      });
    });
  }

  // Keyboard shortcuts 1, 2, 3
  window.addEventListener('keydown', e => {
    if (e.target && ['input', 'textarea'].includes(e.target.tagName?.toLowerCase())) return;
    if (e.key === '3') setMode('mode3');
    else if (e.key === '1') setMode('mode1');
    else if (e.key === '2') setMode('mode2');
  });

  // INITIALIZE WITH MODE 1 (STUDIO 146 MODELS) AS DEFAULT
  setMode('mode1');
  buildShowcaseUI();
  hookTopNavButtons();

  window.DistrictShowcaseAPI = {
    setMode: setMode,
    focus: focusShowcaseCamera
  };

  return {
    setMode,
    focusShowcaseCamera
  };
}
