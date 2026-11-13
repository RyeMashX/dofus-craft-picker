import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMS } from '../src/params.js';
import { creerBase, majVolume, majPrixItem, majRessource, majIndispo } from '../src/base.js';
import { lierSousRecettes, versMoteur, ingredients } from '../src/catalogue.js';
import { resoudre, achatOffres } from '../src/souscraft.js';
import { etatItem } from '../src/fraicheur.js';
import { viables, evaluerPlan, detailCraft } from '../src/craft-plan.js';
import { calculerPlan } from '../src/plan.js';

const T = Date.now();
const p = { ...PARAMS, metiers: { Forgeron: 200 }, hausseParLot: 0, tempsScan: { volume: 10, prixItem: 10, ressource: 10 } };
// Épée : 2 Alliage (200) + 1 Bois (101). Alliage = 3 Minerai (201) + 1 Minerai rare (202).
const catalogue = () => lierSousRecettes({
  items: [{ id: 1, nom: 'Épée', niveau: 200, type: 'Épée', metier: 'Forgeron', recette: [{ id: 200, qte: 2 }, { id: 101, qte: 1 }] }],
  ressources: {
    101: { id: 101, nom: 'Bois', type: 'Bois' },
    200: { id: 200, nom: 'Alliage', type: 'Alliage', recette: [{ id: 201, qte: 3 }, { id: 202, qte: 1 }] },
    201: { id: 201, nom: 'Minerai', type: 'Minerai' }, 202: { id: 202, nom: 'Minerai rare', type: 'Minerai' },
  },
});
function base(prixAlliage) {
  const b = creerBase();
  majVolume(b, 1, 300, T); majPrixItem(b, 1, [3_000_001], T);
  majRessource(b, 101, { 1: 100_000 }, T);
  majRessource(b, 201, { 1: 50_000 }, T);
  majRessource(b, 202, { 1: 100_000 }, T);   // craft d'un alliage : 3 × 50 000 + 100 000 = 250 000
  if (prixAlliage) majRessource(b, 200, { 1: prixAlliage }, T);
  return b;
}

test('sous-craft : on crafte seulement si c\'est au moins 5 % moins cher que d\'acheter', () => {
  const cat = catalogue();
  const r = versMoteur(cat.items[0], cat).recette[0];
  const o = b => achatOffres(Object.fromEntries(Object.entries(b.ressources).map(([id, x]) => [id, x.lots.valeurs])), p);
  assert.equal(resoudre(r, 2, o(base(400_000)), p).mode, 'craft');            // 500 000 au lieu de 800 000
  assert.equal(resoudre(r, 2, o(base(260_000)), p).mode, 'achat');            // 500 000 vs 520 000 : moins de 5 %
  const x = resoudre(r, 2, o(base(null)), p);                                // pas en vente : craft
  assert.equal(x.mode, 'craft'); assert.equal(x.cout, 500_000);
});

test('sous-craft : un alliage introuvable mais craftable laisse l\'item utilisable et chiffré', () => {
  const cat = catalogue(), b = base(null);
  majIndispo(b, 200, T);
  assert.equal(etatItem(cat.items[0], b, T).utilisable, true);
  const { liste } = viables(cat, b, p, T);
  assert.equal(liste.length, 1);
  assert.equal(Math.round(liste[0].cout), 600_000);                          // 2 alliages craftés + bois
  const d = detailCraft(cat.items[0], cat, b, p, 1, T);
  assert.equal(d.lignes[0].source, 'craft');
  assert.deepEqual(d.lignes[0].composants.map(c => [c.id, c.q]), [[201, 6], [202, 2]]);
});

test('sous-craft : la liste d\'achat remplace l\'alliage par ses composants, et le met à crafter', () => {
  const cat = catalogue(), b = base(400_000);
  const { liste, offres } = viables(cat, b, p, T);
  const ev = evaluerPlan({ 1: 3 }, liste, offres, cat, p, b);
  assert.deepEqual(ev.sousCrafts.map(s => [s.id, s.q]), [[200, 6]]);
  assert.deepEqual(ev.achats.map(a => [a.id, a.q]).sort((x, y) => x[0] - y[0]), [[101, 3], [201, 18], [202, 6]]);
  assert.equal(Math.round(ev.capital), 3 * 100_000 + 18 * 50_000 + 6 * 100_000);
});

test('sous-craft : le plan de scan relève l\'alliage et ses composants', () => {
  const cat = catalogue(), b = creerBase();
  majVolume(b, 1, 300, T); majPrixItem(b, 1, [3e6], T);
  majRessource(b, 101, { 1: 100_000 }, T);
  const plan = calculerPlan(cat, b, p, 10, T, 1, 0);
  const res = plan.taches.filter(t => t.kind === 'ressource').map(t => t.id).sort();
  assert.deepEqual(res, [200, 201, 202]);
  assert.deepEqual(ingredients(cat.items[0].recette).map(r => r.id), [200, 201, 202, 101]);
});

test('confirmation : prix de l\'item et lots pas bleus (moins d\'une heure) ; ressource craftable : achat + composants', async () => {
  const { tachesConfirmation } = await import('../src/craft-plan.js');
  const cat = catalogue(), b = base(400_000);
  // tout vient d'être relevé (T) : rien à confirmer
  assert.deepEqual(tachesConfirmation({ 1: 2 }, cat, b, T + 10 * 60e3), []);
  // 2 h plus tard : prix de l'épée, bois, alliage et ses deux minerais
  const t = tachesConfirmation({ 1: 2 }, cat, b, T + 2 * 3600e3).map(x => `${x.kind}:${x.id}`).sort();
  assert.deepEqual(t, ['prixItem:1', 'ressource:101', 'ressource:200', 'ressource:201', 'ressource:202']);
  // minerais relevés à nouveau : l'alliage est bleu par ses composants
  majRessource(b, 201, { 1: 50_000 }, T + 2 * 3600e3); majRessource(b, 202, { 1: 100_000 }, T + 2 * 3600e3);
  assert.deepEqual(tachesConfirmation({ 1: 2 }, cat, b, T + 2.5 * 3600e3).map(x => x.id).sort(), [1, 101]);
});
