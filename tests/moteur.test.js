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

test('lots : besoin de 2 → x10 car 14 % moins cher que 2 × x1, même en revendant 8 unités', () => {
  const r = planAchat(2, etoffe, p);
  assert.deepEqual(r.lots, { 1: 0, 10: 1, 100: 0 });
  assert.equal(Math.round(r.cout), 4957);
});

test('lots : besoin de 2, x10 seulement 10 % moins cher → on reste en x1', () => {
  const r = planAchat(2, { 1: 2600, 10: 21000 }, p);
  assert.deepEqual(r.lots, { 1: 2, 10: 0, 100: 0 });
});

test('lots : besoin de 7 → un x10 et on revend le surplus', () => {
  const r = planAchat(7, etoffe, p);
  assert.deepEqual(r.lots, { 1: 0, 10: 1, 100: 0 });
  assert.equal(r.surplus, 3);
  assert.equal(Math.round(r.cout), 16202);
});

test('lots : besoin de 150 → 15 x10, 2 au prix affiché et 13 à +10 %', () => {
  const r = planAchat(150, etoffe, p);
  assert.deepEqual(r.lots, { 1: 0, 10: 15, 100: 0 });
  assert.equal(Math.round(r.cout), 374069);
  assert.equal(r.coutOptimiste, 344235);
  assert.equal(r.alerte, false);
});

test('lots : la revente du surplus ne rapporte jamais plus que son prix d\'achat', () => {
  const r = planAchat(1, { 1: 10000, 10: 20000 }, p);
  assert.ok(r.cout > 0);
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

test('vente : prix le plus bas ou moyenne des 3 plus bas, − 1 kama', () => {
  const prix = [118999999, 112999999, 119000000, 124400000];
  assert.equal(prixVenteEstime(prix, p).estime, 112999998);
  assert.equal(prixVenteEstime(prix, { ...p, modePrixVente: 'moy3' }).estime, 116999999 - 1);
});

test('max crafts = 1 jour de vente (60/mois → 2)', () => {
  assert.equal(maxCrafts(60, p), 2);
  assert.equal(maxCrafts(81, p), 2);
  assert.equal(maxCrafts(90, p), 3);
});

test('marge : taxe de 2 %, FM ignorée en phase initiale, comptée si inclureFm', () => {
  const item = { nom: 'Test', volumeMois: 90, prixVente: 1000000, coutFm: 100000, recette: [{ id: 'r', nom: 'R', qte: 1 }] };
  const ev = evaluerItem(item, { r: { 1: 600000 } }, p, 1);
  assert.equal(ev.marge, 980000 - 600000);
  assert.ok(ev.eligible);
  const avecFm = evaluerItem(item, { r: { 1: 600000 } }, { ...p, inclureFm: true }, 1);
  assert.equal(avecFm.marge, 980000 - 600000 - 100000);
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
