import { coutCraft } from './craft.js';

// Prix de vente visé à partir des prix des annonces en vente (liste "Lot / Prix" de l'HDV).
// On ne se fie pas au prix moyen : un item peut valoir 5 fois plus avec un exo.
// mode 'min'  : annonce la moins chère − decote
// mode 'moy3' : moyenne des 3 moins chères − decote
// (V2 : ne garder que les annonces avec jet correct)
export function prixVenteEstime(prix, p) {
  if (!prix.length) return { min: null, moy3: null, estime: null };
  const tries = [...prix].sort((a, b) => a - b);
  const min = tries[0];
  const trois = tries.slice(0, 3);
  const moy3 = trois.reduce((s, x) => s + x, 0) / trois.length;
  const ref = p.modePrixVente === 'moy3' ? moy3 : min;
  return { min, moy3, estime: Math.round(ref) - p.decoteVente };
}

// Nombre max de crafts d'un même item : 1 jour de vente.
export function maxCrafts(volumeMois, p) {
  return Math.max(0, Math.floor(volumeMois / p.joursParMois));
}

// Évalue n crafts d'un item.
// item = { id, nom, niveau, volumeMois, prixVente, coutFm, recette }
export function evaluerItem(item, offres, p, n = 1) {
  const craft = coutCraft(item.recette, offres, n, p);
  const coutFm = p.inclureFm ? (item.coutFm ?? p.coutFmDefaut) * n : 0;
  const capital = craft.total + coutFm;
  const revenu = item.prixVente != null ? item.prixVente * (1 - p.taxeVente) * n : null;
  const marge = revenu != null ? revenu - capital : null;
  const rendement = marge != null && capital > 0 ? marge / capital : null;
  // si les lignes se vident : coût pessimiste des ressources
  const margePessimiste = revenu != null ? revenu - (craft.couts.coutPessimiste + coutFm) : null;

  const raisons = [];
  if (item.volumeMois < p.volumeMin) raisons.push(`volume ${item.volumeMois}/mois < ${p.volumeMin}`);
  if (craft.manquantes.length) raisons.push(`prix manquant : ${craft.manquantes.join(', ')}`);
  if (item.prixVente == null) raisons.push('prix de vente inconnu');
  if (rendement != null && rendement < p.margeMin) raisons.push(`rendement ${(rendement * 100).toFixed(1)} % < ${p.margeMin * 100} %`);
  if (n > maxCrafts(item.volumeMois, p)) raisons.push(`${n} crafts > 1 jour de vente`);

  return {
    id: item.id, nom: item.nom, n,
    coutCraft: craft.total, coutFm, capital, revenu, marge, rendement,
    alertes: craft.alertes, craft, risque: craft.couts.risque, margePessimiste,
    eligible: raisons.length === 0, raisons,
  };
}
