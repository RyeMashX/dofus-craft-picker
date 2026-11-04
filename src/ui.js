// Interface : vues Scan / Résultats / Base, fenêtre flottante, capture et OCR.

import { PARAMS } from './params.js';
import { creerBase, majVolume, majPrixItem, majRessource, exporter, importer, JOUR } from './base.js';
import { itemsFocus, baseEvaluation } from './entonnoir.js';
import { listesScan, planScan } from './priorites.js';
import { allouer } from './allocation.js';
import { identifier, appliquer } from './ocr/identification.js';
import * as Cap from './capture.js';

let root = document; // la page, ou la fenêtre flottante
const $ = s => root.querySelector(s);
const $$ = s => [...root.querySelectorAll(s)];

// ---------- état et stockage ----------
const KB = 'craft.base', KE = 'craft.etat';
const lireLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const ecrireLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const ZONES_DEFAUT = {
  liste: { x: 0.16, y: 0.30, w: 0.245, h: 0.57 },
  detail: { x: 0, y: 0.07, w: 0.215, h: 0.76 },
  courbe: { x: 0.224, y: 0.173, w: 0.545, h: 0.705 },
};
const REGLAGES_DEFAUT = {
  volumeMin: PARAMS.volumeMin, margeMin: PARAMS.margeMin * 100, modePrixVente: PARAMS.modePrixVente,
  forgeron: PARAMS.metiers.Forgeron, effort: PARAMS.coutEffortParCraft / 1000,
};

const S = {
  catalogue: null,
  base: lireLS(KB, null) ?? creerBase(),
  etat: { vue: 'scan', mode: 'courbe', liste: 'volumes', minutes: 10, budget: 30, tri: { cle: 'score', sens: -1 }, filtre: '', tag: '', zones: ZONES_DEFAUT, ...lireLS(KE, {}) },
  derniere: null, // dernière lecture OCR
  plusLignes: 50,
  copies: new Set(), // noms déjà copiés pendant la session (repère visuel)
};
S.etat.reglages = { ...REGLAGES_DEFAUT, ...(S.etat.reglages ?? {}) };
if (S.base.version !== 2) S.base = creerBase();

const sauverBase = () => ecrireLS(KB, S.base);
const sauverEtat = () => ecrireLS(KE, S.etat);

function params() {
  const r = S.etat.reglages;
  return {
    ...PARAMS,
    volumeMin: +r.volumeMin, margeMin: +r.margeMin / 100, modePrixVente: r.modePrixVente,
    coutEffortParCraft: +r.effort * 1000,
    metiers: { ...PARAMS.metiers, Forgeron: +r.forgeron },
  };
}

// ---------- formats ----------
const fmt = n => n == null ? '–' : Math.round(n).toLocaleString('fr-FR');
const fmtK = n => {
  if (n == null) return '–';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: a >= 1e8 ? 0 : 1 }) + ' M';
  if (a >= 1e4) return Math.round(n / 1e3).toLocaleString('fr-FR') + ' k';
  return fmt(n);
};
const pct = r => r == null ? '–' : (r * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' %';
const age = d => {
  if (!d) return 'jamais';
  const j = (Date.now() - d) / JOUR;
  if (j < 1 / 24) return "à l'instant";
  if (j < 1) return `il y a ${Math.round(j * 24)} h`;
  return `il y a ${Math.round(j)} j`;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tagHtml = t => `<span class="tag ${t === 'urgent' ? 'urgent' : t === 'à faire' ? 'faire' : 'tard'}">${t}</span>`;
const nombreSaisi = s => { const v = Number(String(s).replace(/[^\d]/g, '')); return String(s).trim() && Number.isFinite(v) ? v : null; };

// ---------- rendu ----------
function renderVue() {
  const v = S.etat.vue;
  root.body.className = 'view-' + v + (root !== document ? ' pip' : '');
  $$('#view-switch button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  for (const nom of ['scan', 'resultats', 'base']) $$(`.view-${nom}`).forEach(el => el.classList.toggle('hidden', nom !== v));
}

function renderCapture() {
  const on = Cap.enCours();
  const b = $('#cap-start');
  b.textContent = on ? 'Capture en cours · arrêter' : 'Capturer le jeu';
  b.classList.toggle('on', on);
  b.disabled = !Cap.estSupporte();
  $('#scan').disabled = !on;
  $('#zones-btn').disabled = !on;
}

function renderPasse(cat, p) {
  const focus = itemsFocus(cat, p);
  const ids = new Set(focus.flatMap(i => i.recette.map(r => r.id)));
  const vol = focus.filter(i => S.base.items[i.id]?.volume).length;
  const pmI = focus.filter(i => S.base.items[i.id]?.prixMoyen).length;
  const pmR = [...ids].filter(id => S.base.ressources[id]?.prixMoyen).length;
  const barre = (l, n, t, aide) => `<div><div class="bar-l"><span>${l} <span class="muted">${aide}</span></span><span>${n} / ${t}</span></div><div class="bar"><i style="width:${t ? (100 * n / t).toFixed(1) : 0}%"></i></div></div>`;
  $('#focus-lvl').textContent = p.focusNiveaux[0] === p.focusNiveaux[1] ? p.focusNiveaux[0] : p.focusNiveaux.join('-');
  $('#passe').innerHTML = `<div class="bars">
    ${barre('Volumes', vol, focus.length, 'courbe, onglet 30 jours')}
    ${barre('Prix moyens items', pmI, focus.length, 'liste HDV équipements')}
    ${barre('Prix moyens ressources', pmR, ids.size, 'liste HDV ressources')}
  </div>`;
}

const ACTION = { volume: 'Courbe 30 j', prixItem: 'Annonces', ressource: 'Lots ressource' };

function renderPlan(listes, p) {
  const plan = planScan(listes, S.etat.minutes, p);
  if (!plan.taches.length) { $('#plan').innerHTML = '<p class="muted small">Rien d\'urgent : la base est à jour.</p>'; return; }
  const min = Math.ceil(plan.secondes / 60);
  $('#plan').innerHTML = `<p class="small">${plan.taches.length} scans, environ ${min} min :
      ${plan.parType.volume} courbes, ${plan.parType.prixItem} annonces, ${plan.parType.ressource} ressources.
      ${plan.restantes ? `<span class="muted">${plan.restantes} autres en attente.</span>` : ''}</p>
    <table class="rt"><tbody>${plan.taches.slice(0, 12).map(t => `<tr><td>${tagHtml(t.tag)}</td><td class="muted">${ACTION[t.type]}</td><td class="cn">${esc(t.nom)}</td>
      <td class="r"><button class="copy${S.copies.has(t.nom) ? ' fait' : ''}" data-nom="${esc(t.nom)}" data-type="${t.type}" title="Copier le nom, à coller dans la recherche de l'HDV">${S.copies.has(t.nom) ? '✓' : COPIER}</button></td></tr>`).join('')}</tbody></table>
    ${plan.taches.length > 12 ? `<p class="muted small">… et ${plan.taches.length - 12} autres dans ce plan (détail dans les listes ci-dessous).</p>` : ''}`;
  $$('#plan button.copy').forEach(b => b.onclick = () => { copier(b.dataset.nom, b); choisirMode(MODE_TACHE[b.dataset.type]); });
}

const MODE_TACHE = { volume: 'courbe', prixItem: 'annonces', ressource: 'lots' };
function choisirMode(mode) {
  if (!mode || S.etat.mode === mode) return;
  S.etat.mode = mode; sauverEtat();
  const sel = $('#mode'); if (sel) sel.value = mode;
}

const COPIER = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

// Copie dans le presse-papier. Dans la fenêtre flottante, c'est elle qui a le focus :
// on passe par son propre navigator, avec repli sur l'ancienne méthode si l'API est refusée.
async function copier(texte, bouton) {
  const w = root.defaultView ?? window;
  try { await w.navigator.clipboard.writeText(texte); }
  catch {
    const ta = root.createElement('textarea');
    ta.value = texte; ta.style.position = 'fixed'; ta.style.opacity = '0';
    root.body.appendChild(ta); ta.select(); root.execCommand('copy'); ta.remove();
  }
  S.copies.add(texte);
  bouton.innerHTML = '✓'; bouton.classList.add('fait');
  statut(`« ${texte} » copié : colle-le dans la recherche de l'HDV.`);
}

const COLONNES = {
  volumes: [
    { cle: 'nom', t: 'Nom', v: x => esc(x.nom), cl: 'cn' },
    { cle: 'volume', t: 'Vendus 30 j', v: x => fmt(x.volume), cl: 'r' },
    { cle: 'date', t: 'Relevé', v: x => age(x.date) },
    { cle: 'score', t: 'Priorité', v: x => tagHtml(x.tag) },
  ],
  prixItems: [
    { cle: 'nom', t: 'Nom', v: x => esc(x.nom), cl: 'cn' },
    { cle: 'volume', t: 'Vol.', v: x => fmt(x.volume), cl: 'r' },
    { cle: 'prixMin', t: 'Prix min', v: x => fmtK(x.prixMin), cl: 'r' },
    { cle: 'rendementEstime', t: 'Rend. est.', v: x => pct(x.rendementEstime) + (x.precision ? `<span class="prec">${x.precision}</span>` : ''), cl: 'r' },
    { cle: 'date', t: 'Relevé', v: x => age(x.date) },
    { cle: 'score', t: 'Priorité', v: x => tagHtml(x.tag) },
  ],
  ressources: [
    { cle: 'nom', t: 'Nom', v: x => esc(x.nom), cl: 'cn' },
    { cle: 'items', t: 'Items', v: x => x.items, cl: 'r' },
    { cle: 'x1', t: 'x1', v: x => fmtK(x.lots?.[1]), cl: 'r' },
    { cle: 'x10', t: 'x10', v: x => fmtK(x.lots?.[10]), cl: 'r' },
    { cle: 'x100', t: 'x100', v: x => fmtK(x.lots?.[100]), cl: 'r' },
    { cle: 'date', t: 'Relevé', v: x => age(x.date) },
    { cle: 'score', t: 'Priorité', v: x => tagHtml(x.tag) },
  ],
};
const valeurTri = (x, cle) => cle === 'x1' ? x.lots?.[1] : cle === 'x10' ? x.lots?.[10] : cle === 'x100' ? x.lots?.[100] : x[cle];

function renderListe(listes) {
  const nom = S.etat.liste;
  $$('#list-switch button').forEach(b => b.classList.toggle('on', b.dataset.list === nom));
  const cols = COLONNES[nom];
  const { cle, sens } = S.etat.tri;
  const f = S.etat.filtre.toLowerCase();
  let rows = listes[nom].filter(x => (!S.etat.tag || x.tag === S.etat.tag) && (!f || x.nom.toLowerCase().includes(f)));
  if (cols.some(c => c.cle === cle)) {
    rows = [...rows].sort((a, b) => {
      const va = valeurTri(a, cle), vb = valeurTri(b, cle);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb, 'fr') : va - vb) * sens;
    });
  }
  const vides = { volumes: 'Aucun item dans le focus.', prixItems: 'Aucun item au-dessus du seuil de volume pour l\'instant : commence par les volumes.', ressources: 'Les ressources apparaissent une fois des items au-dessus du seuil de volume.' };
  if (!rows.length) { $('#liste').innerHTML = `<p class="muted small">${listes[nom].length ? 'Aucune ligne ne correspond au filtre.' : vides[nom]}</p>`; return; }
  $('#liste').innerHTML = `<table class="rt"><thead><tr>${cols.map(c => `<th class="sort ${c.cl ?? ''} ${c.cle === cle ? 'on' : ''}" data-cle="${c.cle}">${c.t}${c.cle === cle ? (sens > 0 ? ' ▴' : ' ▾') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(0, S.plusLignes).map(x => `<tr class="click" data-id="${x.id}">${cols.map(c => `<td class="${c.cl ?? ''}">${c.v(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="muted small">${rows.length} lignes${rows.length > S.plusLignes ? ` · <button class="link small" id="plus">afficher plus</button>` : ''}</p>`;
  $$('#liste th.sort').forEach(th => th.onclick = () => {
    const k = th.dataset.cle;
    S.etat.tri = { cle: k, sens: S.etat.tri.cle === k ? -S.etat.tri.sens : (k === 'nom' ? 1 : -1) };
    sauverEtat(); renderTout();
  });
  $$('#liste tr.click').forEach(tr => tr.onclick = () => saisieManuelle(nom, Number(tr.dataset.id)));
  const plus = $('#plus'); if (plus) plus.onclick = () => { S.plusLignes += 100; renderTout(); };
}

// Saisie à la main depuis les listes
function saisieManuelle(liste, id) {
  const cat = S.catalogue, w = root.defaultView ?? window;
  const now = Date.now();
  if (liste === 'ressources') {
    const nom = cat.ressources[id]?.nom;
    const l = S.base.ressources[id]?.lots?.valeurs ?? {};
    const s = w.prompt(`${nom} : prix des lots x1 / x10 / x100 (vide si absent)`, [l[1] ?? '', l[10] ?? '', l[100] ?? ''].join(' / '));
    if (s == null) return;
    const [a, b, c] = s.split('/').map(nombreSaisi);
    const offre = {}; if (a) offre[1] = a; if (b) offre[10] = b; if (c) offre[100] = c;
    if (Object.keys(offre).length) majRessource(S.base, id, offre, now);
  } else {
    const nom = cat.items.find(i => i.id === id)?.nom;
    if (liste === 'volumes') {
      const s = w.prompt(`${nom} : articles vendus sur 30 jours`, S.base.items[id]?.volume?.valeur ?? '');
      if (s == null) return; const v = nombreSaisi(s); if (v != null) majVolume(S.base, id, v, now);
    } else {
      const s = w.prompt(`${nom} : prix des annonces les moins chères, séparés par des virgules`, (S.base.items[id]?.prix?.valeurs ?? []).join(', '));
      if (s == null) return; const v = s.split(/[,;]/).map(nombreSaisi).filter(Boolean); if (v.length) majPrixItem(S.base, id, v, now);
    }
  }
  sauverBase(); renderTout();
}

// ---------- dernière lecture : enregistrée automatiquement, modifiable ----------
// S.derniere = { type, identifie, avant (base avant enregistrement), edition, enregistre, alerte, messages }

function resume(L) {
  const r = L.identifie;
  if (L.type === 'liste') {
    const ok = r.filter(x => !x.inconnu);
    return `<table class="rt"><tbody>${ok.map(x => `<tr><td class="cn">${esc(x.nom)}</td><td class="r">${fmt(x.prixMoyen)}</td></tr>`).join('')}</tbody></table>
      ${r.length > ok.length ? `<p class="muted small">${r.length - ok.length} lignes hors catalogue ignorées.</p>` : ''}`;
  }
  if (!r.objet) return `<p class="small">Titre lu : « ${esc(r.titre ?? '?')} ».</p>`;
  if (L.type === 'courbe') return `<p class="small">${fmt(r.vendus)} vendus sur 30 jours</p>`;
  if (r.objet.genre === 'ressource') {
    const lot = t => fmt(r.annonces.find(a => a.lot === t)?.prix);
    return `<p class="small">x1 <b>${lot(1)}</b> · x10 <b>${lot(10)}</b> · x100 <b>${lot(100)}</b></p>`;
  }
  return `<p class="small">${r.annonces.slice(0, 8).map(a => `<b${a.sur ? '' : ' class="bad" title="à vérifier"'}>${fmt(a.prix)}</b>`).join(' · ')}</p>`;
}

function formulaire(L) {
  const r = L.identifie;
  if (L.type === 'liste') {
    return `<table class="rt"><tbody>${r.map((x, i) => `
      <tr class="${x.inconnu ? 'off' : ''}"><td><input type="checkbox" data-i="${i}" class="chk" ${x.inconnu ? 'disabled' : 'checked'}></td>
      <td class="cn">${x.inconnu ? `<span class="muted">hors catalogue : ${esc(x.inconnu)}</span>` : esc(x.nom)}</td>
      <td class="r"><input class="num" data-i="${i}" data-champ="prixMoyen" value="${x.prixMoyen ?? ''}" ${x.inconnu ? 'disabled' : ''}></td></tr>`).join('')}</tbody></table>`;
  }
  if (L.type === 'courbe') return `<div class="row small">Vendus sur 30 jours <input class="num" data-champ="vendus" value="${r.vendus ?? ''}"></div>`;
  if (r.objet.genre === 'ressource') {
    const lot = t => r.annonces.find(a => a.lot === t)?.prix ?? '';
    return `<div class="row small">x1 <input class="num" data-champ="x1" value="${lot(1)}"> x10 <input class="num" data-champ="x10" value="${lot(10)}"> x100 <input class="num" data-champ="x100" value="${lot(100)}"></div>`;
  }
  return `<div class="row small">${Array.from({ length: Math.max(5, Math.min(8, r.annonces.length)) }, (_, i) => r.annonces[i]).map((a, i) =>
    `<input class="num big" data-i="${i}" data-champ="prix" value="${a?.prix ?? ''}"${a && !a.sur ? ' title="à vérifier" style="border-color:var(--ec)"' : ''}>`).join('')}</div>`;
}

const TITRES = { courbe: 'Courbe 30 j', liste: 'Liste HDV' };
function titreLecture(L) {
  const r = L.identifie;
  if (L.type === 'liste') return `Liste HDV · ${r.filter(x => !x.inconnu).length} prix moyens`;
  const genre = L.type === 'courbe' ? TITRES.courbe : r.objet?.genre === 'ressource' ? 'Lots' : 'Annonces';
  return `${genre} · ${r.objet ? esc(r.objet.nom) : 'objet non reconnu'}`;
}

function renderLecture() {
  const L = S.derniere;
  if (!L) { $('#lecture').innerHTML = ''; return; }
  const etat = L.enregistre ? '<span class="tag ok-tag">enregistré</span>' : '<span class="tag faire">non enregistré</span>';
  const boutons = L.edition
    ? `<button id="lect-valider" class="primary small">Valider</button><button id="lect-fermer" class="secondary small">Fermer</button>`
    : `${L.identifie.objet !== null || L.type === 'liste' ? `<button id="lect-modifier" class="secondary small">${L.enregistre ? 'Modifier' : 'Corriger et enregistrer'}</button>` : ''}
       ${L.enregistre ? '<button id="lect-annuler" class="link small">annuler</button>' : ''}`;
  $('#lecture').innerHTML = `<div class="lect"><div class="row"><h3>${titreLecture(L)}</h3><div class="spacer"></div>${etat}</div>
    ${L.alerte ? `<p class="small bad">${esc(L.alerte)}</p>` : ''}
    ${L.edition ? formulaire(L) : resume(L)}
    <div class="row">${boutons}</div></div>`;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('#lect-modifier', () => { L.edition = true; renderLecture(); });
  on('#lect-fermer', () => { L.edition = false; renderLecture(); });
  on('#lect-valider', validerEdition);
  on('#lect-annuler', () => { S.base = importer(L.avant); sauverBase(); S.derniere = null; statut('Lecture annulée : la base est revenue à son état précédent.'); renderTout(); });
}

// Enregistre une lecture (identifiée) dans la base ; retourne les messages
function enregistrer(L) {
  const res = appliquer(S.base, L.type, L.type === 'liste' ? L.identifie.filter(x => !x.inconnu && x.garder !== false) : L.identifie, L.date);
  sauverBase();
  return res.enregistres;
}

function validerEdition() {
  const L = S.derniere, r = L.identifie;
  const val = (champ, i) => nombreSaisi($(`#lecture input[data-champ="${champ}"]${i != null ? `[data-i="${i}"]` : ''}`)?.value ?? '');
  if (L.type === 'liste') r.forEach((x, i) => { x.prixMoyen = val('prixMoyen', i); x.garder = !!$(`#lecture input.chk[data-i="${i}"]`)?.checked; });
  else if (L.type === 'courbe') { r.vendus = val('vendus'); r.trenteJours = true; }
  else if (r.objet.genre === 'ressource') r.annonces = [[1, 'x1'], [10, 'x10'], [100, 'x100']].map(([lot, c]) => ({ lot, prix: val(c), sur: true })).filter(a => a.prix);
  else r.annonces = $$('#lecture input[data-champ="prix"]').map(el => ({ lot: 1, prix: nombreSaisi(el.value), sur: true })).filter(a => a.prix);
  S.base = importer(L.avant); // on repart de la base d'avant la lecture
  L.messages = enregistrer(L);
  L.enregistre = L.messages.length > 0; L.alerte = null; L.edition = false;
  statut(L.enregistre ? `Corrigé : ${L.messages.join(' · ')}` : 'Rien à enregistrer.');
  renderTout();
}

function statut(msg) { const el = $('#scan-status'); if (el) el.textContent = msg; }

// ---------- résultats ----------
function renderResultats(cat, p) {
  const ev = baseEvaluation(cat, S.base, p);
  const budget = S.etat.budget * 1e6;
  $('#eval-sub').textContent = `${ev.eligibles.length} rentables sur ${ev.eligibles.length + ev.ecartes.length} entièrement scannés`;

  if (!ev.items.length) {
    $('#allocation').innerHTML = '<p class="muted small">Aucun item entièrement scanné pour l\'instant (volume, annonces et lots de toutes les ressources, relevés récents).</p>';
  } else {
    const a = allouer(ev.items, ev.offres, budget, p);
    const lots = l => [[100, 'x100'], [10, 'x10'], [1, 'x1']].filter(([t]) => l.plan.lots[t]).map(([t, n]) => `${l.plan.lots[t]} × ${n}`).join(' + ');
    $('#allocation').innerHTML = a.choix.length ? `
      <div class="kpis">
        <div class="kpi"><div class="v ok">${fmtK(a.marge)}</div><div class="l">marge, ${pct(a.rendement)}</div></div>
        <div class="kpi"><div class="v">${fmtK(a.capital)}</div><div class="l">investis sur ${fmtK(budget)}</div></div>
        <div class="kpi"><div class="v">${a.crafts}</div><div class="l">crafts à faire</div></div>
      </div>
      <table class="rt"><thead><tr><th>Item</th><th class="r">Crafts</th><th class="r">Coût</th><th class="r">Marge</th><th class="r">Rend.</th></tr></thead><tbody>
      ${a.choix.map(o => `<tr><td class="cn">${esc(o.nom)}${o.alertes.length ? ` <span class="tag faire" title="${esc(o.alertes.join(', '))}">à revérifier</span>` : ''}</td><td class="r">${o.n}</td><td class="r">${fmtK(o.capital)}</td><td class="r">${fmtK(o.marge)}</td><td class="r">${pct(o.rendement)}</td></tr>
        <tr><td colspan="5"><details class="more"><summary>liste de courses</summary><table class="rt courses"><tbody>
        ${o.craft.lignes.map(l => `<tr><td class="cn">${esc(l.nom)}</td><td class="r">${l.q}</td><td>${lots(l)}</td><td class="r">${fmtK(l.plan.cout)}</td><td>${l.plan.alerte ? '<span class="tag faire">à revérifier</span>' : ''}</td></tr>`).join('')}
        </tbody></table></details></td></tr>`).join('')}
      </tbody></table>
      <p class="muted small">Effort compté ${fmtK(p.coutEffortParCraft)} par craft. Les ressources marquées « à revérifier » risquent de remonter : regarde l'HDV ressources avant d'acheter.</p>`
      : '<p class="muted small">Aucune combinaison rentable dans ce budget.</p>';
  }

  $('#evalues').innerHTML = ev.eligibles.length + ev.ecartes.length ? `
    <table class="rt"><thead><tr><th>Item</th><th class="r">Vol.</th><th class="r">Vente</th><th class="r">Craft</th><th class="r">Rend.</th></tr></thead><tbody>
    ${ev.eligibles.map(e => { const it = ev.items.find(i => i.id === e.id); return `<tr><td class="cn">${esc(e.nom)}</td><td class="r">${it.volumeMois}</td><td class="r">${fmtK(it.prixVente)}</td><td class="r">${fmtK(e.coutCraft)}</td><td class="r ok">${pct(e.rendement)}</td></tr>`; }).join('')}
    </tbody></table>
    ${ev.ecartes.length ? `<details class="more"><summary>${ev.ecartes.length} écartés</summary><table class="rt"><tbody>
      ${ev.ecartes.map(e => `<tr><td class="cn">${esc(e.nom)}</td><td class="small muted">${esc(e.raisons.join(' ; '))}</td></tr>`).join('')}</tbody></table></details>` : ''}`
    : '';
}

// ---------- base et réglages ----------
function renderBase(cat, p) {
  const items = Object.values(S.base.items), res = Object.values(S.base.ressources);
  $('#base-stats').innerHTML = `<div class="kpis">
    <div class="kpi"><div class="v">${items.filter(i => i.volume).length}</div><div class="l">volumes</div></div>
    <div class="kpi"><div class="v">${items.filter(i => i.prix).length}</div><div class="l">annonces d'items</div></div>
    <div class="kpi"><div class="v">${res.filter(r => r.lots).length}</div><div class="l">lots de ressources</div></div>
  </div><p class="muted small">Catalogue DofusDB du ${cat.genereLe} · ${itemsFocus(cat, p).length} items dans le focus. La base est conservée dans ce navigateur : exporte-la de temps en temps.</p>`;

  const r = S.etat.reglages;
  $('#reglages').innerHTML = `
    <span>Volume minimum (ventes / 30 j)</span><input class="num" data-reg="volumeMin" value="${r.volumeMin}">
    <span>Rendement minimum (%)</span><input class="num" data-reg="margeMin" value="${r.margeMin}">
    <span>Prix de vente visé</span><select data-reg="modePrixVente"><option value="min" ${r.modePrixVente === 'min' ? 'selected' : ''}>annonce la moins chère</option><option value="moy3" ${r.modePrixVente === 'moy3' ? 'selected' : ''}>moyenne des 3 moins chères</option></select>
    <span>Effort par craft (k kamas)</span><input class="num" data-reg="effort" value="${r.effort}">
    <span>Niveau Forgeron</span><input class="num" data-reg="forgeron" value="${r.forgeron}">`;
  $$('#reglages [data-reg]').forEach(el => el.onchange = () => { S.etat.reglages[el.dataset.reg] = el.value; sauverEtat(); renderTout(); });
}

function renderTout() {
  renderVue();
  renderCapture();
  renderLecture();
  if (!S.catalogue) return;
  const p = params();
  if (S.etat.vue === 'scan') {
    const listes = listesScan(S.catalogue, S.base, p);
    renderPasse(S.catalogue, p);
    renderPlan(listes, p);
    renderListe(listes);
    $('#minutes').value = S.etat.minutes;
  } else if (S.etat.vue === 'resultats') {
    $('#budget').value = S.etat.budget;
    renderResultats(S.catalogue, p);
  } else renderBase(S.catalogue, p);
}

// ---------- capture et scan ----------
async function basculerCapture() {
  if (Cap.enCours()) { Cap.arreter(); renderCapture(); return; }
  try {
    const { width, height } = await Cap.demarrer(() => { renderCapture(); statut('Capture terminée.'); });
    statut(`Capture de la fenêtre du jeu (${width} × ${height}). Ouvre un écran HDV puis « Scanner ».`);
    Cap.prechauffer(m => m.status && m.progress != null && m.progress < 1 && statut(`Préparation de la lecture : ${m.status} ${Math.round(m.progress * 100)} %`));
  } catch (e) { statut('Capture annulée.'); }
  renderCapture();
}

async function scanner() {
  const b = $('#scan'); b.classList.add('busy'); b.disabled = true;
  const mode = S.etat.mode;
  try {
    const brut = await Cap.scanner(S.etat.zones, mode, m => m.status && statut(`Lecture : ${m.status}…`));
    if (!brut) {
      S.derniere = null;
      statut(`Rien lu dans la zone « ${Cap.MODES[mode].libelle} ». Vérifie que la fenêtre est ouverte et visible, ou redéfinis les zones.`);
    } else {
      const L = { type: brut.type, identifie: identifier(brut.type, brut.lecture, S.catalogue), avant: exporter(S.base), date: Date.now(), edition: false };
      const o = L.identifie.objet;
      if (L.type !== 'liste' && !o) L.alerte = 'Objet non reconnu : rien n\'a été enregistré.';
      else if (L.type === 'courbe' && !L.identifie.trenteJours) L.alerte = 'Onglet 30 jours non détecté : rien n\'a été enregistré. Passe sur l\'onglet 30 jours et relance, ou corrige à la main.';
      else {
        if (mode === 'lots' && o?.genre === 'item') L.alerte = 'Mode « lots de ressource » mais l\'objet est un équipement : enregistré comme annonces.';
        if (mode === 'annonces' && o?.genre === 'ressource') L.alerte = 'Mode « annonces d\'item » mais l\'objet est une ressource : enregistré comme lots.';
        L.messages = enregistrer(L);
        L.enregistre = L.messages.length > 0;
      }
      S.derniere = L;
      statut(L.enregistre ? 'Enregistré. Corrige avec « Modifier » si besoin, sinon passe au suivant.' : 'Lecture non enregistrée.');
    }
  } catch (e) { statut('Erreur de lecture : ' + e.message); }
  b.classList.remove('busy'); b.disabled = !Cap.enCours();
  renderTout();
}

// ---------- zones ----------
const ETAPES = [
  ['liste', 'Liste HDV', 'Encadre la liste des objets (colonnes Nom, Niveau, Prix moyen).'],
  ['detail', 'Panneau détail', 'Encadre le panneau de gauche qui s\'ouvre quand tu cliques un objet (nom, prix moyen, lots / annonces). Prends toute sa hauteur, annonces comprises.'],
  ['courbe', 'Cours du marché', 'Encadre la fenêtre « Cours du marché » (titre, onglets, courbe).'],
];
function ouvrirZones() {
  let frame;
  try { frame = Cap.image().canvas; } catch (e) { statut(e.message); return; }
  const zones = { ...S.etat.zones };
  let etape = 0, drag = null;
  const modal = $('#zones-modal'), cv = $('#zones-canvas'), ctx = cv.getContext('2d');
  cv.width = frame.width; cv.height = frame.height;
  const dessiner = () => {
    ctx.drawImage(frame, 0, 0);
    ETAPES.forEach(([cle], i) => {
      const z = zones[cle]; ctx.lineWidth = Math.max(3, frame.width / 500);
      ctx.strokeStyle = i === etape ? '#f0b84a' : '#3cbf63aa';
      ctx.strokeRect(z.x * cv.width, z.y * cv.height, z.w * cv.width, z.h * cv.height);
    });
    if (drag) { ctx.strokeStyle = '#f0b84a'; ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); }
    const [, t, h] = ETAPES[etape];
    $('#zones-title').textContent = `Zone ${etape + 1} / 3 : ${t}`;
    $('#zones-help').textContent = h + ' Glisse pour dessiner. Le cadre actuel est en jaune.';
  };
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  cv.onmousedown = e => { const p = pos(e); drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; };
  cv.onmousemove = e => { if (!drag) return; const p = pos(e); drag.x1 = p.x; drag.y1 = p.y; dessiner(); };
  cv.onmouseup = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    drag = null;
    if (w > 20 && h > 20) {
      zones[ETAPES[etape][0]] = { x: x / cv.width, y: y / cv.height, w: w / cv.width, h: h / cv.height };
      etape++;
      if (etape === ETAPES.length) { S.etat.zones = zones; sauverEtat(); fermer(); statut('Zones enregistrées.'); return; }
    }
    dessiner();
  };
  const fermer = () => modal.classList.add('hidden');
  $('#zones-cancel').onclick = fermer;
  $('#zones-default').onclick = () => { S.etat.zones = ZONES_DEFAUT; sauverEtat(); fermer(); statut('Zones par défaut rétablies.'); };
  modal.classList.remove('hidden');
  dessiner();
}

// ---------- événements ----------
function brancher() {
  $$('#view-switch button').forEach(b => b.onclick = () => { S.etat.vue = b.dataset.view; sauverEtat(); renderTout(); });
  $$('#list-switch button').forEach(b => b.onclick = () => { S.etat.liste = b.dataset.list; S.etat.tri = { cle: 'score', sens: -1 }; S.plusLignes = 50; sauverEtat(); renderTout(); });
  $('#cap-start').onclick = basculerCapture;
  $('#scan').onclick = scanner;
  $('#mode').innerHTML = Object.entries(Cap.MODES).map(([k, m]) => `<option value="${k}">${m.libelle}</option>`).join('');
  $('#mode').value = S.etat.mode;
  $('#mode').onchange = e => { S.etat.mode = e.target.value; sauverEtat(); };
  $('#zones-btn').onclick = ouvrirZones;
  $('#minutes').onchange = e => { S.etat.minutes = Math.max(1, +e.target.value || 10); sauverEtat(); renderTout(); };
  $('#budget').onchange = e => { S.etat.budget = Math.max(0, Number(String(e.target.value).replace(',', '.')) || 0); sauverEtat(); renderTout(); };
  $('#list-filter').oninput = e => { S.etat.filtre = e.target.value; renderTout(); };
  $('#tag-filter').onchange = e => { S.etat.tag = e.target.value; sauverEtat(); renderTout(); };
  $('#tag-filter').value = S.etat.tag;
  $('#base-export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exporter(S.base)], { type: 'application/json' }));
    a.download = `craft-dofus-base-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $('#base-import').onclick = () => $('#base-file').click();
  $('#base-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { S.base = importer(await f.text()); sauverBase(); renderTout(); } catch (err) { alert(err.message); }
    e.target.value = '';
  };
  $('#base-reset').onclick = () => { if (confirm('Vider toute la base de prix ? (export conseillé avant)')) { S.base = creerBase(); sauverBase(); renderTout(); } };
}

// ---------- fenêtre flottante (Document Picture-in-Picture, Chrome / Edge) ----------
const pipBtn = document.querySelector('#pip');
if ('documentPictureInPicture' in window) pipBtn.classList.remove('hidden');
pipBtn.onclick = async () => {
  if (root !== document) { window.documentPictureInPicture.window?.close(); return; }
  let pip;
  try { pip = await window.documentPictureInPicture.requestWindow({ width: 440, height: 820 }); }
  catch (e) { alert('Fenêtre flottante indisponible : ' + e.message); return; }
  for (const ss of document.styleSheets) {
    try { const st = pip.document.createElement('style'); st.textContent = [...ss.cssRules].map(r => r.cssText).join('\n'); pip.document.head.appendChild(st); }
    catch { const link = pip.document.createElement('link'); link.rel = 'stylesheet'; link.href = ss.href; pip.document.head.appendChild(link); }
  }
  pip.document.title = 'Craft Dofus';
  const parts = ['header.top', 'main', '#zones-modal'].map(s => document.querySelector(s));
  const ph = document.createElement('div');
  ph.className = 'card pip-placeholder';
  ph.innerHTML = '<p>L\'outil est ouvert dans la fenêtre flottante.</p><p class="muted small">Ferme-la pour le ramener ici.</p>';
  document.body.insertBefore(ph, document.querySelector('footer'));
  parts.forEach(el => pip.document.body.appendChild(el));
  root = pip.document;
  pipBtn.textContent = 'Ramener';
  renderTout();
  pip.addEventListener('pagehide', () => {
    parts.forEach(el => document.body.insertBefore(el, ph));
    ph.remove();
    root = document;
    pipBtn.textContent = 'Flottant';
    renderTout();
  });
};

// ---------- démarrage ----------
brancher();
renderTout();
fetch('data/catalogue.json').then(r => r.json()).then(c => { S.catalogue = c; renderTout(); })
  .catch(() => statut('Catalogue introuvable (data/catalogue.json).'));
