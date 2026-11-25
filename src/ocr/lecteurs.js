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

import { pretraiter, recadrer, marge, redimensionner } from './image.js';

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
  // titre : le nom est aligné à gauche sur la ligne « Niv. » ; on prend la première rangée au-dessus dont les mots
  // alignés ont des lettres (2 suffisent : « Or »), sans les restes d'icône à gauche
  const niv = lignes[i], h = niv.bbox.y1 - niv.bbox.y0, x0 = (niv.mots.find(w => /niv/i.test(w.texte)) ?? niv.mots[0])?.bbox.x0 ?? niv.bbox.x0;
  for (let k = i - 1; k >= 0; k--) {
    const ms = (lignes[k].mots ?? []).filter(w => w.bbox.x0 >= x0 - 1.5 * h);
    const t = lettres(ms.map(w => w.texte).join(' '));
    if (ms.length && Math.abs(ms[0].bbox.x0 - x0) <= 1.5 * h && t.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 2) return { titre: t, niveau };
  }
  // repli : première rangée au-dessus avec au moins 3 lettres
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
  if (m.length >= 2 && /^(1|10|100|1000)$/.test(m[0].texte)) {
    const blanc = m[1].bbox.x0 - m[0].bbox.x1;
    const hauteur = m[0].bbox.y1 - m[0].bbox.y0;
    if (blanc > 2.5 * hauteur) return { lot: Number(m[0].texte), texte: m.slice(1).map(x => x.texte).join(' ') };
  }
  return { lot: null, texte: rangee.texte };
}

// L'HDV trie les annonces d'un même lot par prix croissant. Quand les deux passes ne lisent pas le même prix,
// on garde celui qui respecte cet ordre entre la rangée sûre précédente et la suivante (même lot).
export function departager(annonces) {
  const memeLot = (a, b) => (a.lot ?? 1) === (b.lot ?? 1);
  annonces.forEach((a, i) => {
    if (!a.conflit) return;
    const avant = annonces.slice(0, i).reverse().find(b => memeLot(a, b) && b.prix != null && b.sur);
    const apres = annonces.slice(i + 1).find(b => memeLot(a, b) && b.prix != null && b.sur);
    const ok = a.conflit.filter(v => (!avant || v >= avant.prix) && (!apres || v <= apres.prix));
    if (ok.length === 1) { a.prix = ok[0]; a.sur = true; a.conflit = null; }
  });
  for (const a of annonces) delete a.conflit;
  return annonces;
}

async function lireColonnes(pre, lignes, rangs, motLot, reconnaitre) {
  const tete = lignes.find(l => l.mots.includes(motLot));
  const hLot = motLot.bbox.y1 - motLot.bbox.y0;
  const med = t => { t = t.filter(v => v != null).sort((a, b) => a - b); return t.length ? t[Math.floor(t.length / 2)] : null; };
  // bord droit : juste avant le symbole kama (le mot entre le prix et ACHETER), sinon avant ACHETER
  const kama = med(rangs.map(r => {
    const m = r.ligne.mots, k = m.findIndex(w => /ACHETER/i.test(w.texte));
    const avant = k > 0 ? m[k - 1] : null;
    return avant && !/\d{3}/.test(avant.texte) ? avant.bbox.x0 : null;
  }));
  const xAch = med(rangs.map(r => r.xAcheter));
  const x0 = Math.max(0, motLot.bbox.x0 - hLot), x1 = (kama ?? xAch ?? pre.width) - 4;
  const pas = rangs.length > 1 ? (centre(rangs.at(-1).ligne.bbox) - centre(rangs[0].ligne.bbox)) / (rangs.length - 1) : 2 * hLot;
  const y0 = tete ? tete.bbox.y1 + 2 : Math.max(0, rangs[0].ligne.bbox.y0 - pas / 2);
  const y1 = Math.min(pre.height, rangs.at(-1).ligne.bbox.y1 + pas * 0.4);
  if (x1 - x0 < 4 * hLot || y1 <= y0) return null;
  return lireLots(marge(recadrer(pre, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), Math.round(hLot)), reconnaitre);
}

export async function lireDetail(pre, reconnaitre) {
  const lignes = rangees(await reconnaitre(pre, {}));
  const { titre, niveau } = titreEtNiveau(lignes);
  const pm = lignes.map(l => l.texte.match(/prix\s*moyen\s*:?\s*(\d[\d  ]*)/i)).find(Boolean);

  // L'icône de l'objet, à gauche de chaque rangée, peut être lue comme des chiffres (« 3 », « 143 ») :
  // on ignore tout ce qui commence avant l'en-tête de colonne « Lot ».
  const motLot = lignes.flatMap(l => /prix/i.test(l.texte) ? l.mots : []).find(w => /^lot/i.test(w.texte));
  const xMin = motLot ? motLot.bbox.x0 - (motLot.bbox.y1 - motLot.bbox.y0) : -Infinity;

  // Rangée d'annonce : [icône] [lot] [prix en groupes de 3 chiffres] ACHETER.
  // Le lot n'est que le PREMIER nombre de la rangée, et seulement s'il est suivi d'un grand blanc :
  // un groupe du prix (« 9 100 000 ») ne doit jamais être pris pour un lot de 100.
  const rangs = lignes.filter(l => /ACHETER/i.test(l.texte)).map(l => {
    const acheter = l.mots.find(w => /ACHETER/i.test(w.texte));
    const xAch = acheter?.bbox.x0 ?? Infinity;
    // mots qui commencent par un chiffre (un prix peut être collé à un reste d'icône : « 2299902: »)
    const nums = l.mots.filter(w => /^\d/.test(w.texte) && w.bbox.x1 < xAch && w.bbox.x0 >= xMin);
    const h = nums.length ? nums[0].bbox.y1 - nums[0].bbox.y0 : 0;
    // « 1 000 » peut être lu en deux mots rapprochés : on les recolle en un lot de 1000
    if (nums.length >= 2 && nums[0].texte === '1' && nums[1].texte === '000' && nums[1].bbox.x0 - nums[0].bbox.x1 < 1.2 * h) {
      nums.splice(0, 2, { texte: '1000', bbox: { ...nums[0].bbox, x1: nums[1].bbox.x1 } });
    }
    const estLot = nums.length >= 2 && /^(1|10|100|1000)$/.test(nums[0].texte) && nums[1].bbox.x0 - nums[0].bbox.x1 > 2.5 * h;
    // (le prix de secours ne garde que les chiffres de chaque mot)
    const prixMots = estLot ? nums.slice(1) : nums;
    return {
      ligne: l, lot: estLot ? Number(nums[0].texte) : null, xLot: estLot ? nums[0].bbox.x1 : null, premier: nums[0] ?? null,
      xPrix: prixMots[0]?.bbox.x0 ?? null, xAcheter: acheter?.bbox.x0 ?? null,
      texte1: prixMots.map(w => w.texte.replace(/\D+$/, '')).join(' '), // prix lu en première passe (secours)
    };
  });

  let annonces = [];
  // d'abord : relecture des seules colonnes Lot et Prix, si on retrouve exactement les mêmes rangées
  const auto = motLot && rangs.length ? await lireColonnes(pre, lignes, rangs, motLot, reconnaitre) : null;
  if (auto && auto.length === rangs.length) annonces = auto;
  else if (rangs.length) {
    const med = l => { const t = l.filter(v => v != null).sort((x, y) => x - y); return t.length ? t[Math.floor(t.length / 2)] : null; };
    const xLot = med(rangs.map(r => r.xLot));
    // seconde chance : un 1 / 10 / 100 seul, aligné sur la colonne Lot des autres rangées (prix illisible en première passe)
    if (xLot != null) for (const r of rangs) {
      if (r.lot == null && r.premier && /^(1|10|100|1000)$/.test(r.premier.texte) && Math.abs(r.premier.bbox.x1 - xLot) < 50) r.lot = Number(r.premier.texte);
    }
    const xPrix = Math.min(...rangs.map(r => r.xPrix ?? Infinity));
    const x0 = Math.max(xLot != null ? xLot + 8 : Number.isFinite(xPrix) ? Math.max(0, xPrix - 30) : 0, motLot ? motLot.bbox.x1 : 0);
    const xAch = Math.min(...rangs.map(r => r.xAcheter ?? pre.width)) - 8;
    const haut = Math.max(0, rangs[0].ligne.bbox.y0 - 20);
    const chiffres = await passeChiffres(pre, { x: x0, y: haut, w: xAch - x0, h: pre.height - haut }, reconnaitre);
    const pas = rangs.length > 1 ? (centre(rangs.at(-1).ligne.bbox) - centre(rangs[0].ligne.bbox)) / (rangs.length - 1) : 100;
    annonces = rangs.map(r => {
      const c = proche(chiffres, centre(r.ligne.bbox), pas / 3);
      const deux = c ? separerLot(c) : { lot: null, texte: '' };
      let n = deux.texte ? nombre(deux.texte) : null;
      // secours : prix de la première passe si la seconde est vide ou incohérente
      const un = r.texte1 ? nombre(r.texte1) : null;
      // les deux passes lisent un prix valide mais différent (un 9 lu 3…) : départagé plus bas
      // (« 2950 001 » : espace des milliers manquée en première passe, plausible ici)
      const unPlausible = un && (un.valide || /^\d{4}( \d{3})+$/.test(r.texte1.trim()));
      const cands = [...new Set([n?.valide ? n.valeur : null, unPlausible ? un.valeur : null].filter(v => v != null))];
      // passes en désaccord, ou une seule lecture plausible mais pas sûre : départagé par l'ordre des prix
      const conflit = cands.length > 1 || (cands.length === 1 && !n?.valide) ? cands : null;
      if ((!n || !n.valide) && un?.valide) n = un;
      if (conflit && !n?.valide) n = { valeur: cands[0], valide: false };
      return { lot: r.lot ?? deux.lot, prix: n?.valeur ?? null, sur: !!n?.valide && !conflit, conflit };
    });
    departager(annonces);
  }
  return { titre, niveau, prixMoyen: pm ? nombre(pm[1]).valeur : null, annonces };
}

// ---------- colonnes Lot et Prix seules ----------
// Le panneau détail change de place et de hauteur selon le nombre d'annonces : pas de zone fixe. On repère
// l'en-tête « Lot » et les boutons ACHETER sur la première lecture, puis on relit un rectangle qui ne contient
// que les colonnes Lot et Prix (sans icône, sans symbole kama, sans ACHETER) : beaucoup moins de parasites.
// Une rangée = une ligne avec des chiffres. Le lot est à gauche (premier ~45 % de la largeur), le prix à droite.
// Tesseract confond parfois 9 et 3 selon la taille du texte : on lit la même image à trois tailles
// (×1, ×1,5, ×0,75) et on vote, rangée par rangée. Sans majorité, l'ordre des prix départage (departager).
// La dernière rangée, coupée par le bas de la zone (ou nettement plus basse que les autres), est ignorée.
export async function lireLots(pre, reconnaitre, avecPositions = false) {
  const coupe = 0.45 * pre.width;
  const decouper = (lignes, k) => lignes.map(l => {
    const mots = l.mots.filter(w => /\d/.test(w.texte));
    const lotMots = mots.filter(w => w.bbox.x1 / k < coupe), prixMots = mots.filter(w => w.bbox.x0 / k >= coupe);
    const lotTxt = lotMots.map(w => w.texte.replace(/\D/g, '')).join('');
    const b = l.bbox;
    return {
      bbox: { x0: b.x0 / k, x1: b.x1 / k, y0: b.y0 / k, y1: b.y1 / k },
      lot: /^(1|10|100|1000)$/.test(lotTxt) ? Number(lotTxt) : null,
      prix: prixMots.map(w => w.texte.replace(/\D/g, '')).filter(Boolean).join(' '),
    };
  }).filter(r => r.prix);
  const passes = [];
  for (const k of [1, 1.5, 0.75]) passes.push(decouper(rangees(await reconnaitre(k === 1 ? pre : redimensionner(pre, k), { chiffres: true })), k));
  const base = passes.reduce((a, b) => (b.length > a.length ? b : a));
  if (!base.length) return avecPositions ? { annonces: [], bbox: [] } : [];
  const hauteurs = base.map(r => r.bbox.y1 - r.bbox.y0).sort((a, b) => a - b), hMed = hauteurs[Math.floor(hauteurs.length / 2)];
  const rangs = base.filter(r => r.bbox.y1 < pre.height - 2 && r.bbox.y1 - r.bbox.y0 > 0.6 * hMed);
  const pas = rangs.length > 1 ? (centre(rangs.at(-1).bbox) - centre(rangs[0].bbox)) / (rangs.length - 1) : 100;
  const vote = vals => {
    const c = new Map(); for (const v of vals) if (v != null) c.set(v, (c.get(v) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  };
  const annonces = rangs.map(r => {
    const lus = passes.map(ps => proche(ps, centre(r.bbox), pas / 3)).filter(Boolean);
    r.lus = lus;
    const prix = lus.map(x => { const n = nombre(x.prix); return n && (n.valide || /^\d{4}( \d{3})+$/.test(x.prix)) ? n.valeur : null; });
    const v = vote(prix), lots = vote(lus.map(x => x.lot));
    const lot = lots[0]?.[0] ?? null;
    if (!v.length) return { lot, prix: nombre(r.prix)?.valeur ?? null, sur: false, conflit: null };
    if (v[0][1] >= 2 && (v.length === 1 || v[0][1] > v[1][1])) return { lot, prix: v[0][0], sur: true, conflit: null };
    return { lot, prix: v[0][0], sur: false, conflit: v.map(x => x[0]) };
  });
  if (avecPositions) return { annonces, bbox: rangs.map(r => r.bbox) };
  return departager(annonces);
}

// ---------- lecture en deux zones (nom, valeur), réglées une fois par mode ----------
export async function lireNom(pre, reconnaitre) {
  const lignes = rangees(await reconnaitre(pre, {}));
  const t = titreEtNiveau(lignes);
  if (t.titre) return t;
  // zone sans la ligne « Niv. » : le nom est la première ligne qui contient des lettres (2 suffisent : « Or »)
  const l = lignes.filter(x => !RE_NIVEAU.test(x.texte)).map(x => lettres(x.texte)).find(x => x.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 2);
  return { titre: l ?? null, niveau: t.niveau };
}

// Zone valeur des prix : elle couvre la hauteur maximale de la liste, donc parfois du décor sous un panneau court
// (ou le prix moyen au-dessus). On ne garde que les rangées entre la première et la dernière qui ont un lot lisible
// (1, 10, 100, 1000), et on s'arrête au premier écart nettement plus grand que l'espacement des rangées.
export function garderRangees(annonces, bbox) {
  // rangée coupée par le bord du panneau : prix illisible ou nul
  const ok = annonces.map((a, i) => (a.prix > 0 ? i : -1)).filter(i => i >= 0);
  annonces = ok.map(i => annonces[i]); bbox = ok.map(i => bbox[i]);
  const avecLot = annonces.map((a, i) => (a.lot != null ? i : -1)).filter(i => i >= 0);
  if (!avecLot.length) return annonces;
  let garde = annonces.slice(avecLot[0], avecLot.at(-1) + 1).map((a, k) => ({ a, b: bbox[avecLot[0] + k] }));
  if (garde.length > 2) {
    const ecarts = garde.slice(1).map((x, k) => x.b.y0 - garde[k].b.y0).sort((u, v) => u - v);
    const pas = ecarts[Math.floor(ecarts.length / 2)];
    const fin = garde.findIndex((x, k) => k > 0 && x.b.y0 - garde[k - 1].b.y0 > 1.6 * pas);
    if (fin > 0) garde = garde.slice(0, fin);
  }
  return garde.map(x => x.a);
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

// ---------- mes ventes (onglet Vente de l'HDV) ----------
// Colonnes : [icône] Nom (1 ou 2 lignes) · durée · Lot · Prix · case à cocher ; pied « 55/570 lots en vente ».
// Une annonce = une rangée avec un prix dans la colonne Prix. Les noms sont relus seuls dans leur colonne.
export async function lireVentes(pre, reconnaitre) {
  const W = pre.width;
  const lignes = rangees(await reconnaitre(pre, {}));
  const texte = lignes.map(l => l.texte).join('\n');
  const tot = texte.match(/(\d{1,4})\s*\/\s*\d{1,4}\s*lots?/i);
  const pied = lignes.find(l => /lots?\s+en\s+vente|valeur\s+estim/i.test(l.texte));
  const bas = pied ? pied.bbox.y0 - 4 : pre.height;
  const haut = Math.max(0, (lignes.find(l => /\bNom\b|Prix/i.test(l.texte))?.bbox.y1 ?? 0) + 4);
  if (bas - haut < 20) return { lignes: [], total: tot ? Number(tot[1]) : null };

  // prix : colonne de droite, chiffres seuls
  const prixZ = { x: Math.round(0.66 * W), y: haut, w: Math.round(0.27 * W), h: bas - haut };
  const prix = (await passeChiffres(pre, prixZ, reconnaitre))
    .map(r => ({ r, n: nombre(r.texte) }))
    .filter(x => x.n && x.n.valeur >= 100);
  // noms : colonne de gauche, sans les icônes
  const nomZ = { x: Math.round(0.075 * W), y: haut, w: Math.round(0.345 * W), h: bas - haut };
  const noms = rangees(await reconnaitre(recadrer(pre, nomZ), {}))
    .map(l => ({ ...l, cy: centre(l.bbox) + nomZ.y, t: lettres(l.texte) }))
    .filter(l => l.t.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 2);

  const ys = prix.map(x => centre(x.r.bbox));
  const pas = ys.length > 1 ? (ys.at(-1) - ys[0]) / (ys.length - 1) : pre.height;
  return {
    total: tot ? Number(tot[1]) : null,
    lignes: prix.map(({ r, n }, i) => ({
      prix: n.valeur, sur: n.valide,
      textes: noms.filter(l => Math.abs(l.cy - ys[i]) < pas * 0.48).sort((a, b) => a.cy - b.cy).map(l => l.t),
    })),
  };
}

const LECTEURS = { liste: lireListe, detail: lireDetail, courbe: lireCourbe, ventes: lireVentes };

// Agrandissement : ×2 sur une capture Retina pleine résolution (~2 880 px de large), ×4 sur une capture réduite.
export const echelleAuto = largeurImage => (largeurImage >= 2400 ? 2 : largeurImage >= 1600 ? 3 : 4);

export async function lireEcran(type, img, zone, reconnaitre, opts = {}) {
  opts = { echelle: echelleAuto(img.width), ...opts };
  // deux zones réglées par l'utilisateur : nom, puis valeur (colonnes Lot et Prix, ou onglets + articles vendus)
  if (zone?.nom && zone?.valeur) {
    const nom = await lireNom(pretraiter(img, zone.nom, opts), reconnaitre);
    if (type === 'courbe') {
      const c = await lireCourbe(pretraiter(img, zone.valeur, { ...opts, masquerJaune: false }), reconnaitre, recadrer(img, zone.valeur), opts.echelle);
      return { ...c, titre: nom.titre ?? c.titre, niveau: nom.niveau ?? c.niveau };
    }
    const pre = pretraiter(img, zone.valeur, opts);
    const { annonces, bbox } = await lireLots(marge(pre, 16), reconnaitre, true);
    return { ...nom, prixMoyen: null, annonces: departager(garderRangees(annonces, bbox)) };
  }
  if (type === 'courbe') {
    const echelle = opts.echelle;
    const pre = pretraiter(img, zone, { ...opts, masquerJaune: false });
    return lireCourbe(pre, reconnaitre, recadrer(img, zone), echelle);
  }
  const pre = pretraiter(img, zone, opts);
  return LECTEURS[type](pre, reconnaitre);
}
