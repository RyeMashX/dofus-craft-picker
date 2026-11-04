import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARAMS as p } from '../src/params.js';
import {
  JOUR, creerBase, majVolume, majPrixItem, majPrixMoyenItem, majRessource, majPrixMoyenRessource,
  fraicheur, exporter, importer,
} from '../src/base.js';
import { itemsFocus, estimerItem, potentiel, baseEvaluation } from '../src/entonnoir.js';

const cat = JSON.parse(readFileSync(new URL('../data/catalogue.json', import.meta.url)));
const T0 = Date.UTC(2026, 10, 4);
const focus = itemsFocus(cat, p);
const it = focus.find(i => i.metier === 'Bijoutier');
const autre = focus.find(i => i.metier === 'Tailleur');

test('fraîcheur : volume valable 14 jours', () => {
  const b = majVolume(creerBase(), 1, 80, T0);
  assert.equal(fraicheur(b.items[1].volume, 14, T0 + 13 * JOUR), 'frais');
  assert.equal(fraicheur(b.items[1].volume, 14, T0 + 15 * JOUR), 'perime');
  assert.equal(fraicheur(undefined, 14, T0), 'absent');
});

test('base : export / import', () => {
  const b = majRessource(creerBase(), 22247, { 1: 2874, 10: 22949, 100: 700012 }, T0);
  assert.deepEqual(importer(exporter(b)), b);
  assert.throws(() => importer('{"a":1}'));
});

test('focus : 364 items niveau 200 craftables', () => {
  assert.equal(focus.length, 364);
});

test('estimation : prix moyens seuls → précision "moyen", puis "scan" une fois tout relevé', () => {
  const b = creerBase();
  majPrixMoyenItem(b, it.id, 3000000, T0);
  for (const r of it.recette) majPrixMoyenRessource(b, r.id, 1000, T0);
  let e = estimerItem(it, b, p);
  assert.equal(e.precision, 'moyen');
  const cout = it.recette.reduce((s, r) => s + r.qte * 1000, 0);
  assert.equal(e.cout, cout);

  majPrixItem(b, it.id, [2900000], T0);
  for (const r of it.recette) majRessource(b, r.id, { 1: 1000 }, T0);
  e = estimerItem(it, b, p);
  assert.equal(e.precision, 'scan');
});

test('potentiel : 0 à 0 %, 0,5 au seuil de 25 %, 1 à 50 %', () => {
  assert.equal(potentiel(0, p), 0);
  assert.equal(potentiel(0.25, p), 0.5);
  assert.equal(potentiel(0.8, p), 1);
  assert.equal(potentiel(null, p), 0.5);
});

test("base d'évaluation : items utilisables (jaune toléré, avertissement si pas prêts)", () => {
  const b = creerBase();
  majVolume(b, it.id, 90, T0);
  majPrixMoyenItem(b, it.id, 3000000, T0);
  for (const r of it.recette) majPrixMoyenRessource(b, r.id, 1000, T0);
  const vide = baseEvaluation(cat, b, p, T0);
  assert.equal(vide.items.length, 0); // prix moyens seuls (orange) : inutilisable

  majPrixItem(b, it.id, [3000000], T0);
  for (const r of it.recette) majRessource(b, r.id, { 1: 1000 }, T0);
  const ok = baseEvaluation(cat, b, p, T0);
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].avertissement, null); // tout vert : prêt

  const cinq = baseEvaluation(cat, b, p, T0 + 5 * JOUR); // ressources jaunes (> 3 j), prix encore vert
  assert.equal(cinq.items.length, 1);
  assert.match(cinq.items[0].avertissement, /ressources à risque/);

  const huit = baseEvaluation(cat, b, p, T0 + 8 * JOUR); // ressources orange (> 7 j)
  assert.equal(huit.items.length, 0);
});
