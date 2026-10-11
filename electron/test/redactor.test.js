import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import { docxDeEscrito } from "../src/docx.js";
import { fichaDeDetalle, redactarEscrito } from "../compartido/redactor.js";

const EXPEDIENTE = {
  radicado: "11001311001220220008900",
  despacho: "Juzgado Primero Civil del Circuito de Bogotá",
  departamento: "Bogotá",
  tipo_proceso: "Ejecutivo",
  clase_proceso: "Singular",
  demandantes: "Ana Parte",
  demandados: "Banco del Norte",
  cliente: "Ana Pérez",
  telefonos: "300123",
  email: "ana@correo.test",
  ultima: { fecha: "2026-10-01", actuacion: "Auto de mandamiento", anotacion: "Se libra" },
};

function secciones(escrito) {
  return Object.fromEntries(escrito.secciones.map((seccion) => [seccion.titulo, seccion.parrafos.join("\n")]));
}

test("el memorial va dirigido al juzgado y separa el hecho de la petición", () => {
  const escrito = redactarEscrito({
    expediente: EXPEDIENTE,
    prompt: "solicito que se libre mandamiento de pago porque el demandado no contestó la demanda",
    hoy: "10 de octubre de 2026",
  });
  const texto = secciones(escrito);
  assert.equal(escrito.asunto, "Memorial");
  assert.match(texto.Destinatario, /Señor Juez/);
  assert.match(texto.Destinatario, /Juzgado Primero Civil del Circuito de Bogotá/);
  assert.match(texto.Destinatario, /10 de octubre de 2026/);
  assert.match(texto.Referencia, /11001311001220220008900/);
  assert.match(texto.Referencia, /Ana Parte/);
  assert.match(texto.Referencia, /Banco del Norte/);
  assert.match(texto.Hechos, /El demandado no contestó la demanda/);
  assert.match(texto.Peticiones, /Se libre mandamiento de pago/);
  assert.match(texto.Antecedentes, /Auto de mandamiento/);
  assert.match(texto.Cierre, /Ana Pérez/);
  assert.match(texto.Notificaciones, /ana@correo.test/);
  assert.doesNotMatch(JSON.stringify(escrito), /424242/);
});

test("la tutela cita la norma conocida y no inventa el número de un artículo dudoso", () => {
  const escrito = redactarEscrito({
    expediente: EXPEDIENTE,
    prompt: "tutela porque no me han notificado el auto",
    hoy: "10 de octubre de 2026",
  });
  const fundamentos = secciones(escrito).Fundamentos;
  assert.equal(escrito.asunto, "Acción de tutela");
  assert.match(fundamentos, /artículo 86 de la Constitución Política/);
  assert.match(fundamentos, /Decreto 2591 de 1991/);
  assert.match(secciones(escrito).Hechos, /No me han notificado el auto/);
});

test("una petición vacía no arma el escrito", () => {
  assert.throws(() => redactarEscrito({ expediente: EXPEDIENTE, prompt: "   ", hoy: "hoy" }), /qué debe pedirle al juzgado/);
});

test("la ficha del escrito no lleva el identificador interno", () => {
  const ficha = fichaDeDetalle({
    id_proceso: 424242,
    radicado: EXPEDIENTE.radicado,
    despacho: EXPEDIENTE.despacho,
    sujetos: [
      { rol_base: "demandante", nombre: "Ana Parte" },
      { rol_base: "demandado", nombre: "Banco del Norte" },
    ],
    cliente: { nombre: "Ana", apellidos: "Pérez", email: "ana@correo.test" },
    actuaciones: [{ fecha_actuacion: "2026-10-01", actuacion: "Auto", anotacion: "Se libra" }],
  });
  assert.equal(ficha.cliente, "Ana Pérez");
  assert.equal(ficha.demandantes, "Ana Parte");
  assert.equal(ficha.ultima.actuacion, "Auto");
  assert.equal("id_proceso" in ficha, false);
});

function leerZip(buffer) {
  const archivos = {};
  let cursor = 0;
  while (cursor + 30 < buffer.length && buffer.readUInt32LE(cursor) === 0x04034b50) {
    const comp = buffer.readUInt32LE(cursor + 18);
    const nombreLen = buffer.readUInt16LE(cursor + 26);
    const extra = buffer.readUInt16LE(cursor + 28);
    const inicio = cursor + 30 + nombreLen + extra;
    const nombre = buffer.subarray(cursor + 30, cursor + 30 + nombreLen).toString();
    archivos[nombre] = inflateRawSync(buffer.subarray(inicio, inicio + comp)).toString("utf8");
    cursor = inicio + comp;
  }
  return archivos;
}

test("el docx es un word abierto y trae el juzgado y el radicado", () => {
  const escrito = redactarEscrito({
    expediente: EXPEDIENTE,
    prompt: "solicito que se libre mandamiento de pago porque el demandado no contestó",
    hoy: "10 de octubre de 2026",
  });
  const bytes = docxDeEscrito(escrito);
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  const xml = leerZip(bytes)["word/document.xml"];
  assert.match(xml, /Señor Juez/);
  assert.match(xml, /11001311001220220008900/);
  assert.match(xml, /Juzgado Primero Civil del Circuito de Bogotá/);
  assert.match(xml, /Banco del Norte/);
  assert.doesNotMatch(xml, /424242/);
});
