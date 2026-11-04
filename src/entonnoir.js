// L'entonnoir : à partir du catalogue et de la base de prix, dit quoi relever ensuite
// et classe les items dont toutes les données sont fraîches.
//
// Étapes :
//   1. items du focus (niveaux) craftables avec les métiers du joueur
//   2. volume frais requis (relevé toutes les 2 semaines) ; volume < min → écarté
//   3. prix de vente frais requis
//   4. prix frais de toutes les ressources de la recette
//   5. évaluation → éligibles triés par rendement

import { itemsCraftables, versMoteur, ressourcesARelever } from './catalogue.js';
import { fraicheur, offresFraiches } from './base.js';
import { prixVenteEstime, evaluerItem } from './marge.js';

export function etatEntonnoir(catalogue, base, p, maintenant = Date.now()) {
  const [nMin, nMax] = p.focusNiveaux;
  const focus = itemsCraftables(catalogue, p.metiers).filter(i => i.niveau >= nMin && i.niveau <= nMax);
  const offres = offresFraiches(base, p.validite.ressources, maintenant);

  const volumesARelever = [];
  const prixARelever = [];
  const ecartesVolume = [];
  const attenteRessources = [];
  const evalues = [];

  for (const it of focus) {
    const b = base.items[it.id] ?? {};
    if (fraicheur(b.volume, p.validite.volume, maintenant) !== 'frais') { volumesARelever.push(it); continue; }
    if (b.volume.valeur < p.volumeMin) { ecartesVolume.push(it); continue; }
    if (fraicheur(b.prix, p.validite.prixItem, maintenant) !== 'frais') { prixARelever.push(it); continue; }

    const prixVente = prixVenteEstime(b.prix.valeurs, p).estime;
    const item = versMoteur(it, catalogue, { volumeMois: b.volume.valeur, prixVente });
    const manquantes = it.recette.filter(r => !offres[r.id]);
    if (manquantes.length) { attenteRessources.push({ ...it, manquantes: manquantes.length }); continue; }

    evalues.push(evaluerItem(item, offres, p, 1));
  }

  // Ressources à relever : celles des items en attente, les plus partagées d'abord,
  // sans celles qui ont déjà un prix frais.
  const ressources = ressourcesARelever(attenteRessources, catalogue).filter(r => !offres[r.id]);

  const eligibles = evalues.filter(e => e.eligible).sort((a, b) => b.rendement - a.rendement);
  const ecartesMarge = evalues.filter(e => !e.eligible);

  return {
    focus: focus.length,
    volumesARelever, prixARelever, ecartesVolume,
    attenteRessources, ressources,
    eligibles, ecartesMarge,
  };
}
