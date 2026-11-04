import { evaluerItem, maxCrafts } from './marge.js';

// Répartition d'un budget entre items.
// Pour chaque item on peut faire 0..maxCrafts crafts. On maximise :
//     score = marge totale − coutEffortParCraft × nombre total de crafts
// sous la contrainte capital total ≤ budget. Le budget n'a pas à être dépensé en entier.
// Résolution exacte par sac à dos "par groupes" sur un budget découpé en pas de `pasBudget`.

export function optionsItem(item, offres, p) {
  const opts = [];
  for (let n = 1; n <= maxCrafts(item.volumeMois, p); n++) {
    const ev = evaluerItem(item, offres, p, n);
    if (!ev.eligible) continue;
    const score = ev.marge - n * p.coutEffortParCraft;
    if (score > 0) opts.push({ ...ev, score });
  }
  return opts;
}

export function allouer(items, offres, budget, p) {
  const nbPas = Math.floor(budget / p.pasBudget);
  // dp[b] = meilleure sélection avec au plus b pas de budget
  let dp = Array.from({ length: nbPas + 1 }, () => ({ score: 0, choix: [] }));

  for (const item of items) {
    const opts = optionsItem(item, offres, p);
    if (!opts.length) continue;
    const suivant = dp.slice();
    for (const o of opts) {
      const c = Math.ceil(o.capital / p.pasBudget);
      for (let b = c; b <= nbPas; b++) {
        const cand = dp[b - c].score + o.score;
        if (cand > suivant[b].score) suivant[b] = { score: cand, choix: [...dp[b - c].choix, o] };
      }
    }
    dp = suivant;
  }

  const best = dp[nbPas];
  const capital = best.choix.reduce((s, o) => s + o.capital, 0);
  const marge = best.choix.reduce((s, o) => s + o.marge, 0);
  const crafts = best.choix.reduce((s, o) => s + o.n, 0);
  return {
    choix: best.choix, score: best.score,
    capital, marge, crafts,
    rendement: capital ? marge / capital : 0,
    reste: budget - capital,
  };
}
