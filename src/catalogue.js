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
    recette: item.recette.map(r => ({ id: r.id, nom: catalogue.ressources[r.id]?.nom ?? `#${r.id}`, qte: r.qte })),
  };
}

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
