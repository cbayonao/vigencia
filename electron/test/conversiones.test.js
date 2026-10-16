import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { abrirBase, uno } from "../src/db.js";
import {
  agregarAProyecto, archivosDelProyecto, candidatosFts, enCache, guardarAgentes, guardarEdicion, guardarResultado, incluirEnContexto,
  leerMarkdown, limpiarCache, prepararArchivo, agentesParaContexto, PLANTILLA_AGENTS,
} from "../src/conversiones.js";
import { convertirRuta } from "../src/convertir/convertidores.js";
import { actualizarProyecto, conversar, crearProyecto, prepararVuelta } from "../src/documentos.js";
import { fragmentosDeTrozos, repartirFuentes } from "../compartido/contexto.js";

const corpus = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-conv-"));
  return { dir, db: abrirBase(path.join(dir, "grokvig.sqlite")) };
}

async function convertir(tmp, nombre, extra = {}) {
  const datos = fs.readFileSync(path.join(corpus, nombre));
  const fila = prepararArchivo(tmp.db, tmp.dir, { datos, nombre, ...extra });
  const r = await convertirRuta(path.join(corpus, nombre), { datosDir: tmp.dir });
  return guardarResultado(tmp.db, tmp.dir, fila.id, r);
}

test("la caché por hash guarda .md, original y meta, y no reconvierte", async () => {
  const tmp = temporal();
  const a = await convertir(tmp, "texto.pdf");
  assert.equal(a.estado, "listo");
  assert.ok(fs.existsSync(path.join(tmp.dir, a.ruta_md)));
  const carpeta = path.dirname(path.join(tmp.dir, a.ruta_md));
  assert.ok(fs.existsSync(path.join(carpeta, "original.pdf")));
  assert.ok(fs.existsSync(path.join(carpeta, "meta.json")));
  assert.ok(enCache(tmp.db, tmp.dir, a.sha256));
  assert.ok(Number(uno(tmp.db, "SELECT COUNT(*) n FROM trozo WHERE archivo_id = ?", [a.id]).n) > 0);
  const otro = prepararArchivo(tmp.db, tmp.dir, { datos: Buffer.concat([fs.readFileSync(path.join(corpus, "texto.pdf")), Buffer.from(" ")]), nombre: "texto.pdf" });
  assert.notEqual(otro.id, a.id);
  const ed = guardarEdicion(tmp.db, tmp.dir, a.id, "# Editado\n\nNuevo texto");
  assert.equal(ed.revision, 2);
  assert.match(leerMarkdown(tmp.db, tmp.dir, a.id).markdown, /Editado/);
  assert.ok(fs.existsSync(path.join(carpeta, "documento.md")));
});

test("FTS5 encuentra trozos y limpiar caché respeta lo que está en uso", async () => {
  const tmp = temporal();
  const a = await convertir(tmp, "texto.pdf");
  const b = await convertir(tmp, "cid.pdf");
  const r = candidatosFts(tmp.db, [a.id, b.id], ["pension"]);
  assert.ok(r.length >= 1);
  assert.ok(r.every((t) => t.archivo_id === b.id));
  const p = crearProyecto(tmp.db, { nombre: "P", tipo: "tutela" });
  agregarAProyecto(tmp.db, p.id, a.id);
  assert.equal(limpiarCache(tmp.db, tmp.dir).borrados, 1);
  assert.ok(archivosDelProyecto(tmp.db, p.id).length === 1);
});

test("AGENTS.md: la plantilla vacía no gasta contexto", () => {
  assert.equal(agentesParaContexto(PLANTILLA_AGENTS).includes("Quién representa"), false);
  assert.match(agentesParaContexto(PLANTILLA_AGENTS), /Lenguaje claro/);
});

test("BM25 sobre trozos respeta el presupuesto y cita página", () => {
  const trozos = [
    { archivo_id: 1, orden: 0, pagina: 1, nombre: "a.pdf", titulo: "", texto: "La pensión de vejez exige semanas cotizadas." },
    { archivo_id: 1, orden: 1, pagina: 2, nombre: "a.pdf", titulo: "", texto: "Tema distinto sobre arrendamiento comercial." },
  ];
  const { fragmentos } = fragmentosDeTrozos(trozos, "pensión vejez", { presupuesto: 60 });
  assert.equal(fragmentos.length, 1);
  assert.equal(fragmentos[0].pagina, 1);
  assert.deepEqual(repartirFuentes(1000, { hayArchivos: true, hayPiezas: true }), { archivos: 600, piezas: 400 });
});

test("el contexto va en orden y la nube exige Revisar envío con el texto exacto", async () => {
  const tmp = temporal();
  const a = await convertir(tmp, "texto.pdf");
  const b = await convertir(tmp, "cid.pdf");
  const p = crearProyecto(tmp.db, { nombre: "Tutela", tipo: "tutela" });
  agregarAProyecto(tmp.db, p.id, a.id);
  agregarAProyecto(tmp.db, p.id, b.id);
  incluirEnContexto(tmp.db, p.id, b.id, false);
  guardarAgentes(tmp.dir, p.id, "# Caso\n\n- Accionante: María Pérez");
  const nube = () => ({ id: "nube:openai", nombre: "Nube", usa: true, origen: "nube" });
  const args = { db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "tutela por el derecho a la salud y el medicamento", resolverModelo: nube };
  const previa = prepararVuelta(args);
  const e = previa.encargo;
  const pos = (t) => e.indexOf(t);
  assert.ok(pos("Lineamientos") < pos("AGENTS.md"));
  assert.ok(pos("AGENTS.md") < pos("Expediente:"));
  assert.ok(pos("Expediente:") < pos("Archivos del proyecto"));
  assert.ok(pos("Archivos del proyecto") < pos("Mensaje del usuario"));
  assert.match(e, /\[texto\.pdf, página 1\]/);
  assert.doesNotMatch(e, /CASACION/); // excluido del contexto
  assert.equal(previa.informe.archivos[0].nombre, "texto.pdf");
  let enviado = "";
  const pedirTexto = async ({ encargo }) => {
    enviado = encargo;
    return { texto: "Asunto: Tutela\n\n## Hechos\nUno.", origen: "nube" };
  };
  await assert.rejects(conversar({ ...args, pedirTexto }), /Solo local/);
  actualizarProyecto(tmp.db, p.id, { solo_local: false });
  await assert.rejects(conversar({ ...args, pedirTexto }), /Revise el envío/);
  const h = prepararVuelta(args).informe.hash;
  await conversar({ ...args, pedirTexto, confirmado: h });
  assert.equal(enviado, prepararVuelta(args).encargo.length ? enviado : "");
  assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) n FROM envio_nube").n), 1);
  assert.equal(uno(tmp.db, "SELECT sha256 FROM envio_nube").sha256, h);
});

test("con modelo local nada pide confirmación ni se registra envío", async () => {
  const tmp = temporal();
  const p = crearProyecto(tmp.db, { nombre: "L", tipo: "memorial" });
  const local = () => ({ id: "gguf:x", nombre: "Local", usa: true, origen: "local" });
  await conversar({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "memorial", resolverModelo: local, pedirTexto: async () => ({ texto: "Asunto: M\n\n## Uno\nDos.", origen: "local" }) });
  assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) n FROM envio_nube").n), 0);
});
