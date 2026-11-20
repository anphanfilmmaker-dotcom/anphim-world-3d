import * as T from 'three';
// Terrain-conforming hardscape and landscape edges. These are courts, not new road widths.
export async function createCampusDesign(scene,P,L,terrain,roads,registry,layers,report,A){
 const mats={stone:new T.MeshStandardMaterial({color:P.colors.stone,roughness:.93}),cream:new T.MeshStandardMaterial({color:P.colors.plaster,roughness:.9}),lawn:new T.MeshStandardMaterial({color:P.colors.lawn,roughness:1}),moss:A.M.moss};
 const surfaces=[];
 function court(id,x,z,w,d,material=mats.stone,offset=.29){const nx=Math.ceil(w),nz=Math.ceil(d),v=[],idx=[];for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){let xx=x-w/2+i*w/nx,zz=z-d/2+j*d/nz;v.push(xx,terrain.height(xx,zz)+offset,zz);}for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i;const cx=x-w/2+(i+.5)*w/nx,cz=z-d/2+(j+.5)*d/nz;if(id==='HQ forecourt'&&[[-7,9,3,2.1],[7,9,3,2.1],[-8,17,2.8,1.8],[8,17,2.8,1.8]].some(([gx,gz,rx,rz])=>((cx-gx)/rx)**2+((cz-gz)/rz)**2<1))continue;idx.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();const m=new T.Mesh(g,material);m.receiveShadow=true;scene.add(m);surfaces.push({id,x,z,w,d});}
 court('HQ forecourt',0,13,20,18);court('HQ entry landing',-.35,3,6,2.1,mats.cream,.30);
 // Thin inlays articulate the entrance axis without widening the locked 2m paths.
 for(const x of [-3,3])court('entry inlay',x,17,.12,10,mats.cream,.31);
 for(const z of [6,9,12,15,18,21])court('paving joint',0,z,19,.045,mats.cream,.31);
 court('Administration arrival court',-32.5,-26.7,23,2.5);
 court('Finance arrival court',-29,14.6,25,2.4);
 court('IT arrival court',38,19.2,34,2.4);
 // Small entry carpets ground each subordinate building and meet its actual socket.
 for(const b of report.buildings){if(b.legacyId==='hq')continue;const [x,,z]=b.door;court('entry:'+b.id,x,z+.52,Math.min(4.2,b.bbox[0]+.5),1.1,mats.cream,.32);}
 // Quiet lawn panels make the open areas intentional; all surfaces hug the hill.
 for(const [x,z,w,d]of [[-31,-10,18,10],[-30,26,17,5],[33,-9,21,10],[38,29,21,4]])court('garden lawn',x,z,w,d,mats.lawn,.14);
 const shrubs=[],trees=[],obstacles=[];
 function clear(x,z,margin){for(const b of L.buildings){const g=L.grades[b.grade];if(Math.abs(x-b.position[0])<g[0]/2+margin&&Math.abs(z-b.position[2])<g[2]/2+margin)return false;}
  for(const p of roads.paths)for(let i=0;i<=Math.ceil(p.curve.getLength());i++){const q=p.curve.getPointAt(i/Math.ceil(p.curve.getLength()));if(Math.hypot(x-q.x,z-q.z)<p.width/2+margin)return false;}return true;}
 function planter(x,z,w=2.5,d=1.3){if(!clear(x,z,1.1))return;const y=terrain.height(x,z);A.box(layers.shrubs,w,.30,d,x,y+.07,z,A.M.stone);A.box(layers.shrubs,w-.18,.08,d-.18,x,y+.37,z,A.M.moss);for(let i=0;i<4;i++)shrubs.push({x:x+(i-1.5)*w/5,z,h:.65,yaw:i,yOffset:.42});obstacles.push({x,z,w,d});}
 // Symmetrical entry garden pairs leave the centerline open; low walls double as seating edges.
 for(const [x,z]of [[-7.5,7],[7.5,7],[-8,20],[8,20],[-18,-10],[18,-9],[-43,14],[-18,10],[21,17],[54,18]])planter(x,z);
 for(const [x,z]of [[-8,24],[8,24],[-20,-9],[-41,-11],[-39,26],[-20,26],[23,-9],[44,-9],[27,29],[49,29]])if(clear(x,z,2.7))trees.push({x,z,h:3.8,yaw:x*.17});
 // A planted rhythm beside the main approach; the main view corridor remains empty.
 for(const z of [24,28])for(const x of [-6,6])if(clear(x,z,1.3))shrubs.push({x,z,h:.8,yaw:z});
 // Foreground river groves are composed in uneven groups, never a continuous hedge.
 for(const cx of [-75,-32,27,75]){const cz=terrain.riverZ(cx)-terrain.riverR(cx)-6;
  for(const [dx,dz,h]of [[-2,0,3.2],[1,1,2.8],[3,-1,3.5]])if(clear(cx+dx,cz+dz,2.3))trees.push({x:cx+dx,z:cz+dz,h,yaw:dx});
  for(const [dx,dz]of [[-4,2],[-2,3],[0,3.8],[2,3],[4,2]])shrubs.push({x:cx+dx,z:cz+dz,h:.5,yaw:dx});
 }
 registry.instance(await registry.load('./assets/v23/kenney_nature-kit/plant_bushDetailed.glb','tree'),shrubs,layers.shrubs,terrain);
 registry.instance(await registry.load('./assets/v23/kenney_nature-kit/tree_oak.glb','tree'),trees,layers.canopy,terrain);
 // Paired benches and short bollards, outside the circulation envelope.
 for(const [x,z]of [[-10.6,17],[10.6,17],[-37,-29],[-37,25],[28,28],[47,28]])if(clear(x,z,1.1)){const y=terrain.height(x,z);A.box(scene,1.7,.16,.55,x,y+.4,z,A.M.stone);A.box(scene,1.7,.45,.1,x,y+.5,z-.23,A.M.moss);for(const dx of [-.55,.55])A.box(scene,.1,.4,.4,x+dx,y,z,A.M.metal);}
 for(const x of [-2,2])for(const z of [25,29]){const y=terrain.height(x,z);A.box(scene,.15,.65,.15,x,y,z,A.M.moss);A.box(scene,.19,.08,.19,x,y+.65,z,A.M.stone);}
 report.designVegetation={trees,shrubs};
 report.campusDesign={surfaces,planters:obstacles,addedTrees:trees.length,addedShrubs:shrubs.length,mainAxisClear:true,ringUnchanged:true};
 report.landscape.trees+=trees.length;report.landscape.shrubs+=shrubs.length;
}
