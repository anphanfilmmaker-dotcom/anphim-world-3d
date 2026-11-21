import * as T from 'three';

export async function createLandscapePolish(scene, P, L, terrain, roads, registry, layers, report, A) {
  const root = new T.Group();
  root.name = 'campus-landscape-polish-step2';
  scene.add(root);

  const nature = './assets/v23/kenney_nature-kit/';

  // Nạp bộ models 3D thực tế theo yêu cầu của Sếp (City Free Pack & Nature Kit)
  let modelPineTall = null, modelPineRound = null, modelOak = null;
  let modelGarden = null, modelTree2 = null, modelTree6 = null;
  let modelBushSmall = null, modelBushDetailed = null, modelBush = null;

  try {
    [modelPineTall, modelPineRound, modelOak, modelGarden, modelTree2, modelTree6, modelBushSmall, modelBushDetailed, modelBush] = await Promise.all([
      registry.load(nature + 'tree_pineTallA.glb', 'tree').catch(() => null),
      registry.load(nature + 'tree_pineRoundA.glb', 'tree').catch(() => null),
      registry.load(nature + 'tree_oak.glb', 'tree').catch(() => null),
      registry.load('./assets/city-pack/garden1.glb', 'garden').catch(() => null),
      registry.load('./assets/city-pack/tree2.glb', 'tree').catch(() => null),
      registry.load('./assets/city-pack/tree6.glb', 'tree').catch(() => null),
      registry.load('./assets/city-pack/plant_bushSmall.glb', 'shrub').catch(() => null),
      registry.load('./assets/city-pack/plant_bushDetailed.glb', 'shrub').catch(() => null),
      registry.load('./assets/city-pack/plant_bush.glb', 'shrub').catch(() => null)
    ]);
  } catch (err) {
    console.warn('[POLISH] Error loading 3D foliage models:', err);
  }

  function placeModel(model, x, z, scale = 1.0, yaw = 0, parent = root, yOffset = 0.06) {
    if (!model) return null;
    const g = new T.Group();
    const clone = model.clone(true);
    const b = new T.Box3().setFromObject(clone);
    const c = b.getCenter(new T.Vector3());
    const minY = b.min.y;

    clone.position.set(-c.x * scale, -minY * scale, -c.z * scale);
    clone.scale.setScalar(scale);
    const isSmallFoliage = (model === modelBushSmall || model === modelBushDetailed || model === modelBush || model === modelGarden);
    clone.traverse(child => {
      if (child.isMesh) {
        child.castShadow = !isSmallFoliage;
        child.receiveShadow = true;
      }
    });
    g.add(clone);

    const y = terrain.height(x, z) + yOffset;
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    parent.add(g);
    return g;
  }

  // 1. MATERIALS
  const bushMat1 = new T.MeshStandardMaterial({
    color: 0x5c9a3e, // Rich organic foliage green
    roughness: 0.86,
    metalness: 0.02
  });

  const bushMat2 = new T.MeshStandardMaterial({
    color: 0x3f7f3a, // Deep forest green
    roughness: 0.88,
    metalness: 0.02
  });

  const flowerWhiteMat = new T.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6
  });

  const flowerPinkMat = new T.MeshStandardMaterial({
    color: 0xf5b7d8, // Cherry blossom pink
    roughness: 0.6
  });

  const roadWhiteMat = new T.MeshStandardMaterial({
    color: 0xf0f2f5,
    roughness: 0.4,
    metalness: 0.1
  });

  const planterStoneMat = new T.MeshStandardMaterial({
    color: 0xdcd8ce, // Cream limestone
    roughness: 0.75
  });

  const planterSoilMat = new T.MeshStandardMaterial({
    color: 0x3d352b, // Dark fertile soil
    roughness: 1.0
  });

  const waterBasinMat = new T.MeshStandardMaterial({
    color: 0x36a0b3, // Crisp transparent turquoise reflection pool
    roughness: 0.04,
    metalness: 0.28,
    transparent: true,
    opacity: 0.92
  });

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

  function addCyl(parent, r, h, x, y, z, mat, n = 16) {
    const geo = new T.CylinderGeometry(r, r, h, n);
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // 2. ORGANIC SHRUB & BUSH CLUSTERS (Bụi cây hữu cơ tự nhiên - Bỏ các thanh hộp cứng)
  const bushGroup = new T.Group();
  bushGroup.name = 'organic-bush-clusters';
  root.add(bushGroup);

  // We place natural clusters of rounded shrubs along key edges
  const bushSpheres = [];
  const sphereGeo = new T.IcosahedronGeometry(0.55, 1);

  function addBushCluster(cx, cz, count = 4, spread = 0.7, avgScale = 0.8) {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const r = Math.random() * spread;
      const x = cx + Math.cos(ang) * r;
      const z = cz + Math.sin(ang) * r;
      const y = terrain.height(x, z);
      const sc = avgScale * (0.75 + Math.random() * 0.45);
      const m = new T.Mesh(sphereGeo, i % 2 === 0 ? bushMat1 : bushMat2);
      m.scale.set(sc * 1.1, sc * 0.85, sc * 1.05);
      m.position.set(x, y + sc * 0.35, z);
      m.rotation.y = Math.random() * Math.PI * 2;
      m.castShadow = false;
      m.receiveShadow = true;
      bushGroup.add(m);
    }
  }

  // Chain of organic bushes along pathways (Mềm mại, tự nhiên như concept)
  function addBushChain(x1, z1, x2, z2, step = 1.3) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.max(1, Math.floor(len / step));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = x1 + (x2 - x1) * t;
      const z = z1 + (z2 - z1) * t;
      addBushCluster(x, z, 3, 0.45, 0.75);
    }
  }

  // Organic bush borders framing U-Turn Avenue
  // Arrival sidewalks are kept free of decorative shrubs.

  // Quy hoạch bồn hoa garden1 và bụi cây nhỏ chuẩn mực trong Central Commons
  const commonsGardenGroup = new T.Group();
  commonsGardenGroup.name = 'central-commons-gardens';
  root.add(commonsGardenGroup);
  if (modelGarden) {
    placeModel(modelGarden, -8, -16, 0.85, 0, commonsGardenGroup);
    placeModel(modelGarden, 8, -16, 0.85, 0, commonsGardenGroup);
    placeModel(modelGarden, -8, -26, 0.85, Math.PI, commonsGardenGroup);
    placeModel(modelGarden, 8, -26, 0.85, Math.PI, commonsGardenGroup);
  }
  if (modelBushSmall) {
    for (const x of [-10, -6, 6, 10]) {
      placeModel(modelBushSmall, x, -16, 0.65, Math.random() * 6.28, commonsGardenGroup);
      placeModel(modelBushSmall, x, -26, 0.65, Math.random() * 6.28, commonsGardenGroup);
    }
  }

  // 3. CENTRAL U-TURN ISLAND GARDEN (Bùng binh đảo cây trung tâm U-Turn)
  const islandGroup = new T.Group();
  islandGroup.name = 'u-turn-central-island';
  root.add(islandGroup);

  // A single elongated island follows the U-turn. Its surface is sampled
  // from the terrain so it follows the ground instead of sitting on a box.
  const ix = 0, iz = 24.5, iy = terrain.height(ix, iz);
  const gardenMat = new T.MeshStandardMaterial({color: 0x648b4d, roughness: 1, side: T.DoubleSide});
  const edgeMat = new T.MeshStandardMaterial({color: 0xc4bba7, roughness: 1, side: T.DoubleSide});
  function halfWidth(z) {
    if (z < 24.5) return Math.sqrt(Math.max(0, 3.55**2 - (z - 24.5)**2));
    return 3.55;
  }
  function strip(inner, outer, material) {
    const verts=[], indices=[], rows=100, cols=16;
    for (let j=0;j<=rows;j++) {
      const z=21.0+(31.2-21.0)*j/rows, w=halfWidth(z);
      for (let i=0;i<=cols;i++) {
        const x=w*(inner+(outer-inner)*i/cols);
        verts.push(x,terrain.height(x,z)+0.045,z);
      }
    }
    for(let j=0;j<rows;j++) for(let i=0;i<cols;i++) {
      const k=j*(cols+1)+i;indices.push(k,k+cols+1,k+1,k+1,k+cols+1,k+cols+2);
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();
    const m=new T.Mesh(g,material);m.receiveShadow=true;islandGroup.add(m);
  }
  // �� G? B? 100% TO�N B? C�Y V� B?I C�Y TRONG �?O V� L�NG �U?NG U-TURN THEO Y�U C?U C?A S?P
  // Gi? to�n b? kh�ng gian d?o ch? U quang d�ng, s?ch b�ng, th?m c? m?n mu?t kh�ng v?t c?n.
  const forecourtDeco = new T.Group();
  forecourtDeco.name = 'hq-forecourt-planters';
  root.add(forecourtDeco);
  // (hq-arrival-paving cũ đã gỡ bỏ hoàn toàn để tránh trùng lặp 2 lớp vỉa hè lòi ra đường chính)
  // Fine paving joints are visual lines only; the full forecourt remains walkable.
  const joints=[], jointMat=new T.LineBasicMaterial({color:0xaaa394,transparent:true,opacity:.55});
  function joint(x1,z1,x2,z2) {
    const n=Math.ceil(Math.hypot(x2-x1,z2-z1)/.4);
    for(let i=0;i<n;i++) for(const t of [i/n,(i+1)/n]) {
      const x=x1+(x2-x1)*t,z=z1+(z2-z1)*t;
      joints.push(x,terrain.height(x,z)+.12,z);
    }
  }
  for(let x=-10.5;x<=10.5;x+=1.25) joint(x,3.0,x,9.5);
  for(let z=3.25;z<=9.5;z+=1.25) joint(-10.5,z,10.5,z);
  const jg=new T.BufferGeometry();jg.setAttribute('position',new T.Float32BufferAttribute(joints,3));
  // Paving now rendered on terrain material.

  // 5. ROAD MARKINGS & ZEBRA CROSSINGS
  const markingsGroup = new T.Group();
  markingsGroup.name = 'road-markings';
  root.add(markingsGroup);

  function createZebraCrossing(cx, cz, rotY, stripes = 6, width = 2.2, stripeW = 0.38, gap = 0.28) {
    const totalLen = stripes * stripeW + (stripes - 1) * gap;
    const startOffset = -totalLen / 2 + stripeW / 2;
    for (let i = 0; i < stripes; i++) {
      const offset = startOffset + i * (stripeW + gap);
      const lx = offset * Math.cos(rotY);
      const lz = offset * Math.sin(rotY);
      const x = cx + lx, z = cz + lz;
      const y = terrain.height(x, z) + 0.025;
      addBox(markingsGroup, width, 0.015, stripeW, x, y, z, roadWhiteMat, rotY);
    }
  }

  // Zebra crossings at -46 and +46 removed per user request (eliminated orphaned white lines)

  // (Vach ke tim duong cu z <= 34 da go bo hoan toan; da co vach ke chu U chuan trong hq-gardens dung truoc z <= 31.5)

  // 6. MULTI-TIER TREE SYSTEM (Đã nạp sẵn models ở đầu hàm)

  // A focal tree inside the planted island; no decorative footprint lies on a path.
  const islandOak=modelOak.clone(true);
  islandOak.scale.setScalar(2.0);
  // islandOak removed per user request
  // islandOak.position.set(0,terrain.height(0,23.2)+.08,23.2);
  // Focal grove now authored by hq-gardens.js.
  // Layered low planting stays inside the island perimeter.
  // Đã thay thế bằng model garden1 và plant_bushSmall ở trên

  // Formal planted bays frame the entrance. Candidate footprints are
  // rejected against actual sampled roads and footpaths before placement.
  const hqGarden = new T.Group(); hqGarden.name='hq-designed-gardens'; root.add(hqGarden);
  const soil = new T.MeshStandardMaterial({color:0x426c39,roughness:1});
  const flower = new T.MeshStandardMaterial({color:0xe7e5cf,roughness:1});
  const trim = new T.MeshStandardMaterial({color:0xbfb49b,roughness:1});
  function circulationClear(x,z,r) {
    if(Math.abs(x)<2.5+r && z>=9 && z<=16.3) return false;
    for(const p of roads.paths) {
      let n=Math.max(20,Math.ceil(p.curve.getLength()*2));
      for(let i=0;i<=n;i++) {const q=p.curve.getPointAt(i/n);if(Math.hypot(q.x-x,q.z-z)<p.width/2+r+.12)return false;}
    }
    return true;
  }
  // Tall Cypress / Pine Trees
  const pinePoints = [
    { x: -14, z: -10, h: 5.5, yaw: 0.2 },
    { x: 14, z: -10, h: 5.5, yaw: 1.5 },
    { x: -12, z: 2, h: 4.8, yaw: 2.1 },
    { x: 12, z: 2, h: 4.8, yaw: 0.8 },
    { x: -22, z: 12, h: 4.5, yaw: 3.1 },
    { x: -38, z: 8, h: 5.2, yaw: 0.4 },
    { x: 44, z: 12, h: 5.2, yaw: 1.2 },
    { x: 44, z: 24, h: 4.8, yaw: 2.6 },
    { x: 28, z: -32, h: 5.6, yaw: 0.7 },
    { x: 42, z: -30, h: 5.2, yaw: 2.9 },
    { x: 48, z: -14, h: 4.6, yaw: 1.8 }
  ];
  registry.instance(modelPineTall, pinePoints, layers.canopy, terrain);

  // Pine Round trees framing avenues
  const pineRoundPoints = [
    { x: -8, z: 14, h: 3.6, yaw: 0.5 },
    { x: 8, z: 14, h: 3.6, yaw: 1.8 },
    { x: -13, z: 20, h: 3.8, yaw: 2.4 },
    { x: 13, z: 20, h: 3.8, yaw: 0.9 },
    { x: -13, z: 28, h: 3.8, yaw: 1.5 },
    { x: 13, z: 28, h: 3.8, yaw: 3.0 }
  ];
  // HQ conifers replaced with designed broadleaf gardens.

  // Plant in grouped bays, with the canopy set back and low foliage facing the paths.
  const plantedBays = [
    [-13, 7], [13, 7], [-13, 17.5], [13, 17.5],
    [-40, 16], [-32, 23], [-14, 25], [-35, -22], [-27, -29],
    [-10, -25], [8, -26], [-14, -34], [9, -36],
    [21, -34], [39, -35], [49, -29],
    [22, 22], [33, 24], [44, 27], [49, 17], [26, 5], [42, 3],
    [-35, -8], [-41, -15], [-24, -36], [-6, -40], [16, -42], [33, -42], [49, -38], [27, -4], [39, -4]
  ];
  const plantings = [
    [modelOak, 0, 0, 4.8],
    [modelPineTall, 2.9, -2.0, 4.1],
    [modelPineRound, -2.5, -1.65, 2.8],
    [modelBushDetailed, -1.55, 1.4, .82],
    [modelBushSmall, .0, 2.05, .72],
    [modelBush, 1.6, 1.2, .82],
    [modelBushSmall, 2.35, .35, .62]
  ].filter(([model]) => model).map(([model, dx, dz, height]) => {
    const size = new T.Box3().setFromObject(model).getSize(new T.Vector3());
    const scale = height / Math.max(size.y, .1);
    return {model, dx, dz, scale, radius: Math.hypot(size.x, size.z) * scale / 2};
  });
  function bayClear(x, z, radius) {
    if (!circulationClear(x, z, radius + .55)) return false;
    if (terrain.courts.some(c => !c.hidden &&
      Math.abs(x - c.x) < c.w / 2 + radius &&
      Math.abs(z - c.z) < c.d / 2 + radius)) return false;
    return L.buildings.every(b => {
      const [w, , d] = L.grades[b.grade];
      return Math.hypot(x - b.position[0], z - b.position[2]) >
        Math.hypot(w, d) / 2 + radius + .3;
    });
  }
  for (const [index, [cx, cz]] of plantedBays.entries()) {
    const angle = index * 2.399963;
    for (const {model, dx, dz, scale, radius} of plantings) {
      const x = cx + dx * Math.cos(angle) - dz * Math.sin(angle);
      const z = cz + dx * Math.sin(angle) + dz * Math.cos(angle);
      if (bayClear(x, z, radius)) placeModel(model, x, z, scale, angle, hqGarden, 0);
    }
  }

  // The median planting fits inside the straight inner curb.
  const medianLeaves = new T.MeshStandardMaterial({color:0x718e3d,flatShading:true});
  const medianTrunk = new T.MeshStandardMaterial({color:0x885d37});
  const medianCrown = new T.IcosahedronGeometry(1,1);
  for (const [x,z,r,h] of [[0,26.7,1.35,3.7],[-1.6,28.6,.78,1.55],[1.5,28.5,.7,1.2],[-.4,30.1,.62,.85],[-1.35,25.3,.55,.7],[1.45,25.1,.5,.65]]) {
    if (Math.abs(x) + r >= 3.5 || z - r <= 24.5 || z + r >= 31.2) continue;
    const ground = terrain.height(x,z) + .06;
    const trunkHeight = h * .42;
    const trunk = new T.Mesh(new T.CylinderGeometry(r * .11,r * .17,trunkHeight,6),medianTrunk);
    trunk.position.set(x,ground + trunkHeight / 2,z);
    const crown = new T.Mesh(medianCrown,medianLeaves);
    crown.scale.set(r,h * .36,r);
    crown.position.set(x,ground + h * .64,z);
    trunk.castShadow = crown.castShadow = crown.receiveShadow = true;
    trunk.userData.arrivalMedianPlant = crown.userData.arrivalMedianPlant = true;
    islandGroup.add(trunk,crown);
  }

  // 7. ROOFTOP GREEN GARDENS (Vườn cây trên mái các khối terrace)
  const roofGardens = new T.Group();
  roofGardens.name = 'rooftop-gardens';
  root.add(roofGardens);

  // Rooftop gardens on AI Team & Hermes terrace roofs
  for (const [rx, ry, rz] of [[24, 5.2 + 6.3, -26], [36, 4.5 + 4.5, -28], [24, 5.2 + 4.8, -15.5]]) {
    addBox(roofGardens, 2.8, 0.35, 1.6, rx, ry, rz, planterStoneMat);
    addBox(roofGardens, 2.5, 0.4, 1.3, rx, ry, rz, bushMat1);
  }

    // 8. IT COURTYARD LANDSCAPE & PROMENADE (He San Trong Khu IT - Nen Da Am Dong Nhat)

  const itCourtyardGroup = new T.Group();

  itCourtyardGroup.name = 'it-courtyard-plaza';

  root.add(itCourtyardGroup);



  const plazaX = 33, plazaZ = 15.0, plazaY = terrain.height(plazaX, plazaZ);



  // Sân IT Tech Plaza: Giữ quang đãng, sạch sẽ 100%, không đặt bồn đá hay cây lớn che khuất lối đi



  // 9. FINANCE & ADMIN COURTYARDS LANDSCAPE (Canh Quan San Trong Tai Chinh & Hanh Chinh)

  const courtyardGreens = new T.Group();

  courtyardGreens.name = 'department-courtyards-greens';

  root.add(courtyardGreens);



  // Sân Cảnh Tài Chính: Bồn cây garden1 từ city_free__pack và cây xanh đô thị tree2
  const finX = -35, finZ = 17.5, finY = terrain.height(finX, finZ);
  addBox(courtyardGreens, 2.8, 0.28, 1.8, finX, finY + 0.02, finZ, planterStoneMat);
  addBox(courtyardGreens, 2.5, 0.32, 1.5, finX, finY + 0.02, finZ, planterSoilMat);
  if (modelGarden) {
    placeModel(modelGarden, finX, finZ, 0.85, 0, courtyardGreens, 0.18);
  } else {
    addBushCluster(finX, finZ, 3, 0.35, 0.6);
  }
  if (modelBushSmall) {
    placeModel(modelBushSmall, finX - 1.6, finZ - 0.2, 0.6, 0.5, courtyardGreens);
    placeModel(modelBushSmall, finX + 1.6, finZ - 0.2, 0.6, 1.8, courtyardGreens);
  }
  addBox(courtyardGreens, 1.8, 0.16, 0.45, finX, finY + 0.16, finZ - 1.7, planterStoneMat);
  // Cây xanh đô thị thanh thoát tạo bóng mát phía sau khu Tài chính
  if (modelTree2) {
    placeModel(modelTree2, -37.5, 12.0, 1.15, 0.6, courtyardGreens);
  }



  // San Canh Hanh Chinh: Bon hoa va ghe da dat truc tiep tren nen da mai tu nhien

  const admX = -24, admZ = -17.5, admY = terrain.height(admX, admZ);

  addBox(courtyardGreens, 2.8, 0.28, 1.8, admX, admY + 0.02, -17.5, planterStoneMat);

  addBox(courtyardGreens, 2.5, 0.32, 1.5, admX, admY + 0.02, -17.5, planterSoilMat);

  addBushCluster(admX, admZ, 3, 0.35, 0.6);

  addBox(courtyardGreens, 1.8, 0.16, 0.45, admX, admY + 0.16, -19.0, planterStoneMat);



  // 10. CENTRAL COMMONS ORGANIC ACCENTS (Điểm Xuyết Cảnh Quan Công Viên Trung Tâm)

  const commonsGreens = new T.Group();

  commonsGreens.name = 'central-commons-accents';

  root.add(commonsGreens);



  // Cụm bụi cây hữu cơ mềm mại ven vành đai Central Commons (ngoài phạm vi đường dạo bộ)

  for (const [cx, cz] of [[-10.5, 5.0], [10.5, 5.0], [-10.5, 14.0], [10.5, 14.0]]) {

    addBushCluster(cx, cz, 3, 0.4, 0.65);

  }



  console.log('[POLISH] Art D3 Landscape Composition & Polish completed!');

  return { root, bushGroup, islandGroup, forecourtDeco, markingsGroup, itCourtyardGroup, courtyardGreens, commonsGreens };

}

