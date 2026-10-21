import * as THREE from 'three';

export class Rain{
  constructor(scene,count=520){
    this.count=count;this.radius=34;this.height=34;this.data=[];this.positions=new Float32Array(count*6);
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3));
    this.material=new THREE.LineBasicMaterial({color:0xe5f0f4,transparent:true,opacity:0,depthWrite:false});
    this.lines=new THREE.LineSegments(this.geometry,this.material);this.lines.frustumCulled=false;scene.add(this.lines);
    for(let i=0;i<count;i++)this.data.push(this.#newDrop(true));
  }

  #newDrop(initial=false){
    const r=this.radius;return {
      x:(Math.random()*2-1)*r,
      y:initial?(Math.random()-.35)*this.height:this.height*.72+Math.random()*this.height*.35,
      z:(Math.random()*2-1)*r,
      len:.12+Math.random()*.65,speed:10+Math.random()*13,drift:.5+Math.random()*1.7
    };
  }

  update(dt,intensity,wind,camera){
    const anchor=camera?.position||new THREE.Vector3();const r=this.radius;
    for(let i=0;i<this.count;i++){
      const d=this.data[i];d.y-=d.speed*dt;d.x-=d.drift*wind*.07*dt;
      if(d.y<-this.height*.45)Object.assign(d,this.#newDrop(false));
      if(d.x<-r)d.x+=2*r;else if(d.x>r)d.x-=2*r;
      const n=i*6,wx=anchor.x+d.x,wy=anchor.y+d.y,wz=anchor.z+d.z;
      this.positions[n]=wx;this.positions[n+1]=wy;this.positions[n+2]=wz;
      this.positions[n+3]=wx-.10*d.len*wind;this.positions[n+4]=wy-d.len;this.positions[n+5]=wz+.035*d.len;
    }
    this.geometry.attributes.position.needsUpdate=true;this.material.opacity=Math.max(0,Math.min(1,intensity))*.42;
  }
}
