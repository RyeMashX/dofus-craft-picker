import test from 'node:test';
import assert from 'node:assert/strict';
import { nombre, rangees } from '../src/ocr/lecteurs.js';
import { trouver, normaliser } from '../src/ocr/correspondance.js';

test('nombre : groupes de 3 chiffres', () => {
  assert.deepEqual(nombre('112 999 999'), { valeur: 112999999, valide: true });
  assert.deepEqual(nombre('2874'), { valeur: 2874, valide: true });
  assert.deepEqual(nombre('123 707 331 4'), { valeur: 123707331, valide: false }); // reste d'icône kama
  assert.deepEqual(nombre('121 598 0004'), { valeur: 121598000, valide: false });
});

test('rangées : mots sur la même hauteur regroupés', () => {
  const mot = (texte, x, y) => ({ texte, bbox: { x0: x, x1: x + 40, y0: y, y1: y + 30 } });
  const r = rangees([
    { mots: [mot('1', 10, 100), mot('2', 100, 102), mot('874', 150, 101)] },
    { mots: [mot('ACHETER', 300, 101)] },
    { mots: [mot('10', 10, 200)] },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].texte, '1 2 874 ACHETER');
});

test("correspondance : tolère les erreurs et les débris d'icône", () => {
  const cands = [{ id: 1, nom: 'Bélier de Gargandyas', niveau: 200 }, { id: 2, nom: 'Collier de Gargandyas', niveau: 200 }];
  assert.equal(trouver('Coller de Gargandyas', cands).candidat.id, 2);
  assert.equal(trouver('=) De ler de Gargandyas', cands).candidat.id, 1);
  assert.equal(trouver('Alliage', cands), null);
  assert.equal(normaliser("Amour d’Helséphine"), "amour d'helsephine");
});

test('séparer le lot du prix : grand blanc après 1 / 10 / 100', async () => {
  const { separerLot } = await import('../src/ocr/lecteurs.js');
  const mot = (texte, x0, x1) => ({ texte, bbox: { x0, x1, y0: 0, y1: 30 } });
  assert.deepEqual(separerLot({ texte: '1 10 125 000', mots: [mot('1', 256, 270), mot('10', 588, 630), mot('125', 648, 709), mot('000', 726, 800)] }), { lot: 1, texte: '10 125 000' });
  assert.deepEqual(separerLot({ texte: '10 125 000', mots: [mot('10', 588, 630), mot('125', 648, 709), mot('000', 726, 800)] }).lot, null);
});
