// Génère data/catalogue.json depuis l'API DofusDB.
// Usage : node scripts/catalogue.mjs [niveauMin] [niveauMax]   (défaut 190 200)
//
// Contenu : équipements craftables du niveau demandé, avec leur recette, le métier et le niveau requis,
// et la liste unique des ressources utilisées. Les objets de percepteur et les prysmaradites sont exclus.

import { writeFile, mkdir } from 'node:fs/promises';

const API = 'https://api.dofusdb.fr';
const [min = 190, max = 200] = process.argv.slice(2).map(Number);

// Types d'équipements retenus (id DofusDB → libellé)
const TYPES = {
  1: 'Amulette', 9: 'Anneau', 10: 'Ceinture', 11: 'Bottes', 16: 'Chapeau', 17: 'Cape', 82: 'Bouclier',
  2: 'Arc', 3: 'Baguette', 4: 'Bâton', 5: 'Dague', 6: 'Épée', 7: 'Marteau', 8: 'Pelle',
  19: 'Hache', 22: 'Faux', 271: 'Lance',
};

async function page(skip) {
  const url = `${API}/recipes?$limit=50&$skip=${skip}&resultLevel[$gte]=${min}&resultLevel[$lte]=${max}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} sur ${url}`);
  return r.json();
}

const recettes = [];
for (let skip = 0; ; skip += 50) {
  const { data, total } = await page(skip);
  recettes.push(...data);
  if (skip + 50 >= total) break;
}

const items = [];
const ressources = {};
for (const r of recettes) {
  if (!TYPES[r.resultTypeId]) continue;
  const recette = r.ingredientIds.map((id, i) => ({ id, qte: r.quantities[i] }));
  for (const ing of r.ingredients) {
    ressources[ing.id] ??= { id: ing.id, nom: ing.name.fr, niveau: ing.level, typeId: ing.typeId, iconId: ing.iconId };
  }
  items.push({
    id: r.resultId,
    nom: r.result.name.fr,
    niveau: r.resultLevel,
    typeId: r.resultTypeId,
    type: TYPES[r.resultTypeId],
    iconId: r.result.iconId,
    metierId: r.jobId,
    metier: r.job.name.fr,
    recette,
  });
}

// Sous-crafts : les ressources qui se craftent elles-mêmes (alliages, substrats…), et leurs composants, récursivement.
// ressources[id].recette = [{ id, qte }], ressources[id].metier
async function recettesDe(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const q = ids.slice(i, i + 40).map(id => `resultId[$in][]=${id}`).join('&');
    for (let skip = 0; ; skip += 50) {
      const r = await fetch(`${API}/recipes?$limit=50&$skip=${skip}&${q}`);
      const { data, total } = await r.json();
      out.push(...data);
      if (skip + 50 >= total) break;
    }
  }
  return out;
}
let aVoir = Object.keys(ressources).map(Number);
const vus = new Set(aVoir);
while (aVoir.length) {
  const nouveaux = [];
  for (const r of await recettesDe(aVoir)) {
    const res = ressources[r.resultId];
    if (!res || res.recette) continue;
    res.recette = r.ingredientIds.map((id, i) => ({ id, qte: r.quantities[i] }));
    res.metier = r.job?.name?.fr ?? null;
    for (const ing of r.ingredients) {
      ressources[ing.id] ??= { id: ing.id, nom: ing.name.fr, niveau: ing.level, typeId: ing.typeId, iconId: ing.iconId };
      if (!vus.has(ing.id)) { vus.add(ing.id); nouveaux.push(ing.id); }
    }
  }
  aVoir = nouveaux;
}

// Nom des catégories de ressources (celles des filtres de l'HDV ressources : Aile, Alliage, Bois…)
const typeIds = [...new Set(Object.values(ressources).map(r => r.typeId))];
const types = {};
for (let i = 0; i < typeIds.length; i += 40) {
  const q = typeIds.slice(i, i + 40).map(id => `id[$in][]=${id}`).join('&');
  const r = await fetch(`${API}/item-types?$limit=50&${q}`);
  for (const t of (await r.json()).data) types[t.id] = t.name.fr;
}
for (const r of Object.values(ressources)) r.type = types[r.typeId] ?? `Type ${r.typeId}`;

items.sort((a, b) => b.niveau - a.niveau || a.nom.localeCompare(b.nom, 'fr'));
const catalogue = {
  source: 'api.dofusdb.fr',
  genereLe: new Date().toISOString().slice(0, 10),
  niveaux: [min, max],
  items,
  ressources,
};

await mkdir('data', { recursive: true });
await writeFile('data/catalogue.json', JSON.stringify(catalogue, null, 1));
console.log(`${items.length} items, ${Object.keys(ressources).length} ressources → data/catalogue.json`);
