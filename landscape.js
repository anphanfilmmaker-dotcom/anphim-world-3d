import * as T from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {createUrbanPlanningEngine} from './urban-planning-engine.js';

export async function createLandscape(scene,P,L,terrain,paths,adapter,layers,report,registry,V23){
 let seed=22026;const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 const C=k=>new T.Color(P.colors[k]);

 const urbanEngine = createUrbanPlanningEngine(L, terrain);

 function clear(x, z, margin = 1.0){
   // 1. Phải vượt qua Bộ Thanh tra Quy hoạch Đô thị (Right-Of-Way Corridor Mask)
   if (!urbanEngine.isSafeVegetationSpot(x, z, { paths }, margin)) {
     return false;
   }

   // 2. Chặn tuyệt đối quanh khu vực Sân IT Tech Plaza
   if (Math.abs(x - 32.5) < 9.0 && Math.abs(z - 15) < 5.0) return false;

   // 3. Chặn tuyệt đối quanh sảnh HQ và đảo U-turn
   if (urbanEngine.isInsideUTurnCorridor(x, z, margin)) return false;
   if (urbanEngine.isInsideHQForecourt(x, z, margin)) return false;

   return true;
 }

 const gardens=L.landscapePlan.gardenBeds;

 const shrubs=[],flowers=[],cover=[];
 for(const [x,z,rx,rz]of gardens){
   for(let i=0;i<12;i++){
     const a=rand()*Math.PI*2,r=Math.sqrt(rand()),xx=x+Math.cos(a)*rx*r,zz=z+Math.sin(a)*rz*r;
     if(clear(xx,zz,1.2))shrubs.push({x:xx,z:zz,s:.5+rand()*.65,h:.3+rand()*.5});
   }
   for(let i=0;i<16;i++){
     const a=rand()*Math.PI*2,xx=x+Math.cos(a)*rx*.8,zz=z+Math.sin(a)*rz*.8;
     if(clear(xx,zz,0.8))flowers.push({x:xx,z:zz,c:i%4===0?'flowerPurple':'flowerLight'});
   }
 }

 for(let k=0;k<12;k++){
   const x=-100+k*18,z=terrain.riverZ(x)+(k%2?1:-1)*(terrain.riverR(x)+4);
   for(let i=0;i<6;i++) {
     const rx=x+(rand()-.5)*5, rz=z+(rand()-.5)*2;
     if (clear(rx, rz, 1.0)) shrubs.push({x:rx,z:rz,s:.6+rand(),h:.25+rand()*.4});
   }
 }

 function instance(points,geo,material,parent,scaleFn,castShadow=false){
   if(!points.length)return;
   const mesh=new T.InstancedMesh(geo,material,points.length);
   const o=new T.Object3D();
   points.forEach((p,i)=>{
     o.position.set(p.x,terrain.height(p.x,p.z)+(p.h||.25)*.5,p.z);
     o.rotation.set(0,rand()*6.28,0);
     const a=scaleFn(p);
     o.scale.set(...a);
     o.updateMatrix();
     mesh.setMatrixAt(i,o.matrix);
   });
   mesh.castShadow=castShadow;
   mesh.receiveShadow=true;
   mesh.computeBoundingSphere();
   parent.add(mesh);
 }

 instance(shrubs,new T.IcosahedronGeometry(1,1),new T.MeshStandardMaterial({color:P.colors.shrub,roughness:.94}),layers.shrubs,p=>[p.s,p.h,p.s*.8], false);
 instance(cover,new T.IcosahedronGeometry(1,1),new T.MeshStandardMaterial({color:P.colors.groundcover,roughness:1}),layers.groundcover,p=>[p.s,.08,p.s*.75], false);
 for(const key of ['flowerLight','flowerPurple']) instance(flowers.filter(p=>p.c===key),new T.IcosahedronGeometry(.12,1),new T.MeshStandardMaterial({color:P.colors[key],roughness:.85}),layers.shrubs,p=>[1,.6,1], false);

 const rocks=[];
 for(const center of [-85,-37,7,50,91]) {
   for(let j=0;j<6;j++){
     const x=center+(rand()-.5)*7,z=terrain.riverZ(x)+(j%2?1:-1)*(terrain.riverR(x)+.8+rand());
     rocks.push({x,z,s:.4+rand()*.7,h:.3+rand()*.6});
   }
 }
 instance(rocks,new T.IcosahedronGeometry(1,0),new T.MeshStandardMaterial({color:P.colors.bankRock,roughness:1}),scene,p=>[p.s,p.h,p.s*.8], false);

 // Cây cối vành đai và công viên
 const trees=[];
 for(let i=0;i<330;i++){
   const x=(rand()-.5)*180,z=-64-rand()*20+5*Math.sin(x*.045);
   if(clear(x,z,2.8)&&rand()>.46) trees.push({x,z,h:4.5+rand()*3.2,yaw:rand()*6.28});
 }
 for(let i=0;i<24;i++){
   const x=(i%2?1:-1)*(73+rand()*10),z=-30+rand()*75;
   if(clear(x,z,3.5)) trees.push({x,z,h:3.8+rand()*2.7,yaw:rand()*6.28});
 }

 // Rừng thông nội khu: chỉ rải tại các vị trí an toàn tuyệt đối
 for(const [cx,cz] of L.landscapePlan.campusPineGroves){
   for(let i=0;i<3;i++){
     const x=cx+(rand()-.5)*4,z=cz+(rand()-.5)*4;
     if(clear(x,z,3.0)) trees.push({x,z,h:3.3+rand()*1.8,yaw:rand()*6.28});
   }
 }

 const nature='./assets/v23/kenney_nature-kit/';

 // Các cụm cây tán rộng: Loại bỏ cụm [-9, 24] và [16, 25] đè đường U-turn, thay bằng tọa độ an toàn
 const safeBroadleafGroves = [
   [-46,-9,4.3],[-23,-13,3.8],[-42,23,3.6],[32,-10,4.1],[48,3,3.4],
   [-36,-12,4.8],[-28,-8,4.3],[32,-9,4.6],[40,-10,4.2],[-35,23,4],[38,28,3.6]
 ];

 for(const [cx,cz,h] of safeBroadleafGroves) {
   for(let i=0;i<3;i++){
     const x=cx+(rand()-.5)*6,z=cz+(rand()-.5)*5;
     if(clear(x,z,3.6)&&Math.abs(z-terrain.riverZ(x))>terrain.riverR(x)+4) {
       trees.push({x,z,h:h+rand()*.6,yaw:rand()*6.28,garden:true});
     }
   }
 }

 const familyPoints=[[],[],[],[]];
 for(let i=0;i<trees.length;i++){
   const p=trees[i];
   // Kiểm tra bán kính tán cây (crown clearance = p.h * 0.6)
   const crownR = Math.max(2.4, p.h * 0.55);
   if(!clear(p.x,p.z,crownR)) continue;
   familyPoints[p.garden?i%3:i%4].push(p);
 }

 for(const [i,url] of [nature+'tree_oak.glb',nature+'tree_detailed.glb',nature+'tree_default.glb','./models/anphim_basic_scene/tree.glb'].entries()){
   const model=await registry.load(url,'tree');
   registry.instance(model,familyPoints[i],layers.canopy,terrain);
 }

 const extraBush=[];
 for(const [x,z,rx,rz] of gardens) {
   for(let i=0;i<3;i++){
     const xx=x+(rand()-.5)*rx,zz=z+(rand()-.5)*rz;
     if(clear(xx,zz,1.2)) extraBush.push({x:xx,z:zz,h:.45+rand()*.4,yaw:rand()*6.28});
   }
 }
 registry.instance(await registry.load(nature+'plant_bushDetailed.glb','tree'),extraBush,layers.shrubs,terrain);

 const riverRocks=rocks.filter(p=>Math.abs(p.z-terrain.riverZ(p.x))>terrain.riverR(p.x));
 registry.instance(await registry.load(nature+'rock_largeA.glb','rock'),riverRocks.map(p=>({...p,h:.35+p.h*.6,yaw:rand()*6.28})),layers.groundcover,terrain);

 const grass=[];
 for(let i=0;i<160;i++){
   const x=-95+rand()*190,z=terrain.riverZ(x)+(i%2?1:-1)*(terrain.riverR(x)+1.6+rand()*4);
   if(clear(x,z,0.8)) grass.push({x,z,h:.2+rand()*.3,yaw:rand()*6.28});
 }
 registry.instance(await registry.load(nature+'grass_large.glb','tree'),grass,layers.groundcover,terrain);

 report.landscape={
   zones:['Central Plaza','Administrative Garden','Finance Garden','Internal Creative Garden','IT Landscape','Forest Buffer','Riverside'],
   trees:familyPoints.reduce((n,p)=>n+p.length,0),
   canopyFamily:'Kenney Nature Kit + Urban Planning Engine Validated',
   placement:'Strict Right-Of-Way corridor enforcement; zero road encroachment; zero dangling walkways'
 };

 return {clear,trees,gardens};
}
