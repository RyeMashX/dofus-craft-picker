// Test d'intégration OCR sur de vraies captures (tests/ocr/captures).
// Usage : npm run test:ocr   (télécharge les données de langue tesseract au premier lancement)

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createWorker } from 'tesseract.js';
import { lireEcran } from '../../src/ocr/lecteurs.js';
import { identifier } from '../../src/ocr/identification.js';

const ici = p => new URL(p, import.meta.url);
const catalogue = JSON.parse(readFileSync(ici('../../data/catalogue.json')));

// Les captures de test sont des recadrages de captures Retina pleine résolution : agrandissement ×2
const lire = f => { const p = PNG.sync.read(readFileSync(ici(`captures/${f}`))); return { width: p.width, height: p.height, data: p.data }; };
const encoder = img => { const p = new PNG({ width: img.width, height: img.height }); p.data = Buffer.from(img.data); return PNG.sync.write(p); };

const worker = await createWorker('fra');
async function reconnaitre(img, { chiffres }) {
  await worker.setParameters(chiffres
    ? { tessedit_char_whitelist: '0123456789 ', tessedit_pageseg_mode: '6' }
    : { tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
  const { data } = await worker.recognize(encoder(img), {}, { blocks: true });
  const lignes = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
    lignes.push({ texte: l.text.trim(), bbox: l.bbox, mots: l.words.map(w => ({ texte: w.text, bbox: w.bbox })) });
  }
  return lignes;
}

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  bon ? ok++ : ko++;
  console.log(`${bon ? 'ok ' : 'KO '} ${nom}${bon ? '' : `\n     obtenu  ${JSON.stringify(obtenu)}\n     attendu ${JSON.stringify(attendu)}`}`);
};
const plein = img => ({ x: 0, y: 0, w: img.width, h: img.height });

// 1. Lots d'une ressource
{
  const img = lire('detail-lots-ressource.png');
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('lots : objet', r.objet?.nom, 'Étoffe sanglante');
  verifier('lots : prix moyen', r.prixMoyen, 1128);
  verifier('lots : x1/x10/x100', r.annonces.map(a => [a.lot, a.prix]), [[1, 2874], [10, 22949], [100, 700012]]);
}

// 2. Annonces d'un équipement
{
  const img = lire('detail-annonces-item.png');
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('annonces : objet', r.objet?.nom, 'Jugement de Thanatena');
  verifier('annonces : prix moyen', r.prixMoyen, 123707331);
  verifier('annonces : prix', r.annonces.map(a => a.prix), [
    112999999, 118999999, 119000000, 119977777, 119998990, 124400000, 124500000,
    129999999, 134999999, 137574999, 163000000, 169999999, 175999999, 190000000,
  ]);
}

// 2 bis. Annonces avec l'icône de l'objet à gauche de chaque rangée (lue comme « 3 », « 143 »), dernière rangée coupée
{
  const img = lire('detail-annonces-icones.png');
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('icônes : objet', r.objet?.nom, 'Ceinture du Strigide');
  verifier('icônes : lots et prix', r.annonces.map(a => [a.lot, a.prix]), [
    [1, 2600000], [1, 2650000], [1, 2700000], [1, 2800000], [1, 2900000], [1, 2900000], [1, 2940000],
    [1, 2999990], [1, 2999998], [1, 2999998], [1, 2999998], [1, 2999998], [1, 2999998],
  ]);
}

// 2 ter. La passe chiffres lit « 2 950 001 » comme « 2 350 001 » : l'ordre croissant des annonces départage
{
  const img = lire('detail-annonces-9-lu-3.png');
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('9 lu 3 : objet', r.objet?.nom, 'Anneau Crustique');
  verifier('9 lu 3 : prix', r.annonces.map(a => a.prix), [2700000, 2950001, 2950001, 2956789, 2978999, 2999999, 2999999, 3038749, 3299000, 3499000, 3800000, 4220000, 4222222]);
}

// 2 quater. Deux zones réglées (nom, puis colonnes Lot et Prix sur toute la hauteur possible de la liste)
for (const [f, nom, val, attendu] of [
  ['detail-annonces-9-lu-3.png', [115, 41, 495, 60], [95, 290, 320, 897], ['Anneau Crustique', 2700000, 2950001, 2950001, 2956789, 2978999, 2999999, 2999999, 3038749, 3299000, 3499000, 3800000, 4220000, 4222222]],
  ['detail-annonces-icones.png', [115, 41, 495, 60], [95, 290, 320, 897], ['Ceinture du Strigide', 2600000, 2650000, 2700000, 2800000, 2900000, 2900000, 2940000, 2999990, 2999998, 2999998, 2999998, 2999998, 2999998]],
  ['detail-annonce-unique.png', [115, 80, 495, 60], [95, 290, 320, 853], ['Alliance Brûlâme', 10125000]],   // décor sous un panneau court
  ['detail-lots-galet.png', [125, 140, 400, 80], [95, 340, 320, 843], ['Galet brasillant', '1:229813', '10:2299902', '100:26999999']],
  ['detail-lots-pepite.png', [125, 80, 400, 60], [95, 290, 320, 853], ['Pépite', '1:400', '10:2498', '100:22221', '1000:210940']],
]) {
  const img = lire(f);
  const z = a => ({ x: a[0], y: a[1], w: a[2], h: Math.min(a[3], img.height - a[1]) });
  const r = identifier('detail', await lireEcran('detail', img, { nom: z(nom), valeur: z(val) }, reconnaitre, { echelle: 2 }), catalogue);
  const res = r.objet?.genre === 'ressource';
  verifier(`deux zones : ${f}`, [r.objet?.nom, ...r.annonces.map(a => (res ? `${a.lot}:${a.prix}` : a.prix))], attendu);
}
{
  const img = lire('courbe-item.png');
  const L = await lireEcran('courbe', img, { nom: { x: 200, y: 110, w: 500, h: 70 }, valeur: { x: 30, y: 280, w: 1510, h: 45 } }, reconnaitre, { echelle: 2 });
  verifier('deux zones : courbe', [L.titre, L.vendus, L.trenteJours], ['Jugement de Thanatena', 81, true]);
}

// 2 quinquies. Nom de deux lettres (« Or ») : panneau entier, puis zone nom seule
{
  const img = lire('detail-lots-or.png');
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('Or : panneau entier', [r.objet?.nom, ...r.annonces.map(a => `${a.lot}:${a.prix}`)], ['Or', '1:135', '10:1399', '100:13000', '1000:139811']);
  const z = identifier('detail', await lireEcran('detail', img, { nom: { x: 125, y: 76, w: 330, h: 30 }, valeur: { x: 85, y: 300, w: 345, h: 340 } }, reconnaitre, { echelle: 2 }), catalogue);
  verifier('Or : deux zones', [z.objet?.nom, ...z.annonces.map(a => `${a.lot}:${a.prix}`)], ['Or', '1:135', '10:1399', '100:13000', '1000:139811']);
}

// 3. Courbe 30 jours
{
  const img = lire('courbe-item.png');
  const r = identifier('courbe', await lireEcran('courbe', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('courbe : objet', r.objet?.nom, 'Jugement de Thanatena');
  verifier('courbe : vendus / moyen / onglet 30 j actif', [r.vendus, r.moyen, r.trenteJours], [81, 123707331, true]);
}

// 3 bis. Courbe avec un débris d'icône devant « Niveau » et un volume à 1 chiffre
{
  const img = lire('courbe-item-7.png');
  const r = identifier('courbe', await lireEcran('courbe', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('courbe (débris) : objet', r.objet?.nom, 'Alliance Brûlâme');
  verifier('courbe (débris) : vendus / onglet 30 j', [r.vendus, r.trenteJours], [7, true]);
}

// 3 ter. Panneau détail avec une seule annonce, en partie masqué par la courbe
{
  const img = lire('detail-annonce-unique.png');
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('annonce unique : objet', r.objet?.nom, 'Alliance Brûlâme');
  verifier('annonce unique : prix', r.annonces.map(a => a.prix), [10125000]);
}

// 3 quater. Prix pleins de zéros : « 9 100 000 » ne doit pas faire croire à un lot de 100
{
  const img = lire('detail-annonces-zeros.png');
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('zéros : objet', r.objet?.nom, 'Anneau Lunaire');
  verifier('zéros : prix', r.annonces.map(a => a.prix), [8300000, 8300000, 8300000, 9000000, 9000000, 9090909, 9100000, 9999999, 10999999, 13999420, 15100000, 15222222, 15499999]);
}

// 3 quinquies. Lots d'une ressource, prix collé à un reste d'icône, en pleine et demi-résolution
for (const [f, echelle] of [['detail-lots-galet.png', 2], ['detail-lots-galet-demi.png', 4]]) {
  const img = lire(f);
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle }), catalogue);
  verifier(`galet (${echelle === 2 ? 'pleine' : 'demi'}) : lots`, [r.objet?.nom, ...r.annonces.map(a => [a.lot, a.prix])], ['Galet brasillant', [1, 229813], [10, 2299902], [100, 26999999]]);
}

// 3 sexies. Lot x1000 (Pépite) ; à demi-résolution les numéros de lot sont illisibles et déduits
for (const [f, echelle] of [['detail-lots-pepite.png', 2], ['detail-lots-pepite-demi.png', 4]]) {
  const img = lire(f);
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre, { echelle }), catalogue);
  verifier(`pépite (${echelle === 2 ? 'pleine' : 'demi'}) : lots`, [r.objet?.nom, ...r.annonces.map(a => [a.lot, a.prix])], ['Pépite', [1, 400], [10, 2498], [100, 22221], [1000, 210940]]);
}

// 3 septies. Mes ventes : noms sur 1 ou 2 lignes, total « 55/570 lots en vente »
for (const [f, echelle] of [['ventes.png', 2], ['ventes-demi.png', 4]]) {
  const img = lire(f);
  const r = identifier('ventes', await lireEcran('ventes', img, plein(img), reconnaitre, { echelle }), catalogue);
  const connues = r.lignes.filter(l => l.id != null).map(l => [l.nom, l.prix]);
  verifier(`ventes (${echelle === 2 ? 'pleine' : 'demi'})`, [r.total, ...connues], [55,
    ['Anneau du Comte Harebourg', 1299998], ['Anneau du Katcheur', 5498997], ['Anneau du Katcheur', 5498998],
    ['Anneau en Grithril', 4974999], ['Arc Volkorne', 5399998], ['Bottes du Roi Joueur', 3399999], ['Bottes du Roi Joueur', 3399998],
    ['Bottes du Strigide', 2999995], ['Bottes du Strigide', 2999994]]);
}

// 4. Liste HDV ressources
{
  const img = lire('liste-ressources.png');
  const r = identifier('liste', await lireEcran('liste', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('liste ressources : prix moyens', r.map(x => x.prixMoyen), [70082, 51464, 20348, 169761, 41630, 42502, 29851, 49829]);
  console.log('     reconnus :', r.map(x => x.nom ?? `?(${x.inconnu})`).join(', '));
}

// 5. Liste HDV équipements
{
  const img = lire('liste-items.png');
  const r = identifier('liste', await lireEcran('liste', img, plein(img), reconnaitre, { echelle: 2 }), catalogue);
  verifier('liste items : prix moyens', r.map(x => x.prixMoyen), [123707331, 85195409, 48533266, 32891887, 32352056, 25222088, 23162551, 20952153]);
  verifier('liste items : noms', r.map(x => x.nom ?? null), [
    'Jugement de Thanatena', 'Clairvoyance de Mériana', 'Hachebarde de Guerre', 'Trompe-la-Mort',
    'Bélier de Gargandyas', "Amour d'Helséphine", 'Fureur de Gargandyas', 'Collier de Gargandyas',
  ]);
}

await worker.terminate();
console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
