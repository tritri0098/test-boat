# Ocean Cinematic Scene Creator

Éditeur de scène 3D Three.js pour créer des séquences animées sur un océan procédural, sans Vite ni npm à l'exécution.

## Lancer

```bash
python3 server.py
```

Puis ouvre `http://127.0.0.1:8000/`.

Le serveur Python n'effectue aucun appel réseau sortant. Le navigateur ne contacte que `cdn.jsdelivr.net` pour les modules Three.js/GSAP. Les modèles, textures et timelines restent locaux ou servis par le même serveur.

## Éditeur, cinéma et vue détachée

Deux vues existent dans l'éditeur :

- **Éditeur** : OrbitControls, sélection et gizmos ;
- **Vue caméra** : rendu depuis la caméra cinématique active de la piste `CAM CUT`.

Les boutons **Lecture** et **Stop** sont déplacés dans la barre de la fenêtre de visualisation.

Le bouton **↗ Détacher la vue** ouvre `viewer.html` dans un autre onglet et synchronise la scène avec l'éditeur via `BroadcastChannel`. Le deuxième onglet reste en vue cinématique et reçoit :

- playhead et lecture/pause ;
- changements de timeline et de caméra active ;
- météo ;
- ajouts/suppressions d'objets ;
- modèles locaux sélectionnés par l'utilisateur, textures comprises.

Les deux onglets doivent être ouverts sur **la même origine HTTP**. Les fichiers locaux importés sont clonés par le navigateur vers le second onglet ; un très gros GLB peut donc consommer davantage de mémoire lorsqu'une vue détachée est ouverte.

## Keyframes éditables

Chaque keyframe possède un identifiant stable. Un clic sur son losange sélectionne uniquement cette keyframe. Position, rotation, échelle et, pour les caméras, paramètres optiques peuvent être modifiés puis enregistrés en place.

Déplacer le playhead avant l'enregistrement déplace aussi la keyframe dans le temps. Une collision avec une autre keyframe du même objet est refusée.

## Liaisons objet → objet

Une liaison est désormais calculée comme une **contrainte de mouvement du parent** et non comme une copie de sa position absolue.

Au début de la liaison, la pose monde du parent est mémorisée. Pendant la liaison :

```text
deltaParent(t) = poseParent(t) - poseParent(début)
poseFinaleEnfant(t) = posePropreEnfant(t) + deltaParent(t)
```

Pour la translation, cela signifie que deux objets séparés par un offset constant suivent la **même trajectoire**, simplement translatée dans l'espace.

Les cases X/Y/Z choisissent les composantes du déplacement du parent à appliquer. Si **Rotation** est cochée, l'enfant reçoit également le **delta angulaire du parent depuis le début de la liaison**. Son orientation propre reste un offset éditable par-dessus cette rotation.

### Transform de l'enfant lié

Le panneau `Transform` et les gizmos continuent à représenter la transformation propre de l'enfant, comme si la liaison n'existait pas :

```text
transformation finale = transformation propre / keyframes enfant
                     + transformation imposée par la liaison
```

Ainsi, déplacer ou tourner un objet lié ne casse pas la liaison : cela change seulement son offset par rapport à la trajectoire/rotation héritée. Lorsqu'une keyframe d'un objet lié est éditée, la valeur enregistrée reste également dans cet espace d'offset et ne contient pas deux fois le mouvement du parent.

Les chaînes de contraintes sont résolues cible avant enfant. Les liaisons restent prioritaires sur les keyframes dans le rendu final.

## Priorité des contraintes

```text
1. keyframes / interpolation de base
2. liaisons objet → objet
3. suivi vertical de la surface de la mer
4. sélection de la caméra de rendu
```

## Suivi vertical de la mer par keyframes

Un objet chargé sans flottabilité peut activer puis désactiver une contrainte de hauteur via des événements ON/OFF dans la timeline.

Pendant la période active :

```text
Y objet = hauteur courbe de la mer(X,Z) + vague(X,Z,t) + offset
```

X/Z continuent donc à provenir des keyframes et/ou d'une liaison objet → objet. Le suivi est recalculé à chaque frame de rendu afin de suivre réellement les vagues.

## Océan monde, LOD et courbure terrestre

La mer est une surface en coordonnées monde découpée par un quadtree LOD. Le niveau de détail dépend de la projection réelle de la caméra : distance, hauteur, viewport, focale et zoom.

Paramètres principaux de `Ocean.js` :

```js
rootSize: 2097152,
rootStride: 262144,
minTileSize: 8,
segments: 12,
targetTilePixels: 190,
maxLeaves: 6500,
earthRadius: 6371000
```

La surface moyenne suit une Terre sphérique de rayon 6 371 km :

```text
y(x,z) = sqrt(R² - x² - z²) - R
```

Les vagues sont ajoutées par-dessus. Cela donne un véritable horizon géométrique et non un plan qui suit la caméra.

## Nuages monde

`CloudField` génère des cellules météo en coordonnées monde avec échelle atmosphérique : cumulus bas, couche moyenne et cellules convectives. Leur altitude est mesurée au-dessus de la surface terrestre courbe. Le vent déplace la masse d'air en mètres par seconde ; la caméra ne déplace plus artificiellement les nuages.

Le rendu utilise des puffs instanciés avec LOD écran et shader procédural. Ce n'est pas encore un ray-marching volumétrique complet, mais les proportions, l'altitude et le mouvement sont cohérents avec la scène.

## Pluie

La pluie reste un volume local recyclé autour de la caméra de rendu afin de donner une pluie spatialement continue sans créer des millions de particules sur tout le monde.

## Caméras

Chaque caméra cinématique possède des keyframes de position, rotation, focale, zoom, distance de mise au point, aperture DOF, blur maximal et activation de la profondeur de champ. La piste `CAM CUT` choisit la caméra rendue à chaque instant.

## Effets localisés

La piste `FX` supporte actuellement :

- explosions localisées, éventuellement attachées à un modèle ;
- flammes de moteur fusée avec offset et direction exprimés dans le repère local du modèle.

## GLB / textures

`GLTFLoader` conserve les matériaux PBR et textures du GLB. Pour un `.gltf`, sélectionne en une fois le `.gltf`, son `.bin` et ses images. Pour OBJ, sélectionne `.obj`, `.mtl` et textures ensemble.

Draco/KTX2 ne sont pas activés pour l'instant afin de conserver la politique réseau minimale.

## Format timeline JSON

Le format courant est **version 5**. La version 5 ajoute les références de pose du parent utilisées par les nouvelles liaisons en delta, tout en conservant `oceanFollows`, `cameraCuts` et `effects`.

Les versions 1 à 4 restent acceptées à l'import ; une référence de liaison manquante est reconstruite lors de la première évaluation de cette liaison.

## Architecture

```text
viewer.html
src/
├── main.js
├── detached.js
├── styles.css
├── ocean-follow.css
├── core/
│   ├── Boat.js
│   ├── CameraController.js
│   ├── CameraManager.js
│   ├── CloudField.js
│   ├── EffectsManager.js
│   ├── ModelLoader.js
│   ├── Ocean.js
│   ├── OceanWorld.js
│   ├── Rain.js
│   ├── SceneActor.js
│   ├── SceneSync.js
│   ├── SceneTimeline.js
│   └── Weather.js
└── editor/
    ├── BindingOffsetController.js
    └── SceneEditor.js
```
