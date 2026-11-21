import * as T from 'three';
export function createNetwork(scene,P,L,objects,operations,systems,report,sync,router){
 let mode='world',selected=null,focus='internal',filter='all',animated=true;const root=new T.Group();scene.add(root);const nodes=new Map(L.buildings.map(b=>[b.id,b]));const dots=[];
 // Energy node geometry: enlarged sphere (0.24m radius) with outer glow ring
 const sphere=new T.SphereGeometry(0.24,16,12);
 const ringGeo=new T.TorusGeometry(0.36,0.045,8,24);ringGeo.rotateX(Math.PI/2);
 const termGeo=new T.CylinderGeometry(0.35,0.35,0.08,24);
 const colors={documents:'#38bdf8',finance:'#00f0ff',execution:'#d946ef',reporting:'#10b981',data:'#00f0ff'};
 const titles={documents:'Tài liệu / hồ sơ',finance:'Nguồn lực / ngân sách',execution:'Thực thi / tự động hóa',reporting:'Điều phối / báo cáo',data:'Dữ liệu'};
 function clear(){while(root.children.length){const o=root.children.pop();o.parent=null;if(o.geometry&&o.geometry!==sphere&&o.geometry!==ringGeo&&o.geometry!==termGeo)o.geometry.dispose();o.material?.dispose();}dots.length=0;}
 function relatedEdges(){const graph=mode==='system'?systems:operations;let edges=graph.edges.filter(e=>filter==='all'||e.type===filter);if(selected)edges=edges.filter(e=>e.source===selected||e.target===selected);else if(mode==='operations')edges=edges.filter(e=>nodes.get(e.source)?.department===focus||nodes.get(e.target)?.department===focus);return edges.slice(0,6);}
 function rebuild(){clear();root.visible=mode!=='world';document.querySelector('#network-controls').hidden=mode==='world';document.querySelector('#network-focus').disabled=mode==='system';document.querySelector('#network-legend').hidden=mode==='world';const edges=mode==='world'?[]:relatedEdges(),related=new Set(selected?[selected]:[]);
  const list=document.querySelector('#relation-list');list.replaceChildren();
  const ENERGY_ELEVATION = 0.42; // Elevated above ground for floating energy beam look
  const termNodesPlaced = new Set();
  for(const e of edges){const a=nodes.get(e.source),b=nodes.get(e.target);if(!a||!b)continue;related.add(a.id);related.add(b.id);const route=router.route(e.source,e.target);if(route.validationStatus!=='routed'){const item=document.createElement('li');item.textContent='DISCONNECTED: '+a.name+' → '+b.name;list.append(item);continue;}
   const curve=new T.CurvePath();
   for(let i=1;i<route.points.length;i++){
     curve.add(new T.LineCurve3(
       new T.Vector3(route.points[i-1][0],route.points[i-1][1]+ENERGY_ELEVATION,route.points[i-1][2]),
       new T.Vector3(route.points[i][0],route.points[i][1]+ENERGY_ELEVATION,route.points[i][2])
     ));
   }
   const color=colors[e.type]||colors.data;
   const mat=mode==='system'?new T.LineDashedMaterial({color,dashSize:.75,gapSize:.45,transparent:true,opacity:.95,depthTest:true}):new T.LineBasicMaterial({color,transparent:true,opacity:.92,depthTest:true});
   const line=new T.Line(new T.BufferGeometry().setFromPoints(route.points.map(p=>new T.Vector3(p[0],p[1]+ENERGY_ELEVATION,p[2]))),mat);
   if(mode==='system')line.computeLineDistances();line.renderOrder=20;root.add(line);
   
   // Floating energy stream glow underlay
   const underMat=new T.LineBasicMaterial({color,transparent:true,opacity:.35,depthTest:true});
   const underLine=new T.Line(new T.BufferGeometry().setFromPoints(route.points.map(p=>new T.Vector3(p[0],p[1]+ENERGY_ELEVATION*0.5,p[2]))),underMat);
   underLine.renderOrder=19;root.add(underLine);

   // Terminal connection node markers at start and end points
   for(const pt of [route.points[0], route.points.at(-1)]){
     const k=pt[0].toFixed(1)+','+pt[2].toFixed(1);
     if(!termNodesPlaced.has(k)){
       termNodesPlaced.add(k);
       const term=new T.Mesh(termGeo,new T.MeshBasicMaterial({color,transparent:true,opacity:.85}));
       term.position.set(pt[0],pt[1]+ENERGY_ELEVATION,pt[2]);term.renderOrder=23;root.add(term);
       const termHalo=new T.Mesh(new T.RingGeometry(0.38,0.52,24),new T.MeshBasicMaterial({color,side:T.DoubleSide,transparent:true,opacity:.5}));
       termHalo.rotation.x=-Math.PI/2;termHalo.position.set(pt[0],pt[1]+ENERGY_ELEVATION+0.01,pt[2]);root.add(termHalo);
     }
   }

   // Animated moving energy pulses (Enlarged node dots + glowing orbital ring)
   for(const direction of [1,-1]){
     const pulse=new T.Group();
     const dot=new T.Mesh(sphere,new T.MeshBasicMaterial({color,depthTest:true}));
     pulse.add(dot);
     const ring=new T.Mesh(ringGeo,new T.MeshBasicMaterial({color,transparent:true,opacity:.75}));
     pulse.add(ring);
     pulse.renderOrder=24;root.add(pulse);
     dots.push({pulse,curve,direction});
   }
   const item=document.createElement('li');item.textContent=a.name+' ↔ '+b.name+' · '+e.label;list.append(item);
  }
  if(!edges.length&&mode!=='world'){const li=document.createElement('li');li.textContent='Chưa có quan hệ phù hợp trong cấu hình; không suy đoán integration.';list.append(li);}
  // Selection rings removed per CEO request
  document.querySelector('#mode-status').textContent=mode==='world'?'Campus vật lý · không overlay':mode==='operations'?'TARGET / DEMO · quan hệ mục tiêu, không phải telemetry':'MOCK / CHƯA XÁC MINH · không kiểm tra online / API';
  document.querySelector('#network-legend').textContent=mode==='system'?'Nét đứt: dependency đề xuất. Entity đã có trong mapping; integration chưa được xác minh.':'Luồng minh họa hai chiều. Chọn nhóm hoặc công trình để xem tối đa 6 quan hệ.';
  report.mode=mode;report.network={kind:mode,selectedId:selected,focus,visibleEdges:edges.map(e=>e.id),relatedBuildingIds:[...related],isLive:false,allEdgesMockOrTarget:true};sync();
 }
 function setMode(m){mode=m;if(m==='system')filter='all';document.querySelector('#relation-type').value=filter;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===m)));rebuild();}
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
 const nfEl=document.querySelector('#network-focus'); if(nfEl) nfEl.onchange=e=>{focus=e.target.value;selected=null;rebuild();};
 const rtEl=document.querySelector('#relation-type'); if(rtEl) rtEl.onchange=e=>{filter=e.target.value;rebuild();};
 const afEl=document.querySelector('#animate-flow'); if(afEl) afEl.onchange=e=>animated=e.target.checked;
 const cfEl=document.querySelector('#clear-focus'); if(cfEl) cfEl.onclick=()=>{selected=null;rebuild();};
 setMode('world');return {select:id=>{selected=id;rebuild();},setMode,rebuild,tick:t=>{if(mode==='world')return false;for(const d of dots){const u=animated?(t*.12)%1:.5;d.pulse.position.copy(d.curve.getPoint(d.direction>0?u:1-u));}return animated&&dots.length>0;}};
}
