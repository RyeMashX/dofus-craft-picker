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

test('lots : besoin de 2 → x1, le x10 ne fait gagner que 14 % (seuil 20 %)', () => {
  const r = planAchat(2, etoffe, p);
  assert.deepEqual(r.lots, { 1: 2, 10: 0, 100: 0, 1000: 0 });
  assert.equal(r.cout, 5748);
});

test('lots : besoin de 2, x10 à peine moins cher → on reste en x1', () => {
  const r = planAchat(2, { 1: 2600, 10: 21000 }, p);
  assert.deepEqual(r.lots, { 1: 2, 10: 0, 100: 0, 1000: 0 });
});

test('lots : besoin de 7 → 7 x1, le x10 avec surplus ne fait gagner que 19 % (seuil 20 %)', () => {
  const r = planAchat(7, etoffe, p);
  assert.deepEqual(r.lots, { 1: 7, 10: 0, 100: 0, 1000: 0 });
  assert.equal(r.cout, 20118);
  assert.equal(r.risque, 'faible');
});

test('lots : besoin de 150 → 15 x10 ; trois coûts, risque fort, coût réaliste entre standard et pessimiste', () => {
  const r = planAchat(150, etoffe, p);
  assert.deepEqual(r.lots, { 1: 0, 10: 15, 100: 0, 1000: 0 });
  assert.equal(r.coutOptimiste, 344235);
  assert.equal(r.coutStandard, 344235);
  assert.equal(Math.round(r.coutPessimiste), 766025);          // 15 lots : +20 % par lot, plafond ×3
  assert.equal(Math.round(r.cout), Math.round(344235 + (766025 - 344235) / 3));
  assert.equal(r.risque, 'fort');
});

test('lots : bandeaux (x1 10 000, x10 300 000), 138 → pas 138 x1 : x10 et quelques x1, risque fort', () => {
  const r = planAchat(138, { 1: 10000, 10: 300000 }, p);
  assert.ok(r.lots[1] <= p.lotsCredibles && r.lots[10] >= 12);
  assert.equal(r.coutOptimiste, 1380000);
  assert.ok(r.coutStandard > 3.5e6 && r.cout > r.coutStandard);
  assert.equal(r.risque, 'fort');
  assert.equal(planAchat(3, { 1: 10000, 10: 300000 }, p).risque, 'faible');
});

test('lots : que du x1 pour 138 → pénurie possible, risque fort, coût réaliste bien au-dessus du prix affiché', () => {
  const r = planAchat(138, { 1: 10000 }, p);
  assert.equal(r.penurie, true);
  assert.equal(r.risque, 'fort');
  assert.ok(r.cout > 2e6);
});

test('lots : la revente du surplus ne rapporte jamais plus que son prix d\'achat', () => {
  const r = planAchat(1, { 1: 10000, 10: 20000 }, p);
  assert.ok(r.cout > 0);
});

test('lots : pas de x1 affiché, besoin de 4 → un x10', () => {
  const r = planAchat(4, { 10: 1000 }, p);
  assert.deepEqual(r.lots, { 1: 0, 10: 1, 100: 0, 1000: 0 });
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

test('marge : taxe de 2 %, FM estimée déduite (sans FM si inclureFm est coupé)', () => {
  const item = { nom: 'Test', volumeMois: 90, prixVente: 1000000, coutFm: 100000, recette: [{ id: 'r', nom: 'R', qte: 1 }] };
  const ev = evaluerItem(item, { r: { 1: 600000 } }, p, 1);
  assert.equal(ev.marge, 980000 - 600000 - 100000);
  assert.ok(ev.eligible);
  const sansFm = evaluerItem(item, { r: { 1: 600000 } }, { ...p, inclureFm: false }, 1);
  assert.equal(sansFm.marge, 980000 - 600000);
});

// Ton exemple : 30 M, soit 6 items à 25 %, soit 12 items à 30 %.
function exempleBudget() {
  const pp = { ...p, hausseParLot: 0, lotsCredibles: Infinity };
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

test('lots : x1000 retenu pour un gros besoin quand il est le moins cher', () => {
  const pepite = { 1: 120, 10: 1150, 100: 11000, 1000: 90000 };
  const r = planAchat(2000, pepite, p);
  assert.equal(r.lots[1000], 2);
  assert.equal(r.surplus, 0);
});
