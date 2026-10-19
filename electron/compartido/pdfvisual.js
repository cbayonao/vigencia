// Herramientas PDF con vista: lógica pura de la pantalla. La usan la
// ventana (renderer/pdf*.js) y los tests; nada de DOM ni de archivos.
import { diferencias } from "./documentos.js";
import { giroNormal } from "./pdftools.js";

const enteros = (lista) => [...new Set((lista || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
const rango = (desde, hasta) => Array.from({ length: Math.max(0, hasta - desde + 1) }, (_v, i) => desde + i);

// Índices desde 0 a texto como lo escribe el usuario: [0, 1, 2, 4] da
// "1-3, 5". Es lo contrario de parsearRangos.
export function indicesARangos(indices) {
  const lista = enteros(indices);
  const partes = [];
  for (let i = 0; i < lista.length; i += 1) {
    let j = i;
    while (j + 1 < lista.length && lista[j + 1] === lista[j] + 1) j += 1;
    partes.push(i === j ? `${lista[i] + 1}` : `${lista[i] + 1}-${lista[j] + 1}`);
    i = j;
  }
  return partes.join(", ");
}

// ---------- Separar ----------
// Un corte va después de una página (de 1 a total-1). Los cortes parten el
// documento en partes seguidas.

export function alternarCorte(cortes, despues, total) {
  const c = Number(despues);
  if (!Number.isInteger(c) || c < 1 || c >= total) return enteros(cortes);
  const lista = new Set(enteros(cortes));
  if (lista.has(c)) lista.delete(c);
  else lista.add(c);
  return enteros([...lista]).filter((n) => n >= 1 && n < total);
}

export function cortesAPartes(total, cortes) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (!n) return [];
  const puntos = enteros(cortes).filter((c) => c >= 1 && c < n);
  const partes = [];
  let desde = 1;
  for (const hasta of [...puntos, n]) {
    partes.push({ desde, hasta, indices: rango(desde - 1, hasta - 1) });
    desde = hasta + 1;
  }
  return partes;
}

// Cortes cada tantas páginas: 10 páginas cada 3 cortan en 3, 6 y 9.
export function cortesCada(total, cada) {
  const k = Math.floor(Number(cada) || 0);
  if (k < 1) return [];
  const salida = [];
  for (let c = k; c < total; c += k) salida.push(c);
  return salida;
}

// A qué parte va cada página (índice desde 0), para pintarla del color de
// su parte.
export function parteDeCadaPagina(partes) {
  const salida = [];
  partes.forEach((p, k) => {
    for (const i of p.indices) salida[i] = k;
  });
  return salida;
}

// ---------- Girar ----------
// giros: { índice: 90 | 180 | 270 }, solo las páginas que cambian.

export function girarPaginas(giros, indices, delta) {
  const salida = { ...(giros || {}) };
  for (const i of enteros(indices)) {
    const g = giroNormal((Number(salida[i]) || 0) + Number(delta || 0));
    if (g) salida[i] = g;
    else delete salida[i];
  }
  return salida;
}

export function cuantasGiradas(giros) {
  return Object.keys(giros || {}).length;
}

// ---------- Comprimir ----------

export function porcentajeAhorro(antes, despues) {
  const a = Number(antes) || 0;
  if (a <= 0) return 0;
  return Math.round((1 - (Number(despues) || 0) / a) * 100);
}

// Tamaño para leer, con coma decimal como se escribe en Colombia.
export function tamanoHumano(n) {
  const v = Number(n) || 0;
  if (v >= 1048576) return `${(v / 1048576).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(v / 1024))} KB`;
}

// ---------- Proteger ----------

const COMUNES = ["contraseña", "contrasena", "password", "qwerty", "123456", "abc123", "111111", "colombia", "admin", "clave"];
const NIVELES_CLAVE = ["Sin contraseña", "Débil", "Regular", "Buena", "Fuerte"];

// Fuerza de 0 a 4 con un consejo concreto. No es criptografía: es una guía
// para no dejar contraseñas obvias.
export function fuerzaClave(clave) {
  const c = String(clave || "");
  if (!c) return { nivel: 0, texto: NIVELES_CLAVE[0], consejo: "Escriba la contraseña que pedirá al abrir." };
  const clases = [/[a-zñáéíóú]/, /[A-ZÑÁÉÍÓÚ]/, /\d/, /[^\wñáéíóúÑÁÉÍÓÚ]/].filter((r) => r.test(c)).length;
  const bajo = c.toLowerCase();
  const obvia = COMUNES.some((p) => bajo.includes(p)) || /^(.)\1+$/.test(c) || /^\d+$/.test(c) || /^(0123|1234|2345|3456|4567|5678|6789|abcd)/i.test(c);
  let puntos = 0;
  if (c.length >= 8) puntos += 1;
  if (c.length >= 12) puntos += 1;
  if (c.length >= 16) puntos += 1;
  if (clases >= 2) puntos += 1;
  if (clases >= 3) puntos += 1;
  let nivel = c.length < 6 ? 1 : Math.min(4, Math.max(1, puntos));
  if (obvia) nivel = 1;
  let consejo = "Bien: guárdela en un lugar seguro, sin ella nadie lo abre.";
  if (obvia) consejo = "Es fácil de adivinar. Evite números seguidos, palabras comunes o letras repetidas.";
  else if (c.length < 8) consejo = "Use al menos 8 letras; mejor 12 o más.";
  else if (clases < 3) consejo = "Mezcle mayúsculas, minúsculas, números o signos.";
  else if (nivel < 4) consejo = "Más larga es mejor: 12 letras o más.";
  return { nivel, texto: NIVELES_CLAVE[nivel], consejo };
}

// Permisos del PDF (tabla 22 de ISO 32000): bit 3 imprimir, 4 modificar,
// 5 copiar, 6 comentar, 9 llenar formularios, 10 accesibilidad (siempre
// queda), 11 armar páginas, 12 imprimir en alta.
export const PERMISOS = [
  { id: "imprimir", nombre: "Imprimir", accion: "imprimir", bits: [3, 12] },
  { id: "copiar", nombre: "Copiar texto", accion: "copiar texto", bits: [5] },
  { id: "modificar", nombre: "Modificar y armar páginas", accion: "cambiar páginas", bits: [4, 11] },
  { id: "comentar", nombre: "Comentar y llenar formularios", accion: "comentar o llenar formularios", bits: [6, 9] },
];

// elegidos: { imprimir: true, ... }. Todo permitido da -4, lo de siempre.
export function permisosP(elegidos = {}) {
  let p = -4;
  for (const permiso of PERMISOS) {
    if (elegidos[permiso.id] !== false) continue;
    for (const b of permiso.bits) p &= ~(1 << (b - 1));
  }
  return p | 0;
}

export function resumenPermisos(elegidos = {}) {
  const puede = PERMISOS.filter((p) => elegidos[p.id] !== false).map((p) => p.accion);
  const noPuede = PERMISOS.filter((p) => elegidos[p.id] === false).map((p) => p.accion);
  if (!noPuede.length) return "Quien tenga la contraseña puede hacer todo: imprimir, copiar, modificar y comentar.";
  const lista = (x, y) => (x.length > 1 ? `${x.slice(0, -1).join(", ")} ${y} ${x[x.length - 1]}` : x[0]);
  const si = puede.length ? `Quien la abra puede ${lista(puede, "y")}.` : "Quien la abra solo puede leerlo.";
  return `${si} No puede ${lista(noPuede, "ni")}. Los lectores serios respetan estos permisos, pero no todos.`;
}

// ---------- Comparar ----------
// El texto trae marcas <!-- pagina n --> (del conversor). Se compara el
// texto sin marcas con diferencias() de Documentos y cada cambio se ubica
// en la página donde aparece.

const MARCA = /<!-- pagina (\d+) -->\n*/g;
const normal = (t) => String(t || "").replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim().toLowerCase();

export function paginasDeTexto(texto) {
  const t = String(texto || "");
  const salida = [];
  let ultimo = 0;
  let numero = 1;
  for (const m of t.matchAll(MARCA)) {
    const antes = t.slice(ultimo, m.index);
    if (antes.trim() || salida.length) salida.push({ numero, texto: antes });
    numero = Number(m[1]);
    ultimo = m.index + m[0].length;
  }
  salida.push({ numero, texto: t.slice(ultimo) });
  return salida.filter((p, i) => p.texto.trim() || i === salida.length - 1);
}

export function sinMarcas(texto) {
  return String(texto || "").replace(MARCA, "");
}

function ubicar(fragmento, paginas, desde) {
  const aguja = normal(fragmento).slice(0, 80);
  if (!aguja) return null;
  const norm = paginas.map((p) => normal(p.texto));
  for (let k = 0; k < paginas.length; k += 1) {
    const i = (desde + k) % paginas.length;
    if (norm[i].includes(aguja)) return i;
  }
  return null;
}

export function cambiosPorPagina(textoA, textoB) {
  const pagA = paginasDeTexto(textoA);
  const pagB = paginasDeTexto(textoB);
  const dif = diferencias(sinMarcas(textoA), sinMarcas(textoB));
  const cambios = [];
  const porA = {};
  const porB = {};
  let ia = 0;
  let ib = 0;
  for (const c of dif.cambios) {
    if (c.tipo === "igual") {
      const j = ubicar(c.texto, pagB, ib);
      if (j != null) ib = j;
      continue;
    }
    const enA = c.tipo === "quitado" ? c.texto : c.tipo === "cambiado" ? c.antes : null;
    const enB = c.tipo === "quitado" ? null : c.texto;
    const ka = enA == null ? null : ubicar(enA, pagA, ia);
    const kb = enB == null ? null : ubicar(enB, pagB, ib);
    if (ka != null) ia = ka;
    if (kb != null) ib = kb;
    const paginaA = ka == null ? null : pagA[ka].numero;
    const paginaB = kb == null ? null : pagB[kb].numero;
    if (paginaA != null) porA[paginaA] = (porA[paginaA] || 0) + 1;
    if (paginaB != null) porB[paginaB] = (porB[paginaB] || 0) + 1;
    cambios.push({ ...c, paginaA, paginaB });
  }
  return { cambios, cuenta: dif.cuenta, porA, porB };
}

// Dentro de un párrafo cambiado: qué palabras se quitaron y cuáles se
// agregaron. Devuelve tramos { tipo: "igual" | "quitado" | "agregado",
// texto }. Párrafos muy largos se marcan enteros (la tabla crece n por m).
export function diferenciaPalabras(antes, despues, maximo = 600) {
  const a = String(antes || "").split(/(\s+)/).filter(Boolean);
  const b = String(despues || "").split(/(\s+)/).filter(Boolean);
  if (a.length > maximo || b.length > maximo) {
    return [{ tipo: "quitado", texto: a.join("") }, { tipo: "agregado", texto: b.join("") }].filter((t) => t.texto);
  }
  const n = a.length;
  const m = b.length;
  const tabla = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) tabla[i][j] = a[i] === b[j] ? tabla[i + 1][j + 1] + 1 : Math.max(tabla[i + 1][j], tabla[i][j + 1]);
  }
  const salida = [];
  const poner = (tipo, texto) => {
    const ultimo = salida[salida.length - 1];
    if (ultimo?.tipo === tipo) ultimo.texto += texto;
    else salida.push({ tipo, texto });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      poner("igual", a[i]);
      i++;
      j++;
    } else if (tabla[i + 1][j] >= tabla[i][j + 1]) {
      poner("quitado", a[i++]);
    } else {
      poner("agregado", b[j++]);
    }
  }
  while (i < n) poner("quitado", a[i++]);
  while (j < m) poner("agregado", b[j++]);
  return salida;
}
