// Achat d'une quantité q d'une ressource à l'HDV, par lots de 1, 10 et 100.
//
// offre = { 1: prix du lot x1, 10: prix du lot x10, 100: prix du lot x100 }
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

export const TAILLES = [1, 10, 100];

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
  let best = s * unite;
  for (let k = 1; k <= Math.floor(s / 10) && paquet; k++) {
    best = Math.max(best, k * paquet + (s - 10 * k) * unite);
  }
  return best * (1 - p.taxeVente);
}

function meilleursPlans(q, offre, p, profondeur, surcout) {
  const max100 = dispo(offre, 100) ? Math.ceil(q / 100) : 0;
  let best = null, sansSurplus = null;
  const mieux = (a, b) => !b || a.cout < b.cout - 1e-9 || (Math.abs(a.cout - b.cout) < 1e-9 && a.nbLots < b.nbLots);

  for (let n100 = 0; n100 <= max100; n100++) {
    const reste100 = Math.max(0, q - 100 * n100);
    const max10 = dispo(offre, 10) ? Math.ceil(reste100 / 10) : 0;
    for (let n10 = 0; n10 <= max10; n10++) {
      const n1 = Math.max(0, reste100 - 10 * n10);
      if (n1 > 0 && !dispo(offre, 1)) continue;

      const brut =
        (n100 ? coutLots(100, n100, offre[100], profondeur[100] ?? 0, surcout) : 0) +
        (n10 ? coutLots(10, n10, offre[10], profondeur[10] ?? 0, surcout) : 0) +
        (n1 ? coutLots(1, n1, offre[1], profondeur[1] ?? 0, surcout) : 0);

      const achete = 100 * n100 + 10 * n10 + n1;
      const surplus = achete - q;
      const credit = valeurSurplus(surplus, offre, brut / achete, p);
      const plan = { lots: { 1: n1, 10: n10, 100: n100 }, achete, surplus, coutBrut: brut, cout: brut - credit, nbLots: n100 + n10 + n1 };

      if (mieux(plan, best)) best = plan;
      if (surplus === 0 && mieux(plan, sansSurplus)) sansSurplus = plan;
    }
  }
  return { best, sansSurplus };
}

function choisir({ best, sansSurplus }, p) {
  if (!sansSurplus || best.surplus === 0) return best;
  return best.cout < sansSurplus.cout * (1 - p.gainMinSurplus) ? best : sansSurplus;
}

export function planAchat(q, offre, p) {
  if (q <= 0) return { q, lots: { 1: 0, 10: 0, 100: 0 }, achete: 0, surplus: 0, coutBrut: 0, cout: 0, nbLots: 0, coutOptimiste: 0, ecart: 0, alerte: false };
  if (prixUnitaireMin(offre) == null) return null; // aucun prix connu

  const prudent = choisir(meilleursPlans(q, offre, p, p.profondeur, p.surcout), p);
  const inf = { 1: Infinity, 10: Infinity, 100: Infinity };
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
