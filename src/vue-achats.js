// Onglet Achats : liste d'achat générée à partir du plan de craft, puis figée (quantités, lots, prix)
// jusqu'à la prochaine génération, même si le plan change entre-temps (un avertissement le signale).
// Ressources classées comme à l'HDV, quantités additionnées sur tous les crafts.

import { etatCraft, signaturePlan } from './vue-craft.js';
import { niveauRessource } from './fraicheur.js';
import { pastille } from './vue-donnees.js';
import { icone } from './vue-plan.js';

const HDV = { equipements: 'HDV Équipements', ressources: 'HDV Ressources' };
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
      pour: a.pour.map(x => ({ nom: x.nom, q: x.q, iconId: ev.lignes.find(l => l.nom === x.nom)?.iconId })),
      plan: a.plan && {
        lots: a.plan.lots, surplus: a.plan.surplus, cout: a.plan.cout, nbLots: a.plan.nbLots,
        prixUnitaire: a.plan.prixUnitaire, alerte: a.plan.alerte,
        prixLot: Object.fromEntries(TAILLES.filter(t => a.plan.lots[t]).map(t => [t, S.base.ressources[a.id]?.lots?.valeurs?.[t] ?? null])),
      },
    })),
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
  const generer = () => {
    if (L && Object.keys(S.etat.achetes ?? {}).length && !confirm('Regénérer la liste ? Les cases cochées seront remises à zéro.')) return;
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
  const ligne = a => `<div class="ac-l${fait(a) ? ' fini' : ''}">
      ${ctx.boutonCopier(a.nom, 'ressource')}
      <div class="ac-corps">
        <div class="ac-nom">${icone(a.iconId)} <span class="n" title="${esc(a.nom)}">${esc(a.nom)}</span>
          ${pastille(niveauRessource(S.base.ressources[a.id]))}${a.plan?.alerte ? ' <span class="tag faire" title="Le prix risque de remonter en vidant les lots affichés : regarde l\'HDV avant d\'acheter">à revérifier</span>' : ''}</div>
        <div class="ac-q"><b class="qte">${fmt(a.q)}</b>${a.plan?.surplus ? `<span class="muted small">+${a.plan.surplus} en trop</span>` : ''}
          <span class="spacer"></span>${a.plan ? `<span class="pu" title="Prix unitaire attendu">≈ <b>${fmtK(a.plan.prixUnitaire)}</b> /u</span>` : ''}</div>
        <div class="ac-lots">${lots(a)}<span class="spacer"></span><span class="muted small">total</span> ${fmtK(a.plan?.cout)}</div>
        <div class="ac-pour">${pour(a)}</div>
      </div>
      <label class="coche" title="Acheté"><input type="checkbox" data-achat="${a.id}"${fait(a) ? ' checked' : ''}><span></span></label></div>`;

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
    <div class="row"><h2>Liste d'achat</h2><span class="muted small">générée le ${dateCourte(L.date)}</span><div class="spacer"></div>
      <button id="ac-gen" class="${perime ? 'primary' : 'link'} small">régénérer</button></div>
    ${perime ? '<p class="small warn alerte-bloc">Le plan de craft a changé depuis cette liste. Régénère-la pour la mettre à jour.</p>' : ''}
    <div class="kpis kpis4">
      <div class="kpi"><div class="v">${fmtK(total)}</div><div class="l">à dépenser</div></div>
      <div class="kpi"><div class="v">${fmtK(reste)}</div><div class="l">reste à acheter</div></div>
      <div class="kpi"><div class="v">${nbFaits} / ${achats.length}</div><div class="l">ressources achetées</div></div>
      <div class="kpi"><div class="v">${achats.reduce((s, a) => s + (a.plan?.nbLots ?? 0), 0)}</div><div class="l">lots</div></div>
    </div>
    <div class="crafts-l">${L.crafts.map(c => `<span class="craft-c" title="${esc(c.nom)}">${icone(c.iconId)}<span class="n">${esc(c.nom)}</span><b>×${c.n}</b></span>`).join('')}</div>
    <p class="muted small">Quantités additionnées sur tous les crafts, lots les moins chers au moment de la génération. Sous chaque ressource : pour quels crafts, et combien.</p>
    ${corps}
    <div class="row"><button id="ac-raz" class="link small">tout décocher</button></div>`;

  $$('#achats input[data-achat]').forEach(c => c.onchange = () => { if (c.checked) coches[c.dataset.achat] = true; else delete coches[c.dataset.achat]; ctx.sauverEtat(); ctx.renderTout(); });
  $('#ac-raz').onclick = () => { S.etat.achetes = {}; ctx.sauverEtat(); ctx.renderTout(); };
  $('#ac-gen').onclick = generer;
  ctx.brancherCopier('#achats');
}
