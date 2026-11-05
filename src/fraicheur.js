// Niveaux de fraîcheur des données et état des items.
//
//   noir   : aucune info
//   rouge  : ressource introuvable à l'HDV (aucun lot en vente au dernier passage)
//   orange : périmé (ou prix moyen seul pour un prix)
//   jaune  : risque d'évolution
//   vert   : à jour
//
// Seuils (en jours) : voir FRAICHEUR ci-dessous.

import { JOUR } from './base.js';

export const FRAICHEUR = {
  volume: { jaune: 30, orange: 60 },     // volume sur 30 jours
  prixItem: { jaune: 7, orange: 14 },    // annonces d'un équipement
  ressource: { jaune: 3, orange: 7 },    // lots d'une ressource
};

export const NIVEAUX = ['noir', 'rouge', 'orange', 'jaune', 'vert']; // rouge : ressource introuvable à l'HDV
const rang = n => NIVEAUX.indexOf(n);

function parAge(date, seuils, maintenant) {
  const j = (maintenant - date) / JOUR;
  return j > seuils.orange ? 'orange' : j > seuils.jaune ? 'jaune' : 'vert';
}

export function niveauVolume(b, maintenant = Date.now()) {
  return b?.volume ? parAge(b.volume.date, FRAICHEUR.volume, maintenant) : 'noir';
}

// Prix d'un équipement : annonces relevées, sinon prix moyen seul (orange), sinon rien (noir)
export function niveauPrixItem(b, maintenant = Date.now()) {
  if (b?.prix) return parAge(b.prix.date, FRAICHEUR.prixItem, maintenant);
  return b?.prixMoyen ? 'orange' : 'noir';
}

export function niveauRessource(r, maintenant = Date.now()) {
  if (r?.indispo && (!r.lots || r.indispo.date >= r.lots.date)) return 'rouge'; // aucun lot en vente
  if (r?.lots) return parAge(r.lots.date, FRAICHEUR.ressource, maintenant);
  return r?.prixMoyen ? 'orange' : 'noir';
}

// État complet d'un item du catalogue
//   pret       : volume vert ou jaune, prix vert, ressources sans orange ni noir et au plus 2 jaunes
//   utilisable : aucune donnée orange ou noire (jaune toléré partout) → plan de craft avec avertissement
export function etatItem(it, base, maintenant = Date.now(), maxJaunes = 2) {
  const b = base.items[it.id];
  const volume = niveauVolume(b, maintenant);
  const prix = niveauPrixItem(b, maintenant);
  const ressources = it.recette.map(r => ({ id: r.id, niveau: niveauRessource(base.ressources[r.id], maintenant) }));
  const compte = { noir: 0, rouge: 0, orange: 0, jaune: 0, vert: 0 };
  ressources.forEach(r => compte[r.niveau]++);
  const resOk = compte.noir === 0 && compte.rouge === 0 && compte.orange === 0;
  const pret = rang(volume) >= rang('jaune') && prix === 'vert' && resOk && compte.jaune <= maxJaunes;
  const utilisable = rang(volume) >= rang('jaune') && rang(prix) >= rang('jaune') && resOk;
  return { volume, prix, ressources, compte, pret, utilisable };
}

// ---------- ordre alphabétique de Dofus ----------
// L'HDV trié par nom range les caractères spéciaux (â, é, è, œ…) après le z.
// Clé : lettres et chiffres ASCII dans l'ordre usuel (sans casse), le reste après.
function cle(ch) {
  const c = ch.toLowerCase();
  if (/[a-z0-9]/.test(c)) return c.charCodeAt(0);
  if (c === ' ') return 1;
  if (/['’\-.,]/.test(c)) return 2 + c.charCodeAt(0) / 1000;
  return 1000 + c.codePointAt(0);
}
export function compareDofus(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = cle(a[i]) - cle(b[i]);
    if (d) return d;
  }
  return a.length - b.length;
}
