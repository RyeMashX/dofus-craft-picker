// Sous-crafts : une ressource craftable (alliage, substrat…) s'achète à l'HDV ou se crafte à partir de ses composants.
// On crafte seulement si c'est moins cher d'au moins `gainMinSousCraft` (5 %) de son prix d'achat, ou si elle n'est
// pas achetable. L'effort du craft ne compte pas dans la marge (il ne sert qu'à prioriser, via ce seuil).

import { planAchat } from './lots.js';
import { estIndispo } from './base.js';
export const seuilSousCraft = p => p.gainMinSousCraft ?? 0.05;

// Achat à partir des lots utilisables du moteur : (id, q) → { cout, … plan de lots } ou null
export const achatOffres = (offres, p) => (id, q) => offres[id] ? planAchat(q, offres[id], p) : null;

// Achat à partir de la base, quelle que soit la fraîcheur : lots relevés, sinon prix moyen (estimations)
export const achatBase = (base, p) => (id, q) => {
  const r = base.ressources[id];
  if (!r || estIndispo(r)) return null;
  if (r.lots) return { ...planAchat(q, r.lots.valeurs, p), source: 'lots' };
  if (r.prixMoyen) return { cout: q * r.prixMoyen.valeur, source: 'moyen' };
  return null;
};

// Option la moins chère pour q unités d'une ligne de recette r = { id, nom, qte, recette? }.
// → { mode: 'achat', cout, plan } | { mode: 'craft', cout, composants: [{ id, nom, qte, q, res }], achat } | null
export function resoudre(r, q, acheter, p, prof = 0) {
  const achat = acheter(r.id, q);
  let craft = null;
  if (r.recette?.length && prof < 6) {
    const composants = r.recette.map(c => ({ id: c.id, nom: c.nom, qte: c.qte, q: c.qte * q, res: resoudre(c, c.qte * q, acheter, p, prof + 1) }));
    if (composants.every(c => c.res)) craft = { cout: composants.reduce((s, c) => s + c.res.cout, 0), composants };
  }
  if (craft && (!achat || craft.cout <= achat.cout * (1 - seuilSousCraft(p)))) {
    return { mode: 'craft', cout: craft.cout, composants: craft.composants, achat, alerte: craft.composants.some(c => c.res.alerte) };
  }
  return achat ? { ...achat, mode: 'achat', plan: achat } : null;
}
