import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const TEXTURE_SLOTS = [
  'map','emissiveMap','normalMap','roughnessMap','metalnessMap','aoMap',
  'alphaMap','bumpMap','displacementMap','lightMap'
];

export class ModelLoader {
  constructor(renderer) {
    this.renderer = renderer;
    this.maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
  }

  async fromUrl({ url, mtlUrl = null }) {
    this.#assertSameOrigin(url, 'modèle');
    if (mtlUrl) this.#assertSameOrigin(mtlUrl, 'MTL');
    const ext = this.#extension(url);

    if (ext === 'glb' || ext === 'gltf') {
      // GLTFLoader preserves glTF PBR materials and embedded/external textures.
      // External textures referenced by a .gltf remain relative to the model URL.
      const gltf = await new GLTFLoader().loadAsync(url);
      gltf.scene.userData.gltfAnimations = gltf.animations;
      return this.prepare(gltf.scene);
    }

    if (ext === 'obj') {
      const manager = new THREE.LoadingManager();
      const objLoader = new OBJLoader(manager);
      if (mtlUrl) {
        const materials = await new MTLLoader(manager).loadAsync(mtlUrl);
        materials.preload();
        objLoader.setMaterials(materials);
      }
      return this.prepare(await objLoader.loadAsync(url));
    }

    throw new Error(`Format non supporté: .${ext}`);
  }

  /**
   * Loads a local selection. Select the GLB alone, or select a GLTF/OBJ together
   * with its .bin/.mtl/textures. Relative references are resolved entirely from
   * the selected local files through blob: URLs; no remote asset fetch is added.
   */
  async fromLocalFiles(fileList, preferredName = null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) throw new Error('Aucun fichier sélectionné.');

    const entry = this.#chooseEntry(files, preferredName);
    const ext = this.#extension(entry.name);
    const manager = new THREE.LoadingManager();
    const urls = new Map();

    for (const file of files) {
      const objectUrl = URL.createObjectURL(file);
      urls.set(file.name, objectUrl);
      const rel = file.webkitRelativePath || file.name;
      urls.set(rel, objectUrl);
      urls.set(rel.replace(/^\.\//, ''), objectUrl);
    }

    manager.setURLModifier((requested) => {
      if (/^(blob:|data:)/i.test(requested)) return requested;
      const clean = decodeURIComponent(String(requested).split('?')[0].split('#')[0]).replace(/^\.\//, '');
      const base = clean.split('/').pop();
      return urls.get(clean) || urls.get(base) || requested;
    });

    let root;
    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader(manager);
      const payload = ext === 'glb' ? await entry.arrayBuffer() : await entry.text();
      const gltf = await loader.parseAsync(payload, '');
      gltf.scene.userData.gltfAnimations = gltf.animations;
      root = gltf.scene;
    } else if (ext === 'obj') {
      const objLoader = new OBJLoader(manager);
      const mtl = files.find(f => this.#extension(f.name) === 'mtl');
      if (mtl) {
        const creator = new MTLLoader(manager).parse(await mtl.text(), '');
        creator.preload();
        objLoader.setMaterials(creator);
      }
      root = objLoader.parse(await entry.text());
    } else {
      this.#revoke(urls);
      throw new Error(`Format non supporté: .${ext}`);
    }

    // Keep blob URLs alive while the model exists because materials/textures may
    // retain them. SceneActor/Boat.dispose() revoke them.
    root.userData.assetObjectUrls = [...new Set(urls.values())];
    return this.prepare(root);
  }

  prepare(root) {
    root.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      if (!node.material) {
        node.material = new THREE.MeshStandardMaterial({ color:0xf2f0e8, roughness:0.55 });
      }

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material) continue;
        // Never replace glTF materials: that would discard their PBR textures.
        for (const slot of TEXTURE_SLOTS) {
          const tex = material[slot];
          if (!tex?.isTexture) continue;
          tex.anisotropy = Math.min(this.maxAnisotropy, 8);
          tex.needsUpdate = true;
        }
        material.needsUpdate = true;
      }
    });
    return root;
  }

  static disposeAssetUrls(root) {
    for (const url of root?.userData?.assetObjectUrls ?? []) URL.revokeObjectURL(url);
  }

  #chooseEntry(files, preferredName) {
    if (preferredName) {
      const preferred = files.find(f => f.name === preferredName || f.webkitRelativePath === preferredName);
      if (preferred) return preferred;
    }
    return files.find(f => ['glb','gltf','obj'].includes(this.#extension(f.name))) ?? files[0];
  }

  #revoke(urls) {
    for (const url of new Set(urls.values())) URL.revokeObjectURL(url);
  }

  #assertSameOrigin(url, label) {
    const resolved = new URL(url, window.location.href);
    if (resolved.origin !== window.location.origin) {
      throw new Error(`${label} externe refusé : les assets 3D doivent être servis par le même serveur.`);
    }
  }

  #extension(path) {
    return String(path).split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  }
}
