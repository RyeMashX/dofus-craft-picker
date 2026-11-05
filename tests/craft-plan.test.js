import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMS } from '../src/params.js';
import { JOUR, creerBase, majVolume, majPrixItem, majRessource } from '../src/base.js';
import { viables, recommander, evaluerPlan, confiance, offresUtilisables } from '../src/craft-plan.js';
import { exclure } from '../src/statut.js';
import { ajouterVente } from '../src/ventes.js';

const T = Date.now();
const p = { ...PARAMS, metiers: { Bijoutier: 200 }, profondeur: { 1: Infinity, 10: Infinity, 100: Infinity, 1000: Infinity } };
// A : cible (rendement ≈ 60 %), B : acceptable (≈ 18 %), C : sous 15 %. A et B partagent la ressource 100.
const cat = {
  items: [
    { id: 1, nom: 'Anneau A', niveau: 200, type: 'Anneau', metier: 'Bijoutier', recette: [{ id: 100, qte: 6 }, { id: 101, qte: 1 }] },
    { id: 2, nom: 'Anneau B', niveau: 200, type: 'Anneau', metier: 'Bijoutier', recette: [{ id: 100, qte: 6 }, { id: 102, qte: 1 }] },
    { id: 3, nom: 'Anneau C', niveau: 200, type: 'Anneau', metier: 'Bijoutier', recette: [{ id: 103, qte: 1 }] },
  ],
  ressources: { 100: { id: 100, nom: 'Étoffe', type: 'Étoffe' }, 101: { id: 101, nom: 'Aile', type: 'Aile' }, 102: { id: 102, nom: 'Bois', type: 'Bois' }, 103: { id: 103, nom: 'Os', type: 'Os' } },
};
function base() {
  const b = creerBase();
  for (const [id, vol, prix] of [[1, 120, 1_632_653], [2, 90, 1_204_082], [3, 90, 1_100_000]]) { majVolume(b, id, vol, T); majPrixItem(b, id, [prix + 1], T); }
  majRessource(b, 100, { 1: 100_000, 10: 1_000_000 }, T);      // 6 unités → 6 × x1 = 600 000
  majRessource(b, 101, { 1: 400_000 }, T);
  majRessource(b, 102, { 1: 400_000 }, T);
  majRessource(b, 103, { 1: 1_000_000 }, T);
  return b;
}

test('viables : cible, acceptable, et sous 15 % écarté', () => {
  const { liste } = viables(cat, base(), p, T);
  assert.deepEqual(liste.map(v => [v.id, v.niveau]), [[1, 'cible'], [2, 'acceptable']]);
});

test('viables : exclu absent ; en vente listé mais pas recommandé', () => {
  const b = base();
  exclure(b, 2, null, T);
  ajouterVente(b, { id: 1, prix: 2e6 });
  const { liste, offres } = viables(cat, b, p, T);
  assert.deepEqual(liste.map(v => v.id), [1]);
  assert.equal(liste[0].enVente, 1);
  assert.deepEqual(recommander(liste, offres, 30e6, p), {});
});

test('recommandation : seulement les cibles, au plus 1 jour de vente', () => {
  const { liste, offres } = viables(cat, base(), p, T);
  assert.deepEqual(recommander(liste, offres, 30e6, p), { 1: 4 }); // 120 ventes / 30 j
});

test('plan modifié : achats consolidés (ressource partagée additionnée) et marge réelle sans effort', () => {
  const { liste, offres } = viables(cat, base(), p, T);
  const r = evaluerPlan({ 1: 2, 2: 1 }, liste, offres, cat, p);
  const etoffe = r.achats.find(a => a.id === 100);
  assert.equal(etoffe.q, 18);                                // 2 × 6 + 1 × 6
  assert.deepEqual(etoffe.plan.lots, { 1: 8, 10: 1, 100: 0, 1000: 0 }); // 1 800 000 au lieu de 18 × 100 000
  assert.equal(r.crafts, 3);
  assert.equal(Math.round(r.capital), 1_800_000 + 2 * 400_000 + 400_000);
  assert.equal(Math.round(r.marge), Math.round(r.revenu - r.capital));   // aucun coût d'effort retranché
});

test('confiance : 1 si tout est vert, plus basse avec un prix jaune', () => {
  const b = base();
  const offres = offresUtilisables(b, T);
  assert.equal(confiance(cat.items[0], b, offres, p, T), 1);
  majPrixItem(b, 1, [1_632_654], T - 10 * JOUR);
  assert.ok(Math.abs(confiance(cat.items[0], b, offres, p, T) - (1 - 0.35 * 0.4)) < 1e-9);
});

test('plan figé : un item devenu non viable reste dans le plan, signalé', () => {
  const b = base();
  majPrixItem(b, 1, [1_632_654], T - 20 * JOUR); // prix orange : A n'est plus viable
  const { liste, offres } = viables(cat, b, p, T);
  assert.ok(!liste.some(v => v.id === 1));
  const r = evaluerPlan({ 1: 2 }, liste, offres, cat, p, b);
  assert.equal(r.lignes.length, 1);
  assert.equal(r.lignes[0].raison, 'données périmées');
  assert.ok(r.marge > 0);
});
