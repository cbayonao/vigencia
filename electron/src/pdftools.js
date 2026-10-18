// Herramientas PDF, todo en este computador con pdf-lib (JS puro, sin
// nativos ni internet): unir, separar por páginas, rotar, firmar con
// imagen dibujada, comprimir imágenes y proteger/desbloquear (AES-256
// propio en pdfcifrado.js). Lo que pdf-lib no hace (cifrar ya está;
// pasar a Office vive en Convertir) no se ofrece.
import fs from "node:fs";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, degrees } from "pdf-lib";
import { Aviso } from "./db.js";
import { cajaFirma } from "../compartido/pdftools.js";

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
    if (/encrypt/i.test(String(error?.message || ""))) throw new Aviso("Ese PDF tiene contraseña y no se puede abrir.");
    throw new Aviso("Ese PDF está dañado o no se pudo leer.");
  }
}

export function paginasDe(doc) {
  return doc.getPageIndices().map((i) => {
    const p = doc.getPage(i);
    return { numero: i + 1, ancho: p.getWidth(), alto: p.getHeight() };
  });
}

export async function infoPdf(ruta) {
  const doc = await cargar(ruta);
  return { paginas: doc.getPageCount(), detalle: paginasDe(doc) };
}

export async function unirPdfs(rutas) {
  const lista = (rutas || []).filter(Boolean);
  if (lista.length < 2) throw new Aviso("Elija al menos 2 PDF para unir.");
  if (lista.length > 50) throw new Aviso("Máximo 50 PDF por unión.");
  const salida = await PDFDocument.create();
  let total = 0;
  for (const ruta of lista) {
    const doc = await cargar(ruta);
    const copiadas = await salida.copyPages(doc, doc.getPageIndices());
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
  const giro = Number(angulo);
  if (![90, 180, 270].includes(giro)) throw new Aviso("El giro es 90, 180 o 270 grados.");
  const doc = await cargar(ruta);
  const cuales = indices?.length ? indices : doc.getPageIndices();
  for (const i of cuales) {
    if (i < 0 || i >= doc.getPageCount()) throw new Aviso("Esas páginas se salen del documento.");
    const pagina = doc.getPage(i);
    const actual = pagina.getRotation().angle;
    pagina.setRotation(degrees((actual + giro) % 360));
  }
  return Buffer.from(await doc.save());
}

export async function firmarPdf(ruta, pngBase64, { paginas, posicion, ancho }) {
  const limpio = String(pngBase64 || "").replace(/^data:image\/\w+;base64,/, "").trim();
  if (!limpio) throw new Aviso("Dibuje primero su firma.");
  let imagen;
  try {
    imagen = Buffer.from(limpio, "base64");
  } catch {
    throw new Aviso("Esa firma no se pudo leer.");
  }
  const doc = await cargar(ruta);
  let embebida;
  try {
    embebida = await doc.embedPng(imagen);
  } catch {
    throw new Aviso("Esa firma no es un PNG válido.");
  }
  const naturales = embebida.scale(1);
  const cuales = paginas?.length ? paginas : [doc.getPageCount() - 1];
  for (const i of cuales) {
    if (i < 0 || i >= doc.getPageCount()) throw new Aviso("Esa página se sale del documento.");
    const pagina = doc.getPage(i);
    const caja = cajaFirma(posicion, { width: pagina.getWidth(), height: pagina.getHeight() }, Number(ancho) || 150, naturales.width ? (naturales.height * (Number(ancho) || 150)) / naturales.width : 50);
    pagina.drawImage(embebida, { x: caja.x, y: caja.y, width: caja.w, height: caja.h });
  }
  return Buffer.from(await doc.save());
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
export async function camposPdf(ruta) {
  const doc = await cargar(ruta);
  let form;
  try {
    form = doc.getForm();
  } catch {
    throw new Aviso("Ese PDF no tiene formulario para rellenar.");
  }
  const campos = form.getFields().map((f) => {
    const tipo = f.constructor.name;
    const base = { nombre: f.getName(), tipo: "texto" };
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
    try {
      actual = f.getText() || "";
    } catch {
      actual = "";
    }
    return { ...base, actual };
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
      throw new Aviso(`El campo “${nombre}” no aceptó ese valor.`);
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
