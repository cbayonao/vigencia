import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { abrirBase, uno } from "../src/db.js";
import { actualizarProyecto, conversar, crearProyecto, leerProyecto, prepararBloque, prepararVuelta, proponerBloque, resolverBloque, historialBloque } from "../src/documentos.js";
import { aplicarBloque, diffPalabras, sincronizarBloques } from "../compartido/memoria.js";

const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-mem-")); return { dir, db: abrirBase(path.join(dir, "grokvig.sqlite")) }; };
const local = () => ({ id: "gguf:a", nombre: "Modelo A", usa: true, origen: "local" });
const nube = () => ({ id: "nube:b", nombre: "Modelo B", usa: true, origen: "nube" });
const DOC = "Asunto: Tutela\n\n## Hechos\nPrimer hecho del caso.\n\nSegundo hecho del caso.\n\n## Pretensiones\nQue se ordene el medicamento.";

test("ids de bloque estables y diff por palabras", () => {
  let n = 0;
  const a = sincronizarBloques([], DOC, () => `b${++n}`);
  const b = sincronizarBloques(a, DOC.replace("Segundo hecho del caso.", "Segundo hecho del caso, con fecha."), () => `b${++n}`);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  assert.ok(diffPalabras("uno dos", "uno tres").some((p) => p.op === "agregado"));
  assert.match(aplicarBloque(DOC, b[1], "Hecho nuevo."), /Hecho nuevo\.\n\n## Pretensiones|Hecho nuevo\./);
});

test("la memoria sobrevive al cambio de modelo y entra al encargo del siguiente", async () => {
  const t = tmp();
  const p = crearProyecto(t.db, { nombre: "T", tipo: "tutela" });
  await conversar({ db: t.db, datosDir: t.dir, proyectoId: p.id, mensaje: "Redacta la tutela. Usa siempre tercera persona.", resolverModelo: local, pedirTexto: async () => ({ texto: DOC, origen: "local", nombre: "Modelo A" }) });
  t.db.close();
  const db = abrirBase(path.join(t.dir, "grokvig.sqlite")); // reinicio
  const datos = leerProyecto(db, p.id);
  assert.ok(datos.bloques.length >= 3);
  assert.ok(JSON.stringify(datos.memoria).includes("Modelo A"));
  actualizarProyecto(db, p.id, { solo_local: false });
  const e = prepararVuelta({ db, datosDir: t.dir, proyectoId: p.id, mensaje: "ajusta", resolverModelo: nube }).encargo;
  assert.match(e, /Memoria del documento/);
  assert.match(e, /tercera persona/);
});

test("cambio de un bloque: propuesta, diff, aceptar, rechazar e historial", async () => {
  const t = tmp();
  const p = crearProyecto(t.db, { nombre: "T", tipo: "tutela" });
  await conversar({ db: t.db, datosDir: t.dir, proyectoId: p.id, mensaje: "tutela", resolverModelo: local, pedirTexto: async () => ({ texto: DOC, origen: "local" }) });
  const bloques = leerProyecto(t.db, p.id).bloques;
  const objetivo = bloques.find((b) => b.texto.startsWith("Segundo"));
  const otros = bloques.filter((b) => b.id !== objetivo.id).map((b) => b.texto);
  const args = { db: t.db, datosDir: t.dir, proyectoId: p.id, bloqueId: objetivo.id, mensaje: "agrega la fecha", resolverModelo: local };
  let pedido = "";
  const { cambio } = await proponerBloque({ ...args, pedirTexto: async ({ encargo }) => { pedido = encargo; return { texto: "Segundo hecho, ocurrido el 3 de marzo.", origen: "local" }; } });
  assert.match(pedido, /Segundo hecho del caso/);
  assert.equal(cambio.estado, "propuesto");
  assert.ok(cambio.diff.length);
  const r = resolverBloque(t.db, cambio.id, true);
  const d = leerProyecto(t.db, p.id);
  assert.match(d.actual.cuerpo, /3 de marzo/);
  for (const o of otros) assert.ok(d.actual.cuerpo.includes(o)); // nada más cambió
  assert.ok(d.bloques.some((b) => b.id === objetivo.id && /3 de marzo/.test(b.texto)));
  assert.match(JSON.stringify(d.memoria), /agrega la fecha/);
  assert.ok(r.version.id);
  const segundo = await proponerBloque({ ...args, mensaje: "más corto", pedirTexto: async () => ({ texto: "Corto.", origen: "local" }) });
  resolverBloque(t.db, segundo.cambio.id, false);
  assert.doesNotMatch(leerProyecto(t.db, p.id).actual.cuerpo, /Corto\./);
  assert.deepEqual(historialBloque(t.db, objetivo.id).map((c) => c.estado), ["rechazado", "aceptado"]);
  assert.throws(() => resolverBloque(t.db, cambio.id, true), /ya se resolvió/);
});

test("bloque a la nube exige Solo local apagado y el hash exacto", async () => {
  const t = tmp();
  const p = crearProyecto(t.db, { nombre: "T", tipo: "tutela" });
  await conversar({ db: t.db, datosDir: t.dir, proyectoId: p.id, mensaje: "tutela", resolverModelo: local, pedirTexto: async () => ({ texto: DOC, origen: "local" }) });
  const id = leerProyecto(t.db, p.id).bloques[1].id;
  const args = { db: t.db, datosDir: t.dir, proyectoId: p.id, bloqueId: id, mensaje: "mejora", resolverModelo: nube, pedirTexto: async () => ({ texto: "Mejor.", origen: "nube" }) };
  await assert.rejects(proponerBloque(args), /Solo local/);
  actualizarProyecto(t.db, p.id, { solo_local: false });
  await assert.rejects(proponerBloque(args), /Revise el envío/);
  const h = prepararBloque(args).informe.hash;
  await proponerBloque({ ...args, confirmado: h });
  assert.equal(uno(t.db, "SELECT motivo FROM envio_nube").motivo, "parrafo");
});
