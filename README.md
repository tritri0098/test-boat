# Three.js Ocean SlideDeck — serveur Python

Version sans Vite et sans npm du projet de démonstration 3D.

## Démarrage

Aucune dépendance Python externe n'est nécessaire.

Sous Windows :

```powershell
py server.py
```

Sous Linux / macOS :

```bash
python3 server.py
```

Puis ouvrir :

```text
http://127.0.0.1:8000/
```

Pour changer le port :

```bash
python3 server.py --port 8080
```

Le serveur écoute par défaut sur `0.0.0.0`, donc un iPhone présent sur le même réseau local peut ouvrir :

```text
http://IP_LOCALE_DU_PC:8000/
```

Le serveur Python ne cherche pas automatiquement ton IP et ne fait aucun appel réseau sortant.

## Réseau / confidentialité

Le projet n'utilise ni Vite, ni npm à l'exécution, ni analytics, ni télémétrie, ni WebSocket.

Le navigateur peut contacter **uniquement `cdn.jsdelivr.net`** pour télécharger les scripts JavaScript suivants :

- Three.js `0.180.0` ;
- les addons Three.js réellement importés (`OrbitControls`, `GLTFLoader`, `OBJLoader`, `MTLLoader`) ;
- GSAP `3.13.0`.

Tous les autres fichiers — HTML, CSS, JS du projet, modèles `.obj`, `.mtl`, `.glb`, `.gltf` et leurs ressources — sont servis par le serveur Python local.

`index.html` contient une Content Security Policy qui limite les connexions sortantes à :

```text
'self'
https://cdn.jsdelivr.net
```

Ainsi, une ressource 3D qui essaierait de charger une URL externe depuis un autre domaine sera bloquée. `ModelLoader` refuse en plus explicitement les URL de modèles qui ne sont pas de même origine.

> Un fichier `.gltf` ou `.mtl` peut référencer des fichiers associés. Pour rester dans cette politique, place aussi ces fichiers dans le projet et utilise des chemins relatifs. Un `.glb` est généralement plus simple car les ressources peuvent être intégrées dans un fichier unique.

## Arborescence

```text
./
├── server.py
├── index.html
├── README.md
├── assets/
│   └── models/
│       └── demo_boat.obj
└── src/
    ├── main.js
    ├── styles.css
    ├── core/
    │   ├── Boat.js
    │   ├── CameraController.js
    │   ├── ModelLoader.js
    │   ├── Ocean.js
    │   ├── OceanWorld.js
    │   ├── Rain.js
    │   ├── SlideDeck.js
    │   └── Weather.js
    └── ui/
        └── controls.js
```

## Dépendances JS sans Vite

`index.html` utilise un `importmap` :

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/",
    "gsap": "https://cdn.jsdelivr.net/npm/gsap@3.13.0/+esm"
  }
}
</script>
```

Les sources peuvent donc garder des imports propres :

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gsap } from 'gsap';
```

Le navigateur résout ces noms grâce à l'import map ; aucun bundler n'est nécessaire.

## Ajouter un modèle GLB

Place par exemple :

```text
assets/models/yacht.glb
```

Puis dans `src/main.js` :

```js
const ASSETS_BASE = new URL('../assets/', import.meta.url);

await world.addBoatFromUrl({
  id: 'yacht',
  url: new URL('models/yacht.glb', ASSETS_BASE).href,
  position: [4, 0, -8],
  scale: 0.8
});
```

## Ajouter un OBJ

```js
await world.addBoatFromUrl({
  id: 'obj-boat',
  url: new URL('models/boat.obj', ASSETS_BASE).href,
  position: [-3, 0, -8],
  scale: 1
});
```

OBJ + MTL :

```js
await world.addBoatFromUrl({
  id: 'obj-mtl',
  url: new URL('models/boat.obj', ASSETS_BASE).href,
  mtlUrl: new URL('models/boat.mtl', ASSETS_BASE).href
});
```

## Intégration à ton autre serveur Python

Les liens du projet sont relatifs, donc tu peux aussi copier tout ce dossier dans une sous-arborescence déjà servie par ton autre serveur :

```text
mon-projet/
├── server.py
├── ...
└── ocean/
    ├── index.html
    ├── src/
    └── assets/
```

Si la racine `mon-projet/` est servie sur le port 8000, la démo sera alors accessible à :

```text
http://127.0.0.1:8000/ocean/
```

Tu n'as pas besoin de lancer le `server.py` fourni dans ce cas.
