import * as THREE from 'three';

export class Rain {
  constructor(scene, count=360) {
    this.count = count;
    this.data = [];
    this.positions = new Float32Array(count*6);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions,3));
    this.material = new THREE.LineBasicMaterial({ color:0xe5f0f4, transparent:true, opacity:0, depthWrite:false });
    this.lines = new THREE.LineSegments(this.geometry,this.material);
    scene.add(this.lines);
    for (let i=0;i<count;i++) this.data.push(this.#newDrop(true));
  }

  #newDrop(initial=false) {
    return {
      x:(Math.random()-.5)*28,
      y:initial ? Math.random()*18-1 : 13+Math.random()*8,
      z:-Math.random()*30+5,
      len:0.12+Math.random()*0.58,
      speed:9+Math.random()*12,
      drift:0.6+Math.random()*1.6
    };
  }

  update(dt, intensity, wind) {
    for (let i=0;i<this.count;i++) {
      const d=this.data[i];
      d.y-=d.speed*dt;
      d.x-=d.drift*wind*0.07*dt;
      if (d.y<-2) Object.assign(d,this.#newDrop(false));
      const n=i*6;
      this.positions[n]=d.x; this.positions[n+1]=d.y; this.positions[n+2]=d.z;
      this.positions[n+3]=d.x-0.11*d.len*wind; this.positions[n+4]=d.y-d.len; this.positions[n+5]=d.z+0.04*d.len;
    }
    this.geometry.attributes.position.needsUpdate=true;
    this.material.opacity=intensity*0.4;
  }
}
