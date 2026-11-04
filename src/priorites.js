// Listes de scan priorisées et plan de scan.
//
// Chaque tâche reçoit un score = facteur d'âge × poids.
//   facteur d'âge = âge du dernier relevé / durée de validité (1 = vient d'expirer) ; jamais relevé = 1,5
//   poids         = intérêt de rafraîchir cette donnée (entre ~0,4 et ~1,6, voir chaque liste)
// Tag : score ≥ 1,2 → "urgent", ≥ 0,8 → "à faire", sinon "plus tard".

import { ageRelatif, fraicheur } from './base.js';
import { itemsFocus, estimerItem, potentiel } from './entonnoir.js';

const JAMAIS = 1.5;

export function tag(score, p) {
  if (score >= p.seuilsPriorite.urgent) return 'urgent';
  if (score >= p.seuilsPriorite.aFaire) return 'à faire';
  return 'plus tard';
}

const facteurAge = (entree, validite, maintenant) => entree ? ageRelatif(entree, validite, maintenant) : JAMAIS;

// Proximité au seuil de volume : 1 pile au seuil, 0 à 0 vente ou au double du seuil. Inconnu → 0,5.
export function proximiteSeuil(volume, p) {
  if (volume == null) return 0.5;
  return Math.max(0, 1 - Math.abs(volume - p.volumeMin) / p.volumeMin);
}

// Items dont le dernier volume connu passe le seuil
function itemsActifs(focus, base, p) {
  return focus.filter(it => (base.items[it.id]?.volume?.valeur ?? -1) >= p.volumeMin);
}

// 1. Volumes : tous les items du focus. Poids 0,6 (loin du seuil) à 1,4 (pile au seuil).
export function listeVolumes(catalogue, base, p, maintenant = Date.now()) {
  return itemsFocus(catalogue, p).map(it => {
    const v = base.items[it.id]?.volume;
    const poids = 0.6 + 0.8 * proximiteSeuil(v?.valeur, p);
    const score = facteurAge(v, p.validite.volume, maintenant) * poids;
    return { type: 'volume', id: it.id, nom: it.nom, categorie: it.type, volume: v?.valeur ?? null, date: v?.date ?? null, score, tag: tag(score, p) };
  });
}

// 2. Prix des items : items au-dessus du seuil de volume.
// Poids 0,4 (rendement estimé ≤ 0) à 1,6 (rendement estimé ≥ 2 × seuil).
export function listePrixItems(catalogue, base, p, maintenant = Date.now()) {
  return itemsActifs(itemsFocus(catalogue, p), base, p).map(it => {
    const b = base.items[it.id];
    const est = estimerItem(it, base, p);
    const poids = 0.4 + 1.2 * potentiel(est.rendement, p);
    const score = facteurAge(b.prix, p.validite.prixItem, maintenant) * poids;
    return {
      type: 'prixItem', id: it.id, nom: it.nom, categorie: it.type, volume: b.volume.valeur,
      prixMin: b.prix?.valeurs[0] ?? null, date: b.prix?.date ?? null,
      rendementEstime: est.rendement, precision: est.precision,
      score, tag: tag(score, p),
    };
  });
}

// 3. Ressources : celles des items au-dessus du seuil de volume.
// Demande = somme des potentiels des items qui l'utilisent. Poids 0,4 à 1,6 (demande ≥ demandeRef).
export function listeRessources(catalogue, base, p, maintenant = Date.now()) {
  const demande = new Map();
  for (const it of itemsActifs(itemsFocus(catalogue, p), base, p)) {
    const pot = potentiel(estimerItem(it, base, p).rendement, p);
    for (const r of it.recette) {
      const d = demande.get(r.id) ?? { items: 0, demande: 0 };
      d.items += 1; d.demande += pot;
      demande.set(r.id, d);
    }
  }
  return [...demande.entries()].map(([id, d]) => {
    const res = base.ressources[id] ?? {};
    const poids = 0.4 + 1.2 * Math.min(1, d.demande / (p.demandeRef ?? 3));
    const score = facteurAge(res.lots, p.validite.ressources, maintenant) * poids;
    return {
      type: 'ressource', id: Number(id), nom: catalogue.ressources[id]?.nom ?? `#${id}`,
      items: d.items, demande: d.demande,
      lots: res.lots?.valeurs ?? null, date: res.lots?.date ?? null,
      score, tag: tag(score, p),
    };
  });
}

// Passe initiale au prix moyen : ce qui manque encore (liste HDV, plusieurs items par capture).
export function prixMoyensManquants(catalogue, base, p, maintenant = Date.now()) {
  const focus = itemsFocus(catalogue, p);
  const items = focus.filter(it => fraicheur(base.items[it.id]?.prixMoyen, p.validite.prixMoyen, maintenant) !== 'frais');
  const ids = new Set(focus.flatMap(it => it.recette.map(r => r.id)));
  const ressources = [...ids].filter(id => fraicheur(base.ressources[id]?.prixMoyen, p.validite.prixMoyen, maintenant) !== 'frais');
  return { items: items.length, ressources: ressources.length };
}

// Toutes les listes, triées par score décroissant
export function listesScan(catalogue, base, p, maintenant = Date.now()) {
  const tri = l => l.sort((a, b) => b.score - a.score);
  return {
    volumes: tri(listeVolumes(catalogue, base, p, maintenant)),
    prixItems: tri(listePrixItems(catalogue, base, p, maintenant)),
    ressources: tri(listeRessources(catalogue, base, p, maintenant)),
    prixMoyens: prixMoyensManquants(catalogue, base, p, maintenant),
  };
}

// Plan de scan pour un temps donné : tâches "urgent" puis "à faire" (jamais "plus tard"),
// par score décroissant, jusqu'à épuisement du temps.
export function planScan(listes, minutes, p) {
  const taches = [...listes.volumes, ...listes.prixItems, ...listes.ressources]
    .filter(t => t.tag !== 'plus tard')
    .sort((a, b) => b.score - a.score);
  let reste = minutes * 60;
  const plan = [];
  for (const t of taches) {
    const cout = p.tempsScan[t.type];
    if (cout > reste) continue;
    plan.push(t);
    reste -= cout;
  }
  const parType = { volume: 0, prixItem: 0, ressource: 0 };
  plan.forEach(t => parType[t.type]++);
  return { taches: plan, parType, secondes: minutes * 60 - reste, restantes: taches.length - plan.length };
}
