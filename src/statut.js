// Statut des équipements : liste noire et ventes en cours. Stockés dans la base (exportés avec elle).
//
// base.exclus  = { [itemId]: { jusquau: timestamp | null, date } }   null = exclusion permanente
//
// Règles :
// - un item exclu disparaît du plan de scan, des recommandations et de la liste des crafts viables ;
// - un item avec au moins 1 lot en vente n'est pas proposé dans le plan de craft
//   (ni dans la préparation craft du plan de scan), mais reste visible.

import { JOUR } from './base.js';

// ---------- liste noire ----------
export function exclure(base, id, jusquau = null, maintenant = Date.now()) {
  (base.exclus ??= {})[id] = { jusquau, date: maintenant };
  return base;
}
export function reintegrer(base, id) {
  if (base.exclus) delete base.exclus[id];
  return base;
}
export function exclusion(base, id, maintenant = Date.now()) {
  const e = base.exclus?.[id];
  if (!e) return null;
  if (e.jusquau != null && e.jusquau < maintenant) return null; // expirée
  return e;
}
export const estExclu = (base, id, maintenant = Date.now()) => !!exclusion(base, id, maintenant);

// « jusqu'au 12/11 » inclus : on garde l'exclusion jusqu'à la fin de la journée choisie
export const finDeJournee = dateIso => new Date(`${dateIso}T23:59:59`).getTime();

// ---------- ventes en cours : voir ventes.js (une ligne par exemplaire) ----------
export { lotsEnVente, estEnVente } from './ventes.js';

export const ageJours = (date, maintenant = Date.now()) => date ? (maintenant - date) / JOUR : null;
