import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMS } from '../src/params.js';
import { JOUR, creerBase, majVolume, majPrixItem, majPrixMoyenItem, majRessource, majPrixMoyenRessource } from '../src/base.js';
import { calculerPlan, organiser, tacheFaite } from '../src/plan.js';

const T = Date.UTC(2026, 10, 4);
const p = { ...PARAMS, tempsScan: { volume: 10, prixItem: 10, ressource: 10 }, metiers: { Bijoutier: 200 } };
// mini catalogue : 3 anneaux niveau 200 ; A et B partagent la ressource 100
const cat = {
  items: [
    { id: 1, nom: 'Anneau A', niveau: 200, type: 'Anneau', metier: 'Bijoutier', recette: [{ id: 100, qte: 1 }, { id: 101, qte: 1 }] },
    { id: 2, nom: 'Anneau B', niveau: 200, type: 'Anneau', metier: 'Bijoutier', recette: [{ id: 100, qte: 1 }, { id: 102, qte: 1 }] },
    { id: 3, nom: 'Écharpe C', niveau: 200, type: 'Cape', metier: 'Bijoutier', recette: [{ id: 103, qte: 1 }] },
  ],
  ressources: {
    100: { id: 100, nom: 'Étoffe', niveau: 200, type: 'Étoffe' }, 101: { id: 101, nom: 'Aile', niveau: 190, type: 'Aile' },
    102: { id: 102, nom: 'Bois', niveau: 180, type: 'Bois' }, 103: { id: 103, nom: 'Os', niveau: 170, type: 'Os' },
  },
};
function baseExemple() {
  const b = creerBase();
  for (const [id, vol, pm] of [[1, 300, 2e6], [2, 90, 2e6], [3, 100, 1e6]]) { majVolume(b, id, vol, T - 10 * JOUR); majPrixMoyenItem(b, id, pm, T); }
  for (const id of [100, 101, 102, 103]) majPrixMoyenRessource(b, id, 100000, T);
  return b;
}

test('plan : le craft vise d\'abord l\'item qui rapporte le plus par scan', () => {
  const plan = calculerPlan(cat, baseExemple(), p, 0.5, T, 1); // 30 s → 3 scans, tout en craft
  const cles = plan.taches.map(t => `${t.kind}:${t.id}`).sort();
  assert.deepEqual(cles, ['prixItem:1', 'ressource:100', 'ressource:101']); // A : 300 ventes
  assert.equal(plan.pretsAvant, 0);
  assert.equal(plan.pretsApres, 1);
});

test('plan : une ressource partagée ne compte qu\'une fois', () => {
  const plan = calculerPlan(cat, baseExemple(), p, 50 / 60, T, 1); // 5 scans → A (3) + B (2 : la 100 est déjà prévue)
  assert.equal(plan.pretsApres, 2);
  assert.equal(plan.taches.length, 5);
});

test('plan : l\'entretien prend le reste, données les plus vieilles d\'abord', () => {
  const b = baseExemple();
  majVolume(b, 3, 100, T - 70 * JOUR); // volume orange
  const plan = calculerPlan(cat, b, p, 2, T, 0.25); // 12 scans, dont 3 au plus pour le craft
  assert.ok(plan.taches.some(t => t.raison === 'entretien' && t.kind === 'volume' && t.id === 3));
  assert.ok(plan.secondes <= 120);
  // avec un seul scan, l'entretien prend une donnée de l'item qui vend le plus (A, 300 ventes)
  // ou la ressource partagée par A et B, pas le volume de C
  const court = calculerPlan(cat, b, p, 10 / 60, T, 0);
  assert.ok(['ressource:100', 'prixItem:1'].includes(court.taches.map(t => `${t.kind}:${t.id}`)[0]));
});

test('plan : rien à faire quand tout est vert', () => {
  const b = creerBase();
  for (const id of [1, 2, 3]) { majVolume(b, id, 100, T); majPrixItem(b, id, [3e6], T); }
  for (const id of [100, 101, 102, 103]) majRessource(b, id, { 1: 1000 }, T);
  const plan = calculerPlan(cat, b, p, 10, T);
  assert.equal(plan.taches.length, 0);
  assert.equal(plan.pretsAvant, 3);
});

test('organiser : HDV Équipements puis Ressources, petites catégories fusionnées, tri Dofus', () => {
  const plan = calculerPlan(cat, baseExemple(), p, 5, T);
  const h = organiser(plan, cat);
  assert.deepEqual(h.map(x => x.hdv), ['equipements', 'ressources']);
  assert.deepEqual(h[0].groupes[0].categories, ['Anneau', 'Cape']);
  assert.equal(h[0].groupes[0].lignes.find(l => l.id === 1).kinds.join('+'), 'prixItem');
  const r = h[1].groupes;
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].categories, ['Aile', 'Bois', 'Étoffe', 'Os']); // catégories : É rangé avec les E
  assert.deepEqual([r[0].niveauMin, r[0].niveauMax], [170, 200]);
});

test('tâche faite : relevé postérieur à la création du plan', () => {
  const b = baseExemple();
  assert.equal(tacheFaite('ressource', 100, b, T), false);
  majRessource(b, 100, { 1: 5 }, T + 1000);
  assert.equal(tacheFaite('ressource', 100, b, T), true);
});

test('plan : un item exclu disparaît, un item en vente n\'est plus préparé pour le craft', async () => {
  const { exclure } = await import('../src/statut.js');
  const { ajouterVente } = await import('../src/ventes.js');
  const b = baseExemple();
  exclure(b, 1, null, T);
  let plan = calculerPlan(cat, b, p, 10, T, 1);
  assert.ok(!plan.taches.some(t => t.kind !== 'ressource' && t.id === 1));
  const b2 = baseExemple();
  ajouterVente(b2, { id: 1, statut: 'valide', prix: 3e6 });
  plan = calculerPlan(cat, b2, p, 0.5, T, 1); // 3 scans de craft : A (en vente) ne doit pas être visé
  assert.ok(!plan.taches.some(t => t.kind === 'prixItem' && t.id === 1));
});

test('statut : exclusion datée qui expire', async () => {
  const { exclure, estExclu } = await import('../src/statut.js');
  const b = creerBase();
  exclure(b, 5, T + 2 * JOUR, T);
  assert.equal(estExclu(b, 5, T + JOUR), true);
  assert.equal(estExclu(b, 5, T + 3 * JOUR), false);
});

test('organiser : une ressource consommable (potion…) va dans un HDV Consommables, traité en dernier', () => {
  const cat2 = { ...cat, ressources: { ...cat.ressources, 104: { id: 104, nom: 'Potion Étoilée', niveau: 200, type: 'Potion' } } };
  const h = organiser({ taches: [{ kind: 'ressource', id: 104 }, { kind: 'ressource', id: 101 }, { kind: 'prixItem', id: 1 }] }, cat2);
  assert.deepEqual(h.map(x => x.hdv), ['equipements', 'ressources', 'consommables']);
  assert.deepEqual(h[2].groupes[0].lignes.map(l => l.nom), ['Potion Étoilée']);
});
