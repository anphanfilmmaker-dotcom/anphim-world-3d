import * as T from 'three';
import {applyCampusPaving} from './paving-pattern.js';
export function createTerrain(scene,P,L){
 const smooth=t=>{t=T.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
 const riverZ=x=>67+5.2*Math.sin(x*.027)+1.5*Math.sin(x*.072),riverR=x=>3.2+.55*Math.sin(x*.035)+.35*Math.cos(x*.083);
 const pads=L.buildings.map(b=>({id:b.id,x:b.position[0],z:b.position[2],y:b.position[1],hx:L.grades[b.grade][0]/2+.4,hz:L.grades[b.grade][2]/2+.4}));
 if(L.schedule) pads.push({id:L.schedule.id,x:17,z:31.5,y:3.8,hx:2.2,hz:.8,feather:1.0});
 const stairDefs=[{id:'HQ arrival stair',axis:'z',cross:0,start:10,end:15,high:6.8,low:5.2,count:10,width:5.0},{id:'Internal 4 to 3',axis:'x',cross:-20,start:29.5,end:32,high:5.2,low:4.5,count:5,width:1.8},{id:'Internal 3 to 2',axis:'z',cross:36,start:-23,end:-20,high:4.5,low:3.8,count:5,width:1.8},{id:'Internal 2 to 1',axis:'x',cross:-18,start:42,end:45,high:3.8,low:3.1,count:5,width:1.8}];
 const zones=[{id:'forecourt',x:0,z:6,hx:10.5,hz:4,y:6.8},{id:'commons',x:0,z:-21,hx:10,hz:4,y:5.2},{id:'admin',x:-24,z:-19,hx:9,hz:10,y:4},{id:'finance',x:-27,z:14,hx:8.5,hz:9,y:4},{id:'it',x:32.5,z:14,hx:10.5,hz:9.5,y:3.8},...pads];
 function designHeight(x,z){let y=.5+5.5*Math.exp(-((x*x)/4225+(z*z)/3364))+.3*Math.sin(x*.05)*Math.cos(z*.04);y+=5*Math.exp(-((x+100)**2/2200+(z+85)**2/900))+7*Math.exp(-((x-112)**2/2300+(z+95)**2/1600));
 for(const p of zones){const d=Math.hypot(Math.max(0,Math.abs(x-p.x)-p.hx),Math.max(0,Math.abs(z-p.z)-p.hz));y=T.MathUtils.lerp(y,p.y,1-smooth(d/9));}
 // Four continuous working terraces, stitched to existing fixed building platforms.
 if(x>15&&x<57&&z>-35&&z<-11){let ty=5.2-.7*smooth((x-29)/3)-.7*smooth((x-40)/3)-.7*smooth((x-50)/3);const w=(1-smooth(Math.max(0,Math.abs(z+24)-7)/6))*(1-smooth(Math.max(0,Math.abs(x-36)-17)/5)); y=T.MathUtils.lerp(y,ty,w);}
 // A broad longitudinal grading corridor, not a raised road extrusion.
 if(Math.abs(x)<17&&z>6&&z<40){const target=z<10?6.8:(z<15?6.8-1.6*T.MathUtils.clamp((z-10)/5,0,1):(z<24.5?5.2:5.2-T.MathUtils.clamp((z-24.5)/11.5,0,1)));const w=(1-smooth((Math.abs(x)-10)/7))*smooth((z-6)/3)*(1-smooth((z-36)/4));y=T.MathUtils.lerp(y,target,w);}
 if(z>32&&z<42&&Math.abs(x)<26){const w=(1-smooth((Math.abs(x)-12)/14))*(1-smooth((32-z)/3))*(1-smooth((z-39)/3));if(z>=36)y=T.MathUtils.lerp(y,4.2,w);}
 // Exact foundation contact wins at the building footprint, feathered outside.
 for(const p of pads){const d=Math.hypot(Math.max(0,Math.abs(x-p.x)-p.hx),Math.max(0,Math.abs(z-p.z)-p.hz));const maxD=p.feather||3;if(d<maxD)y=T.MathUtils.lerp(y,p.y,1-smooth(d/maxD));}
 for(const s of stairDefs){const a=s.axis==='x'?x:z,c=s.axis==='x'?z:x;const dAcross=Math.abs(c-s.cross)-s.width/2,dAlong=Math.max(s.start-.5-a,a-s.end-.5),d=Math.max(dAcross,dAlong);if(d<1.5){const t=T.MathUtils.clamp((a-s.start)/(s.end-s.start),0,1);const stepIdx=Math.min(s.count-1,Math.floor(t*s.count));const treadTop=s.high-stepIdx*((s.high-s.low)/s.count);const target=Math.min(treadTop-.11,T.MathUtils.lerp(s.high,s.low,t)-.12);y=T.MathUtils.lerp(y,target,1-smooth(Math.max(0,d)/1.5));}}
 const dist=Math.abs(z-riverZ(x)),rr=riverR(x);if(dist<rr+5)y=T.MathUtils.lerp(-.25,y,smooth((dist-rr)/5));return y;}
 const step=.75,nx=506,nz=453,stepX=380/nx,stepZ=340/nz,geo=new T.PlaneGeometry(380,340,nx,nz);geo.rotateX(-Math.PI/2);const pos=geo.attributes.position;
 const baseCount=pos.count;
 const basePosArray=new Float32Array(baseCount*3);
 const origHeights=new Float32Array(baseCount);
 const baseColorArray=new Float32Array(baseCount*3);
 const AO_REACH=2.6,AO_STRENGTH=.4;
 for(let i=0;i<baseCount;i++){
  const x=pos.getX(i),z=pos.getZ(i),y=designHeight(x,z);
  pos.setY(i,y);
  origHeights[i]=y;
  basePosArray[i*3]=x;
  basePosArray[i*3+1]=y;
  basePosArray[i*3+2]=z;

  // P3: Biến thiên hữu cơ ±5-8% độ sáng và sắc cỏ (vertex colors mảng loang tự nhiên)
  const n1 = Math.sin(x * 0.08) * Math.cos(z * 0.06);
  const n2 = Math.sin(x * 0.025 + z * 0.02) * 0.5 + Math.cos(x * 0.04 - z * 0.05) * 0.5;
  const variation = n1 * 0.04 + n2 * 0.035;
  // Contact AO nướng vào vertex color: tối dần mềm quanh chân mỗi công trình (bóng tiếp địa, không tốn GPU).
  let ao = 1;
  for (const p of pads) {
    if (p.feather) continue;
    const d = Math.hypot(Math.max(0, Math.abs(x - p.x) - (p.hx - .4)), Math.max(0, Math.abs(z - p.z) - (p.hz - .4)));
    if (d < AO_REACH) ao = Math.min(ao, 1 - AO_STRENGTH * (1 - smooth(d / AO_REACH)));
  }
  baseColorArray[i*3]   = T.MathUtils.clamp(1.0 + variation * 0.85, 0.92, 1.08) * ao * ao;
  baseColorArray[i*3+1] = T.MathUtils.clamp(1.0 + variation * 1.05, 0.92, 1.08) * ao;
  baseColorArray[i*3+2] = T.MathUtils.clamp(1.0 + variation * 0.65, 0.92, 1.08) * ao;
 }
 geo.setAttribute('color',new T.Float32BufferAttribute(new Float32Array(baseColorArray),3));
 // Sample the actual triangle plane from basePosArray using exact PlaneGeometry stepX/stepZ so height(x,z) matches rendered triangles 100%.
 function height(x,z){const u=T.MathUtils.clamp((x+190)/stepX,0,nx-.00001),v=T.MathUtils.clamp((z+170)/stepZ,0,nz-.00001),i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,k=j*(nx+1)+i;const h00=basePosArray[k*3+1],h10=basePosArray[(k+1)*3+1],h01=basePosArray[(k+nx+1)*3+1],h11=basePosArray[(k+nx+2)*3+1];return a+b<=1?h00+(h10-h00)*a+(h01-h00)*b:h11+(h01-h11)*(1-a)+(h10-h11)*(1-b);}
 const materials = [
    '#6fa659',  // 0: Nền cỏ xanh tươi sáng theo ảnh tham chiếu (Campus Builder)
    '#4f6078',  // 1: Đường chính màu xám xanh slate
    '#dca658',  // 2: Lối đi bộ màu vàng nung ấm (màu gốc sếp chọn)
    '#e09468',  // 3: Vùng sinh hoạt chung màu gạch cam ấm sáng
    '#918c7c', '#d1c6ae'   // 4: Chân đế móng
  ].map(color => new T.MeshStandardMaterial({ color, roughness: 0.94, vertexColors: true }));
 applyCampusPaving(P,materials[3],materials[2]);
 geo.computeVertexNormals();const terrain=new T.Mesh(geo,materials);terrain.name='continuous-ground';terrain.receiveShadow=true;scene.add(terrain);
 const stairs=[],surfaceHeight=(x,z)=>{for(const s of stairs){const along=s.axis==='x'?x:z,across=s.axis==='x'?z:x;if(Math.abs(across-s.cross)<=s.width/2&&along>=s.start-1.2&&along<=s.end+1.2){const t=T.MathUtils.clamp((along-s.start)/(s.end-s.start),0,1);return s.high-Math.min(s.count,Math.floor(t*s.count))*s.rise;}}return height(x,z);};
 const courts=[],surfaces=[],bins=new Map(),midpointList=[];let pathList=[];
 const key=(x,z)=>Math.floor(x/5)+','+Math.floor(z/5);
 function syncLiveBuffers(updatePos=true,updateCol=true){
  const pAttr=geo.attributes.position,cAttr=geo.attributes.color;
  if(updatePos&&pAttr){
   for(let i=0;i<baseCount;i++)pAttr.setY(i,basePosArray[i*3+1]);
   for(let m=0;m<midpointList.length;m++){const [n,a,b]=midpointList[m];pAttr.setY(n,(pAttr.getY(a)+pAttr.getY(b))*.5);}
   pAttr.needsUpdate=true;
   geo.computeVertexNormals();
  }
  if(updateCol&&cAttr){
   for(let i=0;i<baseCount;i++)cAttr.setXYZ(i,baseColorArray[i*3],baseColorArray[i*3+1],baseColorArray[i*3+2]);
   for(let m=0;m<midpointList.length;m++){const [n,a,b]=midpointList[m];cAttr.setXYZ(n,(cAttr.getX(a)+cAttr.getX(b))*.5,(cAttr.getY(a)+cAttr.getY(b))*.5,(cAttr.getZ(a)+cAttr.getZ(b))*.5);}
   cAttr.needsUpdate=true;
  }
 }
 function rebuild(paths){if(paths)pathList=paths;bins.clear();for(const p of pathList){if(p.hidden||!p.curve||(p.class===1&&!p.useGroundTriangles))continue;const n=Math.max(2,Math.ceil(p.curve.getLength()/.4));let prev=p.curve.getPointAt(0);for(let i=1;i<=n;i++){const q=p.curve.getPointAt(i/n),r=p.width/2,seg={a:prev,b:q,r,kind:p.materialKind||(p.class===1?2:1),id:p.id};for(let x=Math.floor((Math.min(prev.x,q.x)-r)/5);x<=Math.floor((Math.max(prev.x,q.x)+r)/5);x++)for(let z=Math.floor((Math.min(prev.z,q.z)-r)/5);z<=Math.floor((Math.max(prev.z,q.z)+r)/5);z++){const k=x+','+z;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(seg);}prev=q;}}
 const index=materials.map(()=>[]);function type(x,z){let kind=0;for(const s of bins.get(key(x,z))||[]){const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,t=T.MathUtils.clamp(((x-s.a.x)*dx+(z-s.a.z)*dz)/(dx*dx+dz*dz||1),0,1);if(Math.hypot(x-s.a.x-t*dx,z-s.a.z-t*dz)<=s.r){if(s.kind===1)return 1;kind=s.kind||2;}}for(const c of courts){if(c.hidden||!c.useGroundTriangles)continue;const rx=x-c.x,rz=z-c.z,rot=c.rotY||0,cos=rot?Math.cos(-rot):1,sin=rot?Math.sin(-rot):0,lx=rx*cos-rz*sin,lz=rx*sin+rz*cos,cr=Math.min(c.r??1,c.w/2,c.d/2),dx=Math.max(Math.abs(lx)-(c.w/2-cr),0),dz=Math.max(Math.abs(lz)-(c.d/2-cr),0);if(dx*dx+dz*dz<=cr*cr)kind=c.kind||3;}return kind;}
 const vertices=Array.from(basePosArray),vColors=Array.from(baseColorArray),midCache=new Map();midpointList.length=0;
 function midpoint(a,b){const k=Math.min(a,b)+':'+Math.max(a,b);if(midCache.has(k))return midCache.get(k);const n=vertices.length/3;vertices.push((vertices[a*3]+vertices[b*3])/2,(vertices[a*3+1]+vertices[b*3+1])/2,(vertices[a*3+2]+vertices[b*3+2])/2);vColors.push((vColors[a*3]+vColors[b*3])/2,(vColors[a*3+1]+vColors[b*3+1])/2,(vColors[a*3+2]+vColors[b*3+2])/2);midCache.set(k,n);midpointList.push([n,a,b]);return n;}
 function triangle(a,b,c,depth){const ax=vertices[a*3],az=vertices[a*3+2],bx=vertices[b*3],bz=vertices[b*3+2],cx=vertices[c*3],cz=vertices[c*3+2],kind=type((ax+bx+cx)/3,(az+bz+cz)/3);
 if(depth>0&&(type(ax,az)!==kind||type(bx,bz)!==kind||type(cx,cz)!==kind)){const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);triangle(a,ab,ca,depth-1);triangle(ab,b,bc,depth-1);triangle(ca,bc,c,depth-1);triangle(ab,bc,ca,depth-1);}else index[kind].push(a,b,c);}
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1,x=-190+i*stepX,z=-170+j*stepZ;if(Math.abs(x)>70||z<-65||z>45){index[0].push(a,c,b,b,c,d);}else{triangle(a,c,b,2);triangle(b,c,d,2);}}
 geo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
 geo.setAttribute('color', new T.Float32BufferAttribute(vColors, 3));
 const uvs = new Float32Array((vertices.length / 3) * 2);
 const uvScale = 0.45;
 for (let vi = 0; vi < vertices.length / 3; vi++) {
   uvs[vi * 2]     = vertices[vi * 3]     * uvScale;
   uvs[vi * 2 + 1] = vertices[vi * 3 + 2] * uvScale;
 }
 geo.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
 geo.clearGroups();let start=0;index.forEach((arr,i)=>{geo.addGroup(start,arr.length,i);start+=arr.length;});const data=new Uint32Array(start);let offset=0;for(const arr of index){data.set(arr,offset);offset+=arr.length;}geo.setIndex(new T.BufferAttribute(data,1));geo.computeVertexNormals();surfaces.splice(0,surfaces.length,...index.map((a,i)=>({material:i,triangles:a.length/3})));}
 const wg=new T.PlaneGeometry(380,1,256,1);wg.rotateX(-Math.PI/2);const wp=wg.attributes.position;for(let i=0;i<wp.count;i++){let x=wp.getX(i),s=wp.getZ(i)>0?1:-1;wp.setXYZ(i,x,.18,riverZ(x)+s*riverR(x));}wg.computeVertexNormals();const water=new T.Mesh(wg,new T.MeshStandardMaterial({color:P.colors.water,roughness:0.04,metalness:0.25,transparent:true,opacity:0.90}));water.name='river-only';scene.add(water);
 return {height,surfaceHeight,stairs,stairDefs,pads,zones,terrain,courts,rebuild,surfaces,riverZ,riverR,waterNormalY:1,riverWidth:[4.6,8.2],materials,baseCount,basePosArray,origHeights,baseColorArray,syncLiveBuffers};
}
export function ribbon(){throw Error('Art C surfaces must be part of continuous ground');}
