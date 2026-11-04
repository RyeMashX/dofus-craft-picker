// Interface : vues Scan / Résultats / Base, fenêtre flottante, capture et OCR.

import { PARAMS } from './params.js';
import { creerBase, majVolume, majPrixItem, majRessource, exporter, importer, JOUR } from './base.js';
import { itemsFocus, baseEvaluation } from './entonnoir.js';
import { renderPlanScan, tempsMesures } from './vue-plan.js';
import { renderDonnees } from './vue-donnees.js';
import { etatItem } from './fraicheur.js';
import { allouer } from './allocation.js';
import { identifier, appliquer } from './ocr/identification.js';
import { trouver, normaliser } from './ocr/correspondance.js';
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
  forgeron: PARAMS.metiers.Forgeron, effort: PARAMS.coutEffortParCraft / 1000, partCraft: 70,
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
    partCraft: (+r.partCraft || 70) / 100,
    ...(({ tempsScan, mesures }) => ({ tempsScan, tempsMesures: mesures }))(tempsMesures(S.etat.journal, PARAMS.tempsScan)),
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
const nombreSaisi = s => { const v = Number(String(s).replace(/[^\d]/g, '')); return String(s).trim() && Number.isFinite(v) ? v : null; };

// ---------- rendu ----------
function renderVue() {
  const v = S.etat.vue;
  root.body.className = 'view-' + v + (root !== document ? ' pip' : '');
  $$('#view-switch button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  for (const nom of ['scan', 'donnees', 'resultats', 'base']) $$(`.view-${nom}`).forEach(el => el.classList.toggle('hidden', nom !== v));
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

const boutonCopier = (nom, type) => `<button class="copy${S.copies.has(nom) ? ' fait' : ''}" data-nom="${esc(nom)}" data-type="${type}" title="Copier le nom, à coller dans la recherche de l'HDV">${S.copies.has(nom) ? '✓' : COPIER}</button>`;
// Copier un nom règle aussi le mode de scan sur le type de tâche (courbe, annonces, lots)
function brancherCopier(sel) {
  $$(`${sel} button.copy`).forEach(b => b.onclick = e => { e.stopPropagation(); copier(b.dataset.nom, b); choisirMode(MODE_TACHE[b.dataset.type]); });
}

const MODE_TACHE = { volume: 'courbe', prixItem: 'annonces', ressource: 'lots' };
function choisirMode(mode) {
  if (!mode || S.etat.mode === mode) return;
  S.etat.mode = mode; sauverEtat();
  const sel = $('#mode'); if (sel) sel.value = mode;
  renderSaisie();
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

// ---------- dernière lecture : enregistrée automatiquement, modifiable ----------
// S.derniere = { type, identifie, avant (base avant enregistrement), edition, enregistre, alerte, messages }

function resume(L) {
  const r = L.identifie;
  if (L.type === 'liste') {
    const hors = r.filter(x => x.inconnu).length, retires = r.filter(x => x.retire).length;
    return `<table class="rt"><tbody>${r.map((x, i) => x.inconnu || x.retire ? '' : `<tr><td class="cn">${esc(x.nom)}</td><td class="r">${fmt(x.prixMoyen)}</td>
        <td class="r"><button class="retirer" data-i="${i}" title="Retirer cette ligne (mauvais objet reconnu)">✕</button></td></tr>`).join('')}</tbody></table>
      ${hors ? `<p class="muted small">${hors} lignes hors catalogue ignorées.</p>` : ''}
      ${retires ? `<p class="muted small">${retires} ligne${retires > 1 ? 's' : ''} retirée${retires > 1 ? 's' : ''}. Pour enregistrer le bon objet : « Saisir ».</p>` : ''}`;
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
    return `<table class="rt"><tbody>${r.map((x, i) => x.inconnu || x.retire ? '' : `
      <tr><td class="cn">${esc(x.nom)}</td>
      <td class="r"><input class="num" data-i="${i}" data-champ="prixMoyen" value="${x.prixMoyen ?? ''}"></td>
      <td class="r"><button class="retirer" data-i="${i}" title="Retirer cette ligne (mauvais objet reconnu)">✕</button></td></tr>`).join('')}</tbody></table>`;
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
  if (L.type === 'liste') return `Liste HDV · ${r.filter(x => !x.inconnu && !x.retire).length} prix moyens`;
  const genre = L.type === 'courbe' ? TITRES.courbe : r.objet?.genre === 'ressource' ? 'Lots' : 'Annonces';
  return `${genre} · ${r.objet ? esc(r.objet.nom) : 'objet non reconnu'}`;
}

function renderLecture() {
  renderSaisie();
  const L = S.derniere;
  if (!L) { $('#lecture').innerHTML = S.diagSeul ? `<div class="lect">${diagHtml(true)}</div>` : ''; brancherDiag(); return; }
  const etat = L.enregistre ? '<span class="tag ok-tag">enregistré</span>' : '<span class="tag faire">non enregistré</span>';
  const boutons = L.edition
    ? `<button id="lect-valider" class="primary small">Valider</button><button id="lect-fermer" class="secondary small">Fermer</button>`
    : `${L.identifie.objet !== null || L.type === 'liste' ? `<button id="lect-modifier" class="secondary small">${L.enregistre ? 'Modifier' : 'Corriger et enregistrer'}</button>` : ''}
       ${L.enregistre ? '<button id="lect-annuler" class="link small">annuler</button>' : ''}`;
  $('#lecture').innerHTML = `<div class="lect"><div class="row"><h3>${titreLecture(L)}</h3><div class="spacer"></div>${etat}</div>
    ${L.alerte ? `<p class="small bad">${esc(L.alerte)}</p>` : ''}
    ${L.edition ? formulaire(L) : resume(L)}
    <div class="row">${boutons}</div>${diagHtml(!L.enregistre)}</div>`;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  brancherDiag();
  $$('#lecture button.retirer').forEach(b => b.onclick = () => retirerLigne(+b.dataset.i));
  on('#lect-modifier', () => { L.edition = true; renderLecture(); });
  on('#lect-fermer', () => { L.edition = false; renderLecture(); });
  on('#lect-valider', validerEdition);
  on('#lect-annuler', () => { S.base = importer(L.avant); sauverBase(); S.derniere = null; statut('Lecture annulée : la base est revenue à son état précédent.'); renderTout(); });
}

// ---------- saisie manuelle (quand la lecture échoue, ou bouton « Saisir ») ----------
const CHAMPS_SAISIE = {
  courbe: [['vendus', 'Vendus sur 30 j', '']],
  annonces: [['prix', 'Prix les plus bas', 'séparés par des virgules']],
  lots: [['x1', 'x1', ''], ['x10', 'x10', ''], ['x100', 'x100', '']],
  liste: [['prixMoyen', 'Prix moyen', '']],
};

function candidatsSaisie(mode) {
  const items = S.catalogue.items.map(i => ({ id: i.id, nom: i.nom, niveau: i.niveau, genre: 'item', info: `${i.niveau} · ${i.type}` }));
  const res = Object.values(S.catalogue.ressources).map(r => ({ id: r.id, nom: r.nom, niveau: r.niveau, genre: 'ressource', info: `${r.niveau} · ressource` }));
  return mode === 'lots' ? res : mode === 'liste' ? [...items, ...res] : items;
}

// Retrouve l'objet à partir du nom tapé : nom exact (au plus haut niveau en cas d'homonymes), sinon le plus proche
function objetSaisi(nom, mode) {
  const cands = candidatsSaisie(mode), n = normaliser(nom);
  const exacts = cands.filter(c => normaliser(c.nom) === n).sort((a, b) => b.niveau - a.niveau);
  return exacts[0] ?? trouver(nom, cands, { confianceMin: 0.8 })?.candidat ?? null;
}

// Préremplissage à partir d'une lecture ratée : nom deviné et valeurs déjà lues
function preremplir(type, lecture) {
  const v = {};
  let titre = '';
  if (type === 'courbe') { titre = lecture.titre ?? ''; if (lecture.vendus != null) v.vendus = lecture.vendus; }
  if (type === 'detail') {
    titre = lecture.titre ?? '';
    const prix = (lecture.annonces ?? []).filter(a => a.prix);
    if (S.etat.mode === 'lots') { for (const a of prix) if (a.lot) v['x' + a.lot] = a.prix; }
    else if (prix.length) v.prix = prix.map(a => a.prix).join(', ');
  }
  const devine = titre ? trouver(titre, candidatsSaisie(S.etat.mode), { confianceMin: 0.5 })?.candidat : null;
  return { nom: devine?.nom ?? '', valeurs: v };
}

function ouvrirSaisie(pre = {}) { S.saisie = { nom: pre.nom ?? '', valeurs: pre.valeurs ?? {}, erreur: null }; }

// Auto-complétion maison : la liste native (datalist) ne s'affiche pas dans la fenêtre flottante.
// Correspondance sur le début des mots, sans accents (« brul » → Alliance Brûlâme). Flèches + Entrée, ou clic.
function suggestions(texte, mode, max = 8) {
  const q = normaliser(texte);
  if (q.length < 2) return [];
  const mots = q.split(' ');
  const vus = new Set(), res = [];
  for (const c of candidatsSaisie(mode)) {
    const n = normaliser(c.nom);
    if (vus.has(n)) continue;
    const ns = n.split(' ');
    if (!mots.every(m => ns.some(w => w.startsWith(m)))) continue;
    vus.add(n);
    res.push({ ...c, rang: (n.startsWith(q) ? 0 : 1) * 1000 - c.niveau });
  }
  return res.sort((a, b) => a.rang - b.rang || a.nom.localeCompare(b.nom, 'fr')).slice(0, max);
}

function brancherAutocompletion(input, liste, mode, onChoix) {
  let items = [], actif = -1;
  const afficher = () => {
    if (!items.length) { liste.classList.add('hidden'); return; }
    liste.innerHTML = items.map((c, i) => `<div class="ac-item${i === actif ? ' on' : ''}" data-i="${i}">${esc(c.nom)} <span class="muted small">${esc(c.info)}</span></div>`).join('');
    liste.classList.remove('hidden');
    liste.querySelectorAll('.ac-item').forEach(el => el.onmousedown = e => { e.preventDefault(); choisir(+el.dataset.i); });
  };
  const choisir = i => { const c = items[i]; if (!c) return; input.value = c.nom; items = []; afficher(); onChoix(c.nom); };
  input.oninput = () => { items = suggestions(input.value, mode); actif = items.length ? 0 : -1; afficher(); S.saisie.nom = input.value; };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' && items.length) { actif = (actif + 1) % items.length; afficher(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && items.length) { actif = (actif - 1 + items.length) % items.length; afficher(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items.length) choisir(actif); else enregistrerSaisie(); }
    else if (e.key === 'Escape') { items = []; afficher(); }
  };
  input.onblur = () => { items = []; afficher(); };
}

function renderSaisie() {
  const zone = $('#saisie');
  if (!zone) return;
  if (!S.saisie || !S.catalogue) { zone.innerHTML = ''; return; }
  const mode = S.etat.mode, sz = S.saisie;
  zone.innerHTML = `<div class="lect saisie"><div class="row"><h3>Saisie manuelle · ${esc(Cap.MODES[mode].libelle)}</h3><div class="spacer"></div>
      <button id="saisie-fermer" class="link small">fermer</button></div>
    <div class="ac"><input id="saisie-nom" placeholder="${mode === 'lots' ? 'Nom de la ressource' : mode === 'liste' ? "Nom de l'item ou de la ressource" : "Nom de l'item"}" value="${esc(sz.nom)}" autocomplete="off" spellcheck="false">
      <div id="ac-liste" class="ac-liste hidden"></div></div>
    <div class="row small">${CHAMPS_SAISIE[mode].map(([k, l, ph]) => `<label class="sel">${l} <input class="${k === 'prix' ? 'grow' : 'num big'}" data-saisie="${k}" inputmode="numeric" placeholder="${ph}" value="${esc(sz.valeurs[k] ?? '')}"></label>`).join('')}</div>
    ${sz.erreur ? `<p class="small bad">${esc(sz.erreur)}</p>` : ''}
    <div class="row"><button id="saisie-ok" class="primary small">Enregistrer</button></div></div>`;
  $('#saisie-fermer').onclick = () => { S.saisie = null; renderSaisie(); };
  $('#saisie-ok').onclick = enregistrerSaisie;
  brancherAutocompletion($('#saisie-nom'), $('#ac-liste'), mode, nom => { sz.nom = nom; root.querySelector('#saisie [data-saisie]')?.focus(); });
  $$('#saisie [data-saisie]').forEach(el => el.oninput = () => { sz.valeurs[el.dataset.saisie] = el.value; });
  $$('#saisie [data-saisie]').forEach(el => el.onkeydown = e => { if (e.key === 'Enter') enregistrerSaisie(); });
  if (!sz.nom) $('#saisie-nom').focus();
}

function enregistrerSaisie() {
  const sz = S.saisie, mode = S.etat.mode;
  sz.nom = $('#saisie-nom').value;
  $$('#saisie [data-saisie]').forEach(el => { sz.valeurs[el.dataset.saisie] = el.value; });
  const o = objetSaisi(sz.nom, mode);
  const erreur = m => { sz.erreur = m; renderSaisie(); };
  if (!o) return erreur(`« ${sz.nom} » introuvable dans le catalogue : choisis un nom dans la liste.`);
  const v = sz.valeurs, n = k => nombreSaisi(v[k] ?? '');
  let L;
  if (mode === 'courbe') {
    if (n('vendus') == null) return erreur('Indique le nombre de ventes sur 30 jours.');
    L = { type: 'courbe', identifie: { objet: o, vendus: n('vendus'), trenteJours: true } };
  } else if (mode === 'annonces') {
    const prix = String(v.prix ?? '').split(/[,;]/).map(nombreSaisi).filter(Boolean);
    if (!prix.length) return erreur('Indique au moins un prix.');
    L = { type: 'detail', identifie: { objet: o, annonces: prix.map(p => ({ lot: 1, prix: p, sur: true })) } };
  } else if (mode === 'lots') {
    const annonces = [1, 10, 100].map(t => ({ lot: t, prix: n('x' + t), sur: true })).filter(a => a.prix);
    if (!annonces.length) return erreur('Indique au moins un prix de lot.');
    L = { type: 'detail', identifie: { objet: o, annonces } };
  } else {
    if (n('prixMoyen') == null) return erreur('Indique le prix moyen.');
    L = { type: 'liste', identifie: [{ ...o, prixMoyen: n('prixMoyen') }] };
  }
  Object.assign(L, { avant: exporter(S.base), date: Date.now(), edition: false, manuel: true });
  L.messages = enregistrer(L);
  L.enregistre = L.messages.length > 0;
  S.derniere = L; S.saisie = null; S.diagSeul = false;
  statut(L.enregistre ? `Saisi : ${L.messages.join(' · ')}` : 'Rien à enregistrer.');
  renderTout();
}

// Diagnostic : ce que l'outil a réellement regardé et lu (ouvert d'office si la lecture a échoué)
function diagHtml(ouvert) {
  const d = Cap.diagnostic();
  if (!d) return '';
  return `<details class="more"${ouvert ? ' open' : ''}><summary>diagnostic : ce qui a été lu</summary>
    <p class="muted small">Image capturée ${d.taille} · zone lue ${d.zone}</p>
    <img src="${d.apercu}" alt="zone lue" style="width:100%;border-radius:6px;border:1px solid var(--line)">
    <pre class="brut">${esc(d.texte || '(aucun texte)')}</pre>
    <div class="row"><button id="diag-dl" class="secondary small">Télécharger la capture</button>
      <span class="muted small">à m'envoyer si la lecture est fausse</span></div></details>`;
}
function brancherDiag() {
  const b = $('#diag-dl'); if (!b) return;
  b.onclick = () => { const d = Cap.diagnostic(); if (!d) return; const a = root.createElement('a'); a.href = d.image(); a.download = `capture-${Date.now()}.png`; root.body.appendChild(a); a.click(); a.remove(); };
}

// Enregistre une lecture (identifiée) dans la base ; retourne les messages
// Journal des scans (sert à mesurer la durée réelle d'un scan, par type)
function noterScan(L) {
  const k = L.type === 'courbe' ? 'volume' : L.type === 'detail' ? (L.identifie.objet?.genre === 'item' ? 'prixItem' : 'ressource') : null;
  if (!k || L.manuel) return;
  S.etat.journal = [...(S.etat.journal ?? []), { k, t: Date.now() }].slice(-60);
  sauverEtat();
}

function enregistrer(L) {
  const res = appliquer(S.base, L.type, L.type === 'liste' ? L.identifie.filter(x => !x.inconnu && !x.retire) : L.identifie, L.date);
  sauverBase();
  return res.enregistres;
}

// Retire une ligne d'une lecture de liste : la base est recalculée sans elle (depuis l'état d'avant la lecture)
function retirerLigne(i) {
  const L = S.derniere, x = L.identifie[i];
  if (!x) return;
  if (L.edition) L.identifie.forEach((y, k) => { const el = $(`#lecture input[data-champ="prixMoyen"][data-i="${k}"]`); if (el) y.prixMoyen = nombreSaisi(el.value); });
  x.retire = true;
  S.base = importer(L.avant);
  L.messages = enregistrer(L);
  L.enregistre = L.messages.length > 0;
  statut(`« ${x.nom} » retiré de cette lecture.`);
  renderTout();
}

function validerEdition() {
  const L = S.derniere, r = L.identifie;
  const val = (champ, i) => nombreSaisi($(`#lecture input[data-champ="${champ}"]${i != null ? `[data-i="${i}"]` : ''}`)?.value ?? '');
  if (L.type === 'liste') r.forEach((x, i) => { if (!x.inconnu && !x.retire) x.prixMoyen = val('prixMoyen', i); });
  else if (L.type === 'courbe') { r.vendus = val('vendus'); r.trenteJours = true; }
  else if (r.objet.genre === 'ressource') r.annonces = [[1, 'x1'], [10, 'x10'], [100, 'x100']].map(([lot, c]) => ({ lot, prix: val(c), sur: true })).filter(a => a.prix);
  else r.annonces = $$('#lecture input[data-champ="prix"]').map(el => ({ lot: 1, prix: nombreSaisi(el.value), sur: true })).filter(a => a.prix);
  S.base = importer(L.avant); // on repart de la base d'avant la lecture
  L.messages = enregistrer(L);
  L.enregistre = L.messages.length > 0; L.alerte = null; L.edition = false;
  statut(L.enregistre ? `Corrigé : ${L.messages.join(' · ')}` : 'Rien à enregistrer.');
  renderTout();
}

// Message éphémère (fin de catégorie, fin d'HDV)
function toast(msg) {
  const el = root.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  root.body.appendChild(el);
  setTimeout(() => el.classList.add('sortie'), 1800);
  setTimeout(() => el.remove(), 2400);
}

function statut(msg) { const el = $('#scan-status'); if (el) el.textContent = msg; }

// ---------- résultats ----------
function renderResultats(cat, p) {
  const ev = baseEvaluation(cat, S.base, p);
  const budget = S.etat.budget * 1e6;
  const avert = id => { const a = ev.items.find(i => i.id === id)?.avertissement; return a ? ` <span class="tag faire" title="${esc(a)}">⚠ ${esc(a)}</span>` : ''; };
  $('#eval-sub').textContent = `${ev.eligibles.length} rentables sur ${ev.eligibles.length + ev.ecartes.length} utilisables`;

  if (!ev.items.length) {
    $('#allocation').innerHTML = '<p class="muted small">Aucun item utilisable pour l\'instant : il faut un volume et un prix de vente récents, et les lots de toutes les ressources relevés depuis moins d\'une semaine. Lance un plan de scan.</p>';
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
      ${a.choix.map(o => `<tr><td class="cn">${esc(o.nom)}${avert(o.id)}${o.alertes.length ? ` <span class="tag faire" title="${esc(o.alertes.join(', '))}">à revérifier</span>` : ''}</td><td class="r">${o.n}</td><td class="r">${fmtK(o.capital)}</td><td class="r">${fmtK(o.marge)}</td><td class="r">${pct(o.rendement)}</td></tr>
        <tr><td colspan="5"><details class="more"><summary>liste de courses</summary><table class="rt courses"><tbody>
        ${o.craft.lignes.map(l => `<tr><td class="cn">${esc(l.nom)}</td><td class="r">${l.q}</td><td>${lots(l)}</td><td class="r">${fmtK(l.plan.cout)}</td><td>${l.plan.alerte ? '<span class="tag faire">à revérifier</span>' : ''}</td></tr>`).join('')}
        </tbody></table></details></td></tr>`).join('')}
      </tbody></table>
      <p class="muted small">Effort compté ${fmtK(p.coutEffortParCraft)} par craft. Les ressources marquées « à revérifier » risquent de remonter : regarde l'HDV ressources avant d'acheter.</p>`
      : '<p class="muted small">Aucune combinaison rentable dans ce budget.</p>';
  }

  $('#evalues').innerHTML = ev.eligibles.length + ev.ecartes.length ? `
    <table class="rt"><thead><tr><th>Item</th><th class="r">Vol.</th><th class="r">Vente</th><th class="r">Craft</th><th class="r">Rend.</th></tr></thead><tbody>
    ${ev.eligibles.map(e => { const it = ev.items.find(i => i.id === e.id); return `<tr><td class="cn">${esc(e.nom)}${avert(e.id)}</td><td class="r">${it.volumeMois}</td><td class="r">${fmtK(it.prixVente)}</td><td class="r">${fmtK(e.coutCraft)}</td><td class="r ok">${pct(e.rendement)}</td></tr>`; }).join('')}
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
    <span>Niveau Forgeron</span><input class="num" data-reg="forgeron" value="${r.forgeron}">
    <span>Plan de scan : part pour le craft (%), le reste en entretien</span><input class="num" data-reg="partCraft" value="${r.partCraft}">`;
  $$('#reglages [data-reg]').forEach(el => el.onchange = () => { S.etat.reglages[el.dataset.reg] = el.value; sauverEtat(); renderTout(); });
}

// Contexte passé aux vues (vue-plan.js, vue-donnees.js)
const ctx = {
  S, $: s => $(s), $$: s => $$(s), params, sauverBase, sauverEtat, renderTout: () => renderTout(), toast,
  esc, fmt, fmtK, pct, age, nombreSaisi, normaliser,
  boutonCopier: (n, t) => boutonCopier(n, t), brancherCopier: s => brancherCopier(s), choisirMode: m => choisirMode(m),
};

function renderTout() {
  renderVue();
  renderCapture();
  renderLecture();
  if (!S.catalogue) return;
  const p = params();
  if (S.etat.vue === 'scan') renderPlanScan(ctx);
  else if (S.etat.vue === 'donnees') renderDonnees(ctx);
  else if (S.etat.vue === 'resultats') { $('#budget').value = S.etat.budget; renderResultats(S.catalogue, p); }
  else renderBase(S.catalogue, p);
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
  S.diagSeul = false;
  S.saisie = null;
  try {
    const brut = await Cap.scanner(S.etat.zones, mode, m => m.status && statut(`Lecture : ${m.status}…`));
    if (!brut.utile) {
      S.derniere = null;
      statut(`Lecture impossible (${Cap.MODES[mode].libelle}). Saisis le nom et la valeur ci-dessous, ou vérifie la zone dans le diagnostic.`);
      S.diagSeul = true;
      ouvrirSaisie(preremplir(brut.type, brut.lecture));
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
      if (L.enregistre) noterScan(L);
      if (!L.enregistre && !o && L.type !== 'liste') ouvrirSaisie(preremplir(L.type, brut.lecture));
      statut(L.enregistre ? 'Enregistré. Corrige avec « Modifier » si besoin, sinon passe au suivant.' : 'Lecture non enregistrée.');
    }
  } catch (e) { statut('Erreur de lecture : ' + e.message); }
  b.classList.remove('busy'); b.disabled = !Cap.enCours();
  renderTout();
}

// ---------- zones ----------
// Une seule zone à encadrer : celle du mode choisi dans « Je scanne » (annonces et lots partagent le panneau détail).
const ZONES = {
  liste: ['Liste HDV', 'Encadre la liste des objets (colonnes Nom, Niveau, Prix moyen).'],
  detail: ['Panneau détail', 'Encadre le panneau de gauche qui s\'ouvre quand tu cliques un objet (nom, prix moyen, lots ou annonces). Prends toute sa hauteur, annonces comprises.'],
  courbe: ['Cours du marché', 'Encadre la fenêtre « Cours du marché » (titre, onglets, nombre d\'articles vendus).'],
};
function ouvrirZones() {
  let frame;
  try { frame = Cap.image().canvas; } catch (e) { statut(e.message); return; }
  const cle = Cap.MODES[S.etat.mode].zone;
  const [titre, aide] = ZONES[cle];
  let zone = S.etat.zones[cle], drag = null;
  const modal = $('#zones-modal'), cv = $('#zones-canvas'), ctx = cv.getContext('2d');
  cv.width = frame.width; cv.height = frame.height;
  const dessiner = () => {
    ctx.drawImage(frame, 0, 0);
    ctx.lineWidth = Math.max(3, frame.width / 500);
    ctx.strokeStyle = '#f0b84a';
    if (drag) ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0);
    else ctx.strokeRect(zone.x * cv.width, zone.y * cv.height, zone.w * cv.width, zone.h * cv.height);
    $('#zones-title').textContent = `Zone : ${titre}`;
    $('#zones-help').textContent = `${aide} Glisse pour dessiner. La zone actuelle est en jaune.`;
  };
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  cv.onmousedown = e => { const p = pos(e); drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; };
  cv.onmousemove = e => { if (!drag) return; const p = pos(e); drag.x1 = p.x; drag.y1 = p.y; dessiner(); };
  cv.onmouseup = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    drag = null;
    if (w > 20 && h > 20) {
      S.etat.zones = { ...S.etat.zones, [cle]: { x: x / cv.width, y: y / cv.height, w: w / cv.width, h: h / cv.height } };
      sauverEtat(); fermer(); statut(`Zone « ${titre} » enregistrée.`); return;
    }
    dessiner();
  };
  const fermer = () => modal.classList.add('hidden');
  $('#zones-cancel').onclick = fermer;
  $('#zones-default').onclick = () => { S.etat.zones = { ...S.etat.zones, [cle]: ZONES_DEFAUT[cle] }; sauverEtat(); fermer(); statut(`Zone « ${titre} » remise par défaut.`); };
  modal.classList.remove('hidden');
  dessiner();
}

// ---------- événements ----------
function brancher() {
  $$('#view-switch button').forEach(b => b.onclick = () => { S.etat.vue = b.dataset.view; sauverEtat(); renderTout(); });
  $('#cap-start').onclick = basculerCapture;
  $('#scan').onclick = scanner;
  $('#mode').innerHTML = Object.entries(Cap.MODES).map(([k, m]) => `<option value="${k}">${m.libelle}</option>`).join('');
  $('#mode').value = S.etat.mode;
  $('#mode').onchange = e => { S.etat.mode = e.target.value; sauverEtat(); renderSaisie(); };
  $('#saisir').onclick = () => { ouvrirSaisie(); renderSaisie(); };
  $('#zones-btn').onclick = ouvrirZones;
  $('#budget').onchange = e => { S.etat.budget = Math.max(0, Number(String(e.target.value).replace(',', '.')) || 0); sauverEtat(); renderTout(); };
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
window.__craft = { S, renderTout }; // accès pour les tests automatisés
brancher();
renderTout();
fetch('data/catalogue.json').then(r => r.json()).then(c => { S.catalogue = c; renderTout(); })
  .catch(() => statut('Catalogue introuvable (data/catalogue.json).'));
