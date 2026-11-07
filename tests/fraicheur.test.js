import test from 'node:test';
import assert from 'node:assert/strict';
import { JOUR, creerBase, majVolume, majPrixItem, majPrixMoyenItem, majRessource, majPrixMoyenRessource } from '../src/base.js';
import { niveauVolume, niveauPrixItem, niveauRessource, etatItem, compareDofus } from '../src/fraicheur.js';

const T = Date.UTC(2026, 10, 4);

test('fraîcheur : volume vert < 1 mois, jaune < 2 mois, orange au-delà', () => {
  const b = creerBase();
  assert.equal(niveauVolume(b.items[1], T), 'noir');
  majVolume(b, 1, 80, T - 20 * JOUR); assert.equal(niveauVolume(b.items[1], T), 'vert');
  majVolume(b, 1, 80, T - 40 * JOUR); assert.equal(niveauVolume(b.items[1], T), 'jaune');
  majVolume(b, 1, 80, T - 70 * JOUR); assert.equal(niveauVolume(b.items[1], T), 'orange');
});

test('fraîcheur : prix moyen seul = orange ; annonces 1 / 2 semaines', () => {
  const b = creerBase();
  majPrixMoyenItem(b, 1, 1e6, T); assert.equal(niveauPrixItem(b.items[1], T), 'orange');
  majPrixItem(b, 1, [1e6], T - 5 * JOUR); assert.equal(niveauPrixItem(b.items[1], T), 'vert');
  majPrixItem(b, 1, [1e6], T - 10 * JOUR); assert.equal(niveauPrixItem(b.items[1], T), 'jaune');
  majPrixItem(b, 1, [1e6], T - 15 * JOUR); assert.equal(niveauPrixItem(b.items[1], T), 'orange');
  majPrixMoyenRessource(b, 9, 100, T); assert.equal(niveauRessource(b.ressources[9], T), 'orange');
  majRessource(b, 9, { 1: 100 }, T - 2 * JOUR); assert.equal(niveauRessource(b.ressources[9], T), 'vert');
  majRessource(b, 9, { 1: 100 }, T - 5 * JOUR); assert.equal(niveauRessource(b.ressources[9], T), 'jaune');
  majRessource(b, 9, { 1: 100 }, T - 8 * JOUR); assert.equal(niveauRessource(b.ressources[9], T), 'orange');
});

test('état : prêt avec volume jaune et 2 ressources jaunes, pas 3 ; utilisable avec du jaune partout', () => {
  const it = { id: 1, recette: [10, 11, 12, 13].map(id => ({ id, qte: 1 })) };
  const b = creerBase();
  majVolume(b, 1, 80, T - 40 * JOUR);
  majPrixItem(b, 1, [1e6], T);
  majRessource(b, 10, { 1: 1 }, T); majRessource(b, 11, { 1: 1 }, T);
  majRessource(b, 12, { 1: 1 }, T - 5 * JOUR); majRessource(b, 13, { 1: 1 }, T - 5 * JOUR);
  assert.equal(etatItem(it, b, T).pret, true);
  majRessource(b, 11, { 1: 1 }, T - 5 * JOUR);
  assert.equal(etatItem(it, b, T).pret, false);
  assert.equal(etatItem(it, b, T).utilisable, true);
  majPrixItem(b, 1, [1e6], T - 10 * JOUR); // prix jaune : pas prêt mais utilisable
  assert.equal(etatItem(it, b, T).utilisable, true);
  majRessource(b, 10, { 1: 1 }, T - 8 * JOUR); // une ressource orange : inutilisable
  assert.equal(etatItem(it, b, T).utilisable, false);
});

test('tri Dofus : les accents après le z', () => {
  const noms = ['Écorce', 'Bois', 'Zébu', 'Aile', 'Étoffe', 'Œil', 'Âme', 'Zinc'];
  assert.deepEqual([...noms].sort(compareDofus), ['Aile', 'Bois', 'Zinc', 'Zébu', 'Âme', 'Écorce', 'Étoffe', 'Œil']);
});

import { compareCategorie, hdvDe } from '../src/fraicheur.js';
test('ordre des catégories : lettre accentuée rangée avec sa lettre de base, après les non accentuées', () => {
  const cats = ['Œil', 'Os', 'Oreille', 'Étoffe', 'Écorce', 'Épée', 'Fleur', 'Aile', 'Œuf', 'Minerai', 'Vêtement'];
  assert.deepEqual([...cats].sort(compareCategorie), ['Aile', 'Écorce', 'Épée', 'Étoffe', 'Fleur', 'Minerai', 'Oreille', 'Os', 'Œil', 'Œuf', 'Vêtement']);
  // une catégorie en E non accentuée passe avant les accentuées
  assert.ok(compareCategorie('Essence', 'Écorce') < 0);
});
test('HDV d\'une ressource : équipements, consommables (potion…) ou ressources', () => {
  const eq = new Set(['Épée', 'Anneau']);
  assert.equal(hdvDe('Épée', eq), 'equipements');
  assert.equal(hdvDe('Potion', eq), 'consommables');
  assert.equal(hdvDe('Friandise', eq), 'consommables');
  assert.equal(hdvDe('Minerai', eq), 'ressources');
});
