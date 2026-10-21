# Ocean Cinematic Scene Creator

Éditeur de scène 3D Three.js pour créer des séquences animées sur un océan procédural, sans Vite ni npm à l'exécution.

## Lancer

```bash
python3 server.py
```

Puis ouvre `http://127.0.0.1:8000/`.

Le serveur Python n'effectue aucun appel réseau sortant. Le navigateur ne contacte que `cdn.jsdelivr.net` pour les modules JavaScript Three.js/GSAP réellement utilisés. Les modèles, textures et fichiers de timeline restent locaux ou servis par le même serveur.

## Mode éditeur / mode cinématique

Deux vues sont disponibles :

- **Éditeur** : caméra OrbitControls, gizmos de translation/rotation/échelle et sélection des objets ;
- **Vue caméra** : rendu depuis la caméra cinématique active choisie par les coupes de la timeline.

La timeline peut contenir plusieurs caméras. Chaque caméra est un objet éditable avec ses propres keyframes. Un keyframe de caméra enregistre position, rotation, focale en mm, zoom, distance de mise au point, aperture du pass DOF, blur maximal et activation de la profondeur de champ.

La piste spéciale **CAM CUT** choisit la caméra utilisée à chaque instant. Ajoute une coupe au playhead avec **Cut au playhead**.

La profondeur de champ utilise `BokehPass` de Three.js et n'est calculée que dans la vue cinématique lorsqu'elle est activée pour la caméra courante.

## Keyframes éditables

Chaque keyframe possède maintenant un identifiant stable. Un clic sur le losange d'une keyframe sélectionne **cette keyframe précise et uniquement celle de sa piste**.

Pendant cette sélection :

1. modifie la position, la rotation ou l'échelle avec le gizmo ou l'inspecteur ;
2. pour une caméra, modifie aussi la focale, le zoom et la profondeur de champ ;
3. tu peux déplacer le playhead vers un autre temps pour déplacer cette keyframe dans la timeline ;
4. change éventuellement son interpolation ;
5. le bouton principal devient **Enregistrer cette keyframe**.

La sauvegarde met à jour la keyframe sélectionnée **en place** : aucune autre keyframe de l'objet, et aucune piste d'un autre objet, n'est modifiée.

Si une autre keyframe du même objet existe déjà exactement au temps de destination, l'éditeur refuse la collision au lieu d'écraser silencieusement cette autre keyframe.

## Priorité des liaisons

L'évaluation de la timeline est volontairement séparée en couches :

```text
1. keyframes / interpolation des objets
2. liaisons temporaires et contraintes
3. sélection de la caméra de rendu
```

Les liaisons sont donc toujours appliquées **après** les keyframes et ont priorité sur elles pendant leur intervalle actif.

Une keyframe d'un objet lié reste éditable comme animation de base, mais le rendu final de cet objet suit quand même la liaison sur l'intervalle concerné. En cas de chaîne de liaisons, les cibles liées sont résolues avant leurs enfants. Si plusieurs liaisons actives pilotent le même enfant, la dernière créée est appliquée en dernier et possède donc la priorité finale.

## Timeline objet

- sélection d'un objet depuis la liste ou dans la vue 3D ;
- gizmos Three.js pour translation, rotation et échelle ;
- timeline visuelle multi-objets ;
- keyframes position + quaternion + échelle ;
- édition directe des keyframes existantes ;
- interpolation automatique `smooth`, `linear`, `easeIn`, `easeOut` ou `step` ;
- lecture, scrubbing, boucle et durée réglable ;
- export/import JSON ;
- liaison temporaire d'un objet à un autre avec choix des axes et suivi optionnel de rotation.

## Océan monde réel avec LOD adaptatif

L'océan n'est plus un plan de taille fixe recentré à chaque image autour de la caméra.

Il est maintenant représenté comme un **quadtree en coordonnées monde** couvrant un secteur d'environ **524 km × 524 km**. Le maillage réellement envoyé au GPU dépend de ce que voit la caméra : les tuiles proches sont subdivisées fortement, les tuiles lointaines sont beaucoup plus grossières.

Le critère de subdivision est calculé en **pixels projetés**. Il dépend donc réellement de :

- la distance de la caméra ;
- sa hauteur ;
- la focale ;
- le zoom ;
- le champ de vision effectif ;
- la hauteur du viewport.

Ainsi, passer d'un grand-angle à un téléobjectif ne redimensionne pas artificiellement la mer. C'est la même mer en coordonnées monde ; seul son niveau de tessellation change pour conserver suffisamment de détail à l'écran.

Les vagues utilisent elles aussi les coordonnées monde. Deux tuiles voisines évaluent donc exactement le même champ de vagues aux mêmes coordonnées. Des jupes géométriques masquent les raccords entre niveaux de LOD différents.

Pour éviter un coût absurde, seules les feuilles visibles du quadtree sont instanciées. Les paramètres principaux sont dans `src/core/Ocean.js` :

```js
rootSize: 524288,
minTileSize: 8,
segments: 12,
targetTilePixels: 190,
maxLeaves: 6500
```

- diminuer `minTileSize` augmente le détail maximal ;
- augmenter `segments` augmente la densité géométrique de chaque tuile ;
- diminuer `targetTilePixels` force davantage de subdivisions ;
- augmenter `maxLeaves` autorise plus de tuiles simultanément visibles.

Ces réglages peuvent devenir très coûteux en CPU/GPU. Le système est volontairement conçu pour permettre de pousser la qualité très haut sur une machine puissante sans transformer l'océan en simple décor collé à la caméra.

Les caméras éditeur et cinéma ont maintenant un plan lointain étendu pour pouvoir voir ce grand espace océanique. Le brouillard reste présent comme effet atmosphérique, mais il n'est plus utilisé pour cacher la limite d'un petit plan de mer.

La pluie reste un volume particulaire recyclé autour de la caméra active : contrairement à l'océan, il n'est pas utile de matérialiser des gouttes sur des centaines de kilomètres puisque seules celles proches de la caméra peuvent être perçues.

## Effets localisés

La timeline possède une piste **FX**.

### Explosion

Une explosion peut être placée en coordonnées monde, attachée à un modèle avec un offset local, limitée à un intervalle de temps, et réglée en taille et intensité. L'effet est procédural : sprite lumineux, particules et lumière ponctuelle. Aucun asset externe n'est téléchargé.

### Flamme de moteur fusée

Une flamme peut être attachée à un modèle et suit son mouvement, sa rotation et, pour un bateau, son root de flottabilité. Son offset et sa direction sont exprimés dans le repère local de la cible.

La direction par défaut est `+Z` :

```text
X = 0
Y = 0
Z = 1
```

Inverse `Z` si l'orientation de ton modèle exige une flamme vers `-Z`.

## GLB / textures

`GLTFLoader` conserve les matériaux PBR et les textures du GLB. Les matériaux glTF ne sont pas remplacés par l'éditeur. Les textures reçoivent également une anisotropie adaptée au GPU.

Pour un `.glb`, sélectionne simplement le fichier.

Pour un `.gltf` avec ressources externes, sélectionne en une fois le `.gltf`, son `.bin` et ses images. L'éditeur résout les chemins via des URL `blob:` locales.

Pour OBJ, sélectionne `.obj`, `.mtl` et textures ensemble.

> Les variantes nécessitant des décodeurs supplémentaires comme Draco/KTX2 ne sont pas activées pour l'instant afin de conserver la politique réseau minimale.

## Format timeline JSON

Le format courant est `version: 3`. La version 3 ajoute un identifiant stable aux keyframes pour permettre leur édition ciblée :

```json
{
  "version": 3,
  "duration": 12,
  "loop": false,
  "tracks": {
    "main-boat": [
      {
        "id": "key-...",
        "time": 0,
        "position": [0, 0, -6],
        "quaternion": [0, 0, 0, 1],
        "scale": [1, 1, 1],
        "interpolation": "smooth"
      }
    ]
  },
  "bindings": [],
  "cameraCuts": [],
  "effects": []
}
```

Les timelines `version: 1` et `version: 2` restent importables. Des identifiants de keyframes sont générés automatiquement à l'import.

## Architecture

```text
src/
├── main.js
├── styles.css
├── core/
│   ├── Boat.js
│   ├── CameraController.js
│   ├── CameraManager.js
│   ├── EffectsManager.js
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

`SceneTimeline` reste indépendant du rendu. `OceanWorld` applique ensuite la flottabilité, le LOD de l'océan en fonction de la caméra, la pluie, les effets et le rendu depuis la caméra choisie.
