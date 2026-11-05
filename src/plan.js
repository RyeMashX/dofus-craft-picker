// Plan de scan : quoi rafraîchir dans le temps disponible.
//
// Budget = minutes × 60 s, chaque scan a une durée (tempsScan, mesurée à l'usage).
//   1. Préparer le craft (70 % par défaut) : on complète des dossiers d'items pour qu'ils soient « prêts »,
//      en prenant à chaque fois l'item qui rapporte le plus par seconde de scan restante
//      (valeur = marge estimée × ventes par jour ; les ressources partagées ne comptent qu'une fois).
//   2. Entretien (le reste) : les données les plus anciennes du reste de la base, pondérées par leur importance.
// Puis présentation : HDV Équipements, puis HDV Ressources ; groupes de catégories (filtres HDV) ; tri Dofus.

import { itemsFocus, estimerItem } from './entonnoir.js';
import { etatItem, niveauVolume, niveauPrixItem, niveauRessource, compareDofus, FRAICHEUR } from './fraicheur.js';
import { estIndispo, JOUR } from './base.js';
import { estExclu, estEnVente } from './statut.js';

const POIDS_NIVEAU = { noir: 3, orange: 2, jaune: 1, vert: 0 };
export const cleTache = t => `${t.kind}:${t.id}`;

// Ressource constatée introuvable à l'HDV il y a moins de 3 jours : inutile de la rescanner tout de suite,
// et les items qui en ont besoin ne peuvent pas devenir prêts
const indispoRecente = (r, maintenant) => estIndispo(r) && maintenant - r.indispo.date < FRAICHEUR.ressource.jaune * JOUR;

// Tâches nécessaires pour qu'un item devienne prêt (sans celles déjà prévues)
function tachesPourPret(it, etat, base) {
  const t = [];
  if (etat.volume === 'noir' || etat.volume === 'orange') t.push({ kind: 'volume', id: it.id });
  if (etat.prix !== 'vert') t.push({ kind: 'prixItem', id: it.id });
  const res = etat.ressources;
  for (const r of res) if (r.niveau === 'noir' || r.niveau === 'orange') t.push({ kind: 'ressource', id: r.id });
  // au plus 2 jaunes : on rafraîchit les plus anciennes au-delà
  const jaunes = res.filter(r => r.niveau === 'jaune')
    .sort((a, b) => (base.ressources[a.id]?.lots?.date ?? 0) - (base.ressources[b.id]?.lots?.date ?? 0));
  for (const r of jaunes.slice(0, Math.max(0, jaunes.length - 2))) t.push({ kind: 'ressource', id: r.id });
  return t;
}

// Valeur d'un item pour le craft : marge estimée × ventes par jour (kamas / jour)
function valeurItem(it, base, p) {
  const vol = base.items[it.id]?.volume?.valeur;
  if (vol == null || vol < p.volumeMin) return 0;
  const est = estimerItem(it, base, p);
  if (est.rendement == null || est.rendement < 0) return 0;
  return est.prixVente * (1 - p.taxeVente) - est.cout > 0 ? (est.prixVente * (1 - p.taxeVente) - est.cout) * vol / p.joursParMois : 0;
}

// Importance d'une donnée pour l'entretien (≈ 0,3 à 1,3)
function importances(focus, base, p) {
  const volJour = id => (base.items[id]?.volume?.valeur ?? 0) / p.joursParMois;
  const demande = new Map(); // ressource → ventes/jour cumulées des items ≥ seuil qui l'utilisent
  for (const it of focus) {
    if ((base.items[it.id]?.volume?.valeur ?? 0) < p.volumeMin) continue;
    for (const r of it.recette) demande.set(r.id, (demande.get(r.id) ?? 0) + volJour(it.id));
  }
  return {
    volume: it => {
      const v = base.items[it.id]?.volume?.valeur;
      if (v == null) return 1.3;
      const proche = Math.max(0, 1 - Math.abs(v - p.volumeMin) / p.volumeMin);
      return 0.3 + Math.max(proche, Math.min(1, v / (4 * p.volumeMin)));
    },
    prixItem: it => 0.3 + Math.min(1, volJour(it.id) / 6),
    ressource: id => 0.3 + Math.min(1, (demande.get(id) ?? 0) / 5),
    demande,
  };
}

export function calculerPlan(catalogue, base, p, minutes, maintenant = Date.now(), partCraft = p.partCraft ?? 0.7) {
  // un item exclu (liste noire) sort complètement du plan de scan
  const focus = itemsFocus(catalogue, p).filter(it => !estExclu(base, it.id, maintenant));
  const temps = t => p.tempsScan[t.kind === 'ressource' ? 'ressource' : t.kind];
  const budget = minutes * 60;
  const choisies = new Map(); // clé → tâche
  let utilise = 0;
  const ajouter = (t, raison) => { const k = cleTache(t); if (!choisies.has(k)) { choisies.set(k, { ...t, raison }); utilise += temps(t); } };

  // ---- 1. préparer le craft ----
  const etats = new Map(focus.map(it => [it.id, etatItem(it, base, maintenant)]));
  const candidats = focus
    .map(it => ({ it, valeur: valeurItem(it, base, p), taches: tachesPourPret(it, etats.get(it.id), base) }))
    // un item déjà en vente ne sera pas recrafté : inutile de préparer son dossier
    .filter(c => c.valeur > 0 && c.taches.length && !etats.get(c.it.id).pret && !estEnVente(base, c.it.id))
    .filter(c => !c.it.recette.some(r => indispoRecente(base.ressources[r.id], maintenant)));
  const budgetCraft = budget * partCraft;
  const vises = [];
  for (;;) {
    let best = null;
    for (const c of candidats) {
      if (c.fait) continue;
      const reste = c.taches.filter(t => !choisies.has(cleTache(t)));
      const cout = reste.reduce((s, t) => s + temps(t), 0);
      if (utilise + cout > budgetCraft) continue;
      const ratio = cout ? c.valeur / cout : Infinity;
      if (!best || ratio > best.ratio) best = { c, reste, ratio };
    }
    if (!best) break;
    best.reste.forEach(t => ajouter(t, 'craft'));
    best.c.fait = true;
    vises.push(best.c.it.id);
  }

  // ---- 2. entretien ----
  const imp = importances(focus, base, p);
  const ent = [];
  const idsRes = new Set();
  for (const it of focus) {
    const b = base.items[it.id];
    const nv = niveauVolume(b, maintenant);
    if (nv !== 'vert') ent.push({ kind: 'volume', id: it.id, score: POIDS_NIVEAU[nv] * imp.volume(it) });
    if ((b?.volume?.valeur ?? -1) >= p.volumeMin) {
      const np = niveauPrixItem(b, maintenant);
      if (np !== 'vert') ent.push({ kind: 'prixItem', id: it.id, score: POIDS_NIVEAU[np] * imp.prixItem(it) });
    }
    it.recette.forEach(r => idsRes.add(r.id));
  }
  for (const id of idsRes) {
    if (!imp.demande.has(id)) continue; // ressource d'aucun item vendable
    const nr = niveauRessource(base.ressources[id], maintenant);
    if (indispoRecente(base.ressources[id], maintenant)) continue;
    if (nr !== 'vert') ent.push({ kind: 'ressource', id, score: POIDS_NIVEAU[nr] * imp.ressource(id) });
  }
  ent.sort((a, b) => b.score - a.score);
  for (const t of ent) {
    if (choisies.has(cleTache(t))) continue;
    if (utilise + temps(t) > budget) continue;
    ajouter(t, 'entretien');
  }

  // ---- prêts avant / après ----
  const pretsAvant = focus.filter(it => etats.get(it.id).pret).length;
  const pretsApres = focus.filter(it => {
    const e = etats.get(it.id);
    if (e.pret) return true;
    const manque = tachesPourPret(it, e, base);
    return manque.length && manque.every(t => choisies.has(cleTache(t)));
  }).length;

  return {
    cree: maintenant, minutes,
    taches: [...choisies.values()],
    secondes: utilise, pretsAvant, pretsApres, vises: vises.length,
  };
}

// ---------- présentation ----------
// Une ligne par objet (un équipement peut demander courbe + annonces), groupée par HDV puis par catégorie.
// Les petites catégories (< 3 lignes) sont fusionnées avec la suivante, jusqu'à ~12 lignes par groupe.
export function organiser(plan, catalogue, { minGroupe = 3, maxGroupe = 12 } = {}) {
  const items = new Map(catalogue.items.map(i => [i.id, i]));
  // quelques ingrédients sont eux-mêmes des équipements (catégorie Épée, Anneau…) : ils se trouvent à l'HDV Équipements
  const typesEquipement = new Set(catalogue.items.map(i => i.type));
  const lignes = new Map();
  for (const t of plan.taches) {
    const res = t.kind === 'ressource' ? catalogue.ressources[t.id] : null;
    const hdv = res && !typesEquipement.has(res.type) ? 'ressources' : 'equipements';
    const k = `${t.kind === 'ressource' ? 'r' : 'i'}:${t.id}`;
    if (!lignes.has(k)) {
      const o = res ?? items.get(t.id);
      lignes.set(k, { hdv, id: t.id, nom: o?.nom ?? `#${t.id}`, categorie: o?.type ?? '?', niveau: o?.niveau ?? 0, iconId: o?.iconId, kinds: [], raison: t.raison });
    }
    lignes.get(k).kinds.push(t.kind);
  }
  const ordreKinds = { volume: 0, prixItem: 1, ressource: 2 };
  lignes.forEach(l => l.kinds.sort((a, b) => ordreKinds[a] - ordreKinds[b]));

  const hdvs = [];
  for (const hdv of ['equipements', 'ressources']) {
    const parCat = new Map();
    for (const l of lignes.values()) if (l.hdv === hdv) (parCat.get(l.categorie) ?? parCat.set(l.categorie, []).get(l.categorie)).push(l);
    const cats = [...parCat.keys()].sort(compareDofus);
    // fusion : une petite catégorie (ou un petit groupe) rejoint son voisin tant que le total reste raisonnable
    const groupes = [];
    for (const c of cats) {
      const ls = parCat.get(c), g = groupes.at(-1);
      if (g && (g.lignes.length < minGroupe || ls.length < minGroupe) && g.lignes.length + ls.length <= maxGroupe) { g.categories.push(c); g.lignes.push(...ls); }
      else groupes.push({ categories: [c], lignes: [...ls] });
    }
    // un groupe encore trop petit rejoint le suivant (ou le précédent), même au-delà de la taille cible
    for (let i = 0; i < groupes.length; i++) {
      if (groupes[i].lignes.length >= minGroupe || groupes.length === 1) continue;
      const j = i + 1 < groupes.length ? i + 1 : i - 1;
      const [a, b] = j > i ? [groupes[i], groupes[j]] : [groupes[j], groupes[i]];
      a.categories.push(...b.categories); a.lignes.push(...b.lignes);
      groupes.splice(j > i ? j : i, 1);
      i = -1;
    }
    // un gros groupe d'une seule catégorie est découpé par tranches de niveau (filtre niveau de l'HDV)
    const final = [];
    for (const g of groupes) {
      if (g.lignes.length <= maxGroupe * 1.5) { final.push(g); continue; }
      // paquets par niveau (indivisibles : le filtre ne sépare pas deux objets de même niveau), empilés en tranches
      const paquets = new Map();
      for (const l of g.lignes) (paquets.get(l.niveau) ?? paquets.set(l.niveau, []).get(l.niveau)).push(l);
      const niveaux = [...paquets.keys()].sort((x, y) => x - y);
      let cour = [];
      for (const n of niveaux) {
        const pq = paquets.get(n);
        if (cour.length && cour.length + pq.length > maxGroupe) { final.push({ categories: g.categories, lignes: cour, tranche: true }); cour = []; }
        cour.push(...pq);
      }
      if (cour.length) final.push({ categories: g.categories, lignes: cour, tranche: true });
      // une tranche trop petite ne vaut pas un changement de filtre : elle rejoint sa voisine
      const debut = final.findIndex(x => x.categories === g.categories);
      for (let i = final.length - 1; i > debut; i--) {
        if (final[i].lignes.length < minGroupe || final[i - 1].lignes.length < minGroupe) { final[i - 1].lignes.push(...final[i].lignes); final.splice(i, 1); }
      }
      if (final.at(-1).lignes.length === g.lignes.length) final.at(-1).tranche = false; // une seule tranche
    }
    for (const gr of final) {
      gr.lignes.sort((a, b) => compareDofus(a.nom, b.nom));
      gr.niveauMin = Math.min(...gr.lignes.map(l => l.niveau));
      gr.niveauMax = Math.max(...gr.lignes.map(l => l.niveau));
    }
    const groupesFinal = final;
    if (groupesFinal.length) hdvs.push({ hdv, groupes: groupesFinal });
  }
  return hdvs;
}

// Une tâche est faite si la donnée a été relevée après la création du plan
export function tacheFaite(kind, id, base, depuis) {
  if (kind === 'volume') return (base.items[id]?.volume?.date ?? 0) >= depuis;
  if (kind === 'prixItem') return (base.items[id]?.prix?.date ?? 0) >= depuis;
  const r = base.ressources[id];
  return Math.max(r?.lots?.date ?? 0, r?.indispo?.date ?? 0) >= depuis;
}
