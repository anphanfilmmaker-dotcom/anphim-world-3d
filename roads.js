import * as T from 'three';
export async function createRoads(scene,P,L,terrain,adapter,report){
 const paths=[];
 const pts=[];for(const [cx,cz,start]of L.roadPlan.ringCorners)for(let j=0;j<=10;j++){const a=(start+j*9)*Math.PI/180;pts.push(new T.Vector3(cx+16*Math.cos(a),0,cz+16*Math.sin(a)));}
 paths.push({id:'road:campus-ring',width:8,class:3,curve:new T.CatmullRomCurve3(pts,true,'centripetal')});
 const a=L.roadPlan.arrival,r=a.turnRadius,k=.5522847498,z=a.centerXZ[1],curve=new T.CurvePath();
 curve.add(new T.LineCurve3(new T.Vector3(-r,0,36),new T.Vector3(-r,0,z)));
 curve.add(new T.CubicBezierCurve3(new T.Vector3(-r,0,z),new T.Vector3(-r,0,z-k*r),new T.Vector3(-k*r,0,z-r),new T.Vector3(0,0,z-r)));
 curve.add(new T.CubicBezierCurve3(new T.Vector3(0,0,z-r),new T.Vector3(k*r,0,z-r),new T.Vector3(r,0,z-k*r),new T.Vector3(r,0,z)));
 curve.add(new T.LineCurve3(new T.Vector3(r,0,z),new T.Vector3(r,0,36)));
 paths.push({id:a.id,width:4,class:2,curve});
 function walk(id,points){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(p[0],0,p[1])),false,'centripetal');const p={id,points,width:2,class:1,curve};paths.push(p);return p;}
 for(const [id,points]of L.roadPlan.walks){
   if(id === 'walk:visitor-sidewalk' || id === 'walk:dropoff-commons' || id === 'walk:arrival-ramp-west' || id === 'walk:arrival-ramp-east') continue;
   walk(id,points);
 }

 // Đã gỡ bỏ 2 đường đi bộ ở 2 bên đường chữ U (Lịch làm việc & Kho dự trữ) theo yêu cầu của Sếp.
 // ĐÃ BỎ walk:direct-arrival để xóa vĩnh viễn chấm cam ở 2 chân và đầu cầu thang
 return {paths,walk,walkMat:terrain.materials[2]};
}
