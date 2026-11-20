import * as T from 'three';
export function createTerrain(scene,P,layout){
 const smooth=t=>{t=T.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
 const riverZ=x=>67+5.2*Math.sin(x*.027)+1.5*Math.sin(x*.072);
 const riverR=x=>3.2+.55*Math.sin(x*.035)+.35*Math.cos(x*.083);
 const pads=layout.buildings.map(b=>({x:b.position[0],z:b.position[2],y:b.position[1],hx:layout.grades[b.grade][0]/2+.5,hz:layout.grades[b.grade][2]/2+.5}));
 function height(x,z){for(const p of pads)if(Math.abs(x-p.x)<=p.hx&&Math.abs(z-p.z)<=p.hz)return p.y;let y=.5+5.5*Math.exp(-((x*x)/(65*65)+(z*z)/(58*58)))+.3*Math.sin(x*.05)*Math.cos(z*.04);
 y+=5*Math.exp(-((x+100)**2/2200+(z+85)**2/900))+7*Math.exp(-((x-112)**2/2300+(z+95)**2/1600));
 for(const p of pads){const d=Math.max(Math.abs(x-p.x)-p.hx,Math.abs(z-p.z)-p.hz);const t=1-smooth(d/6);y=T.MathUtils.lerp(y,p.y,t);}
 // The Internal spine has four actual landings and smooth earth shoulders.
 if(x>=16&&x<=59&&z>-29.1&&z<-24.8){let target=5.2;for(const cx of [25,38,48])target-=Math.min(4,Math.max(0,Math.floor((x-(cx-1))/.5)+1))*.175;const blend=(1-smooth(Math.max(0,Math.abs(z+27)-.8)/1.5));y=T.MathUtils.lerp(y,target,blend);}
 const dist=Math.abs(z-riverZ(x)),rr=riverR(x);if(dist<rr+5)y=T.MathUtils.lerp(-.25,y,smooth((dist-rr)/(5)));
 return y;}
 const geo=new T.PlaneGeometry(380,340,256,224);geo.rotateX(-Math.PI/2);const pos=geo.attributes.position,cs=[];
 for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);pos.setY(i,height(x,z));const wet=Math.abs(z-riverZ(x))-riverR(x),c=new T.Color(P.colors.meadow).lerp(new T.Color(P.colors.lawn),.16+.12*Math.sin(x*.043+z*.031));if(wet<3)c.lerp(new T.Color(P.colors.sand),1-smooth(wet/3));cs.push(c.r,c.g,c.b);}
 geo.setAttribute('color',new T.Float32BufferAttribute(cs,3));geo.computeVertexNormals();const terrain=new T.Mesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:1}));terrain.receiveShadow=true;scene.add(terrain);
 const verts=[],cols=[],ind=[];for(let i=0;i<=256;i++){const x=-190+i*380/256;for(let j=0;j<9;j++){const q=-1+j/4,z=riverZ(x)+q*riverR(x);verts.push(x,.18,z);const c=new T.Color(P.colors.water).lerp(new T.Color(P.colors.waterDeep),(1-Math.abs(q))*.25).lerp(new T.Color(P.colors.waterShallow),Math.abs(q)*.3);cols.push(c.r,c.g,c.b);}}
 for(let i=0;i<256;i++)for(let j=0;j<8;j++){const a=i*9+j;ind.push(a,a+1,a+9,a+1,a+10,a+9);}const wg=new T.BufferGeometry();wg.setAttribute('position',new T.Float32BufferAttribute(verts,3));wg.setAttribute('color',new T.Float32BufferAttribute(cols,3));wg.setIndex(ind);wg.computeVertexNormals();const water=new T.Mesh(wg,new T.MeshStandardMaterial({vertexColors:true,roughness:.36,metalness:.15}));scene.add(water);
 const lmat=new T.LineBasicMaterial({color:P.colors.waterShallow,transparent:true,opacity:.35});for(let i=0;i<42;i++){const x=-120+i*6,z=riverZ(x)+(i%3-1)*1.2;scene.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(x,.21,z),new T.Vector3(x+1.5,.21,z+.08)]),lmat));}
 return {height,riverZ,riverR,pads,terrain,waterNormalY:wg.attributes.normal.getY(0),riverWidth:[4.6,8.2]};
}
export function ribbon(scene,points,width,material,height,offset=.1){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(p[0],0,p[1])),false,'centripetal');const steps=Math.max(6,Math.ceil(curve.getLength()*2)),v=[],idx=[];
 for(let i=0;i<=steps;i++){const t=i/steps,p=curve.getPoint(t),d=curve.getTangent(t),n=new T.Vector3(d.z,0,-d.x);for(const side of [-1,1]){const x=p.x+n.x*width/2*side,z=p.z+n.z*width/2*side;v.push(x,height(x,z)+offset,z);}if(i<steps){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();const mesh=new T.Mesh(g,material);mesh.receiveShadow=true;scene.add(mesh);
 // Paved edges have a continuous earth-contact skirt rather than a floating paper edge.
 const sv=[],si=[];for(const side of [0,1])for(let i=0;i<=steps;i++){const k=i*6+side*3,x=v[k],y=v[k+1],z=v[k+2];sv.push(x,y,z,x,height(x,z)-.05,z);if(i<steps){const a=(side*(steps+1)+i)*2;si.push(a,a+1,a+2,a+1,a+3,a+2);}}
 const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(sv,3));sg.setIndex(si);sg.computeVertexNormals();const skirt=new T.Mesh(sg,material);skirt.receiveShadow=true;scene.add(skirt);return {mesh,curve,width};}
