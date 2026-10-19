import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { ANGULOS, describirRangos, parsearRangos } from "../compartido/pdftools.js";
import { firmarPdf, guardarActa, infoPdf, rotarPdf, separarPdf, unirPdfs, verificarPdf } from "../src/pdftools.js";
import { abrirBase } from "../src/db.js";

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function temporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vig-pdf-"));
}

async function pdfDe(paginas, dir, nombre) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage([600, 800]);
  const ruta = path.join(dir, nombre);
  fs.writeFileSync(ruta, await doc.save());
  return ruta;
}

async function paginasDe(bytes) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

test("los rangos se entienden como los escribe el usuario", () => {
  assert.deepEqual(parsearRangos("1-3, 5", 10), { indices: [0, 1, 2, 4] });
  assert.deepEqual(parsearRangos("5, 3-4", 10), { indices: [2, 3, 4] });
  assert.deepEqual(parsearRangos("2", 2), { indices: [1] });
  assert.equal(parsearRangos("", 10).error, "Escriba las páginas, por ejemplo 1-3, 5.");
  assert.equal(parsearRangos("1-99", 10).error, "El documento tiene 10 páginas: 1-99 se sale.");
  assert.equal(parsearRangos("abc", 10).error, "No entendí abc. Use 1-3, 5.");
  assert.equal(describirRangos([0, 1]), "2 páginas");
  assert.equal(describirRangos([0]), "1 página");
  assert.deepEqual(ANGULOS, [90, 180, 270]);
});

test("unir, separar, rotar y firmar corren en este computador", async () => {
  const dir = temporal();
  const a = await pdfDe(2, dir, "a.pdf");
  const b = await pdfDe(3, dir, "b.pdf");
  assert.equal((await infoPdf(a)).paginas, 2);
  const unidos = await unirPdfs([a, b]);
  assert.equal(await paginasDe(unidos), 5);
  const parte = await separarPdf(a, [1]);
  assert.equal(await paginasDe(parte), 1);
  const girado = await rotarPdf(a, null, 90);
  assert.equal((await PDFDocument.load(girado)).getPage(0).getRotation().angle, 90);
  const marca = { pagina: 2, tipo: "firma", imagen: 0, x: 400, y: 700, w: 150, h: 50 };
  const firmado = await firmarPdf(a, { imagenes: [PNG_1PX.toString("base64")], marcas: [marca], firmante: { nombre: "Ana Pérez", documento: "123" } });
  assert.ok(firmado.bytes.length > 500);
  assert.match(firmado.codigo, /^[0-9A-F]{12}$/);
  assert.equal(firmado.paginas.length, 1);
  assert.equal(await paginasDe(firmado.bytes), 3, "contenido más la constancia");
  await assert.rejects(() => unirPdfs([a]), /al menos 2/);
  await assert.rejects(() => separarPdf(a, []), /al menos una/);
  await assert.rejects(() => rotarPdf(a, null, 45), /90, 180 o 270/);
  await assert.rejects(() => firmarPdf(a, {}), /al menos una firma/);
  await assert.rejects(() => firmarPdf(a, { imagenes: [PNG_1PX.toString("base64")], marcas: [marca], firmante: { nombre: "" } }), /quién firma/);
  fs.writeFileSync(path.join(dir, "no.pdf"), "hola");
  await assert.rejects(() => infoPdf(path.join(dir, "no.pdf")), /no es un PDF/);
});

test("comprimir achica las fotos sin tocar el texto", async () => {
  const { comprimirPdf } = await import("../src/pdftools.js");
  const dir = temporal();
  const W = 400;
  const H = 300;
  const datos = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    datos[i * 4] = i % 256;
    datos[i * 4 + 1] = (i >> 2) % 256;
    datos[i * 4 + 2] = 128;
    datos[i * 4 + 3] = 255;
  }
  const { default: jpeg } = await import("jpeg-js");
  const jpg = jpeg.encode({ data: datos, width: W, height: H }, 90);
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpg.data);
  const pagina = doc.addPage([600, 800]);
  pagina.drawImage(img, { x: 0, y: 0, width: 600, height: 450 });
  pagina.drawText("Texto que no se toca", { x: 50, y: 700, size: 14 });
  const ruta = path.join(dir, "foto.pdf");
  fs.writeFileSync(ruta, await doc.save());
  const antes = fs.statSync(ruta).size;
  const r = await comprimirPdf(ruta, "baja");
  assert.equal(r.tocadas, 1);
  assert.ok(r.bytes.length < antes);
  const reabierto = await PDFDocument.load(r.bytes);
  assert.equal(reabierto.getPageCount(), 1);
});

test("proteger y desbloquear van y vienen con la misma clave", async () => {
  const { protegerPdf } = await import("../src/pdfproteger.js");
  const { desbloquearPdf } = await import("../src/pdfdescifrar.js");
  const dir = temporal();
  const ruta = await pdfDe(2, dir, "plano.pdf");
  const rutaCifrada = path.join(dir, "cifrado.pdf");
  fs.writeFileSync(rutaCifrada, await protegerPdf(ruta, { usuario: "clave123" }));
  const limpio = await desbloquearPdf(rutaCifrada, "clave123");
  assert.equal(await paginasDe(limpio), 2);
  await assert.rejects(() => desbloquearPdf(rutaCifrada, "otra"), /contraseña/);
  await assert.rejects(() => protegerPdf(ruta, { usuario: "" }), /contraseña/);
});

test("rellenar lista campos y aplica valores", async () => {
  const { camposPdf, rellenarPdf } = await import("../src/pdftools.js");
  const dir = temporal();
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([600, 800]);
  const form = doc.getForm();
  const t = form.createTextField("nombre");
  t.setText("");
  t.addToPage(pagina, { x: 50, y: 700, width: 200, height: 20 });
  const c = form.createCheckBox("acepto");
  c.addToPage(pagina, { x: 50, y: 660 });
  const ruta = path.join(dir, "forma.pdf");
  fs.writeFileSync(ruta, await doc.save());
  const leidos = await camposPdf(ruta);
  assert.equal(leidos.total, 2);
  assert.ok(leidos.campos.some((x) => x.nombre === "nombre" && x.tipo === "texto"));
  assert.ok(leidos.campos.some((x) => x.nombre === "acepto" && x.tipo === "casilla"));
  const lleno = await rellenarPdf(ruta, { nombre: "Ana", acepto: true }, { aplanar: false });
  const doc2 = await PDFDocument.load(lleno);
  assert.equal(doc2.getForm().getTextField("nombre").getText(), "Ana");
  assert.ok(doc2.getForm().getCheckBox("acepto").isChecked());
  const plano = await rellenarPdf(ruta, { nombre: "Ana", acepto: true });
  assert.equal((await PDFDocument.load(plano)).getPageCount(), 1);
});

test("firmar en dos páginas agrega constancia y verificar detecta cambios", async () => {
  const dir = temporal();
  const base = path.join(dir, "base.sqlite");
  const db = abrirBase(base);
  const a = await pdfDe(2, dir, "a.pdf");
  const r = await firmarPdf(a, {
    imagenes: [PNG_1PX.toString("base64")],
    marcas: [1, 2].map((pagina) => ({ pagina, tipo: "firma", imagen: 0, x: 100, y: 600, w: 150, h: 50 })),
    firmante: { nombre: "Ana Pérez", documento: "123" },
  });
  assert.deepEqual(r.paginas, [1, 2]);
  assert.equal(await paginasDe(r.bytes), 3);
  const ruta = path.join(dir, "firmado.pdf");
  fs.writeFileSync(ruta, r.bytes);
  guardarActa(db, {
    codigo: r.codigo, fecha: r.fecha, firmante: "Ana Pérez", documento: "123",
    hashContenido: r.hashContenido, hashFinal: r.hashFinal, paginas: r.paginas, pdfNombre: "firmado.pdf",
  });
  const v = await verificarPdf(ruta, db);
  assert.equal(v.integro, true);
  assert.equal(v.codigo, r.codigo);
  assert.equal(v.firmante, "Ana Pérez");
  assert.equal(v.enRegistro, true);
  // Alterado: se agrega una página después de firmar.
  const adul = await PDFDocument.load(r.bytes);
  adul.addPage([600, 800]);
  const rutaMala = path.join(dir, "malo.pdf");
  fs.writeFileSync(rutaMala, await adul.save());
  const v2 = await verificarPdf(rutaMala, db);
  assert.equal(v2.integro, false);
  assert.equal(v2.codigo, r.codigo);
  await assert.rejects(() => verificarPdf(a, db), /constancia/);
  db.close();
});
