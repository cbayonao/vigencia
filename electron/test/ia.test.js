import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generarBorrador, listarModelos, pulirConSencillo, contextoExpediente, extraerPuntos, semejantes, filtrarPorModo, guardarModo, leerNubes, guardarNube, RECOMENDADOS, urlDeModelo, esGgufValido } from "../src/ia.js";
import { htmlMemorial, vistaMemorial } from "../src/memorial.js";
import { redactarEscrito } from "../compartido/redactor.js";

function procesoBase() {
  return {
    radicado: "11001311000220220047400",
    despacho: "Juzgado 2 de Familia",
    departamento: "Bogotá",
    tipo_proceso: "Verbal",
    clase_proceso: "Unión marital",
    cliente: { nombre: "Ana", apellidos: "Pérez", telefonos: "300", email: "", direccion: "" },
    sujetos: [
      { rol_base: "demandante", nombre: "Ana Parte" },
      { rol_base: "demandado", nombre: "Luis Parte" },
    ],
    actuaciones: [
      { fecha_actuacion: "2026-10-01", actuacion: "Auto admite", anotacion: "" },
    ],
  };
}

test("el borrador no inventa fundamentos: son los del redactor", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-ia-"));
  const prompt = "solicito impulso porque el proceso está quieto desde hace meses";
  const base = redactarEscrito({
    expediente: {
      radicado: "1", despacho: "J", demandantes: "A", demandados: "B",
      cliente: "", telefonos: "", email: "", direccion: "", departamento: "",
      ultima: null,
    },
    prompt,
    hoy: "1 de octubre de 2026",
  });
  const pulido = pulirConSencillo(base);
  const baseFund = base.secciones.find((s) => s.titulo === "Fundamentos");
  const nuevoFund = pulido.secciones.find((s) => s.titulo === "Fundamentos");
  assert.deepEqual(nuevoFund, baseFund);
  const borrador = await generarBorrador({ datosDir: dir, proceso: procesoBase(), prompt, hoy: "2026-10-01" });
  assert.equal(borrador.modelo.id, "sencillo");
  assert.ok(borrador.vista.includes("11001311000220220047400"));
});

test("el contexto del expediente lleva juzgado, partes y actuaciones", () => {
  const proceso = procesoBase();
  const ficha = {
    radicado: proceso.radicado, despacho: proceso.despacho, departamento: "Bogotá",
    tipo_proceso: "Verbal", clase_proceso: "Unión marital",
    demandantes: "Ana Parte", demandados: "Luis Parte", cliente: "Ana Pérez",
  };
  const contexto = contextoExpediente(ficha, proceso);
  assert.ok(contexto.includes("Juzgado 2 de Familia"));
  assert.ok(contexto.includes("11001311000220220047400"));
  assert.ok(contexto.includes("Ana Parte"));
  assert.ok(contexto.includes("Auto admite"));
});

test("el extractor limpia negrillas y descarta rellenos del modelo", () => {
  const puntos = extraerPuntos("**HECHOS**\n1. **El proceso está quieto.**\nEnfoque: algo\n2. [Insertar fecha]\n- Nota: hola");
  assert.deepEqual(puntos, ["El proceso está quieto."]);
});

test("el extractor descarta la negativa del modelo y deja el respaldo", () => {
  const puntos = extraerPuntos("Lo siento, pero no puedo cumplir con esa solicitud.");
  assert.deepEqual(puntos, []);
});

test("el modo libre deja el texto del modelo y el fiel lo filtra", () => {
  const base = ["1. El proceso está quieto."];
  const puntos = ["El proceso está en etapa de sentencia."];
  assert.deepEqual(filtrarPorModo(base, puntos, "libre"), puntos);
  assert.deepEqual(filtrarPorModo(base, puntos, "fiel"), base);
  assert.deepEqual(filtrarPorModo(base, [], "libre"), base);
});

test("el modo se guarda y la lista nunca muestra claves", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-ia-"));
  guardarNube(dir, { proveedor: "openai", key: "secreta", modelo: "gpt-4o-mini" });
  const lista = listarModelos(dir);
  assert.equal(lista.modo, "fiel");
  assert.ok(JSON.stringify(lista).includes("secreta") === false);
  guardarModo(dir, "libre");
  assert.equal(listarModelos(dir).modo, "libre");
  const nubes = leerNubes(dir);
  const openai = nubes.find((nube) => nube.id === "openai");
  assert.equal(openai.tieneClave, true);
  assert.ok(!("key" in openai));
  assert.equal(nubes.length, 5);
});
test("la semejanza acepta la reescritura fiel y rechaza el invento", () => {
  assert.equal(semejantes("El proceso está quieto desde hace meses.", "El proceso permanece inactivo desde hace varios meses."), true);
  assert.equal(semejantes("El proceso está quieto desde hace meses.", "El proceso está en etapa de sentencia."), false);
});
test("el prompt vacío no genera borrador", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-ia-"));
  await assert.rejects(() => generarBorrador({ datosDir: dir, proceso: procesoBase(), prompt: "  ", hoy: "2026-10-01" }));
});

test("el catálogo trae siete recomendados con URL de Hugging Face", () => {
  assert.equal(RECOMENDADOS.length, 7);
  for (const item of RECOMENDADOS) {
    assert.ok(item.id && item.nombre && item.detalle);
    assert.match(urlDeModelo(item), /^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+\.gguf$/);
  }
  const ids = new Set(RECOMENDADOS.map((item) => item.id));
  assert.equal(ids.size, 7);
  const archivos = new Set(RECOMENDADOS.map((item) => item.archivo));
  assert.equal(archivos.size, 7);
});

test("la descarga sigue redirecciones y el validador rechaza lo que no es gguf", async () => {
  const { default: http } = await import("node:http");
  const { descargarArchivo } = await import("../src/ia.js");
  const bueno = Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(100, 7)]);
  const servidor = http.createServer((peticion, respuesta) => {
    if (peticion.url === "/viejo") {
      respuesta.writeHead(302, { Location: "/modelo.gguf" });
      respuesta.end();
      return;
    }
    respuesta.writeHead(200, { "Content-Length": bueno.length });
    respuesta.end(bueno);
  });
  await new Promise((listo) => servidor.listen(0, listo));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-ia-"));
  const avances = [];
  const destino = path.join(dir, "modelo.gguf");
  await descargarArchivo(`${base}/viejo`, destino, (avance) => avances.push(avance));
  assert.equal(esGgufValido(destino), true);
  assert.ok(avances.length > 0);
  const rutaMala = path.join(dir, "malo.gguf");
  fs.writeFileSync(rutaMala, "hola");
  assert.equal(esGgufValido(rutaMala), false);
  assert.equal(esGgufValido(path.join(dir, "falta.gguf")), false);
  await new Promise((listo) => servidor.close(listo));
});
test("la vista y el PDF llevan el radicado y escapan el texto", () => {
  const ficha = { radicado: "<b>123</b>", despacho: "J", demandantes: "A & B", demandados: "" };
  const secciones = [{ titulo: "Hechos", parrafos: ["1. Algo <mal>."] }];
  const vista = vistaMemorial({ asunto: "Memorial", secciones, ficha, fecha: "2026-10-01" });
  assert.ok(vista.includes("&lt;b&gt;123&lt;/b&gt;"));
  const completo = htmlMemorial({ asunto: "Memorial", secciones, ficha, fecha: "2026-10-01" });
  assert.ok(completo.includes("@page"));
  assert.ok(completo.includes("A &amp; B"));
});

test("los modelos listan el sencillo y los gguf importados", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-ia-"));
  fs.mkdirSync(path.join(dir, "modelos"), { recursive: true });
  fs.writeFileSync(path.join(dir, "modelos", "mini.gguf"), "x");
  const { modelos, activo } = listarModelos(dir);
  assert.equal(activo, "sencillo");
  assert.ok(modelos.some((m) => m.id === "sencillo" && m.instalado));
  assert.ok(modelos.some((m) => m.id === "gguf:mini.gguf"));
});
