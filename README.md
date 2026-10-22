# Ocean Cinematic Scene Creator

Éditeur de scène 3D Three.js pour créer des séquences animées sur un océan procédural, sans Vite ni npm à l'exécution.

## Lancer

```bash
python3 server.py
```

Puis ouvre `http://127.0.0.1:8000/`.

Le serveur Python n'effectue aucun appel réseau sortant. Le navigateur ne contacte que `cdn.jsdelivr.net` pour Three.js/GSAP. Les modèles, textures et timelines restent locaux ou servis par le même serveur.

## Éditeur et mode cinématique

Deux vues sont disponibles dans la même fenêtre :

- **Éditeur** : OrbitControls, sélection et gizmos ;
- **Vue caméra** : rendu depuis la caméra cinématique active de la piste `CAM CUT`.

Les boutons **Lecture** et **Stop** sont placés dans la barre de la fenêtre de visualisation.

Le mode de visualisation détachée / multi-onglet a été supprimé : l'application fonctionne désormais dans une seule fenêtre afin d'éviter les problèmes de compatibilité navigateur et de synchronisation.

## Keyframes éditables

Chaque keyframe possède un identifiant stable. Un clic sur son losange sélectionne uniquement cette keyframe. Position, rotation, échelle et, pour les caméras, paramètres optiques peuvent être modifiés puis enregistrés en place.

Déplacer le playhead avant l'enregistrement déplace aussi la keyframe dans le temps. Une collision avec une autre keyframe du même objet est refusée.

## Liaisons objet → objet

Une liaison est calculée comme une contrainte de mouvement du parent et non comme une copie de sa position absolue.

Au début de la liaison, la pose monde du parent est mémorisée. Pendant la liaison :

```text
deltaParent(t) = poseParent(t) - poseParent(début)
poseFinaleEnfant(t) = posePropreEnfant(t) + deltaParent(t)
```

Deux objets séparés par un offset constant suivent donc la même trajectoire, simplement translatée dans l'espace.

Les cases X/Y/Z choisissent les composantes du déplacement du parent à appliquer. Si **Rotation** est cochée, l'enfant reçoit également le delta angulaire du parent depuis le début de la liaison. Son orientation propre reste un offset éditable par-dessus cette rotation.

Le panneau `Transform` et les gizmos continuent à représenter la transformation propre de l'enfant. Modifier un objet lié change donc son offset sans casser la liaison.

Les chaînes de contraintes sont résolues cible avant enfant. Les liaisons restent prioritaires sur les keyframes.

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

X/Z continuent à provenir des keyframes et/ou d'une liaison objet → objet. Le suivi est recalculé à chaque frame afin de suivre réellement les vagues.

## Océan monde et deux modèles de mer

La mer est une surface en coordonnées monde découpée par un quadtree LOD. Le niveau de détail dépend de la projection réelle de la caméra : distance, hauteur, viewport, focale et zoom.

Deux modes sont disponibles :

- **Standard · LOD léger** : rendu plus économique ;
- **Houle géométrique · maillage fin** : maillage plus dense avec plusieurs ondes de Gerstner et déplacement horizontal/vertical des sommets.

La hauteur de houle est réglable de **0 à 15 m** et alimente le rendu, la flottabilité et les contraintes de suivi de mer avec le même modèle.

La surface moyenne suit une Terre sphérique de rayon 6 371 km :

```text
y(x,z) = sqrt(R² - x² - z²) - R
```

Les vagues sont ajoutées par-dessus, donnant un véritable horizon géométrique.

## Nuages monde

`CloudField` génère des cellules météo en coordonnées monde avec échelle atmosphérique. Leur altitude est mesurée au-dessus de la surface terrestre courbe et le vent déplace la masse d'air en mètres par seconde.

Le rendu utilise des puffs instanciés avec LOD écran et shader procédural. Ce n'est pas encore un ray-marching volumétrique complet.

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

Draco/KTX2 ne sont pas activés pour l'instant.

## Format timeline JSON

Le format courant est **version 5**. Il contient notamment les références de pose utilisées par les liaisons en delta, `oceanFollows`, `cameraCuts` et `effects`.

Les versions 1 à 4 restent acceptées à l'import.

## Architecture

```text
src/
├── main.js
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
│   ├── SceneTimeline.js
│   └── Weather.js
└── editor/
    ├── BindingOffsetController.js
    └── SceneEditor.js
```

`viewer.html`, `src/detached.js` et `src/core/SceneSync.js` sont conservés uniquement comme stubs inertes pour éviter de casser d'anciens favoris ou caches navigateur ; ils ne participent plus à l'application principale.
