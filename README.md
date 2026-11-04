# Dofus Craft Picker

Outil pour choisir l'item à crafter puis forgemager le plus rentable sur Dofus (serveur Mikhal), avec un budget donné.
JavaScript vanilla, modules ES, sans build. Compagnon de [fm-dofus](https://github.com/RyeMashX/fm-dofus).

Aucune lecture réseau du client, aucun clic automatisé : uniquement des captures d'écran faites par le joueur.

## État

Étape 1 : moteur de calcul seul, testé (`npm test`, Node 20+). Pas encore d'interface.

## Processus cible

1. **Catalogue** (auto) : équipements craftables 190-200 + recettes depuis DofusDB.
2. **Relevé équipements** (hebdo) : capture de la courbe "Cours du marché" (30 jours) → prix moyen, prix médian, nb d'articles vendus. Sous 60 ventes/mois : écarté.
3. **Relevé ressources** (début de session) : capture de chaque ressource à l'HDV ressources → prix des lots x1, x10, x100, horodatés.
4. **Pré-classement** (auto) : marge estimée au prix médian pour tous les candidats → shortlist.
5. **Contrôle des finalistes** : capture des annonces en vente → prix le plus bas avec jet correct.
6. **Allocation du budget** (auto) : quels items, combien de fois chacun.
7. **Liste de courses** : lots à acheter par ressource, alertes sur celles à revérifier.
8. **Journal** : coûts et prix réels, pour calibrer les paramètres.

## Règles de calcul

### Marge

```
revenu    = prix de vente visé × (1 − 2 %)
capital   = coût des ressources + coût de FM
marge     = revenu − capital
rendement = marge / capital          (seuil : 25 %)
```

Prix de vente visé = annonce la moins chère **avec jet correct** − 1 kama.
Coût de FM : forfait par item en V1, estimation par le solveur de fm-dofus en V2.

### Règle des lots (achat des ressources)

Pour une quantité `q` d'une ressource, l'outil teste toutes les combinaisons de lots x1/x10/x100 et garde la moins chère, avec trois hypothèses :

1. **Profondeur** : le prix affiché n'est garanti que pour les premiers lots (par défaut 3 lots x1, 3 lots x10, 2 lots x100). Au-delà, chaque lot est compté **+25 %**, parce que la ligne se vide et que le prix remonte.
2. **Surplus** : si on achète plus que nécessaire (un x10 pour 7 unités), les unités en trop sont revendues et on récupère **50 %** de leur valeur (prix unitaire le plus bas, taxe déduite). Prudent, car la revente prend du temps.
3. **Alerte** : on calcule aussi le coût "optimiste" (tout au prix affiché). Si le plan prudent coûte plus de **15 %** de plus, la ressource est marquée **à revérifier** avant achat.

Exemple réel, Étoffe sanglante (x1 2 874, x10 22 949, x100 700 012) :

| Besoin | Plan retenu | Coût compté | Commentaire |
|---|---|---|---|
| 2 | 2 × x1 | 5 748 | x1 direct |
| 7 | 1 × x10 | 19 575 | moins cher que 7 × x1 même en revendant mal les 3 en trop |
| 150 | 15 × x10 | 413 082 | 3 lots au prix affiché, 12 à +25 % ; optimiste 344 235 → **à revérifier** |

Ces paramètres sont des hypothèses de départ : le journal servira à les calibrer.

### Allocation du budget

- Un même item peut être crafté plusieurs fois, au plus **1 jour de vente** (volume mensuel / 30 ; 60/mois → 2 max).
- Les ressources sont achetées en une fois pour tous les crafts d'un item (la règle des lots s'applique sur la quantité cumulée).
- L'outil maximise `marge totale − coût d'effort × nombre de crafts` sous la contrainte du budget. Le coût d'effort (300 000 kamas par craft par défaut) traduit ta préférence : à 30 M, 6 crafts à 25 % (7,5 M) battent 12 crafts à 30 % (9 M) dès que l'effort vaut plus de 250 000 par craft.
- Le budget n'est pas forcément dépensé en entier.

## Limites connues (V1)

- Deux items qui partagent une ressource sont calculés comme s'ils l'achetaient séparément (la profondeur n'est pas partagée).
- Vendre 2 exemplaires du même item suppose qu'ils partent au même prix.
- Le coût de FM est un forfait saisi à la main.

## Structure

```
src/params.js      paramètres par défaut
src/lots.js        règle des lots x1/x10/x100
src/craft.js       coût de n crafts d'une recette
src/marge.js       prix de vente visé, marge, éligibilité
src/allocation.js  répartition du budget
tests/             tests du moteur (node --test)
```
