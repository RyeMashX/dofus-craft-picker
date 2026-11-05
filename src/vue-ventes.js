// Onglet Ventes : ce que tu as en vente à l'HDV. Tant qu'un item a au moins 1 lot en vente,
// il n'est pas proposé dans le plan de craft.
//
// Relevé par OCR : mode « Mes ventes », on fait défiler la liste et on scanne chaque écran ;
// les captures s'additionnent (sans doublon) jusqu'au total affiché en bas (« 55/570 lots en vente »).
// Saisie manuelle : ajout par nom, nombre de lots modifiable, retrait.

import { majVente, remplacerVentes, nouveauReleve, ajouterAuReleve, comptesReleve, lotsLus } from './statut.js';
import { compareDofus } from './fraicheur.js';
import { icone } from './vue-plan.js';

// Ajoute une capture au relevé en cours. Termine automatiquement quand tous les lots sont lus.
export function ajouterCaptureVentes(ctx, identifie) {
  const { S } = ctx;
  const r = (S.etat.releveVentes ??= { ...nouveauReleve(), debut: Date.now() });
  const avant = lotsLus(r);
  ajouterAuReleve(r, identifie);
  const nouveaux = lotsLus(r) - avant;
  let termine = false;
  if (r.total != null && lotsLus(r) >= r.total) { terminerReleve(ctx); termine = true; }
  ctx.sauverEtat();
  return { nouveaux, termine, capture: identifie };
}

export function terminerReleve(ctx) {
  const { S } = ctx, r = S.etat.releveVentes;
  if (!r) return;
  remplacerVentes(S.base, comptesReleve(r), r.total);
  S.etat.releveVentes = null;
  ctx.sauverBase(); ctx.sauverEtat();
  ctx.toast('Relevé des ventes terminé ✓');
}

// Encart affiché sous le bouton Scanner après une capture de « Mes ventes »
export function carteReleve(ctx, L) {
  const { S, esc } = ctx, r = S.etat.releveVentes;
  const c = L.capture;
  const connues = c.lignes.filter(l => l.id != null);
  const progres = r ? `<div class="bar"><i style="width:${r.total ? Math.min(100, 100 * lotsLus(r) / r.total) : 0}%"></i></div>
      <p class="small">${lotsLus(r)}${r.total ? ` / ${r.total}` : ''} lots lus. Fais défiler la liste et scanne l'écran suivant.</p>` : '';
  return `<div class="lect"><div class="row"><h3>Mes ventes · ${L.termine ? 'relevé terminé' : 'relevé en cours'}</h3><div class="spacer"></div>
      <span class="tag ${L.termine ? 'ok-tag' : 'faire'}">${L.nouveaux} nouvelles</span></div>
    ${L.termine ? `<p class="small ok">Liste des ventes mise à jour : ${Object.keys(S.base.enVente?.items ?? {}).length} équipements en vente.</p>` : progres}
    <div class="chips">${connues.map(l => `<span class="chip">${esc(l.nom)}</span>`).join('')}${c.lignes.length > connues.length ? `<span class="chip muted">${c.lignes.length - connues.length} hors catalogue</span>` : ''}</div>
    ${r ? '<div class="row"><button id="rv-fin" class="primary small">Terminer le relevé</button><button id="rv-stop" class="link small">abandonner</button></div>' : ''}
  </div>`;
}
export function brancherReleve(ctx) {
  const { $ } = ctx;
  const fin = $('#rv-fin'); if (fin) fin.onclick = () => { terminerReleve(ctx); ctx.S.derniere = null; ctx.renderTout(); };
  const stop = $('#rv-stop'); if (stop) stop.onclick = () => { ctx.S.etat.releveVentes = null; ctx.S.derniere = null; ctx.sauverEtat(); ctx.renderTout(); };
}

export function renderVentes(ctx) {
  const { S, $, $$, esc, age } = ctx;
  if (!S.catalogue) return;
  const v = S.base.enVente ?? { items: {} };
  const items = new Map(S.catalogue.items.map(i => [i.id, i]));
  const lignes = Object.entries(v.items).map(([id, n]) => ({ id: Number(id), n, it: items.get(Number(id)) }))
    .filter(l => l.it).sort((a, b) => compareDofus(a.it.nom, b.it.nom));
  const lots = lignes.reduce((s, l) => s + l.n, 0);
  const r = S.etat.releveVentes;

  $('#ventes').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="v">${lignes.length}</div><div class="l">équipements en vente</div></div>
      <div class="kpi"><div class="v">${lots}</div><div class="l">lots (catalogue)${v.total ? `, ${v.total} au total` : ''}</div></div>
      <div class="kpi"><div class="v">${v.date ? age(v.date) : '–'}</div><div class="l">dernière mise à jour</div></div>
    </div>
    ${r ? `<p class="small warn">Relevé en cours : ${lotsLus(r)}${r.total ? ` / ${r.total}` : ''} lots lus. <button id="rv-fin2" class="link small">terminer</button></p>`
      : `<p class="muted small">Pour tout relever : onglet Scan, « Je scanne » sur <b>Mes ventes</b>, puis scanne chaque écran de ta liste en la faisant défiler. Les items en vente ne sont pas proposés dans le plan de craft.</p>`}
    <div class="ac"><input id="vt-nom" placeholder="Ajouter un équipement en vente…" autocomplete="off" spellcheck="false"><div id="vt-ac" class="ac-liste hidden"></div></div>
    ${lignes.length ? `<div class="cp">${lignes.map(l => `<div class="vt-l">
        ${icone(l.it.iconId)} <span class="n" title="${esc(l.it.nom)}">${esc(l.it.nom)}</span>
        <span class="stepper"><button data-vm="${l.id}" title="Un lot de moins (vendu)">−</button><b>${l.n}</b><button data-vp="${l.id}" title="Un lot de plus">+</button></span>
        <button class="retirer" data-vx="${l.id}" title="Plus rien en vente">✕</button></div>`).join('')}</div>`
      : '<p class="muted small">Rien en vente pour l\'instant.</p>'}`;

  const maj = (id, n) => { majVente(S.base, id, n); ctx.sauverBase(); ctx.renderTout(); };
  $$('#ventes [data-vm]').forEach(b => b.onclick = () => maj(+b.dataset.vm, (v.items[b.dataset.vm] ?? 1) - 1));
  $$('#ventes [data-vp]').forEach(b => b.onclick = () => maj(+b.dataset.vp, (v.items[b.dataset.vp] ?? 0) + 1));
  $$('#ventes [data-vx]').forEach(b => b.onclick = () => maj(+b.dataset.vx, 0));
  const fin = $('#rv-fin2'); if (fin) fin.onclick = () => { terminerReleve(ctx); ctx.renderTout(); };
  ctx.autocompletion($('#vt-nom'), $('#vt-ac'), 'annonces', nom => {
    const it = S.catalogue.items.find(i => i.nom === nom);
    if (it) maj(it.id, (v.items[it.id] ?? 0) + 1);
  });
}
