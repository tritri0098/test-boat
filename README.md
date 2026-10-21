# Ocean Cinematic Scene Creator

Éditeur de scène 3D Three.js pour créer des séquences animées sur un océan procédural, sans Vite ni npm à l'exécution.

## Lancer

```bash
python3 server.py
```

Puis ouvre `http://127.0.0.1:8000/`.

Le serveur Python n'effectue aucun appel réseau sortant. Le navigateur ne contacte que `cdn.jsdelivr.net` pour les modules JavaScript Three.js/GSAP réellement utilisés. Les modèles, textures et timelines restent locaux ou servis par le même serveur.

## Mode éditeur / mode cinématique

Deux vues sont disponibles :

- **Éditeur** : caméra OrbitControls, gizmos de translation/rotation/échelle et sélection des objets ;
- **Vue caméra** : rendu depuis la caméra cinématique active choisie par les coupes de la timeline.

Chaque caméra possède ses propres keyframes de position, rotation, focale, zoom, distance de mise au point, aperture DOF, blur maximal et activation de la profondeur de champ. La piste **CAM CUT** choisit la caméra utilisée à chaque instant.

La profondeur de champ utilise `BokehPass` de Three.js et n'est calculée que dans la vue cinématique lorsqu'elle est activée.

## Keyframes éditables

Chaque keyframe possède un identifiant stable. Un clic sur le losange sélectionne **cette keyframe précise et uniquement celle de sa piste**.

Tu peux ensuite modifier l'objet avec le gizmo ou l'inspecteur puis cliquer sur **Enregistrer cette keyframe**. Déplacer le playhead avant l'enregistrement déplace également la keyframe dans le temps. Une collision avec une autre keyframe du même objet est refusée au lieu d'écraser silencieusement cette dernière.

## Priorité des contraintes

L'ordre d'évaluation est :

```text
1. keyframes / interpolation
2. liaisons objet → objet
3. contrainte verticale objet → surface de la mer
4. sélection de la caméra de rendu
```

Les contraintes ont donc priorité sur les valeurs interpolées des keyframes. Une liaison objet → objet peut piloter X/Z/rotation, puis le suivi de mer peut remplacer uniquement la hauteur Y avec la surface réelle calculée au X/Z résultant.

## Suivi vertical de la mer par keyframes

Un objet chargé **sans** l'option `Flotte sur l'océan` peut recevoir une contrainte verticale animable :

1. place le playhead au moment voulu ;
2. sélectionne l'objet ;
3. règle éventuellement un offset vertical ;
4. clique sur **Activer au playhead** ;
5. plus loin dans la timeline, clique sur **Désactiver au playhead**.

Pendant la période active :

```text
Y objet = hauteur courbe de la mer(X,Z) + vague(X,Z,t) + offset
```

Le suivi est recalculé **à chaque frame de rendu**, donc l'objet suit réellement les vagues même si le playhead est arrêté. Quand la contrainte est désactivée, la transformation provenant des keyframes reprend la main.

Les bateaux créés avec la flottabilité permanente n'utilisent pas cette contrainte supplémentaire, afin d'éviter une double application de la hauteur d'eau.

## Océan monde, LOD et courbure terrestre

La mer n'est plus un plan collé à la caméra. C'est une surface en coordonnées monde découpée par un **quadtree LOD**.

Le niveau de détail dépend de la projection réelle de la caméra : distance, hauteur, taille du viewport, champ de vision effectif, focale et zoom. Un téléobjectif force donc davantage de subdivisions sur une zone lointaine qui occupe beaucoup de pixels, tandis qu'un grand-angle permet de réduire le détail là où il devient invisible.

Paramètres principaux dans `Ocean.js` :

```js
rootSize: 2097152,
rootStride: 262144,
minTileSize: 8,
segments: 12,
targetTilePixels: 190,
maxLeaves: 6500,
earthRadius: 6371000
```

La surface utilise maintenant une sphère terrestre de rayon **6 371 km** tangente au niveau `Y = 0` à l'origine :

```text
y(x,z) = sqrt(R² - x² - z²) - R
```

Les vagues sont ensuite ajoutées à cette altitude. Cela produit un véritable horizon géométrique : avec une caméra basse, la mer disparaît naturellement derrière la courbure au lieu d'être simplement masquée par un brouillard ou limitée par un plan.

Le maillage LOD couvre actuellement un secteur d'environ **2 097 km de côté**, mais seules les feuilles visibles du quadtree sont envoyées au GPU. Le brouillard reste très léger et sert à l'atmosphère, pas à cacher la fin de la géométrie.

Des skirts sont ajoutés aux tuiles pour masquer les fissures entre deux niveaux de LOD. Les petites longueurs d'onde sont également atténuées sur les tuiles très grossières afin d'éviter d'animer des détails impossibles à représenter géométriquement.

> À des distances planétaires extrêmes, il faudra passer à un système de coordonnées flottantes / floating origin. La version actuelle vise les scènes cinématiques allant de quelques mètres à plusieurs centaines de kilomètres autour de l'origine.

## Pluie

La pluie reste un volume local recyclé autour de la caméra de rendu. Les gouttes sont réutilisées individuellement, ce qui permet de parcourir la scène sans rencontrer la bordure d'un bloc de pluie gigantesque.

## Effets localisés

La timeline possède une piste **FX**.

### Explosion

Une explosion peut être placée en coordonnées monde ou attachée à un modèle avec un offset local. Elle possède une durée, une taille et une intensité. L'effet procédural combine sprite lumineux, particules et lumière ponctuelle.

### Flamme moteur fusée

Une flamme peut être attachée à un modèle et suit son mouvement et sa rotation. Son offset et sa direction sont exprimés dans le repère local de la cible.

## GLB / textures

`GLTFLoader` conserve les matériaux PBR et textures du GLB. Les matériaux glTF ne sont pas remplacés par l'éditeur et les textures reçoivent une anisotropie adaptée au GPU.

Pour un `.glb`, sélectionne simplement le fichier. Pour un `.gltf` avec ressources externes, sélectionne en une fois le `.gltf`, son `.bin` et ses images. Pour OBJ, sélectionne `.obj`, `.mtl` et textures ensemble.

> Draco/KTX2 ne sont pas activés pour l'instant afin de conserver la politique réseau minimale.

## Format timeline JSON

Le format courant est `version: 4`. Il ajoute `oceanFollows` aux versions précédentes :

```json
{
  "version": 4,
  "duration": 12,
  "loop": false,
  "tracks": {},
  "bindings": [],
  "oceanFollows": [
    {
      "id": "sea-...",
      "objectId": "rocket",
      "time": 2.0,
      "enabled": true,
      "offset": 4.5
    },
    {
      "id": "sea-...",
      "objectId": "rocket",
      "time": 7.0,
      "enabled": false,
      "offset": 4.5
    }
  ],
  "cameraCuts": [],
  "effects": []
}
```

Les timelines `version: 1`, `2` et `3` restent importables.

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
