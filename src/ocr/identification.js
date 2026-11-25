// Rapproche une lecture OCR du catalogue et l'enregistre dans la base de prix.

import { trouver } from './correspondance.js';
import { venduALUnite } from '../catalogue.js';
import { majVolume, majPrixItem, majPrixMoyenItem, majRessource, majPrixMoyenRessource } from '../base.js';

function candidats(catalogue) {
  return [
    ...catalogue.items.map(i => ({ id: i.id, nom: i.nom, niveau: i.niveau, genre: 'item' })),
    ...Object.values(catalogue.ressources).map(r => ({ id: r.id, nom: r.nom, niveau: r.niveau, genre: 'ressource', ...(venduALUnite(r, catalogue) ? { unite: true } : {}) })),
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
  if (type === 'ventes') {
    // seuls les équipements du catalogue comptent ; les autres annonces sont gardées « inconnues »
    const items = liste.filter(c => c.genre === 'item');
    return {
      total: lecture.total,
      lignes: lecture.lignes.map(l => {
        const m = meilleur(l.textes, items, null);
        return m ? { id: m.candidat.id, nom: m.candidat.nom, prix: l.prix, sur: l.sur, confiance: m.confiance }
          : { id: null, nom: l.textes.join(' ') || '?', prix: l.prix, sur: l.sur };
      }),
    };
  }
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
  // ressource vendue à l'unité (équipement) : des annonces de 1, pas des lots
  const annonces = type !== 'detail' ? lecture.annonces
    : objet.unite ? lecture.annonces.map(a => ({ ...a, lot: 1 }))
    : objet.genre === 'ressource' ? deduireLots(lecture.annonces) : lecture.annonces.map(a => ({ ...a }));
  // équipement (ou équipement utilisé comme ressource) : prix croissants
  const ordre = type === 'detail' && (objet.genre === 'item' || objet.unite) ? verifierOrdre(annonces) : [];
  return { ...lecture, annonces, objet, ...(ordre.length ? { ordre } : {}) };
}

// Lots d'une ressource : l'HDV affiche une ligne par taille, dans l'ordre 1, 10, 100, 1000. Avec n lignes, les tailles
// sont donc n tailles distinctes dans cet ordre (4 lignes : forcément 1, 10, 100, 1000 ; jamais 10 puis 1, ni deux 10).
// Parmi ces combinaisons, on garde celle qui contredit le moins les lots lus et dont les prix unitaires sont
// les plus proches d'une ligne à l'autre. Un lot corrigé ou déduit est marqué « deduit ».
export function deduireLots(annonces) {
  const rangs = annonces.filter(a => a.prix != null);
  if (!rangs.length || rangs.length > 4) return annonces;
  const tailles = [1, 10, 100, 1000];
  let best = null;
  const essayer = (i, depuis, choix) => {
    if (i === rangs.length) {
      const logs = rangs.map((a, k) => Math.log10(a.prix / choix[k]));
      const moy = logs.reduce((s, x) => s + x, 0) / logs.length;
      const ecart = logs.reduce((s, x) => s + (x - moy) ** 2, 0);
      // un lot vu par au moins 2 des 3 lectures pèse lourd : un x100 très cher reste un x100
      const desaccords = rangs.reduce((s, a, k) => s + (a.lot != null && a.lot !== choix[k] ? ((a.lotN ?? 1) >= 2 ? 5 : 0.3) : 0), 0);
      const cout = ecart + desaccords;
      if (!best || cout < best.cout) best = { cout, choix: [...choix] };
      return;
    }
    for (let t = depuis; t <= tailles.length - (rangs.length - i); t++) essayer(i + 1, t + 1, [...choix, tailles[t]]);
  };
  essayer(0, 0, []);
  return annonces.map(a => {
    const k = rangs.indexOf(a);
    if (k < 0 || a.lot === best.choix[k]) return a;
    return { ...a, lot: best.choix[k], deduit: true };
  });
}

// Annonces d'un équipement : prix croissants de haut en bas (égalités possibles). Une ligne moins chère que la
// précédente est forcément mal lue : elle n'est plus « sûre ». Retourne les numéros de ligne en cause (1 = la première).
export function verifierOrdre(annonces) {
  const enCause = [];
  let avant = null;
  annonces.forEach((a, i) => {
    if (a.prix == null) return;
    if (avant != null && a.prix < avant) { a.sur = false; enCause.push(i + 1); }
    else avant = a.prix;
  });
  return enCause;
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
    } else if (o.unite) {
      // équipement utilisé comme ressource : l'annonce la moins chère fait le prix du x1
      const prix = identifie.annonces.filter(a => a.prix != null).map(a => a.prix);
      if (prix.length) { majRessource(base, o.id, { 1: Math.min(...prix) }, date); enregistres.push(`${o.nom} : ${prix.length} annonces, min ${f(Math.min(...prix))}`); }
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
