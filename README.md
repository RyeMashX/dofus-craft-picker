# Dofus Craft Picker

Outil pour choisir l'item à crafter puis forgemager le plus rentable sur Dofus (serveur Mikhal), avec un budget donné.
JavaScript vanilla, modules ES, sans build. Compagnon de [fm-dofus](https://github.com/RyeMashX/fm-dofus).

Aucune lecture réseau du client, aucun clic automatisé : uniquement des captures d'écran faites par le joueur.

## État

Étape 1 : moteur de calcul, testé (`npm test`, Node 20+).
Étape 2 : catalogue DofusDB (`data/catalogue.json`, régénéré par `node scripts/catalogue.mjs`) : 642 équipements craftables 190-200, 538 ressources ; 554 craftables avec les métiers actuels (Forgeron 190).
Étape 3 : base de prix horodatée, base d'évaluation, listes de scan priorisées et plan de scan. Focus actuel : items niveau 200 (364 craftables).
Étape 4 : lecture OCR des quatre écrans HDV (liste, annonces d'un équipement, lots d'une ressource, courbe 30 jours), validée sur de vraies captures (`npm run test:ocr`).
Étape 5 : interface (vues Scan, Résultats, Base), fenêtre flottante, capture du jeu et scan en un clic.

## Utilisation

1. Ouvre la page dans **Chrome**, clique **Flottant** : l'outil passe dans une petite fenêtre qui reste au-dessus du jeu.
2. **Capturer le jeu** : choisis la fenêtre Dofus dans la boîte de partage.
3. Choisis ce que tu scannes dans **Je scanne** (courbe 30 j, annonces d'un item, lots d'une ressource, liste HDV). Copier un nom depuis le plan règle ce choix tout seul.
4. Ouvre l'écran en jeu puis **Scanner** : la lecture est enregistrée tout de suite et reste affichée. **Modifier** pour corriger, **annuler** pour revenir à l'état d'avant. Sinon, passe directement au suivant.
5. Si une fenêtre du jeu n'est pas à sa place habituelle, **Zones** fait encadrer la zone du mode choisi dans « Je scanne » (une seule).

Pour le volume, la courbe doit être sur l'onglet **30 jours** (détecté à sa couleur). Un clic sur une ligne des listes permet aussi la saisie à la main.

## Lecture OCR

- Chaque écran est lu sur une **zone recadrée** (la fenêtre HDV) : sur l'écran entier, le décor du jeu rend la lecture inexploitable.
- Prétraitement : masquage des icônes kama (jaunes, sinon lues comme un « 4 » collé au prix), niveaux de gris inversés, agrandissement ×2, seuillage.
- **Deux passes** : une lecture complète repère les rangées et les colonnes (« Lot », « ACHETER », niveau), puis une lecture de la seule colonne des prix en chiffres uniquement.
- Les noms lus sont rapprochés du catalogue avec une tolérance aux fautes (« Coller de Gargandyas » → Collier de Gargandyas). Le niveau lu départage les homonymes.
- Les ressources hors catalogue (non utilisées par les recettes du focus) sont ignorées.

| Écran | Ce qui est enregistré |
|---|---|
| Liste HDV (équipements ou ressources) | prix moyen de chaque ligne |
| Détail d'un équipement | prix des annonces (5 plus bas) |
| Détail d'une ressource | prix des lots x1 / x10 / x100 |
| Cours du marché, onglet 30 jours | nombre d'articles vendus |

## Plan de scan

1. **Passe initiale** : volumes de tous les items du focus, puis prix moyens (liste HDV équipements et ressources, plusieurs lignes par capture).
2. **Priorisation** : le prix moyen ne sert qu'à estimer un rendement grossier pour décider quoi scanner. Il n'entre jamais dans la décision d'achat.
3. **Base d'évaluation** : un item n'y entre que lorsqu'il est entièrement scanné et frais (volume, annonces, lots de toutes ses ressources).
4. **Trois listes de scan**, chacune triable, avec un tag urgent / à faire / plus tard :

| Liste | Contenu | Le score monte quand… |
|---|---|---|
| Volumes | tous les items du focus | le relevé vieillit (validité 14 j) et le dernier volume est proche du seuil de 60 |
| Prix items | items ≥ 60 ventes/mois | le relevé vieillit (2 j) et le rendement estimé est élevé |
| Ressources | ressources des items ≥ 60 ventes/mois | le relevé vieillit (3 j) et la ressource sert à des items prometteurs |

`score = âge / validité × poids` (jamais relevé = 1,5). Urgent à partir de 1,2, à faire à partir de 0,8.

5. **Plan pour un temps donné** : on prend les tâches urgentes puis à faire, par score, jusqu'à épuiser le temps disponible (15 s par capture d'item, 10 s par ressource, à calibrer).

## Fraîcheur des relevés

| Donnée | Validité |
|---|---|
| Volume de ventes d'un équipement | 14 jours |
| Annonces en vente d'un équipement | 2 jours |
| Lots x1/x10/x100 d'une ressource | 3 jours |
| Prix moyen (liste HDV) | 14 jours |

## Processus cible

1. **Catalogue** (auto) : équipements craftables 190-200 + recettes depuis DofusDB.
2. **Relevé équipements** (hebdo) : capture de la courbe "Cours du marché" (30 jours) → nb d'articles vendus ; capture de la liste des annonces → prix les plus bas. Sous 60 ventes/mois : écarté.
3. **Relevé ressources** (début de session) : capture de chaque ressource à l'HDV ressources → prix des lots x1, x10, x100, horodatés.
4. **Pré-classement** (auto) : marge estimée au prix le plus bas pour tous les candidats → shortlist.
5. **Contrôle des finalistes** (V2) : jets des annonces → prix le plus bas avec jet correct.
6. **Allocation du budget** (auto) : quels items, combien de fois chacun.
7. **Liste de courses** : lots à acheter par ressource, alertes sur celles à revérifier.
8. **Journal** : coûts et prix réels, pour calibrer les paramètres.

## Règles de calcul

### Marge

```
revenu    = prix de vente visé × (1 − 2 %)
marge     = revenu − coût du craft
rendement = marge / coût du craft     (seuil : 25 %)
```

Prix de vente visé = annonce la moins chère − 1 kama (option : moyenne des 3 moins chères − 1).
On ne se fie ni au prix moyen ni au médian : un item à 2 M peut se vendre 10 M avec un exo, ce qui fausse les moyennes.
La FM n'est pas comptée en phase initiale (`inclureFm`). V2 : forfait par item, puis estimation par le solveur de fm-dofus.

### Règle des lots (achat des ressources)

Pour une quantité `q` d'une ressource, l'outil teste toutes les combinaisons de lots x1/x10/x100 et garde la moins chère :

1. **Profondeur** : le prix affiché n'est garanti que pour les premiers lots (3 lots x1, 2 lots x10, 1 lot x100). Au-delà, chaque lot est compté **+10 %**, parce que la ligne se vide et que le prix remonte.
2. **Surplus** : les unités en trop sont revendues à **80 %** du prix x1 à l'unité, ou à 80 % du prix x10 par paquets de 10 (le plus avantageux), taxe déduite. Une unité revendue ne compte jamais plus que ce qu'elle a coûté.
3. **Seuil** : on n'achète plus que nécessaire que si ça fait gagner au moins **20 %** par rapport au meilleur plan sans surplus.
4. **Alerte** : si le plan prudent coûte plus de **20 %** de plus que le plan optimiste (tout au prix affiché), la ressource est marquée **à revérifier** avant achat.

Exemple réel, Étoffe sanglante (x1 2 874, x10 22 949, x100 700 012) :

| Besoin | Plan retenu | Coût compté | Commentaire |
|---|---|---|---|
| 2 | 2 × x1 | 5 748 | le x10 (4 957 en revendant 8 unités) ne fait gagner que 14 %, sous le seuil de 20 % |
| 7 | 1 × x10 | 16 202 | 24 % moins cher que 21 268 en x1 |
| 150 | 15 × x10 | 374 069 | 2 lots au prix affiché, 13 à +10 % ; optimiste 344 235 (écart 9 %, pas d'alerte) |

Ces paramètres sont des hypothèses de départ : le journal servira à les calibrer.

### Allocation du budget

- Un même item peut être crafté plusieurs fois, au plus **1 jour de vente** (volume mensuel / 30 ; 60/mois → 2 max).
- Les ressources sont achetées en une fois pour tous les crafts d'un item (la règle des lots s'applique sur la quantité cumulée).
- L'outil maximise `marge totale − coût d'effort × nombre de crafts` sous la contrainte du budget. Le coût d'effort (300 000 kamas par craft par défaut) traduit ta préférence : à 30 M, 6 crafts à 25 % (7,5 M) battent 12 crafts à 30 % (9 M) dès que l'effort vaut plus de 250 000 par craft.
- Le budget n'est pas forcément dépensé en entier.

## Limites connues (V1)

- Deux items qui partagent une ressource sont calculés comme s'ils l'achetaient séparément (la profondeur n'est pas partagée).
- Vendre 2 exemplaires du même item suppose qu'ils partent au même prix.
- Le coût de FM n'est pas compté en phase initiale.
- Le prix de vente ne tient pas encore compte du jet (V2).

## Structure

```
src/params.js      paramètres par défaut
src/lots.js        règle des lots x1/x10/x100
src/craft.js       coût de n crafts d'une recette
src/marge.js       prix de vente visé, marge, éligibilité
src/allocation.js  répartition du budget
src/catalogue.js   filtre par métiers, ressources à relever
src/base.js        base de prix horodatée, export / import
src/entonnoir.js   estimation (pour prioriser) et base d'évaluation (pour décider)
src/priorites.js   listes de scan, tags de priorité, plan de scan
scripts/catalogue.mjs  génération du catalogue depuis DofusDB
data/catalogue.json    catalogue généré
src/ocr/           prétraitement, lecteurs d'écrans, rapprochement des noms
tests/             tests du moteur (node --test)
tests/ocr/         test OCR sur de vraies captures (npm run test:ocr)
```
