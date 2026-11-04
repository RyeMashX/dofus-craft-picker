// Rapprochement d'un nom lu par OCR avec les noms du catalogue (tolère quelques erreurs de lecture).

export function normaliser(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’`]/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function distance(a, b) {
  const m = a.length, n = b.length;
  let prec = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cour = [i];
    for (let j = 1; j <= n; j++) {
      cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prec = cour;
  }
  return prec[n];
}

// candidats = [{ id, nom, niveau? }]. Retourne { candidat, confiance } ou null.
// confiance = 1 − distance / longueur. Le niveau, s'il est lu, départage.
export function trouver(nomLu, candidats, { niveau = null, confianceMin = 0.75 } = {}) {
  const lu = normaliser(nomLu);
  if (lu.length < 3) return null;
  let best = null;
  for (const c of candidats) {
    if (niveau != null && c.niveau != null && c.niveau !== niveau) continue;
    const ref = normaliser(c.nom);
    // le nom lu peut contenir des débris avant (icône) : on compare aussi à la fin du texte lu
    const fin = lu.length > ref.length ? lu.slice(lu.length - ref.length) : lu;
    const d = Math.min(distance(lu, ref), distance(fin, ref) + 1);
    const confiance = 1 - d / Math.max(ref.length, 1);
    if (!best || confiance > best.confiance) best = { candidat: c, confiance };
  }
  return best && best.confiance >= confianceMin ? best : null;
}
