// Rapproche une lecture OCR du catalogue et l'enregistre dans la base de prix.

import { trouver } from './correspondance.js';
import { majVolume, majPrixItem, majPrixMoyenItem, majRessource, majPrixMoyenRessource } from '../base.js';

function candidats(catalogue) {
  return [
    ...catalogue.items.map(i => ({ id: i.id, nom: i.nom, niveau: i.niveau, genre: 'item' })),
    ...Object.values(catalogue.ressources).map(r => ({ id: r.id, nom: r.nom, niveau: r.niveau, genre: 'ressource' })),
  ];
}

// Essaie chaque ligne de texte et chaque paire de lignes consécutives (noms sur 2 lignes)
function meilleur(textes, liste, niveau) {
  const essais = [...textes];
  for (let i = 0; i + 1 < textes.length; i++) essais.push(`${textes[i]} ${textes[i + 1]}`);
  let best = null;
  for (const t of essais) {
    const r = trouver(t, liste, { niveau });
    if (r && (!best || r.confiance > best.confiance)) best = r;
  }
  return best;
}

export function identifier(type, lecture, catalogue) {
  const liste = candidats(catalogue);
  if (type === 'liste') {
    return lecture.map(r => {
      const m = meilleur(r.textes, liste, r.niveau);
      return m ? { ...m.candidat, confiance: m.confiance, prixMoyen: r.prixMoyen, sur: r.sur }
        : { inconnu: r.textes.join(' / '), niveau: r.niveau, prixMoyen: r.prixMoyen };
    });
  }
  const m = lecture.titre ? meilleur([lecture.titre], liste, lecture.niveau) : null;
  if (!m) return { ...lecture, objet: null };
  const objet = { ...m.candidat, confiance: m.confiance };
  // ressource : lots illisibles déduits tout de suite (l'encart de lecture les affiche)
  const annonces = type === 'detail' && objet.genre === 'ressource' ? deduireLots(lecture.annonces) : lecture.annonces;
  return { ...lecture, annonces, objet };
}

// Lots illisibles (écrits petit, en gris) : on les déduit. L'HDV range les lots d'une ressource
// par taille croissante (1, 10, 100, 1000) et le prix unitaire reste du même ordre d'un lot à l'autre :
// on choisit les tailles croissantes, compatibles avec les lots lus, qui donnent les prix unitaires les plus proches.
export function deduireLots(annonces) {
  const rangs = annonces.filter(a => a.prix != null);
  if (!rangs.length || rangs.every(a => a.lot != null) || rangs.length > 4) return annonces;
  const tailles = [1, 10, 100, 1000];
  let best = null;
  const essayer = (i, depuis, choix) => {
    if (i === rangs.length) {
      const logs = rangs.map((a, k) => Math.log10(a.prix / choix[k]));
      const moy = logs.reduce((s, x) => s + x, 0) / logs.length;
      const ecart = logs.reduce((s, x) => s + (x - moy) ** 2, 0);
      if (!best || ecart < best.ecart) best = { ecart, choix: [...choix] };
      return;
    }
    for (let t = depuis; t < tailles.length; t++) {
      if (rangs[i].lot != null && rangs[i].lot !== tailles[t]) continue;
      essayer(i + 1, t + 1, [...choix, tailles[t]]);
    }
  };
  essayer(0, 0, []);
  if (!best) return annonces;
  return annonces.map(a => { const k = rangs.indexOf(a); return k < 0 || a.lot != null ? a : { ...a, lot: best.choix[k], deduit: true }; });
}

const f = n => n == null ? '-' : Math.round(n).toLocaleString('fr-FR');

// Enregistre dans la base. Retourne { enregistres: [...], ignores: [...] } pour affichage.
export function appliquer(base, type, identifie, date = Date.now()) {
  const enregistres = [], ignores = [];

  if (type === 'liste') {
    for (const r of identifie) {
      if (r.inconnu || r.prixMoyen == null) { ignores.push(r.inconnu ?? r.nom); continue; }
      (r.genre === 'item' ? majPrixMoyenItem : majPrixMoyenRessource)(base, r.id, r.prixMoyen, date);
      enregistres.push(`${r.nom} : prix moyen ${f(r.prixMoyen)}`);
    }
    return { enregistres, ignores };
  }

  const o = identifie.objet;
  if (!o) return { enregistres, ignores: [identifie.titre ?? 'titre illisible'] };

  if (type === 'courbe') {
    if (!identifie.trenteJours) ignores.push(`${o.nom} : onglet 30 jours non détecté`);
    else if (identifie.vendus == null) ignores.push(`${o.nom} : nb vendus illisible`);
    else if (o.genre === 'item') { majVolume(base, o.id, identifie.vendus, date); enregistres.push(`${o.nom} : ${identifie.vendus} vendus / 30 j`); }
  }

  if (type === 'detail') {
    if (o.genre === 'item') {
      // les équipements se vendent à l'unité : lot illisible = lot de 1
      const prix = identifie.annonces.filter(a => a.prix != null && (a.lot ?? 1) === 1).map(a => a.prix);
      if (prix.length) { majPrixItem(base, o.id, prix, date); enregistres.push(`${o.nom} : ${prix.length} annonces, min ${f(Math.min(...prix))}`); }
    } else {
      const ok = deduireLots(identifie.annonces).filter(a => a.prix != null && a.lot != null);
      const offre = {};
      for (const a of ok) offre[a.lot] = Math.min(offre[a.lot] ?? Infinity, a.prix);
      if (Object.keys(offre).length) { majRessource(base, o.id, offre, date); enregistres.push(`${o.nom} : x1 ${f(offre[1])} / x10 ${f(offre[10])} / x100 ${f(offre[100])}${offre[1000] ? ` / x1000 ${f(offre[1000])}` : ''}`); }
    }
    if (identifie.annonces.some(a => !a.sur)) ignores.push(`${o.nom} : certains prix à vérifier`);
  }

  if (identifie.prixMoyen != null && type !== 'liste') {
    (o.genre === 'item' ? majPrixMoyenItem : majPrixMoyenRessource)(base, o.id, identifie.prixMoyen, date);
  }
  return { enregistres, ignores };
}
