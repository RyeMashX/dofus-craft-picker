import test from 'node:test';
import assert from 'node:assert/strict';
import { planAchat, valeurSurplus } from '../src/lots.js';
import { PARAMS } from '../src/params.js';

// Référence : énumération complète au prix affiché, pour vérifier que le raccourci du coût optimiste ne change rien
function reference(q, offre, p) {
  const ok = t => offre[t] != null && offre[t] > 0;
  const cout = (t, n) => n ? n * offre[t] : 0;
  const max = (t, r) => ok(t) ? Math.ceil(r / t) : 0;
  let best = null, sans = null;
  const mieux = (a, b) => !b || a.cout < b.cout - 1e-9 || (Math.abs(a.cout - b.cout) < 1e-9 && a.nbLots < b.nbLots);
  for (let a = 0; a <= max(1000, q); a++) { const ra = Math.max(0, q - 1000 * a);
    for (let b = 0; b <= max(100, ra); b++) { const rb = Math.max(0, ra - 100 * b);
      for (let c = 0; c <= max(10, rb); c++) { const d = Math.max(0, rb - 10 * c); if (d > 0 && !ok(1)) continue;
        const brut = cout(1000, a) + cout(100, b) + cout(10, c) + cout(1, d), achete = 1000 * a + 100 * b + 10 * c + d;
        const pl = { achete, surplus: achete - q, cout: brut - valeurSurplus(achete - q, offre, brut / achete, p), nbLots: a + b + c + d };
        if (mieux(pl, best)) best = pl; if (pl.surplus === 0 && mieux(pl, sans)) sans = pl; } } }
  return (!sans || best.surplus === 0) ? best : best.cout < sans.cout * (1 - p.gainMinSurplus) ? best : sans;
}

test('lots : le coût optimiste rapide = énumération complète, et O ≤ S ≤ réaliste ≤ P', () => {
  let graine = 7; const alea = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const u = 1000 + Math.floor(alea() * 50000);
    const offre = { 1: alea() < 0.85 ? Math.round(u * (0.9 + alea() * 0.4)) : null, 10: alea() < 0.85 ? Math.round(u * 10 * (0.8 + alea() * 0.4)) : null, 100: alea() < 0.6 ? Math.round(u * 100 * (0.75 + alea() * 0.4)) : null };
    if (!offre[1] && !offre[10] && !offre[100]) offre[1] = u;
    const q = 1 + Math.floor(alea() * 400);
    const r = planAchat(q, offre, PARAMS), ref = reference(q, offre, PARAMS);
    assert.ok(Math.abs(r.coutOptimiste - ref.cout) < 1e-6, `q=${q} ${JSON.stringify(offre)} : ${r.coutOptimiste} ≠ ${ref.cout}`);
    assert.ok(r.coutOptimiste <= r.coutStandard && r.coutStandard <= r.cout && r.cout <= r.coutPessimiste);
  }
});

test('lots : plusieurs milliers d\'unités se calculent vite', () => {
  const t = Date.now();
  for (let q = 1000; q < 6000; q += 37) planAchat(q, { 1: 5000, 10: 45000, 100: 420000 }, PARAMS);
  assert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);
});
