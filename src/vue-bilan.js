// Onglet Bilan : statistiques et liste de tout ce qui a été vendu.

import { vendues, marge, rendement, bilan, remettreEnVente, prixParItem } from './ventes.js';
import { icone } from './vue-plan.js';
import { champ, brancherChamps, jourIso, histPrix } from './vue-ventes.js';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const nomMois = k => { const [a, m] = k.split('-'); return `${MOIS[+m - 1]} ${a}`; };

export function renderBilan(ctx) {
  const { S, $, $$, esc, fmtK, pct } = ctx;
  if (!S.catalogue) return;
  const items = new Map(S.catalogue.items.map(i => [i.id, i]));
  const b = bilan(S.base);
  const liste = vendues(S.base).sort((x, y) => (y.dateVente ?? 0) - (x.dateVente ?? 0));
  const n = S.bilanN ?? 50;

  const ligne = l => {
    const it = items.get(l.id), m = marge(l);
    return `<div class="vt-l vendu">
      <div class="cp-nom">${icone(it?.iconId)} <span class="n" title="${esc(it?.nom)}">${esc(it?.nom ?? `#${l.id}`)}</span>
        <b class="${m == null ? 'muted' : m >= 0 ? 'ok' : 'bad'}">${fmtK(m)}</b> <span class="muted small">${pct(rendement(l))}</span></div>
      <div class="vt-meta"><label class="vf-date"><span>vendu le</span><input type="date" data-uid="${l.uid}" data-date="dateVente" value="${jourIso(l.dateVente ?? Date.now())}"></label>
        <label class="vf-date"><span>mis en vente le</span><input type="date" data-uid="${l.uid}" data-date="dateMiseEnVente" value="${jourIso(l.dateMiseEnVente)}"></label></div>
      ${histPrix(ctx, l)}
      <details class="vt-det"><summary class="small muted">chiffres</summary>
        <div class="vt-champs">${[['prix', 'Prix'], ['coutCraft', 'Craft'], ['frais', 'Mise en vente'], ['coutFm', 'FM']].map(([k, lib]) => champ(ctx, l, k, lib)).join('')}</div>
        <button class="link small" data-remettre="${l.uid}">pas vendu finalement : remettre en vente</button></details>
    </div>`;
  };

  $('#bilan').innerHTML = `
    <div class="kpis kpis4">
      <div class="kpi"><div class="v">${b.ventes}</div><div class="l">ventes</div></div>
      <div class="kpi"><div class="v">${fmtK(b.ca)}</div><div class="l">chiffre d'affaires</div></div>
      <div class="kpi"><div class="v ${b.marge >= 0 ? 'ok' : 'bad'}">${fmtK(b.marge)}</div><div class="l">marge, ${pct(b.rendement)}</div></div>
      <div class="kpi"><div class="v">${b.delaiMoyen == null ? '–' : `${b.delaiMoyen.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`}</div><div class="l">délai moyen de vente</div></div>
    </div>
    ${b.ventes ? `<h3>Prix de vente</h3>
    <div class="kpis">
      <div class="kpi"><div class="v">${b.changementsMoyens.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</div><div class="l">changements de prix par vente</div></div>
      <div class="kpi"><div class="v">${pct(b.sansChangement)}</div><div class="l">vendus au prix initial</div></div>
      <div class="kpi"><div class="v ${b.ecartMoyen < 0 ? 'bad' : ''}">${b.ecartMoyen > 0 ? '+' : ''}${pct(b.ecartMoyen)}</div><div class="l">écart moyen prix final / initial</div></div>
    </div>
    <table class="rt mois prix-items"><thead><tr><th>item</th><th class="r">ventes</th><th class="r" title="Changements de prix moyens par vente">chgts</th><th class="r" title="Écart moyen du prix de vente au prix initial">écart</th><th class="r" title="Délai moyen de vente">délai</th></tr></thead><tbody>
      ${prixParItem(S.base).map(p => { const it = items.get(p.id); return `<tr><td class="tn">${icone(it?.iconId)}<span>${esc(it?.nom ?? `#${p.id}`)}</span></td><td class="r">${p.ventes}</td><td class="r">${p.changementsMoyens.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td><td class="r ${p.ecartMoyen < 0 ? 'bad' : ''}">${p.ecartMoyen ? `${p.ecartMoyen > 0 ? '+' : ''}${pct(p.ecartMoyen)}` : '0 %'}</td><td class="r">${p.delaiMoyen == null ? '–' : `${p.delaiMoyen.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`}</td></tr>`; }).join('')}
    </tbody></table>
    <p class="muted small">Prix initial : celui d'avant le premier « Prix modifié » (ou fusion d'une annonce relue à un autre prix). Les corrections du champ prix ne comptent pas comme des changements.</p>` : ''}
    ${b.parMois.length ? `<h3>Par mois</h3><table class="rt mois"><thead><tr><th></th><th class="r">ventes</th><th class="r">CA</th><th class="r">marge</th></tr></thead><tbody>
      ${b.parMois.map(m => `<tr><td>${nomMois(m.mois)}</td><td class="r">${m.ventes}</td><td class="r">${fmtK(m.ca)}</td><td class="r ${m.marge >= 0 ? 'ok' : 'bad'}">${fmtK(m.marge)}</td></tr>`).join('')}</tbody></table>` : ''}
    <h3>Vendus</h3>
    ${liste.length ? `<div class="cp">${liste.slice(0, n).map(ligne).join('')}</div>${liste.length > n ? `<button id="bl-plus" class="link small">afficher 50 de plus</button>` : ''}`
      : '<p class="muted small">Rien de vendu pour l\'instant. Dans l\'onglet Ventes, « ✓ Vendu » fait passer une ligne ici.</p>'}`;

  brancherChamps(ctx, '#bilan');
  $$('#bilan [data-remettre]').forEach(x => x.onclick = () => { remettreEnVente(S.base, x.dataset.remettre); ctx.sauverBase(); ctx.renderTout(); });
  const plus = $('#bl-plus'); if (plus) plus.onclick = () => { S.bilanN = n + 50; ctx.renderTout(); };
}
