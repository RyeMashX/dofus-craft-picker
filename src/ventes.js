// Ventes : une ligne par exemplaire mis en vente (deux Écharpes = deux lignes, chacune avec son prix).
//
// base.ventes = [{ uid, id, statut, dateMiseEnVente, prix, coutCraft, frais, fraisManuel, coutFm, dateVente }]
//   statut : 'draft'  ajouté depuis le Craft, chiffres à vérifier
//            'valide' prix et coûts vérifiés à la main (ou lus à l'HDV par OCR)
//            'vendu'  sorti de la liste, visible dans le Bilan
// Marge = prix − coût du craft − frais de mise en vente (2 % du prix par défaut) − coût de FM.
// Règle : tant qu'un item a au moins une ligne draft ou validée, il n'est pas proposé dans le plan de craft.

export const TAUX_FRAIS = 0.02;
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

// Modifie un champ. Changer le prix recalcule les frais, sauf s'ils ont été saisis à la main.
export function majLigne(base, u, champ, valeur) {
  const l = trouverLigne(base, u);
  if (!l) return null;
  if (champ === 'frais') { l.frais = valeur; l.fraisManuel = valeur != null; if (valeur == null) l.frais = fraisDe(l.prix); }
  else { l[champ] = valeur; if (champ === 'prix' && !l.fraisManuel) l.frais = fraisDe(valeur); }
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
      res.ajoutees.push(ajouterVente(base, { id: a.id, statut: 'valide', prix: a.prix, coutCraft: coutDe(a.id), coutFm: 0, date: maintenant }));
      continue;
    }
    res.aTrancher.push({ id: a.id, nom: a.nom, prix: a.prix });
  }
  return res;
}

// Résolution : fusion = l'annonce lue met à jour le prix d'une ligne existante
export const fusionner = (base, u, prix) => majLigne(base, u, 'prix', prix);
export const nouvelleLigne = (base, id, prix, coutDe, maintenant = Date.now()) =>
  ajouterVente(base, { id, statut: 'valide', prix, coutCraft: coutDe(id), coutFm: 0, date: maintenant });

// Ancienne liste « en vente » (simples compteurs) → lignes validées sans prix
export function migrerVentes(base, coutDe = () => null) {
  if (!base.enVente) return base;
  for (const [id, n] of Object.entries(base.enVente.items ?? {})) {
    for (let k = 0; k < n; k++) ajouterVente(base, { id, statut: 'valide', prix: null, coutCraft: coutDe(Number(id)), date: base.enVente.date ?? Date.now() });
  }
  delete base.enVente;
  return base;
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
    parMois: [...parMois.values()].sort((a, b) => b.mois.localeCompare(a.mois)),
  };
}
