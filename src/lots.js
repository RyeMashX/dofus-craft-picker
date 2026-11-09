// Achat d'une quantité q d'une ressource à l'HDV, par lots de 1, 10 et 100.
//
// offre = { 1: prix du lot x1, 10: prix du lot x10, 100: prix du lot x100, 1000: prix du lot x1000 }
// (une taille absente ou null = pas de lot affiché)
//
// Règle (cf. README) :
// - chaque taille de lot n'est garantie au prix affiché que pour `profondeur[taille]` lots ;
//   au-delà on compte chaque lot avec un surcoût (le prix remonte quand on vide la ligne) ;
// - si on achète plus que nécessaire, le surplus est revendu à 80 % du prix x1 à l'unité,
//   ou à 80 % du prix x10 par paquets de 10, taxe déduite, sans jamais valoir plus
//   que ce qu'on l'a payé (pas de "bénéfice" fictif sur la revente) ;
// - on n'achète du surplus que si le gain dépasse `gainMinSurplus` par rapport
//   au meilleur plan sans surplus ;
// - on calcule aussi le coût "optimiste" (profondeur infinie) : un gros écart = alerte.

export const TAILLES = [1, 10, 100, 1000];

export function coutLots(taille, n, prixLot, profondeur, surcout) {
  const auPrix = Math.min(n, profondeur);
  return auPrix * prixLot + (n - auPrix) * prixLot * (1 + surcout);
}

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

function meilleursPlans(q, offre, p, profondeur, surcout) {
  let best = null, sansSurplus = null;
  const mieux = (a, b) => !b || a.cout < b.cout - 1e-9 || (Math.abs(a.cout - b.cout) < 1e-9 && a.nbLots < b.nbLots);
  const cout = (t, n) => n ? coutLots(t, n, offre[t], profondeur[t] ?? 0, surcout) : 0;
  const max = (t, reste) => dispo(offre, t) ? Math.ceil(reste / t) : 0;

  for (let n1000 = 0; n1000 <= max(1000, q); n1000++) {
    const r1000 = Math.max(0, q - 1000 * n1000);
    for (let n100 = 0; n100 <= max(100, r1000); n100++) {
      const r100 = Math.max(0, r1000 - 100 * n100);
      // Le coût en fonction de n10 est linéaire par morceaux : le minimum est sur une cassure (profondeur des
      // lots x10, profondeur des lots x1, besoin couvert sans x1, besoin dépassé). On ne teste que celles-là :
      // des milliers d'unités ne font plus des milliers d'essais.
      for (const n10 of candidatsX10(r100, max(10, r100), profondeur, dispo(offre, 1))) {
        const n1 = Math.max(0, r100 - 10 * n10);
        if (n1 > 0 && !dispo(offre, 1)) continue;

        const brut = cout(1000, n1000) + cout(100, n100) + cout(10, n10) + cout(1, n1);
        const achete = 1000 * n1000 + 100 * n100 + 10 * n10 + n1;
        const surplus = achete - q;
        const credit = valeurSurplus(surplus, offre, brut / achete, p);
        const plan = { lots: { 1: n1, 10: n10, 100: n100, 1000: n1000 }, achete, surplus, coutBrut: brut, cout: brut - credit, nbLots: n1000 + n100 + n10 + n1 };

        if (mieux(plan, best)) best = plan;
        if (surplus === 0 && mieux(plan, sansSurplus)) sansSurplus = plan;
      }
    }
  }
  return { best, sansSurplus };
}

function candidatsX10(r, max, profondeur, avecX1) {
  const c = new Set([0, max]);
  const ajoute = x => { for (const v of [Math.floor(x), Math.ceil(x)]) for (const d of [-1, 0, 1]) { const n = v + d; if (n >= 0 && n <= max) c.add(n); } };
  ajoute(r / 10);                                                         // plus besoin de x1 / début du surplus
  if (Number.isFinite(profondeur[10])) ajoute(profondeur[10]);           // les x10 deviennent plus chers
  if (avecX1 && Number.isFinite(profondeur[1])) ajoute((r - profondeur[1]) / 10); // les x1 deviennent plus chers
  return [...c].sort((a, b) => a - b);
}

function choisir({ best, sansSurplus }, p) {
  if (!sansSurplus || best.surplus === 0) return best;
  return best.cout < sansSurplus.cout * (1 - p.gainMinSurplus) ? best : sansSurplus;
}

// Cache : un même besoin avec les mêmes prix et réglages n'est calculé qu'une fois
// (l'onglet Données et le plan de scan refont souvent les mêmes calculs).
const cache = new Map();
export function planAchat(q, offre, p) {
  const cle = `${q}|${offre?.[1]}|${offre?.[10]}|${offre?.[100]}|${offre?.[1000]}|${JSON.stringify(p.profondeur)}|${p.surcout}|${p.revalorisationSurplus}|${p.gainMinSurplus}|${p.ecartAlerte}|${p.taxeVente}`;
  if (cache.has(cle)) return cache.get(cle);
  const r = calculerPlanAchat(q, offre, p);
  if (cache.size > 20000) cache.clear();
  cache.set(cle, r);
  return r;
}

function calculerPlanAchat(q, offre, p) {
  if (q <= 0) return { q, lots: { 1: 0, 10: 0, 100: 0, 1000: 0 }, achete: 0, surplus: 0, coutBrut: 0, cout: 0, nbLots: 0, coutOptimiste: 0, ecart: 0, alerte: false };
  if (prixUnitaireMin(offre) == null) return null; // aucun prix connu

  const prudent = choisir(meilleursPlans(q, offre, p, p.profondeur, p.surcout), p);
  const inf = { 1: Infinity, 10: Infinity, 100: Infinity, 1000: Infinity };
  const optimiste = choisir(meilleursPlans(q, offre, p, inf, 0), p);
  const ecart = optimiste.cout > 0 ? prudent.cout / optimiste.cout - 1 : 0;

  return {
    q,
    ...prudent,
    prixUnitaire: prudent.cout / q,
    coutOptimiste: optimiste.cout,
    ecart,
    alerte: ecart > p.ecartAlerte,
  };
}
