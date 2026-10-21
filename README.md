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

## Océan et pluie continus

Le maillage d'océan est un patch large qui suit la caméra de rendu en X/Z. Les vagues sont calculées à partir des coordonnées monde, donc le déplacement du patch ne remet pas leur phase à zéro. Le brouillard masque progressivement les limites géométriques du patch.

Le volume de pluie suit lui aussi la caméra active. Les gouttes sont recyclées autour de cette caméra individuellement, sans redémarrage collectif de l'animation.

Ce système donne l'illusion d'un environnement très étendu dans les deux modes, sans devoir créer une surface ou un nuage de particules réellement infinis.

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

`SceneTimeline` reste indépendant du rendu. `OceanWorld` applique ensuite la flottabilité, le recentrage de l'océan/pluie, les effets et le rendu depuis la caméra choisie.
