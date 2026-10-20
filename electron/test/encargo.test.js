import assert from "node:assert/strict";
import test from "node:test";
import {
  armarEncargo,
  bloquesConCache,
  clasificarRespuesta,
  escritoDesdeRespuesta,
  marcarCitas,
  partirEscrito,
  piezasDelEncargo,
  partesEncargo,
  unirPartes,
} from "../compartido/encargo.js";

const piezas = [
  { id: 1, nombre: "CGP", tipo: "norma", texto: "Se puede citar el artículo 82.", activa: true },
  { id: 2, nombre: "Vieja", tipo: "norma", texto: "Aquí aparece el artículo 99.", activa: false },
  { id: 3, nombre: "Tono", tipo: "estilo", texto: "Trato de usted.", activa: 1 },
];

test("el parser arma secciones con títulos libres y, si no hay títulos, un solo bloque", () => {
  const escrito = partirEscrito("Asunto: Solicitud de copias\n\n## Solicitud\n\nPido las copias del expediente.\n\n## Cierre\n\nAtentamente.");
  assert.equal(escrito.asunto, "Solicitud de copias");
  assert.deepEqual(escrito.secciones.map((seccion) => seccion.titulo), ["Solicitud", "Cierre"]);
  assert.deepEqual(escrito.secciones[0].parrafos, ["Pido las copias del expediente."]);

  const bloque = partirEscrito("```\nSolo pido que se expida copia.\n```");
  assert.equal(bloque.asunto, "Escrito");
  assert.equal(bloque.secciones.length, 1);
  assert.equal(bloque.secciones[0].titulo, "Escrito");
  assert.deepEqual(bloque.secciones[0].parrafos, ["Solo pido que se expida copia."]);
  assert.deepEqual(partirEscrito("   ").secciones, []);
});

test("el memorial se parte en lineamientos, caso y petición, con dos cortes de caché", () => {
  const partes = partesEncargo({
    contexto: "Juzgado 2",
    peticion: "solicito copias",
    piezas,
    hoy: "1 de octubre de 2026",
  });
  assert.deepEqual(partes.map((p) => p.clave), ["lineamientos", "caso", "vuelta"]);
  assert.equal(partes.filter((p) => p.cache).length, 2);
  assert.equal(unirPartes(partes), armarEncargo({ contexto: "Juzgado 2", peticion: "solicito copias", piezas, hoy: "1 de octubre de 2026" }));
  assert.ok(partes[0].texto.includes("Lineamientos"));
  assert.ok(partes[1].texto.includes("Expediente:"));
  assert.equal(partes[1].texto.includes("Petición del usuario"), false);
  const bloques = bloquesConCache(partes);
  assert.equal(bloques.filter((b) => b.cache_control).length, 2);
  assert.equal(bloques.map((b) => b.text).join(""), unirPartes(partes));
  const deMas = bloquesConCache(Array.from({ length: 6 }, (_, i) => ({ cache: true, texto: `parte ${i}` })));
  assert.equal(deMas.filter((b) => b.cache_control).length, 4);
});

test("una pieza apagada o quitada para esta generación no entra al encargo", () => {
  const encargo = armarEncargo({
    contexto: "Juzgado 2",
    peticion: "solicito copias",
    piezas,
  });
  assert.match(encargo, /tres a cinco palabras/);
  assert.match(encargo, /artículo 82/);
  assert.match(encargo, /Trato de usted/);
  assert.doesNotMatch(encargo, /artículo 99/);
  assert.deepEqual(piezasDelEncargo(piezas).map((pieza) => pieza.id), [1, 3]);

  const sinCgp = armarEncargo({
    contexto: "Juzgado 2",
    peticion: "solicito copias",
    piezas,
    excluir: [1],
  });
  assert.doesNotMatch(sinCgp, /artículo 82/);
  assert.match(sinCgp, /Trato de usted/);
  const conEjemplo = armarEncargo({
    contexto: "Juzgado 2",
    peticion: "sustituyo el poder",
    ejemplo: "El poder se sustituye a Ana",
    referencia: "Sustitución de poder",
  });
  assert.match(conEjemplo, /El poder se sustituye a Ana/);
  assert.match(conEjemplo, /Sustitución de poder/);
});

test("una cita que el modelo inventa y no está en la biblioteca queda marcada", () => {
  const fuentes = "El artículo 82 del Código General del Proceso y el Decreto 2591.";
  const marcado = marcarCitas([
    {
      titulo: "Fundamentos",
      parrafos: ["Conforme al artículo 82 y al artículo 99 del Código, y al Art. 8."],
    },
  ], fuentes);
  const parrafo = marcado[0].parrafos[0];
  assert.equal(parrafo.includes("artículo 82 [Cita no aportada]"), false);
  assert.equal(parrafo.includes("artículo 99 [Cita no aportada]"), true);
  assert.equal(parrafo.includes("Art. 8 [Cita no aportada]"), true);

  const escrito = escritoDesdeRespuesta(
    "Asunto: Tutela\n\n## Fundamentos\n\nInvoco el Decreto 2591 y la Ley 999 de 2020.",
    fuentes,
  );
  assert.equal(escrito.asunto, "Tutela");
  const texto = escrito.secciones[0].parrafos[0];
  assert.equal(texto.includes("Decreto 2591 [Cita no aportada]"), false);
  assert.equal(texto.includes("Ley 999 de 2020 [Cita no aportada]"), true);
});

test("un bloque de dudas no produce secciones y un memorial sin ese bloque sigue siendo el escrito", () => {
  const dudas = clasificarRespuesta("DUDAS:\n1. ¿Contra quién se dirige?\n2. ¿Qué pretende que ordene el juez?\n3. ¿Cuál es el plazo?\n4. ¿Qué derecho invoca?\n5. ¿Hay otra tutela?");
  assert.equal(dudas.tipo, "dudas");
  assert.equal(dudas.preguntas.length, 4);
  assert.equal(dudas.preguntas[0], "¿Contra quién se dirige?");
  assert.equal("secciones" in dudas, false);

  const sueltas = clasificarRespuesta("¿Contra quién se dirige?\n¿Qué pretende?");
  assert.deepEqual(sueltas.preguntas, ["¿Contra quién se dirige?", "¿Qué pretende?"]);

  const escrito = clasificarRespuesta("Asunto: Copias\n\n## Solicitud\n\n¿Me pueden expedir las copias del expediente?");
  assert.equal(escrito.tipo, "escrito");
  assert.deepEqual(escrito.secciones.map((seccion) => seccion.titulo), ["Solicitud"]);

  const bloque = clasificarRespuesta("Solo pido que se expida copia.");
  assert.equal(bloque.tipo, "escrito");
  assert.equal(bloque.secciones[0].titulo, "Escrito");
});

test("la segunda vuelta incluye la respuesta y una duda repetida no abre otra ronda", () => {
  const encargo = armarEncargo({
    contexto: "Juzgado 2",
    peticion: "solicito copias",
    aclaracion: {
      preguntas: ["¿Contra quién se dirige?"],
      respuesta: "Contra el hospital.",
    },
  });
  assert.match(encargo, /Contra el hospital/);
  assert.match(encargo, /última vuelta/);
  assert.match(encargo, /No hagas más preguntas/);
  assert.doesNotMatch(encargo, /responde únicamente así/);

  const cerrado = clasificarRespuesta(
    "DUDAS:\n1. ¿Algo más?\n\nAsunto: Copias\n\n## Solicitud\n\nPido las copias.",
    { cerrar: true },
  );
  assert.equal(cerrado.tipo, "escrito");
  assert.equal(cerrado.asunto, "Copias");
  assert.deepEqual(cerrado.secciones.map((seccion) => seccion.titulo), ["Solicitud"]);

  const vacio = clasificarRespuesta("DUDAS:\n1. ¿Otra pregunta?", { cerrar: true });
  assert.equal(vacio.tipo, "escrito");
  assert.deepEqual(vacio.secciones, []);
});
