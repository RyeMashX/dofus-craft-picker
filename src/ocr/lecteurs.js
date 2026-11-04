// Lecture des quatre écrans de l'HDV.
//
//   'liste'  : liste HDV (équipements ou ressources) → [{ nom, niveau, prixMoyen }]
//   'detail' : détail d'un objet (annonces d'un équipement ou lots d'une ressource)
//              → { titre, niveau, prixMoyen, annonces: [{ lot, prix }] }
//   'courbe' : cours du marché → { titre, niveau, vendus, moyen, trenteJours }
//
// Deux passes OCR : une lecture complète repère les lignes et les colonnes, puis une
// seconde lecture de la seule colonne des prix, en chiffres uniquement, donne les montants.
//
// `reconnaitre(image, { chiffres })` est fourni par l'appelant (tesseract.js dans le
// navigateur ou dans Node) et renvoie [{ texte, bbox: {x0,y0,x1,y1}, mots: [{ texte, bbox }] }].

import { pretraiter, recadrer } from './image.js';

// "112 999 999" → 112999999.
// Les montants s'écrivent par groupes de 3 chiffres : on s'arrête au premier groupe incohérent
// (souvent un reste de l'icône kama lu comme "4"). valide = aucun groupe écarté.
export function nombre(s) {
  const m = String(s).match(/\d[\d \u00a0.]*/);
  if (!m) return null;
  const groupes = m[0].trim().split(/[ \u00a0.]+/).filter(Boolean);
  if (groupes.length === 1) return { valeur: Number(groupes[0]), valide: true };
  if (groupes[0].length > 3) return { valeur: Number(groupes.join('')), valide: false };
  const gardes = [groupes[0]];
  let valide = true;
  for (const g of groupes.slice(1)) {
    if (g.length === 3) { gardes.push(g); continue; }
    valide = false;
    if (g.length === 4) gardes.push(g.slice(0, 3)); // "0004" : chiffre parasite collé (icône kama)
    break;
  }
  return { valeur: Number(gardes.join('')), valide };
}

const centre = b => (b.y0 + b.y1) / 2;
const proche = (lignes, y, tol) => {
  let best = null;
  for (const l of lignes) {
    const d = Math.abs(centre(l.bbox) - y);
    if (d <= tol && (!best || d < best.d)) best = { l, d };
  }
  return best?.l ?? null;
};
// Regroupe les mots de toutes les lignes en rangées horizontales (tesseract coupe parfois
// une même rangée du tableau en plusieurs lignes).
export function rangees(lignes) {
  const mots = lignes.flatMap(l => l.mots).filter(m => m.texte.trim());
  if (!mots.length) return [];
  const hauteurs = mots.map(m => m.bbox.y1 - m.bbox.y0).sort((a, b) => a - b);
  const tol = hauteurs[Math.floor(hauteurs.length / 2)] * 0.6;
  const groupes = [];
  for (const m of [...mots].sort((a, b) => centre(a.bbox) - centre(b.bbox))) {
    const g = groupes.at(-1);
    if (g && Math.abs(centre(m.bbox) - g.cy) <= tol) { g.mots.push(m); g.cy = g.mots.reduce((s, x) => s + centre(x.bbox), 0) / g.mots.length; }
    else groupes.push({ cy: centre(m.bbox), mots: [m] });
  }
  return groupes.map(g => {
    const ms = g.mots.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return {
      texte: ms.map(m => m.texte).join(' '),
      mots: ms,
      bbox: { x0: Math.min(...ms.map(m => m.bbox.x0)), x1: Math.max(...ms.map(m => m.bbox.x1)), y0: Math.min(...ms.map(m => m.bbox.y0)), y1: Math.max(...ms.map(m => m.bbox.y1)) },
    };
  });
}

// Ligne "Niv. 200 • Anneau" (détail) ou "Niveau 200 • Faux" (courbe) : le titre est la rangée au-dessus.
// La ligne peut commencer par un débris d'icône ("4 Niveau 200") : on cherche "Niv" n'importe où.
const RE_NIVEAU = /\bniv(?:eau)?\.?\s*(\d{1,3})\b/i;
export function titreEtNiveau(lignes) {
  const i = lignes.findIndex(l => RE_NIVEAU.test(l.texte));
  if (i < 0) return { titre: null, niveau: null };
  const niveau = Number(lignes[i].texte.match(RE_NIVEAU)[1]);
  // titre : première rangée au-dessus qui contient des lettres
  for (let k = i - 1; k >= 0; k--) {
    const t = lettres(lignes[k].texte);
    if (t.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3) return { titre: t, niveau };
  }
  return { titre: null, niveau };
}

const lettres = s => s.replace(/[^A-Za-zÀ-ÿ' -]/g, ' ').replace(/\s+/g, ' ').trim();

async function passeChiffres(pre, zone, reconnaitre) {
  if (zone.w <= 0 || zone.h <= 0) return [];
  const lignes = rangees(await reconnaitre(recadrer(pre, zone), { chiffres: true }));
  return lignes.map(l => ({ ...l, bbox: { x0: l.bbox.x0 + zone.x, x1: l.bbox.x1 + zone.x, y0: l.bbox.y0 + zone.y, y1: l.bbox.y1 + zone.y } }));
}

// ---------- liste HDV ----------
const RE_LIGNE_LISTE = /(?:^|\s)(\d{1,3})\s+(\d{1,3}(?:[  ]?\d{3})+)\D*$/;

export async function lireListe(pre, reconnaitre) {
  const lignes = rangees(await reconnaitre(pre, {}));
  const rangs = [];
  for (const l of lignes) {
    const m = l.texte.match(RE_LIGNE_LISTE);
    if (!m || Number(m[1]) > 200) continue;
    const motNiveau = l.mots.find(w => w.texte === m[1]);
    rangs.push({ ligne: l, niveau: Number(m[1]), prixTexte: m[2], xNiveau: motNiveau?.bbox.x1 ?? null });
  }
  if (!rangs.length) return [];

  // seconde passe sur la colonne des prix, à droite de la colonne niveau
  const xs = rangs.map(r => r.xNiveau).filter(x => x != null).sort((a, b) => a - b);
  const x0 = xs.length ? xs[Math.floor(xs.length / 2)] + 10 : Math.round(pre.width * 0.7);
  const haut = Math.min(...rangs.map(r => r.ligne.bbox.y0)) - 20;
  const chiffres = await passeChiffres(pre, { x: x0, y: Math.max(0, haut), w: pre.width - x0, h: pre.height - Math.max(0, haut) }, reconnaitre);

  // pas vertical entre deux rangs → bande de chaque rang pour retrouver le nom (sur 1 à 3 lignes)
  const ys = rangs.map(r => centre(r.ligne.bbox));
  const pas = ys.length > 1 ? (ys[ys.length - 1] - ys[0]) / (ys.length - 1) : pre.height;

  return rangs.map((r, i) => {
    const y = ys[i];
    const c = proche(chiffres, y, pas / 3);
    const n = nombre(c?.texte ?? r.prixTexte);
    const textes = lignes
      .filter(l => Math.abs(centre(l.bbox) - y) < pas / 2 && l.bbox.x0 < (r.xNiveau ?? pre.width) - 40)
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)
      .map(l => lettres(l === r.ligne ? l.texte.replace(RE_LIGNE_LISTE, '') : l.texte))
      .filter(t => t.length > 1);
    return { textes, niveau: r.niveau, prixMoyen: n?.valeur ?? null, sur: !!(c && n?.valide) };
  });
}

// ---------- détail d'un objet ----------
// Si la colonne "Lot" n'a pas été repérée, la passe chiffres peut lire "1 10 125 000" :
// le lot (1, 10 ou 100) est séparé du prix par un grand blanc, bien plus large qu'une espace de milliers.
export function separerLot(rangee) {
  const m = rangee.mots;
  if (m.length >= 2 && /^(1|10|100)$/.test(m[0].texte)) {
    const blanc = m[1].bbox.x0 - m[0].bbox.x1;
    const hauteur = m[0].bbox.y1 - m[0].bbox.y0;
    if (blanc > 2.5 * hauteur) return { lot: Number(m[0].texte), texte: m.slice(1).map(x => x.texte).join(' ') };
  }
  return { lot: null, texte: rangee.texte };
}

export async function lireDetail(pre, reconnaitre) {
  const lignes = rangees(await reconnaitre(pre, {}));
  const { titre, niveau } = titreEtNiveau(lignes);
  const pm = lignes.map(l => l.texte.match(/prix\s*moyen\s*:?\s*(\d[\d  ]*)/i)).find(Boolean);

  const rangs = lignes.filter(l => /ACHETER/i.test(l.texte)).map(l => {
    const lot = l.mots.find(w => /^(1|10|100)$/.test(w.texte));
    const acheter = l.mots.find(w => /ACHETER/i.test(w.texte));
    return { ligne: l, lot: lot ? Number(lot.texte) : null, xLot: lot?.bbox.x1 ?? null, xAcheter: acheter?.bbox.x0 ?? null };
  });

  let annonces = [];
  if (rangs.length) {
    const xLot = Math.max(...rangs.map(r => r.xLot ?? 0)) + 8;
    const xAch = Math.min(...rangs.map(r => r.xAcheter ?? pre.width)) - 8;
    const haut = Math.max(0, rangs[0].ligne.bbox.y0 - 20);
    const chiffres = await passeChiffres(pre, { x: xLot, y: haut, w: xAch - xLot, h: pre.height - haut }, reconnaitre);
    const pas = rangs.length > 1 ? (centre(rangs.at(-1).ligne.bbox) - centre(rangs[0].ligne.bbox)) / (rangs.length - 1) : 100;
    annonces = rangs.map(r => {
      const c = proche(chiffres, centre(r.ligne.bbox), pas / 3);
      if (!c) return { lot: r.lot, prix: null, sur: false };
      const { lot, texte } = separerLot(c);
      const n = nombre(texte);
      return { lot: r.lot ?? lot, prix: n?.valeur ?? null, sur: !!n?.valide };
    });
  }
  return { titre, niveau, prixMoyen: pm ? nombre(pm[1]).valeur : null, annonces };
}

// ---------- courbe 30 jours ----------
// Lue sans masquage du jaune : l'onglet sélectionné (24 heures / 7 jours / 30 jours) est écrit en jaune.
// On le repère à la part de pixels jaunes sous chaque libellé, dans l'image d'origine.
function partJaune(orig, b, echelle) {
  if (!orig) return 0;
  const x0 = Math.max(0, Math.floor(b.x0 / echelle)), x1 = Math.min(orig.width, Math.ceil(b.x1 / echelle));
  const y0 = Math.max(0, Math.floor(b.y0 / echelle)), y1 = Math.min(orig.height, Math.ceil(b.y1 / echelle));
  let n = 0, j = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = (y * orig.width + x) * 4, r = orig.data[k], g = orig.data[k + 1], bl = orig.data[k + 2];
    n++; if (r > 150 && g > 120 && bl < 120 && r - bl > 60) j++;
  }
  return n ? j / n : 0;
}

export async function lireCourbe(pre, reconnaitre, orig = null, echelle = 2) {
  const lignes = rangees(await reconnaitre(pre, {}));
  const texte = lignes.map(l => l.texte).join('\n');
  const { titre, niveau } = titreEtNiveau(lignes);
  // seul le nombre collé à « articles vendus » (1 ou 2 groupes), pas les chiffres du prix moyen juste avant
  const vendus = texte.match(/(\d{1,3}(?:[ \u00a0]\d{3})?)\s*articles?\s*vendus?/i);
  const moyen = texte.match(/moyen\s*:?\s*(\d[\d \u00a0]*)/i);

  // Onglets : sur la ligne qui contient « heures », les 3 premiers libellés avant « Prix ».
  // Un libellé se termine sur un mot qui contient des lettres (« 24 heures », « 7jours », « 30 jours »),
  // quelle que soit l'orthographe lue. L'onglet actif est le libellé le plus jaune.
  const rangeeOnglets = lignes.find(l => /heure/i.test(l.texte));
  const libelles = [];
  if (rangeeOnglets) {
    let cour = [];
    for (const m of rangeeOnglets.mots) {
      if (/prix|m.dian/i.test(m.texte) || libelles.length === 3) break;
      if (!/[0-9A-Za-zÀ-ÿ]/.test(m.texte)) continue;
      cour.push(m);
      if (/[A-Za-zÀ-ÿ]{3,}/.test(m.texte)) { libelles.push(cour); cour = []; }
    }
  }
  const jaune = libelles.map(ms => Math.max(...ms.map(m => partJaune(orig, m.bbox, echelle))));
  const iActif = jaune.length ? jaune.indexOf(Math.max(...jaune)) : -1;
  const trenteJours = orig && libelles.length === 3 ? iActif === 2 && jaune[2] > 0.03 : /30\s*jours/i.test(texte);

  return {
    titre, niveau,
    vendus: vendus ? nombre(vendus[1]).valeur : null,
    moyen: moyen ? nombre(moyen[1]).valeur : null,
    trenteJours, onglets: jaune.map(x => Math.round(x * 100) / 100),
  };
}

const LECTEURS = { liste: lireListe, detail: lireDetail, courbe: lireCourbe };

// Agrandissement : ×2 sur une capture Retina pleine résolution (~2 880 px de large), ×4 sur une capture réduite.
export const echelleAuto = largeurImage => (largeurImage >= 2400 ? 2 : largeurImage >= 1600 ? 3 : 4);

export async function lireEcran(type, img, zone, reconnaitre, opts = {}) {
  opts = { echelle: echelleAuto(img.width), ...opts };
  if (type === 'courbe') {
    const echelle = opts.echelle;
    const pre = pretraiter(img, zone, { ...opts, masquerJaune: false });
    return lireCourbe(pre, reconnaitre, recadrer(img, zone), echelle);
  }
  const pre = pretraiter(img, zone, opts);
  return LECTEURS[type](pre, reconnaitre);
}
