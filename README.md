# Dofus Craft Picker

Outil pour choisir l'item à crafter puis forgemager le plus rentable sur Dofus (serveur Mikhal), avec un budget donné.
JavaScript vanilla, modules ES, sans build. Compagnon de [fm-dofus](https://github.com/RyeMashX/fm-dofus).

Aucune lecture réseau du client, aucun clic automatisé : uniquement des captures d'écran faites par le joueur.

## État

Étape 1 : moteur de calcul, testé (`npm test`, Node 20+).
Étape 2 : catalogue DofusDB (`data/catalogue.json`, régénéré par `node scripts/catalogue.mjs`) : 642 équipements craftables 190-200, 538 ressources ; 554 craftables avec les métiers actuels (Forgeron 190).
Étape 3 : base de prix horodatée, base d'évaluation, listes de scan priorisées et plan de scan. Focus actuel : items niveau 200 (364 craftables).
Étape 4 : lecture OCR des quatre écrans HDV (liste, annonces d'un équipement, lots d'une ressource, courbe 30 jours), validée sur de vraies captures (`npm run test:ocr`).
Étape 5 : interface (onglets Scan, Données, Craft, Achats, Ventes ; réglages via ⚙), fenêtre flottante, capture du jeu et scan en un clic.

## Utilisation

1. Ouvre la page dans **Chrome**, clique l'icône de fenêtre flottante (à côté de ⚙) : l'outil passe dans une petite fenêtre qui reste au-dessus du jeu.
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
| Détail d'un équipement | prix des annonces (les 3 plus bas) |
| Détail d'une ressource | prix des lots x1 / x10 / x100 / x1000 |
| Cours du marché, onglet 30 jours | nombre d'articles vendus |

## Fraîcheur des données

| Info | Noir | Orange (périmé) | Jaune (à risque) | Vert (à jour) |
|---|---|---|---|---|
| Volume 30 j | aucune | > 2 mois | > 1 mois | < 1 mois |
| Prix équipement | aucune | prix moyen seul, ou > 2 semaines | > 1 semaine | < 1 semaine |
| Prix ressource | aucune | prix moyen seul, ou > 1 semaine | > 3 jours | < 3 jours |

- **Prêt pour le craft** : volume vert ou jaune, prix vert, ressources sans orange ni noir et au plus 2 jaunes.
- **Utilisable** : aucune donnée orange ou noire. Le plan de craft (onglet Craft) prend les items utilisables et signale ceux qui ne sont pas prêts (⚠).

## Plan de scan

1. Tu indiques le temps disponible. L'outil le convertit en scans (durée par type mesurée sur tes scans réels, sinon 15 s / 15 s / 10 s) et affiche combien d'items seront prêts à la fin.
2. **Préparer le craft (70 %, réglable)** : on complète les dossiers d'items pour qu'ils deviennent prêts, en prenant à chaque fois celui qui rapporte le plus par seconde de scan restante (marge estimée × ventes par jour ; une ressource partagée ne compte qu'une fois).
3. **Entretien (le reste)** : données noires, orange puis jaunes du reste de la base, pondérées par leur importance (ventes de l'item, proximité du seuil de volume, nombre d'items vendables qui utilisent la ressource). Une donnée rafraîchie repasse au vert : ce ne sont jamais les mêmes qui reviennent.
4. **Déroulé** : HDV Équipements puis HDV Ressources (les prix des ressources bougent le plus, on les relève en dernier). Un groupe = un réglage de filtres (catégories cochées et niveaux min / max). Les petites catégories sont regroupées, les très grosses découpées par tranche de niveau. Lignes triées dans l'ordre de l'HDV (accents après le z).
5. « Je scanne » suit la prochaine tâche. Une ligne se coche quand sa donnée est relevée ; fin de catégorie et fin d'HDV sont signalées.

## Onglet Données

KPIs, trois barres de fraîcheur (volumes, prix équipements, prix ressources), puis deux tables (Équipements, Ressources) : recherche, filtres (catégorie, état ou fraîcheur, vendables), tri par colonne, modification directe des valeurs (clic sur une valeur soulignée), et détail au clic sur le nom (recette d'un équipement, items qui utilisent une ressource).

## Onglet Craft

- **Crafts viables** : données sans orange ni noir, au moins 60 ventes / mois, rendement d'au moins 15 %. « Cible » à partir de 25 %, « acceptable » entre 15 et 25 %. Les items exclus n'apparaissent pas ; ceux en vente sont marqués.
- **Plan de craft** : « Générer le plan de craft » calcule une recommandation à partir du budget (items cibles, ni en vente ni exclus, au plus un jour de vente par item), puis le plan est **figé** : ses chiffres suivent les prix, mais ses items ne changent que si tu le modifies (+ / − / ✕, ajout depuis les viables) ou le régénères. Un item du plan devenu non viable reste, signalé avec la raison.
- **Mise en vente** : « 🏷 vente » sur une ligne met 1 exemplaire en vente (ligne « draft » dans Ventes, prix = prix de vente estimé, coût = coût du craft, FM = FM estimée) et le retire du plan ; « Tout mettre en vente » fait de même pour tout le plan.
- **Marge affichée = marge réelle** (taxe de 2 % déduite). L'effort (coût fictif par craft, réglable) ne sert qu'à départager dans la recommandation. La **confiance** (volume 15 %, prix de vente 35 %, ressources 50 % pondérées par leur part du coût ; vert = 1, jaune = 0,6) est affichée seulement.
- **Infobulle** au survol du nom d'un craft (plan ou viables) : la recette avec, pour chaque ressource, la quantité (× nombre de crafts dans le plan), le prix unitaire, le coût et la fraîcheur ; puis coût du craft, prix de vente, taxe et marge. Lots relevés sinon prix moyen (marqué « m »).
- Le coût total du plan est calculé avec les **achats regroupés** : une ressource partagée entre plusieurs crafts est achetée en une fois.

## Onglet Achats

« Générer la liste d'achat » prend une photo du plan : ressources, quantités additionnées, lots conseillés (x1 / x10 / x100 / x1000) avec leur prix unitaire, prix unitaire attendu et coût, classées par HDV puis catégorie. La liste ne bouge plus jusqu'à la prochaine génération ; un avertissement s'affiche si le plan a changé depuis. Vue compacte, une ligne par ressource : copier le nom, icône, nom, quantité, total, prix unitaire attendu, case « acheté » ; ⚠ quand le prix risque de remonter. Un clic sur la ligne déplie le détail : lots conseillés avec leur prix unitaire, surplus, fraîcheur du relevé, crafts qui utilisent la ressource.

## Onglet Ventes

- Une ligne par exemplaire : date de mise en vente, prix, coût du craft, coût de mise en vente, coût de FM, tous modifiables ; marge = prix − craft − mise en vente − FM.
- **Frais de mise en vente** (règle de l'HDV) : 2 % du prix initial, puis 1 % du nouveau prix à chaque changement de prix. En draft, ils sont recalculés à 2 % du prix à chaque modification ; une fois la ligne validée, ils sont figés (sauf saisie manuelle). « Prix modifié » enregistre un changement de prix à l'HDV : nouveau prix et + 1 % de ce prix dans les frais. Modifier directement le champ prix d'une ligne validée est une simple correction, sans frais.
- **Filtres et tri** (mémorisés) : nom, statut (draft / validé), sans prix, marge négative, en vente depuis plus de 7 ou 14 jours ; tri par nom, date de mise en vente, prix, marge ou rendement. Les indicateurs portent sur les lignes affichées ; la marge attendue est aussi donnée en % du coût (craft + FM) des lignes qui ont un prix.
- Statut **draft** (ajouté depuis le Craft, à vérifier) ou **validé** (clic sur le statut pour basculer).
- **Relevé OCR** depuis l'onglet (« Scanner mes ventes », zone propre) : item absent → ligne validée, coût estimé d'après la base ; même item au même prix → même annonce ; même item à un autre prix → tu choisis « Fusionner avec la ligne du … » (= changement de prix, + 1 % de frais sur une ligne validée) ou « Nouvelle ligne ». Deux exemplaires lus sur le même écran font deux lignes.
- Tant qu'un item a au moins une ligne en vente, il n'est pas proposé dans le plan de craft ni préparé par le plan de scan.
- **✓ Vendu** : la ligne sort de la liste et passe dans le **Bilan** (date de vente modifiable).

## Onglet Bilan

**Historique des prix** : chaque « Prix modifié » (ou fusion d'une annonce relue à un autre prix) est gardé. Les lignes de Ventes et du Bilan montrent la suite des prix (3,5 M → 3,2 M → 2,9 M), l'écart au prix initial et le nombre de changements. Le Bilan donne les changements de prix par vente, la part vendue au prix initial, l'écart moyen prix final / initial, et le détail par item (ventes, changements, écart, délai). Les corrections du champ prix ne comptent pas comme des changements.

Ventes, chiffre d'affaires, marge et rendement, délai moyen de vente, détail par mois, liste de tout ce qui a été vendu (chiffres modifiables, « remettre en vente » en cas d'erreur).

## Liste noire

Onglet Données, clic sur le nom d'un équipement : exclusion définitive ou jusqu'à une date. Un item exclu sort du plan de scan, du Craft et des recommandations. Filtre « exclus » dans Données.

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
**Coût de FM estimé** : moyenne des coûts de FM renseignés sur tes exemplaires vendus de l'item, sinon de tous tes items vendus (un coût à 0 compte comme non renseigné). Il est déduit de la marge du Craft (viabilité, recommandation, plan, budget), détaillé dans l'infobulle, et prérempli sur les lignes de Ventes (mise en vente depuis le Craft, relevé OCR). Sans aucune vente renseignée, pas de FM déduite. `inclureFm: false` dans les paramètres revient à une marge sans FM.

**Ressource introuvable** : quand l'HDV n'a aucun lot d'une ressource (légendes…), le scan échoue ; « Aucun lot disponible » (bouton de la carte de lecture en modification, ou de la saisie manuelle en mode lots) la marque introuvable. Elle compte comme orange, n'a plus de prix, et aucun craft qui en a besoin n'est proposé (raison affichée dans le plan). Comme toute donnée orange, elle peut revenir dès le prochain plan de scan ; le prochain relevé de lots la rétablit. Étiquette « introuvable » dans Données.

### Règle des lots (achat des ressources)

Pour une quantité `q` d'une ressource, l'outil teste toutes les combinaisons de lots x1/x10/x100/x1000 et garde la moins chère :

1. **Profondeur** : le prix affiché n'est garanti que pour les premiers lots (3 lots x1, 2 lots x10, 1 lot x100, 1 lot x1000). Au-delà, chaque lot est compté **+10 %**, parce que la ligne se vide et que le prix remonte.
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
- Le coût de FM est une moyenne de tes ventes passées : il ne tient pas compte des jets visés.
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
src/fraicheur.js   niveaux de fraîcheur, état prêt / utilisable, ordre alphabétique de Dofus
src/plan.js        plan de scan : choix des scans, groupes HDV / filtres
src/vue-plan.js    onglet Scan
src/vue-donnees.js onglet Données
src/craft-plan.js  crafts viables, confiance, recommandation, plan modifiable, achats regroupés
src/statut.js      liste noire
src/ventes.js      ventes (une ligne par exemplaire), import OCR, bilan
src/vue-craft.js   onglet Craft
src/vue-achats.js  onglet Achats
src/vue-ventes.js  onglet Ventes
src/vue-bilan.js   onglet Bilan
scripts/catalogue.mjs  génération du catalogue depuis DofusDB
data/catalogue.json    catalogue généré
src/ocr/           prétraitement, lecteurs d'écrans, rapprochement des noms
tests/             tests du moteur (node --test)
tests/ocr/         test OCR sur de vraies captures (npm run test:ocr)
```
