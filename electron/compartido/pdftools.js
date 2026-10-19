// Herramientas PDF: lógica pura. Rangos tipo "1-3, 5, 8-10" (páginas desde
// 1, como las ve el usuario) a índices desde 0 para pdf-lib.
export function parsearRangos(texto, total) {
  const partes = String(texto || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return { error: "Escriba las páginas, por ejemplo 1-3, 5." };
  const indices = [];
  for (const parte of partes) {
    const m = parte.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return { error: `No entendí ${parte}. Use 1-3, 5.` };
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

// ---------- Firmar: de la pantalla al PDF ----------
// La ventana guarda cada firma o texto en puntos de la página tal como se
// ve (origen arriba a la izquierda, zoom 1, ya girada y recortada a la
// CropBox, igual que la dibuja pdfjs). pdf-lib dibuja en el espacio del
// PDF (origen abajo a la izquierda, sin girar). Estas funciones son la
// única traducción entre los dos: las usan la ventana y src/pdftools.js.
// pagina = { x0, y0, ancho, alto, rotacion } de la CropBox.

export function giroNormal(angulo) {
  const g = Math.round((Number(angulo) || 0) / 90) * 90;
  return ((g % 360) + 360) % 360;
}

// Tamaño de la página en pantalla a zoom 1: girada 90 o 270 cambia ancho y alto.
export function tamanoVista(pagina) {
  return giroNormal(pagina.rotacion) % 180
    ? { ancho: pagina.alto, alto: pagina.ancho }
    : { ancho: pagina.ancho, alto: pagina.alto };
}

export function puntoAPdf(u, v, pagina) {
  const x0 = Number(pagina.x0) || 0;
  const y0 = Number(pagina.y0) || 0;
  const x1 = x0 + pagina.ancho;
  const y1 = y0 + pagina.alto;
  switch (giroNormal(pagina.rotacion)) {
    case 90: return { x: x0 + v, y: y0 + u };
    case 180: return { x: x1 - u, y: y0 + v };
    case 270: return { x: x1 - v, y: y1 - u };
    default: return { x: x0 + u, y: y1 - v };
  }
}

// Caja en pantalla (x, y, w, h en píxeles con ese zoom) a lo que pide
// pdf-lib: la esquina que en pantalla queda abajo a la izquierda, el
// tamaño en puntos y el giro para que se vea derecha sobre la página.
export function cajaAPdf(caja, pagina, zoom = 1) {
  const k = Number(zoom) > 0 ? Number(zoom) : 1;
  const w = caja.w / k;
  const h = caja.h / k;
  const p = puntoAPdf(caja.x / k, caja.y / k + h, pagina);
  return { x: p.x, y: p.y, w, h, giro: giroNormal(pagina.rotacion) };
}

// Lo contrario de puntoAPdf: un punto del PDF a la página como se ve.
export function pdfAPunto(x, y, pagina) {
  const x0 = Number(pagina.x0) || 0;
  const y0 = Number(pagina.y0) || 0;
  const x1 = x0 + pagina.ancho;
  const y1 = y0 + pagina.alto;
  switch (giroNormal(pagina.rotacion)) {
    case 90: return { u: y - y0, v: x - x0 };
    case 180: return { u: x1 - x, v: y - y0 };
    case 270: return { u: y1 - y, v: x1 - x };
    default: return { u: x - x0, v: y1 - y };
  }
}

// Un rectángulo del PDF (x, y abajo a la izquierda, w, h; el /Rect de un
// campo) a caja en la página como se ve, en puntos a zoom 1. Rellenar pone
// así los campos encima del dibujo de pdfjs.
export function pdfACaja(rect, pagina) {
  const a = pdfAPunto(rect.x, rect.y, pagina);
  const b = pdfAPunto(rect.x + rect.w, rect.y + rect.h, pagina);
  return { x: Math.min(a.u, b.u), y: Math.min(a.v, b.v), w: Math.abs(b.u - a.u), h: Math.abs(b.v - a.v) };
}

// Un texto puesto es una caja de alto TEXTO_ALTO veces su letra; la base
// de la letra va TEXTO_BAJA veces la letra por encima del borde de abajo.
export const TEXTO_ALTO = 1.3;
export const TEXTO_BAJA = 0.3;

export function lineaDeTexto(caja) {
  const tamano = caja.h / TEXTO_ALTO;
  return { tamano, base: { x: caja.x, y: caja.y, w: caja.w, h: caja.h - tamano * TEXTO_BAJA } };
}

export function fechaHoy(fecha = new Date()) {
  const d = String(fecha.getDate()).padStart(2, "0");
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${fecha.getFullYear()}`;
}
