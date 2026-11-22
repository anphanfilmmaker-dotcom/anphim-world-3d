import * as T from 'three';
export async function createEcosystemDesign(scene,P,L,terrain,roads,registry,layers,report,A){
 const courts=[
    ['HQ Forecourt',0,6.1,23,8.2,0.6],
    ['Central Commons',0,-21,21,9,2],
    ['Administration',-21.75,-18,9.5,9,1.5],
    ['Finance',-25,15.85,13,4.1,0.65],
    ['IT Technical Court',32.5,15,19,4,1.2],
    ['IT Link',31.5,8.4,3.2,9.6,0.8],
    ['Finance Plaza',-30.5,21.2,11.5,6.4,1.2],
    ['Internal Upper',24,-20,9,3,1],
    ['Internal Middle',36,-24,7,3,1],
    ['Internal Lower',30,-11,21,5,1],
    ['Internal Level 1',47,-18,7,3,1]
  ];
 for(const [id,x,z,w,d,r]of courts)terrain.courts.push({id,x,z,w,d,r,useGroundTriangles:id==='Finance'});
  // (arrival-low-curb cu da go bo hoan toan de triet tieu 4 rau go da tho ra nga ba duong chinh)
 // Grounded stair assemblies with bottom and top landings. Adjacent paths remain ramps.
 // The central stone apron sits on the same triangulated terrain as the orange court.
 terrain.courts.push({id:'HQ Stone Apron',x:0,z:7.25,w:10.5,d:5.5,r:.18,kind:5,useGroundTriangles:true});
 terrain.rebuild(roads.paths);
 const stairDefs=terrain.stairDefs;
 // Chiếu nghỉ đầu/cuối bậc thang cùng tông đá với bậc (vật liệu địa hình cần vertex attribute riêng nên lên khối hộp bị đen)
 const landingMat=new T.MeshStandardMaterial({color:'#beb6a3',roughness:.9,polygonOffset:true,polygonOffsetFactor:-5,polygonOffsetUnits:-5});
 report.stairs=[];
 for(const def of stairDefs){const s={...def,rise:(def.high-def.low)/def.count};terrain.stairs.push(s);
 const checks=[];for(let i=0;i<s.count;i++){const a=s.start+i*(s.end-s.start)/s.count,b=s.start+(i+1)*(s.end-s.start)/s.count,top=s.high-i*s.rise;
 const x=s.axis==='x'?(a+b)/2:s.cross,z=s.axis==='z'?(a+b)/2:s.cross,w=s.axis==='x'?b-a:s.width,d=s.axis==='z'?b-a:s.width;
 const base=Math.min(terrain.height(x-w/2,z-d/2),terrain.height(x+w/2,z+d/2),s.low)-.08;
 const stairMat = new T.MeshStandardMaterial({ color: '#beb6a3', roughness: 0.90, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const mesh = new T.Mesh(new T.BoxGeometry(w, Math.max(.1, top - base), d), stairMat);mesh.position.set(x,(top+base)/2,z);mesh.name='stair:'+s.id+':'+i;mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);checks.push({top,base});}
 for(const [a,top]of [[s.start-.6,s.high],[s.end+.6,s.low]]){
   // Không tạo landing màu cam cho cầu thang sảnh chính HQ để loại bỏ hoàn toàn chấm cam ở 2 đầu cầu thang
   if (s.id === 'HQ arrival stair') continue;
   const x=s.axis==='x'?a:s.cross,z=s.axis==='z'?a:s.cross,w=s.axis==='x'?1.2:s.width,d=s.axis==='z'?1.2:s.width,base=Math.min(terrain.height(x,z),top)-.12;const m=new T.Mesh(new T.BoxGeometry(w,top-base,d),landingMat);m.position.set(x,(base+top)/2,z);m.name='landing:'+s.id;m.castShadow=m.receiveShadow=true;scene.add(m);
 }
 if (s.id === 'HQ arrival stair') {
   const depth = L.roadPlan.arrival.dropoffXZ[1] - L.roadPlan.arrival.width / 2 - s.end;
   if (depth > 0) {
     const z = s.end + depth / 2;
     const base = Math.min(s.low, ...[-1, 1].flatMap(x => [-1, 1].map(dz =>
       terrain.height(x * s.width / 2, z + dz * depth / 2)))) - .1;
     const stone = new T.MeshStandardMaterial({color:'#beb6a3',roughness:.9});
     const landing = new T.Mesh(new T.BoxGeometry(s.width,s.low-base,depth),stone);
     landing.position.set(s.cross,(s.low+base)/2,z);
     landing.receiveShadow = true;
     landing.name = 'landing:' + s.id + ':dropoff';
     scene.add(landing);
   }
 }
 report.stairs.push({...s,checks});}
 report.campusDesign={courts:terrain.courts,visitorDropoff:[0,17.5],commons:[0,-21],addedTrees:0,addedShrubs:0};
 report.terrainIntegration={singleSurface:true,zones:terrain.zones,surfaceTriangles:terrain.surfaces,curbHeight:.08,terrainLibraryModelsUsed:[],note:'Procedural surfaces selected; no coarse cliff modules placed. No additional landscape polish.'};
}
