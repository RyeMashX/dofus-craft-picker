// Onglet Achats : tout ce qu'il faut acheter pour le plan de craft, ressource par ressource,
// quantités additionnées sur tous les crafts, lots conseillés et prix attendu. Classé comme à l'HDV.

import { etatCraft } from './vue-craft.js';
import { niveauRessource } from './fraicheur.js';
import { pastille } from './vue-donnees.js';
import { icone } from './vue-plan.js';

const HDV = { equipements: 'HDV Équipements', ressources: 'HDV Ressources' };

export function renderAchats(ctx) {
  const { S, $, $$, esc, fmt, fmtK } = ctx;
  if (!S.catalogue) return;
  const { ev } = etatCraft(ctx);
  const coches = (S.etat.achetes ??= {});
  const achats = ev.achats;

  if (!achats.length) {
    $('#achats').innerHTML = '<p class="muted small">Le plan de craft est vide : choisis tes crafts dans l\'onglet Craft.</p>';
    return;
  }
  const fait = a => !!coches[a.id];
  const total = achats.reduce((s, a) => s + (a.plan?.cout ?? 0), 0);
  const reste = achats.filter(a => !fait(a)).reduce((s, a) => s + (a.plan?.cout ?? 0), 0);
  const nbLots = achats.reduce((s, a) => s + (a.plan?.nbLots ?? 0), 0);

  const lots = a => !a.plan ? '<span class="bad small">prix inconnu</span>'
    : [1000, 100, 10, 1].filter(t => a.plan.lots[t]).map(t => `<span class="lotc"><b>${a.plan.lots[t]}</b> × x${t}</span>`).join('');
  const ligne = a => `<div class="ac-l${fait(a) ? ' fini' : ''}">
      <label class="chk-l"><input type="checkbox" data-achat="${a.id}"${fait(a) ? ' checked' : ''}></label>
      ${ctx.boutonCopier(a.nom, 'ressource')}
      <div class="ac-corps">
        <div class="ac-nom">${icone(a.iconId)} <span class="n" title="Pour : ${esc(a.pour.map(x => `${x.nom} (${x.q})`).join(', '))}">${esc(a.nom)}</span>
          ${pastille(niveauRessource(S.base.ressources[a.id]))}${a.plan?.alerte ? ' <span class="tag faire" title="Le prix risque de remonter en vidant les lots affichés : regarde l\'HDV avant d\'acheter">à revérifier</span>' : ''}</div>
        <div class="ac-chiffres"><span class="muted small">qté</span> <b>${fmt(a.q)}</b>${a.plan?.surplus ? ` <span class="muted small">(+${a.plan.surplus} en trop)</span>` : ''} ${lots(a)}
          <span class="spacer"></span><b>${fmtK(a.plan?.cout)}</b></div>
      </div></div>`;

  const groupes = [];
  for (const a of achats) {
    const g = groupes.at(-1);
    if (g && g.hdv === a.hdv && g.type === a.type) g.lignes.push(a);
    else groupes.push({ hdv: a.hdv, type: a.type, lignes: [a] });
  }
  let hdvCourant = null;
  const corps = groupes.map(g => {
    const tete = g.hdv !== hdvCourant ? `<h3>${HDV[g.hdv]}</h3>` : '';
    hdvCourant = g.hdv;
    const n = g.lignes.filter(fait).length;
    return `${tete}<div class="grp${n === g.lignes.length ? ' fini' : ''}"><div class="grp-tete"><span class="grp-filtres"><b>${esc(g.type)}</b></span><span class="muted small">${n}/${g.lignes.length}</span></div>
      <div class="ac">${g.lignes.map(ligne).join('')}</div></div>`;
  }).join('');

  $('#achats').innerHTML = `
    <div class="kpis kpis4">
      <div class="kpi"><div class="v">${fmtK(total)}</div><div class="l">à dépenser</div></div>
      <div class="kpi"><div class="v">${fmtK(reste)}</div><div class="l">reste à acheter</div></div>
      <div class="kpi"><div class="v">${achats.filter(fait).length} / ${achats.length}</div><div class="l">ressources achetées</div></div>
      <div class="kpi"><div class="v">${nbLots}</div><div class="l">lots</div></div>
    </div>
    <p class="muted small">Pour ${ev.crafts} crafts : ${esc(ev.lignes.map(l => `${l.nom} ×${l.n}`).join(', '))}. Quantités additionnées sur tous les crafts, lots les moins chers d'après le dernier relevé.</p>
    ${corps}
    <div class="row"><button id="ac-raz" class="link small">tout décocher</button></div>`;

  $$('#achats input[data-achat]').forEach(c => c.onchange = () => { if (c.checked) coches[c.dataset.achat] = true; else delete coches[c.dataset.achat]; ctx.sauverEtat(); ctx.renderTout(); });
  $('#ac-raz').onclick = () => { S.etat.achetes = {}; ctx.sauverEtat(); ctx.renderTout(); };
  ctx.brancherCopier('#achats');
}
