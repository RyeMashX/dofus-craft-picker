// Onglet Ventes : une ligne par exemplaire en vente (draft ou validé), prix et coûts modifiables, marge calculée.
// Relevé OCR de l'onglet « Vente » de l'HDV directement depuis cet onglet :
// - item absent de la liste → ligne « validée » (prix lu, coût de craft estimé d'après la base) ;
// - même item au même prix → même annonce, rien à faire ;
// - même item à un autre prix → tu choisis : fusionner avec une ligne existante ou créer une ligne.
// « Vendu » sort la ligne de la liste : elle passe dans l'onglet Bilan.

import { actives, marge, rendement, majLigne, changerPrix, supprimerLigne, marquerVendu, importerCapture, fusionner, nouvelleLigne, trouverLigne } from './ventes.js';
import { coutEstime } from './craft-plan.js';
import { compareDofus } from './fraicheur.js';
import { icone } from './vue-plan.js';

const jourIso = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const depuisIso = s => s ? new Date(`${s}T12:00:00`).getTime() : null;
const dateCourte = t => t ? new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '–';
export { jourIso, depuisIso, dateCourte };

const CHAMPS = [['prix', 'Prix'], ['coutCraft', 'Craft'], ['frais', 'Mise en vente'], ['coutFm', 'FM']];

// Champ montant modifiable d'une ligne
const aideFrais = (ctx, l) => l.fraisManuel ? 'Saisi à la main. Vide le champ pour revenir à 2 % du prix.'
  : l.statut === 'draft' ? '2 % du prix, recalculé tant que la ligne est en draft.'
  : `2 % du prix initial${l.changements?.length ? ` + 1 % du nouveau prix à chaque changement (${l.changements.map(c => ctx.fmt(c.prix)).join(', ')})` : ''}. Figé : utilise « Prix modifié » pour un changement de prix à l'HDV.`;
export const champ = (ctx, l, k, lib) => `<label class="vf"><span>${k === 'frais' && l.changements?.length ? `${lib} (+${l.changements.length})` : lib}</span><input class="num milliers${k === 'frais' && !l.fraisManuel && l.statut === 'draft' ? ' auto' : ''}" inputmode="numeric" data-uid="${l.uid}" data-champ="${k}" value="${ctx.fmtSaisie(l[k])}"${k === 'frais' ? ` title="${ctx.esc(aideFrais(ctx, l))}"` : k === 'prix' && l.statut === 'valide' ? ' title="Corrige le prix sans toucher aux frais. Pour un changement de prix à l\'HDV, utilise « Prix modifié »."' : ''}></label>`;
export function brancherChamps(ctx, sel) {
  const { S, $$ } = ctx;
  $$(`${sel} input[data-champ]`).forEach(el => el.onchange = () => {
    majLigne(S.base, el.dataset.uid, el.dataset.champ, ctx.nombreSaisi(el.value));
    ctx.sauverBase(); ctx.renderTout();
  });
  $$(`${sel} input[data-date]`).forEach(el => el.onchange = () => {
    const t = depuisIso(el.value); if (!t) return;
    majLigne(S.base, el.dataset.uid, el.dataset.date, t);
    ctx.sauverBase(); ctx.renderTout();
  });
}

// Relevé OCR d'un écran « Mes ventes »
async function releverVentes(ctx) {
  const { S } = ctx;
  const identifie = await ctx.capture.lireVentes();
  if (!identifie) return;
  const p = ctx.params();
  const res = importerCapture(S.base, identifie, id => coutEstime(S.catalogue, S.base, p, id));
  ctx.sauverBase();
  const R = (S.releveVentes ??= { ajoutees: 0, connues: 0, ignorees: 0, aTrancher: [], captures: 0 });
  R.captures++; R.ajoutees += res.ajoutees.length; R.connues += res.connues; R.ignorees = Math.max(R.ignorees, res.ignorees);
  for (const a of res.aTrancher) if (!R.aTrancher.some(x => x.id === a.id && x.prix === a.prix)) R.aTrancher.push(a);
  R.total = identifie.total ?? R.total;
  ctx.toast(`${res.ajoutees.length} ajoutée${res.ajoutees.length > 1 ? 's' : ''}, ${res.connues} déjà connue${res.connues > 1 ? 's' : ''}${res.aTrancher.length ? `, ${res.aTrancher.length} à trancher` : ''}`);
  ctx.renderTout();
}

function carteReleve(ctx) {
  const { S, esc, fmt, fmtK } = ctx, R = S.releveVentes;
  if (!R) return '';
  const items = new Map(S.catalogue.items.map(i => [i.id, i]));
  const trancher = R.aTrancher.map((a, i) => {
    const ex = actives(S.base).filter(l => l.id === a.id);
    return `<div class="tr-l"><div class="cp-nom">${icone(items.get(a.id)?.iconId)} <span class="n">${esc(a.nom)}</span> <span class="muted small">lu à</span> <b>${fmt(a.prix)}</b></div>
      <div class="tr-choix">${ex.map(l => `<button class="secondary small" data-fus="${i}" data-uid="${l.uid}" title="${l.statut === 'valide' ? 'Tu as changé le prix de cette annonce : nouveau prix et + 1 % de frais' : 'Ligne draft : nouveau prix, frais recalculés à 2 %'}">Fusionner avec la ligne du ${dateCourte(l.dateMiseEnVente)} (${l.prix == null ? 'sans prix' : fmtK(l.prix)})</button>`).join('')}
        <button class="primary small" data-nouv="${i}">Nouvelle ligne</button><button class="link small" data-ign="${i}">ignorer</button></div></div>`;
  }).join('');
  return `<div class="lect"><div class="row"><h3>Relevé de mes ventes</h3><span class="muted small">${R.captures} capture${R.captures > 1 ? 's' : ''}</span><div class="spacer"></div><button id="rv-fin" class="link small">fermer</button></div>
    <p class="small"><b class="ok">${R.ajoutees}</b> ajoutées · ${R.connues} déjà connues${R.ignorees ? ` · ${R.ignorees} hors catalogue` : ''}${R.total ? ` · ${R.total} lots en vente au total à l'HDV` : ''}</p>
    ${R.aTrancher.length ? `<p class="small warn">Même item, prix différent : c'est une annonce déjà suivie (prix modifié) ou un exemplaire de plus ?</p>${trancher}` : ''}
    <p class="muted small">Fais défiler ta liste à l'HDV et scanne l'écran suivant : une annonce vue deux fois n'est comptée qu'une fois.</p></div>`;
}

export function renderVentes(ctx) {
  const { S, $, $$, esc, fmtK, pct } = ctx;
  if (!S.catalogue) return;
  const items = new Map(S.catalogue.items.map(i => [i.id, i]));
  const toutes = actives(S.base).filter(l => items.has(l.id));
  // filtres et tri (mémorisés)
  const F = (S.etat.ventesVue ??= { statut: 'tous', autre: 'tous', tri: 'nom', q: '' });
  const maintenant = Date.now(), jours = l => (maintenant - l.dateMiseEnVente) / 864e5;
  const AUTRES = { tous: () => true, sansPrix: l => l.prix == null, negative: l => (marge(l) ?? 0) < 0, j7: l => jours(l) > 7, j14: l => jours(l) > 14 };
  const nomDe = l => items.get(l.id).nom, q = ctx.normaliser(F.q ?? '');
  const parNom = (a, b) => compareDofus(nomDe(a), nomDe(b)) || a.dateMiseEnVente - b.dateMiseEnVente;
  const desc = f => (a, b) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity) || parNom(a, b);
  const TRIS = {
    nom: parNom,
    ancien: (a, b) => a.dateMiseEnVente - b.dateMiseEnVente || parNom(a, b),
    recent: (a, b) => b.dateMiseEnVente - a.dateMiseEnVente || parNom(a, b),
    prix: desc(l => l.prix), marge: desc(marge), rendement: desc(rendement),
    rendementAsc: (a, b) => (rendement(a) ?? Infinity) - (rendement(b) ?? Infinity) || parNom(a, b),
  };
  const lignes = toutes
    .filter(l => F.statut === 'tous' || l.statut === F.statut)
    .filter(AUTRES[F.autre] ?? AUTRES.tous)
    .filter(l => !q || ctx.normaliser(nomDe(l)).includes(q))
    .sort(TRIS[F.tri] ?? TRIS.nom);
  const filtre = lignes.length !== toutes.length;
  const somme = f => lignes.reduce((s, l) => s + (f(l) ?? 0), 0);
  const drafts = lignes.filter(l => l.statut === 'draft').length;
  // rendement attendu : marge des lignes qui ont un prix, rapportée à leurs coûts
  const avecPrix = lignes.filter(l => l.prix != null);
  const coutAvecPrix = avecPrix.reduce((s, l) => s + (l.coutCraft ?? 0) + (l.coutFm ?? 0), 0);
  const rdtGlobal = coutAvecPrix ? avecPrix.reduce((s, l) => s + marge(l), 0) / coutAvecPrix : null;
  const cap = ctx.capture;

  const ligne = l => {
    const it = items.get(l.id), m = marge(l);
    return `<div class="vt-l ${l.statut}">
      <div class="cp-nom">${icone(it.iconId)} <span class="n" title="${esc(it.nom)}">${esc(it.nom)}</span>
        <button class="statut st-${l.statut}" data-statut="${l.uid}" title="${l.statut === 'draft' ? 'Chiffres à vérifier. Clique quand ils sont bons.' : 'Vérifié. Clique pour repasser en draft.'}">${l.statut === 'draft' ? 'draft' : 'validé ✓'}</button></div>
      <div class="vt-meta"><label class="vf-date"><span>en vente le</span><input type="date" data-uid="${l.uid}" data-date="dateMiseEnVente" value="${jourIso(l.dateMiseEnVente)}"></label>
        <span class="spacer"></span><span class="muted small">marge</span> <b class="${m == null ? 'muted' : m >= 0 ? 'ok' : 'bad'}">${fmtK(m)}</b> <span class="muted small">${pct(rendement(l))}</span></div>
      <div class="vt-champs">${CHAMPS.map(([k, lib]) => champ(ctx, l, k, lib)).join('')}</div>
      ${S.chgPrix === l.uid ? `<div class="vt-chg"><label class="vf"><span>Nouveau prix à l'HDV</span><input id="chg-prix" class="num milliers" inputmode="numeric" value="${ctx.fmtSaisie(l.prix)}"></label>
        <button id="chg-ok" class="primary small">OK, + 1 % de frais</button><button id="chg-annuler" class="link small">annuler</button></div>` : ''}
      <div class="vt-actions"><button class="secondary small vendu-btn" data-vendu="${l.uid}" title="Vendu aujourd'hui (date modifiable dans Bilan)">✓ Vendu</button>
        ${l.statut === 'valide' && l.prix != null && S.chgPrix !== l.uid ? `<button class="secondary small" data-chg="${l.uid}" title="Tu as changé le prix à l'HDV : nouveau prix et + 1 % de ce prix dans les frais">Prix modifié</button>` : ''}<span class="spacer"></span><button class="retirer" data-suppr="${l.uid}" title="Supprimer la ligne (pas vendu, retiré de l'HDV)">✕</button></div>
    </div>`;
  };

  $('#ventes').innerHTML = `
    <div class="kpis kpis4">
      <div class="kpi"><div class="v">${lignes.length}${filtre ? `<span class="muted small"> / ${toutes.length}</span>` : ''}</div><div class="l">en vente${drafts ? `, ${drafts} draft` : ''}</div></div>
      <div class="kpi"><div class="v">${fmtK(somme(l => l.prix))}</div><div class="l">valeur affichée</div></div>
      <div class="kpi"><div class="v ok">${fmtK(somme(marge))} <span class="kpi-pct">${pct(rdtGlobal)}</span></div><div class="l" title="Marge rapportée au coût (craft + FM) des lignes qui ont un prix">marge attendue</div></div>
      <div class="kpi"><div class="v">${fmtK(somme(l => (l.coutCraft ?? 0) + (l.coutFm ?? 0)))}</div><div class="l">immobilisé</div></div>
    </div>
    <div class="row">
      <button id="vt-cap" class="cta-cap small${cap.enCours() ? ' on' : ''}">${cap.enCours() ? 'Capture en cours' : 'Capturer le jeu'}</button>
      <button id="vt-scan" class="primary small"${cap.enCours() ? '' : ' disabled'} title="Lit l'écran « Vente » de l'HDV (liste de tes annonces)">Scanner mes ventes</button>
      <button id="vt-zone" class="link small"${cap.enCours() ? '' : ' disabled'}>zone</button></div>
    ${carteReleve(ctx)}
    <div class="ac"><input id="vt-nom" placeholder="Ajouter un exemplaire en vente…" autocomplete="off" spellcheck="false"><div id="vt-ac" class="ac-liste hidden"></div></div>
    ${toutes.length ? `<div class="vt-filtres">
      <input id="vt-q" type="search" placeholder="Filtrer par nom…" value="${esc(F.q ?? '')}" autocomplete="off" spellcheck="false">
      <div id="vt-statut" class="seg small">${[['tous', 'tous'], ['draft', 'draft'], ['valide', 'validé']].map(([k, l]) => `<button data-st="${k}" class="${F.statut === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="vt-autre" title="Filtre">${[['tous', 'toutes les lignes'], ['sansPrix', 'sans prix'], ['negative', 'marge négative'], ['j7', 'en vente depuis + 7 j'], ['j14', 'en vente depuis + 14 j']].map(([k, l]) => `<option value="${k}"${F.autre === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select id="vt-tri" title="Tri">${[['nom', 'tri : nom'], ['ancien', 'tri : plus anciennes'], ['recent', 'tri : plus récentes'], ['prix', 'tri : prix ↓'], ['marge', 'tri : marge ↓'], ['rendement', 'tri : rendement ↓'], ['rendementAsc', 'tri : rendement ↑']].map(([k, l]) => `<option value="${k}"${F.tri === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${filtre ? '<button id="vt-raz" class="link small">tout afficher</button>' : ''}
    </div>` : ''}
    ${lignes.length ? `<div class="cp">${lignes.map(ligne).join('')}</div>` : toutes.length ? '<p class="muted small">Aucune ligne pour ces filtres.</p>' : '<p class="muted small">Rien en vente. Mets des crafts en vente depuis l\'onglet Craft, scanne ta liste à l\'HDV ou ajoute-les à la main.</p>'}
    <p class="muted small">Marge = prix − craft − mise en vente − FM. Mise en vente : 2 % du prix, recalculés tant que la ligne est en draft, figés une fois validée ; « Prix modifié » ajoute 1 % du nouveau prix. Les lignes venues du Craft sont en « draft » : vérifie leurs chiffres puis passe-les en « validé ». Un item en vente n'est pas proposé dans le plan de craft.</p>`;

  const p = ctx.params(), coutDe = id => coutEstime(S.catalogue, S.base, p, id);
  const R = S.releveVentes;
  const resolu = i => { R.aTrancher.splice(i, 1); ctx.sauverBase(); ctx.renderTout(); };
  $$('#ventes [data-fus]').forEach(b => b.onclick = () => { fusionner(S.base, b.dataset.uid, R.aTrancher[+b.dataset.fus].prix); resolu(+b.dataset.fus); });
  $$('#ventes [data-nouv]').forEach(b => b.onclick = () => { const a = R.aTrancher[+b.dataset.nouv]; nouvelleLigne(S.base, a.id, a.prix, coutDe); R.ajoutees++; resolu(+b.dataset.nouv); });
  $$('#ventes [data-ign]').forEach(b => b.onclick = () => resolu(+b.dataset.ign));
  const fin = $('#rv-fin'); if (fin) fin.onclick = () => { S.releveVentes = null; ctx.renderTout(); };

  $$('#ventes [data-statut]').forEach(b => b.onclick = () => { const l = trouverLigne(S.base, b.dataset.statut); majLigne(S.base, l.uid, 'statut', l.statut === 'draft' ? 'valide' : 'draft'); ctx.sauverBase(); ctx.renderTout(); });
  $$('#ventes [data-chg]').forEach(b => b.onclick = () => { S.chgPrix = b.dataset.chg; ctx.renderTout(); const i = $('#chg-prix'); i?.focus(); i?.select(); });
  const okChg = () => { const p = ctx.nombreSaisi($('#chg-prix').value), l = trouverLigne(S.base, S.chgPrix); S.chgPrix = null; if (p && l && p !== l.prix) { changerPrix(S.base, l.uid, p); ctx.sauverBase(); ctx.toast(`Nouveau prix ${ctx.fmt(p)} · frais + ${ctx.fmt(Math.round(p * 0.01))}`); } ctx.renderTout(); };
  if ($('#chg-ok')) { $('#chg-ok').onclick = okChg; $('#chg-prix').onkeydown = e => { if (e.key === 'Enter') okChg(); if (e.key === 'Escape') { S.chgPrix = null; ctx.renderTout(); } }; $('#chg-annuler').onclick = () => { S.chgPrix = null; ctx.renderTout(); }; }
  $$('#ventes [data-vendu]').forEach(b => b.onclick = () => { marquerVendu(S.base, b.dataset.vendu); ctx.sauverBase(); ctx.toast('Vendu ✓ (voir Bilan)'); ctx.renderTout(); });
  $$('#ventes [data-suppr]').forEach(b => b.onclick = () => { if (!confirm('Supprimer cette ligne ? (pour un exemplaire vendu, utilise plutôt « Vendu »)')) return; supprimerLigne(S.base, b.dataset.suppr); ctx.sauverBase(); ctx.renderTout(); });
  brancherChamps(ctx, '#ventes');

  const majF = (k, v) => { F[k] = v; ctx.sauverEtat(); ctx.renderTout(); };
  if ($('#vt-q')) {
    $('#vt-q').oninput = e => { F.q = e.target.value; S.vtFocus = e.target.selectionStart; ctx.sauverEtat(); ctx.renderTout(); };
    if (S.vtFocus != null) { const i = $('#vt-q'); i.focus(); i.setSelectionRange(S.vtFocus, S.vtFocus); S.vtFocus = null; }
    $$('#vt-statut [data-st]').forEach(b => b.onclick = () => majF('statut', b.dataset.st));
    $('#vt-autre').onchange = e => majF('autre', e.target.value);
    $('#vt-tri').onchange = e => majF('tri', e.target.value);
    const raz = $('#vt-raz'); if (raz) raz.onclick = () => { Object.assign(F, { statut: 'tous', autre: 'tous', q: '' }); ctx.sauverEtat(); ctx.renderTout(); };
  }
  $('#vt-cap').onclick = async () => { await cap.basculer(); ctx.renderTout(); };
  $('#vt-scan').onclick = async e => { e.target.classList.add('busy'); e.target.disabled = true; try { await releverVentes(ctx); } finally { ctx.renderTout(); } };
  $('#vt-zone').onclick = () => cap.zone();
  ctx.autocompletion($('#vt-nom'), $('#vt-ac'), 'annonces', nom => {
    const it = S.catalogue.items.find(i => i.nom === nom);
    if (!it) return;
    nouvelleLigne(S.base, it.id, null, coutDe);
    ctx.sauverBase(); ctx.toast(`${it.nom} ajouté : indique son prix`); ctx.renderTout();
  });
}
