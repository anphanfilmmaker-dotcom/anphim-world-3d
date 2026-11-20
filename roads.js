import * as T from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {OBJLoader} from './vendor/OBJLoader.js';
import {MTLLoader} from './vendor/MTLLoader.js';
import {ribbon} from './terrain.js';
export async function createRoads(scene,P,L,terrain,adapter,report){
 const glb=await new GLTFLoader().loadAsync('./models/anphim_city_roads/road-straight.glb');
 const base='./models/anphim_internal_roads/';const mtl=await new MTLLoader().setPath(base).loadAsync('anphim_kenney_street.mtl');mtl.preload();const obj=await new OBJLoader().setMaterials(mtl).setPath(base).loadAsync('anphim_kenney_street.obj');
 report.loadedAssets.push('./models/anphim_city_roads/road-straight.glb',base+'anphim_kenney_street.obj',base+'anphim_kenney_street.mtl');
 const paths=[],roadMaterials=new Map();
 function modelRoad(source,curve,width,id,closed=false){source.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(source),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),len=curve.getLength(),N=Math.ceil(len/3),root=new T.Group();root.name=id;scene.add(root);const buckets=new Map();
 for(let n=0;n<N;n++)source.traverse(o=>{if(!o.isMesh)return;const geo=o.geometry.clone();geo.applyMatrix4(o.matrixWorld);const p=geo.attributes.position;for(let i=0;i<p.count;i++){const u=(p.getX(i)-bounds.min.x)/size.x,t=(n+u)/N,point=curve.getPointAt(Math.min(1,t)),tan=curve.getTangentAt(Math.min(.999999,t)),across=(p.getZ(i)-center.z)/size.z*width,xx=point.x-tan.z*across,zz=point.z+tan.x*across,yy=terrain.height(xx,zz)+.14+(p.getY(i)-bounds.min.y)*width/size.z;p.setXYZ(i,xx,yy,zz);}geo.computeVertexNormals();const m=new T.Mesh(geo,Array.isArray(o.material)?o.material.map(x=>width===4?new T.MeshStandardMaterial({color:P.colors[x.name==='Grass'?'lawn':x.name==='Stone'?'stone':'asphalt'],roughness:1}):adapter(x,'road')):(width===4?new T.MeshStandardMaterial({color:P.colors[o.material.name==='Grass'?'lawn':o.material.name==='Stone'?'stone':'asphalt'],roughness:1}):adapter(o.material,'road')));m.receiveShadow=true;
 const originals=Array.isArray(o.material)?o.material:[o.material];
 function bucket(g,original,adapted){const key=width+':'+original.uuid;if(!roadMaterials.has(key))roadMaterials.set(key,adapted);const material=roadMaterials.get(key);if(!buckets.has(material))buckets.set(material,[]);buckets.get(material).push(g);}
 if(originals.length===1)bucket(geo,originals[0],m.material);
 else for(const group of geo.groups){const part=new T.BufferGeometry();for(const [name,attr]of Object.entries(geo.attributes))part.setAttribute(name,attr);if(geo.index)part.setIndex(new T.BufferAttribute(geo.index.array.slice(group.start,group.start+group.count),1));else{for(const [name,attr]of Object.entries(geo.attributes))part.setAttribute(name,new T.BufferAttribute(attr.array.slice(group.start*attr.itemSize,(group.start+group.count)*attr.itemSize),attr.itemSize));}bucket(part,originals[group.materialIndex],m.material[group.materialIndex]);}
 });for(const [material,geos]of buckets){const merged=mergeGeometries(geos,false);if(merged){const m=new T.Mesh(merged,material);m.receiveShadow=true;root.add(m);}else for(const g of geos){const m=new T.Mesh(g,material);m.receiveShadow=true;root.add(m);}}paths.push({id,width,curve,class:width===8?3:2,closed});
 }
 const pts=[];for(const [cx,cz,start] of L.roadPlan.ringCorners)for(let j=0;j<=10;j++){const a=(start+j*9)*Math.PI/180;pts.push(new T.Vector3(cx+L.roadPlan.ringCornerRadius*Math.cos(a),0,cz+L.roadPlan.ringCornerRadius*Math.sin(a)));}
 const ring=new T.CatmullRomCurve3(pts,true,'centripetal');modelRoad(glb.scene,ring,8,'road:campus-ring',true);
 const marking=new T.MeshStandardMaterial({color:P.colors.roadMarking,roughness:1,side:T.DoubleSide});for(let n=0;n<Math.floor(ring.getLength()/6);n++){const t=n/Math.floor(ring.getLength()/6),a=ring.getPointAt(t),b=ring.getPointAt((t+2/ring.getLength())%1);ribbon(scene,[[a.x,a.z],[b.x,b.z]],.13,marking,terrain.height,.36);}
 for(const x of [0,13])for(let z=32.5;z<39.5;z+=1.05)ribbon(scene,[[x-1,z],[x+1,z]],.5,marking,terrain.height,.37);
 const branches=L.roadPlan.branches;
 for(const [id,coords] of branches){const curve=new T.CatmullRomCurve3(coords.map(([x,z])=>new T.Vector3(x,0,z)));modelRoad(obj,curve,4,'road:'+id);}
 const walkMat=new T.MeshStandardMaterial({color:P.colors.walk,roughness:.98,side:T.DoubleSide});
 function walk(id,points){const r=ribbon(scene,points,2,walkMat,terrain.height,.21);paths.push({id,points,width:2,class:1,curve:r.curve});return r;}
 for(const [id,points]of L.roadPlan.walks)walk(id,points);
 // Source geometry owns widths; lower classes terminate at the higher class edge.
 // No junction tile is laid across the class-3 ring at mixed-class entries.
 report.roads=paths.map(p=>({id:p.id,class:p.class,width:p.width,priority:p.class,mixedClassPolicy:'lower class stops at upper edge'}));
 return {paths,walk,walkMat};
}
