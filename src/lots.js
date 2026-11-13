// Achat d'une quantité q d'une ressource à l'HDV, par lots de 1, 10, 100 et 1000.
//
// offre = { 1: prix du lot x1, 10: prix du lot x10, 100: prix du lot x100, 1000: prix du lot x1000 }
// (une taille absente ou null = pas de lot affiché). L'HDV ne montre que le lot le moins cher de chaque
// taille, jamais combien il y en a derrière : on calcule donc trois coûts (cf. README, « Règle des lots »).
//
// - Optimiste (O) : tout au prix affiché, sans limite de lots.
// - Standard (S) : au prix affiché, mais au plus `lotsCredibles` lots d'une même taille (138 x1 à 10 000
//   n'est pas crédible : on passe au x10, au x100…). C'est le plan d'achat proposé.
// - Pessimiste (P) : chaque lot acheté dans une taille fait monter le suivant de `hausseParLot` du prix
//   affiché (2e lot +20 %, 3e +40 %…), plafonné à `plafondHausse` fois ce prix ; meilleur mélange de tailles.
// On impose O ≤ S ≤ P.
// - Risque = (P − O) / S : faible, moyen, fort (`seuilsRisque`). Pénurie possible quand il faudrait plus de
//   `lotsCredibles` lots de la plus grande taille affichée : risque fort d'office.
// - Coût réaliste = S + `partPessimiste` × (P − S) : c'est lui qui entre dans le coût du craft et la marge.
//
// Surplus : les unités en trop sont revendues à 80 % du prix x1 à l'unité, ou du prix x10 par paquets de 10,
// taxe déduite, jamais plus cher que payé ; on n'achète du surplus que s'il fait gagner `gainMinSurplus`.

export const TAILLES = [1, 10, 100, 1000];

function dispo(offre, t) {
  return offre && offre[t] != null && offre[t] > 0;
}

export function prixUnitaireMin(offre) {
  const unitaires = TAILLES.filter(t => dispo(offre, t)).map(t => offre[t] / t);
  return unitaires.length ? Math.min(...unitaires) : null;
}

// Valeur de revente de s unités en trop. plafond = prix unitaire payé.
export function valeurSurplus(s, offre, plafond, p) {
  if (s <= 0) return 0;
  const r = p.revalorisationSurplus;
  const unite = dispo(offre, 1) ? Math.min(r * offre[1], plafond)
    : dispo(offre, 10) ? Math.min(r * offre[10] / 10, plafond) : 0;
  const paquet = dispo(offre, 10) ? Math.min(r * offre[10], 10 * plafond) : 0;
  // k paquets de 10 + le reste à l'unité : linéaire en k, donc le meilleur est k = 0 ou k maximal
  let best = s * unite;
  if (paquet) { const k = Math.floor(s / 10); best = Math.max(best, k * paquet + (s - 10 * k) * unite); }
  return best * (1 - p.taxeVente);
}

// Coût de n lots d'une taille au prix affiché prixLot quand chaque lot fait monter le suivant :
// lot k au prix × min(plafond, 1 + hausse × (k − 1)).
export function coutLotsHausse(n, prixLot, hausse, plafond) {
  if (n <= 0) return 0;
  if (!hausse) return n * prixLot;
  const avant = Math.min(n, Math.ceil((plafond - 1) / hausse)); // lots sous le plafond
  return prixLot * (avant + hausse * avant * (avant - 1) / 2 + (n - avant) * plafond);
}

// Meilleur plan pour couvrir q unités. coutTaille(t, n) = coût de n lots de taille t ; maxLots borne le nombre
// de lots par taille (Infinity = pas de borne). Coûts linéaires : on ne teste que les cassures pour n10.
function meilleursPlans(q, offre, p, coutTaille, maxLots, lineaire) {
  let best = null, sansSurplus = null;
  const mieux = (a, b) => !b || a.cout < b.cout - 1e-9 || (Math.abs(a.cout - b.cout) < 1e-9 && a.nbLots < b.nbLots);
  const max = (t, reste) => dispo(offre, t) ? Math.min(Math.ceil(reste / t), maxLots) : 0;

  for (let n1000 = 0; n1000 <= max(1000, q); n1000++) {
    const r1000 = Math.max(0, q - 1000 * n1000);
    for (let n100 = 0; n100 <= max(100, r1000); n100++) {
      const r100 = Math.max(0, r1000 - 100 * n100);
      const m10 = max(10, r100);
      const candidats = lineaire ? [...new Set([0, Math.floor(r100 / 10), m10].filter(n => n >= 0 && n <= m10))] : null;
      for (let i = 0, n10; lineaire ? i < candidats.length : i <= m10; i++) {
        n10 = lineaire ? candidats[i] : i;
        const n1 = Math.max(0, r100 - 10 * n10);
        if (n1 > 0 && (!dispo(offre, 1) || n1 > maxLots)) continue;

        const brut = coutTaille(1000, n1000) + coutTaille(100, n100) + coutTaille(10, n10) + coutTaille(1, n1);
        const achete = 1000 * n1000 + 100 * n100 + 10 * n10 + n1;
        const surplus = achete - q;
        const credit = valeurSurplus(surplus, offre, brut / achete, p);
        const plan = { lots: { 1: n1, 10: n10, 100: n100, 1000: n1000 }, achete, surplus, coutBrut: brut, cout: brut - credit, nbLots: n1000 + n100 + n10 + n1 };

        if (mieux(plan, best)) best = plan;
        if (surplus === 0 && mieux(plan, sansSurplus)) sansSurplus = plan;
      }
    }
  }
  return best && { best, sansSurplus };
}

function choisir({ best, sansSurplus }, p) {
  if (!sansSurplus || best.surplus === 0) return best;
  return best.cout < sansSurplus.cout * (1 - p.gainMinSurplus) ? best : sansSurplus;
}

// Cache : un même besoin avec les mêmes prix et réglages n'est calculé qu'une fois
// (l'onglet Données et le plan de scan refont souvent les mêmes calculs).
const cache = new Map();
export function planAchat(q, offre, p) {
  const cle = `${q}|${offre?.[1]}|${offre?.[10]}|${offre?.[100]}|${offre?.[1000]}|${p.lotsCredibles}|${p.hausseParLot}|${p.plafondHausse}|${p.partPessimiste}|${p.seuilsRisque?.moyen}|${p.seuilsRisque?.fort}|${p.revalorisationSurplus}|${p.gainMinSurplus}|${p.taxeVente}`;
  if (cache.has(cle)) return cache.get(cle);
  const r = calculerPlanAchat(q, offre, p);
  if (cache.size > 20000) cache.clear();
  cache.set(cle, r);
  return r;
}

export const RANG_RISQUE = { faible: 0, moyen: 1, fort: 2 };
export function niveauRisque(ecart, penurie, p) {
  if (penurie || ecart >= p.seuilsRisque.fort) return 'fort';
  return ecart >= p.seuilsRisque.moyen ? 'moyen' : 'faible';
}

function calculerPlanAchat(q, offre, p) {
  if (q <= 0) return { q, lots: { 1: 0, 10: 0, 100: 0, 1000: 0 }, achete: 0, surplus: 0, coutBrut: 0, cout: 0, nbLots: 0, prixUnitaire: 0,
    coutOptimiste: 0, coutStandard: 0, coutPessimiste: 0, ecartRisque: 0, penurie: false, risque: 'faible', enJeu: 0, alerte: false };
  if (prixUnitaireMin(offre) == null) return null; // aucun prix connu

  const affiche = (t, n) => n ? n * offre[t] : 0;
  const optimiste = choisir(meilleursPlans(q, offre, p, affiche, Infinity, true), p);
  // standard : si aucun plan ne tient dans la limite de lots (que du x1 pour 138), on garde le plan optimiste
  const std = meilleursPlans(q, offre, p, affiche, p.lotsCredibles, false);
  const standard = std ? choisir(std, p) : optimiste;
  const pess = choisir(meilleursPlans(q, offre, p, (t, n) => coutLotsHausse(n, offre[t], p.hausseParLot, p.plafondHausse), Infinity, false), p);

  const O = optimiste.cout, S = Math.max(standard.cout, O), P = Math.max(pess.cout, S);
  const tMax = Math.max(...TAILLES.filter(t => dispo(offre, t)));
  const penurie = q > p.lotsCredibles * tMax;
  const ecartRisque = S > 0 ? (P - O) / S : 0;
  const risque = niveauRisque(ecartRisque, penurie, p);
  const cout = S + p.partPessimiste * (P - S);

  return {
    q, ...standard, cout, prixUnitaire: cout / q,
    coutOptimiste: O, coutStandard: S, coutPessimiste: P,
    ecartRisque, penurie, risque, enJeu: P - S,
    alerte: risque !== 'faible',
  };
}

// Somme de plusieurs achats (lignes d'une recette, composants d'un sous-craft) : les trois coûts s'additionnent,
// le risque se recalcule sur les totaux (une petite ressource risquée ne rend pas tout le craft risqué),
// sauf une pénurie possible, qui reste un risque fort.
export function agreger(plans, p) {
  const t = { coutOptimiste: 0, coutStandard: 0, coutPessimiste: 0, cout: 0, penurie: false };
  for (const x of plans) {
    t.coutOptimiste += x.coutOptimiste ?? x.cout; t.coutStandard += x.coutStandard ?? x.cout;
    t.coutPessimiste += x.coutPessimiste ?? x.cout; t.cout += x.cout; t.penurie ||= !!x.penurie;
  }
  t.enJeu = t.coutPessimiste - t.coutStandard;
  t.ecartRisque = t.coutStandard > 0 ? (t.coutPessimiste - t.coutOptimiste) / t.coutStandard : 0;
  t.risque = niveauRisque(t.ecartRisque, t.penurie, p);
  t.alerte = t.risque !== 'faible';
  return t;
}
