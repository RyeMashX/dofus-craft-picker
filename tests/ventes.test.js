import test from 'node:test';
import assert from 'node:assert/strict';
import { creerBase } from '../src/base.js';
import { coutFmEstime, ajouterVente, majLigne, changerPrix, prixInitial, historiquePrix, ecartPrix, prixParItem, marge, actives, lotsEnVente, marquerVendu, remettreEnVente, importerCapture, fusionner, nouvelleLigne, migrerVentes, bilan } from '../src/ventes.js';

const cout = () => 1_000_000;

test('ligne : frais 2 % recalculés avec le prix, sauf saisie manuelle ; marge', () => {
  const b = creerBase();
  const l = ajouterVente(b, { id: 7, prix: 3_000_000, coutCraft: 1_800_000, coutFm: 200_000 });
  assert.equal(l.statut, 'draft');
  assert.equal(l.frais, 60_000);
  assert.equal(marge(l), 3_000_000 - 1_800_000 - 60_000 - 200_000);
  majLigne(b, l.uid, 'prix', 2_500_000); assert.equal(l.frais, 50_000);
  majLigne(b, l.uid, 'frais', 40_000); majLigne(b, l.uid, 'prix', 2_000_000); assert.equal(l.frais, 40_000);
});

test('vendu : sort de la liste active (l\'item redevient proposable), retour possible', () => {
  const b = creerBase();
  const l = ajouterVente(b, { id: 7, prix: 3e6, coutCraft: 2e6 });
  ajouterVente(b, { id: 7, prix: 3.1e6, coutCraft: 2e6 });
  assert.equal(lotsEnVente(b, 7), 2);
  marquerVendu(b, l.uid, Date.UTC(2026, 10, 10));
  assert.equal(lotsEnVente(b, 7), 1);
  remettreEnVente(b, l.uid);
  assert.equal(lotsEnVente(b, 7), 2);
  assert.equal(l.statut, 'valide');
});

test('import OCR : nouvel item validé, même prix ignoré, prix différent à trancher, doublon de capture ignoré', () => {
  const b = creerBase();
  ajouterVente(b, { id: 1, statut: 'draft', prix: 5_000_000, coutCraft: 3e6 });
  const r = importerCapture(b, { lignes: [
    { id: 1, nom: 'A', prix: 5_000_000 },  // même annonce
    { id: 1, nom: 'A', prix: 4_900_000 },  // à trancher
    { id: 2, nom: 'B', prix: 2_000_000 },  // nouveau
    { id: 2, nom: 'B', prix: 2_000_000 },  // vu deux fois (chevauchement)
    { id: null, nom: 'Az\'tech', prix: 677_776 },
  ] }, cout);
  assert.equal(r.connues, 1);
  assert.equal(r.ajoutees.length, 1);
  assert.equal(r.ajoutees[0].statut, 'valide');
  assert.equal(r.ajoutees[0].coutCraft, 1_000_000);
  assert.deepEqual(r.aTrancher, [{ id: 1, nom: 'A', prix: 4_900_000 }]);
  assert.equal(r.ignorees, 1);
  const existante = actives(b).find(l => l.id === 1);
  fusionner(b, existante.uid, 4_900_000);
  assert.equal(existante.prix, 4_900_000);
  nouvelleLigne(b, 1, 4_800_000, cout);
  assert.equal(lotsEnVente(b, 1), 2);
});

test('import OCR : deux exemplaires du même item sur un même écran = deux lignes', () => {
  const b = creerBase();
  const r = importerCapture(b, { lignes: [{ id: 5, nom: 'E', prix: 5_500_000 }, { id: 5, nom: 'E', prix: 5_498_998 }] }, cout);
  assert.equal(r.ajoutees.length, 2);
  assert.equal(r.aTrancher.length, 0);
  const r2 = importerCapture(b, { lignes: [{ id: 5, nom: 'E', prix: 5_500_000 }, { id: 5, nom: 'E', prix: 5_498_998 }] }, cout);
  assert.equal(r2.connues, 2);
  assert.equal(lotsEnVente(b, 5), 2);
});

test('frais : 2 % recalculés en draft, figés une fois validée, + 1 % du nouveau prix à chaque changement', () => {
  const b = creerBase();
  const l = ajouterVente(b, { id: 7, prix: 10_000_000, coutCraft: 6e6 });
  majLigne(b, l.uid, 'prix', 9_000_000); assert.equal(l.frais, 180_000);       // draft : recalcul
  majLigne(b, l.uid, 'statut', 'valide');
  majLigne(b, l.uid, 'prix', 9_500_000); assert.equal(l.frais, 180_000);       // validée : correction, frais figés
  changerPrix(b, l.uid, 8_000_000, 5); assert.equal(l.frais, 260_000);         // + 1 % de 8 M
  changerPrix(b, l.uid, 7_000_000, 6); assert.equal(l.frais, 330_000);         // + 1 % de 7 M
  assert.equal(l.prix, 7_000_000);
  assert.equal(l.changements.length, 2);
  assert.deepEqual(l.changements[0], { date: 5, ancien: 9_500_000, prix: 8_000_000, frais: 80_000 });
  majLigne(b, l.uid, 'statut', 'draft'); assert.equal(l.frais, 140_000);       // retour en draft : 2 % du prix
  const d = ajouterVente(b, { id: 8, prix: 1_000_000 });
  changerPrix(b, d.uid, 900_000); assert.equal(d.frais, 18_000);               // draft : simple recalcul
});

test('import OCR : fusion d\'une ligne validée = changement de prix (+ 1 %)', () => {
  const b = creerBase();
  const l = ajouterVente(b, { id: 9, statut: 'valide', prix: 5_000_000 });
  fusionner(b, l.uid, 4_000_000);
  assert.equal(l.prix, 4_000_000);
  assert.equal(l.frais, 100_000 + 40_000);
});

test('migration : ancien compteur → lignes validées', () => {
  const b = creerBase();
  b.enVente = { date: 1, items: { 3: 2 } };
  migrerVentes(b, cout);
  assert.equal(lotsEnVente(b, 3), 2);
  assert.equal(b.enVente, undefined);
});

test('bilan : CA, marge, délai moyen, par mois', () => {
  const b = creerBase();
  const J = 864e5, t0 = Date.UTC(2026, 10, 1);
  for (const [prix, cc, jours] of [[3e6, 2e6, 2], [5e6, 3e6, 4]]) {
    const l = ajouterVente(b, { id: 1, prix, coutCraft: cc, date: t0 });
    marquerVendu(b, l.uid, t0 + jours * J);
  }
  const r = bilan(b);
  assert.equal(r.ventes, 2);
  assert.equal(r.ca, 8e6);
  assert.equal(r.marge, 8e6 - 5e6 - 160_000);
  assert.equal(r.delaiMoyen, 3);
  assert.equal(r.parMois[0].mois, '2026-11');
});

test('historique des prix : prix initial, changements, écart final, stats par item', () => {
  const b = creerBase();
  const l = ajouterVente(b, { id: 3, statut: 'valide', prix: 10_000_000, coutCraft: 5e6, date: 1 });
  majLigne(b, l.uid, 'prix', 9_800_000);                 // correction : pas d'historique
  changerPrix(b, l.uid, 9_000_000, 2);
  changerPrix(b, l.uid, 8_500_000, 3);
  assert.equal(prixInitial(l), 9_800_000);
  assert.deepEqual(historiquePrix(l).map(x => x.prix), [9_800_000, 9_000_000, 8_500_000]);
  assert.ok(Math.abs(ecartPrix(l) - (8.5 - 9.8) / 9.8) < 1e-9);
  const m = ajouterVente(b, { id: 3, statut: 'valide', prix: 9_000_000, coutCraft: 5e6, date: 1 });
  marquerVendu(b, l.uid, 1 + 2 * 864e5); marquerVendu(b, m.uid, 1 + 864e5);
  const [p] = prixParItem(b);
  assert.equal(p.ventes, 2); assert.equal(p.changementsMoyens, 1);
  assert.ok(Math.abs(p.ecartMoyen - ((8.5 - 9.8) / 9.8) / 2) < 1e-9);
  const bl = bilan(b);
  assert.equal(bl.changementsMoyens, 1); assert.equal(bl.sansChangement, 0.5);
});

test('coût de FM estimé : moyenne des ventes du même item seulement, n/a sinon ; 0 = non renseigné', () => {
  const b = creerBase();
  assert.equal(coutFmEstime(b, 1), null);
  const v = (id, fm) => { const l = ajouterVente(b, { id, statut: 'valide', prix: 5e6, coutCraft: 3e6, coutFm: fm }); marquerVendu(b, l.uid); };
  v(1, 400_000); v(1, 600_000); v(1, 0); v(2, 1_000_000);
  ajouterVente(b, { id: 1, statut: 'valide', prix: 5e6, coutFm: 9e6 });   // pas vendue : ignorée
  assert.deepEqual(coutFmEstime(b, 1), { valeur: 500_000, n: 2 });
  assert.equal(coutFmEstime(b, 3), null);
  // une ligne relevée par OCR reprend l'estimation (vide sans donnée)
  const r = importerCapture(b, { lignes: [{ id: 3, nom: 'X', prix: 4e6 }] }, () => 2e6);
  assert.equal(r.ajoutees[0].coutFm, null);
  assert.equal(nouvelleLigne(b, 1, 4e6, () => 2e6).coutFm, 500_000);
});

test('supprimer un changement de prix : frais retirés, prix et historique recousus', async () => {
  const { supprimerChangement } = await import('../src/ventes.js');
  const b = creerBase();
  const l = ajouterVente(b, { id: 4, statut: 'valide', prix: 10_000_000 });   // frais 200 k
  changerPrix(b, l.uid, 9_000_000, 1); changerPrix(b, l.uid, 8_000_000, 2);  // + 90 k + 80 k
  supprimerChangement(b, l.uid, 0);                                           // le 10 M → 9 M était une erreur
  assert.equal(l.frais, 280_000); assert.equal(l.prix, 8_000_000);
  assert.deepEqual(historiquePrix(l).map(x => x.prix), [10_000_000, 8_000_000]);
  supprimerChangement(b, l.uid, 0);                                           // dernier : retour au prix d'avant
  assert.equal(l.prix, 10_000_000); assert.equal(l.frais, 200_000); assert.equal(l.changements.length, 0);
});

test('prix par item : prix moyen, marge moyenne et rendement', () => {
  const b = creerBase();
  for (const prix of [10e6, 8e6]) { const l = ajouterVente(b, { id: 6, statut: 'valide', prix, coutCraft: 5e6 }); marquerVendu(b, l.uid); }
  const [p] = prixParItem(b);
  assert.equal(p.prixMoyen, 9e6);
  assert.equal(p.margeMoyenne, (10e6 - 5e6 - 2e5 + 8e6 - 5e6 - 1.6e5) / 2);
  assert.ok(Math.abs(p.rendement - p.margeMoyenne * 2 / 10e6) < 1e-9);
  assert.equal(p.lignes.length, 2);
});
