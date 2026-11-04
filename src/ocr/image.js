// Prétraitement d'image en JS pur, sur des objets { width, height, data } au format RGBA
// (comme ImageData dans le navigateur). Utilisable tel quel dans Node pour les tests.
//
// Étapes : recadrage → masquage des icônes kama (jaunes) → niveaux de gris inversés
// → agrandissement ×2 → seuillage. Résultat : texte noir sur fond blanc.

export function recadrer(img, zone) {
  const x0 = Math.max(0, Math.round(zone.x)), y0 = Math.max(0, Math.round(zone.y));
  const w = Math.min(img.width - x0, Math.round(zone.w)), h = Math.min(img.height - y0, Math.round(zone.h));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    data.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

const estJaune = (r, g, b) => r > 140 && g > 120 && b < 90 && r - b > 80;

export function pretraiter(img, zone, { echelle = 2, seuil = 110, masquerJaune = true } = {}) {
  const c = zone ? recadrer(img, zone) : img;
  const { width: w, height: h } = c;

  // gris inversé (luminance PIL : 0,299 R + 0,587 G + 0,114 B)
  const gris = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let r = c.data[i * 4], g = c.data[i * 4 + 1], b = c.data[i * 4 + 2];
    if (masquerJaune && estJaune(r, g, b)) { r = 30; g = 30; b = 50; }
    gris[i] = 255 - (0.299 * r + 0.587 * g + 0.114 * b);
  }

  // agrandissement bilinéaire + seuillage
  const W = w * echelle, H = h * echelle;
  const data = new Uint8ClampedArray(W * H * 4);
  const limite = 255 - seuil;
  for (let Y = 0; Y < H; Y++) {
    const sy = Math.min(h - 1, Math.max(0, (Y + 0.5) / echelle - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let X = 0; X < W; X++) {
      const sx = Math.min(w - 1, Math.max(0, (X + 0.5) / echelle - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const v =
        gris[y0 * w + x0] * (1 - fx) * (1 - fy) + gris[y0 * w + x1] * fx * (1 - fy) +
        gris[y1 * w + x0] * (1 - fx) * fy + gris[y1 * w + x1] * fx * fy;
      const o = v > limite ? 255 : 0;
      const k = (Y * W + X) * 4;
      data[k] = data[k + 1] = data[k + 2] = o;
      data[k + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}
