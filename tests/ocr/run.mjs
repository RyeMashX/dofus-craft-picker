// Test d'intégration OCR sur de vraies captures (tests/ocr/captures).
// Usage : npm run test:ocr   (télécharge les données de langue tesseract au premier lancement)

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createWorker } from 'tesseract.js';
import { lireEcran } from '../../src/ocr/lecteurs.js';
import { identifier } from '../../src/ocr/identification.js';

const ici = p => new URL(p, import.meta.url);
const catalogue = JSON.parse(readFileSync(ici('../../data/catalogue.json')));

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
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre), catalogue);
  verifier('lots : objet', r.objet?.nom, 'Étoffe sanglante');
  verifier('lots : prix moyen', r.prixMoyen, 1128);
  verifier('lots : x1/x10/x100', r.annonces.map(a => [a.lot, a.prix]), [[1, 2874], [10, 22949], [100, 700012]]);
}

// 2. Annonces d'un équipement
{
  const img = lire('detail-annonces-item.png');
  const r = identifier('detail', await lireEcran('detail', img, plein(img), reconnaitre), catalogue);
  verifier('annonces : objet', r.objet?.nom, 'Jugement de Thanatena');
  verifier('annonces : prix moyen', r.prixMoyen, 123707331);
  verifier('annonces : prix', r.annonces.map(a => a.prix), [
    112999999, 118999999, 119000000, 119977777, 119998990, 124400000, 124500000,
    129999999, 134999999, 137574999, 163000000, 169999999, 175999999, 190000000,
  ]);
}

// 3. Courbe 30 jours
{
  const img = lire('courbe-item.png');
  const r = identifier('courbe', await lireEcran('courbe', img, plein(img), reconnaitre), catalogue);
  verifier('courbe : objet', r.objet?.nom, 'Jugement de Thanatena');
  verifier('courbe : vendus / moyen / onglet 30 j actif', [r.vendus, r.moyen, r.trenteJours], [81, 123707331, true]);
}

// 4. Liste HDV ressources
{
  const img = lire('liste-ressources.png');
  const r = identifier('liste', await lireEcran('liste', img, plein(img), reconnaitre), catalogue);
  verifier('liste ressources : prix moyens', r.map(x => x.prixMoyen), [70082, 51464, 20348, 169761, 41630, 42502, 29851, 49829]);
  console.log('     reconnus :', r.map(x => x.nom ?? `?(${x.inconnu})`).join(', '));
}

// 5. Liste HDV équipements
{
  const img = lire('liste-items.png');
  const r = identifier('liste', await lireEcran('liste', img, plein(img), reconnaitre), catalogue);
  verifier('liste items : prix moyens', r.map(x => x.prixMoyen), [123707331, 85195409, 48533266, 32891887, 32352056, 25222088, 23162551, 20952153]);
  verifier('liste items : noms', r.map(x => x.nom ?? null), [
    'Jugement de Thanatena', 'Clairvoyance de Mériana', 'Hachebarde de Guerre', 'Trompe-la-Mort',
    'Bélier de Gargandyas', "Amour d'Helséphine", 'Fureur de Gargandyas', 'Collier de Gargandyas',
  ]);
}

await worker.terminate();
console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
