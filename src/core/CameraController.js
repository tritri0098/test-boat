import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0,0.8,-5);
    this.mode = 'orbit';
    this.followTarget = null;
    this.followOffset = new THREE.Vector3(5,2.5,8);
  }

  setPose({ position, target }) {
    if (position) this.camera.position.set(...position);
    if (target) this.controls.target.set(...target);
    this.controls.update();
  }

  setMode(mode, boat=null) {
    this.mode = mode;
    this.followTarget = boat;
    this.controls.enabled = mode === 'orbit';
  }

  update(dt) {
    if (this.mode === 'follow' && this.followTarget) {
      const obj = this.followTarget.object;
      const desired = obj.position.clone().add(this.followOffset);
      const k = 1 - Math.exp(-Math.max(dt,0.0001)*3.0);
      this.camera.position.lerp(desired, k);
      this.controls.target.lerp(obj.position.clone().add(new THREE.Vector3(0,0.8,0)), k);
      this.camera.lookAt(this.controls.target);
    } else {
      this.controls.update();
    }
  }
}
