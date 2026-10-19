// Radicado de 23 dígitos armado con el juzgado y el número corto. Todo con
// datos inventados: municipios, juzgados y números de mentira.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analizarJuzgado, armarRadicado, claveJuzgado, esRadicadoCompleto, parsearNumeroCorto, prefijoMayoritario, resolverPrefijo,
} from "../compartido/radicado.js";
import { completarRadicados, marcarSeguidos } from "../compartido/estados.js";
import { abrirBase, run } from "../src/db.js";
import { asegurarRadicado } from "../src/guardar.js";
import { aprenderJuzgado, contextoRadicado, verificarRadicado } from "../src/estados-ipc.js";

const HOY = new Date(2026, 9, 19);
const MUNIS = [
  { codigo: "99000", nombre: "PRUEBANIA (todos)" },
  { codigo: "99001", nombre: "VILLAPRUEBA" },
  { codigo: "99002", nombre: "SANTIAGO DE FICTICIA" },
  { codigo: "99003", nombre: "LA INVENTADA" },
  { codigo: "98003", nombre: "LA INVENTADA" },
  { codigo: "98004", nombre: "BOGOTÁ, D.C." },
];
const DESPACHOS = [
  { codigo: "990014089001", nombre: "JUZGADO 001 PROMISCUO MUNICIPAL DE VILLAPRUEBA" },
  { codigo: "990024003001", nombre: "JUZGADO 001 CIVIL MUNICIPAL DE SANTIAGO DE FICTICIA" },
  { codigo: "990024003002", nombre: "JUZGADO 002 CIVIL MUNICIPAL DE SANTIAGO DE FICTICIA" },
  { codigo: "990023110004", nombre: "JUZGADO 004 DE FAMILIA DEL CIRCUITO DE SANTIAGO DE FICTICIA" },
  { codigo: "980034089001", nombre: "JUZGADO 001 PROMISCUO MUNICIPAL DE LA INVENTADA" },
  { codigo: "990022205000", nombre: "SALA LABORAL DEL TRIBUNAL SUPERIOR DE SANTIAGO DE FICTICIA" },
];
const CTX = { munis: MUNIS, despachos: DESPACHOS, hoy: HOY };

test("número corto: todas las formas, año de dos dígitos y recurso", () => {
  const n = (t) => parsearNumeroCorto(t, { hoy: HOY });
  const r = (anio, consecutivo, recurso = "00") => ({ anio, consecutivo, recurso });
  assert.deepEqual(n("2023-00073"), r("2023", "00073"));
  assert.deepEqual(n("2023-73"), r("2023", "00073"));
  assert.deepEqual(n("26-489"), r("2026", "00489"));
  assert.deepEqual(n("No 2024-00210"), r("2024", "00210"));
  assert.deepEqual(n("No. 2024-00210"), r("2024", "00210"));
  assert.deepEqual(n("Rad. 2024-210"), r("2024", "00210"));
  assert.deepEqual(n("2024 00210"), r("2024", "00210"));
  assert.deepEqual(n("202400210"), r("2024", "00210"));
  assert.deepEqual(n("2023-00073-01"), r("2023", "00073", "01"));
  assert.deepEqual(n("2023-73-2"), r("2023", "00073", "02"));
  assert.deepEqual(n("20230007301"), r("2023", "00073", "01"));
  // Despachos comisorios y lo que no tiene año: null, sin adivinar.
  for (const malo of ["No 052", "052", "0923DG-134", "0824EC-139", "", "1890-00012", "2031-00001", "2023-000731", "2023-00000", "2023-1-2-3"]) assert.equal(n(malo), null, malo);
});

test("juzgado: municipio, corporación, especialidad y número", () => {
  assert.deepEqual(analizarJuzgado("JUZGADO PROMISCUO MUNICIPAL DE VILLAPRUEBA", CTX), { municipio: "99001", corporacion: "40", especialidad: "89", despacho: "", motivo: "" });
  assert.equal(analizarJuzgado("Juzgado Cuarto de Familia de Ficticia", CTX).despacho, "004");
  assert.equal(analizarJuzgado("Juzgado Cuarto de Familia de Ficticia", CTX).corporacion, "31");
  assert.equal(analizarJuzgado("JUZGADO 3 LABORAL DEL CIRCUITO DE BOGOTA", CTX).municipio, "98004");
  assert.match(analizarJuzgado("JUZGADO 022 FAMILIA DEL CIRCUITO", CTX).motivo, /municipio/);
  assert.match(analizarJuzgado("JUZGADO DE VILLAPRUEBA", CTX).motivo, /clase de juzgado/);
  assert.equal(claveJuzgado("Juzgado 004 de Familia del Circuito"), claveJuzgado("JUZGADO 4 FAMILIA CIRCUITO"));
});

test("prefijo: aprendido, catálogo, único del municipio y supuesto", () => {
  const p = (nombre, extra = {}) => resolverPrefijo(nombre, { ...CTX, ...extra });
  // Único juzgado de esa clase en el municipio: armado.
  assert.deepEqual([p("JUZGADO PROMISCUO MUNICIPAL DE VILLAPRUEBA").prefijo, p("JUZGADO PROMISCUO MUNICIPAL DE VILLAPRUEBA").confianza], ["990014089001", "armado"]);
  // Número en el nombre y en el catálogo: armado.
  assert.equal(p("JUZGADO 4 DE FAMILIA DE SANTIAGO DE FICTICIA").prefijo, "990023110004");
  assert.equal(p("JUZGADO 4 DE FAMILIA DE FICTICIA").confianza, "armado");
  assert.equal(p("SALA LABORAL DEL TRIBUNAL SUPERIOR DE FICTICIA").prefijo, "990022205000");
  // Varios del municipio y sin número: 001 supuesto.
  const civil = p("JUZGADO CIVIL MUNICIPAL DE FICTICIA");
  assert.deepEqual([civil.prefijo, civil.confianza], ["990024003001", "supuesto"]);
  assert.match(civil.motivo, /Hay 2 juzgados/);
  // Con número que no está en el catálogo: supuesto.
  assert.equal(p("JUZGADO 9 CIVIL MUNICIPAL DE FICTICIA").confianza, "supuesto");
  // Municipio repetido: se queda el que tiene un juzgado de esa clase.
  assert.equal(p("JUZGADO PROMISCUO MUNICIPAL DE LA INVENTADA").prefijo, "980034089001");
  assert.equal(p("JUZGADO CIVIL MUNICIPAL DE LA INVENTADA").prefijo, "");
  // Lo aprendido gana sobre el catálogo, con el nombre escrito distinto.
  const aprendidos = [{ juzgado: "Juzgado 001 Civil Municipal de Ficticia", prefijo: "990024003777" }];
  assert.deepEqual([p("JUZGADO 1 CIVIL MUNICIPAL DE FICTICIA", { aprendidos }).prefijo, p("JUZGADO 1 CIVIL MUNICIPAL DE FICTICIA", { aprendidos }).confianza], ["990024003777", "armado"]);
  // Dos prefijos distintos para el mismo nombre: no se usa lo aprendido.
  assert.equal(p("JUZGADO 1 CIVIL MUNICIPAL DE FICTICIA", { aprendidos: [...aprendidos, { juzgado: "JUZGADO 1 CIVIL MUNICIPAL DE FICTICIA", prefijo: "990024003001" }] }).prefijo, "990024003001");
  assert.equal(p("").prefijo, "");
});

test("armar el radicado: leído, armado, supuesto y comisorio", () => {
  assert.deepEqual(armarRadicado("JUZGADO PROMISCUO MUNICIPAL DE VILLAPRUEBA", "26-489", CTX).radicado, "99001408900120260048900");
  assert.equal(armarRadicado("JUZGADO PROMISCUO MUNICIPAL DE VILLAPRUEBA", "2023-00073-01", CTX).radicado, "99001408900120230007301");
  assert.equal(armarRadicado("x", "99001408900120230007300", CTX).confianza, "leido");
  assert.equal(armarRadicado("JUZGADO CIVIL MUNICIPAL DE FICTICIA", "2023-5", CTX).confianza, "supuesto");
  const com = armarRadicado("JUZGADO PROMISCUO MUNICIPAL DE VILLAPRUEBA", "0923DG-134", CTX);
  assert.deepEqual([com.radicado, com.confianza], ["", ""]);
  assert.match(com.motivo, /comisorio/);
  assert.ok(esRadicadoCompleto("99001408900120230007300"));
  assert.ok(!esRadicadoCompleto("990014089001202300073"));
  assert.equal(prefijoMayoritario(["99001408900120230007300", "99001408900120240000100", "11111111111120240000100"]), "990014089001");
  assert.equal(prefijoMayoritario(["99001408900120230007300", "11111111111120240000100"]), "");
});

test("estados: completar radicados del formato sin 23 dígitos y cruzar con los seguidos", () => {
  const fila = (radicadoTexto) => ({ radicado: "", radicadoTexto, avisos: ["Este estado trae solo el número corto del proceso; el radicado de 23 dígitos no se puede armar."], confianza: "media" });
  const r = { meta: { formato: "clase-numero", juzgado: "JUZGADO PROMISCUO MUNICIPAL DE VILLAPRUEBA" }, filas: [fila("2023-00073"), fila("052")] };
  completarRadicados(r, CTX);
  const [a, b] = r.filas;
  assert.equal(a.radicado, "99001408900120230007300");
  assert.equal(a.radicadoArmado, "armado");
  assert.match(a.avisos.join(" "), /Radicado armado con el juzgado del estado/);
  assert.equal(b.radicado, "");
  assert.match(b.radicadoNota, /comisorio/);
  assert.deepEqual(marcarSeguidos(r.filas, ["99001408900120230007300"]).map((f) => f.seguido), [true, false]);
  // El listado de siempre no se toca.
  const listado = { meta: { juzgado: "JUZGADO PROMISCUO MUNICIPAL DE VILLAPRUEBA" }, filas: [fila("2023-00073")] };
  assert.equal(completarRadicados(listado, CTX).filas[0].radicado, "");
});

test("aprender el juzgado de un estado con radicados completos y verificar en la consulta", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radicado-"));
  try {
    const db = abrirBase(path.join(dir, "v.db"));
    aprenderJuzgado(db, { ok: true, meta: { juzgado: "JUZGADO 7 CIVIL MUNICIPAL DE FICTICIA" }, filas: [{ radicado: "99002400300720230000100" }, { radicado: "99002400300720240000200" }] });
    aprenderJuzgado(db, { ok: true, meta: { juzgado: "JUZGADO 7 CIVIL MUNICIPAL DE FICTICIA" }, filas: [{ radicado: "99002400300720230000100" }, { radicado: "99002400300720230000900", radicadoArmado: "armado" }] });
    const ctx = contextoRadicado(db);
    assert.deepEqual(ctx.aprendidos, [{ juzgado: "JUZGADO 7 CIVIL MUNICIPAL DE FICTICIA", prefijo: "990024003007" }]);
    assert.ok(ctx.despachos.length > 1000, "el catálogo de la Rama viene con la app");
    // Un proceso de la consulta nacional también enseña su juzgado.
    asegurarRadicado(db, "99001408900120230000500");
    run(db, "INSERT INTO proceso (radicado, despacho) VALUES (?, ?)", ["99001408900120230000500", "JUZGADO 001 PROMISCUO MUNICIPAL DE VILLAPRUEBA"]);
    assert.ok(contextoRadicado(db).aprendidos.some((a) => a.prefijo === "990014089001"));
    assert.equal(armarRadicado("JUZGADO 7 CIVIL MUNICIPAL DE FICTICIA", "2025-12", { ...CTX, aprendidos: ctx.aprendidos }).radicado, "99002400300720250001200");
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  let pedido = null;
  const si = await verificarRadicado("99001408900120230007300", { pedir: async (url, params) => ((pedido = params), { status: 200, text: JSON.stringify({ procesos: [{ despacho: "JUZGADO 001 PROMISCUO MUNICIPAL DE VILLAPRUEBA " }] }) }) });
  assert.deepEqual(si, { ok: true, existe: true, despacho: "JUZGADO 001 PROMISCUO MUNICIPAL DE VILLAPRUEBA" });
  assert.equal(pedido.numero, "99001408900120230007300");
  const no = await verificarRadicado("99001408900120230007300", { pedir: async () => ({ status: 200, text: JSON.stringify({ procesos: [] }) }) });
  assert.equal(no.existe, false);
  assert.equal((await verificarRadicado("2023-00073")).ok, false);
});
