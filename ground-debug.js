import * as T from 'three';
export function createGroundDebug(scene,terrain,roads,buildings,report){
 const group=new T.Group();scene.add(group);group.visible=false;
 const original=terrain.materials;const debug=original.map((m,i)=>new T.MeshStandardMaterial({color:['#568763','#465a78','#dda34e','#c67858','#a77ab3','#6fb3c4'][i]??'#8f8a7a',roughness:1,wireframe:false}));
 const g=terrain.terrain.geometry,p=g.attributes.position;const colors=[];
 for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),s=Math.hypot((terrain.height(x+.25,z)-terrain.height(x-.25,z))/.5,(terrain.height(x,z+.25)-terrain.height(x,z-.25))/.5);const c=new T.Color().setHSL(.34-Math.min(s,1)*.34,.65,.48);colors.push(c.r,c.g,c.b);}
 g.setAttribute('color',new T.Float32BufferAttribute(colors,3));const slope=new T.MeshStandardMaterial({vertexColors:true,roughness:1});
 // Real vertex/triangle-based foundation contact measurements.
 const contacts=[];for(const [id,obj]of buildings){obj.updateMatrixWorld(true);const box=new T.Box3().setFromObject(obj),samples=[];for(const x of [box.min.x,(box.min.x+box.max.x)/2,box.max.x])for(const z of [box.min.z,(box.min.z+box.max.z)/2,box.max.z])samples.push(terrain.height(x,z)-box.min.y);contacts.push({id,min:Math.min(...samples),max:Math.max(...samples),status:Math.max(...samples.map(Math.abs))<.12?'PASS':'REVIEW'});const h=new T.Box3Helper(box,contacts.at(-1).status==='PASS'?0x55cc88:0xff5544);group.add(h);}
 const profiles=roads.paths.filter(p=>p.class>1).map(p=>{let maxSlope=0,maxCrossSlope=0,previous;const samples=[];for(let i=0;i<=400;i++){const q=p.curve.getPointAt(i/400),t=p.curve.getTangentAt(Math.min(.999999,i/400));q.y=terrain.height(q.x,q.z);if(previous)maxSlope=Math.max(maxSlope,Math.abs(q.y-previous.y)/Math.hypot(q.x-previous.x,q.z-previous.z));const l=terrain.height(q.x-t.z*p.width/2,q.z+t.x*p.width/2),r=terrain.height(q.x+t.z*p.width/2,q.z-t.x*p.width/2);maxCrossSlope=Math.max(maxCrossSlope,Math.abs(l-r)/p.width);samples.push(q.toArray());previous=q;}return {id:p.id,maxSlope,maxCrossSlope,samples};});
 report.geometryQA={method:'Actual terrain triangle interpolation; world-space building bounding-box contact samples; 401 longitudinal/crossfall samples per road',foundationContacts:contacts,roadProfiles:profiles,unverified:['Full triangle-triangle intersection sweep','Vehicle swept turning envelope','Stair landing contact (stairs not yet authored)'],status:'INCOMPLETE'};
 function set(mode){group.visible=mode==='contact';terrain.terrain.material=mode==='ground'?debug:mode==='elevation'?original.map(()=>slope):original;report.groundDebug=mode;}
 const gdEl = document.querySelector('#ground-debug'); if (gdEl) gdEl.onchange=e=>set(e.target.value); return {set};
}
