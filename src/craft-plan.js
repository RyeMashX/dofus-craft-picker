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
import { etatItem, niveauRessource, niveauVolume, niveauPrixItem, compareDofus } from './fraicheur.js';
import { prixVenteEstime, evaluerItem, maxCrafts } from './marge.js';
import { allouer } from './allocation.js';
import { planAchat } from './lots.js';
import { estExclu, lotsEnVente } from './statut.js';

const POINTS = { vert: 1, jaune: 0.6, orange: 0.2, noir: 0 };

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

// Tous les crafts viables (1 craft), triés par rendement
export function viables(catalogue, base, p, maintenant = Date.now()) {
  const offres = offresUtilisables(base, maintenant);
  const liste = [];
  for (const it of itemsFocus(catalogue, p)) {
    if (estExclu(base, it.id, maintenant)) continue;
    const etat = etatItem(it, base, maintenant);
    if (!etat.utilisable) continue;
    const b = base.items[it.id];
    const prixVente = prixVenteEstime(b.prix.valeurs, p).estime;
    const m = versMoteur(it, catalogue, { volumeMois: b.volume.valeur, prixVente });
    const ev = evaluerItem(m, offres, p, 1);
    if (ev.rendement == null || ev.rendement < p.margeAcceptable) continue;
    if (b.volume.valeur < p.volumeMin) continue;
    liste.push({
      id: it.id, nom: it.nom, type: it.type, iconId: it.iconId, item: m,
      volume: b.volume.valeur, prixVente, cout: ev.coutCraft, marge: ev.marge, rendement: ev.rendement,
      niveau: ev.rendement >= p.margeMin ? 'cible' : 'acceptable',
      confiance: confiance(it, base, offres, p, maintenant),
      pret: etat.pret, maxCrafts: maxCrafts(b.volume.valeur, p),
      enVente: lotsEnVente(base, it.id),
    });
  }
  liste.sort((a, b) => b.rendement - a.rendement);
  return { liste, offres };
}

// Recommandation : items cibles, ni en vente ni exclus. Retourne { [id]: n }.
export function recommander(liste, offres, budget, p) {
  const items = liste.filter(v => v.niveau === 'cible' && !v.enVente).map(v => v.item);
  const a = allouer(items, offres, budget, p);
  return Object.fromEntries(a.choix.map(o => [o.id, o.n]));
}

// Évaluation d'un plan { [id]: n } : lignes par item (chiffres réels) et totaux avec achats consolidés.
export function evaluerPlan(plan, liste, offres, catalogue, p) {
  const parId = new Map(liste.map(v => [v.id, v]));
  const lignes = [];
  for (const [id, n] of Object.entries(plan)) {
    const v = parId.get(Number(id));
    if (!v || n <= 0) continue;
    const ev = evaluerItem(v.item, offres, p, n);
    lignes.push({ ...v, n, coutN: ev.capital, revenuN: ev.revenu, margeN: ev.marge, rendementN: ev.rendement, depasse: n > v.maxCrafts });
  }
  lignes.sort((a, b) => b.margeN - a.margeN);
  const achats = achatsConsolides(lignes, offres, catalogue, p);
  const capital = achats.reduce((s, a) => s + (a.plan?.cout ?? 0), 0);
  const revenu = lignes.reduce((s, l) => s + l.revenuN, 0);
  const marge = revenu - capital;
  const conf = capital ? lignes.reduce((s, l) => s + l.confiance * l.coutN, 0) / lignes.reduce((s, l) => s + l.coutN, 0) : null;
  return {
    lignes, achats, capital, revenu, marge,
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
      hdv: typesEquipement.has(res.type) ? 'equipements' : 'ressources',
      plan: offres[a.id] ? planAchat(a.q, offres[a.id], p) : null,
    };
  }).sort((x, y) => (x.hdv === y.hdv ? 0 : x.hdv === 'equipements' ? -1 : 1) || compareDofus(x.type, y.type) || compareDofus(x.nom, y.nom));
}
