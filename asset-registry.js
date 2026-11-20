import * as T from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
// Registry owns source loading/material adaptation; each recipe has one shared GPU source.
export function createAssetRegistry(adapter,report){
 const loader=new GLTFLoader(),cache=new Map(),materials=new Map();
 async function load(url,kind='building'){
  const key=url+'|'+kind;if(cache.has(key))return cache.get(key);
  const promise=(async()=>{const gltf=await loader.loadAsync(url),root=gltf.scene;root.updateMatrixWorld(true);const flat=new T.Group();
   root.traverse(o=>{if(!o.isMesh)return;const geo=o.geometry.clone().applyMatrix4(o.matrixWorld);const adapt=m=>{const k=kind+m.uuid;if(!materials.has(k))materials.set(k,adapter(m,kind));return materials.get(k);};const m=new T.Mesh(geo,Array.isArray(o.material)?o.material.map(adapt):adapt(o.material));m.castShadow=m.receiveShadow=true;flat.add(m);});
   report.loadedAssets.push(url);return flat;
  })();cache.set(key,promise);return promise;
 }
 async function building(binding,A,role){const source=await load(binding.url),g=source.clone(true);g.rotation.y=binding.rotationY||0;g.updateMatrixWorld(true);
  // Bake orientation, center base and author a consistent entrance at +Z.
  for(const m of g.children){m.geometry=m.geometry.clone().applyMatrix4(g.matrix);};g.rotation.set(0,0,0);g.updateMatrixWorld(true);
  const b=new T.Box3().setFromObject(g),s=b.getSize(new T.Vector3()),c=b.getCenter(new T.Vector3());
  for(const m of g.children)m.position.set(-c.x,-b.min.y,-c.z);
  // Entry adapter is deliberately subordinate to the native facade; a fixed socket keeps navigation explicit.
  const w=Math.min(s.x*.28,.35),z=s.z/2;
  A.box(g,w,.025,.17,0,.02,z+.04,A.M.stone);A.box(g,w+.04,.028,.14,0,Math.min(s.y*.24,.38),z+.035,A.M.orange);
  if(role==='bank'){A.sign(g,'BANK',s.x*.48,s.y*.13,0,s.y*.40,z+.08);}
  const socket=new T.Object3D();socket.name='entry-socket';socket.position.set(0,0,z+.13);g.add(socket);return g;
 }
 function instance(root,points,parent,terrain){root.updateMatrixWorld(true);const b=new T.Box3().setFromObject(root),sz=b.getSize(new T.Vector3()),c=b.getCenter(new T.Vector3());
  for(const mesh of root.children){const geo=mesh.geometry.clone();geo.translate(-c.x,-b.min.y,-c.z);const m=new T.InstancedMesh(geo,mesh.material,points.length),o=new T.Object3D();for(let i=0;i<points.length;i++){const p=points[i];o.position.set(p.x,terrain.height(p.x,p.z)+(p.yOffset||0),p.z);o.rotation.y=p.yaw||0;o.scale.setScalar(p.h/sz.y);o.updateMatrix();m.setMatrixAt(i,o.matrix);}m.castShadow=m.receiveShadow=true;m.computeBoundingSphere();parent.add(m);}
 }
 return {load,building,instance};
}
