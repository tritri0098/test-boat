import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DEFAULT_LENS = Object.freeze({
  focalLength: 35,
  zoom: 1,
  focusDistance: 12,
  aperture: 0.00018,
  maxBlur: 0.009,
  dofEnabled: false
});

export class CinematicCameraActor {
  constructor(manager, {
    id,
    position=[0, 2.7, 10.8],
    rotation=null,
    target=[0, .8, -6],
    focalLength=DEFAULT_LENS.focalLength,
    zoom=DEFAULT_LENS.zoom,
    focusDistance=DEFAULT_LENS.focusDistance,
    aperture=DEFAULT_LENS.aperture,
    maxBlur=DEFAULT_LENS.maxBlur,
    dofEnabled=DEFAULT_LENS.dofEnabled
  }={}) {
    this.manager=manager;
    this.id=id;
    this.kind='camera';
    this.object=new THREE.PerspectiveCamera(50, manager.aspect, .05, 1000);
    this.object.name=id;
    this.object.userData.editorId=id;
    this.object.userData.editorKind='camera';
    this.object.position.fromArray(position);
    if (rotation) {
      this.object.rotation.set(...rotation);
    } else {
      this.object.lookAt(new THREE.Vector3(...target));
    }
    this.object.userData.cameraSettings={...DEFAULT_LENS};
    manager.applyLens(this.object,{focalLength,zoom,focusDistance,aperture,maxBlur,dofEnabled});
    manager.scene.add(this.object);

    this.helper=new THREE.CameraHelper(this.object);
    this.helper.name=`${id}:helper`;
    this.helper.userData.editorId=id;
    this.helper.userData.editorKind='camera-helper';
    this.helper.visible=manager.mode==='editor';
    manager.scene.add(this.helper);
  }

  update(){ this.helper.update(); }

  dispose(){
    this.manager.scene.remove(this.helper);
    this.manager.scene.remove(this.object);
    this.helper.dispose?.();
  }
}

export class CameraManager {
  constructor({scene, renderer, editorCamera, viewport}) {
    this.scene=scene;
    this.renderer=renderer;
    this.editorCamera=editorCamera;
    this.viewport=viewport;
    this.cameras=new Map();
    this.activeId=null;
    this.mode='editor';
    this.aspect=16/9;

    this.renderPass=new RenderPass(scene,editorCamera);
    this.bokehPass=new BokehPass(scene,editorCamera,{
      focus:DEFAULT_LENS.focusDistance,
      aperture:DEFAULT_LENS.aperture,
      maxblur:DEFAULT_LENS.maxBlur
    });
    this.composer=new EffectComposer(renderer);
    this.outputPass=new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bokehPass);
    this.composer.addPass(this.outputPass);
  }

  createCamera(options={}) {
    const actor=new CinematicCameraActor(this,options);
    this.cameras.set(actor.id,actor);
    if (!this.activeId) this.activeId=actor.id;
    return actor;
  }

  removeCamera(id) {
    const actor=this.cameras.get(id);
    if (!actor) return;
    actor.dispose();
    this.cameras.delete(id);
    if (this.activeId===id) this.activeId=this.cameras.keys().next().value||null;
  }

  setMode(mode) {
    this.mode=mode==='cinematic'?'cinematic':'editor';
    for (const actor of this.cameras.values()) actor.helper.visible=this.mode==='editor';
  }

  setActiveCamera(id) {
    if (id && this.cameras.has(id)) this.activeId=id;
  }

  get activeActor(){ return this.cameras.get(this.activeId)||null; }
  get activeCamera(){ return this.activeActor?.object||null; }
  getRenderCamera(){ return this.mode==='cinematic' && this.activeCamera ? this.activeCamera : this.editorCamera; }

  applyLens(camera, partial={}) {
    if (!camera?.isPerspectiveCamera) return;
    const settings=camera.userData.cameraSettings ??= {...DEFAULT_LENS};
    Object.assign(settings,partial);
    settings.focalLength=Math.max(1,Number(settings.focalLength)||DEFAULT_LENS.focalLength);
    settings.zoom=Math.max(.05,Number(settings.zoom)||1);
    settings.focusDistance=Math.max(.01,Number(settings.focusDistance)||1);
    settings.aperture=Math.max(0,Number(settings.aperture)||0);
    settings.maxBlur=Math.max(0,Number(settings.maxBlur)||0);
    settings.dofEnabled=Boolean(settings.dofEnabled);
    camera.setFocalLength(settings.focalLength);
    camera.zoom=settings.zoom;
    camera.updateProjectionMatrix();
  }

  getLens(camera) {
    if (!camera?.isPerspectiveCamera) return null;
    const s=camera.userData.cameraSettings ??= {...DEFAULT_LENS};
    return {...s,focalLength:camera.getFocalLength(),zoom:camera.zoom};
  }

  resize(width,height) {
    this.aspect=width/Math.max(1,height);
    this.editorCamera.aspect=this.aspect;
    this.editorCamera.updateProjectionMatrix();
    for (const actor of this.cameras.values()) {
      actor.object.aspect=this.aspect;
      actor.object.updateProjectionMatrix();
      actor.helper.update();
    }
    this.composer.setSize(width,height);
  }

  render() {
    const camera=this.getRenderCamera();
    if (this.mode!=='cinematic' || !camera?.isPerspectiveCamera) {
      this.renderer.render(this.scene,camera);
      return;
    }

    const lens=this.getLens(camera);
    if (!lens?.dofEnabled || lens.maxBlur<=0 || lens.aperture<=0) {
      this.renderer.render(this.scene,camera);
      return;
    }

    this.renderPass.camera=camera;
    this.bokehPass.camera=camera;
    if (this.bokehPass.uniforms?.focus) this.bokehPass.uniforms.focus.value=lens.focusDistance;
    if (this.bokehPass.uniforms?.aperture) this.bokehPass.uniforms.aperture.value=lens.aperture;
    if (this.bokehPass.uniforms?.maxblur) this.bokehPass.uniforms.maxblur.value=lens.maxBlur;
    if (this.bokehPass.uniforms?.znear) this.bokehPass.uniforms.znear.value=camera.near;
    if (this.bokehPass.uniforms?.zfar) this.bokehPass.uniforms.zfar.value=camera.far;
    if (this.bokehPass.uniforms?.aspect) this.bokehPass.uniforms.aspect.value=camera.aspect;
    this.composer.render();
  }
}
