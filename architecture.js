import * as T from 'three';
export function createArchitecture(P){
 const mat=(key,rough=.8)=>new T.MeshStandardMaterial({color:P.colors[key],roughness:rough,metalness:key==='glass'?.12:0});
 const M={cream:mat('plaster'),stone:mat('stone'),glass:mat('glass',.24),moss:mat('brandMoss'),orange:mat('brandOrange',.6),dark:mat('frame'),metal:mat('asphalt'),white:mat('roadMarking')};
 M.glass.color.set(P.colors.referenceGlass); // approved reference moss/teal glass, distinct from foliage
 const boxes=new Map();
 function box(g,w,h,d,x,y,z,m=M.cream){const k=[w,h,d].join('/');if(!boxes.has(k))boxes.set(k,new T.BoxGeometry(w,h,d));const b=new T.Mesh(boxes.get(k),m);b.position.set(x,y+h/2,z);b.castShadow=b.receiveShadow=true;g.add(b);return b;}
 function cylinder(g,r,h,x,y,z,m=M.stone,n=16){const b=new T.Mesh(new T.CylinderGeometry(r,r,h,n),m);b.position.set(x,y+h/2,z);b.castShadow=b.receiveShadow=true;g.add(b);return b;}
 function beam(g,a,b,w,d,m){const A=new T.Vector3(...a),B=new T.Vector3(...b),mesh=new T.Mesh(new T.BoxGeometry(w,A.distanceTo(B),d),m);mesh.position.copy(A.clone().add(B).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),B.sub(A).normalize());mesh.castShadow=true;g.add(mesh);}
 function sign(g,text,w,h,x,y,z){const c=document.createElement('canvas');c.width=1024;c.height=192;const ctx=c.getContext('2d');ctx.fillStyle=P.colors.brandMoss;ctx.fillRect(0,0,1024,192);ctx.fillStyle=P.colors.plaster;ctx.font='bold 125px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,100,980);const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;const mesh=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:tx}));mesh.position.set(x,y,z);g.add(mesh);}
 function windows(g,w,h,d,x,y,z,rows=2,cols=4){box(g,w,h,d,x,y,z,M.glass);for(let i=0;i<=cols;i++)box(g,.07,h+.1,d+.04,x-w/2+i*w/cols,y-.04,z,M.moss);for(let i=1;i<rows;i++)box(g,w+.06,.065,d+.05,x,y+i*h/rows,z,M.cream);}
 function front(g,w,h,d,rows=2,cols=4){windows(g,w-.45,h-.6,.07,0,.3,d/2+.025,rows,cols);}
 function entry(g,w,z,h=2){windows(g,w,h,.12,0,.1,z,1,2);box(g,w+.5,.18,1.1,0,h+.12,z+.35,M.orange);}
 function shell(g,w,h,d,rows=2,cols=4){box(g,w,h,d,0,0,0);front(g,w,h,d,rows,cols);windows(g,.07,h-.7,d-.5,w/2+.025,.3,0,rows,cols);box(g,w+.25,.2,d+.25,0,h,0);}
 function HQ(){const g=new T.Group();g.name='approved-slanted-HQ';
 // Connected near-square podium and asymmetric wings, +Z frontage.
 box(g,26,.35,22,0,0,0,M.stone);
 box(g,13,5.2,18,-6.1,.35,-1.1);windows(g,11.8,4.6,.12,-6.1,.65,7.98,1,5);windows(g,.12,4.6,16.7,-12.65,.65,-1.1,1,7);
 box(g,11.6,3.4,14,6.9,.35,3.9);windows(g,10.5,2.9,.12,6.9,.65,10.98,1,5);windows(g,.12,2.9,12.8,12.76,.65,3.9,1,5);
 box(g,10,3.15,10,6.8,3.75,2);windows(g,9.2,2.7,.12,6.8,4,7.05,1,5);windows(g,.12,2.7,9.3,11.86,4,2,1,5);
 box(g,11.9,.4,14.3,6.9,3.65,3.9);box(g,10.35,.4,10.35,6.8,6.9,2);
 // Reference right-wing roof lantern: glass sides, cream cap, restrained mullions.
 box(g,4.4,.18,3.2,7,7.3,2,M.moss);
 windows(g,4.1,1.15,.1,7,7.48,3.55,1,3);
 windows(g,.1,1.15,2.9,9.05,7.48,2,1,2);
 windows(g,4.1,1.15,.1,7,7.48,.45,1,3);
 windows(g,.1,1.15,2.9,4.95,7.48,2,1,2);
 box(g,4.55,.22,3.35,7,8.63,2);
 box(g,1.9,.55,1.5,7.1,8.85,1.8,M.stone);
 // Tall tower wedge. Left edge inclines inward, right edge stays vertical.
 const shape=new T.Shape();shape.moveTo(-9.3,5.55);shape.lineTo(2.7,5.55);shape.lineTo(2.7,25.5);shape.lineTo(-5.6,25.5);shape.closePath();
 const geo=new T.ExtrudeGeometry(shape,{depth:10,bevelEnabled:false});geo.translate(0,0,-7.8);const tower=new T.Mesh(geo,M.glass);tower.castShadow=tower.receiveShadow=true;g.add(tower);
 for(const z of [-7.85,2.27])beam(g,[-9.3,5.55,z],[-5.6,25.5,z],1.1,.5,M.cream);
 box(g,8.9,.8,10.7,-1.6,25.15,-2.8);box(g,.65,20.1,.45,2.85,5.55,2.3);box(g,.65,20.1,.45,2.85,5.55,-7.8);
 for(let i=1;i<9;i++){const y=5.55+i*2.2,left=-9.3+(y-5.55)*3.7/19.95;box(g,2.7-left,.09,.12,(left+2.7)/2,y,2.29,M.moss);box(g,2.7-left,.09,.12,(left+2.7)/2,y,-7.86,M.moss);}
 for(let i=1;i<7;i++){const x=-9.3+i*1.7,end=x< -5.6?5.55+(x+9.3)*19.95/3.7:25.3;box(g,.10,end-5.55,.15,x,5.55,2.32,M.moss);}
 // Rear elevation carries the same glazing rhythm as the front, not a blank backdrop.
 for(let i=1;i<7;i++){const x=-9.3+i*1.7,end=x< -5.6?5.55+(x+9.3)*19.95/3.7:25.3;box(g,.10,end-5.55,.15,x,5.55,-7.88,M.moss);}
 windows(g,10.4,4.3,.10,-6.1,.7,-10.15,2,5);
 windows(g,9.6,2.6,.10,6.9,.7,-3.15,1,5);
 // Sloping side glass grid follows the same wedge, never a detached facade.
 for(let i=1;i<6;i++){const z=-7.8+i*1.65;beam(g,[-9.34,5.55,z],[-5.64,25.5,z],.065,.065,M.moss);}
 for(let i=1;i<8;i++){const y=5.55+i*2.5,x=-9.3+(y-5.55)*3.7/19.95;box(g,.09,.09,10.05,x-.02,y,-2.8,M.moss);}
 box(g,10.6,7,9.2,1.1,5.55,0);windows(g,9.7,6,.12,1.1,6,4.66,2,5);box(g,10.9,.5,9.5,1.1,12.55,0);box(g,5.3,4.5,6.6,1.6,13.05,-1.2);box(g,5.5,.18,6.8,1.6,17.55,-1.2);const shoulderShape=new T.Shape();shoulderShape.moveTo(-1,13);shoulderShape.lineTo(1.4,17.6);shoulderShape.lineTo(4.25,17.6);shoulderShape.lineTo(4.25,13);shoulderShape.closePath();const shoulder=new T.Mesh(new T.ExtrudeGeometry(shoulderShape,{depth:2.7,bevelEnabled:false}),M.cream);shoulder.position.z=2.1;shoulder.castShadow=true;g.add(shoulder);beam(g,[-1,13,4.86],[1.4,17.6,4.86],.25,.24,M.orange);
 box(g,9.9,.3,.18,-.8,25.1,2.58,M.orange);beam(g,[-9.35,5.6,2.6],[-8.2,10,2.6],.35,.3,M.orange);box(g,10,.2,.2,-3.4,5.6,2.6,M.orange);
 // Entrance recessed between wings, broad orange canopy and low steps.
 windows(g,7.2,3.6,.15,-.65,.7,9.3,1,3);box(g,8.6,.45,3.1,-.65,4.4,9.7,M.orange);for(const x of [-4.5,3.2])box(g,.5,4.25,.55,x,.35,10.7,M.orange);
 for(let i=0;i<4;i++)box(g,8.6-i*.25,.12,1.2,-.65,.12*i,11.1-i*.65,M.stone);
 // Deliberate large roof units only; no rooftop planting.
 for(const [x,w] of [[-3.8,1.6],[-1.7,2.4],[1,1.3]])box(g,w,.85,2.1,x,25.95,-2.4,M.metal);
 for(const x of [10.1,10.55,11,11.45,11.9,12.35])box(g,.19,5.9,.3,x,.6,11.04,M.orange);
 // Left wing vertical accent, matching the approved front elevation.
 for(const x of [-1.7,-1.4,-1.1])box(g,.12,4.5,.22,x,.65,8.08,M.orange);
 // Warm canopy edge and inset door handles; no new scene light sources.
 box(g,7.8,.055,.08,-.65,4.55,11.29,M.white);
 for(const x of [-4.5,3.2])box(g,.055,3.6,.065,x,.65,11.01,M.white);
 for(const x of [-.82,-.48])box(g,.055,.55,.08,x,1.3,9.42,M.stone);
 // Cream panel joints break up the large shoulder without changing its silhouette.
 for(const x of [1.3,2.8,4.1])box(g,.025,3.7,.025,x,13.25,4.82,M.stone);
 box(g,3.8,.025,.025,2.3,15.3,4.82,M.stone);
 // A shallow architectural sign cassette, mounted within the curtain-wall bay.
 box(g,8.6,2.2,.32,-1.9,19.95,2.42,M.moss);
 box(g,8.6,.07,.38,-1.9,22.15,2.43,M.stone);
 sign(g,'AN PHIM',7.6,1.6,-1.9,21.05,2.60);
 // Deepened vertical glazing ribs cast real shadows; main envelope is unchanged.
 for(const x of [-4.2,-2.5,-.8,.9])box(g,.115,19.5,.22,x,5.65,2.38,M.moss);
 for(const z of [-6.3,-4.4,-2.5,-.6,1.3])box(g,.22,18.8,.1,2.9,5.7,z,M.moss);
 // Rear spandrels and projecting sill lines share the front facade rhythm.
 for(const y of [10,14.4,18.8,23.2])box(g,8.5,.16,.32,-1.45,y,-7.94,M.moss);
 for(const z of [-7,-4.5,-2, .5,3,5.5])box(g,.20,4.4,.12,-12.72,.65,z,M.cream);
 box(g,11.8,.17,.35,-6.1,2.8,8.04,M.cream);
 box(g,10.5,.17,.35,6.9,2.1,11.04,M.cream);
 // Layered entry soffit and recessed door portal, restrained warm accents.
 box(g,7.7,.12,2.45,-.65,4.26,9.7,M.moss);
 for(const x of [-3.8,2.5])box(g,.16,3.6,.25,x,.7,9.45,M.stone);
 for(const z of [9,9.5,10])box(g,7.1,.04,.06,-.65,4.23,z,M.stone);

 const socket=new T.Object3D();socket.name='entry-socket';socket.position.set(-.65,0,12.3);g.add(socket);return g;
 }
 function department(style){const g=new T.Group();
 if(style==='bank'){box(g,10,.25,8,0,0,0,M.stone);box(g,8.8,5.4,6.4,0,.25,-.5);windows(g,7.6,3,.1,0,1,2.76,1,4);for(const x of [-3.5,-1.7,1.7,3.5]){cylinder(g,.23,4.2,x,.3,3.3);box(g,.7,.2,.7,x,4.5,3.3);}box(g,9.3,.5,2.5,0,4.7,3.1);const sh=new T.Shape();sh.moveTo(-4.65,0);sh.lineTo(4.65,0);sh.lineTo(0,1.6);sh.closePath();const m=new T.Mesh(new T.ExtrudeGeometry(sh,{depth:1,bevelEnabled:false}),M.stone);m.position.set(0,5.2,2.6);m.castShadow=true;g.add(m);entry(g,2,3.45,2.8);sign(g,'BANK',3,.6,0,5.1,4.37);}
 else if(style==='civic'){shell(g,7,5.1,6,2,4);box(g,2,1.2,5,-2.2,5.3,0,M.moss);entry(g,2,3.2,2.1);box(g,7.4,.2,6.4,0,5.1,0);}
 else if(style==='archive'){shell(g,5,2.8,4.8,1,2);box(g,4.6,.2,4.4,0,3,0,M.moss);box(g,3.4,1.2,.12,0,.5,2.52,M.metal);for(const x of [-1.3,0,1.3])box(g,.1,1.2,.15,x,.5,2.6,M.cream);entry(g,1.2,2.7,1.8);}
 else if(style==='vault'){box(g,6.4,3.7,6,0,0,0,M.stone);box(g,6.8,.35,6.4,0,3.7,0);const c=new T.Mesh(new T.CylinderGeometry(1.15,1.15,.25,24),M.metal);c.rotation.x=Math.PI/2;c.position.set(0,1.6,3.1);c.castShadow=true;g.add(c);beam(g,[-.6,1.6,3.26],[.6,1.6,3.26],.15,.12,M.orange);box(g,2.2,.3,1.2,0,2.9,3.2,M.moss);}
 else if(style==='ai'){shell(g,9,7.3,7.5,3,6);box(g,3.3,2.5,5,-2.5,7.5,-.5,M.moss);windows(g,3,2.1,.1,-2.5,7.7,2.1,1,2);box(g,4.6,.35,5.8,2.4,7.4,.5,M.orange);entry(g,2.6,4,2.8);for(let x=-3.5;x<4;x+=1.3)box(g,.14,6.7,.3,x,.5,3.9,M.cream);}
 else if(style==='office'){shell(g,6.5,4.8,6.1,2,4);box(g,4,1.4,4.5,-1.1,5,0,M.glass);box(g,4.3,.2,4.8,-1.1,6.4,0);entry(g,1.8,3.2,2.1);}
 else if(style==='database'){box(g,6.7,3.8,6,0,0,0,M.stone);for(let i=0;i<4;i++){box(g,1.2,2.9,.2,-2.3+i*1.5,.5,3.08,M.moss);for(let j=0;j<6;j++)box(g,.8,.05,.08,-2.3+i*1.5,.8+j*.4,3.23,M.glass);}box(g,7,.25,6.3,0,3.8,0);cylinder(g,.9,1.3,-1.7,4.05,-.8,M.metal);cylinder(g,.9,1.3,1.7,4.05,-.8,M.metal);entry(g,1.4,3.35,2);}
 else if(style==='cloud'){shell(g,4.8,2.9,4.5,1,3);box(g,3.6,1.1,2.8,0,3.1,-.4,M.glass);box(g,3.9,.2,3.1,0,4.2,-.4);entry(g,1.2,2.4,1.8);}
 else if(style==='gateway'){shell(g,4.2,2.8,4.5,1,2);box(g,1.4,1.4,1.4,1.1,3,-.8,M.moss);const dish=new T.Mesh(new T.SphereGeometry(.65,12,8,0,Math.PI*2,0,Math.PI/2),M.stone);dish.rotation.z=-.6;dish.position.set(1.1,4.8,-.8);g.add(dish);entry(g,1.2,2.4,1.7);}
 else if(style==='web'){shell(g,4.7,2.8,4.5,1,3);box(g,5,.2,4.8,0,2.8,0,M.moss);entry(g,1.5,2.4,1.9);box(g,2.7,.65,.1,0,2.1,2.56,M.orange);}
 else if(style==='studio'){box(g,4.8,2.6,4.6,0,0,0,M.moss);const roof=new T.Mesh(new T.CylinderGeometry(2.4,2.4,4.8,16,1,false,0,Math.PI),M.stone);roof.rotation.set(Math.PI/2,0,Math.PI/2);roof.scale.y=.35;roof.position.set(0,2.6,0);g.add(roof);entry(g,2.2,2.5,2);box(g,1.7,.7,.1,0,1.6,2.65,M.glass);}
 else {shell(g,4.9,2.8,4.4,1,3);box(g,5.1,.2,4.6,0,2.8,0,M.stone);for(const x of [-1.7,1.7])box(g,.25,2.6,.45,x,.1,2.4);entry(g,1.7,2.5,2);}
 const b=new T.Box3().setFromObject(g);const socket=new T.Object3D();socket.name='entry-socket';socket.position.set(0,0,b.max.z+.12);g.add(socket);return g;
 }
 function fit(g,grade,grades){const [w,h,d]=grades[grade];g.updateMatrixWorld(true);let b=new T.Box3().setFromObject(g),size=b.getSize(new T.Vector3());const scale=Math.min(w/size.x,h/size.y,d/size.z);g.scale.setScalar(scale);g.updateMatrixWorld(true);b=new T.Box3().setFromObject(g);const center=b.getCenter(new T.Vector3());for(const child of g.children){child.position.x-=center.x/scale;child.position.y-=b.min.y/scale;child.position.z-=center.z/scale;}g.updateMatrixWorld(true);b=new T.Box3().setFromObject(g);return {group:g,scale,bbox:b.getSize(new T.Vector3()).toArray(),minY:b.min.y};}
 return {HQ,department,fit,M,box,sign};
}
