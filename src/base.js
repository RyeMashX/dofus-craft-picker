// Base de prix horodatée. Objet JSON simple : stocké dans le navigateur à l'étape 5,
// exportable / importable pour sauvegarde.
//
// base = {
//   items:      { [itemId]: { volume: { valeur, date }, prix: { valeurs: [..], date } } },
//   ressources: { [resId]:  { offre: { 1, 10, 100 }, date } },
// }
// Les dates sont des timestamps en millisecondes.

const JOUR = 24 * 3600 * 1000;

export function creerBase() {
  return { version: 1, items: {}, ressources: {} };
}

export function majVolume(base, itemId, volumeMois, date = Date.now()) {
  const it = (base.items[itemId] ??= {});
  it.volume = { valeur: volumeMois, date };
  return base;
}

// prix = liste des prix lus dans les annonces (on garde les 5 plus bas)
export function majPrixItem(base, itemId, prix, date = Date.now()) {
  const it = (base.items[itemId] ??= {});
  it.prix = { valeurs: [...prix].sort((a, b) => a - b).slice(0, 5), date };
  return base;
}

// offre = { 1: prix x1, 10: prix x10, 100: prix x100 } (tailles absentes = pas de lot)
export function majRessource(base, resId, offre, date = Date.now()) {
  base.ressources[resId] = { offre: { ...offre }, date };
  return base;
}

// 'absent' | 'perime' | 'frais'
export function fraicheur(entree, validiteJours, maintenant = Date.now()) {
  if (!entree) return 'absent';
  return maintenant - entree.date > validiteJours * JOUR ? 'perime' : 'frais';
}

// Offres de ressources fraîches, au format attendu par le moteur ({ [resId]: offre })
export function offresFraiches(base, validiteJours, maintenant = Date.now()) {
  const offres = {};
  for (const [id, r] of Object.entries(base.ressources)) {
    if (fraicheur(r, validiteJours, maintenant) === 'frais') offres[id] = r.offre;
  }
  return offres;
}

export function exporter(base) {
  return JSON.stringify(base);
}

export function importer(texte) {
  const b = JSON.parse(texte);
  if (b.version !== 1 || !b.items || !b.ressources) throw new Error('Fichier de base invalide');
  return b;
}
