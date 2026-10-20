import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

export class ModelLoader {
  constructor() {
    this.gltf = new GLTFLoader();
  }

  async fromUrl({ url, mtlUrl = null }) {
    this.#assertSameOrigin(url, 'modèle');
    if (mtlUrl) this.#assertSameOrigin(mtlUrl, 'MTL');
    const ext = this.#extension(url);
    if (ext === 'glb' || ext === 'gltf') {
      const gltf = await this.gltf.loadAsync(url);
      return gltf.scene;
    }
    if (ext === 'obj') {
      const objLoader = new OBJLoader();
      if (mtlUrl) {
        const materials = await new MTLLoader().loadAsync(mtlUrl);
        materials.preload();
        objLoader.setMaterials(materials);
      }
      return objLoader.loadAsync(url);
    }
    throw new Error(`Format non supporté: .${ext}`);
  }

  async fromLocalFile(file) {
    const ext = this.#extension(file.name);
    if (ext === 'obj') {
      const text = await file.text();
      return new OBJLoader().parse(text);
    }
    if (ext === 'glb') {
      const buffer = await file.arrayBuffer();
      const result = await this.gltf.parseAsync(buffer, '');
      return result.scene;
    }
    if (ext === 'gltf') {
      const text = await file.text();
      const result = await this.gltf.parseAsync(text, '');
      return result.scene;
    }
    throw new Error(`Format non supporté: .${ext}`);
  }

  normalizeMaterials(root) {
    root.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      if (!node.material) {
        node.material = new THREE.MeshStandardMaterial({ color:0xf2f0e8, roughness:0.55 });
      }
    });
    return root;
  }

  #assertSameOrigin(url, label) {
    const resolved = new URL(url, window.location.href);
    if (resolved.origin !== window.location.origin) {
      throw new Error(`${label} externe refusé : les assets 3D doivent être servis par le même serveur.`);
    }
  }

  #extension(path) {
    return String(path).split('?')[0].split('.').pop().toLowerCase();
  }
}
