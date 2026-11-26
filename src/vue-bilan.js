// Onglet Bilan : ce qui a été vendu. Filtres (recherche, période, catégorie), indicateurs, graphiques,
// puis un tableau par équipement, dépliable : chaque vente avec ses dates, son historique de prix et ses actions
// (modifier, remettre en vente, supprimer).

import { vendues, marge, rendement, bilan, remettreEnVente, prixParItem, nbChangements, historiquePrix, supprimerLigne } from './ventes.js';
import { icone } from './vue-plan.js';
import { champ, brancherChamps, jourIso, histPrix, dateCourte } from './vue-ventes.js';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const ARMES_CAT = '__armes';
const ARMES = new Set(['Arc', 'Baguette', 'Bâton', 'Dague', 'Épée', 'Marteau', 'Pelle', 'Hache', 'Faux', 'Lance']);
const moisDe = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const nomMoisLong = k => { const [a, m] = k.split('-'); return `${MOIS[+m - 1]} ${a}`; };
const COLONNES = [
  ['nom', 'équipement'], ['ventes', 'ventes', 'Nombre de ventes'], ['prixMoyen', 'prix', 'Prix de vente moyen'],
  ['margeMoyenne', 'marge', 'Marge moyenne par vente, et rendement'], ['margeTotale', 'total', 'Marge totale'],
  ['delaiMoyen', 'délai', 'Délai moyen entre mise en vente et vente'], ['changementsMoyens', 'chgts', 'Changements de prix moyens par vente'],
  ['ecartMoyen', 'écart', 'Écart moyen du prix de vente au prix initial'],
];
const jours = d => d == null ? '–' : `${d.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`;

export function renderBilan(ctx) {
  const { S, $, $$, esc, fmtK, pct } = ctx;
  if (!S.catalogue) return;
  const items = new Map(S.catalogue.items.map(i => [i.id, i]));
  const F = (S.etat.bilanVue ??= { q: '', periode: 'tout', cat: '', tri: 'margeTotale', sens: -1 });
  if (!['tout', '30', '90', 'dates'].includes(F.periode) && !F.periode.startsWith('m:')) F.periode = 'tout';

  // ---- filtres : les ventes retenues alimentent tout l'onglet (indicateurs, graphiques, tableau) ----
  const toutes = vendues(S.base);
  // période : tout, 30 / 90 derniers jours, un mois précis, ou entre deux dates (bornes incluses)
  const debutJour = iso => iso ? new Date(`${iso}T00:00:00`).getTime() : null;
  const dansPeriode = t => {
    if (F.periode === 'tout') return true;
    if (F.periode === '30' || F.periode === '90') return t >= Date.now() - Number(F.periode) * 864e5;
    if (F.periode.startsWith('m:')) return moisDe(t) === F.periode.slice(2);
    const du = debutJour(F.du), au = debutJour(F.au);
    return (du == null || t >= du) && (au == null || t < au + 864e5);
  };
  const dansCat = it => !F.cat || (F.cat === ARMES_CAT ? ARMES.has(it?.type) : it?.type === F.cat);
  const q = ctx.normaliser(F.q ?? '');
  const retenues = toutes.filter(l => {
    const it = items.get(l.id);
    return dansPeriode(l.dateVente ?? l.dateMiseEnVente ?? 0) && dansCat(it) && (!q || ctx.normaliser(it?.nom ?? '').includes(q));
  });
  const moisVentes = [...new Set(toutes.map(l => moisDe(l.dateVente ?? l.dateMiseEnVente ?? 0)))].sort().reverse();
  const sous = { ...S.base, ventes: retenues };
  const b = bilan(sous);
  const cats = [...new Set(toutes.map(l => items.get(l.id)?.type).filter(Boolean))].sort();
  const filtre = F.q || F.periode !== 'tout' || F.cat;

  // ---- tableau par équipement ----
  const parItem = prixParItem(sous).map(p => ({ ...p, nom: items.get(p.id)?.nom ?? `#${p.id}`, margeTotale: p.margeMoyenne * p.ventes }));
  parItem.sort((x, y) => {
    const a = x[F.tri], c = y[F.tri];
    if (a == null && c == null) return 0; if (a == null) return 1; if (c == null) return -1;
    return (typeof a === 'string' ? a.localeCompare(c, 'fr') : a - c) * F.sens;
  });

  // ---- graphiques ----
  // part des ventes selon le nombre de changements de prix avant la vente
  const graphChgts = (() => {
    if (!retenues.length) return '';
    const n = retenues.map(nbChangements);
    const tranches = [['0 changement', x => x === 0], ['1 changement', x => x === 1], ['2 changements', x => x === 2], ['3 et +', x => x >= 3]]
      .map(([t, f]) => [t, n.filter(f).length]);
    return `<div class="gr"><h4>Changements de prix avant la vente</h4>${tranches.map(([t, k]) => `<div class="gh" title="${k} vente${k > 1 ? 's' : ''}"><span class="gh-n">${t}</span><span class="gh-b"><i class="ch" style="width:${(100 * k / retenues.length).toFixed(1)}%"></i></span><b>${pct(k / retenues.length)}</b></div>`).join('')}</div>`;
  })();
  const graphItems = (() => {
    const top = [...parItem].sort((x, y) => y.margeTotale - x.margeTotale).slice(0, 8);
    if (!top.length) return '';
    const max = Math.max(...top.map(x => Math.abs(x.margeTotale)), 1);
    return `<div class="gr"><h4>Marge totale par équipement</h4>${top.map(x => `<div class="gh" title="${esc(x.nom)} : ${x.ventes} vente${x.ventes > 1 ? 's' : ''}, marge ${fmtK(x.margeTotale)} (${pct(x.rendement)})">
      <span class="gh-n">${esc(x.nom)}</span><span class="gh-b"><i class="${x.margeTotale < 0 ? 'neg' : ''}" style="width:${(100 * Math.abs(x.margeTotale) / max).toFixed(1)}%"></i></span><b class="${x.margeTotale < 0 ? 'bad' : ''}">${fmtK(x.margeTotale)}</b></div>`).join('')}</div>`;
  })();
  const graphDelais = (() => {
    const d = retenues.filter(l => l.dateVente && l.dateMiseEnVente).map(l => (l.dateVente - l.dateMiseEnVente) / 864e5);
    if (!d.length) return '';
    const tranches = [['< 1 j', 0, 1], ['1 à 3 j', 1, 3], ['3 à 7 j', 3, 7], ['7 à 14 j', 7, 14], ['14 j et +', 14, Infinity]]
      .map(([t, a, z]) => [t, d.filter(x => x >= a && x < z).length]);
    const max = Math.max(...tranches.map(x => x[1]), 1);
    return `<div class="gr"><h4>Délai de vente</h4>${tranches.map(([t, n]) => `<div class="gh"><span class="gh-n">${t}</span><span class="gh-b"><i class="dl" style="width:${(100 * n / max).toFixed(1)}%"></i></span><b>${n}</b></div>`).join('')}</div>`;
  })();

  // ---- détail d'un équipement : ses ventes, avec actions ----
  const ouverts = (S.bilanOuverts ??= new Set());
  const etroit = $('body').ownerDocument.defaultView.matchMedia('(max-width: 560px)').matches;
  const venteHtml = l => {
    const m = marge(l), d = l.dateVente && l.dateMiseEnVente ? (l.dateVente - l.dateMiseEnVente) / 864e5 : null, edit = S.bilanEdit === l.uid;
    return `<tr class="bv"><td>${dateCourte(l.dateVente)}${nbChangements(l) ? `<div class="muted small">${historiquePrix(l).map(x => fmtK(x.prix)).join(' → ')}</div>` : ''}</td>
      <td class="r">${fmtK(l.prix)}</td><td class="r"><span class="${m >= 0 ? 'ok' : 'bad'}">${fmtK(m)}</span> <span class="muted">${pct(rendement(l))}</span></td><td class="r">${jours(d)}</td>
      <td class="r bv-act"><button class="link small" data-bedit="${l.uid}">${edit ? 'fermer' : 'modifier'}</button></td></tr>
      ${edit ? `<tr class="bv-edit"><td colspan="5">
        <div class="vt-meta"><label class="vf-date"><span>mis en vente le</span><input type="date" data-uid="${l.uid}" data-date="dateMiseEnVente" value="${jourIso(l.dateMiseEnVente)}"></label>
          <label class="vf-date"><span>vendu le</span><input type="date" data-uid="${l.uid}" data-date="dateVente" value="${jourIso(l.dateVente ?? Date.now())}"></label></div>
        ${histPrix(ctx, l)}
        <div class="vt-champs">${[['prix', 'Prix'], ['coutCraft', 'Craft'], ['frais', 'Mise en vente'], ['coutFm', 'FM']].map(([k, lib]) => champ(ctx, l, k, lib)).join('')}</div>
        <div class="row"><button class="secondary small" data-remettre="${l.uid}" title="Pas vendu finalement : la ligne repasse « En vente »">Remettre en vente</button><span class="spacer"></span>
          <button class="retirer" data-bsuppr="${l.uid}" title="Supprimer cette vente">✕</button></div></td></tr>` : ''}`;
  };

  const tete = COLONNES.map(([k, t, aide]) => `<th class="sort${k === 'nom' ? '' : ' r'}${F.tri === k ? ' on' : ''}" data-tri="${k}"${aide ? ` title="${aide}"` : ''}>${t}${F.tri === k ? (F.sens > 0 ? ' ▴' : ' ▾') : ''}</th>`).join('');
  const table = parItem.length ? `<table class="rt mois prix-items"><thead><tr>${tete}</tr></thead><tbody>
    ${parItem.map(p => { const it = items.get(p.id), ouvert = ouverts.has(p.id);
      return `<tr class="pi-l${ouvert ? ' ouvert' : ''}" data-pi="${p.id}"><td class="tn"><span class="chev" aria-hidden="true"></span>${icone(it?.iconId)}<span>${esc(p.nom)}</span></td>
        <td class="r">${p.ventes}</td><td class="r">${fmtK(p.prixMoyen)}</td>
        <td class="r"><b class="${p.margeMoyenne >= 0 ? 'ok' : 'bad'}">${fmtK(p.margeMoyenne)}</b> <span class="muted">${pct(p.rendement)}</span></td>
        <td class="r ${p.margeTotale < 0 ? 'bad' : ''}">${fmtK(p.margeTotale)}</td><td class="r">${jours(p.delaiMoyen)}</td>
        <td class="r">${p.changementsMoyens.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
        <td class="r ${p.ecartMoyen < 0 ? 'bad' : ''}">${p.ecartMoyen ? `${p.ecartMoyen > 0 ? '+' : ''}${pct(p.ecartMoyen)}` : '0 %'}</td></tr>
        ${ouvert ? `<tr class="pi-det"><td colspan="${etroit ? 4 : COLONNES.length}"><table class="pi-t"><thead><tr><th>vendu le</th><th class="r">prix</th><th class="r">marge</th><th class="r">délai</th><th></th></tr></thead><tbody>
          ${p.lignes.map(venteHtml).join('')}</tbody></table></td></tr>` : ''}`; }).join('')}
    </tbody></table>` : `<p class="muted small">${toutes.length ? 'Aucune vente avec ces filtres.' : 'Rien de vendu pour l\'instant. Dans l\'onglet Ventes, « Vendu » fait passer une ligne ici.'}</p>`;

  $('#bilan').innerHTML = `
    <div class="row small bl-filtres">
      <input id="bl-q" type="search" placeholder="Rechercher un équipement" value="${esc(F.q)}" autocomplete="off">
      <select id="bl-per" class="small">${[['tout', 'toute la période'], ['30', '30 derniers jours'], ['90', '90 derniers jours'], ...moisVentes.map(m => [`m:${m}`, nomMoisLong(m)]), ['dates', 'entre deux dates…']]
        .map(([k, t]) => `<option value="${k}"${F.periode === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
      ${F.periode === 'dates' ? `<label class="vf-date"><span>du</span><input type="date" id="bl-du" value="${F.du ?? ''}"></label><label class="vf-date"><span>au</span><input type="date" id="bl-au" value="${F.au ?? ''}"></label>` : ''}
      <select id="bl-cat" class="small"><option value="">toutes catégories</option><option value="${ARMES_CAT}"${F.cat === ARMES_CAT ? ' selected' : ''}>Armes (toutes)</option>${cats.map(c => `<option${c === F.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      ${filtre ? '<button id="bl-raz" class="link small">effacer les filtres</button>' : ''}
    </div>
    <div class="kpis kpis4">
      <div class="kpi"><div class="v">${b.ventes}${filtre ? `<span class="muted small"> / ${toutes.length}</span>` : ''}</div><div class="l">ventes</div></div>
      <div class="kpi"><div class="v">${fmtK(b.ca)}</div><div class="l">chiffre d'affaires</div></div>
      <div class="kpi"><div class="v ${b.marge >= 0 ? 'ok' : 'bad'}">${fmtK(b.marge)}</div><div class="l">marge, ${pct(b.rendement)}</div></div>
      <div class="kpi"><div class="v">${jours(b.delaiMoyen)}</div><div class="l">délai moyen de vente</div></div>
    </div>
    ${b.ventes ? `<div class="kpis kpis2">
      <div class="kpi"><div class="v">${b.changementsMoyens.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</div><div class="l">changements de prix par vente</div></div>
      <div class="kpi"><div class="v ${b.ecartMoyen < 0 ? 'bad' : ''}">${b.ecartMoyen > 0 ? '+' : ''}${pct(b.ecartMoyen)}</div><div class="l">écart moyen prix final / initial</div></div>
    </div>
    <div class="graphes">${graphItems}${graphChgts}${graphDelais}</div>` : ''}
    <h3>Par équipement</h3>
    ${table}
    ${parItem.length ? '<p class="muted small">Clic sur une ligne : ses ventes, avec « modifier » pour les dates, les chiffres, remettre en vente ou supprimer. Prix initial : celui d\'avant le premier « Prix modifié ».</p>' : ''}`;

  // ---- événements ----
  const set = (k, v) => { F[k] = v; ctx.sauverEtat(); ctx.renderTout(); };
  const qEl = $('#bl-q');
  qEl.oninput = () => { F.q = qEl.value; ctx.renderTout(); const n = $('#bl-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  $('#bl-per').onchange = e => set('periode', e.target.value);
  const du = $('#bl-du'); if (du) du.onchange = e => set('du', e.target.value || null);
  const au = $('#bl-au'); if (au) au.onchange = e => set('au', e.target.value || null);
  $('#bl-cat').onchange = e => set('cat', e.target.value);
  const raz = $('#bl-raz'); if (raz) raz.onclick = () => { Object.assign(F, { q: '', periode: 'tout', cat: '', du: null, au: null }); ctx.sauverEtat(); ctx.renderTout(); };
  $$('#bilan th[data-tri]').forEach(th => th.onclick = () => {
    const k = th.dataset.tri;
    F.sens = F.tri === k ? -F.sens : (k === 'nom' ? 1 : -1); F.tri = k; ctx.sauverEtat(); ctx.renderTout();
  });
  brancherChamps(ctx, '#bilan');
  $$('#bilan [data-pi]').forEach(tr => tr.onclick = () => { const id = +tr.dataset.pi; if (ouverts.has(id)) ouverts.delete(id); else ouverts.add(id); ctx.renderTout(); });
  $$('#bilan [data-bedit]').forEach(x => x.onclick = e => { e.stopPropagation(); S.bilanEdit = S.bilanEdit === x.dataset.bedit ? null : x.dataset.bedit; ctx.renderTout(); });
  $$('#bilan [data-remettre]').forEach(x => x.onclick = () => { remettreEnVente(S.base, x.dataset.remettre); S.bilanEdit = null; ctx.sauverBase(); ctx.toast('Remis en vente (onglet Ventes)'); ctx.renderTout(); });
  $$('#bilan [data-bsuppr]').forEach(x => x.onclick = async () => {
    if (!(await ctx.confirmer('Supprimer cette vente ? Elle disparaît du bilan.', { ok: 'Supprimer' }))) return;
    supprimerLigne(S.base, x.dataset.bsuppr); S.bilanEdit = null; ctx.sauverBase(); ctx.renderTout();
  });
}
