import { coutCraft } from './craft.js';

// Prix de vente visé à partir des annonces en vente.
// annonces = [{ prix, correct }]  (correct = jet correct au sens de l'outil FM)
export function prixVenteEstime(annonces, p) {
  const prix = annonces.map(a => a.prix);
  const correctes = annonces.filter(a => a.correct).map(a => a.prix);
  const minTout = prix.length ? Math.min(...prix) : null;
  const minCorrect = correctes.length ? Math.min(...correctes) : null;
  return {
    minTout,
    minCorrect,
    estime: minCorrect != null ? minCorrect - p.decoteVente : null,
  };
}

// Nombre max de crafts d'un même item : 1 jour de vente.
export function maxCrafts(volumeMois, p) {
  return Math.max(0, Math.floor(volumeMois / p.joursParMois));
}

// Évalue n crafts d'un item.
// item = { id, nom, niveau, volumeMois, prixVente, coutFm, recette }
export function evaluerItem(item, offres, p, n = 1) {
  const craft = coutCraft(item.recette, offres, n, p);
  const coutFm = (item.coutFm ?? p.coutFmDefaut) * n;
  const capital = craft.total + coutFm;
  const revenu = item.prixVente != null ? item.prixVente * (1 - p.taxeVente) * n : null;
  const marge = revenu != null ? revenu - capital : null;
  const rendement = marge != null && capital > 0 ? marge / capital : null;

  const raisons = [];
  if (item.volumeMois < p.volumeMin) raisons.push(`volume ${item.volumeMois}/mois < ${p.volumeMin}`);
  if (craft.manquantes.length) raisons.push(`prix manquant : ${craft.manquantes.join(', ')}`);
  if (item.prixVente == null) raisons.push('prix de vente inconnu');
  if (rendement != null && rendement < p.margeMin) raisons.push(`rendement ${(rendement * 100).toFixed(1)} % < ${p.margeMin * 100} %`);
  if (n > maxCrafts(item.volumeMois, p)) raisons.push(`${n} crafts > 1 jour de vente`);

  return {
    id: item.id, nom: item.nom, n,
    coutCraft: craft.total, coutFm, capital, revenu, marge, rendement,
    alertes: craft.alertes, craft,
    eligible: raisons.length === 0, raisons,
  };
}
