// Évaluation des items à partir de la base de prix.
//
// Deux niveaux :
// - estimation : utilise le meilleur prix disponible, même périmé ou au prix moyen.
//   Sert UNIQUEMENT à prioriser les scans.
// - base d'évaluation : items entièrement scannés (volume, annonces et tous les lots frais).
//   C'est la seule qui sert à décider quoi crafter.

import { itemsCraftables, versMoteur } from './catalogue.js';
import { fraicheur, offresFraiches } from './base.js';
import { prixVenteEstime, evaluerItem } from './marge.js';
import { planAchat } from './lots.js';

export function itemsFocus(catalogue, p) {
  const [nMin, nMax] = p.focusNiveaux;
  return itemsCraftables(catalogue, p.metiers).filter(i => i.niveau >= nMin && i.niveau <= nMax);
}

// Rendement estimé d'un item avec ce qu'on a en base.
// precision : 'scan' (annonces + lots relevés), 'mixte', 'moyen' (prix moyens seuls), null si incalculable.
export function estimerItem(it, base, p) {
  const b = base.items[it.id] ?? {};
  let prixVente = null, sourceVente = null;
  if (b.prix) { prixVente = prixVenteEstime(b.prix.valeurs, p).estime; sourceVente = 'scan'; }
  else if (b.prixMoyen) { prixVente = b.prixMoyen.valeur; sourceVente = 'moyen'; }

  let cout = 0, nbScan = 0, nbMoyen = 0, manquantes = 0;
  for (const r of it.recette) {
    const res = base.ressources[r.id] ?? {};
    if (res.lots) { cout += planAchat(r.qte, res.lots.valeurs, p)?.cout ?? 0; nbScan++; }
    else if (res.prixMoyen) { cout += r.qte * res.prixMoyen.valeur; nbMoyen++; }
    else manquantes++;
  }

  if (prixVente == null || manquantes || cout <= 0) {
    return { rendement: null, prixVente, cout: null, precision: null, manquantes };
  }
  const rendement = (prixVente * (1 - p.taxeVente) - cout) / cout;
  const toutScan = sourceVente === 'scan' && nbMoyen === 0;
  const toutMoyen = sourceVente === 'moyen' && nbScan === 0;
  return { rendement, prixVente, cout, precision: toutScan ? 'scan' : toutMoyen ? 'moyen' : 'mixte', manquantes: 0 };
}

// Probabilité "grossière" que l'item soit rentable, entre 0 et 1.
// 0 à 0 % de rendement estimé, 0,5 au seuil (25 %), 1 au double du seuil. Inconnu → 0,5.
export function potentiel(rendement, p) {
  if (rendement == null) return 0.5;
  return Math.max(0, Math.min(1, rendement / (2 * p.margeMin)));
}

// Base d'évaluation : items entièrement scannés et frais.
export function baseEvaluation(catalogue, base, p, maintenant = Date.now()) {
  const offres = offresFraiches(base, p.validite.ressources, maintenant);
  const evalues = [], items = [];
  for (const it of itemsFocus(catalogue, p)) {
    const b = base.items[it.id] ?? {};
    if (fraicheur(b.volume, p.validite.volume, maintenant) !== 'frais') continue;
    if (fraicheur(b.prix, p.validite.prixItem, maintenant) !== 'frais') continue;
    if (!it.recette.every(r => offres[r.id])) continue;
    const prixVente = prixVenteEstime(b.prix.valeurs, p).estime;
    const m = versMoteur(it, catalogue, { volumeMois: b.volume.valeur, prixVente });
    items.push(m);
    evalues.push(evaluerItem(m, offres, p, 1));
  }
  return {
    items, offres,
    eligibles: evalues.filter(e => e.eligible).sort((a, b) => b.rendement - a.rendement),
    ecartes: evalues.filter(e => !e.eligible),
  };
}
