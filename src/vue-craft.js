// Onglet Craft : plan de craft (généré à la demande, puis figé sauf modification manuelle) en haut,
// crafts viables en dessous (toujours visibles). La marge affichée est la marge réelle :
// ni la confiance ni l'effort ne la modifient.

import { viables, recommander, evaluerPlan, niveauConfiance, detailCraft } from './craft-plan.js';
import { pastille } from './vue-donnees.js';
import { ajouterVente } from './ventes.js';
import { estExclu } from './statut.js';
import { icone } from './vue-plan.js';

const pctConf = c => c == null ? '–' : `${Math.round(c * 100)} %`;
export const confHtml = c => c == null ? '' : `<span class="conf conf-${niveauConfiance(c)}" title="Confiance dans les données : ${niveauConfiance(c)} (${pctConf(c)}). N'affecte pas la marge.">${pctConf(c)}</span>`;
const tagNiveau = n => n === 'cible' ? '<span class="tag ok-tag">cible</span>' : '<span class="tag faire">acceptable</span>';
export const signaturePlan = plan => JSON.stringify(Object.entries(plan ?? {}).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]));
const dateCourte = t => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Calcul partagé avec l'onglet Achats : crafts viables, plan figé, évaluation
export function etatCraft(ctx) {
  const { S } = ctx, p = ctx.params();
  const cle = `${ctx.versionBase()}|${JSON.stringify(S.etat.reglages)}`;
  if (S.cacheCraft?.cle !== cle) S.cacheCraft = { cle, ...viables(S.catalogue, S.base, p) };
  const { liste, offres } = S.cacheCraft;
  const plan = S.etat.craftPlan ?? {};
  return { liste, offres, plan, genere: S.etat.craftPlan != null, ev: evaluerPlan(plan, liste, offres, S.catalogue, p, S.base), p };
}

export function renderCraft(ctx) {
  const { S, $, $$, esc, fmtK, pct } = ctx;
  if (!S.catalogue) return;
  const { liste, offres, plan, genere, ev, p } = etatCraft(ctx);
  const budget = S.etat.budget * 1e6;
  const C = (S.etat.craftVue ??= { filtre: 'tous' });

  const fixer = nouveau => { S.etat.craftPlan = nouveau; ctx.sauverEtat(); ctx.renderTout(); };
  const modifier = (id, delta) => {
    const nouveau = { ...plan };
    nouveau[id] = Math.max(0, (nouveau[id] ?? 0) + delta);
    if (!nouveau[id]) delete nouveau[id];
    if (!genere) S.etat.craftGenere = { date: Date.now(), budget: S.etat.budget, manuel: true };
    fixer(nouveau);
  };
  const generer = async () => {
    if (genere && Object.keys(plan).length && !(await ctx.confirmer('Remplacer le plan de craft actuel par une nouvelle recommandation ?', { ok: 'Régénérer' }))) return;
    S.etat.craftGenere = { date: Date.now(), budget: S.etat.budget };
    fixer(recommander(liste, offres, budget, p));
    ctx.toast('Plan de craft généré ✓');
  };
  // Mise en vente : chaque unité devient une ligne « draft » dans Ventes et sort du plan
  const mettreEnVente = (l, n) => {
    for (let k = 0; k < n; k++) ajouterVente(S.base, { id: l.id, statut: 'draft', prix: l.prixVente, coutCraft: Math.round(l.craftN / l.n), coutFm: l.fmSource ? Math.round(l.fmN / l.n) : null });
    ctx.sauverBase();
    modifier(l.id, -n);
  };

  // ---- plan ----
  const depasseBudget = ev.capital > budget;
  const lignePlan = l => `<div class="cp-l${l.raison || l.enVente ? ' alerte' : ''}" data-tip="${l.id}" data-n="${l.n}">
      <div class="cp-nom">${icone(l.iconId)} <span class="n">${esc(l.nom)}</span> ${l.raison ? '' : tagNiveau(l.niveau)} ${confHtml(l.confiance)}</div>
      <div class="cp-chiffres">
        <span class="stepper"><button data-moins="${l.id}" title="Un craft de moins">−</button><b>${l.n}</b><button data-plus="${l.id}" title="Un craft de plus">+</button></span>
        <span class="muted small">coût</span> ${fmtK(l.coutN)}
        <span class="muted small">marge</span> <b class="${l.margeN >= 0 ? 'ok' : 'bad'}">${fmtK(l.margeN)}</b> <span class="muted small">${pct(l.rendementN)}</span>
        <span class="cp-act"><button class="secondary small" data-vendre="${l.id}" title="Mettre 1 exemplaire en vente (ligne « draft » dans Ventes, retiré du plan)">🏷 vente</button>
        <button class="retirer" data-retirer="${l.id}" title="Retirer du plan">✕</button></span>
      </div>
      ${l.raison ? `<div class="small warn">Plus viable : ${esc(l.raison)}. Vérifie ses données avant de l'acheter.</div>` : ''}
      ${l.depasse ? `<div class="small warn">${l.n} crafts, plus qu'un jour de vente (${l.maxCrafts} max pour ${l.volume} ventes / mois).</div>` : ''}
      ${l.enVente ? `<div class="small warn">${l.enVente} exemplaire${l.enVente > 1 ? 's' : ''} déjà en vente.</div>` : ''}
    </div>`;

  const g = S.etat.craftGenere;
  const achatsAJour = S.etat.listeAchat && S.etat.listeAchat.signature === signaturePlan(plan);
  const planHtml = !genere ? `
    <div class="row"><h2>Plan de craft</h2></div>
    <div class="row"><label class="sel">Budget <input id="budget" type="text" inputmode="decimal" class="num" value="${S.etat.budget}"> M</label>
      <button id="cp-generer" class="primary">Générer le plan de craft</button></div>
    <p class="muted small">Le plan est calculé une fois, puis il ne bouge plus : seuls ses chiffres suivent les prix. Tu peux le modifier à la main, ou ajouter directement des crafts depuis la liste ci-dessous.</p>`
  : `
    <div class="row"><h2>Plan de craft</h2>
      <span class="muted small">${g ? `${g.manuel ? 'composé' : 'généré'} le ${dateCourte(g.date)}${g.manuel ? '' : ` pour ${g.budget} M`}` : ''}</span>
      <div class="spacer"></div><button id="cp-generer" class="regen" title="Recalculer une recommandation à partir du budget (remplace le plan actuel)"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 1.8v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Régénérer</span></button></div>
    <div class="row small"><label class="sel muted">Budget <input id="budget" type="text" inputmode="decimal" class="num" value="${S.etat.budget}"> M</label></div>
    <div class="kpis kpis4">
      <div class="kpi"><div class="v ok">${fmtK(ev.marge)}</div><div class="l">marge, ${pct(ev.rendement)}</div></div>
      <div class="kpi"><div class="v${depasseBudget ? ' bad' : ''}">${fmtK(ev.capital)}</div><div class="l">à investir sur ${fmtK(budget)}</div></div>
      <div class="kpi"><div class="v">${ev.crafts}</div><div class="l">crafts</div></div>
      <div class="kpi"><div class="v">${pctConf(ev.confiance)}</div><div class="l">confiance moyenne</div></div>
    </div>
    ${depasseBudget ? '<p class="small bad">Le plan dépasse le budget.</p>' : ''}
    ${ev.lignes.length ? `<div class="cp">${ev.lignes.map(lignePlan).join('')}</div>
      <div class="row">
        <button id="cp-achats" class="primary small">${achatsAJour ? 'Voir la liste d\'achat →' : 'Générer la liste d\'achat →'}</button>
        <button id="cp-tout-vendre" class="secondary small" title="Chaque exemplaire du plan devient une ligne « draft » dans Ventes">🏷 Tout mettre en vente</button></div>
      ${S.etat.listeAchat && !achatsAJour ? '<p class="small warn">Le plan a changé depuis la dernière liste d\'achat.</p>' : ''}
      <p class="muted small">Marge réelle : taxe de 2 % et FM estimée déduites (coût moyen de FM de tes ventes du même item, rien si n/a ; détail au survol d\'un nom). Coût total calculé avec les achats regroupés : une ressource partagée entre plusieurs crafts est achetée en une fois.</p>`
      : '<p class="muted small">Le plan est vide. Ajoute des crafts depuis la liste ci-dessous, ou régénère-le.</p>'}`;

  // ---- viables ----
  let rows = liste;
  if (C.filtre === 'cible') rows = rows.filter(v => v.niveau === 'cible');
  if (C.filtre === 'acceptable') rows = rows.filter(v => v.niveau === 'acceptable');
  const nEnVente = rows.filter(v => v.enVente).length;
  if (C.sansVente) rows = rows.filter(v => !v.enVente);
  const nExclus = Object.keys(S.base.exclus ?? {}).filter(id => estExclu(S.base, id)).length;
  const ligneViable = v => {
    const dans = plan[v.id] ?? 0;
    return `<div class="cv-l${dans ? ' dans' : ''}" data-tip="${v.id}" data-n="1">
      <div class="cp-nom">${icone(v.iconId)} <span class="n">${esc(v.nom)}</span> ${tagNiveau(v.niveau)} ${confHtml(v.confiance)}
        ${v.enVente ? `<span class="tag tard" title="Déjà en vente : pas recommandé">en vente ${v.enVente}</span>` : ''}${v.pret ? '' : ' <span class="tag tard" title="Données jaunes : vérifie avant d\'acheter">⚠</span>'}</div>
      <div class="cp-chiffres">
        <span class="muted small">vente</span> ${fmtK(v.prixVente)} <span class="muted small">craft</span> ${fmtK(v.cout)}
        <span class="muted small">marge</span> <b>${fmtK(v.marge)}</b> <span class="${v.niveau === 'cible' ? 'ok' : 'warn'}">${pct(v.rendement)}</span>
        <span class="muted small" title="Ventes sur 30 jours">${v.volume}/m</span>
        <button class="secondary small" data-ajout="${v.id}">${dans ? `+1 (${dans})` : '+ ajouter'}</button>
      </div></div>`;
  };
  const n = C.n ?? 50;
  const viablesHtml = `
    <div class="row"><h2>Crafts viables</h2><span class="muted small">${liste.length}</span><div class="spacer"></div>
      <div class="cv-outils"><button id="cv-sans-vente" class="toggle${C.sansVente ? ' on' : ''}" title="${C.sansVente ? 'Afficher' : 'Masquer'} les items qui ont déjà des exemplaires en vente${nExclus ? ` · ${nExclus} item${nExclus > 1 ? 's' : ''} de la liste noire, jamais affichés` : ''}">${C.sansVente ? '✓ ' : ''}hors vente${nEnVente ? ` <span class="nb">${nEnVente}</span>` : ''}</button>
      <div id="cv-filtre" class="seg">${[['tous', 'tous'], ['cible', '≥ ' + Math.round(p.margeMin * 100) + ' %'], ['acceptable', Math.round(p.margeAcceptable * 100) + '–' + Math.round(p.margeMin * 100) + ' %']].map(([k, l]) => `<button data-f="${k}" class="${C.filtre === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
    ${rows.length ? `<div class="cp">${rows.slice(0, n).map(ligneViable).join('')}</div>${rows.length > n ? `<p class="small"><button id="cv-plus" class="link small">afficher 50 de plus (${rows.length - n} restants)</button></p>` : ''}` : '<p class="muted small">Aucun craft dans cette catégorie.</p>'}
    <p class="muted small">Viable : données sans orange ni noir, au moins ${p.volumeMin} ventes par mois, rendement d'au moins ${Math.round(p.margeAcceptable * 100)} % FM estimée comprise, aucune ressource introuvable à l'HDV. La confiance reflète la fraîcheur des données (pondérée par le poids de chaque ressource dans le coût) et ne modifie pas la marge.</p>`;

  $('#craft-plan').innerHTML = planHtml;
  $('#craft-viables').innerHTML = viablesHtml;

  $('#budget').onchange = e => { S.etat.budget = Math.max(0, Number(String(e.target.value).replace(',', '.')) || 0); ctx.sauverEtat(); ctx.renderTout(); };
  $('#cp-generer').onclick = generer;
  const ach = $('#cp-achats'); if (ach) ach.onclick = () => { if (!achatsAJour) ctx.genererListeAchat(); S.etat.vue = 'achats'; ctx.sauverEtat(); ctx.renderTout(); };
  const tout = $('#cp-tout-vendre');
  if (tout) tout.onclick = async () => {
    if (!(await ctx.confirmer(`Mettre en vente les ${ev.crafts} exemplaires du plan ? Ils passeront dans Ventes (statut « draft ») et sortiront du plan.`, { ok: "Mettre en vente" }))) return;
    for (const l of ev.lignes) for (let k = 0; k < l.n; k++) ajouterVente(S.base, { id: l.id, statut: 'draft', prix: l.prixVente, coutCraft: Math.round(l.craftN / l.n), coutFm: l.fmSource ? Math.round(l.fmN / l.n) : null });
    ctx.sauverBase(); fixer({}); ctx.toast(`${ev.crafts} exemplaires mis en vente ✓`);
  };
  $$('#craft-plan [data-plus]').forEach(b => b.onclick = () => modifier(b.dataset.plus, +1));
  $$('#craft-plan [data-moins]').forEach(b => b.onclick = () => modifier(b.dataset.moins, -1));
  $$('#craft-plan [data-retirer]').forEach(b => b.onclick = () => modifier(b.dataset.retirer, -Infinity));
  $$('#craft-plan [data-vendre]').forEach(b => b.onclick = () => { const l = ev.lignes.find(x => x.id === +b.dataset.vendre); if (l) { mettreEnVente(l, 1); ctx.toast(`${l.nom} mis en vente (draft)`); } });
  $$('#craft-viables [data-ajout]').forEach(b => b.onclick = () => modifier(b.dataset.ajout, +1));
  $('#cv-sans-vente').onclick = () => { C.sansVente = !C.sansVente; C.n = 50; ctx.sauverEtat(); ctx.renderTout(); };
  $$('#cv-filtre button').forEach(b => b.onclick = () => { C.filtre = b.dataset.f; C.n = 50; ctx.sauverEtat(); ctx.renderTout(); });
  const plus = $('#cv-plus'); if (plus) plus.onclick = () => { C.n = n + 50; ctx.renderTout(); };
  const fiche = id => ev.lignes.find(l => l.id === id) ?? liste.find(v => v.id === id);
  brancherInfobulle(ctx, '#craft-plan, #craft-viables', (id, nb) => contenuInfobulle(ctx, fiche(id), nb, p));
}

// ---------- infobulle : la recette avec quantités et prix ----------
function contenuInfobulle(ctx, f, n, p) {
  const { S, esc, fmt, fmtK, pct } = ctx;
  const it = f && S.catalogue.items.find(i => i.id === f.id);
  if (!it) return '';
  const d = detailCraft(it, S.catalogue, S.base, p, n);
  const vente = f.prixVente == null ? null : f.prixVente * n;
  const taxe = vente == null ? null : vente * p.taxeVente;
  const revenu = vente == null ? null : vente - taxe;
  const fm = (f.fm ?? 0) * n, fs = f.fmSource;
  const marge = revenu == null || d.total == null ? null : revenu - d.total - fm;
  const fmLib = `<span title="${fs ? `Moyenne de ${fs.n} vente${fs.n > 1 ? 's' : ''} de cet item` : 'Aucune vente de cet item avec un coût de FM'}">Coût de FM estimé</span>`;
  const prix = l => l.prixUnitaire == null ? '<span class="bad">?</span>' : `${fmtK(l.prixUnitaire)}${l.source === 'moyen' ? '<sup title="prix moyen HDV">m</sup>' : ''}`;
  return `<div class="tip-t">${icone(it.iconId)} <b>${esc(it.nom)}</b>${n > 1 ? ` <span class="muted">× ${n} crafts</span>` : ''}</div>
    <table><thead><tr><th></th><th class="r">qté</th><th class="r">prix/u</th><th class="r">coût</th></tr></thead><tbody>
    ${d.lignes.sort((a, b) => (b.cout ?? Infinity) - (a.cout ?? Infinity)).map(l => `<tr><td class="tn">${icone(l.iconId)}<span>${esc(l.nom)}</span>${pastille(l.niveau)}</td><td class="r">${fmt(l.q)}</td><td class="r">${prix(l)}</td><td class="r">${l.cout == null ? '–' : fmtK(l.cout)}</td></tr>`).join('')}
    </tbody><tfoot>
      <tr><td colspan="3">Coût du craft</td><td class="r"><b>${fmtK(d.total)}</b></td></tr>
      <tr><td colspan="3">${fmLib}</td><td class="r">${fs ? fmtK(fm) : '<span class="muted">n/a</span>'}</td></tr>
      <tr><td colspan="3">Prix de vente${n > 1 ? ` (${n} × ${fmtK(f.prixVente)})` : ''}</td><td class="r">${fmtK(vente)}</td></tr>
      <tr><td colspan="3">Taxe ${pct(p.taxeVente)}</td><td class="r bad">${taxe == null ? '–' : `−${fmtK(taxe)}`}</td></tr>
      <tr><td colspan="3">Marge</td><td class="r"><b class="${marge == null ? '' : marge >= 0 ? 'ok' : 'bad'}">${fmtK(marge)}</b> <span class="muted">${pct(marge != null && d.total ? marge / (d.total + fm) : null)}</span></td></tr>
    </tfoot></table>
    <div class="muted tip-note">Chaque ressource chiffrée seule, lots les moins chers${d.lignes.some(l => l.source === 'moyen') ? ' ; <sup>m</sup> = prix moyen HDV, lots non relevés' : ''}.${n > 1 ? ' Le total du plan regroupe les ressources partagées.' : ''}</div>`;
}

function brancherInfobulle(ctx, sel, contenu) {
  const { $, $$ } = ctx;
  const doc = $('body').ownerDocument, win = doc.defaultView;
  let tip = doc.querySelector('#tip');
  if (!tip) { tip = doc.createElement('div'); tip.id = 'tip'; tip.className = 'tip hidden'; doc.body.appendChild(tip); }
  let minuterie = null;
  const cacher = () => { clearTimeout(minuterie); tip.classList.add('hidden'); };
  const montrer = el => {
    const html = contenu(+el.dataset.tip, +el.dataset.n || 1);
    if (!html) return;
    tip.innerHTML = html; tip.classList.remove('hidden');
    const r = el.querySelector('.cp-nom').getBoundingClientRect(), t = tip.getBoundingClientRect();
    const w = win.innerWidth, h = win.innerHeight;
    let x = Math.min(Math.max(8, r.left), w - t.width - 8), y = r.bottom + 6;
    if (y + t.height > h - 8) y = Math.max(8, r.top - t.height - 6); // pas la place dessous : au-dessus
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  };
  $$(sel).forEach(zone => zone.querySelectorAll('[data-tip] .cp-nom').forEach(nom => {
    const el = nom.closest('[data-tip]');
    nom.onmouseenter = () => { clearTimeout(minuterie); minuterie = setTimeout(() => montrer(el), 250); };
    nom.onmouseleave = cacher;
  }));
  if (!tip.dataset.branche) { tip.dataset.branche = '1'; win.addEventListener('scroll', () => tip.classList.add('hidden'), { passive: true }); }
  cacher();
}
