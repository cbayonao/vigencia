// Convertidores locales a Markdown. Ninguno usa la red: pdfjs lee los
// cmaps y fuentes estándar de su carpeta, el OCR lee su idioma de la
// carpeta ocr/ y las librerías de Office trabajan en memoria.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  IMAGENES, MAX_PAGINAS_OCR, VERSION_CONVERSOR, avisoTopeOcr, calidadTexto, extensionDe, limpiarTexto, marcaPagina, necesitaOcr, quitarRepetidos, tablaMarkdown,
} from "../../compartido/convertir.js";
import { AVISO_OCR, crearLectorOcr, estadoOcr } from "./ocr.js";

const require = createRequire(import.meta.url);
const aqui = path.dirname(fileURLToPath(import.meta.url));

export class Cancelado extends Error {
  constructor() {
    super("Conversión cancelada.");
    this.codigo = "cancelado";
  }
}

function revisar(senal) {
  if (senal?.cancelado) throw new Cancelado();
}

// ---------- PNG mínimo para pasar páginas escaneadas al OCR ----------

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloquePng(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([largo, td, crc]);
}

// canales: 1 gris, 3 RGB, 4 RGBA.
export function pngDesdePixeles({ width, height, data, canales }) {
  const tipo = { 1: 0, 3: 2, 4: 6 }[canales];
  const fila = width * canales;
  const crudo = Buffer.alloc((fila + 1) * height);
  for (let y = 0; y < height; y++) {
    crudo[y * (fila + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * fila, fila).copy(crudo, y * (fila + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = tipo;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloquePng("IHDR", ihdr),
    bloquePng("IDAT", zlib.deflateSync(crudo)),
    bloquePng("IEND", Buffer.alloc(0)),
  ]);
}

// Imagen de pdfjs (kind 1: 1 bit por pixel, 2: RGB, 3: RGBA) a PNG.
export function pngDeImagenPdf(img) {
  if (!img?.data || !img.width || !img.height) return null;
  const { width, height } = img;
  if (img.kind === 2) return pngDesdePixeles({ width, height, data: img.data, canales: 3 });
  if (img.kind === 3) return pngDesdePixeles({ width, height, data: img.data, canales: 4 });
  if (img.kind === 1) {
    const porFila = (width + 7) >> 3;
    const gris = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (img.data[y * porFila + (x >> 3)] >> (7 - (x & 7))) & 1;
        gris[y * width + x] = bit ? 255 : 0;
      }
    }
    return pngDesdePixeles({ width, height, data: gris, canales: 1 });
  }
  return null;
}

// ---------- PDF ----------

let pdfjs;
async function cargarPdfjs() {
  if (!pdfjs) pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

export function carpetaPdfjs() {
  return path.dirname(require.resolve("pdfjs-dist/package.json"));
}

function textoDePagina(contenido) {
  const items = (contenido.items || []).filter((it) => typeof it.str === "string");
  const lineas = [];
  let actual = null;
  for (const it of items) {
    if (!it.str) {
      if (it.hasEOL && actual) {
        lineas.push(actual);
        actual = null;
      }
      continue;
    }
    const y = it.transform?.[5] ?? 0;
    const alto = Math.abs(it.transform?.[3] || it.height || 10) || 10;
    if (!actual || Math.abs(actual.y - y) > alto * 0.5) {
      if (actual) lineas.push(actual);
      actual = { y, alto, texto: "" };
    }
    actual.texto += it.str;
    if (it.hasEOL) {
      lineas.push(actual);
      actual = null;
    }
  }
  if (actual) lineas.push(actual);
  const salida = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const previa = lineas[i - 1];
    if (previa && previa.y - l.y > l.alto * 1.8) salida.push("");
    salida.push(l.texto.replace(/\s+/g, " ").trim());
  }
  return salida.join("\n");
}

async function imagenMayor(pagina, lib) {
  const ops = await pagina.getOperatorList();
  let mejor = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== lib.OPS.paintImageXObject && ops.fnArray[i] !== lib.OPS.paintInlineImageXObject) continue;
    const arg = ops.argsArray[i][0];
    let img = arg;
    if (typeof arg === "string") {
      img = await new Promise((resolve) => {
        const fuente = arg.startsWith("g_") ? pagina.commonObjs : pagina.objs;
        try {
          fuente.get(arg, resolve);
        } catch {
          resolve(null);
        }
      });
    }
    if (img && img.width * img.height > (mejor ? mejor.width * mejor.height : 0)) mejor = img;
  }
  return mejor;
}

// Un PDF con contraseña no se puede leer: se dice cómo abrirlo en vez del
// error crudo de pdfjs.
export const AVISO_CLAVE = "Ese PDF tiene contraseña. Ábralo primero en Herramientas PDF, Desbloquear, y desde ahí llévelo al contexto.";

function errorClave() {
  const error = new Error(AVISO_CLAVE);
  error.codigo = "clave";
  return error;
}

export async function convertirPdf(datos, { datosDir, forzarOcr = false, onProgreso, senal, lectorOcr, maxPaginasOcr = MAX_PAGINAS_OCR } = {}) {
  const lib = await cargarPdfjs();
  const base = carpetaPdfjs();
  const tarea = lib.getDocument({
    data: new Uint8Array(datos),
    cMapUrl: `${path.join(base, "cmaps")}${path.sep}`,
    cMapPacked: true,
    standardFontDataUrl: `${path.join(base, "standard_fonts")}${path.sep}`,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  // Sin onPassword, pdfjs rechaza con PasswordException: no hay a quién pedirla.
  let doc;
  try {
    doc = await tarea.promise;
  } catch (error) {
    if (error?.name === "PasswordException" || /password/i.test(String(error?.message || ""))) throw errorClave();
    throw error;
  }
  const total = doc.numPages;
  const paginas = [];
  const sinTexto = [];
  try {
    for (let n = 1; n <= total; n++) {
      revisar(senal);
      onProgreso?.({ fase: "leyendo", pagina: n, total });
      const pagina = await doc.getPage(n);
      const texto = textoDePagina(await pagina.getTextContent());
      paginas.push(texto);
      if (forzarOcr || necesitaOcr(texto)) sinTexto.push(n);
      pagina.cleanup();
    }
    let paginasOcr = 0;
    let avisoOcr = "";
    const tope = Math.max(0, Number.isFinite(Number(maxPaginasOcr)) ? Number(maxPaginasOcr) : MAX_PAGINAS_OCR);
    const pendientes = sinTexto.length;
    if (sinTexto.length > tope) sinTexto.splice(tope);
    const avisoTope = avisoTopeOcr(sinTexto.length, pendientes);
    if (sinTexto.length) {
      const estado = estadoOcr(datosDir);
      if (!estado.listo && !lectorOcr) {
        avisoOcr = AVISO_OCR;
      } else {
        const lector = lectorOcr || (await crearLectorOcr(datosDir));
        try {
          let i = 0;
          for (const n of sinTexto) {
            revisar(senal);
            onProgreso?.({ fase: "ocr", pagina: ++i, total: sinTexto.length, paginaPdf: n });
            const pagina = await doc.getPage(n);
            const img = await imagenMayor(pagina, lib);
            const png = pngDeImagenPdf(img);
            if (!png) continue;
            const { texto } = await lector.reconocer(png);
            if (texto.trim() && (forzarOcr || calidadTexto(texto) >= calidadTexto(paginas[n - 1]))) {
              paginas[n - 1] = texto;
              paginasOcr++;
            }
            pagina.cleanup();
          }
        } finally {
          if (!lectorOcr) await lector.cerrar();
        }
      }
    }
    const limpias = quitarRepetidos(paginas);
    const md = limpias.map((p, i) => `${marcaPagina(i + 1)}\n\n${limpiarTexto(p)}`).join("\n\n");
    const vacias = limpias.filter((p) => necesitaOcr(p)).length;
    return {
      markdown: md,
      motor: paginasOcr ? "pdfjs+tesseract" : "pdfjs",
      paginas: total,
      paginasOcr,
      calidad: calidadTexto(limpias.join("\n")),
      aviso: [vacias ? (avisoOcr || `${vacias} de ${total} páginas quedaron sin texto legible.`) : "", avisoOcr ? "" : avisoTope].filter(Boolean).join(" "),
      paginasSinOcr: pendientes - sinTexto.length,
    };
  } finally {
    await doc.destroy();
  }
}

// ---------- Imagen ----------

export async function convertirImagen(datos, { datosDir, onProgreso, senal, lectorOcr } = {}) {
  if (!lectorOcr && !estadoOcr(datosDir).listo) {
    const error = new Error(AVISO_OCR);
    error.codigo = "sin-ocr";
    throw error;
  }
  revisar(senal);
  onProgreso?.({ fase: "ocr", pagina: 1, total: 1 });
  const lector = lectorOcr || (await crearLectorOcr(datosDir));
  try {
    const { texto } = await lector.reconocer(datos);
    return { markdown: `${marcaPagina(1)}\n\n${limpiarTexto(texto)}`, motor: "tesseract", paginas: 1, paginasOcr: 1, calidad: calidadTexto(texto), aviso: "" };
  } finally {
    if (!lectorOcr) await lector.cerrar();
  }
}

// ---------- HTML, Word, hojas, texto ----------

let turndown;
export function htmlAMarkdown(html) {
  if (!turndown) {
    const Turndown = require("turndown");
    turndown = new Turndown({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*" });
    turndown.remove(["script", "style", "noscript", "iframe", "img"]);
    // Enlaces relativos de la relatoría no sirven fuera del sitio: queda el texto.
    turndown.addRule("enlaceRelativo", {
      filter: (n) => n.nodeName === "A" && !/^https?:/i.test(n.getAttribute("href") || ""),
      replacement: (contenido) => contenido,
    });
  }
  return turndown.turndown(String(html || "")).replace(/\n{3,}/g, "\n\n").trim();
}

export async function convertirDocx(datos) {
  const mammoth = require("mammoth");
  const { value, messages } = await mammoth.convertToHtml({ buffer: Buffer.from(datos) });
  const md = htmlAMarkdown(value);
  const avisos = (messages || []).filter((m) => m.type === "error").length;
  return { markdown: md, motor: "mammoth", paginas: 0, paginasOcr: 0, calidad: calidadTexto(md), aviso: avisos ? "Parte del formato del Word no se pudo leer." : "" };
}

export function convertirHoja(datos, { maxFilas = 2000, csv = false } = {}) {
  const XLSX = require("xlsx");
  const libro = csv
    ? XLSX.read(Buffer.from(datos).toString("utf8").replace(/^\uFEFF/, ""), { type: "string", raw: true })
    : XLSX.read(Buffer.from(datos), { type: "buffer", cellDates: true, dense: true });
  const partes = [];
  for (const nombre of libro.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: false, defval: "" });
    const tabla = tablaMarkdown(filas, { maxFilas });
    if (!tabla) continue;
    partes.push(csv ? tabla : `## ${nombre}\n\n${tabla}`);
  }
  const md = partes.join("\n\n");
  return { markdown: md, motor: "sheetjs", paginas: 0, paginasOcr: 0, calidad: md ? 1 : 0, aviso: md ? "" : "La hoja está vacía." };
}

function decodificarTexto(datos) {
  const buf = Buffer.from(datos);
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  return buf.toString("latin1");
}

// ---------- Entrada única ----------

export async function convertirDatos(datos, nombre, opciones = {}) {
  const ext = extensionDe(nombre);
  if (ext === "pdf") return convertirPdf(datos, opciones);
  if (IMAGENES.has(ext)) return convertirImagen(datos, opciones);
  if (ext === "docx") return convertirDocx(datos);
  if (["xlsx", "xls", "ods"].includes(ext)) return convertirHoja(datos, opciones);
  if (ext === "csv") return convertirHoja(datos, { ...opciones, csv: true });
  if (ext === "html" || ext === "htm") {
    const md = htmlAMarkdown(decodificarTexto(datos));
    return { markdown: md, motor: "turndown", paginas: 0, paginasOcr: 0, calidad: calidadTexto(md), aviso: "" };
  }
  if (ext === "txt") {
    const t = decodificarTexto(datos);
    return { markdown: limpiarTexto(t), motor: "texto", paginas: 0, paginasOcr: 0, calidad: calidadTexto(t), aviso: "" };
  }
  if (ext === "md") {
    const t = decodificarTexto(datos).normalize("NFC");
    return { markdown: t.trim(), motor: "markdown", paginas: 0, paginasOcr: 0, calidad: calidadTexto(t), aviso: "" };
  }
  const error = new Error("Ese tipo de archivo todavía no se puede convertir. Use PDF, imagen, Word (.docx), Excel, CSV, HTML, TXT o MD.");
  error.codigo = "tipo";
  throw error;
}

export async function convertirRuta(ruta, opciones = {}) {
  return convertirDatos(fs.readFileSync(ruta), path.basename(ruta), opciones);
}

export { VERSION_CONVERSOR, aqui as carpetaConvertidores, pathToFileURL };
