// Sélecteur de période en deux clics (comme une réservation de train) : un bouton qui ouvre deux mois côte à côte,
// premier clic = début, second clic = fin. Raccourcis : 7, 30, 90 derniers jours (glissants), 12 mois, tout.
// plage = { glissant: 30 } | { du: 'AAAA-MM-JJ', au: 'AAAA-MM-JJ' } | {} (tout)

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_C = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];
export const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const date = s => new Date(`${s}T00:00:00`);
export const RACCOURCIS = [['7 j', { glissant: 7 }], ['30 j', { glissant: 30 }], ['90 j', { glissant: 90 }], ['12 mois', { glissant: 365 }], ['tout', {}]];

// Bornes effectives (timestamps, fin exclue) ; null = pas de borne
export function bornes(plage, maintenant = Date.now()) {
  if (plage?.glissant) {
    const fin = date(iso(new Date(maintenant))).getTime() + 864e5;
    return { debut: fin - plage.glissant * 864e5, fin };
  }
  return { debut: plage?.du ? date(plage.du).getTime() : null, fin: plage?.au ? date(plage.au).getTime() + 864e5 : null };
}

export function libellePlage(plage) {
  if (plage?.glissant) return plage.glissant === 365 ? '12 derniers mois' : `${plage.glissant} derniers jours`;
  if (!plage?.du && !plage?.au) return 'toute la période';
  const f = s => { const d = date(s); return `${d.getDate()} ${MOIS_C[d.getMonth()]} ${d.getFullYear()}`; };
  return `${plage.du ? f(plage.du) : '…'} → ${plage.au ? f(plage.au) : '…'}`;
}

// état : { ouvert, mois: 'AAAA-MM' (premier mois affiché), debut: 'AAAA-MM-JJ' (premier clic en attente) }
export function calendrierHtml(plage, etat, esc = s => s) {
  const ic = '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5.5 1.8v2.6M10.5 1.8v2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const bouton = `<button id="cal-btn" class="cal-btn${etat.ouvert ? ' on' : ''}">${ic}<span>${esc(libellePlage(plage))}</span></button>`;
  if (!etat.ouvert) return `<div class="cal">${bouton}</div>`;
  const auj = iso(new Date());
  const { debut, fin } = bornes(plage);
  const selDu = etat.debut ?? (debut != null ? iso(new Date(debut)) : null);
  const selAu = etat.debut ? null : fin != null ? iso(new Date(fin - 864e5)) : null;
  const [a, m] = (etat.mois ?? auj.slice(0, 7)).split('-').map(Number);
  const mois = k => {
    const d0 = new Date(a, m - 1 + k, 1), an = d0.getFullYear(), mo = d0.getMonth();
    const decal = (d0.getDay() + 6) % 7, nb = new Date(an, mo + 1, 0).getDate();
    const cases = Array.from({ length: decal }, () => '<span></span>').concat(Array.from({ length: nb }, (_, i) => {
      const j = iso(new Date(an, mo, i + 1));
      const cls = [j === auj ? 'auj' : '', j > auj ? 'futur' : '', selDu && j === selDu ? 'bord' : '', selAu && j === selAu ? 'bord' : '',
        selDu && selAu && j > selDu && j < selAu ? 'dans' : ''].filter(Boolean).join(' ');
      return `<button data-jour="${j}" class="${cls}"${j > auj ? ' disabled' : ''}>${i + 1}</button>`;
    }));
    return `<div class="cal-mois${k ? ' second' : ''}"><div class="cal-titre">${MOIS[mo]} ${an}</div><div class="cal-grille">${JOURS.map(x => `<i>${x}</i>`).join('')}${cases.join('')}</div></div>`;
  };
  return `<div class="cal">${bouton}<div class="cal-pop">
    <div class="cal-racc">${RACCOURCIS.map(([t, pl], i) => `<button data-racc="${i}" class="${JSON.stringify(pl) === JSON.stringify(plage?.glissant ? { glissant: plage.glissant } : plage?.du || plage?.au ? null : {}) ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="cal-nav"><button data-calnav="-1" aria-label="Mois précédent">‹</button><span class="muted small">${etat.debut ? 'Choisis la date de fin' : 'Choisis la date de début'}</span><button data-calnav="1" aria-label="Mois suivant">›</button></div>
    <div class="cal-deux">${mois(0)}${mois(1)}</div></div></div>`;
}

// Branche les événements ; onPlage(nouvellePlage) quand une période est choisie, rafraichir() sinon
export function brancherCalendrier(racine, plage, etat, onPlage, rafraichir) {
  const q = s => racine.querySelector(s), qa = s => [...racine.querySelectorAll(s)];
  const ouvrir = () => {
    etat.ouvert = !etat.ouvert; etat.debut = null;
    if (etat.ouvert) { const { fin } = bornes(plage); const d = fin != null ? new Date(fin - 864e5) : new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); etat.mois = iso(d).slice(0, 7); }
    rafraichir();
  };
  q('#cal-btn').onclick = ouvrir;
  qa('[data-calnav]').forEach(b => b.onclick = () => { const [a, m] = etat.mois.split('-').map(Number); etat.mois = iso(new Date(a, m - 1 + Number(b.dataset.calnav), 1)).slice(0, 7); rafraichir(); });
  qa('[data-racc]').forEach(b => b.onclick = () => { etat.ouvert = false; etat.debut = null; onPlage({ ...RACCOURCIS[+b.dataset.racc][1] }); });
  qa('[data-jour]').forEach(b => b.onclick = () => {
    const j = b.dataset.jour;
    if (!etat.debut) { etat.debut = j; rafraichir(); return; }
    const [du, au] = [etat.debut, j].sort();
    etat.ouvert = false; etat.debut = null; onPlage({ du, au });
  });
}
