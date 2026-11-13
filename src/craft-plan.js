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
import { etatItem, niveauRessource, niveauLigne, affiche, bleuLigne, bleuPrixItem, bleuRessource, niveauVolume, niveauPrixItem, compareDofus, compareCategorie, hdvDe, ORDRE_HDV } from './fraicheur.js';
import { prixVenteEstime, evaluerItem, maxCrafts } from './marge.js';
import { allouer } from './allocation.js';
import { planAchat } from './lots.js';
import { estExclu, lotsEnVente } from './statut.js';
import { coutFmEstime } from './ventes.js';
import { estIndispo } from './base.js';
import { resoudre, achatOffres, achatBase } from './souscraft.js';

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
    const cout = resoudre(r, r.qte, achatOffres(offres, p), p)?.cout ?? 0;
    return { cout, pts: POINTS[niveauLigne(r, base, maintenant)] };
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
  // aucune annonce en vente : pas de concurrent, on vise le prix moyen
  const prixVente = (b.prix ? prixVenteEstime(b.prix.valeurs, p).estime : null) ?? b.prixMoyen?.valeur ?? null;
  const fm = coutFmEstime(base, it.id);
  const m = { ...versMoteur(it, catalogue, { volumeMois: b.volume?.valeur ?? 0, prixVente }), coutFm: fm?.valeur ?? 0 };
  const ev = evaluerItem(m, offres, p, 1);
  const indispo = it.recette.filter(r => niveauLigne(r, base, maintenant) === 'rouge').map(r => catalogue.ressources[r.id]?.nom ?? `#${r.id}`);
  const raison = estExclu(base, it.id, maintenant) ? 'exclu'
    : indispo.length ? `ressource introuvable à l'HDV (${indispo.join(', ')})`
    : !etat.utilisable ? 'données périmées'
    : (b.volume?.valeur ?? 0) < p.volumeMin ? 'volume trop faible'
    : ev.rendement == null || ev.craft.manquantes.length ? 'prix manquant'
    : ev.rendement < p.margeAcceptable ? 'marge trop faible' : null;
  return {
    id: it.id, nom: it.nom, type: it.type, iconId: it.iconId, item: m,
    risque: ev.risque, margePessimiste: ev.margePessimiste, couts: ev.craft.couts, risquees: risquees(ev.craft),
    volume: b.volume?.valeur ?? 0, prixVente, cout: ev.coutCraft, fm: ev.coutFm, fmSource: fm, marge: ev.marge, rendement: ev.rendement,
    niveau: ev.rendement != null && ev.rendement >= p.margeMin ? 'cible' : 'acceptable',
    confiance: confiance(it, base, offres, p, maintenant),
    pret: etat.pret, aVerifier: aVerifier(it, catalogue, base, maintenant), maxCrafts: maxCrafts(b.volume?.valeur ?? 0, p),
    enVente: lotsEnVente(base, it.id), raison,
  };
}

// Confirmation avant achat : tout ce que le plan de craft utilise doit être bleu (relevé de moins d'une heure) :
// le prix de vente de chaque item et les lots de ses ressources. Une ressource craftable pas bleue fait relever son
// prix d'achat et ses composants pas bleus. Le volume de ventes n'est pas redemandé (il ne bouge pas en une heure).
export function tachesConfirmation(plan, catalogue, base, maintenant = Date.now()) {
  const taches = [], vus = new Set();
  const ajouter = (kind, id) => { const k = `${kind}:${id}`; if (!vus.has(k)) { vus.add(k); taches.push({ kind, id, raison: 'confirmation' }); } };
  const ligne = (r, prof = 0) => {
    if (bleuLigne(r, base, maintenant)) return;
    if (!bleuRessource(base.ressources[r.id], maintenant)) ajouter('ressource', r.id);
    if (prof < 6) (r.recette ?? []).forEach(c => ligne(c, prof + 1));
  };
  for (const [id, n] of Object.entries(plan ?? {})) {
    if (!(n > 0)) continue;
    const it = catalogue.items.find(i => i.id === Number(id));
    if (!it) continue;
    if (!bleuPrixItem(base.items[it.id], maintenant)) ajouter('prixItem', it.id);
    it.recette.forEach(r => ligne(r));
  }
  return taches;
}

// Ressources à risque d'un craft (lignes qui peuvent se vider), la plus coûteuse en cas de dérapage d'abord
export function risquees(craft) {
  return craft.lignes.filter(l => l.plan && l.plan.risque !== 'faible')
    .map(l => ({ nom: l.nom, risque: l.plan.risque, penurie: !!l.plan.penurie, enJeu: l.plan.enJeu ?? 0 }))
    .sort((a, b) => b.enJeu - a.enJeu);
}

// Ce qui n'est pas vert dans les données d'un item (détail de la confiance) : ['prix de vente jaune', 'Étoffe jaune', …]
export function aVerifier(it, catalogue, base, maintenant = Date.now()) {
  const b = base.items[it.id], out = [];
  const nv = niveauVolume(b, maintenant), np = niveauPrixItem(b, maintenant);
  if (nv !== 'vert') out.push(`volume ${nv}`);
  if (np !== 'vert') out.push(`prix de vente ${np}`);
  for (const r of it.recette) {
    const n = niveauLigne(r, base, maintenant);
    if (n !== 'vert') out.push(`${catalogue.ressources[r.id]?.nom ?? `#${r.id}`} ${n}`);
  }
  return out;
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
    const x = resoudre(r, r.qte, achatBase(base, p), p);
    if (!x) return null;
    cout += x.cout;
  }
  return Math.round(cout);
}

// Détail d'une recette pour n crafts : quantité, prix unitaire et coût de chaque ressource.
// Lots relevés (quelle que soit leur fraîcheur) sinon prix moyen ; source null = prix inconnu.
// Chaque ressource est chiffrée seule (le plan, lui, regroupe les ressources partagées).
// Ressource craftable moins chère à crafter : source 'craft', composants détaillés de la même façon.
export function detailCraft(it, catalogue, base, p, n = 1, maintenant = Date.now()) {
  const acheter = achatBase(base, p);
  const ligne = (r, q, x) => {
    const res = base.ressources[r.id] ?? {}, cat = catalogue.ressources[r.id] ?? { nom: `#${r.id}` };
    const niveau = affiche(niveauLigne(r, base, maintenant), bleuLigne(r, base, maintenant));
    if (!x) return { id: r.id, nom: cat.nom, iconId: cat.iconId, q, cout: null, prixUnitaire: null, source: estIndispo(res) ? 'indispo' : null, niveau };
    return {
      id: r.id, nom: cat.nom, iconId: cat.iconId, q, cout: x.cout, prixUnitaire: x.cout / q,
      source: x.mode === 'craft' ? 'craft' : x.source, niveau,
      risque: x.risque ?? 'faible', penurie: !!x.penurie, coutOptimiste: x.coutOptimiste ?? x.cout, coutStandard: x.coutStandard ?? x.cout, coutPessimiste: x.coutPessimiste ?? x.cout,
      achat: x.mode === 'craft' && x.achat ? x.achat.cout : null,
      composants: x.mode === 'craft' ? x.composants.map(c => ligne(c, c.q, c.res)) : null,
    };
  };
  const lignes = it.recette.map(r => ligne(r, r.qte * n, resoudre(r, r.qte * n, acheter, p)));
  return { lignes, total: lignes.some(l => l.cout == null) ? null : lignes.reduce((s, l) => s + l.cout, 0) };
}

// Recommandation : items cibles, ni en vente ni exclus. Retourne { [id]: n }.
export function recommander(liste, offres, budget, p) {
  const items = liste.filter(v => v.niveau === 'cible' && !v.enVente).map(v => v.item);
  const a = allouer(items, offres, budget, p);
  return Object.fromEntries(a.choix.map(o => [o.id, o.n]));
}

// Recommandation qui tient dans le budget une fois les achats regroupés : regrouper une ressource partagée peut
// coûter plus cher que la somme des crafts pris séparément (on vide plus de lots au prix affiché). Tant que le plan
// dépasse, on retire le craft le moins rentable.
export function recommanderDansBudget(liste, offres, budget, p, catalogue, base) {
  const plan = recommander(liste, offres, budget, p);
  for (let garde = 0; garde < 200; garde++) {
    const ev = evaluerPlan(plan, liste, offres, catalogue, p, base);
    if (ev.capital <= budget || !ev.lignes.length) break;
    const pire = ev.lignes.reduce((a, l) => (l.rendementN ?? -Infinity) < (a.rendementN ?? -Infinity) ? l : a);
    if (--plan[pire.id] <= 0) delete plan[pire.id];
  }
  return plan;
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
    lignes.push({ ...v, n, coutN: ev.capital, craftN: ev.coutCraft, fmN: ev.coutFm, revenuN: ev.revenu ?? 0, margeN: ev.marge ?? 0, rendementN: ev.rendement, depasse: n > v.maxCrafts,
      risqueN: ev.risque, margePessimisteN: ev.margePessimiste, coutsN: ev.craft.couts, risquees: risquees(ev.craft) });
  }
  lignes.sort((a, b) => (b.rendementN ?? -Infinity) - (a.rendementN ?? -Infinity)); // % de marge décroissant
  const { achats, sousCrafts } = achatsConsolides(lignes, toutes, catalogue, p);
  const fm = lignes.reduce((s, l) => s + l.fmN, 0);
  const capital = achats.reduce((s, a) => s + (a.plan?.cout ?? 0), 0) + fm;
  const revenu = lignes.reduce((s, l) => s + l.revenuN, 0);
  const marge = revenu - capital;
  const conf = capital ? lignes.reduce((s, l) => s + l.confiance * l.coutN, 0) / lignes.reduce((s, l) => s + l.coutN, 0) : null;
  return {
    lignes, achats, sousCrafts, capital, fm, revenu, marge,
    rendement: capital ? marge / capital : null,
    crafts: lignes.reduce((s, l) => s + l.n, 0),
    confiance: conf,
  };
}

// Achats regroupés par ressource : quantités additionnées sur tous les crafts du plan, puis choix des lots.
// Une ressource craftable est décidée sur la quantité totale (acheter, ou crafter si ≥ 5 % moins cher) : si on la
// crafte, elle passe dans sousCrafts et ses composants s'ajoutent aux achats. On traite les ressources de haut en
// bas de l'arbre (profondeur maximale), pour qu'une quantité soit complète avant d'être décidée.
export function achatsConsolides(lignes, offres, catalogue, p) {
  const typesEquipement = new Set(catalogue.items.map(i => i.type));
  const acheter = achatOffres(offres, p);
  const ligneDe = new Map(), prof = new Map();
  const parcourir = (r, d) => {
    if (!ligneDe.has(r.id) || r.recette) ligneDe.set(r.id, r);
    if ((prof.get(r.id) ?? -1) >= d) return;
    prof.set(r.id, d);
    if (d < 6) (r.recette ?? []).forEach(c => parcourir(c, d + 1));
  };
  const parRes = new Map();
  const demander = (id, q, pour) => {
    const a = parRes.get(id) ?? { id, q: 0, pour: [] };
    a.q += q; a.pour.push(pour); parRes.set(id, a);
  };
  for (const l of lignes) for (const r of l.item.recette) { parcourir(r, 0); demander(r.id, r.qte * l.n, { nom: l.nom, q: r.qte * l.n, iconId: l.iconId }); }

  const sousCrafts = [];
  const ordre = [...prof.keys()].sort((a, b) => prof.get(a) - prof.get(b));
  for (const id of ordre) {
    const a = parRes.get(id), r = ligneDe.get(id);
    if (!a || !r.recette) continue;
    const x = resoudre(r, a.q, acheter, p);
    if (x?.mode !== 'craft') continue;
    parRes.delete(id);
    const res = catalogue.ressources[id] ?? { nom: `#${id}` };
    sousCrafts.push({ id, nom: res.nom, iconId: res.iconId, metier: res.metier ?? null, q: a.q, pour: a.pour, cout: x.cout, achat: x.achat?.cout ?? null,
      composants: r.recette.map(c => ({ id: c.id, nom: catalogue.ressources[c.id]?.nom ?? `#${c.id}`, iconId: catalogue.ressources[c.id]?.iconId, q: c.qte * a.q })) });
    for (const c of r.recette) demander(c.id, c.qte * a.q, { nom: res.nom, q: c.qte * a.q, iconId: res.iconId });
  }

  const achats = [...parRes.values()].map(a => {
    const res = catalogue.ressources[a.id] ?? { nom: `#${a.id}` };
    return {
      ...a, nom: res.nom, type: res.type ?? '?', niveau: res.niveau ?? 0, iconId: res.iconId,
      hdv: hdvDe(res.type, typesEquipement),
      plan: offres[a.id] ? planAchat(a.q, offres[a.id], p) : null,
    };
  }).sort((x, y) => ORDRE_HDV.indexOf(x.hdv) - ORDRE_HDV.indexOf(y.hdv) || compareCategorie(x.type, y.type) || compareDofus(x.nom, y.nom));
  // le plus profond d'abord : on crafte les alliages avant ce qui les utilise
  sousCrafts.sort((x, y) => prof.get(y.id) - prof.get(x.id) || compareDofus(x.nom, y.nom));
  return { achats, sousCrafts };
}
