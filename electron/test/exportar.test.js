import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { PIE_IA, docxDeEscrito, odtDeEscrito, textoDeDocx, tramos } from "../src/docx.js";
import { TEXTO_REVISION, metricasDeCitas, notasDeCitas, puedeExportar } from "../compartido/citas.js";
import { abrirBase } from "../src/db.js";
import { anotarExportacion, crearProyecto, guardarPendientes, guardarVersion, revisionDeExportar } from "../src/documentos.js";
import { leerMemoria } from "../src/memoria.js";

const escrito = { asunto: "Tutela", secciones: [{ titulo: "Hechos", parrafos: ["Primero, **negrita** y *itálica*.", "- un punto"] }] };

test("tramos de negrita e itálica", () => {
  assert.deepEqual(tramos("a **b** c").map((t) => [t.texto, Boolean(t.negrita)]), [["a ", false], ["b", true], [" c", false]]);
});

test("Word lleva el pie por defecto y se puede quitar", () => {
  const con = docxDeEscrito(escrito);
  const sin = docxDeEscrito(escrito, { pie: false });
  assert.ok(con.includes(Buffer.from("word/footer1.xml")));
  assert.ok(!sin.includes(Buffer.from("word/footer1.xml")));
  assert.match(textoDeDocx(con).texto, /negrita/);
});

test("ODT válido con mimetype primero y pie", () => {
  const odt = odtDeEscrito(escrito);
  assert.equal(odt.subarray(30, 38).toString(), "mimetype");
  assert.ok(odt.includes(Buffer.from("application/vnd.oasis.opendocument.text")));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-odt-"));
  fs.writeFileSync(path.join(dir, "a.odt"), odt);
  const lista = execFileSync("unzip", ["-l", path.join(dir, "a.odt")]).toString();
  assert.match(lista, /content\.xml/);
  const estilos = execFileSync("unzip", ["-p", path.join(dir, "a.odt"), "styles.xml"]).toString();
  assert.ok(estilos.includes(PIE_IA));
  assert.ok(!odtDeEscrito(escrito, { pie: false }).toString("latin1").includes("Favor revisar"));
});

test("Word puede llevar las citas como notas al pie", () => {
  const cuerpo = "Asunto: Tutela\n\n## Hechos\nLa EPS negó la cirugía.";
  const notas = notasDeCitas(cuerpo, [{ inicio: cuerpo.indexOf("La EPS"), fin: cuerpo.indexOf("La EPS") + 6, texto_citado: "negó el servicio", titulo: "Historia clínica", pagina: 2 }]);
  assert.equal(notas.length, 1);
  assert.match(notas[0].texto, /Historia clínica/);
  assert.match(notas[0].texto, /página 2/);
  const docx = docxDeEscrito({ asunto: "Tutela", secciones: [{ titulo: "Hechos", parrafos: ["La EPS negó la cirugía."] }] }, { titulo: true, notas });
  assert.ok(docx.includes(Buffer.from("word/footnotes.xml")));
  assert.ok(!docxDeEscrito(escrito).includes(Buffer.from("word/footnotes.xml")));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-docx-nota-"));
  const ruta = path.join(dir, "a.docx");
  fs.writeFileSync(ruta, docx);
  const notasXml = execFileSync("unzip", ["-p", ruta, "word/footnotes.xml"]).toString();
  const documento = execFileSync("unzip", ["-p", ruta, "word/document.xml"]).toString();
  assert.match(notasXml, /negó el servicio/);
  assert.match(notasXml, /página 2/);
  assert.match(documento, /footnoteReference w:id="1"/);
});

test("sin pendientes se exporta sin preguntar; con pendientes hace falta la casilla", () => {
  assert.deepEqual(puedeExportar({ avisos: [], formato: "pdf" }), { guardar: true, historial: false });
  const avisos = [{ tipo: "revisor", parrafo: "Hechos", texto: "Falta la cita." }];
  assert.deepEqual(puedeExportar({ avisos, formato: "docx", revisado: false }), { guardar: false, historial: false });
  assert.deepEqual(puedeExportar({ avisos, formato: "pdf", revisado: true }), { guardar: true, historial: true });
});

test("la confirmación queda en la memoria del proyecto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-exportar-"));
  const db = abrirBase(path.join(dir, "grokvig.sqlite"));
  try {
    const p = crearProyecto(db, { nombre: "T", tipo: "tutela" });
    const limpio = guardarVersion(db, p.id, { cuerpo: "Asunto: Tutela\n\n## Hechos\nLa EPS negó la cirugía el 3 de marzo." });
    assert.equal(revisionDeExportar(db, limpio.id).avisos.length, 0);
    const marcada = guardarVersion(db, p.id, { cuerpo: "Asunto: Tutela\n\n## Hechos\nLa Ley 1751 de 2015 obliga al juez." });
    const sinFuente = revisionDeExportar(db, marcada.id);
    assert.ok(sinFuente.avisos.some((a) => a.tipo === "sin_fuente"));
    assert.equal(puedeExportar({ avisos: sinFuente.avisos, formato: "docx" }).guardar, false);
    guardarPendientes(db, limpio.id, [{ parrafo: "Hechos", afirmacion: "La EPS debe cubrir el medicamento." }]);
    const conRevisor = revisionDeExportar(db, limpio.id);
    assert.ok(conRevisor.avisos.some((a) => a.tipo === "revisor" && /medicamento/.test(a.texto)));
    anotarExportacion(db, p.id, { formato: "docx", notas: true });
    assert.match(JSON.stringify(leerMemoria(db, p.id)), new RegExp(TEXTO_REVISION));
    assert.match(JSON.stringify(leerMemoria(db, p.id)), /notas al pie/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("las métricas cuentan citas, marcas, hallazgos y el costo del usage", () => {
  const m = metricasDeCitas({
    versiones: [
      { cuerpo: "Asunto: T\n\n## Hechos\nLa Ley 100 de 1993 creó el sistema.", citas: [{ inicio: 0, fin: 4 }], pendientes: [{ afirmacion: "Falta soporte." }] },
      { cuerpo: "Asunto: T\n\n## Hechos\nEl paciente vive en Bogotá.", citas: [], pendientes: [] },
    ],
    gastos: [{ motivo: "revisor", costo: 0.02 }, { motivo: "documento", costo: 0.1 }],
  });
  assert.equal(m.conCita, 1);
  assert.equal(m.sinFuente, 1);
  assert.equal(m.hallazgos, 1);
  assert.equal(m.costoRevisor, 0.02);
  assert.equal(m.costo, 0.12);
});
