// Achat d'une quantité q d'une ressource à l'HDV, par lots de 1, 10 et 100.
//
// offre = { 1: prix du lot x1, 10: prix du lot x10, 100: prix du lot x100 }
// (une taille absente ou null = pas de lot affiché)
//
// Règle (cf. README) :
// - chaque taille de lot n'est garantie au prix affiché que pour `profondeur[taille]` lots ;
//   au-delà on compte chaque lot avec un surcoût (le prix remonte quand on vide la ligne) ;
// - si on achète plus que nécessaire, le surplus est revendu : on récupère une partie
//   de sa valeur (prix unitaire le plus bas × (1 − taxe) × revalorisationSurplus) ;
// - on teste toutes les combinaisons et on garde la moins chère ;
// - on calcule aussi le coût "optimiste" (profondeur infinie) : un gros écart = alerte.

export const TAILLES = [1, 10, 100];

export function coutLots(taille, n, prixLot, profondeur, surcout) {
  const auPrix = Math.min(n, profondeur);
  return auPrix * prixLot + (n - auPrix) * prixLot * (1 + surcout);
}

function dispo(offre, t) {
  return offre && offre[t] != null && offre[t] > 0;
}

// Prix unitaire le plus bas affiché (sert à valoriser le surplus)
export function prixUnitaireMin(offre) {
  const unitaires = TAILLES.filter(t => dispo(offre, t)).map(t => offre[t] / t);
  return unitaires.length ? Math.min(...unitaires) : null;
}

function meilleurPlan(q, offre, p, profondeur, surcout) {
  const uMin = prixUnitaireMin(offre);
  const max100 = dispo(offre, 100) ? Math.ceil(q / 100) : 0;
  let best = null;

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
      const credit = surplus * uMin * (1 - p.taxeVente) * p.revalorisationSurplus;
      const net = brut - credit;
      const nbLots = n100 + n10 + n1;

      if (!best || net < best.cout - 1e-9 || (Math.abs(net - best.cout) < 1e-9 && nbLots < best.nbLots)) {
        best = { lots: { 1: n1, 10: n10, 100: n100 }, achete, surplus, coutBrut: brut, cout: net, nbLots };
      }
    }
  }
  return best;
}

export function planAchat(q, offre, p) {
  if (q <= 0) return { q, lots: { 1: 0, 10: 0, 100: 0 }, achete: 0, surplus: 0, coutBrut: 0, cout: 0, nbLots: 0, coutOptimiste: 0, ecart: 0, alerte: false };
  if (prixUnitaireMin(offre) == null) return null; // aucun prix connu

  const prudent = meilleurPlan(q, offre, p, p.profondeur, p.surcout);
  const inf = { 1: Infinity, 10: Infinity, 100: Infinity };
  const optimiste = meilleurPlan(q, offre, p, inf, 0);
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
