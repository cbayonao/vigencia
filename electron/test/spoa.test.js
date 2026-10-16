import assert from "node:assert/strict";
import test from "node:test";
import {
  interiorSoap,
  normalizarRadicadoSp,
  parsearActuacionesSp,
  parsearRegistroSp,
  parsearRespuestaSp,
} from "../compartido/spoa.js";

const SOBRE = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ns1:consultaConvenioResponse><return xsi:type="xsd:string">&lt;?xml version=&quot;1.0&quot;?&gt;&lt;RespuestaConsulta&gt;&lt;DatosRespuesta&gt;&lt;RegistroNumero num=&quot;1&quot;&gt;&lt;CASO_ID&gt;1&lt;/CASO_ID&gt;&lt;CASO_NOTICIA&gt;150016000132202601047&lt;/CASO_NOTICIA&gt;&lt;DESPACHO&gt;FISCALIA 24 SECCIONAL&lt;/DESPACHO&gt;&lt;CASO_ESTADO&gt;ACTIVO&lt;/CASO_ESTADO&gt;&lt;CASO_ETAPA&gt;INDAGACIÓN&lt;/CASO_ETAPA&gt;&lt;DELITOS&gt;A#NINGUNO&lt;/DELITOS&gt;&lt;ACTUACIONES&gt;24-JUN-26#SALE A FISCAL|16-JUN-26#ACTIVIDAD X&lt;/ACTUACIONES&gt;&lt;/RegistroNumero&gt;&lt;/DatosRespuesta&gt;&lt;/RespuestaConsulta&gt;</return></ns1:consultaConvenioResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

test("el radicado SPOA trae 21 o 23 dígitos", () => {
  assert.equal(normalizarRadicadoSp("15001-6000132-2026-01047"), "150016000132202601047");
});

test("las actuaciones se parten por fecha y descripción", () => {
  assert.deepEqual(parsearActuacionesSp("24-JUN-26#A|16-JUN-26#B"), [
    { fecha: "24-JUN-26", descripcion: "A" },
    { fecha: "16-JUN-26", descripcion: "B" },
  ]);
  assert.deepEqual(parsearActuacionesSp(""), []);
});

test("el sobre trae ficha, delitos y actuaciones", () => {
  const { registros } = parsearRespuestaSp(SOBRE);
  assert.equal(registros.length, 1);
  const c = registros[0];
  assert.equal(c.despacho, "FISCALIA 24 SECCIONAL");
  assert.equal(c.estado, "ACTIVO");
  assert.equal(c.etapa, "INDAGACIÓN");
  assert.deepEqual(c.delitos, ["A", "NINGUNO"]);
  assert.equal(c.actuaciones.length, 2);
  assert.equal(interiorSoap("nada").length > 0, false);
});

test("sin registros devuelve vacío", () => {
  assert.deepEqual(parsearRespuestaSp("<x></x>"), { registros: [] });
  assert.deepEqual(parsearRegistroSp("").actuaciones, []);
});

import { abrirBase, guardarSpCaso, spoaCaso, spoaCasos, spoaOlvidar } from "../src/db.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REGISTRO = {
  caso_id: "1", noticia: "150016000132202601047", despacho: "FISCALIA 24 SECCIONAL",
  unidad: { descripcion: "U", seccional: "S", direccion: "D", telefono: "T", depto: "BOYACA", muni: "M" },
  fecha_asignacion: "24-JUN-26", estado: "ACTIVO", etapa: "INDAGACIÓN", ley: "Ley 906", correo: "",
  hechos: { depto: "Boyaca", muni: "R", fecha: "13/jun/2026" },
  delitos: ["A", "B"], reservado: "N", conexado: "N",
  actuaciones: [{ fecha: "24-JUN-26", descripcion: "SALE" }, { fecha: "16-JUN-26", descripcion: "ACTIVIDAD" }],
};

test("guardar el caso dos veces no duplica actuaciones", () => {
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-spoa-")), "base.sqlite");
  const db = abrirBase(ruta);
  assert.equal(guardarSpCaso(db, REGISTRO), 2);
  assert.equal(guardarSpCaso(db, REGISTRO), 0);
  assert.equal(spoaCasos(db).length, 1);
  const caso = spoaCaso(db, "150016000132202601047");
  assert.equal(caso.despacho, "FISCALIA 24 SECCIONAL");
  assert.equal(caso.actuaciones.length, 2);
  spoaOlvidar(db, "150016000132202601047");
  assert.equal(spoaCasos(db).length, 0);
  db.close();
});
