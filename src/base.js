// Base de prix horodatée. Objet JSON simple : stocké dans le navigateur à l'étape 5,
// exportable / importable pour sauvegarde.
//
// base = {
//   items:      { [itemId]: { volume:    { valeur, date },        // nb vendus sur 30 jours
//                             prix:      { valeurs: [..], date },  // annonces les moins chères
//                             prixMoyen: { valeur, date } } },     // liste HDV, pour prioriser
//   ressources: { [resId]:  { lots:      { valeurs: {1,10,100}, date },
//                             prixMoyen: { valeur, date } } },     // prix unitaire moyen
// }
// Les dates sont des timestamps en millisecondes.

export const JOUR = 24 * 3600 * 1000;

export function creerBase() {
  return { version: 2, items: {}, ressources: {} };
}

const item = (base, id) => (base.items[id] ??= {});
const ressource = (base, id) => (base.ressources[id] ??= {});

export function majVolume(base, itemId, volumeMois, date = Date.now()) {
  item(base, itemId).volume = { valeur: volumeMois, date };
  return base;
}

// prix = liste des prix lus dans les annonces. On garde les 3 plus bas : le prix visé est le plus bas
// (ou la moyenne des 3 plus bas, au choix dans les réglages) ; les suivants ne servent à rien.
export const NB_PRIX = 3;
export function majPrixItem(base, itemId, prix, date = Date.now()) {
  item(base, itemId).prix = { valeurs: [...prix].sort((a, b) => a - b).slice(0, NB_PRIX), date };
  return base;
}

export function majPrixMoyenItem(base, itemId, prixMoyen, date = Date.now()) {
  item(base, itemId).prixMoyen = { valeur: prixMoyen, date };
  return base;
}

// offre = { 1: prix x1, 10: prix x10, 100: prix x100, 1000: prix x1000 } (tailles absentes = pas de lot)
export function majRessource(base, resId, offre, date = Date.now()) {
  ressource(base, resId).lots = { valeurs: { ...offre }, date };
  return base;
}

export function majPrixMoyenRessource(base, resId, prixMoyen, date = Date.now()) {
  ressource(base, resId).prixMoyen = { valeur: prixMoyen, date };
  return base;
}

// 'absent' | 'perime' | 'frais'
export function fraicheur(entree, validiteJours, maintenant = Date.now()) {
  if (!entree) return 'absent';
  return maintenant - entree.date > validiteJours * JOUR ? 'perime' : 'frais';
}

// Âge rapporté à la durée de validité (0 = tout juste relevé, 1 = vient d'expirer)
export function ageRelatif(entree, validiteJours, maintenant = Date.now()) {
  return entree ? (maintenant - entree.date) / (validiteJours * JOUR) : null;
}

// Lots de ressources frais, au format attendu par le moteur ({ [resId]: offre })
export function offresFraiches(base, validiteJours, maintenant = Date.now()) {
  const offres = {};
  for (const [id, r] of Object.entries(base.ressources)) {
    if (fraicheur(r.lots, validiteJours, maintenant) === 'frais') offres[id] = r.lots.valeurs;
  }
  return offres;
}

export function exporter(base) {
  return JSON.stringify(base);
}

export function importer(texte) {
  const b = JSON.parse(texte);
  if (b.version !== 2 || !b.items || !b.ressources) throw new Error('Fichier de base invalide');
  return b;
}
