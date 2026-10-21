import * as THREE from 'three';
import { ModelLoader } from './ModelLoader.js';

export class SceneActor {
  constructor({ id, visual, scene, position=[0,0,-5], scale=1, rotation=[0,0,0] }) {
    this.id=id;this.visual=visual;this.scene=scene;
    this.object=new THREE.Group();this.object.name=id;this.object.userData.editorId=id;
    this.object.position.set(...position);this.object.rotation.set(...rotation);this.object.scale.setScalar(scale);
    this.object.add(visual);scene.add(this.object);
  }
  update() {}
  dispose(){
    this.scene.remove(this.object);ModelLoader.disposeAssetUrls(this.visual);
    this.visual.traverse((o)=>{if(!o.isMesh)return;o.geometry?.dispose?.();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(!m)continue;for(const v of Object.values(m))if(v?.isTexture)v.dispose?.();m.dispose?.();}});
  }
}
