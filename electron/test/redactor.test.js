import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import test from "node:test";
import { docxDeEscrito } from "../src/docx.js";
import { aplicarPresentante, fichaDeDetalle, redactarEscrito } from "../compartido/redactor.js";
import { textoDeDocx } from "../src/docx.js";

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
  assert.equal(escrito.asunto, "Se libre mandamiento de pago");
  assert.match(texto.Destinatario, /Señor Juez/);
  assert.match(texto.Destinatario, /Juzgado Primero Civil del Circuito de Bogotá/);
  assert.match(texto.Destinatario, /10 de octubre de 2026/);
  assert.match(texto.Referencia, /11001311001220220008900/);
  assert.match(texto.Referencia, /Ana Parte/);
  assert.match(texto.Referencia, /Banco del Norte/);
  assert.match(texto.Referencia, /Se libre mandamiento de pago/);
  assert.match(texto.Cuerpo, /demandado no contestó la demanda/);
  assert.match(texto.Cuerpo, /mandamiento de pago/);
  assert.match(texto.Cuerpo, /Auto de mandamiento/);
  assert.match(texto.Cierre, /Ana Pérez/);
  assert.doesNotMatch(texto.Presentación, /en representación/);
  const conLado = redactarEscrito({
    expediente: { ...EXPEDIENTE, representado: "Banco del Norte", representadoRol: "demandado" },
    prompt: "solicito que se libre mandamiento de pago porque el demandado no contestó la demanda",
    hoy: "10 de octubre de 2026",
  });
  assert.match(secciones(conLado).Presentación, /Ana Pérez, en representación de Banco del Norte \(demandado\)/);
  const conDatos = redactarEscrito({
    expediente: {
      ...EXPEDIENTE,
      cedula: "123",
      tarjeta: "456",
      representado: "Banco del Norte",
      representadoRol: "demandado",
      representadoCedula: "900",
      representadoDireccion: "Calle 9",
      representadoTelefono: "300",
    },
    prompt: "solicito que se libre mandamiento de pago porque el demandado no contestó la demanda",
    hoy: "10 de octubre de 2026",
  });
  const conTexto = secciones(conDatos);
  assert.match(conTexto.Presentación, /Ana Pérez, con cédula 123 y tarjeta profesional 456, en representación de Banco del Norte \(demandado\), con cédula 900, dirección Calle 9, teléfono 300/);
  assert.match(conTexto.Cierre, /C\.C\. 123/);
  assert.match(conTexto.Cierre, /T\.P\. 456/);
  assert.match(conTexto.Notificaciones, /Calle 9/);
  assert.match(texto.Notificaciones, /ana@correo.test/);
  assert.doesNotMatch(JSON.stringify(escrito), /424242/);
});

test("la tutela cita la norma conocida y no inventa el número de un artículo dudoso", () => {
  const escrito = redactarEscrito({
    expediente: EXPEDIENTE,
    prompt: "tutela porque no me han notificado el auto",
    hoy: "10 de octubre de 2026",
  });
  const cuerpo = secciones(escrito).Cuerpo;
  assert.equal(escrito.asunto, "Acción de tutela");
  assert.match(cuerpo, /artículo 86 de la Constitución Política/);
  assert.match(cuerpo, /Decreto 2591 de 1991/);
  assert.match(cuerpo, /no me han notificado el auto/i);
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
  assert.doesNotMatch(xml, /Destinatario/);
  const leido = textoDeDocx(bytes);
  assert.equal(leido.ok, true);
  assert.match(leido.texto, /Señor Juez/);
  assert.match(leido.texto, /11001311001220220008900/);
  const word = zipComoWord("word/document.xml", "<w:document><w:p><w:t>Subsanación de la demanda</w:t></w:p></w:document>");
  const real = textoDeDocx(word);
  assert.equal(real.ok, true);
  assert.match(real.texto, /Subsanación de la demanda/);
});

function zipComoWord(ruta, xml) {
  const raw = Buffer.from(xml);
  const comp = deflateRawSync(raw);
  const nombre = Buffer.from(ruta);
  const local = Buffer.alloc(30 + nombre.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x8, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(nombre.length, 26);
  nombre.copy(local, 30);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(comp.length, 8);
  descriptor.writeUInt32LE(raw.length, 12);
  const central = Buffer.alloc(46 + nombre.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x8, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nombre.length, 28);
  central.writeUInt32LE(0, 42);
  nombre.copy(central, 46);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(central.length, 12);
  fin.writeUInt32LE(local.length + comp.length + descriptor.length, 16);
  return Buffer.concat([local, comp, descriptor, central, fin]);
}

test("sin abogado presenta la parte elegida y la referencia cabe en cinco palabras", () => {
  const ficha = aplicarPresentante({
    radicado: EXPEDIENTE.radicado,
    despacho: EXPEDIENTE.despacho,
    demandantes: "Ana Parte",
    demandados: "Banco del Norte",
  }, {
    sujetos: [{ rol_base: "demandante", nombre: "Ana Parte", identificacion: "CC 111" }],
  }, "Ana Parte");
  assert.equal(ficha.cliente, "Ana Parte");
  assert.equal(ficha.cedula, "CC 111");
  const escrito = redactarEscrito({
    expediente: ficha,
    prompt: "alego información sobre el pago",
    referencia: "alega información del pago de marzo",
    hoy: "10 de octubre de 2026",
  });
  assert.equal(escrito.asunto, "Alega información del pago de");
  assert.match(secciones(escrito).Presentación, /Ana Parte/);
});
