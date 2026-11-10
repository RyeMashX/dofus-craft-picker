// Exploitation du catalogue (data/catalogue.json, généré par scripts/catalogue.mjs).

import { PARAMS } from './params.js';

// Items craftables avec les métiers du joueur (niveau du métier ≥ niveau de l'item).
export function itemsCraftables(catalogue, metiers = PARAMS.metiers) {
  return catalogue.items.filter(i => (metiers[i.metier] ?? 0) >= i.niveau);
}

// Convertit un item du catalogue au format du moteur (recette avec noms).
export function versMoteur(item, catalogue, marche = {}) {
  return {
    id: item.id,
    nom: item.nom,
    niveau: item.niveau,
    type: item.type,
    volumeMois: marche.volumeMois ?? null,
    prixVente: marche.prixVente ?? null,
    recette: versMoteurRecette(item.recette, catalogue),
  };
}
const versMoteurRecette = (recette, catalogue, prof = 0) => recette.map(r => ({
  id: r.id, nom: catalogue.ressources[r.id]?.nom ?? `#${r.id}`, qte: r.qte,
  ...(r.recette && prof < 6 ? { recette: versMoteurRecette(r.recette, catalogue, prof + 1) } : {}),
}));

// Ressources à relever pour un ensemble d'items, triées par nombre d'items qui les utilisent :
// relever les premières débloque le plus d'items.
export function ressourcesARelever(items, catalogue) {
  const compte = new Map();
  for (const it of items) {
    for (const r of it.recette) {
      const c = compte.get(r.id) ?? { ...catalogue.ressources[r.id], items: 0 };
      c.items += 1;
      compte.set(r.id, c);
    }
  }
  return [...compte.values()].sort((a, b) => b.items - a.items || a.nom.localeCompare(b.nom, 'fr'));
}

// Sous-crafts : certaines ressources (alliages, substrats…) se craftent elles-mêmes. On rattache leur recette à
// chaque ligne de recette qui les utilise (r.recette), récursivement : le moteur voit l'arbre complet.
export function lierSousRecettes(catalogue) {
  const lier = recette => { for (const r of recette ?? []) { const s = catalogue.ressources[r.id]?.recette; if (s?.length) r.recette = s; } };
  for (const res of Object.values(catalogue.ressources)) lier(res.recette);
  for (const it of catalogue.items) lier(it.recette);
  return catalogue;
}

// Toutes les lignes d'une recette, sous-recettes comprises (chaque ressource une fois)
export function ingredients(recette, vus = new Set(), prof = 0) {
  const out = [];
  for (const r of recette ?? []) {
    if (!vus.has(r.id)) { vus.add(r.id); out.push(r); }
    if (r.recette && prof < 6) out.push(...ingredients(r.recette, vus, prof + 1));
  }
  return out;
}
