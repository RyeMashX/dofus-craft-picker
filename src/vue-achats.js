// Onglet Achats : liste d'achat générée à partir du plan de craft, puis figée (quantités, lots, prix)
// jusqu'à la prochaine génération, même si le plan change entre-temps (un avertissement le signale).
// Ressources classées comme à l'HDV, quantités additionnées sur tous les crafts.

import { etatCraft, signaturePlan } from './vue-craft.js';
import { niveauRessource } from './fraicheur.js';
import { estIndispo } from './base.js';
import { pastille } from './vue-donnees.js';
import { icone } from './vue-plan.js';

const HDV = { equipements: 'HDV Équipements', ressources: 'HDV Ressources', consommables: 'HDV Consommables' };
const TAILLES = [1000, 100, 10, 1];
const dateCourte = t => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Photo de la liste d'achat au moment de la génération
export function genererListeAchat(ctx) {
  const { S } = ctx;
  const { ev, plan } = etatCraft(ctx);
  S.etat.listeAchat = {
    date: Date.now(),
    signature: signaturePlan(plan),
    crafts: ev.lignes.map(l => ({ id: l.id, nom: l.nom, iconId: l.iconId, n: l.n })),
    achats: ev.achats.map(a => ({
      id: a.id, nom: a.nom, type: a.type, hdv: a.hdv, iconId: a.iconId, q: a.q,
      pour: a.pour.map(x => ({ nom: x.nom, q: x.q, iconId: x.iconId ?? ev.lignes.find(l => l.nom === x.nom)?.iconId })),
      plan: a.plan && {
        lots: a.plan.lots, surplus: a.plan.surplus, cout: a.plan.cout, nbLots: a.plan.nbLots,
        prixUnitaire: a.plan.prixUnitaire, alerte: a.plan.alerte,
        prixLot: Object.fromEntries(TAILLES.filter(t => a.plan.lots[t]).map(t => [t, S.base.ressources[a.id]?.lots?.valeurs?.[t] ?? null])),
      },
    })),
    // ressources moins chères à crafter (alliages…) : leurs composants sont dans les achats
    sousCrafts: (ev.sousCrafts ?? []).map(s => ({ id: s.id, nom: s.nom, iconId: s.iconId, metier: s.metier, q: s.q, cout: s.cout, achat: s.achat, composants: s.composants, pour: s.pour })),
  };
  S.etat.achetes = {};
  ctx.sauverEtat();
}

export function renderAchats(ctx) {
  const { S, $, $$, esc, fmt, fmtK } = ctx;
  if (!S.catalogue) return;
  const { plan, ev } = etatCraft(ctx);
  const L = S.etat.listeAchat;
  const planVide = !ev.lignes.length;
  const generer = async () => {
    if (L && Object.keys(S.etat.achetes ?? {}).length && !(await ctx.confirmer('Regénérer la liste ? Les cases cochées seront remises à zéro.', { ok: 'Regénérer' }))) return;
    genererListeAchat(ctx); ctx.toast('Liste d\'achat générée ✓'); ctx.renderTout();
  };

  if (!L) {
    $('#achats').innerHTML = `<div class="row"><h2>Liste d'achat</h2></div>
      ${planVide ? '<p class="muted small">Le plan de craft est vide : compose-le dans l\'onglet Craft.</p>'
        : `<p class="muted small">Plan de craft : ${ev.crafts} crafts. La liste est calculée une fois, puis elle ne bouge plus jusqu'à la prochaine génération.</p>
           <div class="row"><button id="ac-gen" class="primary">Générer la liste d'achat</button></div>`}`;
    const b = $('#ac-gen'); if (b) b.onclick = generer;
    return;
  }

  const coches = (S.etat.achetes ??= {});
  const achats = L.achats;
  const fait = a => !!coches[a.id];
  const total = achats.reduce((s, a) => s + (a.plan?.cout ?? 0), 0);
  const reste = achats.filter(a => !fait(a)).reduce((s, a) => s + (a.plan?.cout ?? 0), 0);
  const nbFaits = achats.filter(fait).length;
  const perime = L.signature !== signaturePlan(plan);

  // Lots : cartouche « x10 » + nombre de lots + prix unitaire de ce lot
  const lots = a => !a.plan ? '<span class="bad small">prix inconnu</span>'
    : TAILLES.filter(t => a.plan.lots[t]).map(t => {
      const p = a.plan.prixLot?.[t];
      return `<span class="lotc" title="${a.plan.lots[t]} lot${a.plan.lots[t] > 1 ? 's' : ''} de ${t}${p ? ` à ${fmt(p)} le lot` : ''}"><i>x${t}</i><b>× ${a.plan.lots[t]}</b>${p ? `<span>${fmtK(p / t)}/u</span>` : ''}</span>`;
    }).join('');
  const pour = a => a.pour.map(x => `<span class="pour" title="${esc(x.nom)} : ${fmt(x.q)}">${icone(x.iconId)}<b>${fmt(x.q)}</b></span>`).join('');
  // Ligne légère : copier, icône, nom, quantité, total, prix unitaire attendu, case. Clic sur la ligne : détail.
  const ouverts = (S.achatsOuverts ??= new Set());
  const ligne = a => {
    const r = S.base.ressources[a.id], ouvert = ouverts.has(a.id);
    return `<div class="ac-l${fait(a) ? ' fini' : ''}${ouvert ? ' ouvert' : ''}">
      <div class="ac-ligne" data-ouvrir="${a.id}" title="${esc(a.nom)} : clique pour le détail">
        <span class="chev" aria-hidden="true"></span>
        ${ctx.boutonCopier(a.nom, 'ressource')}
        ${icone(a.iconId)}
        <span class="n">${esc(a.nom)}${a.plan?.alerte ? ' <span class="warn" title="À revérifier à l\'HDV">⚠</span>' : ''}</span>
        <span class="c-q">${fmt(a.q)}</span>
        <span class="c-t">${a.plan ? fmtK(a.plan.cout) : '<span class="bad">?</span>'}</span>
        <span class="c-pu">${a.plan ? fmtK(a.plan.prixUnitaire) : '–'}</span>
        <label class="coche" title="Acheté"><input type="checkbox" data-achat="${a.id}"${fait(a) ? ' checked' : ''}><span></span></label>
      </div>
      ${ouvert ? `<div class="ac-det">
        <div class="ac-det-l"><span class="muted">Lots</span><span class="ac-lots">${lots(a)}</span></div>
        ${a.plan?.surplus ? `<div class="ac-det-l"><span class="muted">Surplus</span><span>${fmt(a.plan.surplus)} en trop, revendu ~80 %</span></div>` : ''}
        <div class="ac-det-l"><span class="muted">Relevé</span><span>${pastille(niveauRessource(r))} ${ctx.age(estIndispo(r) ? r.indispo.date : r?.lots?.date ?? r?.prixMoyen?.date)}${a.plan?.alerte ? ' · <span class="warn">le prix risque de remonter en vidant les lots affichés : regarde l\'HDV avant d\'acheter</span>' : ''}</span></div>
        <div class="ac-det-l"><span class="muted">Pour</span><span class="ac-pour">${pour(a)}</span></div>
      </div>` : ''}</div>`;
  };

  const groupes = [];
  for (const a of achats) {
    const g = groupes.at(-1);
    if (g && g.hdv === a.hdv && g.type === a.type) g.lignes.push(a);
    else groupes.push({ hdv: a.hdv, type: a.type, lignes: [a] });
  }
  let hdvCourant = null;
  const corps = groupes.map(g => {
    const nouveau = g.hdv !== hdvCourant;
    const tete = nouveau ? `<h3>${HDV[g.hdv]}</h3><div class="ac-tete"><span></span><span class="c-q">qté</span><span class="c-t">total</span><span class="c-pu">prix/u</span><span></span></div>` : '';
    hdvCourant = g.hdv;
    const n = g.lignes.filter(fait).length;
    return `${tete}<div class="grp${n === g.lignes.length ? ' fini' : ''}"><div class="grp-tete"><span class="grp-filtres"><b>${esc(g.type)}</b></span><span class="muted small">${n}/${g.lignes.length}</span></div>
      <div class="ac">${g.lignes.map(ligne).join('')}</div></div>`;
  }).join('');

  // À crafter avant les items : une ligne par ressource craftée, détail = composants et économie
  const sc = L.sousCrafts ?? [];
  const faitC = s => !!coches[`c${s.id}`];
  const ligneC = s => {
    const ouvert = ouverts.has(`c${s.id}`);
    return `<div class="ac-l${faitC(s) ? ' fini' : ''}${ouvert ? ' ouvert' : ''}">
      <div class="ac-ligne" data-ouvrir="c${s.id}" title="${esc(s.nom)} : clique pour le détail">
        <span class="chev" aria-hidden="true"></span><span></span>
        ${icone(s.iconId)}
        <span class="n">${esc(s.nom)}</span>
        <span class="c-q">${fmt(s.q)}</span>
        <span class="c-t">${fmtK(s.cout)}</span>
        <span class="c-pu">${fmtK(s.cout / s.q)}</span>
        <label class="coche" title="Crafté"><input type="checkbox" data-achat="c${s.id}"${faitC(s) ? ' checked' : ''}><span></span></label>
      </div>
      ${ouvert ? `<div class="ac-det">
        <div class="ac-det-l"><span class="muted">Avec</span><span class="ac-pour">${s.composants.map(c => `<span class="pour" title="${esc(c.nom)} : ${fmt(c.q)}">${icone(c.iconId)}<b>${fmt(c.q)}</b></span>`).join('')}</span></div>
        <div class="ac-det-l"><span class="muted">Achat</span><span>${s.achat == null ? 'introuvable à l\'HDV' : `${fmtK(s.achat)} à l'HDV, soit ${fmtK(s.achat - s.cout)} d'économie`}</span></div>
        ${s.metier ? `<div class="ac-det-l"><span class="muted">Métier</span><span>${esc(s.metier)}</span></div>` : ''}
        <div class="ac-det-l"><span class="muted">Pour</span><span class="ac-pour">${pour(s)}</span></div>
      </div>` : ''}</div>`;
  };
  const blocCraft = sc.length ? `<h3>À crafter</h3><div class="ac-tete"><span></span><span class="c-q">qté</span><span class="c-t">coût</span><span class="c-pu">prix/u</span><span></span></div>
    <div class="grp${sc.every(faitC) ? ' fini' : ''}"><div class="ac">${sc.map(ligneC).join('')}</div></div>` : '';

  $('#achats').innerHTML = `
    <div class="row"><h2>Liste d'achat</h2><span class="muted small">générée le ${dateCourte(L.date)}</span><div class="spacer"></div>
      <button id="ac-gen" class="regen${perime ? ' on' : ''}" title="Recalculer la liste à partir du plan de craft actuel"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 1.8v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Régénérer</span></button></div>
    ${perime ? '<p class="small warn alerte-bloc">Le plan de craft a changé depuis cette liste. Régénère-la pour la mettre à jour.</p>' : ''}
    <div class="kpis kpis4">
      <div class="kpi"><div class="v">${fmtK(total)}</div><div class="l">à dépenser</div></div>
      <div class="kpi"><div class="v">${fmtK(reste)}</div><div class="l">reste à acheter</div></div>
      <div class="kpi"><div class="v">${nbFaits} / ${achats.length}</div><div class="l">ressources achetées</div></div>
      <div class="kpi"><div class="v">${achats.reduce((s, a) => s + (a.plan?.nbLots ?? 0), 0)}</div><div class="l">lots</div></div>
    </div>
    <div class="crafts-l">${L.crafts.map(c => `<span class="craft-c" title="${esc(c.nom)}">${icone(c.iconId)}<span class="n">${esc(c.nom)}</span><b>×${c.n}</b></span>`).join('')}</div>
    ${corps}
    ${blocCraft}
    <div class="row"><button id="ac-raz" class="link small">tout décocher</button></div>`;

  $$('#achats input[data-achat]').forEach(c => c.onchange = () => { if (c.checked) coches[c.dataset.achat] = true; else delete coches[c.dataset.achat]; ctx.sauverEtat(); ctx.renderTout(); });
  $$('#achats [data-ouvrir]').forEach(el => el.onclick = e => {
    if (e.target.closest('button, label, input')) return;
    const id = el.dataset.ouvrir.startsWith('c') ? el.dataset.ouvrir : +el.dataset.ouvrir;
    if (ouverts.has(id)) ouverts.delete(id); else ouverts.add(id);
    ctx.renderTout();
  });
  $('#ac-raz').onclick = () => { S.etat.achetes = {}; ctx.sauverEtat(); ctx.renderTout(); };
  $('#ac-gen').onclick = generer;
  ctx.brancherCopier('#achats');
}
