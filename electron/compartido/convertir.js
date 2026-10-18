// Lógica pura del conversor a Markdown: limpieza, calidad, tablas y
// troceo con página. Sin Electron ni Node: se prueba con node --test.

export const VERSION_CONVERSOR = 1;

export const EXTENSIONES = {
  pdf: "PDF",
  png: "Imagen",
  jpg: "Imagen",
  jpeg: "Imagen",
  tif: "Imagen",
  tiff: "Imagen",
  bmp: "Imagen",
  webp: "Imagen",
  docx: "Word",
  xlsx: "Hoja de cálculo",
  xls: "Hoja de cálculo",
  ods: "Hoja de cálculo",
  csv: "Hoja de cálculo",
  html: "Página web",
  htm: "Página web",
  txt: "Texto",
  md: "Markdown",
};

// Tope de páginas escaneadas que se leen con OCR en una sola conversión.
// Un expediente de 900 páginas escaneadas tardaría horas: se leen las
// primeras y el aviso dice cuántas quedaron sin leer.
export const MAX_PAGINAS_OCR = 200;

// De qué pantalla vino cada archivo convertido (archivo.meta.herramienta).
export const HERRAMIENTAS_ORIGEN = {
  convertir: "Convertir a Markdown",
  pdf: "Herramientas PDF",
  biblioteca: "Biblioteca de fuentes",
  documentos: "Contexto del proyecto",
  jurisprudencia: "Jurisprudencia",
};

export const IMAGENES = new Set(["png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"]);

export function extensionDe(nombre) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(nombre || ""));
  return m ? m[1].toLowerCase() : "";
}

export function esConvertible(nombre) {
  return Object.hasOwn(EXTENSIONES, extensionDe(nombre));
}

export function marcaPagina(n) {
  return `<!-- pagina ${n} -->`;
}

// Proporción de caracteres que parecen texto en español. Un PDF con
// fuentes CID sin tabla o un escaneado dan valores bajos.
export function calidadTexto(texto) {
  const t = String(texto || "").replace(/\s+/g, "");
  if (!t) return 0;
  const buenos = (t.match(/[\p{L}\p{N}.,;:()¿?¡!"'%$/\-]/gu) || []).length;
  const raros = (t.match(/[\uFFFD\u0000-\u001F]/g) || []).length;
  return Math.max(0, Math.min(1, (buenos - raros * 2) / t.length));
}

// Una página necesita OCR si casi no trae texto o si el texto es basura.
export function necesitaOcr(texto, { minimo = 20, umbral = 0.6 } = {}) {
  const t = String(texto || "").trim();
  if (t.replace(/\s+/g, "").length < minimo) return true;
  return calidadTexto(t) < umbral;
}

const TITULOS = /^(ANTECEDENTES|HECHOS|CONSIDERACIONES(?: DE LA (?:CORTE|SALA))?|PROBLEMA JUR[IÍ]DICO|RESUELVE|DECISI[OÓ]N|PRETENSIONES|FUNDAMENTOS DE DERECHO|PRUEBAS|NOTIFICACIONES|COMPETENCIA|S[IÍ]NTESIS|ANEXOS|PETICI[OÓ]N(?:ES)?)\s*:?$/;

export function esTituloJuridico(linea) {
  const l = String(linea || "").trim();
  if (!l || l.length > 80) return false;
  if (TITULOS.test(l)) return true;
  return /^[A-ZÁÉÍÓÚÑ0-9 ,.]{6,}$/.test(l) && /[A-ZÁÉÍÓÚÑ]{4}/.test(l) && !/\d{5,}/.test(l);
}

// Limpieza común: NFC, sin caracteres de control, palabras partidas con
// guion unidas, líneas del mismo párrafo juntas, títulos marcados.
export function limpiarTexto(texto) {
  let t = String(texto || "").normalize("NFC").replace(/\r\n?/g, "\n");
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  t = t.replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2");
  const lineas = t.split("\n").map((l) => l.replace(/[ \t\u00A0]+/g, " ").trim());
  const bloques = [];
  let actual = [];
  const cerrar = () => {
    if (actual.length) bloques.push(actual.join(" "));
    actual = [];
  };
  for (const linea of lineas) {
    if (!linea) {
      cerrar();
      continue;
    }
    if (/^<!-- pagina \d+ -->$/.test(linea)) {
      cerrar();
      bloques.push(linea);
      continue;
    }
    if (/^\d{1,4}$/.test(linea)) continue; // número de página suelto
    if (esTituloJuridico(linea)) {
      cerrar();
      bloques.push(`## ${linea.replace(/:$/, "")}`);
      continue;
    }
    if (/^([-*•]|\d+[.)]|[a-z][.)])\s+/.test(linea)) {
      cerrar();
      actual.push(linea.replace(/^•\s*/, "- "));
      cerrar();
      continue;
    }
    actual.push(linea);
    if (/[.:;]$/.test(linea) && linea.length < 60) cerrar();
  }
  cerrar();
  return bloques.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Quita líneas que se repiten arriba o abajo en la mayoría de páginas
// (membretes, pies). paginas: lista de textos.
export function quitarRepetidos(paginas) {
  if (paginas.length < 3) return paginas;
  const cuenta = new Map();
  const bordes = (p) => {
    const l = p.split("\n").map((x) => x.trim()).filter(Boolean);
    return [...new Set([...l.slice(0, 2), ...l.slice(-2)])];
  };
  for (const p of paginas) for (const l of bordes(p)) {
    const clave = l.replace(/\d+/g, "#");
    cuenta.set(clave, (cuenta.get(clave) || 0) + 1);
  }
  const limite = Math.ceil(paginas.length * 0.6);
  return paginas.map((p) => p.split("\n").filter((l) => {
    const clave = l.trim().replace(/\d+/g, "#");
    return !clave || (cuenta.get(clave) || 0) < limite || clave.length > 120;
  }).join("\n"));
}

export function escaparCelda(valor) {
  return String(valor ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function tablaMarkdown(filas, { maxFilas = 2000 } = {}) {
  const datos = (filas || []).filter((f) => Array.isArray(f) && f.some((c) => String(c ?? "").trim()));
  if (!datos.length) return "";
  const ancho = Math.max(...datos.map((f) => f.length));
  const fila = (f) => `| ${Array.from({ length: ancho }, (_, i) => escaparCelda(f[i])).join(" | ")} |`;
  const salida = [fila(datos[0]), `| ${Array(ancho).fill("---").join(" | ")} |`];
  const cuerpo = datos.slice(1, maxFilas + 1);
  for (const f of cuerpo) salida.push(fila(f));
  if (datos.length - 1 > maxFilas) salida.push("", `(Se omitieron ${datos.length - 1 - maxFilas} filas.)`);
  return salida.join("\n");
}

// Encabezado YAML corto para metadatos (jurisprudencia, origen).
export function encabezadoYaml(meta = {}) {
  const lineas = Object.entries(meta)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([k, v]) => `${k}: ${JSON.stringify(String(v).replace(/\s+/g, " ").trim())}`);
  return lineas.length ? `---\n${lineas.join("\n")}\n---\n\n` : "";
}

export function quitarEncabezado(md) {
  return String(md || "").replace(/^---\n[\s\S]*?\n---\n+/, "");
}

// Texto para guardar como fuente de la biblioteca: sin encabezado YAML ni
// marcas de página (las páginas siguen en los trozos del archivo).
export function textoLegible(md) {
  return quitarEncabezado(md).replace(/^<!-- pagina \d+ -->\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Aviso cuando hay más páginas escaneadas que el tope de OCR.
export function avisoTopeOcr(leidas, total) {
  const faltan = Math.max(0, Number(total || 0) - Number(leidas || 0));
  if (!faltan) return "";
  return `Se leyeron con OCR las primeras ${leidas} páginas escaneadas. Las otras ${faltan} quedaron sin leer: separe el PDF en partes en Herramientas PDF y conviértalas aparte.`;
}

// Resumen en palabras de un archivo convertido: tipo, páginas, OCR,
// calidad y de dónde vino. Lo muestran Revisar envío y las listas.
export function detalleArchivo(a = {}) {
  const meta = a.meta && typeof a.meta === "object" ? a.meta : {};
  const paginas = Number(a.paginas ?? meta.paginas ?? 0);
  const ocr = Number(a.paginas_ocr ?? meta.paginas_ocr ?? 0);
  const calidad = Number(a.calidad ?? meta.calidad ?? 0);
  const herramienta = HERRAMIENTAS_ORIGEN[meta.herramienta] || "";
  const partes = [EXTENSIONES[String(a.extension || "").toLowerCase()] || ""];
  if (paginas) partes.push(`${paginas} ${paginas === 1 ? "página" : "páginas"}`);
  if (ocr) partes.push(`${ocr} leídas con OCR`);
  if (calidad) partes.push(`calidad del texto ${Math.round(calidad * 100)} %`);
  if (herramienta) partes.push(`desde ${herramienta}`);
  return partes.filter(Boolean).join(", ");
}

// Troceo con página: sigue las marcas <!-- pagina n --> y el último
// título visto, para citar [archivo, página].
export function trocearMarkdown(md, { tamano = 1200, solape = 150 } = {}) {
  const cuerpo = quitarEncabezado(md);
  const trozos = [];
  let pagina = 0;
  let titulo = "";
  let actual = "";
  let paginaActual = 0;
  let tituloActual = "";
  const empujar = () => {
    const t = actual.trim();
    if (t) trozos.push({ orden: trozos.length, pagina: paginaActual, titulo: tituloActual, texto: t });
    actual = "";
  };
  for (const bloque of cuerpo.split(/\n\s*\n/)) {
    const b = bloque.trim();
    if (!b) continue;
    const marca = /^<!-- pagina (\d+) -->$/.exec(b);
    if (marca) {
      pagina = Number(marca[1]);
      continue;
    }
    const tit = /^#{1,6}\s+(.+)$/.exec(b);
    if (tit) titulo = tit[1].trim().slice(0, 120);
    if (!actual) {
      paginaActual = pagina;
      tituloActual = titulo;
    }
    if (actual && actual.length + b.length + 2 > tamano) {
      empujar();
      paginaActual = pagina;
      tituloActual = titulo;
    }
    if (b.length > tamano * 1.5) {
      for (let i = 0; i < b.length; i += tamano - solape) {
        actual = b.slice(i, i + tamano);
        paginaActual = pagina;
        tituloActual = titulo;
        empujar();
      }
      continue;
    }
    actual = actual ? `${actual}\n\n${b}` : b;
  }
  empujar();
  return trozos;
}

export function estimarTokensMd(texto) {
  return Math.ceil(String(texto || "").length / 4);
}

export function citaDeTrozo(trozo) {
  const nombre = trozo?.nombre || trozo?.archivo || "archivo";
  return trozo?.pagina ? `[${nombre}, página ${trozo.pagina}]` : `[${nombre}]`;
}
