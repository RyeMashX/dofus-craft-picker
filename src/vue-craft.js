// Onglet Craft : plan de craft (recommandé, modifiable à la main) en haut, crafts viables en dessous.
// La marge affichée est toujours la marge réelle : ni la confiance ni l'effort ne la modifient.

import { viables, recommander, evaluerPlan, niveauConfiance } from './craft-plan.js';
import { icone } from './vue-plan.js';

const pctConf = c => c == null ? '–' : `${Math.round(c * 100)} %`;
export const confHtml = c => c == null ? '' : `<span class="conf conf-${niveauConfiance(c)}" title="Confiance dans les données : ${niveauConfiance(c)} (${pctConf(c)}). N'affecte pas la marge.">${pctConf(c)}</span>`;
const tagNiveau = n => n === 'cible' ? '<span class="tag ok-tag">cible</span>' : '<span class="tag faire">acceptable</span>';

// Calcul partagé avec l'onglet Achats : viables, plan effectif (manuel ou recommandé), évaluation
export function etatCraft(ctx) {
  const { S } = ctx, p = ctx.params();
  const cle = `${ctx.versionBase()}|${S.etat.budget}|${JSON.stringify(S.etat.reglages)}`;
  if (S.cacheCraft?.cle !== cle) {
    const { liste, offres } = viables(S.catalogue, S.base, p);
    S.cacheCraft = { cle, liste, offres, reco: recommander(liste, offres, S.etat.budget * 1e6, p) };
  }
  const { liste, offres, reco } = S.cacheCraft;
  const manuel = S.etat.craftPlan != null;
  const plan = manuel ? S.etat.craftPlan : reco;
  return { liste, offres, reco, plan, manuel, ev: evaluerPlan(plan, liste, offres, S.catalogue, p), p };
}

export function renderCraft(ctx) {
  const { S, $, $$, esc, fmtK, pct } = ctx;
  if (!S.catalogue) return;
  const { liste, plan, manuel, ev, p } = etatCraft(ctx);
  const budget = S.etat.budget * 1e6;
  const C = (S.etat.craftVue ??= { filtre: 'tous' });

  const modifier = (id, delta) => {
    const nouveau = { ...(S.etat.craftPlan ?? plan) };
    nouveau[id] = Math.max(0, (nouveau[id] ?? 0) + delta);
    if (!nouveau[id]) delete nouveau[id];
    S.etat.craftPlan = nouveau; ctx.sauverEtat(); ctx.renderTout();
  };

  // ---- plan ----
  const depasseBudget = ev.capital > budget;
  const lignePlan = l => `<div class="cp-l${l.enVente ? ' alerte' : ''}">
      <div class="cp-nom">${icone(l.iconId)} <span class="n" title="${esc(l.nom)}">${esc(l.nom)}</span> ${tagNiveau(l.niveau)} ${confHtml(l.confiance)}</div>
      <div class="cp-chiffres">
        <span class="stepper"><button data-moins="${l.id}" title="Un craft de moins">−</button><b>${l.n}</b><button data-plus="${l.id}" title="Un craft de plus">+</button></span>
        <span class="muted small">coût</span> ${fmtK(l.coutN)}
        <span class="muted small">marge</span> <b class="ok">${fmtK(l.margeN)}</b> <span class="muted small">${pct(l.rendementN)}</span>
        <button class="retirer" data-retirer="${l.id}" title="Retirer du plan">✕</button>
      </div>
      ${l.depasse ? `<div class="small warn">${l.n} crafts, plus qu'un jour de vente (${l.maxCrafts} max pour ${l.volume} ventes / mois).</div>` : ''}
      ${l.enVente ? `<div class="small warn">${l.enVente} lot${l.enVente > 1 ? 's' : ''} déjà en vente.</div>` : ''}
    </div>`;

  const planHtml = `
    <div class="row"><h2>Plan de craft</h2>
      ${manuel ? '<span class="tag faire">modifié</span> <button id="cp-reco" class="link small">revenir à la recommandation</button>' : '<span class="tag ok-tag">recommandé</span>'}
      <div class="spacer"></div><label class="small muted sel">Budget <input id="budget" type="text" inputmode="decimal" class="num" value="${S.etat.budget}"> M</label></div>
    <div class="kpis kpis4">
      <div class="kpi"><div class="v ok">${fmtK(ev.marge)}</div><div class="l">marge, ${pct(ev.rendement)}</div></div>
      <div class="kpi"><div class="v${depasseBudget ? ' bad' : ''}">${fmtK(ev.capital)}</div><div class="l">à investir sur ${fmtK(budget)}</div></div>
      <div class="kpi"><div class="v">${ev.crafts}</div><div class="l">crafts</div></div>
      <div class="kpi"><div class="v">${pctConf(ev.confiance)}</div><div class="l">confiance moyenne</div></div>
    </div>
    ${depasseBudget ? '<p class="small bad">Le plan dépasse le budget.</p>' : ''}
    ${ev.lignes.length ? `<div class="cp">${ev.lignes.map(lignePlan).join('')}</div>
      <div class="row"><button id="cp-achats" class="primary small">Liste d'achat (${ev.achats.length} ressources) →</button></div>
      <p class="muted small">Marge réelle, taxe de 2 % déduite. Coût total calculé avec les achats regroupés : une ressource partagée entre plusieurs crafts est achetée en une fois.</p>`
      : `<p class="muted small">${liste.length ? 'Aucun craft dans le plan. Ajoute des crafts depuis la liste ci-dessous.' : 'Aucun craft viable pour l\'instant : lance un plan de scan pour mettre à jour les données.'}</p>`}`;

  // ---- viables ----
  let rows = liste;
  if (C.filtre === 'cible') rows = rows.filter(v => v.niveau === 'cible');
  if (C.filtre === 'acceptable') rows = rows.filter(v => v.niveau === 'acceptable');
  const ligneViable = v => {
    const dans = plan[v.id] ?? 0;
    return `<div class="cv-l${dans ? ' dans' : ''}">
      <div class="cp-nom">${icone(v.iconId)} <span class="n" title="${esc(v.nom)}">${esc(v.nom)}</span> ${tagNiveau(v.niveau)} ${confHtml(v.confiance)}
        ${v.enVente ? `<span class="tag tard" title="Déjà en vente : pas recommandé">en vente ${v.enVente}</span>` : ''}${v.pret ? '' : ' <span class="tag tard" title="Données jaunes : vérifie avant d\'acheter">⚠</span>'}</div>
      <div class="cp-chiffres">
        <span class="muted small">vente</span> ${fmtK(v.prixVente)} <span class="muted small">craft</span> ${fmtK(v.cout)}
        <span class="muted small">marge</span> <b>${fmtK(v.marge)}</b> <span class="${v.niveau === 'cible' ? 'ok' : 'warn'}">${pct(v.rendement)}</span>
        <span class="muted small" title="Ventes sur 30 jours">${v.volume}/m</span>
        <button class="secondary small" data-ajout="${v.id}">${dans ? `+1 (${dans})` : '+ ajouter'}</button>
      </div></div>`;
  };
  const viablesHtml = `
    <div class="row"><h2>Crafts viables</h2><span class="muted small">${liste.length}</span><div class="spacer"></div>
      <div id="cv-filtre" class="seg">${[['tous', 'tous'], ['cible', '≥ ' + Math.round(p.margeMin * 100) + ' %'], ['acceptable', Math.round(p.margeAcceptable * 100) + '–' + Math.round(p.margeMin * 100) + ' %']].map(([k, l]) => `<button data-f="${k}" class="${C.filtre === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    ${rows.length ? `<div class="cp">${rows.slice(0, C.n ?? 50).map(ligneViable).join('')}</div>${rows.length > (C.n ?? 50) ? `<p class="small"><button id="cv-plus" class="link small">afficher 50 de plus (${rows.length - (C.n ?? 50)} restants)</button></p>` : ''}` : '<p class="muted small">Aucun craft dans cette catégorie.</p>'}
    <p class="muted small">Viable : données sans orange ni noir, au moins ${p.volumeMin} ventes par mois, rendement d'au moins ${Math.round(p.margeAcceptable * 100)} %. La confiance reflète la fraîcheur des données (pondérée par le poids de chaque ressource dans le coût) et ne modifie pas la marge.</p>`;

  $('#craft-plan').innerHTML = planHtml;
  $('#craft-viables').innerHTML = viablesHtml;

  $('#budget').onchange = e => { S.etat.budget = Math.max(0, Number(String(e.target.value).replace(',', '.')) || 0); ctx.sauverEtat(); ctx.renderTout(); };
  const reco = $('#cp-reco'); if (reco) reco.onclick = () => { S.etat.craftPlan = null; ctx.sauverEtat(); ctx.renderTout(); };
  const ach = $('#cp-achats'); if (ach) ach.onclick = () => { S.etat.vue = 'achats'; ctx.sauverEtat(); ctx.renderTout(); };
  $$('#craft-plan [data-plus]').forEach(b => b.onclick = () => modifier(b.dataset.plus, +1));
  $$('#craft-plan [data-moins]').forEach(b => b.onclick = () => modifier(b.dataset.moins, -1));
  $$('#craft-plan [data-retirer]').forEach(b => b.onclick = () => modifier(b.dataset.retirer, -Infinity));
  $$('#craft-viables [data-ajout]').forEach(b => b.onclick = () => modifier(b.dataset.ajout, +1));
  $$('#cv-filtre button').forEach(b => b.onclick = () => { C.filtre = b.dataset.f; C.n = 50; ctx.sauverEtat(); ctx.renderTout(); });
  const plus = $('#cv-plus'); if (plus) plus.onclick = () => { C.n = (C.n ?? 50) + 50; ctx.renderTout(); };
}
