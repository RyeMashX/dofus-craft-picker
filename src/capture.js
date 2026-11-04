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

// Lit les zones utiles de l'image courante.
// Le panneau détail et la courbe sont lus s'ils sont ouverts ; la liste HDV seulement si
// aucun des deux ne l'est (le panneau détail masque le début des noms de la liste).
export async function scanner(zones, onProgres) {
  const { frame } = image();
  const rec = await reconnaisseur(onProgres);
  const lectures = [];

  onProgres?.({ status: 'lecture du panneau détail' });
  const detail = await lireEcran('detail', frame, enPixels(zones.detail, frame), rec);
  if (detail.titre && detail.annonces.length) lectures.push({ type: 'detail', lecture: detail });

  onProgres?.({ status: 'lecture de la courbe' });
  const courbe = await lireEcran('courbe', frame, enPixels(zones.courbe, frame), rec);
  if (courbe.vendus != null) lectures.push({ type: 'courbe', lecture: courbe });
  if (!lectures.length) {
    onProgres?.({ status: 'lecture de la liste' });
    const liste = await lireEcran('liste', frame, enPixels(zones.liste, frame), rec);
    if (liste.length) lectures.push({ type: 'liste', lecture: liste });
  }
  window.__derniereLecture = { detail, courbe, lectures }; // pour le diagnostic
  return lectures;
}

// Précharge tesseract (au démarrage de la capture), pour un premier scan plus rapide.
export const prechauffer = onProgres => worker(onProgres).catch(() => {});
