import assert from "node:assert/strict";
import test from "node:test";
import {
  causaDelFallo,
  decidirActualizar,
  fechaCorta,
  lineaDeCarga,
  nombreCliente,
  normalizarRadicado,
  PAUSA_ACTUALIZAR_MS,
  pausaAleatoriaMs,
  textoPausa,
  tipoClave,
  tramosDeActuaciones,
  visibles,
} from "../compartido/logica.js";

test("actualizar todo espera de 1 a 3 segundos y el botón queda bloqueado una hora", () => {
  assert.equal(pausaAleatoriaMs(() => 0), 1000);
  assert.equal(pausaAleatoriaMs(() => 0.5), 2000);
  assert.equal(pausaAleatoriaMs(() => 1), 3000);
  const ahoraFecha = new Date(2026, 9, 10, 12, 0, 0);
  const decision = decidirActualizar(null, false, ahoraFecha);
  assert.equal(decision.ok, true);
  assert.equal(decision.hasta, "2026-10-10 13:00:00");
  assert.equal(PAUSA_ACTUALIZAR_MS, 60 * 60 * 1000);
  const otra = decidirActualizar(decision.hasta, false, ahoraFecha);
  assert.equal(otra.ok, false);
  assert.equal(otra.error, "Puedes actualizar de nuevo a las 13:00.");
  assert.equal(textoPausa(decision.hasta, new Date(2026, 9, 10, 13, 0, 0)), "");
  const noche = decidirActualizar(null, false, new Date(2026, 9, 10, 23, 30, 0));
  assert.equal(noche.hasta, "2026-10-11 00:30:00");
  assert.equal(textoPausa(noche.hasta, new Date(2026, 9, 10, 23, 30, 0)), "Puedes actualizar de nuevo a las 00:30 del 11 oct 2026.");
  assert.equal(decidirActualizar(null, true, ahoraFecha).error, "Ya hay una consulta en curso.");
});

test("el nombre del cliente sale de la ficha y también de la fila de la lista", () => {
  assert.equal(nombreCliente({ nombre: "Ana", apellidos: "Prueba" }), "Ana Prueba");
  assert.equal(nombreCliente({ cliente_nombre: "Ana", cliente_apellidos: "Prueba" }), "Ana Prueba");
  assert.equal(nombreCliente(null), "");
});

test("las actuaciones del mismo día comparten un tramo", () => {
  const filas = [
    { fecha_actuacion: "2026-10-09", actuacion: "Reciente" },
    { fecha_actuacion: "2026-10-09", actuacion: "Mismo día" },
    { fecha_actuacion: "2020-01-01", actuacion: "Antigua" },
  ];
  const tramos = tramosDeActuaciones(filas);
  assert.equal(tramos.length, 2);
  assert.equal(tramos[0].clave, "2026-10-09");
  assert.equal(tramos[0].actos.length, 2);
  assert.equal(tramos[1].actos[0].actuacion, "Antigua");
  const alReves = tramosDeActuaciones([...filas].reverse());
  assert.equal(alReves[0].clave, "2020-01-01");
  assert.equal(alReves[1].actos.map((act) => act.actuacion).join("|"), "Mismo día|Reciente");
});

test("el tipo se agrupa sin tildes ni espacios y no mezcla tipos distintos", () => {
  assert.equal(tipoClave("De Ejecución"), "DEEJECUCION");
  assert.equal(tipoClave("De Ejecucion"), "DEEJECUCION");
  assert.notEqual(tipoClave("Declarativo"), tipoClave("DECLARATIVOS C.C."));
  assert.notEqual(tipoClave("Codigo General del Proceso Fam"), tipoClave("Codigo General del Proceso CC"));
});

test("la fecha corta y el radicado", () => {
  assert.equal(fechaCorta("2026-10-09"), "9 oct 2026");
  assert.equal(fechaCorta(""), "Sin fecha");
  assert.equal(normalizarRadicado("11 001-abc"), "11001");
  assert.equal(normalizarRadicado("1".repeat(30)).length, 23);
});

test("oculta los radicados sin expediente salvo que se busque el número", () => {
  const procesos = [
    { id_proceso: 1, radicado: "1100", fecha_ultima_actuacion: "2026-01-02", tipo_proceso: "De Ejecución", despacho: "JUZGADO", sin_expediente: 0 },
    { id_proceso: null, radicado: "2500", sin_expediente: 1 },
  ];
  assert.equal(visibles(procesos, "", "", "").length, 1);
  assert.equal(visibles(procesos, "2500", "", "")[0].radicado, "2500");
  assert.equal(visibles(procesos, "", "DEEJECUCION", "").length, 1);
  assert.equal(visibles(procesos, "", "", "OTRO").length, 0);
});

test("ordena por última actuación y deja las fechas vacías al final", () => {
  const procesos = [
    { id_proceso: 1, radicado: "b", fecha_ultima_actuacion: "2020-01-01", sin_expediente: 0 },
    { id_proceso: 2, radicado: "a", fecha_ultima_actuacion: "", sin_expediente: 0 },
    { id_proceso: 3, radicado: "c", fecha_ultima_actuacion: "2026-05-01", sin_expediente: 0 },
  ];
  assert.deepEqual(visibles(procesos, "", "", "").map((p) => p.radicado), ["c", "b", "a"]);
});

test("filtra por el cliente del expediente y lo encuentra por el nombre", () => {
  const procesos = [
    { id_proceso: 1, radicado: "1", cliente_id: 4, cliente_nombre: "Ana", cliente_apellidos: "Pérez", sin_expediente: 0, fecha_ultima_actuacion: "2026-01-01" },
    { id_proceso: 2, radicado: "2", cliente_id: null, sin_expediente: 0, fecha_ultima_actuacion: "2026-01-02" },
  ];
  assert.deepEqual(visibles(procesos, "", "", "", "4").map((p) => p.id_proceso), [1]);
  assert.deepEqual(visibles(procesos, "", "", "", "sin").map((p) => p.id_proceso), [2]);
  assert.equal(visibles(procesos, "pérez", "", "")[0].id_proceso, 1);
});

test("el registro de la búsqueda no muestra ids y explica el fallo", () => {
  const limpia = lineaDeCarga("idProceso=99 [detalle 2/3] 246151560 radicado listo");
  assert.equal(limpia.includes("99"), false);
  assert.equal(limpia.includes("246151560"), false);
  assert.equal(limpia.includes("listo"), true);
  assert.equal(causaDelFallo(["Traceback", "File x", "ModuleNotFoundError: No module named 'requests'"], 1), "Código 1. ModuleNotFoundError: No module named 'requests'");
  assert.equal(causaDelFallo([], 2), "Código 2. No dejó ningún mensaje.");
});
