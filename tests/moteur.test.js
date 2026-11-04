import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMS } from '../src/params.js';
import { planAchat } from '../src/lots.js';
import { coutCraft } from '../src/craft.js';
import { prixVenteEstime, evaluerItem, maxCrafts } from '../src/marge.js';
import { allouer } from '../src/allocation.js';

const p = PARAMS;
// Relevé réel du 04/11 : Étoffe sanglante, x1 2 874 / x10 22 949 / x100 700 012
const etoffe = { 1: 2874, 10: 22949, 100: 700012 };

test('lots : besoin de 2 → on prend du x1', () => {
  const r = planAchat(2, etoffe, p);
  assert.deepEqual(r.lots, { 1: 2, 10: 0, 100: 0 });
  assert.equal(r.cout, 5748);
});

test('lots : besoin de 7 → un x10 et on revend le surplus', () => {
  const r = planAchat(7, etoffe, p);
  assert.deepEqual(r.lots, { 1: 0, 10: 1, 100: 0 });
  assert.equal(r.surplus, 3);
  assert.ok(Math.abs(r.cout - 19575.497) < 0.01);
});

test('lots : besoin de 150 → 15 x10, mais au-delà de 3 lots on compte +25 % et on alerte', () => {
  const r = planAchat(150, etoffe, p);
  assert.deepEqual(r.lots, { 1: 0, 10: 15, 100: 0 });
  assert.equal(r.cout, 413082);
  assert.equal(r.coutOptimiste, 344235);
  assert.equal(r.alerte, true);
});

test('lots : pas de x1 affiché, besoin de 4 → un x10', () => {
  const r = planAchat(4, { 10: 1000 }, p);
  assert.deepEqual(r.lots, { 1: 0, 10: 1, 100: 0 });
});

test('lots : aucun prix → null', () => {
  assert.equal(planAchat(5, {}, p), null);
});

test('craft : quantités cumulées sur n crafts et ressource manquante signalée', () => {
  const recette = [{ id: 'e', nom: 'Étoffe sanglante', qte: 4 }, { id: 'x', nom: 'Inconnue', qte: 1 }];
  const c = coutCraft(recette, { e: etoffe }, 2, p);
  assert.equal(c.lignes[0].q, 8);
  assert.deepEqual(c.manquantes, ['Inconnue']);
});

test('vente : prix visé = moins chère avec jet correct − 1', () => {
  const v = prixVenteEstime([
    { prix: 112999999, correct: false },
    { prix: 118999999, correct: true },
    { prix: 124400000, correct: true },
  ], p);
  assert.equal(v.minTout, 112999999);
  assert.equal(v.estime, 118999998);
});

test('max crafts = 1 jour de vente (60/mois → 2)', () => {
  assert.equal(maxCrafts(60, p), 2);
  assert.equal(maxCrafts(81, p), 2);
  assert.equal(maxCrafts(90, p), 3);
});

test('marge : taxe de 2 % et coût de FM pris en compte', () => {
  const item = { nom: 'Test', volumeMois: 90, prixVente: 1000000, coutFm: 100000, recette: [{ id: 'r', nom: 'R', qte: 1 }] };
  const ev = evaluerItem(item, { r: { 1: 600000 } }, p, 1);
  assert.equal(ev.marge, 980000 - 600000 - 100000);
  assert.ok(ev.eligible);
});

// Ton exemple : 30 M, soit 6 items à 25 %, soit 12 items à 30 %.
function exempleBudget() {
  const pp = { ...p, profondeur: { 1: Infinity, 10: Infinity, 100: Infinity } };
  const items = [
    { id: 'A', nom: 'Item A', volumeMois: 180, prixVente: 6250000 / 0.98, recette: [{ id: 'ra', nom: 'RA', qte: 1 }] },
    { id: 'B', nom: 'Item B', volumeMois: 360, prixVente: 3250000 / 0.98, recette: [{ id: 'rb', nom: 'RB', qte: 1 }] },
  ];
  const offres = { ra: { 1: 5000000 }, rb: { 1: 2500000 } };
  return { pp, items, offres };
}

test('allocation : effort à 300 k/craft → 6 × A (moins de crafts)', () => {
  const { pp, items, offres } = exempleBudget();
  const r = allouer(items, offres, 30000000, pp);
  assert.equal(r.crafts, 6);
  assert.equal(r.choix[0].id, 'A');
});

test('allocation : effort ignoré → 12 × B (plus de marge brute)', () => {
  const { pp, items, offres } = exempleBudget();
  const r = allouer(items, offres, 30000000, { ...pp, coutEffortParCraft: 0 });
  assert.equal(r.crafts, 12);
  assert.ok(Math.abs(r.marge - 9000000) < 1);
});
