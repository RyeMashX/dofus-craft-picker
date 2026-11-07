// Onglet Données : état de la base (KPIs, barres de fraîcheur) et tables Équipements / Ressources
// avec recherche, filtres, tri, édition directe des valeurs et détail dépliable (recette / utilisations).

import { itemsFocus, estimerItem } from './entonnoir.js';
import { etatItem, niveauVolume, niveauPrixItem, niveauRessource, compareDofus, compareCategorie, NIVEAUX } from './fraicheur.js';
import { majVolume, majPrixItem, majPrixMoyenItem, majRessource, majPrixMoyenRessource, estIndispo } from './base.js';
import { planAchat } from './lots.js';
import { icone } from './vue-plan.js';
import { exclusion, exclure, reintegrer, finDeJournee, lotsEnVente } from './statut.js';
import { vendues } from './ventes.js';

const NOM_NIV = { noir: 'aucune info', rouge: 'introuvable', orange: 'périmé', jaune: 'à risque', vert: 'à jour' };
export const pastille = n => `<i class="pt pt-${n}" title="${NOM_NIV[n]}"></i>`;

// ---------- données calculées ----------
function lignesEquipements(S, p) {
  const mesVentes = new Map();
  for (const l of vendues(S.base)) mesVentes.set(l.id, (mesVentes.get(l.id) ?? 0) + 1);
  return itemsFocus(S.catalogue, p).map(it => {
    const b = S.base.items[it.id] ?? {};
    const e = etatItem(it, S.base);
    const est = estimerItem(it, S.base, p);
    return {
      it, id: it.id, nom: it.nom, categorie: it.type, niveau: it.niveau, iconId: it.iconId,
      vendus: b.volume?.valeur ?? null, nVol: e.volume,
      prixMin: b.prix?.valeurs[0] ?? null, prix: b.prix?.valeurs ?? [], nPrix: e.prix,
      prixMoyen: b.prixMoyen?.valeur ?? null,
      cout: est.cout, rendement: est.rendement, precision: est.precision,
      resVertes: e.compte.vert, resTotal: it.recette.length, compte: e.compte,
      etat: e.pret ? 'prêt' : e.utilisable ? 'utilisable' : '',
      exclu: exclusion(S.base, it.id), enVente: lotsEnVente(S.base, it.id),
      // statut unique (tri) : prêt, utilisable, en vente, rien, exclu (l'affichage suit la priorité exclu > en vente > prêt > utilisable)
      statut: exclusion(S.base, it.id) ? 5 : lotsEnVente(S.base, it.id) ? 3 : e.pret ? 1 : e.utilisable ? 2 : 4,
      mesVentes: mesVentes.get(it.id) ?? 0,
    };
  });
}

function lignesRessources(S, p) {
  const focus = itemsFocus(S.catalogue, p);
  const usages = new Map();
  for (const it of focus) for (const r of it.recette) {
    const u = usages.get(r.id) ?? { items: [], vendables: 0 };
    u.items.push({ it, qte: r.qte });
    if ((S.base.items[it.id]?.volume?.valeur ?? -1) >= p.volumeMin) u.vendables++;
    usages.set(r.id, u);
  }
  return [...usages.entries()].map(([id, u]) => {
    const res = S.catalogue.ressources[id] ?? { nom: `#${id}` };
    const b = S.base.ressources[id] ?? {};
    const lots = b.lots?.valeurs ?? {};
    return {
      id: Number(id), nom: res.nom, categorie: res.type ?? '?', niveau: res.niveau ?? 0, iconId: res.iconId,
      x1: lots[1] ?? null, x10: lots[10] ?? null, x100: lots[100] ?? null, x1000: lots[1000] ?? null, nRes: niveauRessource(b),
      prixMoyen: b.prixMoyen?.valeur ?? null, date: estIndispo(b) ? b.indispo.date : b.lots?.date ?? null, indispo: estIndispo(b),
      utilisations: u.items.length, vendables: u.vendables, usages: u.items,
    };
  });
}

// ---------- rendu ----------
function barre(titre, compte) {
  const total = NIVEAUX.reduce((s, n) => s + compte[n], 0) || 1;
  const segs = [...NIVEAUX].reverse().map(n => compte[n] ? `<i class="seg-${n}" style="width:${(100 * compte[n] / total).toFixed(2)}%" title="${NOM_NIV[n]} : ${compte[n]}"></i>` : '').join('');
  const leg = [...NIVEAUX].reverse().filter(n => n !== 'rouge' || compte[n]).map(n => `<span>${pastille(n)} ${compte[n]}</span>`).join(' ');
  return `<div><div class="bar-l"><span>${titre}</span><span class="leg small">${leg}</span></div><div class="bar fr">${segs}</div></div>`;
}

const compter = (liste, f) => { const c = { noir: 0, rouge: 0, orange: 0, jaune: 0, vert: 0 }; liste.forEach(x => c[f(x)]++); return c; };

const COLS = {
  equipements: [
    { cle: 'nom', t: 'Nom' }, { cle: 'categorie', t: 'Catégorie' }, { cle: 'niveau', t: 'Niv.', r: 1 },
    { cle: 'vendus', t: 'Vendus 30 j', r: 1, edit: 'vendus' }, { cle: 'prixMin', t: 'Prix min', r: 1, edit: 'prix' },
    { cle: 'prixMoyen', t: 'Prix moyen', r: 1, edit: 'prixMoyen' }, { cle: 'cout', t: 'Coût craft', r: 1 },
    { cle: 'rendement', t: 'Rend.', r: 1 }, { cle: 'resVertes', t: 'Ress.', r: 1 }, { cle: 'mesVentes', t: 'Mes ventes', r: 1 }, { cle: 'statut', t: 'Statut' },
  ],
  ressources: [
    { cle: 'nom', t: 'Nom' }, { cle: 'categorie', t: 'Catégorie' }, { cle: 'niveau', t: 'Niv.', r: 1 },
    { cle: 'x1', t: 'x1', r: 1, edit: 'x1' }, { cle: 'x10', t: 'x10', r: 1, edit: 'x10' }, { cle: 'x100', t: 'x100', r: 1, edit: 'x100' }, { cle: 'x1000', t: 'x1000', r: 1, edit: 'x1000' },
    { cle: 'prixMoyen', t: 'Prix moyen', r: 1, edit: 'prixMoyen' }, { cle: 'vendables', t: 'Utilisée par', r: 1 }, { cle: 'date', t: 'Relevé', r: 1 },
  ],
};

export function renderDonnees(ctx) {
  const { S, $, esc, fmt, fmtK, pct, params } = ctx;
  if (!S.catalogue) return;
  const p = params();
  const D = (S.etat.donnees ??= { onglet: 'equipements', q: '', cat: '', etat: '', vendables: false, tri: { cle: 'nom', sens: 1 }, n: 100 });
  const eq = lignesEquipements(S, p), rs = lignesRessources(S, p);

  // ---- résumé ----
  const vendables = eq.filter(x => (x.vendus ?? -1) >= p.volumeMin);
  const kpis = `<div class="kpis kpis4">
    <div class="kpi"><div class="v">${eq.length}</div><div class="l">équipements du focus</div></div>
    <div class="kpi"><div class="v">${vendables.length}</div><div class="l">à ${p.volumeMin} ventes ou plus</div></div>
    <div class="kpi"><div class="v ok">${eq.filter(x => x.etat === 'prêt').length}</div><div class="l">prêts pour le craft</div></div>
    <div class="kpi"><div class="v">${eq.filter(x => x.etat).length}</div><div class="l">utilisables (avec avertissement)</div></div>
  </div>
  <div class="bars">
    ${barre('Volumes 30 j', compter(eq, x => x.nVol))}
    ${barre('Prix des équipements', compter(eq, x => x.nPrix))}
    ${barre('Prix des ressources', compter(rs, x => x.nRes))}
  </div>`;

  // ---- table ----
  const onglet = D.onglet, lignes = onglet === 'equipements' ? eq : rs;
  const cats = [...new Set(lignes.map(x => x.categorie))].sort(compareCategorie);
  const q = ctx.normaliser(D.q ?? '');
  let rows = lignes.filter(x => (!q || ctx.normaliser(x.nom).includes(q)) && (!D.cat || x.categorie === D.cat));
  if (onglet === 'equipements') {
    if (D.vendables) rows = rows.filter(x => (x.vendus ?? -1) >= p.volumeMin);
    if (D.etat === 'prêt') rows = rows.filter(x => x.etat === 'prêt');
    else if (D.etat === 'utilisable') rows = rows.filter(x => x.etat);
    else if (D.etat === 'exclus') rows = rows.filter(x => x.exclu);
    else if (D.etat === 'enVente') rows = rows.filter(x => x.enVente);
    else if (D.etat === 'rouge') rows = rows.filter(x => x.compte.rouge > 0);
    else if (D.etat) rows = rows.filter(x => x.nVol === D.etat || x.nPrix === D.etat);
  } else {
    if (D.vendables) rows = rows.filter(x => x.vendables > 0);
    if (D.etat) rows = rows.filter(x => x.nRes === D.etat);
  }
  const { cle, sens } = D.tri;
  rows.sort((a, b) => {
    const va = a[cle], vb = b[cle];
    if (va == null && vb == null) return 0; if (va == null || va === '') return 1; if (vb == null || vb === '') return -1;
    return (typeof va === 'string' ? (D.tri.cle === 'categorie' ? compareCategorie : compareDofus)(va, vb) : va - vb) * sens;
  });

  const ed = S.editDonnee;
  const cellule = (x, c, contenu) => {
    if (!c.edit) return contenu;
    if (ed && ed.id === x.id && ed.champ === c.edit && ed.onglet === onglet) {
      if (c.edit === 'prix') return `<span class="edit-prix">${ctx.champsPrix(x.prix, i => `data-champ="prix" data-i="${i}" data-id="${x.id}"`, 'edit')}</span>`;
      return `<input class="num edit milliers" inputmode="numeric" data-champ="${c.edit}" data-id="${x.id}" value="${ctx.fmtSaisie(x[c.cle])}">`;
    }
    return `<span class="editable" data-champ="${c.edit}" data-id="${x.id}" title="Cliquer pour modifier">${contenu}</span>`;
  };
  const rendEq = x => ({
    nom: `${icone(x.iconId)} <span class="lien">${esc(x.nom)}</span>`, categorie: esc(x.categorie), niveau: x.niveau,
    vendus: `${fmt(x.vendus)} ${pastille(x.nVol)}`, prixMin: `${fmtK(x.prixMin)} ${pastille(x.nPrix)}`, prixMoyen: fmtK(x.prixMoyen),
    cout: fmtK(x.cout), rendement: x.rendement == null ? '–' : `<span class="${x.rendement >= p.margeMin ? 'ok' : x.rendement < 0 ? 'bad' : ''}">${pct(x.rendement)}</span>`,
    resVertes: `<span title="${x.compte.vert} vertes, ${x.compte.jaune} jaunes, ${x.compte.orange} orange, ${x.compte.rouge} introuvables, ${x.compte.noir} sans info">${x.resVertes}/${x.resTotal}</span> ${pastille(x.compte.noir ? 'noir' : x.compte.rouge ? 'rouge' : x.compte.orange ? 'orange' : x.compte.jaune ? 'jaune' : 'vert')}`,
    mesVentes: x.mesVentes ? `<span title="Exemplaires vendus (onglet Bilan)">${x.mesVentes}</span>` : '<span class="muted">–</span>',
    // un seul statut, par ordre de priorité : exclu, en vente, prêt, utilisable
    statut: x.exclu ? `<span class="tag urgent" title="Exclu des plans">⛔ ${x.exclu.jusquau ? `jusqu'au ${new Date(x.exclu.jusquau).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}` : 'exclu'}</span>`
      : x.enVente ? `<span class="tag tard" title="${x.enVente} exemplaire${x.enVente > 1 ? 's' : ''} en vente : pas proposé dans le plan de craft${x.etat ? ` (données : ${x.etat})` : ''}">en vente ${x.enVente}</span>`
      : x.etat === 'prêt' ? '<span class="tag ok-tag" title="Volume, prix et ressources à jour">prêt</span>'
      : x.etat ? '<span class="tag faire" title="Données utilisables, avec des jaunes">utilisable</span>' : '',
  });
  const rendRs = x => ({
    nom: `${icone(x.iconId)} <span class="lien">${esc(x.nom)}</span>`, categorie: esc(x.categorie), niveau: x.niveau,
    x1: fmt(x.x1), x10: fmt(x.x10), x100: fmt(x.x100), x1000: fmt(x.x1000), prixMoyen: fmt(x.prixMoyen),
    vendables: `${x.vendables} <span class="muted">/ ${x.utilisations}</span>`, date: `${ctx.age(x.date)} ${pastille(x.nRes)}`,
  });
  const rend = onglet === 'equipements' ? rendEq : rendRs;
  const cols = COLS[onglet];

  const barreExclusion = x => x.exclu
    ? `<div class="row small excl"><span class="tag urgent">⛔ exclu ${x.exclu.jusquau ? `jusqu'au ${new Date(x.exclu.jusquau).toLocaleDateString('fr-FR')}` : 'définitivement'}</span>
        <button class="secondary small" data-reint="${x.id}">Réintégrer</button></div>`
    : `<div class="row small excl"><span class="muted">Exclure des plans :</span>
        <button class="secondary small" data-excl="${x.id}">définitivement</button>
        <span class="muted">ou jusqu'au</span> <input type="date" class="small" data-exdate="${x.id}" value="${new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)}">
        <button class="secondary small" data-exclj="${x.id}">exclure</button></div>`;
  const detail = x => {
    if (onglet === 'equipements') {
      return `${barreExclusion(x)}<table class="rt sous"><thead><tr><th>Ressource</th><th class="r">Qté</th><th class="r">Prix unit.</th><th class="r">Coût</th><th>Relevé</th></tr></thead><tbody>
        ${x.it.recette.map(r => {
          const res = S.catalogue.ressources[r.id] ?? { nom: `#${r.id}` }, b = S.base.ressources[r.id] ?? {};
          const plan = b.lots ? planAchat(r.qte, b.lots.valeurs, p) : null;
          const cout = plan ? plan.cout : b.prixMoyen ? r.qte * b.prixMoyen.valeur : null;
          return `<tr><td class="nom">${icone(res.iconId)} ${esc(res.nom)}</td><td class="r">${fmt(r.qte)}</td><td class="r">${fmt(cout != null ? cout / r.qte : null)}${plan ? '' : b.prixMoyen ? ' <span class="muted small">moy.</span>' : ''}</td>
            <td class="r">${fmtK(cout)}</td><td>${pastille(niveauRessource(b))} <span class="muted small">${ctx.age(estIndispo(b) ? b.indispo.date : b.lots?.date)}</span></td></tr>`;
        }).join('')}</tbody></table>`;
    }
    return `<table class="rt sous"><thead><tr><th>Utilisée par</th><th class="r">Qté</th><th class="r">Vendus 30 j</th></tr></thead><tbody>
      ${[...x.usages].sort((a, b) => (S.base.items[b.it.id]?.volume?.valeur ?? -1) - (S.base.items[a.it.id]?.volume?.valeur ?? -1)).map(u => `<tr><td class="nom">${icone(u.it.iconId)} ${esc(u.it.nom)}</td><td class="r">${fmt(u.qte)}</td>
        <td class="r">${fmt(S.base.items[u.it.id]?.volume?.valeur)} ${pastille(niveauVolume(S.base.items[u.it.id]))}</td></tr>`).join('')}</tbody></table>`;
  };

  const optEtat = onglet === 'equipements'
    ? [['', 'tous états'], ['prêt', 'prêts'], ['utilisable', 'utilisables'], ['vert', 'au moins un vert'], ['jaune', 'à risque (jaune)'], ['orange', 'périmé (orange)'], ['rouge', 'ressource introuvable (rouge)'], ['noir', 'sans info'], ['exclus', 'exclus (liste noire)'], ['enVente', 'en vente']]
    : [['', 'toutes fraîcheurs'], ['vert', 'à jour'], ['jaune', 'à risque'], ['orange', 'périmé'], ['rouge', 'introuvable'], ['noir', 'sans info']];

  $('#donnees').innerHTML = `${kpis}
    <div class="row"><div id="don-onglets" class="seg">
      <button data-o="equipements" class="${onglet === 'equipements' ? 'on' : ''}">Équipements (${eq.length})</button>
      <button data-o="ressources" class="${onglet === 'ressources' ? 'on' : ''}">Ressources (${rs.length})</button></div></div>
    <input id="don-q" type="search" placeholder="Rechercher par nom" value="${esc(D.q)}" autocomplete="off">
    <div class="row small">
      <select id="don-cat" class="small"><option value="">toutes catégories</option>${cats.map(c => `<option${c === D.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="don-etat" class="small">${optEtat.map(([v, l]) => `<option value="${v}"${v === D.etat ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <label class="sel"><input id="don-vend" type="checkbox"${D.vendables ? ' checked' : ''}> ${onglet === 'equipements' ? `${p.volumeMin} ventes ou plus` : 'utiles (items vendables)'}</label>
      <div class="spacer"></div><span class="muted">${rows.length} lignes</span>
    </div>
    <div class="table-large"><table class="rt don"><thead><tr>${cols.map(c => `<th class="sort${c.r ? ' r' : ''}${c.cle === cle ? ' on' : ''}" data-cle="${c.cle}">${c.t} <span class="fl">${c.cle === cle ? (sens > 0 ? '▴' : '▾') : '↕'}</span></th>`).join('')}</tr></thead>
    <tbody>${rows.slice(0, D.n).map(x => {
      const r = rend(x), ouvert = S.ligneOuverte === `${onglet}:${x.id}`;
      return `<tr class="${ouvert ? 'ouverte' : ''}${x.exclu ? ' off' : ''}" data-id="${x.id}">${cols.map(c => `<td class="${c.r ? 'r' : ''}${c.cle === 'nom' ? ' nom dep' : ''} c-${c.cle}">${cellule(x, c, r[c.cle])}</td>`).join('')}</tr>
        ${ouvert ? `<tr class="detail"><td colspan="${cols.length}">${detail(x)}</td></tr>` : ''}`;
    }).join('')}</tbody></table></div>
    ${rows.length > D.n ? `<p class="small"><button id="don-plus" class="link small">afficher 100 de plus</button></p>` : ''}
    <p class="muted small">Clic sur un nom : ${onglet === 'equipements' ? 'la recette' : 'les items qui l\'utilisent'}. Clic sur une valeur soulignée : modification.</p>`;

  // ---- événements ----
  const set = (k, v) => { D[k] = v; ctx.sauverEtat(); ctx.renderTout(); };
  ctx.$$('#don-onglets button').forEach(b => b.onclick = () => { D.onglet = b.dataset.o; D.cat = ''; D.etat = ''; D.tri = { cle: 'nom', sens: 1 }; D.n = 100; ctx.sauverEtat(); ctx.renderTout(); });
  const qEl = $('#don-q');
  qEl.oninput = () => { D.q = qEl.value; D.n = 100; ctx.renderTout(); const n = $('#don-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  $('#don-cat').onchange = e => set('cat', e.target.value);
  $('#don-etat').onchange = e => set('etat', e.target.value);
  $('#don-vend').onchange = e => set('vendables', e.target.checked);
  const plus = $('#don-plus'); if (plus) plus.onclick = () => set('n', D.n + 100);
  ctx.$$('#donnees th.sort').forEach(th => th.onclick = () => {
    const k = th.dataset.cle;
    D.tri = { cle: k, sens: D.tri.cle === k ? -D.tri.sens : (['nom', 'categorie', 'etat'].includes(k) ? 1 : -1) };
    ctx.sauverEtat(); ctx.renderTout();
  });
  // liste noire
  const majExcl = f => { f(); ctx.sauverBase(); ctx.renderTout(); };
  ctx.$$('#donnees [data-excl]').forEach(b => b.onclick = () => majExcl(() => exclure(S.base, +b.dataset.excl, null)));
  ctx.$$('#donnees [data-exclj]').forEach(b => b.onclick = () => {
    const d = $(`#donnees input[data-exdate="${b.dataset.exclj}"]`)?.value;
    if (d) majExcl(() => exclure(S.base, +b.dataset.exclj, finDeJournee(d)));
  });
  ctx.$$('#donnees [data-reint]').forEach(b => b.onclick = () => majExcl(() => reintegrer(S.base, +b.dataset.reint)));
  ctx.$$('#donnees td.dep .lien').forEach(el => el.onclick = () => {
    const id = el.closest('tr').dataset.id, k = `${onglet}:${id}`;
    S.ligneOuverte = S.ligneOuverte === k ? null : k; ctx.renderTout();
  });
  ctx.$$('#donnees .editable').forEach(el => el.onclick = () => { S.editDonnee = { onglet, id: Number(el.dataset.id), champ: el.dataset.champ }; ctx.renderTout(); const i = $('#donnees input.edit'); i?.focus(); i?.select(); });
  const champs = ctx.$$('#donnees input.edit');
  if (champs.length) {
    const inp = champs[0];
    // plusieurs champs (prix 1. 2. 3.) : on valide quand le focus quitte le groupe, ou sur Entrée
    const valider = () => {
      if (!S.editDonnee) return;
      const texte = inp.dataset.champ === 'prix' ? champs.map(c => c.value).filter(v => v.trim()).join(';') : inp.value;
      enregistrerEdition(ctx, onglet, Number(inp.dataset.id), inp.dataset.champ, texte); S.editDonnee = null; ctx.renderTout();
    };
    champs.forEach(c => {
      c.onkeydown = e => { if (e.key === 'Enter') valider(); if (e.key === 'Escape') { S.editDonnee = null; ctx.renderTout(); } };
      c.onblur = e => { if (!champs.includes(e.relatedTarget)) valider(); };
    });
  }
}

// Écrit la valeur modifiée dans la base (horodatée maintenant : une saisie vaut un relevé)
function enregistrerEdition(ctx, onglet, id, champ, texte) {
  const { S, nombreSaisi } = ctx;
  const now = Date.now(), v = nombreSaisi(texte);
  if (onglet === 'equipements') {
    if (champ === 'vendus' && v != null) majVolume(S.base, id, v, now);
    if (champ === 'prixMoyen' && v != null) majPrixMoyenItem(S.base, id, v, now);
    if (champ === 'prix') { const l = String(texte).split(/[,;]/).map(nombreSaisi).filter(Boolean); if (l.length) majPrixItem(S.base, id, l, now); }
  } else {
    if (champ === 'prixMoyen' && v != null) majPrixMoyenRessource(S.base, id, v, now);
    if (/^x\d+$/.test(champ)) {
      const offre = { ...(S.base.ressources[id]?.lots?.valeurs ?? {}) };
      const t = Number(champ.slice(1));
      if (v != null) offre[t] = v; else delete offre[t];
      if (Object.keys(offre).length) majRessource(S.base, id, offre, now);
    }
  }
  ctx.sauverBase();
}
