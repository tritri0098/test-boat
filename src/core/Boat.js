import * as THREE from 'three';
import { ModelLoader } from './ModelLoader.js';

function makeShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(128,128,10,128,128,118);
  g.addColorStop(0,'rgba(0,0,0,.48)');
  g.addColorStop(.45,'rgba(0,0,0,.24)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(canvas);
}

export class Boat {
  constructor({ id, visual, ocean, scene, position=[0,0,-5], scale=1, yaw=-0.34 }) {
    this.id = id;
    this.visual = visual;
    this.ocean = ocean;
    this.scene = scene;

    // `object` is the animation/timeline root. Buoyancy is applied to a child so
    // the timeline can freely animate X/Y/Z, rotation and scale without fighting
    // the wave simulation.
    this.object = new THREE.Group();
    this.object.name = id;
    this.object.userData.editorId = id;
    this.object.position.set(...position);
    this.object.rotation.order = 'YXZ';
    this.object.rotation.y = yaw;
    this.object.scale.setScalar(scale);

    this.floatRoot = new THREE.Group();
    this.floatRoot.name = `${id}:buoyancy`;
    this.floatRoot.add(visual);
    this.object.add(this.floatRoot);
    scene.add(this.object);

    this.floatY = 0.5;
    this.pitch = 0;
    this.roll = 0;
    this.tmpWorld = new THREE.Vector3();
    this.tmpScale = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
    this.tmpEuler = new THREE.Euler(0,0,0,'YXZ');

    visual.traverse((o)=>{
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4,1.7),
      new THREE.MeshBasicMaterial({ map:makeShadowTexture(), transparent:true, depthWrite:false, opacity:0.25 })
    );
    this.contactShadow.rotation.x = -Math.PI/2;
    scene.add(this.contactShadow);
  }

  update(time, storm, dt) {
    this.object.getWorldPosition(this.tmpWorld);
    this.object.getWorldScale(this.tmpScale);
    this.object.getWorldQuaternion(this.tmpQuat);
    this.tmpEuler.setFromQuaternion(this.tmpQuat, 'YXZ');
    const x=this.tmpWorld.x, z=this.tmpWorld.z, yaw=this.tmpEuler.y;
    const fx=-Math.sin(yaw), fz=-Math.cos(yaw);
    const rx=Math.cos(yaw), rz=-Math.sin(yaw);
    const front=1.5, side=0.62;
    const c=this.ocean.heightAt(x,z,time,storm);
    const f=this.ocean.heightAt(x+fx*front,z+fz*front,time,storm);
    const b=this.ocean.heightAt(x-fx*front,z-fz*front,time,storm);
    const r=this.ocean.heightAt(x+rx*side,z+rz*side,time,storm);
    const l=this.ocean.heightAt(x-rx*side,z-rz*side,time,storm);

    // floatRoot is local to the timeline root; root Y therefore becomes an
    // explicit artistic/timeline offset above/below the simulated waterline.
    const targetFloatY = (c + 0.48 - this.tmpWorld.y) / Math.max(1e-6, this.tmpScale.y);
    const targetPitch=Math.atan2(b-f,front*2)*0.78;
    const targetRoll=Math.atan2(l-r,side*2)*0.84;
    const k=1-Math.exp(-Math.max(dt,0.0001)*5.2);
    this.floatY += (targetFloatY-this.floatY)*k;
    this.pitch += (targetPitch-this.pitch)*k;
    this.roll += (targetRoll-this.roll)*k;
    this.floatRoot.position.y=this.floatY;
    this.floatRoot.rotation.x=this.pitch;
    this.floatRoot.rotation.z=this.roll;
    this.contactShadow.position.set(x,c+0.025,z);
    this.contactShadow.material.opacity=0.25-storm*0.08;
  }

  setXZ(x,z) {
    this.object.position.x = x;
    this.object.position.z = z;
  }

  dispose() {
    this.scene.remove(this.object);
    this.scene.remove(this.contactShadow);
    ModelLoader.disposeAssetUrls(this.visual);
    this.visual.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const value of Object.values(m)) if (value?.isTexture) value.dispose?.();
        m.dispose?.();
      }
    });
    this.contactShadow.geometry.dispose();
    this.contactShadow.material.map?.dispose?.();
    this.contactShadow.material.dispose();
  }
}

export function createProceduralBoat() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color:0xf4f2e9, roughness:0.42 });
  const dark = new THREE.MeshStandardMaterial({ color:0x26323b, roughness:0.4, metalness:0.25 });
  const blue = new THREE.MeshStandardMaterial({ color:0x617c8d, roughness:0.55 });
  const sail = new THREE.MeshStandardMaterial({ color:0xf4ecd3, roughness:0.82, side:THREE.DoubleSide });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.66,2.7,7,16), white);
  hull.rotation.x = Math.PI/2; hull.scale.set(1,0.46,1); hull.position.y = 0.12; g.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.28,0.95), blue);
  cabin.position.set(0,0.48,0.3); g.add(cabin);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.05,4.1,10), dark);
  mast.position.set(0,2.45,0.1); g.add(mast);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.025,1.55,8), dark);
  boom.rotation.z = Math.PI/2; boom.position.set(0.7,1.25,0.1); g.add(boom);
  const mainShape = new THREE.Shape();
  mainShape.moveTo(0,0); mainShape.lineTo(0,3.1); mainShape.lineTo(1.55,0.1); mainShape.closePath();
  const main = new THREE.Mesh(new THREE.ShapeGeometry(mainShape), sail);
  main.rotation.y = Math.PI/2; main.position.set(0.025,0.78,0.1); g.add(main);
  const jibShape = new THREE.Shape();
  jibShape.moveTo(0,0.05); jibShape.lineTo(0,2.45); jibShape.lineTo(-1.45,0.08); jibShape.closePath();
  const jib = new THREE.Mesh(new THREE.ShapeGeometry(jibShape), sail);
  jib.rotation.y = Math.PI/2; jib.position.set(-0.025,0.83,-0.18); g.add(jib);
  return g;
}
