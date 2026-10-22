# Modèles de mer

L'éditeur propose deux moteurs partageant le même océan monde : quadtree LOD, courbure terrestre et horizon géométrique restent actifs dans les deux cas.

## Standard

Profil destiné à l'édition fluide et aux machines plus modestes.

- quadtree monde : ~2 097 km de côté autour du secteur actif ;
- tuiles proches jusqu'à 8 m ;
- 12 x 12 cellules par tuile ;
- déplacement vertical multi-ondes ;
- LOD dépendant de la distance, du viewport, de la focale et du zoom.

## Houle géométrique

Profil haute qualité destiné aux plans cinématiques.

- même quadtree monde / même courbure terrestre ;
- tuiles proches jusqu'à 4 m ;
- 24 x 24 cellules par tuile ;
- seuil LOD plus exigeant et budget de tuiles supérieur ;
- six composantes de Gerstner ;
- déplacement vertical **et horizontal** des sommets ;
- crêtes plus marquées quand `Tempête` augmente ;
- calcul CPU cohérent pour `heightAt()`, la flottabilité des bateaux et les contraintes de hauteur liées à la mer.

Le mode géométrique est nettement plus coûteux en GPU et augmente aussi le travail CPU lors des reconstructions du quadtree.

## Hauteur de houle

`Hauteur houle` est exprimée en mètres et peut varier de `0` à `15 m`.

La valeur correspond à une hauteur de vague cible approximative **creux → crête**. Les composantes sont déphasées, donc la différence instantanée entre le plus haut sommet et le plus bas creux n'est pas nécessairement exactement égale à cette valeur à chaque image.

Le preset `Calme` vise `0,35 m`. Le preset `Tempête` vise `8 m`. La hauteur reste réglable manuellement jusqu'à `15 m` dans les deux moteurs.

Cette même valeur est utilisée par :

- le shader de l'océan ;
- `Ocean.heightAt()` ;
- la flottabilité des bateaux ;
- la contrainte keyframée `Hauteur liée à la mer` ;
- la vue détachée synchronisée.
