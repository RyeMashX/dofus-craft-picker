// Onglet Craft : plan de craft (généré à la demande, puis figé sauf modification manuelle) en haut,
// crafts viables en dessous (toujours visibles). La marge affichée est la marge réelle :
// ni la confiance ni l'effort ne la modifient.

import { viables, recommanderDansBudget, evaluerPlan, niveauConfiance, detailCraft, tachesConfirmation } from './craft-plan.js';
import { pastille } from './vue-donnees.js';
import { ajouterVente } from './ventes.js';
import { estExclu } from './statut.js';
import { icone } from './vue-plan.js';
import { tacheFaite } from './plan.js';

const pastilleBleue = '<i class="pt pt-bleu"></i>';

const pctConf = c => c == null ? '–' : `${Math.round(c * 100)} %`;
// Confiance : fraîcheur des données (volume 15 %, prix de vente 35 %, ressources 50 % pondérées par leur coût).
// Le détail de ce qui n'est pas vert s'affiche au survol. N'affecte pas la marge.
export const confHtml = c => c == null ? '' : `<span class="conf conf-${niveauConfiance(c)}" title="Confiance dans les données : ${niveauConfiance(c)}. Détail au clic sur le nom.">${pctConf(c)}</span>`;
// Risque de prix : les lignes de lots peuvent se vider pendant l'achat (voir lots.js). Pastille seulement si moyen ou fort.
export const risqueHtml = (ctx, risque, risquees = [], margePess = null) => {
  if (!risque || risque === 'faible') return '';
  const det = risquees.map(r => `${r.nom} (${r.risque}${r.penurie ? ', pénurie possible' : ''})`).join(', ');
  const title = `Risque ${risque} : le prix peut monter pendant l'achat.${det ? ` Lignes concernées : ${det}.` : ''}${margePess != null ? ` Marge si elles se vident : ${ctx.fmtK(margePess)}.` : ''}`;
  return `<span class="risque risque-${risque}${margePess != null && margePess < 0 ? ' deficit' : ''}" title="${ctx.esc(title)}">${risque === 'fort' ? 'risque fort' : 'risque'}</span>`;
};
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
    S.etat.craftRef = {}; // marges de référence : reprises au prochain affichage
    fixer(recommanderDansBudget(liste, offres, budget, p, S.catalogue, S.base));
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
  // Marge de référence de chaque ligne : celle du premier affichage après génération ou ajout. Un écart d'au moins
  // 1 point de rendement s'affiche (prix relevés entre-temps, confirmation…).
  const ref = (S.etat.craftRef ??= {});
  let refNeuve = false;
  for (const l of ev.lignes) if (!ref[l.id] && l.rendementN != null) { ref[l.id] = { rdt: l.rendementN, margeU: l.margeN / l.n }; refNeuve = true; }
  if (refNeuve) ctx.sauverEtat();
  const delta = l => {
    const r = ref[l.id];
    if (!r || l.rendementN == null) return '';
    const d = Math.round((l.rendementN - r.rdt) * 100);
    if (Math.abs(d) < 1) return '';
    return `<span class="delta ${d < 0 ? 'bad' : 'ok'}" title="Rendement à la génération : ${pct(r.rdt)} (${fmtK(r.margeU)} par craft), maintenant ${pct(l.rendementN)} (${fmtK(l.margeN / l.n)})">${d < 0 ? '▼' : '▲'} ${Math.abs(d)} pts</span>`;
  };
  // Confirmation : tout ce que le plan utilise doit avoir été relevé il y a moins d'une heure (bleu)
  const aConfirmer = genere ? tachesConfirmation(plan, S.catalogue, S.base) : [];
  const secConf = aConfirmer.reduce((s, t) => s + (p.tempsScan?.[t.kind] ?? 10), 0);
  const ouverts = (S.craftOuverts ??= new Set());
  const lignePlan = l => `<div class="cp-l${l.raison || l.enVente ? ' alerte' : ''}${ouverts.has(`p${l.id}`) ? ' ouvert' : ''}" data-volet="p${l.id}">
      <div class="cp-nom"><span class="chev" aria-hidden="true"></span>${icone(l.iconId)} <span class="n">${esc(l.nom)}</span> ${l.raison ? '' : tagNiveau(l.niveau)} ${confHtml(l.confiance)} ${risqueHtml(ctx, l.risqueN, l.risquees, l.margePessimisteN)}</div>
      <div class="cp-chiffres">
        <span class="stepper"><button data-moins="${l.id}" title="Un craft de moins">−</button><b>${l.n}</b><button data-plus="${l.id}" title="Un craft de plus">+</button></span>
        <span class="muted small">coût</span> ${fmtK(l.coutN)}
        <span class="muted small">marge</span> <b class="${l.margeN >= 0 ? 'ok' : 'bad'}">${fmtK(l.margeN)}</b> <span class="muted small">${pct(l.rendementN)}</span> ${delta(l)}
        <span class="cp-act"><button class="secondary small" data-vendre="${l.id}" title="Mettre 1 exemplaire en vente (ligne « draft » dans Ventes, retiré du plan)">🏷 vente</button>
        <button class="retirer" data-retirer="${l.id}" title="Retirer du plan">✕</button></span>
      </div>
      ${l.raison ? `<div class="small warn">Plus viable : ${esc(l.raison)}. Vérifie ses données avant de l'acheter.</div>` : ''}
      ${l.depasse ? `<div class="small warn">${l.n} crafts, plus qu'un jour de vente (${l.maxCrafts} max pour ${l.volume} ventes / mois).</div>` : ''}
      ${l.enVente ? `<div class="small warn">${l.enVente} exemplaire${l.enVente > 1 ? 's' : ''} déjà en vente.</div>` : ''}
      ${ouverts.has(`p${l.id}`) ? voletCraft(ctx, l, l.n, p) : ''}
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
      ${aConfirmer.length
        ? `<div class="confirm-bloc"><div><b>Prix à confirmer avant d'acheter</b><span class="muted small">${aConfirmer.length} relevé${aConfirmer.length > 1 ? 's' : ''} de plus d'une heure, ≈ ${Math.max(1, Math.ceil(secConf / 60))} min</span></div>
          <button id="cp-confirmer" class="primary small" title="Plan de scan avec les prix des items du plan et les lots de leurs ressources qui ne sont pas bleus">Confirmer les prix</button></div>`
        : `<p class="small conf-ok">${pastilleBleue} Tous les prix du plan ont moins d'une heure.</p>`}
      <div class="row">
        <button id="cp-achats" class="${aConfirmer.length ? 'secondary' : 'primary'} small">${achatsAJour ? 'Voir la liste d\'achat →' : 'Générer la liste d\'achat →'}</button>
        <button id="cp-tout-vendre" class="secondary small" title="Chaque exemplaire du plan devient une ligne « draft » dans Ventes">🏷 Tout mettre en vente</button></div>
      ${S.etat.listeAchat && !achatsAJour ? '<p class="small warn">Le plan a changé depuis la dernière liste d\'achat.</p>' : ''}
      <p class="muted small">Marge nette de la taxe et de la FM estimée ; achats regroupés entre crafts.</p>`
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
    return `<div class="cv-l${dans ? ' dans' : ''}${ouverts.has(`v${v.id}`) ? ' ouvert' : ''}" data-volet="v${v.id}">
      <div class="cp-nom"><span class="chev" aria-hidden="true"></span>${icone(v.iconId)} <span class="n">${esc(v.nom)}</span> ${tagNiveau(v.niveau)} ${confHtml(v.confiance)} ${risqueHtml(ctx, v.risque, v.risquees, v.margePessimiste)}
        ${v.enVente ? `<span class="tag tard" title="Déjà en vente : pas recommandé">en vente ${v.enVente}</span>` : ''}</div>
      <div class="cp-chiffres">
        <span class="muted small">vente</span> ${fmtK(v.prixVente)} <span class="muted small">craft</span> ${fmtK(v.cout)}
        <span class="muted small">marge</span> <b>${fmtK(v.marge)}</b> <span class="${v.niveau === 'cible' ? 'ok' : 'warn'}">${pct(v.rendement)}</span>
        <span class="muted small" title="Ventes sur 30 jours">${v.volume}/m</span>
        <button class="secondary small" data-ajout="${v.id}">${dans ? `+1 (${dans})` : '+ ajouter'}</button>
      </div>${ouverts.has(`v${v.id}`) ? voletCraft(ctx, v, 1, p) : ''}</div>`;
  };
  const n = C.n ?? 50;
  const viablesHtml = `
    <div class="row"><h2>Crafts viables</h2><span class="muted small">${liste.length}</span><div class="spacer"></div>
      <div class="cv-outils"><button id="cv-sans-vente" class="toggle${C.sansVente ? ' on' : ''}" title="${C.sansVente ? 'Afficher' : 'Masquer'} les items qui ont déjà des exemplaires en vente${nExclus ? ` · ${nExclus} item${nExclus > 1 ? 's' : ''} de la liste noire, jamais affichés` : ''}">${C.sansVente ? '✓ ' : ''}hors vente${nEnVente ? ` <span class="nb">${nEnVente}</span>` : ''}</button>
      <div id="cv-filtre" class="seg">${[['tous', 'tous'], ['cible', '≥ ' + Math.round(p.margeMin * 100) + ' %'], ['acceptable', Math.round(p.margeAcceptable * 100) + '–' + Math.round(p.margeMin * 100) + ' %']].map(([k, l]) => `<button data-f="${k}" class="${C.filtre === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
    ${rows.length ? `<div class="cp">${rows.slice(0, n).map(ligneViable).join('')}</div>${rows.length > n ? `<p class="small"><button id="cv-plus" class="link small">afficher 50 de plus (${rows.length - n} restants)</button></p>` : ''}` : '<p class="muted small">Aucun craft dans cette catégorie.</p>'}
    <p class="muted small">Viable : données à jour, ${p.volumeMin} ventes / mois et ${Math.round(p.margeAcceptable * 100)} % de rendement minimum.</p>`;

  $('#craft-plan').innerHTML = planHtml;
  $('#craft-viables').innerHTML = viablesHtml;

  $('#budget').onchange = e => { S.etat.budget = Math.max(0, Number(String(e.target.value).replace(',', '.')) || 0); ctx.sauverEtat(); ctx.renderTout(); };
  $('#cp-generer').onclick = generer;
  const ach = $('#cp-achats');
  if (ach) ach.onclick = async () => {
    if (!achatsAJour && aConfirmer.length && !(await ctx.confirmer(`${aConfirmer.length} prix du plan ont plus d'une heure : la liste risque d'être fausse. Générer quand même ?`, { ok: 'Générer quand même', annuler: 'Annuler' }))) return;
    if (!achatsAJour) ctx.genererListeAchat();
    S.etat.vue = 'achats'; ctx.sauverEtat(); ctx.renderTout();
  };
  const conf = $('#cp-confirmer');
  if (conf) conf.onclick = async () => {
    const encours = S.etat.plan && S.etat.plan.taches.some(t => !tacheFaite(t.kind, t.id, S.base, S.etat.plan.cree));
    if (encours && !(await ctx.confirmer('Un plan de scan est en cours. Le remplacer par la confirmation des prix du plan de craft ?', { ok: 'Remplacer' }))) return;
    S.etat.plan = { cree: Date.now(), confirmation: true, taches: aConfirmer, pretsAvant: null, pretsApres: null };
    S.faits = null; S.groupeOuvert = null; S.etat.vue = 'scan';
    ctx.sauverEtat(); ctx.renderTout();
  };
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
  // clic sur le nom : déplie / replie le détail
  $$('#craft-plan [data-volet] .cp-nom, #craft-viables [data-volet] .cp-nom').forEach(nom => nom.onclick = () => {
    const k = nom.closest('[data-volet]').dataset.volet;
    if (ouverts.has(k)) ouverts.delete(k); else ouverts.add(k);
    ctx.renderTout();
  });
}

// Trois coûts du craft (par craft) : on retient le réaliste, entre standard et pessimiste
function couts(ctx, f, n, venteU, taxeU, fmU) {
  const { fmtK } = ctx, c = n > 1 ? f.coutsN : f.couts;
  if (!c || c.coutPessimiste - c.coutOptimiste < 1) return '';
  const mp = venteU == null ? null : venteU - taxeU - fmU - c.coutPessimiste / n;
  return `<div class="vo-couts">
    <span title="Tout au prix affiché, sans limite de lots">optimiste <b>${fmtK(c.coutOptimiste / n)}</b></span>
    <span title="Prix affichés, au plus ${ctx.params().lotsCredibles} lots d'une même taille">standard <b>${fmtK(c.coutStandard / n)}</b></span>
    <span title="Chaque lot acheté fait monter le suivant">pessimiste <b>${fmtK(c.coutPessimiste / n)}</b></span>
    <span title="Coût retenu : standard + ⅓ de l'écart vers le pessimiste">retenu <b>${fmtK(c.cout / n)}</b></span>
    ${mp != null ? `<span title="Marge si les lignes se vident">marge pessimiste <b class="${mp >= 0 ? 'ok' : 'bad'}">${fmtK(mp)}</b></span>` : ''}
  </div>`;
}

// ---------- détail d'un craft (volet dépliable) ----------
// Prix unitaires (par craft) en tête, confiance et données à vérifier, puis la recette chiffrée.
function voletCraft(ctx, f, n, p) {
  const { S, esc, fmt, fmtK, pct } = ctx;
  const it = S.catalogue.items.find(i => i.id === f.id);
  if (!it) return '';
  const d = detailCraft(it, S.catalogue, S.base, p, n);
  const fs = f.fmSource, fmU = fs ? f.fm ?? 0 : 0;
  const craftU = d.total == null ? null : d.total / n;
  const venteU = f.prixVente, taxeU = venteU == null ? null : venteU * p.taxeVente;
  const margeU = craftU == null || venteU == null ? null : venteU - taxeU - craftU - fmU;
  const rdt = margeU == null || !craftU ? null : margeU / (craftU + fmU);
  const det = f.aVerifier ?? [];
  // ressource craftée (alliage…) : ses composants en dessous, en retrait
  const ligneRecette = (l, prof = 0) => `<tr class="${prof ? 'vo-sous' : ''}"><td class="tn">${prof ? `<i class="retrait" style="width:${prof * 14}px"></i>` : ''}${icone(l.iconId)}<span>${esc(l.nom)}</span>${pastille(l.niveau)}${l.risque && l.risque !== 'faible' ? `<span class="risque risque-${l.risque} mini" title="${esc(`Risque ${l.risque}${l.penurie ? ', pénurie possible' : ''} pour ${fmt(l.q)} : optimiste ${fmtK(l.coutOptimiste / n)}, standard ${fmtK(l.coutStandard / n)}, pessimiste ${fmtK(l.coutPessimiste / n)} par craft`)}">!</span>` : ''}${l.source === 'craft' ? `<span class="tag-craft" title="Moins cher à crafter${l.achat ? ` qu'à acheter (${fmtK(l.achat / n)} pour 1 craft)` : ' : introuvable à l\'HDV'}">à crafter</span>` : ''}</td><td class="r">${fmt(l.q / n)}</td><td class="r">${prix(l)}</td><td class="r">${l.cout == null ? '–' : fmtK(l.cout / n)}</td></tr>${(l.composants ?? []).map(c => ligneRecette(c, prof + 1)).join('')}`;
  const prix = l => l.prixUnitaire == null ? '<span class="bad">?</span>' : `${fmtK(l.prixUnitaire)}${l.source === 'moyen' ? '<sup title="prix moyen HDV, lots non relevés">m</sup>' : ''}`;
  return `<div class="volet">
    <div class="vo-u">
      <div><span>Craft</span><b>${fmtK(craftU)}</b></div>
      <div><span>FM</span><b>${fs ? fmtK(fmU) : '<i class="muted">n/a</i>'}</b></div>
      <div><span>Vente</span><b>${fmtK(venteU)}</b></div>
      <div><span>Marge</span><b class="${margeU == null ? '' : margeU >= 0 ? 'ok' : 'bad'}">${fmtK(margeU)}</b><em>${pct(rdt)}</em></div>
    </div>
    <p class="vo-note muted">Par craft, taxe de ${pct(p.taxeVente)} déduite${fs ? `, FM : moyenne de ${fs.n} vente${fs.n > 1 ? 's' : ''}` : ''}.</p>
    ${couts(ctx, f, n, venteU, taxeU, fmU)}
    <p class="vo-conf">${confHtml(f.confiance)} ${det.length ? `<span class="muted">À vérifier :</span> ${det.map(esc).join(' · ')}` : '<span class="muted">Toutes les données sont à jour.</span>'}</p>
    <table class="vo-t"><thead><tr><th></th><th class="r">qté</th><th class="r">prix/u</th><th class="r">coût</th></tr></thead><tbody>
    ${d.lignes.map(l => ligneRecette(l)).join('')}
    </tbody><tfoot><tr><td colspan="3">Coût pour 1 craft</td><td class="r"><b>${fmtK(craftU)}</b></td></tr>
      ${n > 1 ? `<tr><td colspan="3">Coût pour ${n} crafts</td><td class="r"><b>${fmtK(d.total)}</b></td></tr>` : ''}</tfoot></table>
    ${n > 1 ? `<p class="vo-note muted">Prix unitaires payés en achetant pour ${n} crafts.</p>` : ''}
  </div>`;
}
