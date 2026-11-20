import * as T from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
export async function createLandscape(scene,P,L,terrain,paths,adapter,layers,report,registry,V23){
 let seed=22026;const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 const C=k=>new T.Color(P.colors[k]);
 function clear(x,z,margin=.6){for(const b of L.buildings){const g=L.grades[b.grade];if(Math.abs(x-b.position[0])<g[0]/2+margin&&Math.abs(z-b.position[2])<g[2]/2+margin)return false;}for(const p of paths){const n=Math.ceil(p.curve.getLength());for(let i=0;i<=n;i++){const q=p.curve.getPointAt(i/n);if((x-q.x)**2+(z-q.z)**2<(p.width/2+margin)**2)return false;}}return true;}
 function patch(x,z,rx,rz,key,parent=layers.groundcover){const v=[],cs=[],ind=[],N=32,R=8,base=C(key);for(let j=0;j<=R;j++)for(let i=0;i<=N;i++){const a=i/N*Math.PI*2,r=j/R,shape=1+.06*Math.sin(a*3+x),xx=x+Math.cos(a)*rx*r*shape,zz=z+Math.sin(a)*rz*r*shape;v.push(xx,terrain.height(xx,zz)+.12,zz);const c=base.clone().lerp(C('meadow'),Math.pow(r,3)*.9);cs.push(c.r,c.g,c.b);}for(let j=0;j<R;j++)for(let i=0;i<N;i++){const a=j*(N+1)+i;ind.push(a,a+N+1,a+1,a+1,a+N+1,a+N+2);}const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(v,3));geo.setAttribute('color',new T.Float32BufferAttribute(cs,3));geo.setIndex(ind);geo.computeVertexNormals();const m=new T.Mesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:1,side:T.DoubleSide}));m.receiveShadow=true;parent.add(m);}

 // Plaza is a landscape surface, not a fourth road width.
 patch(0,11,14,9,'stone',scene);
 const gardens=L.landscapePlan.gardenBeds;
 // Designed garden rooms frame the campus diagonals while preserving the central sightline.
 for(const [x,z,rx,rz]of [[-31,-12,10,6],[-34,23,11,5],[34,-10,12,6],[39,29,12,4]])patch(x,z,rx,rz,'groundcover');
 const shrubs=[],flowers=[],cover=[];
 for(const [x,z,rx,rz]of gardens){patch(x,z,rx,rz,'groundcover');for(let i=0;i<12;i++){const a=rand()*Math.PI*2,r=Math.sqrt(rand()),xx=x+Math.cos(a)*rx*r,zz=z+Math.sin(a)*rz*r;if(clear(xx,zz,.25))shrubs.push({x:xx,z:zz,s:.5+rand()*.65,h:.3+rand()*.5});}for(let i=0;i<16;i++){const a=rand()*Math.PI*2,xx=x+Math.cos(a)*rx*.8,zz=z+Math.sin(a)*rz*.8;if(clear(xx,zz,.1))flowers.push({x:xx,z:zz,c:i%4===0?'flowerPurple':'flowerLight'});}}
 // Alternating river clearings, neither continuous hedge nor even rock spacing.
 for(let k=0;k<12;k++){const x=-100+k*18,z=terrain.riverZ(x)+(k%2?1:-1)*(terrain.riverR(x)+4);patch(x,z,4+rand()*2,2+rand(),'groundcover');for(let i=0;i<6;i++)shrubs.push({x:x+(rand()-.5)*5,z:z+(rand()-.5)*2,s:.6+rand(),h:.25+rand()*.4});}
 for(const [x,z,rx,rz]of [[-43,-5,10,6],[-21,-40,9,4],[36,-5,12,6],[30,30,9,3],[-30,29,10,3],[-11,-25,5,7]])patch(x,z,rx,rz,'lawn');
 function instance(points,geo,material,parent,scaleFn){if(!points.length)return;const mesh=new T.InstancedMesh(geo,material,points.length);const o=new T.Object3D();points.forEach((p,i)=>{o.position.set(p.x,terrain.height(p.x,p.z)+(p.h||.25)*.5,p.z);o.rotation.set(0,rand()*6.28,0);const a=scaleFn(p);o.scale.set(...a);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();parent.add(mesh);}
 instance(shrubs,new T.IcosahedronGeometry(1,1),new T.MeshStandardMaterial({color:P.colors.shrub,roughness:.94}),layers.shrubs,p=>[p.s,p.h,p.s*.8]);
 instance(cover,new T.IcosahedronGeometry(1,1),new T.MeshStandardMaterial({color:P.colors.groundcover,roughness:1}),layers.groundcover,p=>[p.s,.08,p.s*.75]);
 for(const key of ['flowerLight','flowerPurple'])instance(flowers.filter(p=>p.c===key),new T.IcosahedronGeometry(.12,1),new T.MeshStandardMaterial({color:P.colors[key],roughness:.85}),layers.shrubs,p=>[1,.6,1]);
 const rocks=[];for(const center of [-85,-37,7,50,91])for(let j=0;j<6;j++){const x=center+(rand()-.5)*7,z=terrain.riverZ(x)+(j%2?1:-1)*(terrain.riverR(x)+.8+rand());rocks.push({x,z,s:.4+rand()*.7,h:.3+rand()*.6});}instance(rocks,new T.IcosahedronGeometry(1,0),new T.MeshStandardMaterial({color:P.colors.bankRock,roughness:1}),scene,p=>[p.s,p.h,p.s*.8]);
 const trees=[];for(let i=0;i<330;i++){const x=(rand()-.5)*180,z=-64-rand()*20+5*Math.sin(x*.045);if(clear(x,z,2)&&rand()>.46)trees.push({x,z,h:4.5+rand()*3.2,yaw:rand()*6.28});}for(let i=0;i<24;i++){const x=(i%2?1:-1)*(73+rand()*10),z=-30+rand()*75;if(clear(x,z,3))trees.push({x,z,h:3.8+rand()*2.7,yaw:rand()*6.28});}
 for(const [cx,cz]of L.landscapePlan.campusPineGroves)for(let i=0;i<3;i++){const x=cx+(rand()-.5)*4,z=cz+(rand()-.5)*4;if(clear(x,z,2))trees.push({x,z,h:3.3+rand()*1.8,yaw:rand()*6.28});}
 // A designed broadleaf transition replaces the old all-conifer buffer.
 const nature='./assets/v23/kenney_nature-kit/';
 // Keep original Starter Kit conifers as a minority, with broadleaf gardens inside the ring.
 for(const [cx,cz,h]of [[-46,-9,4.3],[-23,-13,3.8],[-42,23,3.6],[32,-10,4.1],[48,3,3.4],[-9,24,3.7],[16,25,3.6],[-36,-12,4.8],[-28,-8,4.3],[32,-9,4.6],[40,-10,4.2],[-35,23,4],[38,28,3.6]])
  for(let i=0;i<3;i++){const x=cx+(rand()-.5)*6,z=cz+(rand()-.5)*5;if(clear(x,z,3.2)&&Math.abs(z-terrain.riverZ(x))>terrain.riverR(x)+4)trees.push({x,z,h:h+rand()*.6,yaw:rand()*6.28,garden:true});}
 const familyPoints=[[],[],[],[]];
 for(let i=0;i<trees.length;i++){const p=trees[i];if(!clear(p.x,p.z,p.h*.4)||Math.abs(p.z-terrain.riverZ(p.x))<terrain.riverR(p.x)+3)continue;familyPoints[p.garden?i%3:i%4].push(p);}
 for(const [i,url]of [nature+'tree_oak.glb',nature+'tree_detailed.glb',nature+'tree_default.glb','./models/anphim_basic_scene/tree.glb'].entries()){
  const model=await registry.load(url,'tree');registry.instance(model,familyPoints[i],layers.canopy,terrain);
 }
 const extraBush=[];for(const [x,z,rx,rz]of gardens)for(let i=0;i<3;i++){const xx=x+(rand()-.5)*rx,zz=z+(rand()-.5)*rz;if(clear(xx,zz,.7))extraBush.push({x:xx,z:zz,h:.45+rand()*.4,yaw:rand()*6.28});}
 registry.instance(await registry.load(nature+'plant_bushDetailed.glb','tree'),extraBush,layers.shrubs,terrain);
 const riverRocks=rocks.filter(p=>Math.abs(p.z-terrain.riverZ(p.x))>terrain.riverR(p.x));
 registry.instance(await registry.load(nature+'rock_largeA.glb','rock'),riverRocks.map(p=>({...p,h:.35+p.h*.6,yaw:rand()*6.28})),layers.groundcover,terrain);
 const grass=[];for(let i=0;i<160;i++){const x=-95+rand()*190,z=terrain.riverZ(x)+(i%2?1:-1)*(terrain.riverR(x)+1.6+rand()*4);if(clear(x,z,.5))grass.push({x,z,h:.2+rand()*.3,yaw:rand()*6.28});}
 registry.instance(await registry.load(nature+'grass_large.glb','tree'),grass,layers.groundcover,terrain);
 report.vegetationPlacement=familyPoints.flatMap((ps,i)=>ps.map(p=>({...p,family:i,clearance:p.h*.4})));
 report.landscape={zones:['Central Plaza','Administrative Garden','Finance Garden','Internal Creative Garden','IT Landscape','Forest Buffer','Riverside'],gardenBeds:gardens.length,shrubs:shrubs.length+extraBush.length,flowers:flowers.length,groundcoverInstances:grass.length,rocks:rocks.length+riverRocks.length,trees:familyPoints.reduce((n,p)=>n+p.length,0),treeFamilies:familyPoints.map((p,i)=>({family:['oak','detailed','default','conifer'][i],count:p.length})),canopyFamily:'User authorized Kenney Nature Kit + Starter Kit buffer conifers',newExternalCanopyActivated:true,broadleafStatus:'authorized by V2.3 brief',placement:'seeded zone clusters; grade envelope + crown clearance; roads excluded; river excluded'};
 return {clear,trees,gardens,patch};
}
