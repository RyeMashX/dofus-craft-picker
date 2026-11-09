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
  const nbPas = Math.max(0, Math.floor(budget / p.pasBudget));
  // dp[b] = meilleur score avec au plus b pas de budget ; pour chaque item, l'option retenue à chaque b
  // (on remonte ensuite ces choix au lieu de recopier des listes à chaque case : beaucoup plus rapide)
  let dp = new Float64Array(nbPas + 1);
  const etapes = [];
  for (const item of items) {
    const opts = optionsItem(item, offres, p).map(o => ({ o, c: Math.ceil(o.capital / p.pasBudget) }));
    if (!opts.length) continue;
    const suivant = dp.slice(), pris = new Int16Array(nbPas + 1).fill(-1);
    opts.forEach(({ o, c }, k) => {
      for (let b = c; b <= nbPas; b++) {
        const cand = dp[b - c] + o.score;
        if (cand > suivant[b]) { suivant[b] = cand; pris[b] = k; }
      }
    });
    etapes.push({ opts, pris });
    dp = suivant;
  }
  const choix = [];
  for (let e = etapes.length - 1, b = nbPas; e >= 0; e--) {
    const k = etapes[e].pris[b];
    if (k >= 0) { const { o, c } = etapes[e].opts[k]; choix.unshift(o); b -= c; }
  }
  const best = { score: dp[nbPas], choix };

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
