// Paramètres par défaut du moteur. Tout est réglable depuis l'interface (étape 5)
// et sera calibré grâce au journal (étape 6).

export const PARAMS = {
  // Vente
  taxeVente: 0.02,          // taxe HDV sur le prix de vente
  decoteVente: 1,           // on se place à (moins chère avec jet correct) − 1 kama

  // Filtres
  volumeMin: 60,            // ventes / mois minimum
  margeMin: 0.25,           // rendement minimum = marge / capital engagé
  joursParMois: 30,         // max de crafts d'un même item = volume / 30 (1 jour de vente)

  // Achat des ressources par lots (voir README, "Règle des lots")
  profondeur: { 1: 3, 10: 3, 100: 2 }, // nb de lots supposés dispo au prix affiché
  surcout: 0.25,            // au-delà, chaque lot est compté +25 %
  revalorisationSurplus: 0.5, // part récupérée sur les unités en trop revendues
  ecartAlerte: 0.15,        // alerte "à revérifier" si plan prudent > optimiste de +15 %

  // FM et effort
  coutFmDefaut: 0,          // coût de FM forfaitaire par item si non renseigné
  coutEffortParCraft: 300000, // "prix" d'un craft+FM en plus, en kamas (arbitrage effort)
  pasBudget: 100000,        // granularité du calcul d'allocation
};
