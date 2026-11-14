import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemsCraftables, versMoteur, ressourcesARelever } from '../src/catalogue.js';

const cat = JSON.parse(readFileSync(new URL('../data/catalogue.json', import.meta.url)));

test('catalogue : recette du Jugement de Thanatena conforme au jeu', () => {
  const j = cat.items.find(i => i.nom === 'Jugement de Thanatena');
  assert.equal(j.metier, 'Forgeron');
  assert.deepEqual(j.recette.map(r => r.qte), [1, 5000, 4, 4, 15, 25, 4, 2]);
});

test('métiers : Forgeron 190 → pas de Jugement de Thanatena (niv. 200), Forgeron 200 → oui', () => {
  const noms = itemsCraftables(cat, { Forgeron: 190 }).map(i => i.nom);
  assert.ok(!noms.includes('Jugement de Thanatena'));
  const forgeron200 = itemsCraftables(cat, { Forgeron: 200 }).map(i => i.nom);
  assert.ok(forgeron200.includes('Jugement de Thanatena'));
});

test('versMoteur : recette nommée', () => {
  const j = cat.items.find(i => i.nom === 'Jugement de Thanatena');
  const m = versMoteur(j, cat, { volumeMois: 81 });
  assert.equal(m.recette[1].nom, 'Reflet onirique');
  assert.equal(m.volumeMois, 81);
});

test('ressources à relever : triées par nombre d\'items concernés', () => {
  const liste = ressourcesARelever(itemsCraftables(cat), cat);
  for (let i = 1; i < liste.length; i++) assert.ok(liste[i - 1].items >= liste[i].items);
});
