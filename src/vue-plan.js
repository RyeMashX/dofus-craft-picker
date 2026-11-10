// Onglet Scan : préparation du plan (temps disponible → aperçu), puis déroulé par HDV et groupes de filtres.

import { calculerPlan, organiser, tacheFaite } from './plan.js';

const LIB = { volume: 'Courbe', prixItem: 'Annonces', ressource: 'Lots' };
const MODE = { volume: 'courbe', prixItem: 'annonces', ressource: 'lots' };
const HDV = { equipements: 'HDV Équipements', ressources: 'HDV Ressources', consommables: 'HDV Consommables' };
export const icone = id => id ? `<img class="ico" loading="lazy" alt="" src="https://api.dofusdb.fr/img/items/${id}.png">` : '<span class="ico"></span>';
const cleGroupe = (h, g) => `${h.hdv}|${g.categories.join('+')}|${g.niveauMin}`;

// Durée d'un scan : médiane des écarts entre scans consécutifs (< 3 min), sinon la valeur par défaut
export function tempsMesures(journal, defauts) {
  const ecarts = { volume: [], prixItem: [], ressource: [] };
  for (let i = 1; i < (journal ?? []).length; i++) {
    const d = (journal[i].t - journal[i - 1].t) / 1000;
    if (d > 2 && d < 180 && ecarts[journal[i].k]) ecarts[journal[i].k].push(d);
  }
  const med = l => { const s = [...l].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const r = {}, n = {};
  for (const k of Object.keys(ecarts)) { n[k] = ecarts[k].length; r[k] = n[k] >= 3 ? Math.round(med(ecarts[k])) : defauts[k]; }
  return { tempsScan: r, mesures: n };
}

export function renderPlanScan(ctx) {
  const { S } = ctx;
  if (!S.catalogue) return;
  if (!S.etat.plan) return renderPreparation(ctx);
  return renderDeroule(ctx);
}

// ---------- préparation ----------
function renderPreparation(ctx) {
  const { S, $, esc, params } = ctx;
  const p = params();
  const pl = calculerPlan(S.catalogue, S.base, p, S.etat.minutes);
  const nb = r => pl.taches.filter(t => t.raison === r).length;
  const parKind = k => pl.taches.filter(t => t.kind === k).length;
  const ts = p.tempsScan, m = p.tempsMesures ?? {};
  const src = k => m[k] >= 3 ? 'mesuré' : 'par défaut';
  $('#plan').innerHTML = `
    <div class="row"><label class="sel">J'ai <input id="minutes" type="number" min="1" step="1" class="num" value="${S.etat.minutes}"> minutes</label></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${pl.taches.length}</div><div class="l">scans, ≈ ${Math.ceil(pl.secondes / 60)} min</div></div>
      <div class="kpi"><div class="v ok">${pl.pretsApres}</div><div class="l">items prêts après (${pl.pretsAvant} maintenant)</div></div>
      <div class="kpi"><div class="v">${nb('craft')} / ${nb('entretien')} / ${nb('veille')}</div><div class="l" title="Veille : prix des équipements sous le seuil de volume, ressources des seuls items non vendables, items exclus">craft / entretien / veille</div></div>
    </div>
    <p class="small muted">${parKind('volume')} courbes, ${parKind('prixItem')} annonces, ${parKind('ressource')} lots de ressources.
      Durée retenue : ${ts.volume} s par courbe (${src('volume')}), ${ts.prixItem} s par annonce (${src('prixItem')}), ${ts.ressource} s par ressource (${src('ressource')}).</p>
    ${pl.taches.length ? '<div class="row"><button id="plan-go" class="primary">Lancer ce plan</button></div>' : '<p class="small ok">Tout est à jour : rien à scanner.</p>'}`;
  $('#minutes').onchange = e => { S.etat.minutes = Math.max(1, +e.target.value || 10); ctx.sauverEtat(); ctx.renderTout(); };
  const go = $('#plan-go');
  if (go) go.onclick = () => {
    S.etat.plan = { cree: Date.now(), minutes: S.etat.minutes, taches: pl.taches, pretsAvant: pl.pretsAvant, pretsApres: pl.pretsApres };
    S.faits = null; S.groupeOuvert = null;
    ctx.sauverEtat(); ctx.renderTout();
  };
}

// ---------- déroulé ----------
function renderDeroule(ctx) {
  const { S, $, $$, esc } = ctx;
  const plan = S.etat.plan;
  const hdvs = organiser(plan, S.catalogue);
  const fait = (k, id) => tacheFaite(k, id, S.base, plan.cree);

  // état d'avancement
  let total = 0, faits = 0, prochaine = null, groupeCourant = null;
  const etatGroupes = new Map(), etatHdv = new Map();
  for (const h of hdvs) {
    let hdvFait = true;
    for (const g of h.groupes) {
      let gFait = true;
      for (const l of g.lignes) {
        l.faits = l.kinds.map(k => fait(k, l.id));
        l.fait = l.faits.every(Boolean);
        total += l.kinds.length; faits += l.faits.filter(Boolean).length;
        if (!l.fait) { gFait = false; if (!prochaine) prochaine = { kind: l.kinds[l.faits.indexOf(false)], ligne: l }; }
      }
      etatGroupes.set(cleGroupe(h, g), gFait);
      if (!gFait && !groupeCourant) groupeCourant = cleGroupe(h, g);
      if (!gFait) hdvFait = false;
    }
    etatHdv.set(h.hdv, hdvFait);
  }

  // animations : groupe / HDV qui vient de se terminer
  if (S.faits) {
    for (const [k, v] of etatHdv) if (v && !S.faits.has('H' + k)) { ctx.toast('HDV terminé ✓'); S.flash = null; }
    for (const [k, v] of etatGroupes) if (v && !S.faits.has('G' + k)) {
      if (!etatHdv.get(k.split('|')[0])) ctx.toast('Catégorie terminée ✓');
      S.flash = groupeCourant; S.groupeOuvert = null; // on ouvre le groupe suivant
    }
  }
  S.faits = new Set([...[...etatGroupes].filter(([, v]) => v).map(([k]) => 'G' + k), ...[...etatHdv].filter(([, v]) => v).map(([k]) => 'H' + k)]);

  // le mode de scan suit la prochaine tâche
  if (prochaine) ctx.choisirMode(MODE[prochaine.kind]);

  const ouvert = S.groupeOuvert ?? groupeCourant;
  const restant = plan.taches.filter(t => !fait(t.kind, t.id));
  const p = ctx.params();
  const secRest = restant.reduce((s, t) => s + p.tempsScan[t.kind], 0);
  const pct = total ? Math.round(100 * faits / total) : 100;

  const ligneHtml = l => `<tr class="${l.fait ? 'fini' : ''}">
      <td>${ctx.boutonCopier(l.nom, l.kinds[0])}</td><td>${icone(l.iconId)}</td>
      <td class="nom" title="${esc(l.nom)}">${esc(l.nom)}</td>
      <td class="r">${l.kinds.map((k, i) => `<span class="bd${l.faits[i] ? ' fait' : ''}">${l.faits[i] ? '✓ ' : ''}${LIB[k]}</span>`).join(' ')}</td></tr>`;

  const groupeHtml = (h, g) => {
    const k = cleGroupe(h, g), gFait = etatGroupes.get(k), estOuvert = k === ouvert;
    const n = g.lignes.filter(l => l.fait).length;
    const niv = g.niveauMin === g.niveauMax ? `Niveau ${g.niveauMin}` : `Niveau ${g.niveauMin} à ${g.niveauMax}`;
    return `<div class="grp${gFait ? ' fini' : ''}${estOuvert ? ' ouvert' : ''}${S.flash === k ? ' flash' : ''}" data-g="${esc(k)}">
      <div class="grp-tete" data-g="${esc(k)}">
        <span class="grp-etat">${gFait ? '✓' : estOuvert ? '▾' : '▸'}</span>
        <span class="grp-filtres"><b>${esc(g.categories.join(', '))}</b> <span class="muted">· ${niv}</span></span>
        <span class="muted small">${n}/${g.lignes.length}</span>
      </div>
      ${estOuvert ? `<table class="rt plan-rt"><colgroup><col class="c-copie"><col class="c-ico"><col><col class="c-bd"></colgroup><tbody>${g.lignes.map(ligneHtml).join('')}</tbody></table>` : ''}
    </div>`;
  };

  // ce qui est fait descend : item en bas de sa catégorie, catégorie en bas de son HDV, HDV en bas du plan.
  // La prochaine ligne à scanner est donc toujours la première.
  const finEnBas = (liste, estFait) => [...liste.filter(x => !estFait(x)), ...liste.filter(estFait)];
  for (const h of hdvs) {
    for (const g of h.groupes) g.lignes = finEnBas(g.lignes, l => l.fait);
    h.groupes = finEnBas(h.groupes, g => etatGroupes.get(cleGroupe(h, g)));
  }
  const hdvsTries = finEnBas(hdvs, h => etatHdv.get(h.hdv));

  const termine = !restant.length;
  $('#plan').innerHTML = `
    <div class="row small"><b>${faits} / ${total} scans</b><span class="muted">· ≈ ${Math.ceil(secRest / 60)} min restantes · prêts visés ${plan.pretsApres}</span>
      <div class="spacer"></div><button id="plan-neuf" class="link small">nouveau plan</button></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    ${termine ? `<div class="fin"><b>Plan terminé ✓</b><p class="small">Les données sont à jour pour le plan de craft.</p><button id="plan-craft" class="primary small">Voir le plan de craft</button></div>` : ''}
    ${hdvsTries.map(h => `<div class="hdv${etatHdv.get(h.hdv) ? ' fini' : ''}">
      <h3>${HDV[h.hdv]}${etatHdv.get(h.hdv) ? ' <span class="ok">✓</span>' : ''}</h3>
      ${h.groupes.map(g => groupeHtml(h, g)).join('')}</div>`).join('')}`;

  S.flash = null;
  $('#plan-neuf').onclick = async () => { if (termine || await ctx.confirmer('Abandonner ce plan et en préparer un nouveau ?', { ok: 'Nouveau plan' })) { S.etat.plan = null; ctx.sauverEtat(); ctx.renderTout(); } };
  const pc = $('#plan-craft'); if (pc) pc.onclick = () => { S.etat.vue = 'resultats'; ctx.sauverEtat(); ctx.renderTout(); };
  $$('#plan .grp-tete').forEach(el => el.onclick = () => { S.groupeOuvert = el.dataset.g === ouvert ? '' : el.dataset.g; ctx.renderTout(); });
  ctx.brancherCopier('#plan');
}
