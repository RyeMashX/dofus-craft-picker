// Capture de la fenêtre du jeu (partage d'écran du navigateur) et OCR dans le navigateur (tesseract.js).
// Aucune lecture réseau du client, aucun clic automatisé : on lit l'image de la fenêtre partagée.

import { lireEcran } from './ocr/lecteurs.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let stream = null, video = null, workerPromise = null;

export const estSupporte = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
export const enCours = () => !!(stream && stream.active) || !!window.__testFrame;

export async function demarrer(onFin) {
  arreter();
  stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'window', frameRate: 5 }, audio: false, preferCurrentTab: false, selfBrowserSurface: 'exclude',
  });
  video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  stream.getVideoTracks()[0].addEventListener('ended', () => { arreter(); onFin?.(); });
  return { width: video.videoWidth, height: video.videoHeight };
}

export function arreter() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; video = null;
}

// Image courante du flux : { canvas, frame (ImageData) }
export function image() {
  const src = window.__testFrame ?? video; // __testFrame : image injectée pour les tests
  if (!src) throw new Error('Pas de capture en cours.');
  const w = src.videoWidth ?? src.width, h = src.videoHeight ?? src.height;
  if (!w) throw new Error('Capture pas encore prête.');
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(src, 0, 0);
  return { canvas: c, frame: ctx.getImageData(0, 0, w, h) };
}

async function worker(onProgres) {
  if (!workerPromise) workerPromise = (async () => {
    if (!window.Tesseract) await new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = TESSERACT_URL; s.onload = ok;
      s.onerror = () => ko(new Error('tesseract.js introuvable (réseau ?)')); document.head.appendChild(s);
    });
    return window.Tesseract.createWorker('fra', 1, { logger: m => onProgres?.(m) });
  })();
  return workerPromise;
}

const versCanvas = img => {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
};

// Adaptateur tesseract → format attendu par les lecteurs
async function reconnaisseur(onProgres) {
  const w = await worker(onProgres);
  return async (img, { chiffres }) => {
    await w.setParameters(chiffres
      ? { tessedit_char_whitelist: '0123456789 ', tessedit_pageseg_mode: '6' }
      : { tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
    const { data } = await w.recognize(versCanvas(img), {}, { blocks: true });
    const lignes = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
      lignes.push({ texte: l.text.trim(), bbox: l.bbox, mots: l.words.map(m => ({ texte: m.text, bbox: m.bbox })) });
    }
    return lignes;
  };
}

// zones = { liste, detail, courbe } en fractions de l'image ({ x, y, w, h } entre 0 et 1)
const enPixels = (z, f) => ({ x: z.x * f.width, y: z.y * f.height, w: z.w * f.width, h: z.h * f.height });

// Ce que l'on scanne → écran à lire et zone où regarder
export const MODES = {
  annonces: { ecran: 'detail', zone: 'detail', libelle: 'Prix équipement' },
  lots: { ecran: 'detail', zone: 'detail', libelle: 'Prix ressource' },
  courbe: { ecran: 'courbe', zone: 'courbe', libelle: 'Volume équipement' },
  liste: { ecran: 'liste', zone: 'liste', libelle: 'Prix moyens (liste HDV)' },
  ventes: { ecran: 'ventes', zone: 'ventes', libelle: 'Mes ventes (onglet Vente)' },
};

// Lit, dans l'image courante, le seul écran correspondant au mode choisi.
// Retourne { type, lecture, utile } (utile = faux si rien d'exploitable n'a été lu).
export async function scanner(zones, mode, onProgres) {
  const { canvas, frame } = image();
  const rec0 = await reconnaisseur(onProgres);
  const textes = [];
  const rec = async (img, o) => { const l = await rec0(img, o); textes.push(`${o.chiffres ? '[chiffres] ' : ''}${l.map(x => x.texte).join(o.chiffres ? ' | ' : '\n')}`); return l; };
  const { ecran, zone } = MODES[mode];
  // deux zones (nom, valeur) réglées pour ce mode, sinon la zone d'origine de l'écran
  const deux = zones[`${mode}.nom`] && zones[`${mode}.valeur`];
  const px = deux ? { nom: enPixels(zones[`${mode}.nom`], frame), valeur: enPixels(zones[`${mode}.valeur`], frame) } : enPixels(zones[zone], frame);
  onProgres?.({ status: MODES[mode].libelle.toLowerCase() });
  const estUtile = l => ecran === 'courbe' ? l.vendus != null
    : ecran === 'detail' ? !!(l.titre && l.annonces.length)
    : ecran === 'ventes' ? l.lignes.length > 0
    : l.length > 0;
  let lecture = await lireEcran(ecran, frame, px, rec), zoneLue = px;
  // deux zones qui ne donnent rien (panneau ailleurs ce coup-ci) : on relit le panneau entier
  if (deux && !estUtile(lecture) && zones[zone]) { zoneLue = enPixels(zones[zone], frame); lecture = await lireEcran(ecran, frame, zoneLue, rec); }
  dernier = { canvas, zone: zoneLue, texte: textes.join('\n---\n'), mode };
  const utile = estUtile(lecture);
  return { type: ecran, lecture, utile };
}

// Diagnostic du dernier scan : image capturée, zone lue, texte reconnu
let dernier = null;
export function diagnostic() {
  if (!dernier) return null;
  const { canvas } = dernier;
  // deux zones : l'aperçu montre le rectangle qui les contient toutes les deux
  const z = dernier.zone;
  const zone = z.nom ? (() => { const x = Math.min(z.nom.x, z.valeur.x), y = Math.min(z.nom.y, z.valeur.y);
    return { x, y, w: Math.max(z.nom.x + z.nom.w, z.valeur.x + z.valeur.w) - x, h: Math.max(z.nom.y + z.nom.h, z.valeur.y + z.valeur.h) - y }; })() : z;
  const c = document.createElement('canvas');
  const k = Math.min(1, 600 / zone.w);
  c.width = Math.round(zone.w * k); c.height = Math.round(zone.h * k);
  c.getContext('2d').drawImage(canvas, zone.x, zone.y, zone.w, zone.h, 0, 0, c.width, c.height);
  return {
    apercu: c.toDataURL('image/jpeg', 0.8),
    image: () => canvas.toDataURL('image/png'),
    texte: dernier.texte,
    taille: `${canvas.width} × ${canvas.height}`,
    zone: `x ${Math.round(zone.x)}, y ${Math.round(zone.y)}, ${Math.round(zone.w)} × ${Math.round(zone.h)}`,
  };
}

// Précharge tesseract (au démarrage de la capture), pour un premier scan plus rapide.
export const prechauffer = onProgres => worker(onProgres).catch(() => {});
