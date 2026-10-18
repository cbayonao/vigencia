// Herramientas PDF: lógica pura. Rangos tipo "1-3, 5, 8-10" (páginas desde
// 1, como las ve el usuario) a índices desde 0 para pdf-lib.
export function parsearRangos(texto, total) {
  const partes = String(texto || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return { error: "Escriba las páginas, por ejemplo 1-3, 5." };
  const indices = [];
  for (const parte of partes) {
    const m = parte.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return { error: `No entendí “${parte}”. Use 1-3, 5.` };
    let ini = Number(m[1]);
    let fin = m[2] == null ? ini : Number(m[2]);
    if (ini < 1 || fin < 1) return { error: "Las páginas empiezan en 1." };
    if (fin < ini) [ini, fin] = [fin, ini];
    if (Number.isFinite(total) && (ini > total || fin > total)) {
      return { error: `El documento tiene ${total} ${total === 1 ? "página" : "páginas"}: ${parte} se sale.` };
    }
    for (let p = ini; p <= fin; p += 1) {
      if (!indices.includes(p - 1)) indices.push(p - 1);
    }
  }
  indices.sort((a, b) => a - b);
  return { indices };
}

export function describirRangos(indices) {
  const n = (indices || []).length;
  return `${n} ${n === 1 ? "página" : "páginas"}`;
}

export const ANGULOS = [90, 180, 270];

export const NIVELES_COMPRIMIR = [
  { id: "alta", nombre: "Alta calidad" },
  { id: "media", nombre: "Media (recomendada)" },
  { id: "baja", nombre: "Máxima compresión" },
];

export const POSICIONES_FIRMA = [
  { id: "abajo-derecha", nombre: "Abajo a la derecha" },
  { id: "abajo-izquierda", nombre: "Abajo a la izquierda" },
  { id: "abajo-centro", nombre: "Abajo al centro" },
  { id: "arriba-derecha", nombre: "Arriba a la derecha" },
  { id: "arriba-izquierda", nombre: "Arriba a la izquierda" },
  { id: "centro", nombre: "Al centro" },
];

// Esquina en coordenadas del PDF (origen abajo-izquierda) con margen.
export function cajaFirma(posicion, pagina, ancho, alto, margen = 50) {
  const { width: W, height: H } = pagina;
  const w = Math.min(ancho, W - margen * 2);
  const h = (alto * w) / Math.max(1, ancho);
  const xs = { izquierda: margen, centro: (W - w) / 2, derecha: W - w - margen };
  const ys = { abajo: margen, centro: (H - h) / 2, arriba: H - h - margen };
  const [vertical, horizontal] = String(posicion || "abajo-derecha").split("-");
  const yClave = vertical === "arriba" ? "arriba" : vertical === "centro" ? "centro" : "abajo";
  const xClave = horizontal === "izquierda" ? "izquierda" : horizontal === "centro" ? "centro" : "derecha";
  return { x: Math.max(0, xs[xClave]), y: Math.max(0, ys[yClave]), w, h };
}
