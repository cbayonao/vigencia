// Herramientas PDF, todo en este computador con pdf-lib (JS puro, sin
// nativos ni internet): unir, separar por páginas, rotar, firmar con
// imagen dibujada, comprimir imágenes y proteger/desbloquear (AES-256
// propio en pdfcifrado.js). Lo que pdf-lib no hace (cifrar ya está;
// pasar a Office vive en Convertir) no se ofrece.
//
// Firmar es firma electrónica (Ley 527 de 1999, art. 7, y Decreto 2364 de
// 2012): imagen visible donde el usuario la pone + constancia final con el
// hash del contenido, el firmante y la fecha. No es firma digital con
// certificado (esa da presunción legal, art. 28, y pide entidad
// acreditada): aquí la prueba la guarda el acta.
import crypto from "node:crypto";
import fs from "node:fs";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, degrees, rgb } from "pdf-lib";
import { Aviso, filas, run, uno } from "./db.js";
import { ahora } from "../compartido/logica.js";
import { cajaAPdf, giroNormal, lineaDeTexto } from "../compartido/pdftools.js";
import { AVISO_CLAVE } from "./convertir/convertidores.js";

function leerPdf(ruta) {
  let datos;
  try {
    datos = fs.readFileSync(ruta);
  } catch {
    throw new Aviso("No pude leer ese PDF.");
  }
  if (datos.length < 5 || datos.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Aviso("Ese archivo no es un PDF válido.");
  }
  return datos;
}

async function cargar(ruta) {
  let datos;
  try {
    datos = leerPdf(ruta);
  } catch (error) {
    if (error instanceof Aviso) throw error;
    throw new Aviso("No pude leer ese PDF.");
  }
  try {
    return await PDFDocument.load(datos, { ignoreEncryption: false });
  } catch (error) {
    if (/encrypt/i.test(String(error?.message || ""))) throw new Aviso(AVISO_CLAVE);
    throw new Aviso("Ese PDF está dañado o no se pudo leer.");
  }
}

// Lo que se ve de la página: CropBox dentro de la MediaBox (como pdfjs) y
// el giro /Rotate. Es la "pagina" de cajaAPdf en compartido/pdftools.js.
export function geometriaPagina(p) {
  const m = p.getMediaBox();
  const c = p.getCropBox();
  const x0 = Math.max(m.x, c.x);
  const y0 = Math.max(m.y, c.y);
  const x1 = Math.min(m.x + m.width, c.x + c.width);
  const y1 = Math.min(m.y + m.height, c.y + c.height);
  const caja = x1 > x0 && y1 > y0 ? { x0, y0, ancho: x1 - x0, alto: y1 - y0 } : { x0: m.x, y0: m.y, ancho: m.width, alto: m.height };
  return { ...caja, rotacion: giroNormal(p.getRotation().angle) };
}

export function paginasDe(doc) {
  return doc.getPageIndices().map((i) => ({ numero: i + 1, ...geometriaPagina(doc.getPage(i)) }));
}

export async function infoPdf(ruta) {
  const doc = await cargar(ruta);
  return { paginas: doc.getPageCount(), detalle: paginasDe(doc) };
}

// entradas: rutas, o { ruta, indices } para tomar solo esas páginas (desde 0,
// en ese orden).
export async function unirPdfs(entradas) {
  const lista = (entradas || []).map((e) => (typeof e === "string" ? { ruta: e } : e)).filter((e) => e?.ruta);
  if (lista.length < 2) throw new Aviso("Elija al menos 2 PDF para unir.");
  if (lista.length > 50) throw new Aviso("Máximo 50 PDF por unión.");
  const salida = await PDFDocument.create();
  let total = 0;
  for (const { ruta, indices } of lista) {
    const doc = await cargar(ruta);
    const elegidas = Array.isArray(indices) ? indices.map(Number) : doc.getPageIndices();
    for (const i of elegidas) {
      if (!Number.isInteger(i) || i < 0 || i >= doc.getPageCount()) throw new Aviso("Esas páginas se salen del documento.");
    }
    const copiadas = await salida.copyPages(doc, elegidas);
    for (const p of copiadas) salida.addPage(p);
    total += copiadas.length;
  }
  if (!total) throw new Aviso("Esos PDF no tienen páginas.");
  return Buffer.from(await salida.save());
}

export async function separarPdf(ruta, indices) {
  if (!indices?.length) throw new Aviso("Elija al menos una página.");
  const doc = await cargar(ruta);
  for (const i of indices) {
    if (i < 0 || i >= doc.getPageCount()) throw new Aviso("Esas páginas se salen del documento.");
  }
  const salida = await PDFDocument.create();
  for (const p of await salida.copyPages(doc, [...indices])) salida.addPage(p);
  return Buffer.from(await salida.save());
}

export async function rotarPdf(ruta, indices, angulo) {
  const doc = await cargar(ruta);
  const cuales = indices?.length ? indices : doc.getPageIndices();
  return rotarPaginas(ruta, Object.fromEntries(cuales.map((i) => [i, angulo])), doc);
}

// giros: { índice desde 0: 90 | 180 | 270 }, cada página con su giro.
export async function rotarPaginas(ruta, giros, cargado = null) {
  const lista = Object.entries(giros || {});
  if (!lista.length) throw new Aviso("No hay páginas giradas.");
  const doc = cargado || (await cargar(ruta));
  for (const [clave, angulo] of lista) {
    const i = Number(clave);
    const giro = Number(angulo);
    if (![90, 180, 270].includes(giro)) throw new Aviso("El giro es 90, 180 o 270 grados.");
    if (!Number.isInteger(i) || i < 0 || i >= doc.getPageCount()) throw new Aviso("Esas páginas se salen del documento.");
    const pagina = doc.getPage(i);
    pagina.setRotation(degrees((pagina.getRotation().angle + giro) % 360));
  }
  return Buffer.from(await doc.save());
}

const MAX_MARCAS = 300;
const MAX_IMAGEN = 500 * 1024;

async function embeberImagen(doc, base64) {
  // Copia propia: pdf-lib lee el JPG sin mirar byteOffset y los Buffer
  // pequeños de Node viven dentro de un bloque compartido.
  const datos = new Uint8Array(Buffer.from(String(base64 || "").replace(/^data:image\/\w+;base64,/, "").trim(), "base64"));
  if (!datos.length) throw new Aviso("Una de las firmas está vacía.");
  if (datos.length > MAX_IMAGEN) throw new Aviso("Esa imagen de firma pesa demasiado (máximo 500 KB).");
  try {
    return await doc.embedPng(datos);
  } catch {
    try {
      return await doc.embedJpg(datos);
    } catch {
      throw new Aviso("Esa firma no es una imagen PNG o JPG válida.");
    }
  }
}

// Helvetica estándar solo sabe WinAnsi (español sí, emojis no).
function textoWinAnsi(t) {
  return String(t || "").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

// Firmar: cada marca es una firma (imagen) o un texto puesto en la página
// tal como se ve (ver cajaAPdf). La constancia es opcional (encendida en
// la ventana por defecto) y solo con ella hace falta quien firma.
export async function firmarPdf(ruta, { imagenes = [], marcas = [], constancia = true, firmante } = {}) {
  const lista = Array.isArray(marcas) ? marcas : [];
  if (!lista.length) throw new Aviso("Ponga primero al menos una firma o un texto sobre la página.");
  if (lista.length > MAX_MARCAS) throw new Aviso(`Son demasiadas marcas (máximo ${MAX_MARCAS}).`);
  if ((imagenes || []).length > 20) throw new Aviso("Use máximo 20 firmas distintas.");
  const quien = constancia ? textoFirmante(firmante) : null;
  const doc = await cargar(ruta);
  const embebidas = [];
  for (const base64 of imagenes || []) embebidas.push(await embeberImagen(doc, base64));
  let fuente = null;
  const tocadas = new Set();
  for (const m of lista) {
    const i = Number(m?.pagina) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= doc.getPageCount()) throw new Aviso("Esa página se sale del documento.");
    if (![m.x, m.y, m.w, m.h].every(Number.isFinite) || m.w <= 0 || m.h <= 0) throw new Aviso("Una marca quedó sin tamaño.");
    const pagina = doc.getPage(i);
    const geo = geometriaPagina(pagina);
    if (m.tipo === "texto") {
      const texto = textoWinAnsi(m.texto);
      if (!texto) continue;
      const { tamano, base } = lineaDeTexto(m);
      fuente ||= await doc.embedFont(StandardFonts.Helvetica);
      const b = cajaAPdf(base, geo);
      pagina.drawText(texto, { x: b.x, y: b.y, size: Math.min(96, Math.max(4, tamano)), font: fuente, color: rgb(0.05, 0.05, 0.05), rotate: degrees(b.giro) });
    } else {
      const imagen = embebidas[Number(m.imagen)];
      if (!imagen) throw new Aviso("Falta la imagen de una de las firmas.");
      const b = cajaAPdf(m, geo);
      pagina.drawImage(imagen, { x: b.x, y: b.y, width: b.w, height: b.h, rotate: degrees(b.giro) });
    }
    tocadas.add(i + 1);
  }
  const paginas = [...tocadas].sort((a, b) => a - b);
  if (!constancia) return { bytes: Buffer.from(await doc.save()), codigo: "", paginas };
  const hashContenido = await huellaContenido(doc, false);
  const codigo = hashContenido.slice(0, 12).toUpperCase();
  const fecha = ahora();
  agregarConstancia(doc, { codigo, hashContenido, firmante: quien, paginas, fecha });
  doc.setKeywords([`VIGENCIA-FIRMA codigo=${codigo} hash=${hashContenido}`]);
  const final = Buffer.from(await doc.save());
  return { bytes: final, codigo, hashContenido, hashFinal: sha(final), paginas, fecha };
}

function sha(datos) {
  return crypto.createHash("sha256").update(datos).digest("hex");
}

// Huella del contenido: copia normalizada de las páginas (sin metadatos
// ni la constancia) guardada siempre igual. Firmar y verificar usan el
// mismo camino, así el hash coincide aunque pdf-lib reordene objetos.
async function huellaContenido(doc, excluirUltima) {
  const indices = excluirUltima ? doc.getPageIndices().slice(0, -1) : doc.getPageIndices();
  // Sin metadatos: create() pone la hora de ahora y la huella cambiaba de
  // un segundo a otro (Verificar decía alterado a todo firmado).
  const copia = await PDFDocument.create({ updateMetadata: false });
  const paginas = await copia.copyPages(doc, indices);
  for (const p of paginas) copia.addPage(p);
  return sha(Buffer.from(await copia.save({ useObjectStreams: false })));
}

function textoFirmante(firmante = {}) {
  const nombre = String(firmante?.nombre || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!nombre) throw new Aviso("Escriba quién firma (nombre del firmante).");
  const documento = String(firmante?.documento || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return { nombre, documento };
}

// Constancia de firma electrónica (Decreto 2364 de 2012): última página
// del PDF con quién firmó, cuándo, qué páginas y el hash del contenido.
// Quien verifica quita esta página y compara el hash.
function agregarConstancia(doc, { codigo, hashContenido, firmante, paginas, fecha }) {
  const W = 612;
  const H = 792;
  const pagina = doc.addPage([W, H]);
  const tinta = rgb(0.09, 0.16, 0.23);
  const gris = rgb(0.35, 0.35, 0.35);
  const linea = (texto, x, y, tamano = 11, color = tinta) => {
    pagina.drawText(String(texto).slice(0, 95), { x, y, size: tamano, color });
  };
  let y = H - 70;
  pagina.drawText("CONSTANCIA DE FIRMA ELECTRÓNICA", { x: 60, y, size: 16, color: tinta });
  y -= 22;
  pagina.drawText("Vigencia. Ley 527 de 1999 (art. 7) y Decreto 2364 de 2012", { x: 60, y, size: 10, color: gris });
  y -= 30;
  linea(`Código de verificación: ${codigo}`, 60, y, 12);
  y -= 24;
  linea(`Firmante: ${firmante.nombre}${firmante.documento ? `, documento ${firmante.documento}` : ""}`, 60, y);
  y -= 20;
  linea(`Fecha de firma: ${fechaCortaActa(fecha)}`, 60, y);
  y -= 20;
  linea(`Páginas firmadas: ${paginas.join(", ")}`, 60, y);
  y -= 20;
  linea(`Hash SHA-256 del contenido firmado:`, 60, y);
  y -= 18;
  pagina.drawText(hashContenido.slice(0, 48), { x: 60, y, size: 9, color: tinta });
  y -= 16;
  pagina.drawText(hashContenido.slice(48), { x: 60, y, size: 9, color: tinta });
  y -= 30;
  const declaracion = [
    "El firmante declara que aprueba el contenido de este documento",
    "y que los datos de creación de su firma le corresponden",
    "exclusivamente (Decreto 2364 de 2012, art. 4). Cualquier",
    "alteración posterior del contenido cambia el hash y se detecta",
    "al verificar en Herramientas PDF, Firmar, Verificar.",
  ];
  for (const t of declaracion) {
    linea(t, 60, y, 10, gris);
    y -= 16;
  }
  y -= 10;
  const nota = [
    "Esta constancia es firma electrónica, no firma digital con",
    "certificado: para la presunción del art. 28 de la Ley 527 se",
    "requiere certificado de una entidad acreditada (Certicámara,",
    "Andes SCD, GSE).",
  ];
  for (const t of nota) {
    linea(t, 60, y, 10, gris);
    y -= 16;
  }
}

function fechaCortaActa(marca) {
  const t = String(marca || "");
  return t ? `${t.slice(0, 10)} ${t.slice(11, 16)}` : "";
}

// Verificar: lee el código y el hash de los metadatos, reconstruye el
// contenido sin la constancia y compara. No necesita internet.
export async function verificarPdf(ruta, db = null) {
  const datos = leerPdf(ruta);
  let doc;
  try {
    doc = await PDFDocument.load(datos, { ignoreEncryption: false });
  } catch (error) {
    if (/encrypt/i.test(String(error?.message || ""))) throw new Aviso("Ese PDF tiene contraseña y no se puede verificar.");
    throw new Aviso("Ese PDF está dañado o no se pudo leer.");
  }
  const claves = typeof doc.getKeywords === "function" ? String(doc.getKeywords() || "") : "";
  const m = claves.match(/VIGENCIA-FIRMA\s+codigo=([0-9A-F]{12})\s+hash=([0-9a-f]{64})/);
  if (!m) throw new Aviso("Ese PDF no trae constancia de Vigencia. Solo se verifican los firmados aquí.");
  if (doc.getPageCount() < 2) throw new Aviso("Ese PDF no trae la página de constancia.");
  const hash = await huellaContenido(doc, true);
  const integro = hash === m[2];
  const acta = db ? uno(db, "SELECT * FROM firma_acta WHERE codigo = ?", [m[1]]) : null;
  return {
    integro,
    codigo: m[1],
    hash,
    esperado: m[2],
    firmante: acta?.firmante || "",
    documento: acta?.documento || "",
    fecha: acta?.fecha || "",
    paginas: acta?.paginas || "",
    enRegistro: Boolean(acta),
  };
}

// ---------- Firmas guardadas y actas (solo este computador) ----------

function exigirDb(db) {
  if (!db) throw new Aviso("La base no está lista.");
}

export function listarFirmas(db) {
  exigirDb(db);
  return filas(db, "SELECT id, nombre, png, creado_en FROM firma_perfil ORDER BY id").map((f) => ({
    id: Number(f.id),
    nombre: f.nombre,
    png: f.png,
    creado_en: f.creado_en,
  }));
}

function nombreFirma(nombre) {
  const limpio = String(nombre || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (limpio.length < 2) throw new Aviso("Póngale un nombre a la firma (mínimo 2 letras).");
  return limpio;
}

function exigirFirma(db, id) {
  if (!uno(db, "SELECT id FROM firma_perfil WHERE id = ?", [Number(id) || 0])) throw new Aviso("Esa firma ya no está.");
  return Number(id);
}

export function renombrarFirma(db, id, nombre) {
  exigirDb(db);
  const limpio = nombreFirma(nombre);
  run(db, "UPDATE firma_perfil SET nombre = ? WHERE id = ?", [limpio, exigirFirma(db, id)]);
  return { id: Number(id), nombre: limpio };
}

export function guardarFirma(db, { nombre, png }) {
  exigirDb(db);
  const limpio = nombreFirma(nombre);
  const datos = String(png || "").replace(/^data:image\/\w+;base64,/, "").trim();
  if (!datos) throw new Aviso("Dibuje, suba o escriba primero su firma.");
  if (datos.length > 400000) throw new Aviso("Esa imagen pesa demasiado para guardarla.");
  if (Number(uno(db, "SELECT COUNT(*) AS n FROM firma_perfil").n) >= 20) throw new Aviso("Ya tiene 20 firmas guardadas. Borre una primero.");
  const r = run(db, "INSERT INTO firma_perfil (nombre, png, creado_en) VALUES (?, ?, ?)", [limpio, datos, ahora()]);
  return { id: Number(r.lastInsertRowid), nombre: limpio };
}

export function borrarFirma(db, id) {
  exigirDb(db);
  run(db, "DELETE FROM firma_perfil WHERE id = ?", [exigirFirma(db, id)]);
  return {};
}

export function guardarActa(db, { codigo, fecha, firmante, documento, hashContenido, hashFinal, paginas, pdfNombre }) {
  exigirDb(db);
  run(db, `INSERT OR IGNORE INTO firma_acta (codigo, fecha, firmante, documento, hash_contenido, hash_final, paginas, pdf_nombre, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    codigo, fecha, firmante || "", documento || "", hashContenido || "", hashFinal || "",
    (paginas || []).join(", "), String(pdfNombre || "").slice(0, 120), ahora(),
  ]);
  return {};
}

export const NIVELES_COMPRIMIR = [
  { id: "alta", nombre: "Alta calidad", escala: 1, calidad: 80 },
  { id: "media", nombre: "Media (recomendada)", escala: 0.7, calidad: 65 },
  { id: "baja", nombre: "Máxima compresión", escala: 0.5, calidad: 50 },
];

// Comprimir: re-muestrea las fotos JPEG del PDF (lo que más pesa) sin
// tocar texto ni vectores. Informa cuántas tocó.
export async function comprimirPdf(ruta, nivelId = "media") {
  const nivel = NIVELES_COMPRIMIR.find((n) => n.id === nivelId) || NIVELES_COMPRIMIR[1];
  const { default: jpeg } = await import("jpeg-js");
  const doc = await cargar(ruta);
  let tocadas = 0;
  let intactas = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (String(obj.dict.get(PDFName.of("Subtype")) || "") !== "/Image") continue;
    if (String(obj.dict.get(PDFName.of("Filter")) || "") !== "/DCTDecode") continue;
    let dec;
    try {
      dec = jpeg.decode(Buffer.from(obj.contents));
    } catch {
      intactas += 1;
      continue;
    }
    const w2 = Math.max(1, Math.round(dec.width * nivel.escala));
    const h2 = Math.max(1, Math.round(dec.height * nivel.escala));
    if (w2 >= dec.width && nivel.calidad >= 85) {
      intactas += 1;
      continue;
    }
    const sal = Buffer.alloc(w2 * h2 * 4);
    for (let y = 0; y < h2; y += 1) {
      for (let x = 0; x < w2; x += 1) {
        const sx = Math.min(dec.width - 1, Math.floor((x * dec.width) / w2));
        const sy = Math.min(dec.height - 1, Math.floor((y * dec.height) / h2));
        const s = (sy * dec.width + sx) * 4;
        const d = (y * w2 + x) * 4;
        sal[d] = dec.data[s];
        sal[d + 1] = dec.data[s + 1];
        sal[d + 2] = dec.data[s + 2];
        sal[d + 3] = 255;
      }
    }
    const nuevo = jpeg.encode({ data: sal, width: w2, height: h2 }, nivel.calidad);
    obj.contents = nuevo.data;
    obj.dict.set(PDFName.of("Width"), PDFNumber.of(w2));
    obj.dict.set(PDFName.of("Height"), PDFNumber.of(h2));
    tocadas += 1;
  }
  return { bytes: Buffer.from(await doc.save({ useObjectStreams: false })), tocadas, intactas, nivel: nivel.nombre };
}

// Rellenar formularios: lista los campos (texto, casilla, lista, firma)
// para pintarlos en la ventana; luego aplica los valores y aplana.
// Dónde se ve cada campo: su /Rect en el espacio del PDF y la página
// (desde 1). En opciones y casillas cada caja lleva el valor que marca.
function cajasDeCampo(doc, campo, paginas) {
  const salida = [];
  let widgets = [];
  try {
    widgets = campo.acroField.getWidgets();
  } catch {
    return salida;
  }
  for (const w of widgets) {
    let indice = paginas.get(w.P());
    if (indice == null) {
      const ref = doc.context.getObjectRef(w.dict);
      indice = doc.getPages().findIndex((p) => p.node.Annots()?.asArray().some((a) => a === ref));
    }
    if (indice == null || indice < 0) continue;
    const r = w.getRectangle();
    if (!(r.width > 0 && r.height > 0)) continue;
    let valor = "";
    try {
      valor = w.getOnValue()?.decodeText() || "";
    } catch {
      valor = "";
    }
    salida.push({ pagina: indice + 1, x: r.x, y: r.y, w: r.width, h: r.height, valor });
  }
  return salida;
}

export async function camposPdf(ruta) {
  const doc = await cargar(ruta);
  let form;
  try {
    form = doc.getForm();
  } catch {
    throw new Aviso("Ese PDF no tiene formulario para rellenar.");
  }
  const paginas = new Map(doc.getPages().map((p, i) => [p.ref, i]));
  const campos = form.getFields().map((f) => {
    const tipo = f.constructor.name;
    const base = { nombre: f.getName(), tipo: "texto", cajas: cajasDeCampo(doc, f, paginas) };
    if (tipo === "PDFCheckBox") return { ...base, tipo: "casilla" };
    if (tipo === "PDFRadioGroup") {
      let opciones = [];
      try {
        opciones = f.getOptions();
      } catch {
        opciones = [];
      }
      return { ...base, tipo: "opcion", opciones };
    }
    if (tipo === "PDFDropdown" || tipo === "PDFListBox") {
      let opciones = [];
      let actual = "";
      try {
        opciones = f.getOptions();
        actual = f.getSelected()?.[0] || "";
      } catch {
        opciones = [];
      }
      return { ...base, tipo: tipo === "PDFDropdown" ? "lista" : "lista-multiple", opciones, actual };
    }
    if (tipo === "PDFSignature") return { ...base, tipo: "firma-digital" };
    let actual = "";
    let multilinea = false;
    try {
      actual = f.getText() || "";
      multilinea = Boolean(f.isMultiline?.());
    } catch {
      actual = "";
    }
    return { ...base, actual, multilinea };
  });
  if (!campos.length) throw new Aviso("Ese PDF no tiene campos para rellenar.");
  return { campos, total: campos.length };
}

export async function rellenarPdf(ruta, valores, { aplanar = true } = {}) {
  const doc = await cargar(ruta);
  let form;
  try {
    form = doc.getForm();
  } catch {
    throw new Aviso("Ese PDF no tiene formulario para rellenar.");
  }
  const mapa = valores && typeof valores === "object" ? valores : {};
  for (const f of form.getFields()) {
    const nombre = f.getName();
    if (!(nombre in mapa)) continue;
    const tipo = f.constructor.name;
    const valor = mapa[nombre];
    try {
      if (tipo === "PDFCheckBox") {
        if (valor) f.check();
        else f.uncheck();
      } else if (tipo === "PDFRadioGroup") {
        if (valor) f.select(String(valor));
      } else if (tipo === "PDFDropdown" || tipo === "PDFListBox") {
        if (Array.isArray(valor)) f.select(valor.map(String));
        else if (valor) f.select([String(valor)]);
        else f.clear();
      } else if (tipo === "PDFTextField") {
        f.setText(String(valor ?? ""));
      }
    } catch {
      throw new Aviso(`El campo ${nombre} no aceptó ese valor.`);
    }
  }
  if (aplanar) {
    try {
      form.flatten();
    } catch {
      throw new Aviso("No pude aplanar el formulario.");
    }
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
