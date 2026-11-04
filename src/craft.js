import { planAchat } from './lots.js';

// Coût de n crafts d'une recette.
// recette = [{ id, nom, qte }]   (qte pour 1 craft)
// offres  = { [idRessource]: { 1, 10, 100, 1000 } }
// Les quantités sont cumulées sur les n crafts avant d'appliquer la règle des lots :
// acheter pour 3 crafts n'est pas 3 fois le coût d'un craft.

export function coutCraft(recette, offres, n, p) {
  const lignes = recette.map(r => {
    const q = r.qte * n;
    const plan = planAchat(q, offres[r.id], p);
    return { id: r.id, nom: r.nom, qte: r.qte, q, plan };
  });

  const manquantes = lignes.filter(l => !l.plan).map(l => l.nom);
  const total = lignes.reduce((s, l) => s + (l.plan ? l.plan.cout : 0), 0);
  const alertes = lignes.filter(l => l.plan && l.plan.alerte).map(l => l.nom);

  return { n, total, parCraft: total / n, lignes, manquantes, alertes };
}
