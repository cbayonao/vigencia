import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import jpeg from "jpeg-js";
import { PDFDocument } from "pdf-lib";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { TEXTO_ALTO, TEXTO_BAJA, cajaAPdf, fechaHoy, giroNormal, lineaDeTexto, puntoAPdf, tamanoVista } from "../compartido/pdftools.js";
import { borrarFirma, firmarPdf, geometriaPagina, guardarFirma, listarFirmas, renombrarFirma, verificarPdf } from "../src/pdftools.js";
import { protegerPdf } from "../src/pdfproteger.js";
import { registrarPdftools } from "../src/pdftools-ipc.js";
import { abrirBase } from "../src/db.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64").toString("base64");
const JPG = Buffer.from(jpeg.encode({ width: 2, height: 1, data: Buffer.alloc(8, 255) }, 90).data).toString("base64");

function temporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vig-firma-"));
}

// Página de 500 x 700 con CropBox corrida (50, 30) de 400 x 600 y giro.
async function pdfGirado(dir, giros) {
  const doc = await PDFDocument.create();
  for (const g of giros) {
    const p = doc.addPage([500, 700]);
    p.setCropBox(50, 30, 400, 600);
    p.setRotation({ type: "degrees", angle: g });
  }
  const ruta = path.join(dir, `girado-${giros.join("-")}.pdf`);
  fs.writeFileSync(ruta, await doc.save());
  return ruta;
}

test("de la pantalla al PDF: giros 0, 90, 180 y 270, CropBox corrida y zoom", () => {
  const pagina = { x0: 50, y0: 30, ancho: 400, alto: 600 };
  // En pantalla a zoom 2: (20, 40) de 100 x 60 es (10, 20) de 50 x 30 en puntos.
  const caja = { x: 20, y: 40, w: 100, h: 60 };
  const esperado = { 0: [60, 580], 90: [100, 40], 180: [440, 80], 270: [400, 620] };
  for (const [giro, [x, y]] of Object.entries(esperado)) {
    const b = cajaAPdf(caja, { ...pagina, rotacion: Number(giro) }, 2);
    assert.deepEqual(b, { x, y, w: 50, h: 30, giro: Number(giro) }, `giro ${giro}`);
  }
  assert.deepEqual(puntoAPdf(0, 0, { ...pagina, rotacion: 0 }), { x: 50, y: 630 });
  assert.deepEqual(tamanoVista({ ...pagina, rotacion: 90 }), { ancho: 600, alto: 400 });
  assert.deepEqual(tamanoVista({ ...pagina, rotacion: 180 }), { ancho: 400, alto: 600 });
  assert.equal(giroNormal(-90), 270);
  assert.equal(giroNormal(450), 90);
  assert.deepEqual(lineaDeTexto({ x: 1, y: 2, w: 3, h: 13 }), { tamano: 10, base: { x: 1, y: 2, w: 3, h: 10 } });
  assert.equal(TEXTO_ALTO * 10 - TEXTO_BAJA * 10, 10);
  assert.equal(fechaHoy(new Date(2026, 0, 5)), "05/01/2026");
});

// Multiplica las matrices cm como lo hace el PDF para saber dónde quedó la imagen.
function por(m, n) {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

async function leerConPdfjs(bytes, numero) {
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/" }).promise;
  const pagina = await doc.getPage(numero);
  const vista = pagina.getViewport({ scale: 1 });
  const textos = (await pagina.getTextContent()).items.filter((i) => i.str);
  const ops = await pagina.getOperatorList();
  const imagenes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const pila = [];
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.save) pila.push(ctm);
    else if (fn === OPS.restore) ctm = pila.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = por(ops.argsArray[i], ctm);
    else if (fn === OPS.paintImageXObject) imagenes.push(ctm);
  });
  const enVista = (m, x, y) => vista.convertToViewportPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  await doc.destroy();
  return { vista, textos, imagenes, enVista };
}

const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.5, `${msg}: ${a} contra ${b}`);

test("lo que se pone en pantalla queda donde pdfjs lo dibuja, con giro y CropBox", async () => {
  const dir = temporal();
  for (const giro of [0, 90, 180, 270]) {
    const ruta = await pdfGirado(dir, [giro]);
    const doc = await PDFDocument.load(fs.readFileSync(ruta));
    const geo = geometriaPagina(doc.getPage(0));
    assert.deepEqual(geo, { x0: 50, y0: 30, ancho: 400, alto: 600, rotacion: giro });
    const firma = { pagina: 1, tipo: "firma", imagen: 0, x: 40, y: 60, w: 120, h: 40 };
    const texto = { pagina: 1, tipo: "texto", texto: "Hola", x: 40, y: 200, w: 30, h: 13 };
    const r = await firmarPdf(ruta, { imagenes: [PNG], marcas: [firma, texto], constancia: false });
    assert.equal(r.codigo, "");
    const leido = await leerConPdfjs(r.bytes, 1);
    const tam = tamanoVista(geo);
    cerca(leido.vista.width, tam.ancho, `ancho ${giro}`);
    cerca(leido.vista.height, tam.alto, `alto ${giro}`);
    assert.equal(leido.imagenes.length, 1);
    const [ix, iy] = leido.enVista(leido.imagenes[0], 0, 1);
    const [dx, dy] = leido.enVista(leido.imagenes[0], 1, 0);
    cerca(ix, 40, `firma izquierda ${giro}`);
    cerca(iy, 60, `firma arriba ${giro}`);
    cerca(dx, 160, `firma derecha ${giro}`);
    cerca(dy, 100, `firma abajo ${giro}`);
    const t = leido.textos.find((i) => i.str === "Hola");
    const [tx, ty] = leido.vista.convertToViewportPoint(t.transform[4], t.transform[5]);
    cerca(tx, 40, `texto x ${giro}`);
    cerca(ty, 200 + 13 - 10 * TEXTO_BAJA, `texto base ${giro}`);
  }
});

test("varias firmas y textos en varias páginas, con y sin constancia", async () => {
  const dir = temporal();
  const ruta = await pdfGirado(dir, [0, 90, 0]);
  const marcas = [
    { pagina: 1, tipo: "firma", imagen: 0, x: 10, y: 10, w: 100, h: 30 },
    { pagina: 1, tipo: "firma", imagen: 1, x: 200, y: 400, w: 60, h: 30 },
    { pagina: 2, tipo: "texto", texto: "Ana Pérez", x: 20, y: 20, w: 80, h: 15.6 },
    { pagina: 2, tipo: "texto", texto: fechaHoy(), x: 20, y: 60, w: 80, h: 15.6 },
    { pagina: 3, tipo: "firma", imagen: 0, x: 300, y: 500, w: 90, h: 27 },
  ];
  const r = await firmarPdf(ruta, { imagenes: [PNG, JPG], marcas, firmante: { nombre: "Ana Pérez" } });
  assert.deepEqual(r.paginas, [1, 2, 3]);
  assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 4, "tres páginas más la constancia");
  assert.equal((await leerConPdfjs(r.bytes, 1)).imagenes.length, 2);
  const p2 = await leerConPdfjs(r.bytes, 2);
  assert.equal(p2.imagenes.length, 0);
  assert.ok(p2.textos.some((t) => t.str === "Ana Pérez"));
  assert.ok(p2.textos.some((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t.str)));
  assert.equal((await leerConPdfjs(r.bytes, 3)).imagenes.length, 1);
  const firmado = path.join(dir, "firmado.pdf");
  fs.writeFileSync(firmado, r.bytes);
  assert.equal((await verificarPdf(firmado)).integro, true);
  const sin = await firmarPdf(ruta, { imagenes: [PNG, JPG], marcas, constancia: false });
  assert.equal((await PDFDocument.load(sin.bytes)).getPageCount(), 3, "sin constancia no agrega página");
  await assert.rejects(() => firmarPdf(ruta, { imagenes: [PNG], marcas: [{ ...marcas[0], pagina: 9 }], constancia: false }), /se sale/);
  await assert.rejects(() => firmarPdf(ruta, { imagenes: [PNG], marcas: [{ ...marcas[0], imagen: 3 }], constancia: false }), /Falta la imagen/);
  await assert.rejects(() => firmarPdf(ruta, { imagenes: ["aG9sYQ=="], marcas: [marcas[0]], constancia: false }), /PNG o JPG/);
});

// La huella no puede depender de la hora: se verifica en otro segundo.
test("un firmado sigue íntegro al verificarlo después, no solo en el mismo segundo", async () => {
  const dir = temporal();
  const ruta = await pdfGirado(dir, [0, 90]);
  const marcas = [1, 2].map((pagina) => ({ pagina, tipo: "firma", imagen: 0, x: 40, y: 300, w: 150, h: 40 }));
  marcas.push({ pagina: 1, tipo: "texto", texto: "Camilo Bayona", x: 40, y: 360, w: 90, h: 14.3 });
  const r = await firmarPdf(ruta, { imagenes: [PNG], marcas, firmante: { nombre: "Camilo Bayona" } });
  const firmado = path.join(dir, "firmado.pdf");
  fs.writeFileSync(firmado, r.bytes);
  await new Promise((ok) => setTimeout(ok, 1100));
  const v = await verificarPdf(firmado);
  assert.equal(v.integro, true);
  assert.equal(v.codigo, r.codigo);
});

test("un PDF con contraseña da la guía de Desbloquear", async () => {
  const dir = temporal();
  const ruta = await pdfGirado(dir, [0]);
  const cerrado = path.join(dir, "cerrado.pdf");
  fs.writeFileSync(cerrado, await protegerPdf(ruta, { usuario: "clave1234" }));
  await assert.rejects(() => firmarPdf(cerrado, { imagenes: [PNG], marcas: [{ pagina: 1, tipo: "firma", imagen: 0, x: 1, y: 1, w: 9, h: 9 }], constancia: false }), /Desbloquear/);
});

test("la biblioteca de firmas guarda, lista, renombra y borra", () => {
  const dir = temporal();
  const db = abrirBase(path.join(dir, "base.sqlite"));
  assert.deepEqual(listarFirmas(db), []);
  assert.throws(() => guardarFirma(db, { nombre: "A", png: PNG }), /2 letras/);
  assert.throws(() => guardarFirma(db, { nombre: "Vacía", png: "" }), /Dibuje/);
  const a = guardarFirma(db, { nombre: "Dibujada", png: PNG });
  const b = guardarFirma(db, { nombre: "Escrita", png: `data:image/png;base64,${PNG}` });
  const lista = listarFirmas(db);
  assert.deepEqual(lista.map((f) => f.nombre), ["Dibujada", "Escrita"]);
  assert.equal(lista[1].png, PNG, "se guarda sin el prefijo data:");
  assert.deepEqual(renombrarFirma(db, a.id, "  Mi   firma "), { id: a.id, nombre: "Mi firma" });
  assert.equal(listarFirmas(db)[0].nombre, "Mi firma");
  assert.throws(() => renombrarFirma(db, a.id, "x"), /2 letras/);
  borrarFirma(db, b.id);
  assert.deepEqual(listarFirmas(db).map((f) => f.id), [a.id]);
  assert.throws(() => borrarFirma(db, b.id), /ya no está/);
  assert.throws(() => renombrarFirma(db, 999, "Otra"), /ya no está/);
  for (let i = 0; i < 19; i += 1) guardarFirma(db, { nombre: `Firma ${i}`, png: PNG });
  assert.throws(() => guardarFirma(db, { nombre: "Una más", png: PNG }), /20 firmas/);
  db.close();
});

test("pdf-firmar guarda en un archivo nuevo y nunca encima del original", async () => {
  const dir = temporal();
  const db = abrirBase(path.join(dir, "base.sqlite"));
  const ruta = await pdfGirado(dir, [0]);
  const antes = fs.readFileSync(ruta);
  const manejadores = new Map();
  let destino = ruta;
  let sugerido = "";
  const dialog = {
    showSaveDialog: async (_v, o) => {
      sugerido = o.defaultPath;
      return { canceled: false, filePath: destino };
    },
  };
  registrarPdftools({ ipcMain: { handle: (c, fn) => manejadores.set(c, fn) }, dialog, ventana: () => null, mensajeHumano: (e) => e.message, db });
  const firmar = manejadores.get("pdf-firmar");
  const dato = { ruta, imagenes: [PNG], marcas: [{ pagina: 1, tipo: "firma", imagen: 0, x: 10, y: 10, w: 90, h: 30 }], firmante: "Ana Pérez" };
  const encima = await firmar(null, dato);
  assert.equal(encima.ok, false);
  assert.match(encima.error, /original/);
  assert.deepEqual(fs.readFileSync(ruta), antes);
  assert.equal(sugerido, path.join(dir, "girado-0-firmado.pdf"));
  destino = sugerido;
  const r = await firmar(null, dato);
  assert.equal(r.ok, true);
  assert.equal(r.ruta, sugerido);
  assert.match(r.codigo, /^[0-9A-F]{12}$/);
  assert.equal((await verificarPdf(r.ruta, db)).enRegistro, true);
  const sin = await firmar(null, { ...dato, constancia: false, firmante: "" });
  assert.equal(sin.ok, true);
  assert.equal(sin.codigo, "");
  const lista = manejadores.get("firmas-listar");
  await manejadores.get("firma-guardar")(null, { nombre: "Mía", png: PNG });
  const [f] = (await lista()).firmas;
  assert.equal((await manejadores.get("firma-renombrar")(null, { id: f.id, nombre: "Nueva" })).nombre, "Nueva");
  assert.equal((await manejadores.get("firma-borrar")(null, { id: f.id })).ok, true);
  assert.equal((await manejadores.get("firma-borrar")(null, { id: f.id })).ok, false);
  db.close();
});
