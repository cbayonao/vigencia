import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { abrirBase, asignarCliente, guardarCliente, informesDelDia } from "../src/db.js";
import { fechaInforme, htmlInforme, nombreArchivoInforme } from "../src/informe.js";

const ANA = "11001311001220220008900";
const LUIS = "11001418901820190162700";
const LIBRE = "11001400304720220003800";

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-informe-"));
  return {
    ruta: path.join(dir, "grokvig.sqlite"),
    borrar() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function sembrar(db) {
  for (const numero of [ANA, LUIS, LIBRE]) {
    db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(numero);
  }
  db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, despacho, tipo_proceso) VALUES (424242, ?, 0, 'Juzgado de Ana', 'Ejecutivo')").run(ANA);
  db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, despacho, tipo_proceso) VALUES (8, ?, 0, 'Juzgado de Luis', 'Verbal')").run(LUIS);
  db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, despacho) VALUES (9, ?, 0, 'Juzgado libre')").run(LIBRE);
  db.prepare("INSERT INTO sujeto (id_proceso, id_reg_sujeto, rol_base, nombre) VALUES (424242, 1, 'demandante', 'Ana Parte')").run();
  db.prepare("INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion, actuacion, anotacion, con_documentos) VALUES (1, 424242, ?, 2, '2026-10-10', 'Auto de hoy', 'Anotación <hoy>', 0)").run(ANA);
  db.prepare("INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion, actuacion, con_documentos) VALUES (2, 424242, ?, 1, '2026-10-09', 'Auto de ayer', 0)").run(ANA);
  db.prepare("INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion, actuacion, con_documentos) VALUES (3, 8, ?, 1, '2026-10-01', 'Auto de Luis', 0)").run(LUIS);
  db.prepare("INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion, actuacion, con_documentos) VALUES (4, 9, ?, 1, '2026-10-10', 'No entra', 0)").run(LIBRE);
  const ana = guardarCliente(db, { nombre: "Ana", apellidos: "Pérez", telefonos: "300", email: "ana@correo.test" });
  const luis = guardarCliente(db, { nombre: "Luis", apellidos: "Pérez" });
  const sola = guardarCliente(db, { nombre: "Sin", apellidos: "Expediente" });
  asignarCliente(db, 424242, ana);
  asignarCliente(db, 8, luis);
  return { ana, luis, sola };
}

test("el informe diario sale por cliente y no mezcla expedientes", () => {
  const tmp = temporal();
  const db = abrirBase(tmp.ruta);
  sembrar(db);
  const informes = informesDelDia(db, "2026-10-10");
  assert.equal(informes.length, 2);
  assert.equal(informes[0].cliente.nombre, "Ana");
  assert.equal(informes[0].procesos.length, 1);
  assert.equal(informes[0].procesos[0].deHoy.length, 1);
  assert.equal(informes[0].procesos[0].deHoy[0].actuacion, "Auto de hoy");
  assert.equal(informes[0].procesos[0].ultima, null);
  assert.equal(informes[1].cliente.nombre, "Luis");
  assert.equal(informes[1].procesos[0].deHoy.length, 0);
  assert.equal(informes[1].procesos[0].ultima.actuacion, "Auto de Luis");
  const ana = htmlInforme(informes[0], "2026-10-10");
  const luis = htmlInforme(informes[1], "2026-10-10");
  assert.match(ana, /Ana Pérez/);
  assert.match(ana, /Auto de hoy/);
  assert.match(ana, /Anotación &lt;hoy&gt;/);
  assert.match(ana, /Ana Parte/);
  assert.match(ana, new RegExp(ANA));
  assert.doesNotMatch(ana, /Auto de ayer/);
  assert.doesNotMatch(ana, /Auto de Luis/);
  assert.doesNotMatch(ana, /No entra/);
  assert.doesNotMatch(ana, /424242/);
  assert.match(luis, /Última actuación/);
  assert.match(luis, /Hoy no hay actuación nueva/);
  assert.match(luis, /Auto de Luis/);
  assert.doesNotMatch(luis, /Auto de hoy/);
  assert.equal(fechaInforme("2026-10-10"), "10 de octubre de 2026");
  db.close();
  tmp.borrar();
});

test("dos clientes con el mismo nombre no pisan el archivo", () => {
  const usados = new Set();
  const primero = nombreArchivoInforme({ nombre: "Ana", apellidos: "Pérez" }, "2026-10-10", usados);
  const segundo = nombreArchivoInforme({ nombre: "Ana", apellidos: "Pérez" }, "2026-10-10", usados);
  assert.equal(primero, "Informe 2026-10-10 Ana Pérez.pdf");
  assert.equal(segundo, "Informe 2026-10-10 Ana Pérez 2.pdf");
  assert.equal(nombreArchivoInforme({ nombre: "A/B", apellidos: "C:D" }, "2026-10-10", new Set()), "Informe 2026-10-10 A B C D.pdf");
});
