import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import {
  PERFILES_SEMILLA, armarEncargoDocumento, armarEncargoPasaje, claseDePieza, contarAvisos, diferencias,
  escritoDeTexto, fragmentosRelevantes, interpretarRespuesta, leerEtiquetas, marcarCitasDocumento,
  partesEncargoDocumento, plantillaBasica, reemplazarPasaje, textoDeEscrito, textoVisible, topeDeVuelta, trocear,
  bloqueBusqueda, busquedasDeFragmentos, contenidoCitable, documentosDeArchivos,
} from "../compartido/documentos.js";
import { bloquesConCache, unirPartes } from "../compartido/encargo.js";
import { abrirBase, run, uno } from "../src/db.js";
import { buscarFuentes, guardarPieza, listarPiezas, activarPieza } from "../src/biblioteca.js";
import {
  borrarProyecto, citasDeVersion, conversar, prepararVuelta, crearProyecto, duplicarProyecto, elegirFuentes, guardarPerfil, guardarVersion,
  leerProyecto, listarPerfiles, listarProyectos, restaurarVersion, actualizarProyecto, borrarVersion,
  prepararRevision, revisarCitas, pendientesDeVersion,
} from "../src/documentos.js";
import { textoDePdf } from "../src/pdftexto.js";

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-docs-"));
  const db = abrirBase(path.join(dir, "grokvig.sqlite"));
  return {
    db,
    dir,
    borrar() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const LEY = Array.from({ length: 60 }, (_, i) => `Artículo ${i + 1}. Disposición general número ${i + 1} sobre contratos de arrendamiento y obligaciones del arrendador.`).join("\n\n")
  + "\n\nArtículo 61. El derecho fundamental a la salud es autónomo e irrenunciable y comprende el acceso a los servicios de salud de manera oportuna.";

test("trocear parte por párrafos y respeta el tamaño", () => {
  const trozos = trocear(LEY, { tamano: 500 });
  assert.ok(trozos.length > 5);
  assert.ok(trozos.every((t) => t.texto.length <= 750));
  assert.deepEqual(trozos.map((t) => t.orden), trozos.map((_, i) => i));
  assert.deepEqual(trocear(""), []);
});

test("BM25 trae el fragmento que sirve y cabe en el presupuesto", () => {
  const fuentes = [
    { id: 1, nombre: "Ley de arrendamiento y salud", clase: "ley", texto: LEY },
    { id: 2, nombre: "Nota corta", clase: "nota", texto: "Trato de usted." },
  ];
  const elegidos = fragmentosRelevantes(fuentes, "tutela por el derecho fundamental a la salud oportuna", { presupuesto: 900, tamano: 400 });
  const total = elegidos.reduce((suma, f) => suma + f.texto.length, 0);
  assert.ok(total <= 900);
  assert.ok(elegidos.some((f) => /derecho fundamental a la salud/.test(f.texto)));
  assert.ok(elegidos.some((f) => f.fuente.id === 2 && f.entero), "la nota corta entra entera");
  assert.ok(!elegidos.some((f) => /número 3 sobre/.test(f.texto)));
});

test("el encargo lleva perfil, lineamientos, documento actual y el pedido; el local es más corto", () => {
  const largo = "x".repeat(20000);
  const base = {
    tipo: "tutela",
    perfil: { nombre: "Constitucionalista", instrucciones: "Explica la subsidiariedad.", estilo: "Párrafos cortos." },
    expediente: "Radicado: 123",
    fragmentos: [{ fuente: { nombre: "T-760 de 2008", clase: "jurisprudencia" }, orden: 0, texto: "La sentencia T-760 de 2008 trata la salud.", entero: true }],
    historia: [{ rol: "usuario", texto: "Hola" }, { rol: "asistente", texto: "Listo" }],
    documento: `Asunto: Tutela\n\n## Hechos\n${largo}`,
    pedido: "hazlo más corto",
  };
  const nube = armarEncargoDocumento({ ...base, origen: "nube" });
  const local = armarEncargoDocumento({ ...base, origen: "local" });
  for (const t of [nube, local]) {
    assert.match(t, /Tutela/);
    assert.match(t, /Explica la subsidiariedad/);
    assert.match(t, /Párrafos cortos/);
    assert.match(t, /\[Cita no aportada\]/);
    assert.match(t, /T-760 de 2008/);
    assert.match(t, /Mensaje del usuario:\nhazlo más corto$/);
    assert.match(t, /Documento actual/);
    assert.doesNotMatch(t, /DUDAS:/, "con documento ya escrito no vuelve a preguntar");
  }
  assert.ok(local.length < nube.length);
  const primera = armarEncargoDocumento({ ...base, documento: "", origen: "nube" });
  assert.match(primera, /DUDAS:/);
  const partes = partesEncargoDocumento({ ...base, origen: "nube", agentes: "Lenguaje claro.", archivos: "### a.pdf, página 1\nHecho del archivo.", memoria: "Tercera persona." });
  const armado = unirPartes(partes);
  assert.equal(partes.filter((p) => p.cache).map((p) => p.clave).join(","), "instrucciones,caso");
  assert.ok(partes[0].texto.includes("AGENTS.md"));
  assert.ok(partes[1].texto.includes("Expediente:"));
  assert.ok(partes[1].texto.includes("Archivos del proyecto"));
  assert.equal(partes[1].estable.includes("Hecho del archivo"), false);
  assert.equal(partes[1].estable.includes("Archivos del proyecto"), false);
  assert.equal(partes[2].sinFuentes.includes("T-760"), false);
  assert.ok(partes[2].texto.includes("T-760"));
  assert.equal(partes[1].texto.includes("Memoria del documento"), false);
  assert.ok(partes[2].texto.includes("Memoria del documento"));
  assert.ok(armado.indexOf("Fuentes del usuario") < armado.indexOf("Memoria del documento"));
  assert.ok(armado.indexOf("Memoria del documento") < armado.indexOf("Conversación anterior"));
  const bloques = bloquesConCache(partes);
  assert.equal(bloques.filter((b) => b.cache_control).length, 2);
  assert.equal(bloques.map((b) => b.text).join(""), armado);
  assert.deepEqual(bloques[0].cache_control, { type: "ephemeral" });
  assert.equal(bloques[2].cache_control, undefined);
  assert.deepEqual(topeDeVuelta(false), { maxTokens: 16000, esfuerzo: "high" });
  assert.deepEqual(topeDeVuelta(true), { maxTokens: 8000, esfuerzo: "medium" });
  const pasaje = armarEncargoPasaje({ tipo: "contrato", documento: "Asunto: C\n\n## Objeto\nEl objeto es X.", pasaje: "El objeto es X.", pedido: "más formal", origen: "local" });
  assert.match(pasaje, /Pasaje que debes reescribir:\nEl objeto es X\./);
});

test("anthropic manda search_result y document, y la caché no cubre los fragmentos", () => {
  const pieza = bloqueBusqueda({ fuente: { id: 9, nombre: "T-760 de 2008" }, texto: "La sentencia trata la salud.", entero: true });
  assert.equal(pieza.source, "pieza:9");
  assert.equal(pieza.title, "T-760 de 2008");
  assert.deepEqual(pieza.citations, { enabled: true });
  assert.deepEqual(pieza.content, [{ type: "text", text: "La sentencia trata la salud." }]);
  const pagina = bloqueBusqueda({ archivo_id: 4, nombre: "demanda.pdf", pagina: 2, texto: "El demandado fue notificado." });
  assert.equal(pagina.source, "archivo:4:2");
  assert.equal(pagina.title, "demanda.pdf, página 2");
  assert.equal(bloqueBusqueda({ texto: "sin id" }), null);

  const { documentos, mapa } = documentosDeArchivos(
    [{ id: 4, nombre: "demanda.pdf" }, { id: 8, nombre: "vacio.pdf" }],
    [
      { archivo_id: 4, pagina: 2, orden: 1, texto: "Segunda parte." },
      { archivo_id: 4, pagina: 1, orden: 0, texto: "Primer párrafo." },
      { archivo_id: 4, pagina: 1, orden: 2, texto: "Sigue en la uno." },
    ],
  );
  assert.equal(documentos.length, 1);
  assert.equal(documentos[0].source.type, "content");
  assert.deepEqual(documentos[0].source.content, [
    { type: "text", text: "Primer párrafo.\n\nSigue en la uno." },
    { type: "text", text: "Segunda parte." },
  ]);
  assert.deepEqual(documentos[0].citations, { enabled: true });
  assert.deepEqual(mapa, [{ id: 4, nombre: "demanda.pdf", paginas: [1, 2] }]);

  const base = {
    tipo: "tutela",
    perfil: { nombre: "Constitucionalista", instrucciones: "Explica la subsidiariedad." },
    expediente: "Radicado: 123",
    fragmentos: [{ fuente: { id: 9, nombre: "T-760 de 2008" }, orden: 0, texto: "La sentencia trata la salud.", entero: true }],
    documento: "Asunto: Tutela\n\n## Hechos\nUno.",
    pedido: "hazlo más corto",
    origen: "nube",
    archivos: "[demanda.pdf, página 1]\nHecho suelto que cambia.",
    memoria: "Tercera persona.",
  };
  const partes = partesEncargoDocumento(base);
  const busquedas = busquedasDeFragmentos([...base.fragmentos, { archivo_id: 4, nombre: "demanda.pdf", pagina: 2, texto: "El demandado fue notificado." }]);
  const uno = contenidoCitable({ partes, documentos, busquedas });
  const otro = contenidoCitable({
    partes,
    documentos,
    busquedas: busquedasDeFragmentos([{ fuente: { id: 3, nombre: "Ley 100" }, texto: "Otra norma, otra pregunta.", entero: true }]),
  });
  const corte = (bloques) => bloques.findIndex((b) => b.type === "document" && b.cache_control);
  assert.equal(uno.filter((b) => b.cache_control).length, 2);
  assert.equal(uno[0].type, "text");
  assert.deepEqual(uno[0].cache_control, { type: "ephemeral" });
  assert.equal(corte(uno), corte(otro));
  assert.equal(JSON.stringify(uno.slice(0, corte(uno) + 1)), JSON.stringify(otro.slice(0, corte(otro) + 1)));
  const busqueda = uno.findIndex((b) => b.type === "search_result");
  assert.ok(busqueda > corte(uno));
  assert.equal(uno[busqueda].cache_control, undefined);
  assert.equal(uno.some((b) => b.type === "text" && b.text.includes("Hecho suelto que cambia")), false);
  assert.ok(uno.some((b) => b.type === "text" && b.text.includes("Tercera persona")));
  assert.equal(uno.some((b) => b.type === "text" && b.text.includes("La sentencia trata la salud")), false);
  const plano = unirPartes(partes);
  assert.match(plano, /Hecho suelto que cambia/);
  assert.match(plano, /\[Cita no aportada\]/);
  const visible = textoVisible(uno, mapa);
  assert.match(visible, /demanda.pdf/);
  assert.match(visible, /Página 1/);
  assert.match(visible, /Primer párrafo/);
  assert.match(visible, /Página 2/);
  assert.match(visible, /pieza:9|T-760 de 2008/);
});

test("las citas de sentencias y leyes sin fuente quedan marcadas", () => {
  const secciones = [{ titulo: "Fundamentos", parrafos: [
    "Según la sentencia T-760 de 2008 y la Ley 1751 de 2015, la salud es fundamental.",
    "La Corte en la C-355 de 2006 dijo otra cosa.",
  ] }];
  const fuentes = "Sentencia T-760 de 2008: la salud es un derecho fundamental.";
  const marcado = marcarCitasDocumento(secciones, fuentes);
  assert.equal(marcado[0].parrafos[0], "Según la sentencia T-760 de 2008 y la Ley 1751 de 2015 [Cita no aportada], la salud es fundamental.");
  assert.equal(marcado[0].parrafos[1], "La Corte en la C-355 de 2006 [Cita no aportada] dijo otra cosa.");
  const otraVez = marcarCitasDocumento(marcado, fuentes);
  assert.deepEqual(otraVez, marcado, "no marca dos veces");
  assert.deepEqual(contarAvisos([...marcado, { titulo: "x", parrafos: ["[Dato pendiente: cédula]"] }]), { citas: 2, datos: 1 });
});

test("interpretarRespuesta separa dudas de documento", () => {
  const dudas = interpretarRespuesta("DUDAS:\n1. ¿Contra quién va la tutela?\n2. ¿Qué EPS?");
  assert.equal(dudas.tipo, "dudas");
  assert.equal(dudas.preguntas.length, 2);
  const docu = interpretarRespuesta("Asunto: Tutela salud\n\n## Hechos\nLa EPS negó el servicio según la Ley 100 de 1993.", { fuentes: "" });
  assert.equal(docu.tipo, "documento");
  assert.equal(docu.asunto, "Tutela salud");
  assert.equal(docu.avisos.citas, 1);
  assert.equal(interpretarRespuesta("").tipo, "vacio");
});

test("el texto del documento va y vuelve sin perder secciones", () => {
  const escrito = { asunto: "Contrato", secciones: [{ titulo: "Objeto", parrafos: ["Uno.", "Dos."] }, { titulo: "Precio", parrafos: ["Tres."] }] };
  const cuerpo = textoDeEscrito(escrito);
  assert.equal(cuerpo, "Asunto: Contrato\n\n## Objeto\nUno.\n\nDos.\n\n## Precio\nTres.");
  assert.deepEqual(escritoDeTexto(cuerpo), escrito);
});

test("diferencias por sección y párrafo", () => {
  const a = "Asunto: Tutela\n\n## Hechos\nUno.\n\nDos.\n\n## Peticiones\nPido A.";
  const b = "Asunto: Tutela\n\n## Hechos\nUno.\n\nDos, corregido.\n\nTres.\n\n## Peticiones\nPido A.";
  const dif = diferencias(a, b);
  assert.deepEqual(dif.cuenta, { agregado: 1, quitado: 0, cambiado: 1 });
  const hechos = dif.secciones.find((s) => s.seccion === "Hechos");
  assert.ok(hechos.cambios.some((c) => c.tipo === "cambiado" && c.antes === "Dos." && c.texto === "Dos, corregido."));
  assert.ok(hechos.cambios.some((c) => c.tipo === "agregado" && c.texto === "Tres."));
  const pet = dif.secciones.find((s) => s.seccion === "Peticiones");
  assert.ok(pet.cambios.every((c) => c.tipo === "igual"));
  assert.equal(diferencias("", "Asunto: X\n\n## A\nHola.").cuenta.agregado, 3);
});

test("reemplazarPasaje solo cambia un pasaje único", () => {
  assert.equal(reemplazarPasaje("Uno dos tres.", "dos", "DOS"), "Uno DOS tres.");
  assert.equal(reemplazarPasaje("a a", "a", "b"), null);
  assert.equal(reemplazarPasaje("abc", "zz", "b"), null);
  assert.equal(reemplazarPasaje("abc", "b", "  "), null);
});

test("etiquetas y clases de la biblioteca", () => {
  assert.deepEqual(leerEtiquetas(" Salud, tutela,salud ,, "), ["salud", "tutela"]);
  assert.equal(claseDePieza({ tipo: "norma" }), "ley");
  assert.equal(claseDePieza({ tipo: "ejemplo" }), "modelo");
  assert.equal(claseDePieza({ tipo: "estilo", clase: "jurisprudencia" }), "jurisprudencia");
  const plantilla = plantillaBasica({ tipo: "tutela", ficha: { despacho: "Juzgado 1", radicado: "123" }, pedido: "Tutela por salud" });
  assert.ok(plantilla.secciones.some((s) => s.titulo === "Derechos vulnerados"));
  assert.match(textoDeEscrito(plantilla), /\[Dato pendiente/);
});

test("la migración 11 agrega tablas, siembra tres perfiles y no rompe la biblioteca", () => {
  const tmp = temporal();
  try {
    for (const tabla of ["doc_perfil", "doc_proyecto", "doc_fuente", "doc_version", "doc_mensaje"]) {
      assert.ok(uno(tmp.db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [tabla]), tabla);
    }
    assert.deepEqual(listarPerfiles(tmp.db).map((p) => p.nombre).sort(), PERFILES_SEMILLA.map((p) => p.nombre).sort());
    const piezas = listarPiezas(tmp.db);
    assert.ok(piezas.every((p) => p.clase), "las piezas viejas reciben clase");
    assert.equal(piezas.filter((p) => p.clase === "ley").length, 3);
    const ley = guardarPieza(tmp.db, { nombre: "Ley larga", clase: "ley", etiquetas: "Salud, EPS", texto: LEY.repeat(10) });
    assert.equal(ley.tipo, "norma");
    assert.equal(ley.activa, false, "una fuente de Documentos no entra sola al escrito");
    assert.deepEqual(ley.etiquetas, ["salud", "eps"]);
    assert.throws(() => activarPieza(tmp.db, ley.id, true), /larga para el escrito/);
    assert.equal(buscarFuentes(tmp.db, { etiqueta: "eps" }).length, 1);
    assert.equal(buscarFuentes(tmp.db, { texto: "irrenunciable" })[0].id, ley.id);
    assert.equal(buscarFuentes(tmp.db, { clase: "jurisprudencia" }).length, 0);
    assert.throws(() => guardarPieza(tmp.db, { nombre: "Vieja", tipo: "norma", texto: "x".repeat(20001) }), /20000/);
  } finally {
    tmp.borrar();
  }
});

function modeloFalso(origen = "nube") {
  return () => ({ id: origen === "nube" ? "nube:openai" : "gguf:x", nombre: "Falso", usa: true, origen });
}

test("una conversación pregunta, redacta, revisa en versiones nuevas y reescribe un pasaje", async () => {
  const tmp = temporal();
  try {
    const perfil = listarPerfiles(tmp.db).find((p) => p.nombre === "Constitucionalista de tutelas");
    const fuente = guardarPieza(tmp.db, { nombre: "Sentencia T-760 de 2008", clase: "jurisprudencia", texto: "La sentencia T-760 de 2008 protege el derecho a la salud." });
    guardarPerfil(tmp.db, { ...perfil, fuentes: [fuente.id] });
    const proyecto = crearProyecto(tmp.db, { nombre: "Tutela salud", tipo: "tutela", perfil_id: perfil.id });
    assert.equal(proyecto.solo_local, true);
    await assert.rejects(conversar({ db: tmp.db, datosDir: tmp.dir, proyectoId: proyecto.id, mensaje: "x", resolverModelo: modeloFalso(), pedirTexto: async () => ({ texto: "" }) }), /Solo local/);
    actualizarProyecto(tmp.db, proyecto.id, { solo_local: false });
    await assert.rejects(conversar({ db: tmp.db, datosDir: tmp.dir, proyectoId: proyecto.id, mensaje: "x", resolverModelo: modeloFalso(), pedirTexto: async () => ({ texto: "" }) }), /Revise el envío/);
    assert.deepEqual(leerProyecto(tmp.db, proyecto.id).fuentes, [fuente.id], "el perfil trae sus fuentes");
    const encargos = [];
    const respuestas = [
      "DUDAS:\n1. ¿Qué EPS negó el servicio?",
      "Asunto: Tutela salud\n\n## Hechos\nLa EPS Sana negó la cirugía.\n\n## Fundamentos\nSegún la sentencia T-760 de 2008 y la Ley 1751 de 2015 la salud es fundamental.",
      "Asunto: Tutela salud\n\n## Hechos\nLa EPS Sana negó la cirugía.",
      "La EPS Sana se negó a autorizar la cirugía ordenada.",
    ];
    const pedirTexto = async ({ encargo, onProgreso }) => {
      encargos.push(encargo);
      onProgreso?.({ texto: "parcial" });
      return { texto: respuestas.shift(), nombre: "Falso", origen: "nube" };
    };
    const avances = [];
    const comun = { db: tmp.db, datosDir: tmp.dir, proyectoId: proyecto.id, pedirTexto, resolverModelo: modeloFalso(), onProgreso: (a) => avances.push(a) };
    let r = await confirmar({ ...comun, mensaje: "Necesito una tutela por salud" });
    assert.equal(r.versiones.length, 0);
    assert.deepEqual(r.mensajes.at(-1).dudas, ["¿Qué EPS negó el servicio?"]);
    r = await confirmar({ ...comun, mensaje: "La EPS Sana" });
    assert.match(encargos[1], /Aclaración del usuario/);
    assert.match(encargos[1], /La sentencia T-760 de 2008 protege/);
    assert.equal(r.actual.numero, 1);
    assert.match(r.actual.cuerpo, /T-760 de 2008 y/);
    assert.match(r.actual.cuerpo, /Ley 1751 de 2015 \[Cita no aportada\]/);
    assert.equal(r.actual.avisos.citas, 1);
    assert.equal(avances[0].proyectoId, proyecto.id);
    r = await confirmar({ ...comun, mensaje: "hazlo más corto" });
    assert.equal(r.actual.numero, 2, "revisar deja una versión nueva");
    assert.equal(r.versiones.length, 2);
    assert.match(encargos[2], /Documento actual/);
    r = await confirmar({ ...comun, mensaje: "más formal", pasaje: "La EPS Sana negó la cirugía." });
    assert.equal(r.actual.numero, 3);
    assert.match(r.actual.cuerpo, /se negó a autorizar la cirugía ordenada/);
    r = await confirmar({ ...comun, mensaje: "agrega un hecho", documento: "Asunto: Tutela salud\n\n## Hechos\nTexto editado por mí." , pedirTexto: async ({ encargo }) => { encargos.push(encargo); return { texto: "Asunto: Tutela salud\n\n## Hechos\nTexto editado por mí.\n\nOtro hecho.", origen: "nube" }; } });
    assert.match(encargos.at(-1), /Texto editado por mí/, "el agente sigue desde la edición");
    assert.equal(r.versiones.find((v) => v.numero === 4).autor, "usuario");
    assert.equal(r.actual.numero, 5);
    const restaurada = restaurarVersion(tmp.db, r.versiones.find((v) => v.numero === 1).id);
    assert.equal(restaurada.numero, 6);
    assert.equal(restaurada.autor, "restaurada");
    assert.equal(leerProyecto(tmp.db, proyecto.id).mensajes.filter((m) => m.rol === "usuario").length, 5);
  } finally {
    tmp.borrar();
  }
});

test("con Sencillo arma la plantilla y no revisa; un fallo del modelo no toca el documento", async () => {
  const tmp = temporal();
  try {
    const p = crearProyecto(tmp.db, { nombre: "Contrato", tipo: "contrato" });
    const sencillo = () => ({ id: "sencillo", nombre: "Sencillo", usa: false, origen: "local" });
    let r = await conversar({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "Arriendo de local", resolverModelo: sencillo });
    assert.equal(r.actual.numero, 1);
    assert.equal(r.actual.autor, "plantilla");
    r = await conversar({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "más corto", resolverModelo: sencillo });
    assert.equal(r.actual.numero, 1);
    r = await conversar({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "más corto", resolverModelo: modeloFalso("local"), pedirTexto: async () => { throw new Error("motor"); } });
    assert.equal(r.error, true);
    assert.equal(r.actual.numero, 1);
    assert.match(r.mensajes.at(-1).texto, /no respondió/);
  } finally {
    tmp.borrar();
  }
});

test("borrar una versión deja al menos una y suelta los mensajes", () => {
  const tmp = temporal();
  try {
    const p = crearProyecto(tmp.db, { nombre: "M", tipo: "memorial" });
    const v1 = guardarVersion(tmp.db, p.id, { cuerpo: "Asunto: M\n\n## A\nUno." });
    assert.throws(() => borrarVersion(tmp.db, v1.id), /única versión/);
    const v2 = guardarVersion(tmp.db, p.id, { cuerpo: "Asunto: M\n\n## A\nDos." });
    run(tmp.db, "INSERT INTO doc_mensaje (proyecto_id, rol, texto, version_id, dudas, origen, creado_en) VALUES (?, 'asistente', 'listo', ?, '', 'local', 'x')", [p.id, v1.id]);
    const ultima = borrarVersion(tmp.db, v1.id);
    assert.equal(ultima.numero, 2);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM doc_version WHERE proyecto_id = ?", [p.id]).n), 1);
    assert.equal(uno(tmp.db, "SELECT version_id FROM doc_mensaje WHERE proyecto_id = ?", [p.id]).version_id, null);
    assert.throws(() => borrarVersion(tmp.db, 99999), /ya no está/);
  } finally {
    tmp.borrar();
  }
});

test("el proyecto nace solo local salvo que se pida lo contrario", () => {
  const tmp = temporal();
  try {
    const a = crearProyecto(tmp.db, { nombre: "A", tipo: "tutela" });
    assert.equal(leerProyecto(tmp.db, a.id).proyecto.solo_local, true);
    const b = crearProyecto(tmp.db, { nombre: "B", tipo: "tutela", solo_local: false });
    assert.equal(leerProyecto(tmp.db, b.id).proyecto.solo_local, false);
    const c = duplicarProyecto(tmp.db, b.id);
    assert.equal(leerProyecto(tmp.db, c.id).proyecto.solo_local, false);
    actualizarProyecto(tmp.db, a.id, { solo_local: false });
    assert.equal(leerProyecto(tmp.db, a.id).proyecto.solo_local, false);
  } finally {
    tmp.borrar();
  }
});

test("proyectos: renombrar, duplicar, archivar, vincular expediente y borrar", () => {
  const tmp = temporal();
  try {
    run(tmp.db, "INSERT INTO radicado (numero) VALUES ('11001400300120240000100')");
    run(tmp.db, "INSERT INTO proceso (id_proceso, radicado, despacho) VALUES (7, '11001400300120240000100', 'Juzgado 1 Civil')");
    const p = crearProyecto(tmp.db, { nombre: "Memorial", tipo: "memorial", id_proceso: 7 });
    const fuente = guardarPieza(tmp.db, { nombre: "Nota", clase: "nota", texto: "Breve." });
    elegirFuentes(tmp.db, p.id, [fuente.id, 9999]);
    guardarVersion(tmp.db, p.id, { cuerpo: "Asunto: M\n\n## A\nUno." });
    assert.equal(guardarVersion(tmp.db, p.id, { cuerpo: "Asunto: M\n\n## A\nUno." }).numero, 1, "el mismo texto no repite versión");
    assert.equal(actualizarProyecto(tmp.db, p.id, { nombre: "Memorial nuevo" }).nombre, "Memorial nuevo");
    const copia = duplicarProyecto(tmp.db, p.id);
    const leida = leerProyecto(tmp.db, copia.id);
    assert.equal(leida.proyecto.nombre, "Memorial nuevo (copia)");
    assert.equal(leida.proyecto.radicado, "11001400300120240000100");
    assert.deepEqual(leida.fuentes, [fuente.id]);
    assert.equal(leida.versiones.length, 1);
    actualizarProyecto(tmp.db, p.id, { archivado: true });
    assert.deepEqual(listarProyectos(tmp.db).map((x) => x.id), [copia.id]);
    assert.deepEqual(listarProyectos(tmp.db, { archivados: true }).map((x) => x.id), [p.id]);
    assert.throws(() => crearProyecto(tmp.db, { nombre: "X", id_proceso: 999 }), /expediente/);
    borrarProyecto(tmp.db, p.id);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM doc_version WHERE proyecto_id = ?", [p.id]).n), 0);
    assert.ok(uno(tmp.db, "SELECT id FROM pieza WHERE id = ?", [fuente.id]), "borrar un proyecto no borra la fuente");
    assert.ok(uno(tmp.db, "SELECT id_proceso FROM proceso WHERE id_proceso = 7"));
  } finally {
    tmp.borrar();
  }
});

function pdfDePrueba(contenido) {
  const flujo = zlib.deflateSync(Buffer.from(contenido, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + flujo.length + " /Filter /FlateDecode >>\nstream\n", "latin1"),
    flujo,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
}

test("el PDF con texto simple se lee y uno sin texto avisa", async () => {
  const pdf = pdfDePrueba("BT /F1 12 Tf 72 720 Td (Art\\355culo 1. La salud es un derecho.) Tj 0 -14 Td [(Segunda ) -300 (l\\355nea)] TJ ET");
  const leido = textoDePdf(pdf);
  assert.equal(leido.ok, true);
  assert.match(leido.texto, /Artículo 1\. La salud es un derecho\./);
  assert.match(leido.texto, /Segunda +línea/);
  assert.equal(textoDePdf(Buffer.from("no")).ok, false);
  assert.equal(textoDePdf(pdfDePrueba("q 1 0 0 1 0 0 cm Q")).ok, false);
});

test("los tokens se estiman a 4 caracteres por token", async () => {
  const { estimarTokens } = await import("../compartido/documentos.js");
  assert.equal(estimarTokens(""), 1);
  assert.equal(estimarTokens("abcd"), 1);
  assert.equal(estimarTokens("abcdefgh"), 2);
  assert.ok(estimarTokens(" vols ".repeat(100)) > 100);
});

test("el gasto guarda tokens y costo por proyecto", async () => {
  const { abrirBase, guardarGasto, resumenGastos } = await import("../src/db.js");
  const { default: fs } = await import("node:fs");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-gasto-")), "base.sqlite");
  const db = abrirBase(ruta);
  guardarGasto(db, { proveedor: "meta", modelo: "muse-spark-1.3", motivo: "documento", proyectoId: 7, entrada: 1000000, salida: 1000000, costo: 5.5 });
  guardarGasto(db, { proveedor: "meta", modelo: "muse-spark-1.3", motivo: "prueba", proyectoId: null, entrada: 0, salida: 0, costo: 0 });
  guardarGasto(db, { entrada: -5, salida: "x" });
  const r = resumenGastos(db, {});
  assert.equal(r.totales.llamadas, 1);
  assert.equal(r.totales.entrada, 1000000);
  assert.equal(r.totales.costo, 5.5);
  assert.equal(r.porProveedor.length, 1);
  assert.equal(r.porProyecto.length, 1);
  assert.equal(r.porProyecto[0].proyecto, 7);
  assert.equal(r.recientes.length, 1);
  db.close();
});

test("el último gasto del proyecto trae sus tokens", async () => {
  const { abrirBase, guardarGasto, ultimoGasto } = await import("../src/db.js");
  const { default: fs } = await import("node:fs");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-gasto2-")), "base.sqlite");
  const db = abrirBase(ruta);
  assert.equal(ultimoGasto(db, 9), null);
  guardarGasto(db, { proveedor: "meta", modelo: "muse-spark-1.3", motivo: "documento", proyectoId: 9, entrada: 800000, salida: 80000, costo: 1.34 });
  const u = ultimoGasto(db, 9);
  assert.equal(u.entrada + u.salida, 880000);
  assert.equal(ultimoGasto(db, 10), null);
  db.close();
});

test("la migración 21 crea doc_cita en una base que ya estaba en la 20", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-cita-mig-"));
  const ruta = path.join(dir, "grokvig.sqlite");
  const previa = new DatabaseSync(ruta);
  previa.exec(`
    CREATE TABLE schema_migracion (
      version INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      aplicada_en TEXT NOT NULL
    );
    INSERT INTO schema_migracion (version, nombre, aplicada_en) VALUES (20, 'juzgados aprendidos', '2026-01-01');
  `);
  previa.close();
  const db = abrirBase(ruta);
  try {
    assert.equal(uno(db, "SELECT nombre FROM schema_migracion WHERE version = 21").nombre, "citas del documento");
    const cols = db.prepare("PRAGMA table_info(doc_cita)").all();
    assert.deepEqual(cols.map((c) => c.name), ["id", "version_id", "bloque_id", "inicio", "fin", "fuente_tipo", "fuente_id", "pagina", "texto_citado", "creado_en"]);
    assert.equal(cols.find((c) => c.name === "version_id").notnull, 0);
    assert.equal(cols.find((c) => c.name === "pagina").notnull, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("una vuelta guarda las citas en la versión y borrar la versión las quita", async () => {
  const tmp = temporal();
  try {
    const p = crearProyecto(tmp.db, { nombre: "T", tipo: "tutela" });
    const texto = "Asunto: Tutela salud\n\n## Hechos\nLa EPS Sana negó la cirugía.\n\n## Pretensiones\nQue se ordene el tratamiento.";
    const span = "La EPS Sana negó la cirugía.";
    const inicio = texto.indexOf(span);
    const cita = { inicio, fin: inicio + span.length, fuente_tipo: "pieza", fuente_id: "9", pagina: null, texto_citado: "negó la cirugía" };
    const dudas = await conversar({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "tutela",
      resolverModelo: modeloFalso("local"),
      pedirTexto: async () => ({ texto: "DUDAS:\n1. ¿Cuál EPS?", origen: "local", citas: [cita] }),
    });
    assert.ok(dudas.mensajes.at(-1).dudas);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM doc_cita").n), 0);
    const r = await conversar({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "La EPS Sana",
      resolverModelo: modeloFalso("local"),
      pedirTexto: async () => ({ texto, origen: "local", citas: [cita, { inicio: 0, fin: 1, fuente_tipo: "", fuente_id: "" }] }),
    });
    const filas = tmp.db.prepare("SELECT * FROM doc_cita").all();
    assert.equal(filas.length, 1);
    assert.equal(filas[0].version_id, r.actual.id);
    assert.equal(filas[0].fuente_tipo, "pieza");
    assert.equal(filas[0].fuente_id, "9");
    assert.equal(filas[0].texto_citado, "negó la cirugía");
    assert.equal(filas[0].pagina, null);
    const bloque = r.bloques.find((b) => b.texto.includes(span));
    assert.equal(filas[0].bloque_id, bloque.id);
    await conversar({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "más corto",
      resolverModelo: modeloFalso("local"),
      pedirTexto: async () => ({ texto: "Asunto: Tutela salud\n\n## Hechos\nTexto corto.", origen: "local" }),
    });
    borrarVersion(tmp.db, r.actual.id);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM doc_cita WHERE version_id = ?", [r.actual.id]).n), 0);
  } finally {
    tmp.borrar();
  }
});

test("las citas de una versión traen el nombre de la fuente", async () => {
  const tmp = temporal();
  try {
    const fuente = guardarPieza(tmp.db, { nombre: "T-760 de 2008", clase: "jurisprudencia", texto: "La sentencia protege la salud." });
    const p = crearProyecto(tmp.db, { nombre: "T", tipo: "tutela" });
    const texto = "Asunto: Tutela salud\n\n## Hechos\nLa salud es un derecho.";
    const r = await conversar({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "tutela",
      resolverModelo: modeloFalso("local"),
      pedirTexto: async () => ({
        texto, origen: "local",
        citas: [{ inicio: texto.indexOf("La salud"), fin: texto.indexOf("La salud") + 8, fuente_tipo: "pieza", fuente_id: String(fuente.id), pagina: 2, texto_citado: "protege la salud" }],
      }),
    });
    const citas = citasDeVersion(tmp.db, r.actual.id);
    assert.equal(citas.length, 1);
    assert.equal(citas[0].titulo, "T-760 de 2008");
    assert.equal(citas[0].fuente_tipo, "pieza");
    assert.equal(citas[0].fuente_id, String(fuente.id));
    assert.equal(citas[0].pagina, 2);
    assert.equal(citas[0].texto_citado, "protege la salud");
    assert.equal(citasDeVersion(tmp.db, 0).length, 0);
  } finally {
    tmp.borrar();
  }
});

test("revisar citas guarda los pendientes y el costo del revisor", async () => {
  const tmp = temporal();
  try {
    const p = crearProyecto(tmp.db, { nombre: "T", tipo: "tutela" });
    const texto = "Asunto: Tutela\n\n## Hechos\nLa EPS debe cubrir el medicamento.";
    const r = await conversar({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "tutela",
      resolverModelo: modeloFalso("local"),
      pedirTexto: async () => ({ texto, origen: "local" }),
    });
    await assert.rejects(
      () => revisarCitas({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, versionId: r.actual.id, documento: texto, confirmado: "x", pedirTexto: async () => ({ texto: "Ninguna" }) }),
      /Solo local/,
    );
    actualizarProyecto(tmp.db, p.id, { solo_local: false });
    const previa = prepararRevision({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, documento: texto });
    assert.match(previa.encargo, /claude-haiku|No uses JSON|Revisa el borrador/);
    assert.match(previa.informe.modelo, /Haiku/);
    await assert.rejects(
      () => revisarCitas({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, versionId: r.actual.id, documento: texto, confirmado: "no", pedirTexto: async () => ({ texto: "Ninguna" }) }),
      /Revise el envío/,
    );
    let pedido = null;
    const hecho = await revisarCitas({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, versionId: r.actual.id, documento: texto, confirmado: previa.informe.hash,
      pedirTexto: async ({ modelo, onUso, citable }) => {
        pedido = { modelo, citable };
        onUso?.({ proveedor: "anthropic", modelo, entrada: 1200, salida: 80 });
        return { texto: "- [Hechos] La EPS debe cubrir el medicamento.\n" };
      },
    });
    assert.equal(pedido.modelo, "claude-haiku-5-5");
    assert.equal(hecho.pendientes.length, 1);
    assert.equal(hecho.pendientes[0].parrafo, "Hechos");
    assert.equal(pendientesDeVersion(tmp.db, r.actual.id).length, 1);
    assert.equal(uno(tmp.db, "SELECT motivo, modelo FROM gasto_nube").motivo, "revisor");
    assert.equal(uno(tmp.db, "SELECT modelo FROM gasto_nube").modelo, "claude-haiku-5-5");
    const vacio = await revisarCitas({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, versionId: r.actual.id, documento: texto, confirmado: previa.informe.hash,
      pedirTexto: async () => ({ texto: "Ninguna" }),
    });
    assert.equal(vacio.pendientes.length, 0);
    await revisarCitas({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, versionId: r.actual.id, documento: texto, confirmado: previa.informe.hash,
      pedirTexto: async ({ onUso }) => {
        onUso?.({ proveedor: "anthropic", modelo: "claude-haiku-5-5", entrada: 10, salida: 4 });
        return { texto: "- [Hechos] Falta el soporte.\n" };
      },
    });
    await conversar({
      db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "más corto",
      resolverModelo: modeloFalso("local"),
      pedirTexto: async () => ({ texto: "Asunto: Tutela\n\n## Hechos\nTexto corto.", origen: "local" }),
    });
    borrarVersion(tmp.db, r.actual.id);
    assert.equal(pendientesDeVersion(tmp.db, r.actual.id).length, 0);
  } finally {
    tmp.borrar();
  }
});

async function confirmar(args) {
  const previa = prepararVuelta(args);
  return conversar({ ...args, confirmado: previa.informe?.hash || "" });
}
