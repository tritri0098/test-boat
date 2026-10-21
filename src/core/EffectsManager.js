import * as THREE from 'three';

function radialTexture(inner='rgba(255,255,255,1)', mid='rgba(255,160,30,.65)'){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d');const g=ctx.createRadialGradient(64,64,2,64,64,62);
  g.addColorStop(0,inner);g.addColorStop(.32,mid);g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,128,128);return new THREE.CanvasTexture(canvas);
}

class ExplosionVisual{
  constructor(scene,texture){
    this.scene=scene;this.group=new THREE.Group();scene.add(this.group);
    this.coreMat=new THREE.SpriteMaterial({map:texture,color:0xffb347,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
    this.core=new THREE.Sprite(this.coreMat);this.group.add(this.core);
    this.light=new THREE.PointLight(0xff7a18,0,18,2);this.group.add(this.light);

    this.count=52;this.directions=[];this.speeds=[];const pos=new Float32Array(this.count*3);
    for(let i=0;i<this.count;i++){
      const d=new THREE.Vector3(Math.random()*2-1,Math.random()*2-1,Math.random()*2-1).normalize();
      this.directions.push(d);this.speeds.push(.35+Math.random()*1.25);
    }
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));
    this.sparkMat=new THREE.PointsMaterial({map:texture,color:0xffb04a,size:.16,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true});
    this.sparks=new THREE.Points(this.geometry,this.sparkMat);this.group.add(this.sparks);this.group.visible=false;
  }
  update(progress,size,intensity,position){
    this.group.visible=true;this.group.position.copy(position);
    const p=Math.max(0,Math.min(1,progress));const envelope=Math.sin(Math.PI*Math.min(1,p*1.12))*(1-p*.72);
    const coreScale=size*(.35+2.2*p);this.core.scale.setScalar(coreScale);this.coreMat.opacity=Math.max(0,envelope)*intensity;
    this.light.intensity=42*intensity*Math.pow(1-p,2.2);this.light.distance=Math.max(4,size*9);
    const arr=this.geometry.attributes.position.array;
    for(let i=0;i<this.count;i++){
      const d=this.directions[i],r=size*this.speeds[i]*(.15+2.7*p);arr[i*3]=d.x*r;arr[i*3+1]=d.y*r-.7*size*p*p;arr[i*3+2]=d.z*r;
    }
    this.geometry.attributes.position.needsUpdate=true;this.sparkMat.size=.08+size*.09;this.sparkMat.opacity=Math.max(0,(1-p)*1.2)*intensity;
  }
  hide(){this.group.visible=false;}
  dispose(){this.scene.remove(this.group);this.geometry.dispose();this.sparkMat.dispose();this.coreMat.dispose();}
}

class RocketFlameVisual{
  constructor(scene,texture){
    this.scene=scene;this.group=new THREE.Group();scene.add(this.group);
    const outerMat=new THREE.MeshBasicMaterial({color:0xff6d1f,transparent:true,opacity:.8,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
    const innerMat=new THREE.MeshBasicMaterial({color:0xbfe8ff,transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
    const outer=new THREE.Mesh(new THREE.ConeGeometry(.28,1.65,18,1,true),outerMat);outer.geometry.rotateX(Math.PI/2);outer.position.z=.78;this.group.add(outer);
    const inner=new THREE.Mesh(new THREE.ConeGeometry(.14,1.0,14,1,true),innerMat);inner.geometry.rotateX(Math.PI/2);inner.position.z=.42;this.group.add(inner);
    this.outer=outer;this.inner=inner;this.outerMat=outerMat;this.innerMat=innerMat;
    this.light=new THREE.PointLight(0xff9b45,0,8,2);this.light.position.z=.15;this.group.add(this.light);

    this.count=30;const pos=new Float32Array(this.count*3);this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));
    this.particleMat=new THREE.PointsMaterial({map:texture,color:0xff9b45,size:.1,transparent:true,opacity:.6,depthWrite:false,blending:THREE.AdditiveBlending});
    this.particles=new THREE.Points(this.geometry,this.particleMat);this.group.add(this.particles);this.group.visible=false;
  }
  update(time,size,intensity,position,quaternion){
    this.group.visible=true;this.group.position.copy(position);this.group.quaternion.copy(quaternion);
    const pulse=1+.10*Math.sin(time*23)+.045*Math.sin(time*41.3);this.group.scale.set(size,size,size*pulse);
    this.outerMat.opacity=.52+.28*intensity;this.innerMat.opacity=.6+.35*intensity;this.light.intensity=10*intensity;this.light.distance=7*size;
    const arr=this.geometry.attributes.position.array;
    for(let i=0;i<this.count;i++){
      const phase=(i/this.count+time*(1.2+(i%5)*.07))%1;const spread=.04+.16*phase;
      arr[i*3]=(Math.sin(i*12.91)*.5)*spread;arr[i*3+1]=(Math.cos(i*8.37)*.5)*spread;arr[i*3+2]=.25+phase*2.0;
    }
    this.geometry.attributes.position.needsUpdate=true;this.particleMat.opacity=.35+.35*intensity;
  }
  hide(){this.group.visible=false;}
  dispose(){this.scene.remove(this.group);this.outer.geometry.dispose();this.inner.geometry.dispose();this.outerMat.dispose();this.innerMat.dispose();this.geometry.dispose();this.particleMat.dispose();}
}

export class EffectsManager{
  constructor(scene,{resolveTarget}={}){
    this.scene=scene;this.resolveTarget=resolveTarget;this.instances=new Map();
    this.texture=radialTexture();this.tmpPos=new THREE.Vector3();this.tmpQuat=new THREE.Quaternion();this.tmpDir=new THREE.Vector3();this.tmpDirQuat=new THREE.Quaternion();
  }

  update(time,clips=[]){
    const ids=new Set(clips.map(c=>c.id));
    for(const [id,instance] of this.instances)if(!ids.has(id)){instance.dispose();this.instances.delete(id);}
    for(const clip of clips){
      let instance=this.instances.get(clip.id);
      if(!instance){instance=clip.type==='rocketFlame'?new RocketFlameVisual(this.scene,this.texture):new ExplosionVisual(this.scene,this.texture);this.instances.set(clip.id,instance);}
      if(time<clip.start||time>clip.end){instance.hide();continue;}
      const transform=this.#worldTransform(clip);
      if(clip.type==='rocketFlame')instance.update(time,clip.size||1,clip.intensity??1,transform.position,transform.quaternion);
      else instance.update((time-clip.start)/Math.max(1e-5,clip.end-clip.start),clip.size||1,clip.intensity??1,transform.position);
    }
  }

  #worldTransform(clip){
    const target=clip.targetId?this.resolveTarget?.(clip.targetId):null;
    this.tmpPos.fromArray(clip.offset||[0,0,0]);
    this.tmpQuat.identity();
    if(target){
      target.updateWorldMatrix(true,false);target.localToWorld(this.tmpPos);target.getWorldQuaternion(this.tmpQuat);
    }
    const dir=this.tmpDir.fromArray(clip.direction||[0,0,1]);if(dir.lengthSq()<1e-8)dir.set(0,0,1);dir.normalize();
    this.tmpDirQuat.setFromUnitVectors(new THREE.Vector3(0,0,1),dir);
    if(target)this.tmpQuat.multiply(this.tmpDirQuat);else this.tmpQuat.copy(this.tmpDirQuat);
    return {position:this.tmpPos,quaternion:this.tmpQuat};
  }

  dispose(){for(const i of this.instances.values())i.dispose();this.instances.clear();this.texture.dispose();}
}
