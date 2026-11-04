// Paramètres par défaut du moteur. Tout est réglable depuis l'interface (étape 5)
// et sera calibré grâce au journal (étape 6).

export const PARAMS = {
  // Vente
  taxeVente: 0.02,          // taxe HDV sur le prix de vente
  modePrixVente: 'min',     // 'min' = annonce la moins chère, 'moy3' = moyenne des 3 moins chères
  decoteVente: 1,           // on se place 1 kama sous la référence

  // Filtres
  volumeMin: 60,            // ventes / mois minimum
  margeMin: 0.25,           // rendement minimum = marge / coût du craft
  joursParMois: 30,         // max de crafts d'un même item = volume / 30 (1 jour de vente)

  // Achat des ressources par lots (voir README, "Règle des lots")
  profondeur: { 1: 3, 10: 2, 100: 1 }, // nb de lots supposés dispo au prix affiché
  surcout: 0.10,            // au-delà, chaque lot est compté +10 %
  revalorisationSurplus: 0.8, // surplus revendu à 80 % du prix x1 (ou du prix x10 par paquets de 10)
  gainMinSurplus: 0.20,     // on n'achète "trop" que si ça fait gagner au moins 20 %
  ecartAlerte: 0.20,        // alerte "à revérifier" si plan prudent > optimiste de +20 %

  // FM et effort
  inclureFm: false,         // phase initiale : marge / coût du craft, sans la FM
  coutFmDefaut: 0,          // coût de FM forfaitaire par item si inclureFm
  coutEffortParCraft: 300000, // "prix" d'un craft+FM en plus, en kamas (arbitrage effort)
  pasBudget: 100000,        // granularité du calcul d'allocation
};
