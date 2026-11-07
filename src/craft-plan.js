// Plan de craft : crafts viables, recommandation, plan modifiable à la main, achats consolidés.
//
// - Viable : item utilisable (aucune donnée orange ou noire), non exclu, rendement ≥ 15 % (« acceptable »).
//   « Cible » au-delà de 25 %.
// - Recommandation : répartition du budget sur les items cibles, ni exclus ni en vente.
//   L'effort (coût fictif par craft) sert UNIQUEMENT à départager : il n'entre pas dans la marge affichée.
// - Confiance : affichée seulement, elle ne modifie aucun chiffre.
// - Plan : { [itemId]: nombre de crafts }. Les ressources de tous les crafts sont achetées ensemble :
//   les quantités d'une ressource partagée s'additionnent avant le choix des lots.

import { itemsFocus } from './entonnoir.js';
import { versMoteur } from './catalogue.js';
import { etatItem, niveauRessource, niveauVolume, niveauPrixItem, compareDofus, compareCategorie, hdvDe, ORDRE_HDV } from './fraicheur.js';
import { prixVenteEstime, evaluerItem, maxCrafts } from './marge.js';
import { allouer } from './allocation.js';
import { planAchat } from './lots.js';
import { estExclu, lotsEnVente } from './statut.js';
import { coutFmEstime } from './ventes.js';
import { estIndispo } from './base.js';

const POINTS = { vert: 1, jaune: 0.6, orange: 0.2, rouge: 0, noir: 0 };

// Lots de ressources utilisables (vert ou jaune), au format du moteur
export function offresUtilisables(base, maintenant = Date.now()) {
  const offres = {};
  for (const [id, r] of Object.entries(base.ressources)) {
    const n = niveauRessource(r, maintenant);
    if (n === 'vert' || n === 'jaune') offres[id] = r.lots.valeurs;
  }
  return offres;
}

// Confiance entre 0 et 1 : volume 15 %, prix de vente 35 %, ressources 50 % pondérées par leur part du coût.
export function confiance(it, base, offres, p, maintenant = Date.now()) {
  const b = base.items[it.id];
  const parts = it.recette.map(r => {
    const cout = offres[r.id] ? planAchat(r.qte, offres[r.id], p)?.cout ?? 0 : 0;
    return { cout, pts: POINTS[niveauRessource(base.ressources[r.id], maintenant)] };
  });
  const total = parts.reduce((s, x) => s + x.cout, 0) || 1;
  const res = parts.reduce((s, x) => s + x.pts * x.cout / total, 0);
  return 0.15 * POINTS[niveauVolume(b, maintenant)] + 0.35 * POINTS[niveauPrixItem(b, maintenant)] + 0.5 * res;
}
export const niveauConfiance = c => c >= 0.9 ? 'haute' : c >= 0.75 ? 'moyenne' : 'faible';

// Lots de toutes les ressources relevées, quelle que soit leur fraîcheur (items du plan devenus non viables)
export function offresToutes(base) {
  return Object.fromEntries(Object.entries(base.ressources).filter(([, r]) => r.lots && !estIndispo(r)).map(([id, r]) => [id, r.lots.valeurs]));
}

// Fiche d'un item pour le Craft (1 craft). raison = pourquoi il n'est pas viable (null s'il l'est).
export function ficheItem(it, catalogue, base, p, offres, maintenant = Date.now()) {
  const b = base.items[it.id] ?? {};
  const etat = etatItem(it, base, maintenant);
  const prixVente = b.prix ? prixVenteEstime(b.prix.valeurs, p).estime : b.prixMoyen?.valeur ?? null;
  const fm = coutFmEstime(base, it.id);
  const m = { ...versMoteur(it, catalogue, { volumeMois: b.volume?.valeur ?? 0, prixVente }), coutFm: fm?.valeur ?? 0 };
  const ev = evaluerItem(m, offres, p, 1);
  const indispo = it.recette.filter(r => estIndispo(base.ressources[r.id])).map(r => catalogue.ressources[r.id]?.nom ?? `#${r.id}`);
  const raison = estExclu(base, it.id, maintenant) ? 'exclu'
    : indispo.length ? `ressource introuvable à l'HDV (${indispo.join(', ')})`
    : !etat.utilisable ? 'données périmées'
    : (b.volume?.valeur ?? 0) < p.volumeMin ? 'volume trop faible'
    : ev.rendement == null || ev.craft.manquantes.length ? 'prix manquant'
    : ev.rendement < p.margeAcceptable ? 'marge trop faible' : null;
  return {
    id: it.id, nom: it.nom, type: it.type, iconId: it.iconId, item: m,
    volume: b.volume?.valeur ?? 0, prixVente, cout: ev.coutCraft, fm: ev.coutFm, fmSource: fm, marge: ev.marge, rendement: ev.rendement,
    niveau: ev.rendement != null && ev.rendement >= p.margeMin ? 'cible' : 'acceptable',
    confiance: confiance(it, base, offres, p, maintenant),
    pret: etat.pret, maxCrafts: maxCrafts(b.volume?.valeur ?? 0, p),
    enVente: lotsEnVente(base, it.id), raison,
  };
}

// Tous les crafts viables (1 craft), triés par rendement
export function viables(catalogue, base, p, maintenant = Date.now()) {
  const offres = offresUtilisables(base, maintenant);
  const liste = [];
  for (const it of itemsFocus(catalogue, p)) {
    if (estExclu(base, it.id, maintenant) || !etatItem(it, base, maintenant).utilisable) continue;
    const f = ficheItem(it, catalogue, base, p, offres, maintenant);
    if (!f.raison) liste.push(f);
  }
  liste.sort((a, b) => b.rendement - a.rendement);
  return { liste, offres };
}

// Coût de craft estimé d'un item d'après la base (pour une vente ajoutée par OCR)
export function coutEstime(catalogue, base, p, id) {
  const it = catalogue.items.find(i => i.id === Number(id));
  if (!it) return null;
  return estimerCout(it, base, p);
}
function estimerCout(it, base, p) {
  let cout = 0;
  for (const r of it.recette) {
    const res = base.ressources[r.id] ?? {};
    if (estIndispo(res)) return null;
    if (res.lots) cout += planAchat(r.qte, res.lots.valeurs, p)?.cout ?? 0;
    else if (res.prixMoyen) cout += r.qte * res.prixMoyen.valeur;
    else return null;
  }
  return Math.round(cout);
}

// Détail d'une recette pour n crafts : quantité, prix unitaire et coût de chaque ressource.
// Lots relevés (quelle que soit leur fraîcheur) sinon prix moyen ; source null = prix inconnu.
// Chaque ressource est chiffrée seule (le plan, lui, regroupe les ressources partagées).
export function detailCraft(it, catalogue, base, p, n = 1, maintenant = Date.now()) {
  const lignes = it.recette.map(r => {
    const res = base.ressources[r.id] ?? {}, cat = catalogue.ressources[r.id] ?? { nom: `#${r.id}` };
    const q = r.qte * n;
    if (estIndispo(res)) return { id: r.id, nom: cat.nom, iconId: cat.iconId, q, cout: null, prixUnitaire: null, source: 'indispo', niveau: 'rouge' };
    const achat = res.lots ? planAchat(q, res.lots.valeurs, p) : null;
    const cout = achat ? achat.cout : res.prixMoyen ? q * res.prixMoyen.valeur : null;
    return {
      id: r.id, nom: cat.nom, iconId: cat.iconId, q, cout,
      prixUnitaire: cout == null ? null : cout / q,
      source: achat ? 'lots' : res.prixMoyen ? 'moyen' : null,
      niveau: niveauRessource(res, maintenant),
    };
  });
  return { lignes, total: lignes.some(l => l.cout == null) ? null : lignes.reduce((s, l) => s + l.cout, 0) };
}

// Recommandation : items cibles, ni en vente ni exclus. Retourne { [id]: n }.
export function recommander(liste, offres, budget, p) {
  const items = liste.filter(v => v.niveau === 'cible' && !v.enVente).map(v => v.item);
  const a = allouer(items, offres, budget, p);
  return Object.fromEntries(a.choix.map(o => [o.id, o.n]));
}

// Évaluation d'un plan { [id]: n } : lignes par item (chiffres réels) et totaux avec achats consolidés.
// Un item du plan qui n'est plus viable reste dans le plan, évalué avec les données disponibles, et signalé (raison).
export function evaluerPlan(plan, liste, offres, catalogue, p, base = null) {
  const parId = new Map(liste.map(v => [v.id, v]));
  const toutes = base ? { ...offresToutes(base), ...offres } : offres;
  const lignes = [];
  for (const [id, n] of Object.entries(plan)) {
    if (n <= 0) continue;
    let v = parId.get(Number(id));
    if (!v && base) {
      const it = catalogue.items.find(i => i.id === Number(id));
      if (it) v = ficheItem(it, catalogue, base, p, toutes);
    }
    if (!v) continue;
    const ev = evaluerItem(v.item, toutes, p, n);
    lignes.push({ ...v, n, coutN: ev.capital, craftN: ev.coutCraft, fmN: ev.coutFm, revenuN: ev.revenu ?? 0, margeN: ev.marge ?? 0, rendementN: ev.rendement, depasse: n > v.maxCrafts });
  }
  lignes.sort((a, b) => b.margeN - a.margeN);
  const achats = achatsConsolides(lignes, toutes, catalogue, p);
  const fm = lignes.reduce((s, l) => s + l.fmN, 0);
  const capital = achats.reduce((s, a) => s + (a.plan?.cout ?? 0), 0) + fm;
  const revenu = lignes.reduce((s, l) => s + l.revenuN, 0);
  const marge = revenu - capital;
  const conf = capital ? lignes.reduce((s, l) => s + l.confiance * l.coutN, 0) / lignes.reduce((s, l) => s + l.coutN, 0) : null;
  return {
    lignes, achats, capital, fm, revenu, marge,
    rendement: capital ? marge / capital : null,
    crafts: lignes.reduce((s, l) => s + l.n, 0),
    confiance: conf,
  };
}

// Achats regroupés par ressource : quantités additionnées sur tous les crafts du plan, puis choix des lots.
export function achatsConsolides(lignes, offres, catalogue, p) {
  const typesEquipement = new Set(catalogue.items.map(i => i.type));
  const parRes = new Map();
  for (const l of lignes) for (const r of l.item.recette) {
    const a = parRes.get(r.id) ?? { id: r.id, q: 0, pour: [] };
    a.q += r.qte * l.n;
    a.pour.push({ nom: l.nom, q: r.qte * l.n });
    parRes.set(r.id, a);
  }
  return [...parRes.values()].map(a => {
    const res = catalogue.ressources[a.id] ?? { nom: `#${a.id}` };
    return {
      ...a, nom: res.nom, type: res.type ?? '?', niveau: res.niveau ?? 0, iconId: res.iconId,
      hdv: hdvDe(res.type, typesEquipement),
      plan: offres[a.id] ? planAchat(a.q, offres[a.id], p) : null,
    };
  }).sort((x, y) => ORDRE_HDV.indexOf(x.hdv) - ORDRE_HDV.indexOf(y.hdv) || compareCategorie(x.type, y.type) || compareDofus(x.nom, y.nom));
}
