import assert from "node:assert/strict";
import test from "node:test";
import {
  esRadicadoSam,
  extraerActuacionesSam,
  extraerCamposSam,
  extraerDesafioSam,
  normalizarCriterioSam,
  parsearCorporacionesSam,
  parsearProcesoSam,
  parsearRespuestaSam,
} from "../compartido/samai.js";

test("la cédula va por parte y el número largo por radicado", () => {
  assert.equal(normalizarCriterioSam(" 19265621 "), "19265621");
  assert.equal(esRadicadoSam("11001333501920200028900"), true);
  assert.equal(esRadicadoSam("19265621"), false);
});

test("el proceso trae ficha y partes", () => {
  const p = parsearProcesoSam({
    radicado: "11001333501920200028900",
    corporacion: "1100133",
    guid: "abc",
    ponente: "JUZGADO 19 ADMINISTRATIVO",
    nombreDespachoOperativo: "JUZGADO 19 ADMINISTRATIVO SEC SEGUNDA ORAL BOGOTA",
    identidadDespacho: { officeName: "Juzgado 19 Administrativo", currentHolder: "JUAN" },
    clase: "ACCIONES DE TUTELA",
    fechaIngreso: "2020-10-28",
    vigente: "SI",
    asunto: "TUTELA\r\nCORREO",
    demandante: "NELSON BELTRAN BELTRAN",
    demandado: "AGENCIA NACIONAL DE MINERIA",
    urlDetalle: "/Vistas/Casos/list_procesos.aspx?guid=abc",
  });
  assert.equal(p.despacho_lindo, "Juzgado 19 Administrativo");
  assert.equal(p.titular, "JUAN");
  assert.equal(p.demandante, "NELSON BELTRAN BELTRAN");
  assert.equal(p.asunto, "TUTELA CORREO");
});

test("la respuesta trae paginación y las corporaciones se aplanan", () => {
  const r = parsearRespuestaSam({ ok: true, data: { items: [{ radicado: "1" }], page: 2, total: 25, totalPages: 3 } });
  assert.equal(r.total, 25);
  assert.equal(r.paginas, 3);
  assert.equal(r.procesos.length, 1);
  assert.deepEqual(parsearRespuestaSam({}), { procesos: [], pagina: 1, total: 0, paginas: 0 });
  assert.deepEqual(parsearCorporacionesSam([{ value: "1100133", text: "Juzgado Administrativo de Bogotá" }]), [
    { codigo: "1100133", nombre: "Juzgado Administrativo de Bogotá" },
  ]);
});

test("el desafío junta los textos sin espacios", () => {
  const html = '<span id="MainContent_Lbldato1">70</span><span id="MainContent_Lbldato2">24</span><span id="MainContent_LbldatoN">F T</span>';
  assert.equal(extraerDesafioSam(html), "7024FT");
  assert.equal(extraerDesafioSam("nada"), "");
});

test("las actuaciones salen de la grilla", () => {
  const html = `<table id="MainContent_GridViewHistoricoActuaciones"><tr><th>Ver</th><th>Fecha registro</th><th>Fecha actuación</th><th>Actuación</th><th>Anotación / detalle</th><th>Estado</th><th>Anexos</th><th>Índice</th></tr><tr><td><a>ver</a></td><td>15/10/2026 14:01:47</td><td>15/10/2026</td><td>Radicación oficina</td><td>HCS-DEMANDA</td><td>REGISTRADA</td><td>3</td><td>00002</td></tr></table>`;
  const actos = extraerActuacionesSam(html);
  assert.equal(actos.length, 1);
  assert.equal(actos[0].actuacion, "Radicación oficina");
  assert.equal(actos[0].anexos, "3");
  assert.deepEqual(extraerActuacionesSam("nada"), []);
  const campos = extraerCamposSam('<input name="__VIEWSTATE" value="abc"/><input name="x" />');
  assert.equal(campos.__VIEWSTATE, "abc");
  assert.equal(campos.x, "");
});

import { abrirBase } from "../src/db.js";
import { guardarSamaiCaso, samaiCaso, samaiCasos, samaiOlvidar } from "../src/db.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("guardar el caso dos veces no duplica actuaciones", () => {
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-samai-")), "base.sqlite");
  const db = abrirBase(ruta);
  const proceso = {
    guid: "g1", radicado: "11001333501920200028900", corporacion: "1100133",
    ponente: "P", despacho: "D", despacho_lindo: "L", titular: "T", clase: "C",
    fecha_ingreso: "2020-10-28", vigente: "SI", asunto: "A",
    demandante: "X", demandado: "Y", url_detalle: "u",
    actuaciones: [{ fecha_registro: "f", fecha: "15/10/2026", actuacion: "R", anotacion: "H", estado: "E", anexos: "3", indice: "00002" }],
  };
  assert.equal(guardarSamaiCaso(db, proceso), 1);
  assert.equal(guardarSamaiCaso(db, proceso), 0);
  assert.equal(samaiCasos(db).length, 1);
  assert.equal(samaiCaso(db, "g1").actuaciones.length, 1);
  samaiOlvidar(db, "g1");
  assert.equal(samaiCasos(db).length, 0);
  db.close();
});
