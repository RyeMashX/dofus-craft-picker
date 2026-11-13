# Dofus Craft Picker

Outil pour choisir l'item à crafter puis forgemager le plus rentable sur Dofus (serveur Mikhal), avec un budget donné.
JavaScript vanilla, modules ES, sans build. Compagnon de [fm-dofus](https://github.com/RyeMashX/fm-dofus).

Aucune lecture réseau du client, aucun clic automatisé : uniquement des captures d'écran faites par le joueur.

## État

Étape 1 : moteur de calcul, testé (`npm test`, Node 20+).
Étape 2 : catalogue DofusDB (`data/catalogue.json`, régénéré par `node scripts/catalogue.mjs`) : 642 équipements craftables 190-200, 704 ressources dont 59 craftables (alliages, substrats, potions… et leurs composants) ; 554 craftables avec les métiers actuels (Forgeron 190).
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

**Rouge (introuvable)** : ressource sans aucun lot en vente au dernier passage (« Aucun lot disponible »). Priorité entre noir et orange ; un item qui en dépend n'est ni prêt ni utilisable.

- **Prêt pour le craft** : volume vert ou jaune, prix vert, ressources sans orange, rouge ni noir et au plus 2 jaunes.
- **Utilisable** : aucune donnée orange ou noire. Le Craft prend les items utilisables ; leur pourcentage de confiance résume la fraîcheur des données, et son survol liste ce qui n'est pas vert (« prix de vente jaune · Étoffe jaune »).

## Plan de scan

1. Tu indiques le temps disponible. L'outil le convertit en scans (durée par type mesurée sur tes scans réels, sinon 15 s / 15 s / 10 s) et affiche combien d'items seront prêts à la fin.
2. **Préparer le craft (70 %, réglable)** : on complète les dossiers d'items pour qu'ils deviennent prêts, en prenant à chaque fois celui qui rapporte le plus par seconde de scan restante (marge estimée × ventes par jour ; une ressource partagée ne compte qu'une fois).
3. **Veille (10 %, réglable)** : les données que ni le craft ni l'entretien ne demandent : prix des équipements sous le seuil de volume, ressources qui ne servent qu'à des items non vendables, volume et prix des items exclus. Priorité habituelle : noir, rouge, orange, jaune, puis les vertes les plus anciennes. Elle reprend aussi le temps que l'entretien n'utilise pas.
4. **Entretien (le reste, 20 % par défaut)** : données noires, rouges (ressources introuvables), orange puis jaunes du reste de la base, pondérées par leur importance (ventes de l'item, proximité du seuil de volume, nombre d'items vendables qui utilisent la ressource). Quand il n'y a plus que du vert, l'entretien prend les données vertes les plus anciennes (âge rapporté au seuil du jaune), toujours après les jaunes. Une donnée rafraîchie repasse au vert neuf : ce ne sont jamais les mêmes qui reviennent.
5. **Déroulé** : HDV Équipements, HDV Ressources (les prix des ressources bougent le plus, on les relève en dernier), puis HDV Consommables pour les rares ingrédients qui s'y vendent (Potion Étoilée…). Un groupe = un réglage de filtres (catégories cochées et niveaux min / max). Les petites catégories sont regroupées, les très grosses découpées par tranche de niveau. Ordre de l'HDV : les noms d'objets rangent les accents après le z ; les catégories, elles, sont triées sans tenir compte des accents, œ lu « oe » (Écorce, Étoffe, Fleur ; Nowel, Œil, Œuf, Oreille, Os).
6. « Je scanne » suit la prochaine tâche. Une ligne se coche quand sa donnée est relevée ; fin de catégorie et fin d'HDV sont signalées.

## Onglet Données

KPIs, trois barres de fraîcheur (volumes, prix équipements, prix ressources), puis deux tables (Équipements, Ressources) : recherche, filtres (catégorie, état ou fraîcheur, vendables), tri par colonne, modification directe des valeurs (clic sur une valeur soulignée), et détail au clic sur le nom (recette d'un équipement, items qui utilisent une ressource).

Équipements : une seule colonne **Statut**, par priorité exclu > en vente (n exemplaires) > prêt > utilisable ; colonne **Mes ventes** = exemplaires vendus (Bilan).

## Onglet Craft

- **Crafts viables** : données sans orange ni noir, au moins 60 ventes / mois, rendement d'au moins 15 %. « Cible » à partir de 25 %, « acceptable » entre 15 et 25 %. Les items exclus n'apparaissent pas ; ceux en vente sont marqués.
- **Plan de craft** : « Générer le plan de craft » calcule une recommandation à partir du budget (items cibles, ni en vente ni exclus, au plus un jour de vente par item), puis le plan est **figé** : ses chiffres suivent les prix, mais ses items ne changent que si tu le modifies (+ / − / ✕, ajout depuis les viables) ou le régénères. Un item du plan devenu non viable reste, signalé avec la raison.
- **Mise en vente** : « 🏷 vente » sur une ligne met 1 exemplaire en vente (ligne « draft » dans Ventes, prix = prix de vente estimé, coût = coût du craft, FM = FM estimée) et le retire du plan ; « Tout mettre en vente » fait de même pour tout le plan.
- **Marge affichée = marge réelle** (taxe de 2 % déduite). L'effort (coût fictif par craft, réglable) ne sert qu'à départager dans la recommandation. La **confiance** (volume 15 %, prix de vente 35 %, ressources 50 % pondérées par leur part du coût ; vert = 1, jaune = 0,6) est affichée seulement.
- **Détail d'un craft** (clic sur son nom, dans le plan ou les viables) : craft, FM, vente et marge **par craft** en tête ; confiance et données à vérifier (ce qui n'est pas vert) ; recette chiffrée (quantités × nombre de crafts du plan, prix unitaire, coût, fraîcheur ; « m » = prix moyen).
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

**Historique des prix** : chaque « Prix modifié » (ou fusion d'une annonce relue à un autre prix) est gardé. Les lignes de Ventes et du Bilan montrent la suite des prix (3,5 M → 3,2 M → 2,9 M), l'écart au prix initial et le nombre de changements. Le Bilan donne les changements de prix par vente, la part vendue après un changement de prix, l'écart moyen prix final / initial, et un tableau par item (ventes, prix moyen, marge moyenne et rendement, changements, écart) ; un clic sur un item déplie le détail de chacune de ses ventes. Un changement de prix saisi par erreur se supprime avec le × à côté du prix (son 1 % de frais est retiré). Les corrections du champ prix ne comptent pas comme des changements.

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
**Coût de FM estimé** : moyenne des coûts de FM renseignés sur tes exemplaires vendus du même item (un coût à 0 compte comme non renseigné). Il est déduit de la marge du Craft (viabilité, recommandation, plan, budget), détaillé dans l'infobulle, et prérempli sur les lignes de Ventes (mise en vente depuis le Craft, relevé OCR). Sans vente de cet item avec une FM renseignée : n/a, rien n'est déduit et le champ FM reste vide. `inclureFm: false` dans les paramètres revient à une marge sans FM.

**Ressource introuvable** : quand l'HDV n'a aucun lot d'une ressource (légendes…), le scan échoue ; « Aucun lot disponible » (bouton de la carte de lecture en modification, ou de la saisie manuelle en mode lots) la marque introuvable. Elle passe en **rouge** (introuvable : priorité de scan entre noir et orange), n'a plus de prix, et aucun craft qui en a besoin n'est proposé (raison affichée dans le plan). Elle peut revenir dès le prochain plan de scan ; le prochain relevé de lots la rétablit. Étiquette « introuvable » dans Données.

**Équipement sans annonce** : « Aucun item en vente » (mêmes endroits, en mode annonces) enregistre un relevé de prix daté mais vide. La donnée est à jour (pas redemandée avant le seuil habituel) et le prix de vente visé devient le prix moyen ; sans prix moyen, l'item reste en « prix manquant ». Données affiche « aucun » dans Prix min.

### Règle des lots (achat des ressources)

L'HDV ne montre que le lot le moins cher de chaque taille (x1, x10, x100, x1000), jamais combien il y en a derrière. Pour une quantité `q`, l'outil calcule trois coûts :

1. **Optimiste** : tout au prix affiché, sans limite de lots (138 bandeaux = 138 × le x1).
2. **Standard** : au prix affiché, mais au plus **20 lots** d'une même taille (`lotsCredibles`) : 138 x1 n'est pas crédible, on passe au x10 / x100. C'est le plan d'achat proposé. Si aucun plan ne tient dans cette limite (que du x1 affiché), on garde l'optimiste.
3. **Pessimiste** : chaque lot acheté dans une taille fait monter le suivant de **20 %** du prix affiché (2e lot +20 %, 3e +40 %…), plafonné à **3 fois** ce prix ; l'outil prend le meilleur mélange de tailles dans ce scénario.

On impose optimiste ≤ standard ≤ pessimiste. Puis :

- **Risque** = (pessimiste − optimiste) / standard : faible sous 30 %, **moyen** dès 30 % (environ 4 lots d'une taille), **fort** dès 60 % (environ 7 lots). **Pénurie possible** quand il faudrait plus de 20 lots de la plus grande taille affichée : risque fort d'office.
- **Coût retenu** = standard + ⅓ × (pessimiste − standard). C'est lui qui entre dans le coût du craft, la marge, le budget et la liste d'achat.
- **Surplus** : les unités en trop sont revendues à 80 % du prix x1 à l'unité, ou du prix x10 par paquets de 10, taxe déduite, jamais plus cher que payé ; on n'achète du surplus que s'il fait gagner au moins 20 %.

Affichage : pastille « risque » / « risque fort » sur les items du plan de craft et des crafts viables (au survol : lignes concernées et marge si elles se vident), « ! » sur les ressources concernées dans le détail et la liste d'achat, avec les trois coûts. La liste d'achat commence par un bloc **À acheter en premier** : les lignes à risque, triées par kamas en jeu (pessimiste − standard).

Réglages : nombre de lots crédibles, hausse par lot, plafond, part de l'écart retenue. Ce sont des hypothèses de départ, à caler sur les achats réels.

### Allocation du budget

- Un même item peut être crafté plusieurs fois, au plus **1 jour de vente** (volume mensuel / 30 ; 60/mois → 2 max).
- Les ressources sont achetées en une fois pour tous les crafts d'un item (la règle des lots s'applique sur la quantité cumulée).
- L'outil maximise `marge totale − coût d'effort × nombre de crafts` sous la contrainte du budget. Le coût d'effort (300 000 kamas par craft par défaut) traduit ta préférence : à 30 M, 6 crafts à 25 % (7,5 M) battent 12 crafts à 30 % (9 M) dès que l'effort vaut plus de 250 000 par craft.
- Le budget n'est pas forcément dépensé en entier.

### Confirmation avant achat (statut bleu)

- **Bleu** : relevé de moins d'une heure. Ce n'est pas un niveau de fraîcheur de plus : une donnée bleue compte comme verte partout ailleurs. La pastille s'affiche en bleu dans Données, le détail des crafts et la liste d'achat.
- Process : plan de scan (opportunités) → plan de craft → **Confirmer les prix** → ajustement du plan si une marge a bougé → liste d'achat.
- **Confirmer les prix** (onglet Craft, sous le plan) : plan de scan avec le prix de vente des items du plan et les lots de leurs ressources qui ne sont pas bleus, rangé comme d'habitude (HDV, catégories). Une ressource craftable non bleue fait relever son prix d'achat et ses composants non bleus. Le volume de ventes n'est pas redemandé.
- Chaque ligne du plan de craft garde son rendement de référence (à la génération ou à l'ajout) : un écart d'au moins 1 point s'affiche (▼ / ▲, détail au survol).
- Générer la liste d'achat alors que des prix ne sont pas bleus demande une confirmation.

### Sous-crafts (alliages, substrats…)

- Une ressource craftable s'achète à l'HDV ou se crafte à partir de ses composants, récursivement. On la crafte seulement si c'est **au moins 5 % moins cher** que de l'acheter (`gainMinSousCraft`), ou si elle est introuvable à l'HDV. Le temps de craft n'entre pas dans la marge.
- Fraîcheur : une ressource craftable est à jour si son prix d'achat l'est, ou si tous ses composants le sont.
- Plan de scan : pour préparer un item, une ressource craftable pas à jour fait relever son prix d'achat et ses composants. L'entretien et la veille couvrent aussi les composants.
- Plan de craft (détail) et Données : la ressource craftée porte « à crafter », ses composants en dessous.
- Liste d'achat : décidée sur la quantité totale du plan ; les composants s'ajoutent aux achats et la ressource passe dans « À crafter » (les plus profondes d'abord).

## Limites connues (V1)

- Dans le plan de craft, deux items qui partagent une ressource sont chiffrés comme s'ils l'achetaient séparément ; la liste d'achat, elle, additionne les quantités avant de calculer les trois coûts.
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
src/souscraft.js   sous-crafts : acheter ou crafter une ressource craftable
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
