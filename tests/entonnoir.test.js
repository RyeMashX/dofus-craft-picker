import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARAMS as p } from '../src/params.js';
import {
  JOUR, creerBase, majVolume, majPrixItem, majPrixMoyenItem, majRessource, majPrixMoyenRessource,
  fraicheur, exporter, importer,
} from '../src/base.js';
import { itemsFocus, estimerItem, potentiel, baseEvaluation } from '../src/entonnoir.js';
import { listesScan, listeVolumes, proximiteSeuil, planScan } from '../src/priorites.js';

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

test('base d\'évaluation : seulement les items entièrement scannés et frais', () => {
  const b = creerBase();
  majVolume(b, it.id, 90, T0);
  majPrixMoyenItem(b, it.id, 3000000, T0);
  for (const r of it.recette) majPrixMoyenRessource(b, r.id, 1000, T0);
  const vide = baseEvaluation(cat, b, p, T0);
  assert.equal(vide.eligibles.length + vide.ecartes.length, 0); // prix moyens ne suffisent pas

  majPrixItem(b, it.id, [3000000], T0);
  for (const r of it.recette) majRessource(b, r.id, { 1: 1000 }, T0);
  const ok = baseEvaluation(cat, b, p, T0);
  assert.equal(ok.eligibles.length + ok.ecartes.length, 1);

  const plusTard = baseEvaluation(cat, b, p, T0 + 4 * JOUR); // lots périmés (3 j)
  assert.equal(plusTard.eligibles.length + plusTard.ecartes.length, 0);
});

test('volumes : jamais relevé = prioritaire ; près du seuil plus urgent que loin', () => {
  assert.equal(proximiteSeuil(60, p), 1);
  assert.equal(proximiteSeuil(120, p), 0);
  const b = creerBase();
  majVolume(b, it.id, 62, T0);     // pile au seuil
  majVolume(b, autre.id, 300, T0); // très loin
  const l = listeVolumes(cat, b, p, T0 + 14 * JOUR); // les deux viennent d'expirer
  const a = l.find(x => x.id === it.id), c = l.find(x => x.id === autre.id);
  assert.equal(a.tag, 'urgent');    // 1 × 1,37
  assert.equal(c.tag, 'plus tard'); // 1 × 0,6 : à 300 ventes, il ne passera pas sous 60 en 2 semaines
  const jamais = l.find(x => x.volume == null);
  assert.equal(jamais.tag, 'urgent'); // jamais relevé : 1,5 × 1,0
});

test('prix items et ressources : priorité au rendement estimé', () => {
  const b = creerBase();
  majVolume(b, it.id, 90, T0);
  majVolume(b, autre.id, 90, T0);
  majPrixMoyenItem(b, it.id, 10000000, T0);   // très rentable
  majPrixMoyenItem(b, autre.id, 1000, T0);    // pas rentable
  for (const i of [it, autre]) for (const r of i.recette) majPrixMoyenRessource(b, r.id, 1000, T0);

  const l = listesScan(cat, b, p, T0);
  assert.equal(l.prixItems.length, 2);
  assert.equal(l.prixItems[0].id, it.id);
  assert.equal(l.prixItems[0].tag, 'urgent');
  assert.equal(l.prixItems[1].tag, 'plus tard');
  // ressources de l'item rentable devant celles de l'item non rentable
  const propres = new Set(it.recette.map(r => r.id));
  assert.ok(propres.has(l.ressources[0].id));
});

test('plan de scan : respecte le temps et ignore "plus tard"', () => {
  const b = creerBase();
  const l = listesScan(cat, b, p, T0); // base vide : 364 volumes à faire
  const plan = planScan(l, 10, p);
  assert.equal(plan.taches.length, 40); // 600 s / 15 s
  assert.ok(plan.taches.every(t => t.type === 'volume'));
  assert.equal(l.prixMoyens.items, 364);
});
