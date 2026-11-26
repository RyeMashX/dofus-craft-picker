// Onglet Bilan : ce qui a été vendu. Filtres (recherche, période, catégorie), indicateurs, graphiques,
// puis un tableau par équipement, dépliable : chaque vente avec ses dates, son historique de prix et ses actions
// (modifier, remettre en vente, supprimer).

import { vendues, marge, rendement, bilan, remettreEnVente, prixParItem, nbChangements, historiquePrix, supprimerLigne } from './ventes.js';
import { icone } from './vue-plan.js';
import { champ, brancherChamps, jourIso, histPrix, dateCourte } from './vue-ventes.js';
import { calendrierHtml, brancherCalendrier, bornes, iso } from './calendrier.js';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const ARMES_CAT = '__armes';
const ARMES = new Set(['Arc', 'Baguette', 'Bâton', 'Dague', 'Épée', 'Marteau', 'Pelle', 'Hache', 'Faux', 'Lance']);
// Granularité du graphique : clé de la période d'une date, son libellé, et la période suivante
const GRAINS = {
  jour: { lib: 'jour', cle: d => iso(d), suivante: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), titre: d => `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}` },
  semaine: { lib: 'semaine', debut: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7), suivante: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7), titre: d => `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}` },
  mois: { lib: 'mois', debut: d => new Date(d.getFullYear(), d.getMonth(), 1), suivante: d => new Date(d.getFullYear(), d.getMonth() + 1, 1), titre: d => `${MOIS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` },
  annee: { lib: 'année', debut: d => new Date(d.getFullYear(), 0, 1), suivante: d => new Date(d.getFullYear() + 1, 0, 1), titre: d => String(d.getFullYear()) },
};
const debutDe = (g, t) => { const d = new Date(t); return (GRAINS[g].debut ?? (x => new Date(x.getFullYear(), x.getMonth(), x.getDate())))(d); };
const MAX_BARRES = 90;
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
  const F = (S.etat.bilanVue ??= { q: '', cat: '', tri: 'margeTotale', sens: -1 });
  F.plage ??= { glissant: 30 };                      // par défaut : les 30 derniers jours, glissants
  F.grain ??= 'jour';
  delete F.periode;
  const cal = (S.calBilan ??= { ouvert: false });

  // ---- filtres : les ventes retenues alimentent tout l'onglet (indicateurs, graphiques, tableau) ----
  const toutes = vendues(S.base);
  const { debut, fin } = bornes(F.plage);
  const dateDe = l => l.dateVente ?? l.dateMiseEnVente ?? 0;
  const dansCat = it => !F.cat || (F.cat === ARMES_CAT ? ARMES.has(it?.type) : it?.type === F.cat);
  const q = ctx.normaliser(F.q ?? '');
  const retenues = toutes.filter(l => {
    const it = items.get(l.id), t = dateDe(l);
    return (debut == null || t >= debut) && (fin == null || t < fin) && dansCat(it) && (!q || ctx.normaliser(it?.nom ?? '').includes(q));
  });
  const sous = { ...S.base, ventes: retenues };
  const b = bilan(sous);
  const cats = [...new Set(toutes.map(l => items.get(l.id)?.type).filter(Boolean))].sort();
  const filtre = retenues.length !== toutes.length;

  // ---- tableau par équipement ----
  const parItem = prixParItem(sous).map(p => ({ ...p, nom: items.get(p.id)?.nom ?? `#${p.id}`, margeTotale: p.margeMoyenne * p.ventes }));
  parItem.sort((x, y) => {
    const a = x[F.tri], c = y[F.tri];
    if (a == null && c == null) return 0; if (a == null) return 1; if (c == null) return -1;
    return (typeof a === 'string' ? a.localeCompare(c, 'fr') : a - c) * F.sens;
  });

  // ---- graphiques ----
  // CA et marge par jour / semaine / mois / année, sur la période choisie ; survol : ventes de la période
  const graphTemps = (() => {
    if (!retenues.length) return '';
    const g = GRAINS[F.grain];
    const t0 = debut ?? Math.min(...retenues.map(dateDe)), t1 = (fin ?? Date.now() + 1) - 1;
    let barres = [];
    for (let d = debutDe(F.grain, t0); d.getTime() <= t1; d = g.suivante(d)) barres.push({ d, cle: d.getTime(), ventes: [] });
    const coupe = barres.length > MAX_BARRES;
    if (coupe) barres = barres.slice(-MAX_BARRES);
    const parCle = new Map(barres.map(x => [x.cle, x]));
    for (const l of retenues) parCle.get(debutDe(F.grain, dateDe(l)).getTime())?.ventes.push(l);
    for (const x of barres) { x.ca = x.ventes.reduce((s, l) => s + l.prix, 0); x.marge = x.ventes.reduce((s, l) => s + (marge(l) ?? 0), 0); }
    const max = Math.max(...barres.map(x => Math.max(x.ca, Math.abs(x.marge))), 1);
    const pas = barres.length > 45 ? Math.ceil(barres.length / 30) : barres.length > 20 ? 2 : 1;   // un libellé sur n
    const totalCa = barres.reduce((s, x) => s + x.ca, 0), totalMg = barres.reduce((s, x) => s + x.marge, 0);
    const bulle = (x, k) => {
      const lignes = [...x.ventes].sort((a, c) => (marge(c) ?? 0) - (marge(a) ?? 0));
      const cote = k < barres.length * 0.25 ? 'g' : k > barres.length * 0.75 ? 'd' : '';
      return `<div class="gt-bulle ${cote}"><b>${g.titre(x.d)}${F.grain === 'semaine' ? ' (semaine)' : ''}</b>
        <div>${x.ventes.length} vente${x.ventes.length > 1 ? 's' : ''} · CA ${fmtK(x.ca)} · marge <span class="${x.marge < 0 ? 'bad' : 'ok'}">${fmtK(x.marge)}</span></div>
        ${lignes.slice(0, 12).map(l => { const m = marge(l); return `<div class="gt-v"><span>${esc(items.get(l.id)?.nom ?? '#' + l.id)}</span><span>${fmtK(l.prix)}</span><span class="${m < 0 ? 'bad' : 'ok'}">${fmtK(m)}</span></div>`; }).join('')}
        ${lignes.length > 12 ? `<div class="muted">et ${lignes.length - 12} autres</div>` : ''}</div>`;
    };
    return `<div class="gr gr-large"><div class="gt-tete"><h4>Chiffre d'affaires et marge</h4>
        <span class="muted small">CA ${fmtK(totalCa)} · marge <b class="${totalMg < 0 ? 'bad' : 'ok'}">${fmtK(totalMg)}</b></span><span class="spacer"></span>
        <div id="bl-grain" class="seg small">${Object.entries(GRAINS).map(([k, v]) => `<button data-grain="${k}" class="${F.grain === k ? 'on' : ''}">${v.lib}</button>`).join('')}</div></div>
      <div class="gt"><div class="gt-axe"><span>${fmtK(max)}</span><span>${fmtK(max / 2)}</span><span>0</span></div>
        <div class="gt-barres">${barres.map((x, k) => `<div class="gt-b${x.ventes.length ? '' : ' vide'}">
          ${x.ventes.length ? bulle(x, k) : ''}
          ${barres.length <= 16 && x.ventes.length ? `<span class="gt-val" style="bottom:${(100 * Math.max(x.ca, Math.abs(x.marge)) / max).toFixed(1)}%"><b class="${x.marge < 0 ? 'bad' : 'ok'}">${fmtK(x.marge)}</b><br>${fmtK(x.ca)}</span>` : ''}
          <div class="gt-col"><i class="ca" style="height:${(100 * x.ca / max).toFixed(1)}%"></i><i class="mg${x.marge < 0 ? ' neg' : ''}" style="height:${(100 * Math.abs(x.marge) / max).toFixed(1)}%"></i></div>
          <span class="gt-l">${k % pas === 0 ? g.titre(x.d) : ''}</span></div>`).join('')}</div></div>
      <p class="gr-leg"><i class="ca"></i> chiffre d'affaires <i class="mg"></i> marge${coupe ? ` · ${MAX_BARRES} dernières périodes seulement : choisis une granularité plus large` : ''} · survole une barre pour le détail</p></div>`;
  })();

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
      ${calendrierHtml(F.plage, cal, esc)}
      <select id="bl-cat" class="small"><option value="">toutes catégories</option><option value="${ARMES_CAT}"${F.cat === ARMES_CAT ? ' selected' : ''}>Armes (toutes)</option>${cats.map(c => `<option${c === F.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      ${F.q || F.cat ? '<button id="bl-raz" class="link small">effacer les filtres</button>' : ''}
    </div>
    <div class="kpis kpis3">
      <div class="kpi"><div class="v">${b.ventes}${filtre ? `<span class="muted small"> / ${toutes.length}</span>` : ''}</div><div class="l">ventes</div></div>
      <div class="kpi"><div class="v">${fmtK(b.ca)}</div><div class="l">chiffre d'affaires</div></div>
      <div class="kpi"><div class="v ${b.marge >= 0 ? 'ok' : 'bad'}">${fmtK(b.marge)}</div><div class="l">marge, ${pct(b.rendement)}</div></div>
    </div>
    ${b.ventes ? `<div class="kpis kpis3">
      <div class="kpi"><div class="v">${jours(b.delaiMoyen)}</div><div class="l">délai moyen de vente</div></div>
      <div class="kpi"><div class="v">${b.changementsMoyens.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</div><div class="l">changements de prix par vente</div></div>
      <div class="kpi"><div class="v ${b.ecartMoyen < 0 ? 'bad' : ''}">${b.ecartMoyen > 0 ? '+' : ''}${pct(b.ecartMoyen)}</div><div class="l">écart moyen prix final / initial</div></div>
    </div>
    ${graphTemps}
    <div class="graphes">${graphItems}${graphChgts}${graphDelais}</div>` : ''}
    <h3>Par équipement</h3>
    ${table}
    ${parItem.length ? '<p class="muted small">Clic sur une ligne : ses ventes, avec « modifier » pour les dates, les chiffres, remettre en vente ou supprimer. Prix initial : celui d\'avant le premier « Prix modifié ».</p>' : ''}`;

  // ---- événements ----
  const set = (k, v) => { F[k] = v; ctx.sauverEtat(); ctx.renderTout(); };
  const qEl = $('#bl-q');
  qEl.oninput = () => { F.q = qEl.value; ctx.renderTout(); const n = $('#bl-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  brancherCalendrier($('#bilan'), F.plage, cal, plage => set('plage', plage), () => ctx.renderTout());
  $$('#bl-grain [data-grain]').forEach(x => x.onclick = () => set('grain', x.dataset.grain));
  $('#bl-cat').onchange = e => set('cat', e.target.value);
  const raz = $('#bl-raz'); if (raz) raz.onclick = () => { Object.assign(F, { q: '', cat: '', plage: { glissant: 30 } }); ctx.sauverEtat(); ctx.renderTout(); };
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
