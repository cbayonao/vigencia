import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FUENTES, contarTablero, diasDeSemana, fechaIso, fechasEnTexto, filtrarProcesos, firmaEstado, icsDeAudiencias, instanteAudiencia,
  lineaDeTiempo, mesCalendario, modalidadEn, proximasAudiencias, recordatoriosDebidos, registrosDeEstado, sugerirAudiencias, unificarProcesos,
} from "../compartido/misprocesos.js";
import { SISTEMAS } from "../compartido/sistemas.js";
import { abrirBase, filas, uno } from "../src/db.js";
import {
  archivarProceso, detalleMisProcesos, guardarActuacionManual, guardarAudiencia, guardarDesdeEstado, guardarManual, guardarPropia,
  descartarSugerencia, icsDe, listarMisProcesos, radicadosSeguidos, tomarRecordatorios, vincularProceso,
} from "../src/misprocesos.js";
import { ejecutarTrabajo } from "../src/rama.js";

const RAD = "11001311002220220083900";
const RAD2 = "11001311002220230020600";

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-mis-"));
  const db = abrirBase(path.join(dir, "grokvig.sqlite"));
  return { dir, db, borrar() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("fechas cortas de audiencia del estado, nombres de mes, dd/mm/aaaa y horas", () => {
  const base = { base: "2024-06-11" };
  assert.deepEqual(fechasEnTexto("(audiencia VIRTUAL sp.30/24 08:30am )", base), [{ fecha: "2024-09-30", hora: "08:30" }]);
  assert.deepEqual(fechasEnTexto("audiencia PRESENCIAL ag.05/24 2pm", base), [{ fecha: "2024-08-05", hora: "14:00" }]);
  assert.deepEqual(fechasEnTexto("para el 15 de marzo de 2025 a las 9:00 a.m.", base), [{ fecha: "2025-03-15", hora: "09:00" }]);
  assert.deepEqual(fechasEnTexto("el 3 de dic. 2pm", base), [{ fecha: "2024-12-03", hora: "14:00" }]);
  assert.deepEqual(fechasEnTexto("15/03/2025 a las 3 pm", base), [{ fecha: "2025-03-15", hora: "15:00" }]);
  assert.deepEqual(fechasEnTexto("septiembre 30 de 2024, 10:00", base), [{ fecha: "2024-09-30", hora: "10:00" }]);
  // Sin año: la próxima vez que cae esa fecha.
  assert.deepEqual(fechasEnTexto("jn.4 9am", base), [{ fecha: "2025-06-04", hora: "09:00" }]);
  assert.deepEqual(fechasEnTexto("en.15/25 12pm y fb.2/25 12am", base), [{ fecha: "2025-01-15", hora: "12:00" }, { fecha: "2025-02-02", hora: "00:00" }]);
  for (const t of ["en 30 días", "pag.12 del expediente", "nov.2024", "31/02/2024", "my.32/24"]) assert.deepEqual(fechasEnTexto(t, base), [], t);
  assert.equal(modalidadEn("audiencia VIRTUAL por Lifesize"), "virtual");
  assert.equal(modalidadEn("audiencia PRESENCIAL sala 3"), "presencial");
  assert.equal(fechaIso("2026-02-02T00:00:00"), "2026-02-02");
  assert.equal(fechaIso("12/06/2024"), "2024-06-12");
  assert.equal(fechaIso("ayer"), "");
});

test("las audiencias se sugieren de cualquier fuente, solo futuras y sin repetir lo guardado o descartado", () => {
  const acts = [
    { clave: "cn:1", fecha: "2024-06-11", actuacion: "Señala fechas para Audiencias", anotacion: "(audiencia PRESENCIAL ag.05/24 2pm )" },
    { clave: "cn:1", fecha: "2024-06-11", actuacion: "Fija fecha audiencia", anotacion: "15/03/2024 9am" },
    { clave: "cn:1", fecha: "2024-06-11", actuacion: "Auto de trámite", anotacion: "requiere 20/08/2024" },
  ];
  const s = sugerirAudiencias(acts, { hoy: "2024-06-12" });
  assert.deepEqual(s.map((x) => [x.fecha, x.hora, x.modalidad]), [["2024-08-05", "14:00", "presencial"]]);
  assert.deepEqual(sugerirAudiencias(acts, { hoy: "2024-06-12", conocidas: [s[0].ref] }), []);
});

test("unificar fuentes, filtros, vínculo pendiente y conteos del tablero", () => {
  const procesos = unificarProcesos({
    consulta: [{ id_proceso: 7, radicado: RAD, despacho: "JUZGADO 022 FAMILIA", clase_proceso: "Verbal", fecha_ultima_actuacion: "2024-06-11T00:00:00", ultima_actuacion: "Señala fechas", demandantes: "ANA · LUIS", cliente_id: 3, cliente_nombre: "Marta" }],
    samai: [{ guid: "g1", radicado: "25000233600020200012300", despacho: "Tribunal", clase: "Reparación directa", ultima_fecha: "01/01/2024" }],
    spoa: [{ noticia: "110016000000202400001", despacho: "Fiscalía 12", estado: "Activo", etapa: "Indagación" }],
    manuales: [
      { id: 1, origen: "estados", radicado: RAD, despacho: "JUZGADO 022", creado_en: "2024-06-12" },
      { id: 2, origen: "manual", radicado: "", despacho: "Notaría 5", demandante: "Pedro", cliente: "Pedro Gómez", creado_en: "2024-06-10" },
      { id: 3, origen: "estados", radicado: RAD2, vinculo: "cn:9" },
    ],
    marcas: [{ clave: "sp:110016000000202400001", archivado: 1 }],
    hoy: "2024-06-12",
  });
  assert.deepEqual(procesos.map((p) => p.clave), ["ma:1", "cn:7", "ma:2", "sa:g1", "sp:110016000000202400001"]);
  assert.equal(procesos.find((p) => p.clave === "cn:7").demandante, "ANA, LUIS");
  assert.equal(procesos.find((p) => p.clave === "ma:1").vinculable, "cn:7");
  assert.equal(procesos.find((p) => p.clave === "ma:2").fuente, "manual");
  assert.equal(filtrarProcesos(procesos, {}).length, 4);
  assert.deepEqual(filtrarProcesos(procesos, { estado: "archivados" }).map((p) => p.fuente), ["spoa"]);
  assert.deepEqual(filtrarProcesos(procesos, { fuente: "estados" }).map((p) => p.clave), ["ma:1"]);
  assert.deepEqual(filtrarProcesos(procesos, { abogado: "3" }).map((p) => p.clave), ["cn:7"]);
  assert.deepEqual(filtrarProcesos(procesos, { texto: "2022 00839" }).map((p) => p.clave), ["ma:1", "cn:7"]);
  assert.deepEqual(filtrarProcesos(procesos, { texto: "gomez" }).map((p) => p.clave), ["ma:2"]);
  assert.deepEqual(filtrarProcesos(procesos, { estado: "quietos" }).map((p) => p.clave), ["sa:g1"]);
  assert.deepEqual(filtrarProcesos(procesos, { estado: "recientes" }).map((p) => p.clave), ["ma:1", "cn:7", "ma:2"]);
  const k = contarTablero({
    procesos,
    audiencias: [{ fecha: "2024-06-14" }, { fecha: "2024-06-17" }, { fecha: "2024-06-13", estado: "descartada" }],
    propias: [{ tipo: "tarea", estado: "pendiente" }, { tipo: "nota", estado: "pendiente" }, { tipo: "radicar", vence: "2024-06-01", estado: "pendiente" }, { tipo: "tarea", estado: "hecho" }],
    hoy: "2024-06-12",
  });
  assert.equal(k.activos, 4);
  assert.deepEqual(k.porFuente, { consulta: 1, samai: 1, spoa: 0, estados: 1, manual: 1 });
  assert.equal(k.audienciasSemana, 1);
  assert.equal(k.pendientes, 2);
  assert.equal(k.vencidas, 1);
  assert.equal(k.quietos, 1);
  // Todas las fuentes de sistemas.js que guardan procesos están.
  for (const id of ["consulta", "samai", "spoa"]) assert.ok(SISTEMAS.some((s) => s.id === id) && FUENTES.some((f) => f.id === id));
});

test("la línea de tiempo junta juzgado y despacho propio por fecha sin cambiar ninguna", () => {
  const juzgado = [{ fecha: "2024-06-11T00:00:00", actuacion: "Auto", anotacion: "a" }, { fecha: "2024-05-01", actuacion: "Admite" }];
  const propias = [{ fecha: "2024-06-11", tipo: "reunion", texto: "Vino el cliente" }, { fecha: "2024-05-20", tipo: "memorial", texto: "Memorial de impulso" }];
  const copia = JSON.stringify({ juzgado, propias });
  const l = lineaDeTiempo({ juzgado, propias });
  assert.deepEqual(l.map((x) => [x.fecha, x.lado]), [["2024-06-11", "propio"], ["2024-06-11", "juzgado"], ["2024-05-20", "propio"], ["2024-05-01", "juzgado"]]);
  assert.deepEqual(lineaDeTiempo({ juzgado, propias }, "juzgado").map((x) => x.lado), ["juzgado", "juzgado"]);
  assert.deepEqual(lineaDeTiempo({ juzgado, propias }, "propio").map((x) => x.titulo), ["Reunión con el cliente", "Memorial elaborado"]);
  assert.equal(JSON.stringify({ juzgado, propias }), copia);
});

test("filas del estado sin repetir radicado, fecha del auto y actuación", () => {
  const filasEstado = [
    { radicado: RAD, actuacion: "Señala fechas para Audiencias", anotacion: "(audiencia PRESENCIAL ag.05/24 2pm )", fecha: "11/06/2024", demandante: "ANA" },
    { radicado: RAD, actuacion: "señala fechas para audiencias ", anotacion: "otra copia", fecha: "11/06/2024" },
    { radicado: RAD, actuacion: "Requiere", fecha: "11/06/2024" },
    { radicado: "", actuacion: "Sin radicado" },
  ];
  const r = registrosDeEstado(filasEstado, { estado: "074", fecha: "12/06/2024", juzgado: "JUZGADO 022 FAMILIA" });
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].fechaAuto, r[0].estadoNo, r[0].fechaEstado, r[0].juzgado], ["2024-06-11", "074", "2024-06-12", "JUZGADO 022 FAMILIA"]);
  assert.equal(r[0].firma, firmaEstado({ radicado: RAD, fechaAuto: "2024-06-11", actuacion: "SEÑALA FECHAS PARA AUDIENCIAS" }));
});

test("calendario, recordatorios un día y una hora antes, e ics", () => {
  const mes = mesCalendario(2024, 6);
  assert.equal(mes[0][0].fecha, "2024-05-27");
  assert.equal(mes[0][5].fecha, "2024-06-01");
  assert.equal(mes.at(-1).at(-1).fecha, "2024-06-30");
  assert.deepEqual(diasDeSemana("2024-06-12").at(0), "2024-06-10");
  const a = { id: 4, fecha: "2024-08-05", hora: "14:00", avisos: "" };
  assert.equal(new Date(instanteAudiencia(a)).toISOString(), "2024-08-05T19:00:00.000Z");
  assert.deepEqual(recordatoriosDebidos([a], Date.UTC(2024, 7, 4, 12)), []);
  assert.deepEqual(recordatoriosDebidos([a], Date.UTC(2024, 7, 4, 20)).map((x) => x.cual), ["dia"]);
  assert.deepEqual(recordatoriosDebidos([{ ...a, avisos: "dia" }], Date.UTC(2024, 7, 4, 20)), []);
  assert.deepEqual(recordatoriosDebidos([{ ...a, avisos: "dia" }], Date.UTC(2024, 7, 5, 18, 30)).map((x) => x.cual), ["hora"]);
  assert.deepEqual(recordatoriosDebidos([a], Date.UTC(2024, 7, 5, 18, 30)).map((x) => x.marcar), ["dia,hora"]);
  assert.deepEqual(recordatoriosDebidos([a], Date.UTC(2024, 7, 5, 20)), []);
  assert.deepEqual(proximasAudiencias([{ fecha: "2024-08-05", hora: "14:00" }, { fecha: "2024-08-05", hora: "08:00" }, { fecha: "2024-01-01" }], "2024-06-12").map((x) => x.hora), ["08:00", "14:00"]);
  const ics = icsDeAudiencias([
    { ...a, modalidad: "virtual", radicado: RAD, lugar: "https://meet.example/x", notas: "Llevar poder; copia, testigos" },
    { id: 5, fecha: "2024-12-31", hora: "", lugar: "Sala 3" },
  ], { ahoraMs: 0 });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /DTSTART:20240805T190000Z\r\nDTEND:20240805T200000Z/);
  assert.match(ics, /DTSTART;VALUE=DATE:20241231\r\nDTEND;VALUE=DATE:20250101/);
  assert.match(ics, /Llevar poder\\; copia\\, testigos/);
  assert.ok(ics.split("\r\n").every((l) => l.length <= 75));
});

test("procesos manuales, estados guardados sin repetir, vínculo y audiencias en la base", () => {
  const tmp = temporal();
  try {
    const db = tmp.db;
    assert.ok(Number(uno(db, "SELECT MAX(version) AS v FROM schema_migracion").v) >= 19);
    const manual = guardarManual(db, { despacho: "Notaría 5", demandante: "Pedro", clase: "Sucesión", cliente: "Pedro Gómez" });
    guardarActuacionManual(db, { clave: manual, fecha: "2024-06-01", actuacion: "Radicación de la solicitud" });
    assert.throws(() => guardarActuacionManual(db, { clave: "cn:1", actuacion: "x" }), /solo para procesos manuales/);
    const filasEstado = [{ radicado: RAD, actuacion: "Señala fechas para Audiencias", anotacion: "(audiencia PRESENCIAL ag.05/24 2pm )", fecha: "11/06/2024", demandante: "ANA" }];
    const meta = { estado: "074", fecha: "12/06/2024", juzgado: "JUZGADO 022 FAMILIA" };
    // Sin crear: nadie sigue ese radicado, no se guarda nada.
    assert.equal(guardarDesdeEstado(db, { filas: filasEstado, meta }).nuevas, 0);
    const r = guardarDesdeEstado(db, { filas: filasEstado, meta, crear: true });
    assert.deepEqual([r.procesos, r.nuevas], [1, 1]);
    assert.deepEqual(guardarDesdeEstado(db, { filas: filasEstado, meta, crear: true }), { procesos: 0, nuevas: 0, repetidas: 1, claves: r.claves });
    assert.deepEqual(radicadosSeguidos(db), [RAD]);
    const lista = listarMisProcesos(db, { hoy: "2024-06-12" });
    assert.deepEqual(lista.procesos.map((p) => p.fuente).sort(), ["estados", "manual"]);
    const clave = r.claves[0];
    const det = detalleMisProcesos(db, clave, { hoy: "2024-06-12" });
    assert.equal(det.juzgado[0].estado_no, "074");
    assert.deepEqual(det.sugerencias.map((s) => [s.fecha, s.hora]), [["2024-08-05", "14:00"]]);
    guardarAudiencia(db, { clave, fecha: det.sugerencias[0].fecha, hora: det.sugerencias[0].hora, modalidad: "presencial", ref: det.sugerencias[0].ref });
    assert.equal(detalleMisProcesos(db, clave, { hoy: "2024-06-12" }).sugerencias.length, 0);
    descartarSugerencia(db, { clave: manual, fecha: "2024-07-01", hora: "" });
    assert.equal(listarMisProcesos(db).audiencias.length, 1);
    assert.match(icsDe(db).ics, /SUMMARY:Audiencia presencial 11001311002220220083900/);
    const debidos = tomarRecordatorios(db, Date.UTC(2024, 7, 4, 20));
    assert.deepEqual(debidos.map((d) => d.cual), ["dia"]);
    assert.deepEqual(tomarRecordatorios(db, Date.UTC(2024, 7, 4, 21)), []);
    guardarPropia(db, { clave, tipo: "radicar", texto: "Memorial de impulso, pendiente de radicar", vence: "2024-06-20" });
    // Ahora el radicado aparece en la consulta nacional: se ofrece vincular.
    db.exec(`INSERT INTO radicado (numero) VALUES ('${RAD}');
      INSERT INTO proceso (id_proceso, radicado, despacho, fecha_ultima_actuacion) VALUES (77, '${RAD}', 'JUZGADO 022 FAMILIA', '2024-06-11T00:00:00');
      INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion, actuacion) VALUES (1, 77, '${RAD}', 1, '2024-06-11T00:00:00', 'Fijación estado');`);
    assert.equal(listarMisProcesos(db).procesos.find((p) => p.clave === clave).vinculable, "cn:77");
    vincularProceso(db, clave, "cn:77");
    const unido = detalleMisProcesos(db, clave, { hoy: "2024-06-12" });
    assert.equal(unido.proceso.clave, "cn:77");
    assert.deepEqual(unido.juzgado.map((a) => a.origen), ["consulta", "estado"]);
    assert.equal(unido.propias.length, 1);
    assert.equal(unido.audiencias.length, 1);
    assert.equal(listarMisProcesos(db).procesos.length, 2);
    archivarProceso(db, manual, true);
    assert.equal(listarMisProcesos(db).tablero.activos, 1);
  } finally {
    tmp.borrar();
  }
});

test("lo propio del despacho nunca cuenta como cambio del juzgado ni toca la comparación", async () => {
  for (const archivo of ["rama.js", "guardar.js", "samai.js", "spoa.js", "pp.js"]) {
    const fuente = fs.readFileSync(new URL(`../src/${archivo}`, import.meta.url), "utf8");
    assert.equal(/mp_(propia|actuacion|audiencia|proceso|archivo|marca)/.test(fuente), false, archivo);
  }
  const tmp = temporal();
  const NUM = "11001418901820190162700";
  let actuaciones = [{ idRegActuacion: 8, consActuacion: 1, fechaActuacion: "2026-02-02", actuacion: "Auto", anotacion: "", conDocumentos: false, llaveProceso: NUM }];
  const pedir = async (url) => {
    if (url.includes("NumeroRadicacion")) return { status: 200, text: JSON.stringify({ procesos: [{ idProceso: 15, despacho: "JUZGADO 001" }], paginacion: { cantidadPaginas: 1, cantidadRegistros: 1 } }) };
    if (url.includes("/Detalle/")) return { status: 200, text: JSON.stringify({ llaveProceso: NUM, despacho: "JUZGADO 001" }) };
    if (url.includes("/Sujetos/")) return { status: 200, text: JSON.stringify({ sujetos: [], paginacion: { cantidadPaginas: 1, cantidadRegistros: 0 } }) };
    if (url.includes("/Documentos/")) return { status: 404, text: "no" };
    if (url.includes("/Actuaciones/")) return { status: 200, text: JSON.stringify({ actuaciones, paginacion: { cantidadPaginas: 1, cantidadRegistros: actuaciones.length } }) };
    throw new Error(url);
  };
  const avisos = [];
  const ctx = { pedir, dormir: async () => {}, log() {}, aviso(l) { avisos.push(l); }, notificar() {} };
  const correr = (modo) => ejecutarTrabajo({ db: tmp.db, csvTexto: `RADICADOS\n${NUM}\n`, modo, radicado: NUM, ctx, pedir, dormir: async () => {} });
  try {
    await correr("agregar");
    const firmaAntes = JSON.stringify(filas(tmp.db, "SELECT * FROM actuacion ORDER BY id_reg_actuacion"));
    // Mucho de lo propio: notas, tareas, audiencias, estados y archivo.
    guardarPropia(tmp.db, { clave: "cn:15", tipo: "reunion", fecha: "2026-02-03", texto: "Vino el cliente, se le indicó el trámite" });
    guardarPropia(tmp.db, { clave: "cn:15", tipo: "radicar", fecha: "2026-02-04", texto: "Se elaboró memorial, pendiente de radicar", vence: "2026-02-10" });
    guardarAudiencia(tmp.db, { clave: "cn:15", fecha: "2026-03-01", hora: "09:00" });
    guardarDesdeEstado(tmp.db, { filas: [{ radicado: NUM, actuacion: "Requiere", fecha: "05/02/2026" }], meta: { estado: "010", fecha: "06/02/2026" } });
    const segundo = await correr("todo");
    assert.equal(segundo.cambios, 0);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM aviso").n), 0);
    assert.equal(JSON.stringify(filas(tmp.db, "SELECT * FROM actuacion ORDER BY id_reg_actuacion")), firmaAntes);
    // Una actuación nueva del juzgado sí es un cambio, y solo una.
    actuaciones = [...actuaciones, { ...actuaciones[0], idRegActuacion: 9, consActuacion: 2, actuacion: "Traslado" }];
    const tercero = await correr("todo");
    assert.equal(tercero.cambios, 1);
    assert.equal(avisos.filter((l) => l.includes("actuacion_nueva")).length, 1);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM mp_propia").n), 2);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM mp_actuacion").n), 1);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM actuacion").n), 2);
  } finally {
    tmp.borrar();
  }
});
