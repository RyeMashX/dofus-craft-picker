// Ventes : une ligne par exemplaire mis en vente (deux Écharpes = deux lignes, chacune avec son prix).
//
// base.ventes = [{ uid, id, statut, dateMiseEnVente, prix, coutCraft, frais, fraisManuel, coutFm, dateVente, changements }]
//   statut : 'draft'  ajouté depuis le Craft, chiffres à vérifier
//            'valide' prix et coûts vérifiés à la main (ou lus à l'HDV par OCR)
//            'vendu'  sorti de la liste, visible dans le Bilan
// Marge = prix − coût du craft − frais de mise en vente − coût de FM.
// Frais (règle de l'HDV) : 2 % du prix initial, puis 1 % du nouveau prix à chaque changement de prix.
//   - en draft : recalculés à 2 % du prix à chaque modification (la ligne n'est pas encore figée) ;
//   - validée : ils ne bougent plus, sauf saisie manuelle ou « prix modifié » (changerPrix : + 1 % du nouveau prix).
//   changements = [{ date, ancien, prix, frais }] historique des changements de prix.
// Règle : tant qu'un item a au moins une ligne draft ou validée, il n'est pas proposé dans le plan de craft.

export const TAUX_FRAIS = 0.02, TAUX_CHANGEMENT = 0.01;
const ACTIFS = new Set(['draft', 'valide']);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fraisDe = prix => prix == null ? null : Math.round(prix * TAUX_FRAIS);

export const lignes = base => base.ventes ?? [];
export const actives = base => lignes(base).filter(l => ACTIFS.has(l.statut));
export const vendues = base => lignes(base).filter(l => l.statut === 'vendu');
export const lotsEnVente = (base, id) => actives(base).filter(l => l.id === Number(id)).length;
export const estEnVente = (base, id) => lotsEnVente(base, id) > 0;

export function marge(l) {
  if (l.prix == null) return null;
  return l.prix - (l.coutCraft ?? 0) - (l.frais ?? fraisDe(l.prix) ?? 0) - (l.coutFm ?? 0);
}
export const rendement = l => { const m = marge(l), c = (l.coutCraft ?? 0) + (l.coutFm ?? 0); return m == null || !c ? null : m / c; };

export function ajouterVente(base, { id, statut = 'draft', prix = null, coutCraft = null, coutFm = 0, date = Date.now() }) {
  const l = { uid: uid(), id: Number(id), statut, dateMiseEnVente: date, prix, coutCraft, frais: fraisDe(prix), fraisManuel: false, coutFm, dateVente: null };
  (base.ventes ??= []).push(l);
  return l;
}

export const trouverLigne = (base, u) => lignes(base).find(l => l.uid === u);

// Modifie un champ (correction). En draft, changer le prix recalcule les frais à 2 %, sauf saisie manuelle ;
// une ligne validée garde ses frais (pour un vrai changement de prix à l'HDV : changerPrix).
// Repasser une ligne en draft recalcule ses frais à 2 % du prix (sauf saisie manuelle).
export function majLigne(base, u, champ, valeur) {
  const l = trouverLigne(base, u);
  if (!l) return null;
  if (champ === 'frais') { l.fraisManuel = valeur != null; l.frais = valeur ?? fraisDe(l.prix); }
  else {
    l[champ] = valeur;
    if (l.statut === 'draft' && !l.fraisManuel && (champ === 'prix' || champ === 'statut')) l.frais = fraisDe(l.prix);
  }
  return l;
}

// Changement de prix à l'HDV : nouveau prix et + 1 % du nouveau prix dans les frais (une ligne draft recalcule simplement ses 2 %)
export function changerPrix(base, u, prix, maintenant = Date.now()) {
  const l = trouverLigne(base, u);
  if (!l || prix == null || prix === l.prix) return l;
  if (l.statut === 'draft') return majLigne(base, u, 'prix', prix);
  const sup = Math.round(prix * TAUX_CHANGEMENT);
  (l.changements ??= []).push({ date: maintenant, ancien: l.prix, prix, frais: sup });
  l.prix = prix;
  l.frais = (l.frais ?? 0) + sup;
  return l;
}
export const supprimerLigne = (base, u) => { base.ventes = lignes(base).filter(l => l.uid !== u); };
export function marquerVendu(base, u, date = Date.now()) { const l = trouverLigne(base, u); if (l) { l.statut = 'vendu'; l.dateVente = date; } return l; }
export function remettreEnVente(base, u) { const l = trouverLigne(base, u); if (l) { l.statut = 'valide'; l.dateVente = null; } return l; }

// ---------- import d'une capture « Mes ventes » ----------
// identifie = { lignes: [{ id, nom, prix }] }. coutDe(id) donne le coût de craft estimé d'après la base.
// - item sans ligne active : nouvelle ligne « validée » (prix lu, coûts estimés) ;
// - une ligne active du même item au même prix : c'est la même annonce, rien à faire ;
// - sinon : à trancher par l'utilisateur (fusionner avec une ligne existante ou en créer une).
// Une même annonce vue deux fois (captures qui se chevauchent) n'est traitée qu'une fois.
export function importerCapture(base, identifie, coutDe, maintenant = Date.now()) {
  const res = { ajoutees: [], connues: 0, aTrancher: [], ignorees: 0 };
  const vues = new Set();
  const avant = actives(base); // lignes connues avant cette capture : deux exemplaires lus sur le même écran sont deux lignes
  for (const a of identifie.lignes) {
    if (a.id == null) { res.ignorees++; continue; }
    const cle = `${a.id}|${a.prix}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    const existantes = avant.filter(l => l.id === a.id);
    if (existantes.some(l => l.prix === a.prix)) { res.connues++; continue; }
    if (!existantes.length) {
      res.ajoutees.push(ajouterVente(base, { id: a.id, statut: 'valide', prix: a.prix, coutCraft: coutDe(a.id), coutFm: fmDe(base, a.id), date: maintenant }));
      continue;
    }
    res.aTrancher.push({ id: a.id, nom: a.nom, prix: a.prix });
  }
  return res;
}

// Résolution : fusion = l'annonce suivie a changé de prix à l'HDV (+ 1 % du nouveau prix si la ligne est validée)
export const fusionner = (base, u, prix, maintenant = Date.now()) => changerPrix(base, u, prix, maintenant);
// statut : 'valide' pour une annonce lue à l'HDV, 'draft' pour un ajout à la main (à vérifier avant de valider)
export const nouvelleLigne = (base, id, prix, coutDe, maintenant = Date.now(), statut = 'valide') =>
  ajouterVente(base, { id, statut, prix, coutCraft: coutDe(id), coutFm: fmDe(base, id), date: maintenant });

// Ancienne liste « en vente » (simples compteurs) → lignes validées sans prix
export function migrerVentes(base, coutDe = () => null) {
  if (!base.enVente) return base;
  for (const [id, n] of Object.entries(base.enVente.items ?? {})) {
    for (let k = 0; k < n; k++) ajouterVente(base, { id, statut: 'valide', prix: null, coutCraft: coutDe(Number(id)), date: base.enVente.date ?? Date.now() });
  }
  delete base.enVente;
  return base;
}

// ---------- coût de FM estimé ----------
// Moyenne des coûts de FM renseignés sur les exemplaires vendus du même item ; null (n/a) sans donnée.
// Un coût de FM à 0 est traité comme non renseigné (c'est la valeur par défaut d'une ligne).
export function coutFmEstime(base, id) {
  const v = vendues(base).filter(l => l.id === Number(id) && (l.coutFm ?? 0) > 0);
  if (!v.length) return null;
  return { valeur: Math.round(v.reduce((s, l) => s + l.coutFm, 0) / v.length), n: v.length };
}
const fmDe = (base, id) => coutFmEstime(base, id)?.valeur ?? null;

// ---------- historique des prix ----------
// Supprimer le changement k (saisi par erreur) : ses frais (1 %) sont retirés ; si c'était le dernier,
// la ligne reprend le prix d'avant ; sinon le changement suivant repart du prix d'avant.
export function supprimerChangement(base, u, k) {
  const l = trouverLigne(base, u), c = l?.changements?.[k];
  if (!c) return l;
  l.frais = Math.max(0, (l.frais ?? 0) - (c.frais ?? 0));
  if (k === l.changements.length - 1) l.prix = c.ancien;
  else l.changements[k + 1].ancien = c.ancien;
  l.changements.splice(k, 1);
  return l;
}

// Prix initial = prix d'avant le premier changement à l'HDV (les corrections ne comptent pas).
export const prixInitial = l => l.changements?.length ? l.changements[0].ancien : l.prix;
export const nbChangements = l => l.changements?.length ?? 0;
export const historiquePrix = l => l.prix == null ? [] : [{ date: l.dateMiseEnVente, prix: prixInitial(l) }, ...(l.changements ?? []).map(c => ({ date: c.date, prix: c.prix }))];
// Écart du prix actuel (ou de vente) au prix initial, en fraction (−0,12 = 12 % plus bas)
export const ecartPrix = l => { const i = prixInitial(l); return i && l.prix != null ? (l.prix - i) / i : null; };

// Par item vendu : nombre de ventes, changements de prix moyens, écart moyen final / initial, délai moyen
export function prixParItem(base) {
  const m = new Map();
  for (const l of vendues(base).filter(x => x.prix != null)) {
    const a = m.get(l.id) ?? { id: l.id, ventes: 0, changements: 0, ecarts: [], delais: [], prix: 0, marge: 0, couts: 0, lignes: [] };
    a.ventes++; a.changements += nbChangements(l); a.lignes.push(l);
    a.prix += l.prix; a.marge += marge(l) ?? 0; a.couts += (l.coutCraft ?? 0) + (l.coutFm ?? 0);
    const e = ecartPrix(l); if (e != null) a.ecarts.push(e);
    if (l.dateVente && l.dateMiseEnVente) a.delais.push((l.dateVente - l.dateMiseEnVente) / 864e5);
    m.set(l.id, a);
  }
  const moy = t => t.length ? t.reduce((s, x) => s + x, 0) / t.length : null;
  return [...m.values()].map(a => ({
    id: a.id, ventes: a.ventes, changementsMoyens: a.changements / a.ventes, ecartMoyen: moy(a.ecarts), delaiMoyen: moy(a.delais),
    prixMoyen: a.prix / a.ventes, margeMoyenne: a.marge / a.ventes, rendement: a.couts ? a.marge / a.couts : null,
    lignes: a.lignes.sort((x, y) => (y.dateVente ?? 0) - (x.dateVente ?? 0)),
  }))
    .sort((x, y) => y.changementsMoyens - x.changementsMoyens || (x.ecartMoyen ?? 0) - (y.ecartMoyen ?? 0));
}

// ---------- bilan ----------
export function bilan(base) {
  const v = vendues(base).filter(l => l.prix != null);
  const somme = f => v.reduce((s, l) => s + (f(l) ?? 0), 0);
  const delais = v.filter(l => l.dateVente && l.dateMiseEnVente).map(l => (l.dateVente - l.dateMiseEnVente) / 864e5);
  const ca = somme(l => l.prix), mg = somme(marge), couts = somme(l => (l.coutCraft ?? 0) + (l.coutFm ?? 0));
  const parMois = new Map();
  for (const l of v) {
    const d = new Date(l.dateVente ?? l.dateMiseEnVente), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = parMois.get(k) ?? { mois: k, ventes: 0, ca: 0, marge: 0 };
    m.ventes++; m.ca += l.prix; m.marge += marge(l) ?? 0;
    parMois.set(k, m);
  }
  return {
    ventes: v.length, ca, marge: mg, rendement: couts ? mg / couts : null,
    delaiMoyen: delais.length ? delais.reduce((s, x) => s + x, 0) / delais.length : null,
    // prix : combien de fois il a fallu le changer, et de combien le prix final s'écarte du prix initial
    changementsMoyens: v.length ? v.reduce((s, l) => s + nbChangements(l), 0) / v.length : null,
    sansChangement: v.length ? v.filter(l => !nbChangements(l)).length / v.length : null,
    ecartMoyen: (() => { const e = v.map(ecartPrix).filter(x => x != null); return e.length ? e.reduce((s, x) => s + x, 0) / e.length : null; })(),
    parMois: [...parMois.values()].sort((a, b) => b.mois.localeCompare(a.mois)),
  };
}
