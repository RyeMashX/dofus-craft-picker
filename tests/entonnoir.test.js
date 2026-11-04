import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARAMS as p } from '../src/params.js';
import { creerBase, majVolume, majPrixItem, majRessource, fraicheur, exporter, importer } from '../src/base.js';
import { etatEntonnoir } from '../src/entonnoir.js';

const cat = JSON.parse(readFileSync(new URL('../data/catalogue.json', import.meta.url)));
const JOUR = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 4);

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

test('entonnoir : base vide → tous les items 200 craftables sont à relever (volume)', () => {
  const e = etatEntonnoir(cat, creerBase(), p, T0);
  assert.equal(e.focus, 364);
  assert.equal(e.volumesARelever.length, 364);
});

test('entonnoir : un item passe toutes les étapes', () => {
  const it = cat.items.find(i => i.niveau === 200 && i.metier === 'Bijoutier');
  const autre = cat.items.find(i => i.niveau === 200 && i.metier === 'Tailleur');
  let b = creerBase();
  majVolume(b, it.id, 90, T0);
  majVolume(b, autre.id, 30, T0); // trop faible

  let e = etatEntonnoir(cat, b, p, T0);
  assert.ok(e.prixARelever.some(i => i.id === it.id));
  assert.ok(e.ecartesVolume.some(i => i.id === autre.id));

  majPrixItem(b, it.id, [3000000, 2900000, 3100000], T0);
  e = etatEntonnoir(cat, b, p, T0);
  assert.ok(e.attenteRessources.some(i => i.id === it.id));
  assert.equal(e.ressources.length, it.recette.length);

  for (const r of it.recette) majRessource(b, r.id, { 1: 1000 }, T0);
  e = etatEntonnoir(cat, b, p, T0);
  const ev = [...e.eligibles, ...e.ecartesMarge].find(x => x.id === it.id);
  assert.ok(ev);
  const cout = it.recette.reduce((s, r) => s + 1000 * Math.min(r.qte, 3) + 1100 * Math.max(0, r.qte - 3), 0);
  assert.equal(Math.round(ev.coutCraft), cout);

  // 4 jours plus tard les ressources sont périmées, le volume non
  e = etatEntonnoir(cat, b, p, T0 + 4 * JOUR);
  assert.ok(e.prixARelever.some(i => i.id === it.id)); // prix item périmé (2 j) avant ressources
});
