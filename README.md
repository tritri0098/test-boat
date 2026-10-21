# Ocean Scene Creator

Éditeur de scène 3D Three.js pour créer des séquences animées sur une mer procédurale, sans Vite ni npm à l'exécution.

## Lancer

```bash
python3 server.py
```

Puis ouvre `http://127.0.0.1:8000/`.

Le serveur Python n'effectue aucun appel réseau sortant. Le navigateur ne contacte que `cdn.jsdelivr.net` pour les modules JavaScript Three.js/GSAP réellement utilisés. Les modèles, textures et fichiers de timeline restent locaux ou servis par le même serveur.

## Ce que fait l'éditeur

- sélection d'un objet depuis la liste ou directement dans la vue 3D ;
- gizmos Three.js pour translation, rotation et échelle ;
- timeline visuelle multi-objets ;
- keyframes de position + rotation + échelle ;
- interpolation automatique `smooth`, `linear`, `easeIn`, `easeOut` ou `step` ;
- lecture, scrubbing, boucle et durée réglable ;
- export/import de la timeline en JSON ;
- liaison temporaire d'un objet à la position d'un autre sur un intervalle donné ;
- choix des axes X/Y/Z à suivre ;
- suivi optionnel de la rotation ;
- fondu d'attache/détache pour éviter les sauts ;
- objets flottants (bateaux) ou objets statiques ;
- chargement GLB/GLTF/OBJ.

## GLB / textures

`GLTFLoader` conserve les matériaux PBR et les textures du GLB. Le chargeur ne remplace plus les matériaux glTF lors de la préparation du modèle. Les textures obtiennent aussi une anisotropie adaptée au GPU.

Pour un `.glb`, sélectionne simplement le fichier. Les textures embarquées sont chargées avec lui.

Pour un `.gltf` avec ressources externes, sélectionne **en une fois** le `.gltf`, son `.bin` et ses images. L'éditeur résout leurs chemins via des `blob:` URLs locales, sans aller chercher ces assets sur Internet.

Pour un OBJ, tu peux de la même manière sélectionner `.obj`, `.mtl` et textures ensemble.

> Les GLB utilisant des extensions de compression qui nécessitent un décodeur externe (par exemple certaines variantes Draco/KTX2) ne sont pas activés dans cette version, afin de ne pas ajouter d'autres téléchargements réseau que les scripts JS autorisés.

## Utilisation rapide

1. Charge ou crée un objet.
2. Sélectionne-le dans la liste ou touche/clique le modèle dans la scène.
3. Place le curseur de timeline au temps voulu.
4. Déplace/rotate/scale l'objet avec le gizmo.
5. Clique **◆ Keyframe**.
6. Recommence à un autre instant : l'interpolation est calculée automatiquement.

### Liaison temporaire

Pour faire suivre `boat-B` par `boat-A` de 2 s à 5 s :

1. sélectionne `boat-B` ;
2. choisis `boat-A` comme cible ;
3. mets début `2`, fin `5` ;
4. choisis les axes à suivre ;
5. règle le fondu, par exemple `0.25 s` ;
6. clique **Créer la liaison**.

L'offset spatial courant entre les deux objets est mémorisé. Pendant l'intervalle, la liaison est appliquée après l'interpolation des keyframes. À l'entrée et à la sortie, le poids de la liaison est interpolé pour obtenir une transition douce.

## Format JSON de timeline

Exemple simplifié :

```json
{
  "version": 1,
  "duration": 12,
  "loop": false,
  "tracks": {
    "main-boat": [
      {
        "time": 0,
        "position": [3.1, 0, -5.4],
        "quaternion": [0, 0, 0, 1],
        "scale": [0.94, 0.94, 0.94],
        "interpolation": "smooth"
      }
    ]
  },
  "bindings": []
}
```

## Architecture

```text
src/
├── main.js
├── styles.css
├── core/
│   ├── Boat.js
│   ├── CameraController.js
│   ├── ModelLoader.js
│   ├── Ocean.js
│   ├── OceanWorld.js
│   ├── Rain.js
│   ├── SceneActor.js
│   ├── SceneTimeline.js
│   └── Weather.js
└── editor/
    └── SceneEditor.js
```

`SceneTimeline` est indépendant du rendu de l'océan : il travaille sur les `THREE.Object3D` exposés par `OceanWorld`. Les bateaux utilisent un root de timeline séparé du root de flottabilité afin que l'animation artistique et la réaction aux vagues puissent coexister.
