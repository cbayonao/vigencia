// Canales que piden las vistas de Herramientas PDF: unir páginas elegidas,
// separar en partes, girar cada página distinto, medir la compresión,
// permisos al proteger, cajas de los campos, abrir y mostrar.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { permisosP } from "../compartido/pdfvisual.js";
import { pdfACaja } from "../compartido/pdftools.js";
import { camposPdf, infoPdf, rotarPaginas, unirPdfs } from "../src/pdftools.js";
import { nombreLibre, registrarPdftools } from "../src/pdftools-ipc.js";

const temporal = () => fs.mkdtempSync(path.join(os.tmpdir(), "vig-pdfv-"));

// Cada página con ancho distinto: así se sabe cuál quedó dónde.
async function pdfDe(paginas, dir, nombre) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage([300 + i, 400]);
  const ruta = path.join(dir, nombre);
  fs.writeFileSync(ruta, await doc.save());
  return ruta;
}

const anchos = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

function montar({ guardar = null, carpeta = null, shell = null } = {}) {
  const manejadores = new Map();
  const llamadas = { guardar: 0, carpeta: 0 };
  const dialog = {
    showSaveDialog: async (_v, o) => {
      llamadas.guardar += 1;
      return guardar ? { canceled: false, filePath: guardar(o) } : { canceled: true };
    },
    showOpenDialog: async () => {
      llamadas.carpeta += 1;
      return carpeta ? { canceled: false, filePaths: [carpeta] } : { canceled: true, filePaths: [] };
    },
  };
  registrarPdftools({ ipcMain: { handle: (c, fn) => manejadores.set(c, fn) }, dialog, shell, ventana: () => null, mensajeHumano: (e) => e.message });
  return { llamar: (c, d) => manejadores.get(c)(null, d), llamadas };
}

test("unir toma solo las páginas elegidas, en ese orden", async () => {
  const dir = temporal();
  const a = await pdfDe(3, dir, "a.pdf");
  const b = await pdfDe(2, dir, "b.pdf");
  assert.deepEqual(await anchos(await unirPdfs([{ ruta: a, indices: [2, 0] }, b])), [302, 300, 300, 301]);
  await assert.rejects(unirPdfs([{ ruta: a, indices: [5] }, b]), /se salen/);
  const destino = path.join(dir, "unidos.pdf");
  const { llamar } = montar({ guardar: () => destino });
  const r = await llamar("pdf-unir", { partes: [{ ruta: b, indices: [1] }, { ruta: a }] });
  assert.equal(r.ok, true);
  assert.deepEqual(await anchos(fs.readFileSync(destino)), [301, 300, 301, 302]);
});

test("girar deja cada página con su giro", async () => {
  const dir = temporal();
  const ruta = await pdfDe(3, dir, "g.pdf");
  const doc = await PDFDocument.load(await rotarPaginas(ruta, { 0: 90, 2: 270 }));
  assert.deepEqual(doc.getPages().map((p) => p.getRotation().angle), [90, 0, 270]);
  await assert.rejects(rotarPaginas(ruta, { 0: 45 }), /90, 180 o 270/);
  await assert.rejects(rotarPaginas(ruta, {}), /No hay páginas/);
  const destino = path.join(dir, "girado.pdf");
  const { llamar } = montar({ guardar: () => destino });
  assert.equal((await llamar("pdf-rotar", { ruta, giros: { 1: 180 } })).ok, true);
  assert.deepEqual((await infoPdf(destino)).detalle.map((p) => p.rotacion), [0, 180, 0]);
});

test("separar en partes deja un PDF por parte sin pisar nada", async () => {
  const dir = temporal();
  const ruta = await pdfDe(5, dir, "s.pdf");
  const salida = path.join(dir, "salida");
  fs.mkdirSync(salida);
  fs.writeFileSync(path.join(salida, "s-parte-1.pdf"), "ya estaba");
  assert.equal(nombreLibre(salida, "s-parte-1"), path.join(salida, "s-parte-1 (2).pdf"));
  const { llamar, llamadas } = montar({ carpeta: salida, guardar: () => ruta });
  const r = await llamar("pdf-separar", { ruta, partes: [[0, 1], [2], [3, 4]] });
  assert.equal(r.ok, true);
  assert.equal(r.rutas.length, 3);
  assert.equal(fs.readFileSync(path.join(salida, "s-parte-1.pdf"), "utf8"), "ya estaba");
  assert.deepEqual(await anchos(fs.readFileSync(r.rutas[0])), [300, 301]);
  assert.deepEqual(await anchos(fs.readFileSync(r.rutas[2])), [303, 304]);
  // Una sola parte va por Guardar como, que no deja escribir encima del original.
  const antes = fs.readFileSync(ruta);
  const una = await llamar("pdf-separar", { ruta, partes: [[1]] });
  assert.equal(una.ok, false);
  assert.match(una.error, /original/);
  assert.deepEqual(fs.readFileSync(ruta), antes);
  assert.equal(llamadas.carpeta, 1);
});

test("comprimir mide sin guardar y luego guarda sin repetir", async () => {
  const dir = temporal();
  const ruta = await pdfDe(1, dir, "c.pdf");
  const destino = path.join(dir, "c-comprimido.pdf");
  const { llamar, llamadas } = montar({ guardar: () => destino });
  const m = await llamar("pdf-comprimir", { ruta, nivel: "baja", medir: true });
  assert.equal(m.ok, true);
  assert.equal(llamadas.guardar, 0);
  assert.ok(m.antes > 0 && m.despues > 0 && m.base64.length > 0);
  const g = await llamar("pdf-comprimir", { ruta, nivel: "baja" });
  assert.equal(g.ok, true);
  assert.equal(g.despues, m.despues);
  assert.equal(fs.statSync(destino).size, m.despues);
});

test("proteger guarda los permisos elegidos", async () => {
  const dir = temporal();
  const ruta = await pdfDe(1, dir, "p.pdf");
  const destino = path.join(dir, "p-protegido.pdf");
  const { llamar } = montar({ guardar: () => destino });
  const P = permisosP({ imprimir: false, copiar: false });
  assert.equal((await llamar("pdf-proteger", { ruta, clave: "Tortuga7verde", permisos: P })).ok, true);
  assert.match(fs.readFileSync(destino, "latin1"), new RegExp(`/P ${P}\\b`));
  assert.equal((await llamar("pdf-proteger", { ruta, clave: "x" })).ok, true);
  assert.match(fs.readFileSync(destino, "latin1"), /\/P -4\b/);
});

test("los campos traen su caja y su página", async () => {
  const dir = temporal();
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  const p2 = doc.addPage([600, 800]);
  const form = doc.getForm();
  form.createTextField("nombre").addToPage(p2, { x: 100, y: 700, width: 200, height: 20 });
  const caja = form.createCheckBox("acepto");
  caja.addToPage(p2, { x: 50, y: 50, width: 12, height: 12 });
  const ruta = path.join(dir, "f.pdf");
  fs.writeFileSync(ruta, await doc.save());
  const { campos } = await camposPdf(ruta);
  const nombre = campos.find((c) => c.nombre === "nombre");
  // pdf-lib ensancha el /Rect medio borde por lado: la caja es la del archivo.
  assert.deepEqual(nombre.cajas.map(({ pagina, x, y, w, h }) => ({ pagina, x, y, w, h })), [{ pagina: 2, x: 99.5, y: 699.5, w: 201, h: 21 }]);
  assert.equal(nombre.multilinea, false);
  assert.equal(campos.find((c) => c.nombre === "acepto").cajas[0].pagina, 2);
  const geo = (await infoPdf(ruta)).detalle[1];
  assert.deepEqual(pdfACaja(nombre.cajas[0], geo), { x: 99.5, y: 79.5, w: 201, h: 21 });
});

test("abrir y mostrar solo aceptan PDF que existen", async () => {
  const dir = temporal();
  const ruta = await pdfDe(1, dir, "o.pdf");
  const vistos = [];
  const shell = { openPath: async (r) => { vistos.push(["abrir", r]); return ""; }, showItemInFolder: (r) => vistos.push(["mostrar", r]) };
  const { llamar } = montar({ shell });
  assert.equal((await llamar("pdf-abrir", { ruta })).ok, true);
  assert.equal((await llamar("pdf-mostrar", { ruta })).ok, true);
  assert.equal((await llamar("pdf-abrir", { ruta: path.join(dir, "no.pdf") })).ok, false);
  assert.equal((await llamar("pdf-abrir", { ruta: "/etc/passwd" })).ok, false);
  assert.equal((await llamar("pdf-mostrar", { ruta: "o.pdf" })).ok, false);
  assert.deepEqual(vistos, [["abrir", ruta], ["mostrar", ruta]]);
  const info = await llamar("pdf-info", { ruta });
  assert.equal(info.bytes, fs.statSync(ruta).size);
});
