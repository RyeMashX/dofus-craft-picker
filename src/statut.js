// Statut des équipements : liste noire et ventes en cours. Stockés dans la base (exportés avec elle).
//
// base.exclus  = { [itemId]: { jusquau: timestamp | null, date } }   null = exclusion permanente
// base.enVente = { date, total, items: { [itemId]: nombre de lots en vente } }
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

// ---------- ventes en cours ----------
export const lotsEnVente = (base, id) => base.enVente?.items?.[id] ?? 0;
export const estEnVente = (base, id) => lotsEnVente(base, id) > 0;

export function majVente(base, id, nombre, maintenant = Date.now()) {
  const v = (base.enVente ??= { date: maintenant, total: null, items: {} });
  if (nombre > 0) v.items[id] = nombre; else delete v.items[id];
  v.date = maintenant;
  return base;
}

// Remplace la liste par un relevé complet ({ [id]: nombre })
export function remplacerVentes(base, items, total = null, maintenant = Date.now()) {
  base.enVente = { date: maintenant, total, items: { ...items } };
  return base;
}

// ---------- relevé OCR sur plusieurs captures ----------
// La liste « Mes ventes » défile : on additionne les captures successives d'un même relevé.
// Une même annonce (nom, prix, durée restante) vue sur deux captures qui se chevauchent n'est comptée qu'une fois.
export function nouveauReleve() {
  return { lignes: {}, total: null, inconnus: 0 };
}
export function ajouterAuReleve(releve, lecture) {
  for (const l of lecture.lignes) {
    const cle = `${l.id ?? l.nom}|${l.prix}|${l.jours ?? ''}`;
    releve.lignes[cle] ??= l;
  }
  if (lecture.total != null) releve.total = lecture.total;
  releve.inconnus = Object.values(releve.lignes).filter(l => l.id == null).length;
  return releve;
}
export function comptesReleve(releve) {
  const items = {};
  // une ligne de la liste = un lot en vente
  for (const l of Object.values(releve.lignes)) if (l.id != null) items[l.id] = (items[l.id] ?? 0) + 1;
  return items;
}
export const lotsLus = releve => Object.keys(releve.lignes).length;

export const ageJours = (date, maintenant = Date.now()) => date ? (maintenant - date) / JOUR : null;
