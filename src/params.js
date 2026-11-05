// Paramètres par défaut du moteur. Tout est réglable depuis l'interface (étape 5)
// et sera calibré grâce au journal (étape 6).

export const PARAMS = {
  // Vente
  taxeVente: 0.02,          // taxe HDV sur le prix de vente
  modePrixVente: 'min',     // 'min' = annonce la moins chère, 'moy3' = moyenne des 3 moins chères
  decoteVente: 1,           // on se place 1 kama sous la référence

  // Filtres
  volumeMin: 60,            // ventes / mois minimum
  margeMin: 0.25,           // rendement « cible » = marge / coût du craft
  margeAcceptable: 0.15,    // rendement « acceptable » : listé dans les crafts viables, ajout manuel possible
  joursParMois: 30,         // max de crafts d'un même item = volume / 30 (1 jour de vente)

  // Achat des ressources par lots (voir README, "Règle des lots")
  profondeur: { 1: 3, 10: 2, 100: 1, 1000: 1 }, // nb de lots supposés dispo au prix affiché
  surcout: 0.10,            // au-delà, chaque lot est compté +10 %
  revalorisationSurplus: 0.8, // surplus revendu à 80 % du prix x1 (ou du prix x10 par paquets de 10)
  gainMinSurplus: 0.20,     // on n'achète "trop" que si ça fait gagner au moins 20 %
  ecartAlerte: 0.20,        // alerte "à revérifier" si plan prudent > optimiste de +20 %

  // Périmètre et fraîcheur des relevés
  focusNiveaux: [200, 200], // on commence par les items niveau 200
  metiers: {                // niveaux de métier du joueur
    Bijoutier: 200, Cordonnier: 200, Tailleur: 200, Sculpteur: 200, 'Façonneur': 200, Forgeron: 190,
  },
  validite: {               // durée de validité d'un relevé, en jours
    volume: 14,             // volume de ventes : rafraîchi toutes les 2 semaines
    prixItem: 2,            // annonces en vente d'un équipement
    ressources: 3,          // lots x1/x10/x100/x1000 d'une ressource
    prixMoyen: 14,          // prix moyen lu dans la liste HDV (sert seulement à prioriser)
  },

  // Plan de scan
  tempsScan: { volume: 15, prixItem: 15, ressource: 10 }, // secondes par capture (à calibrer)
  seuilsPriorite: { urgent: 1.2, aFaire: 0.8 },           // score ≥ urgent → "urgent", ≥ aFaire → "à faire", sinon "plus tard"
  demandeRef: 3,            // une ressource utile à ~3 items prometteurs a le poids maximal

  // FM et effort
  inclureFm: true,          // la marge déduit la FM estimée (moyenne des ventes : voir coutFmEstime dans ventes.js)
  coutFmDefaut: 0,          // sans vente renseignée, pas de coût de FM
  coutEffortParCraft: 300000, // "prix" d'un craft+FM en plus, en kamas (arbitrage effort)
  pasBudget: 100000,        // granularité du calcul d'allocation
};
