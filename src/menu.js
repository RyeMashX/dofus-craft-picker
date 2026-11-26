// Menu déroulant avec icônes (un <select> natif ne sait pas afficher d'images) : catégories avec leur logo.
// options = [{ v, lib, iconId }] ; etat = S.menus (id du menu ouvert)

const img = id => id ? `<img class="ico" alt="" src="https://api.dofusdb.fr/img/items/${id}.png">` : '<span class="ico"></span>';

export function menuHtml(id, valeur, options, esc = s => s, ouvert = false, droite = false) {
  const o = options.find(x => x.v === valeur) ?? options[0];
  return `<div class="menu" data-menu="${id}"><button class="menu-btn${ouvert ? ' on' : ''}" type="button">${img(o.iconId)}<span>${esc(o.lib)}</span><span class="menu-chev">▾</span></button>
    ${ouvert ? `<div class="menu-liste${droite ? ' droite' : ''}">${options.map(x => `<button type="button" data-v="${esc(x.v)}" class="${x.v === valeur ? 'on' : ''}">${img(x.iconId)}<span>${esc(x.lib)}</span></button>`).join('')}</div>` : ''}</div>`;
}

// onChoix(valeur) ; etat : objet partagé { ouvert: id | null } ; rafraichir() redessine
export function brancherMenu(racine, id, etat, onChoix, rafraichir) {
  const m = racine.querySelector(`[data-menu="${id}"]`);
  if (!m) return;
  m.querySelector('.menu-btn').onclick = () => { etat.ouvert = etat.ouvert === id ? null : id; rafraichir(); };
  m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { etat.ouvert = null; onChoix(b.dataset.v); });
  if (etat.ouvert === id) {
    const fermer = e => { if (!m.contains(e.target)) { document.removeEventListener('mousedown', fermer, true); etat.ouvert = null; rafraichir(); } };
    document.addEventListener('mousedown', fermer, true);
  }
}
