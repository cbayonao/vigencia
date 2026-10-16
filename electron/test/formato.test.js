import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { escritoAJson, jsonAEscrito, leerParrafo, parrafoHtml, tramos } from "../compartido/formato.js";
import { escritoDeTexto, textoDeEscrito } from "../compartido/documentos.js";
import { aplicarBloque, bloquesDeCuerpo } from "../compartido/memoria.js";
import { docxDeEscrito, odtDeEscrito } from "../src/docx.js";
import { htmlDocumento } from "../src/memorial.js";
import { abrirBase, uno } from "../src/db.js";
import { conversar, crearProyecto, guardarEdicionDocumento, historialBloque, leerProyecto } from "../src/documentos.js";
import { EXTENSIONES } from "../editor/editor.js";
import { inflateRawSync } from "node:zlib";

const MD = `Asunto: Acción de tutela

## Hechos
{centro} **PRIMERO.** El *accionante* ++solicitó++ el medicamento.

#### Antecedentes

> La salud es un derecho fundamental autónomo (T-760 de 2008).

- Uno
- Dos

1. Primera petición
2. Segunda

| Fecha | Actuación |
| --- | --- |
| 3 de marzo | Radicó \\| tutela |

## Firma
Firma: _________________

{derecha} Bogotá`;

function parte(zip, nombre) {
  // Lector mínimo: busca la cabecera local del archivo y descomprime.
  const firma = Buffer.from(nombre);
  const i = zip.indexOf(firma) - 30;
  const metodo = zip.readUInt16LE(i + 8);
  const comp = zip.readUInt32LE(i + 18);
  const ini = i + 30 + zip.readUInt16LE(i + 26) + zip.readUInt16LE(i + 28);
  const datos = zip.subarray(ini, ini + comp);
  return (metodo ? inflateRawSync(datos) : datos).toString("utf8");
}

test("tramos: negrita, itálica, subrayado y marcas sin cierre", () => {
  const t = tramos("a **b *c*** ++u++ 2*3");
  assert.deepEqual(t.find((x) => x.texto === "c"), { texto: "c", negrita: true, italica: true, subrayado: false });
  assert.ok(t.find((x) => x.texto === "u").subrayado);
  assert.match(t.at(-1).texto, /2\*3/);
});

test("Markdown, editor y Markdown otra vez dan lo mismo, con ids por párrafo", () => {
  const e = escritoDeTexto(MD);
  const ids = bloquesDeCuerpo(MD).map((_, i) => `b${i}`);
  assert.equal(ids.length, 10);
  const json = escritoAJson(e, ids);
  const schema = getSchema(EXTENSIONES());
  schema.nodeFromJSON(json).check(); // el JSON es válido para TipTap
  const r = jsonAEscrito(json);
  assert.equal(textoDeEscrito(r.escrito), textoDeEscrito(e));
  assert.deepEqual(r.ids, ids);
  assert.equal(leerParrafo(e.secciones[0].parrafos.at(-1)).tipo, "tabla");
});

test("una tabla metida en una lista o una cita no se pierde al guardar", () => {
  const json = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hechos" }] },
    { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [
      { type: "paragraph", content: [{ type: "text", text: "Uno" }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }] }] },
    ] }] },
    { type: "blockquote", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Dentro" }] }] }] }] },
  ] };
  const { escrito } = jsonAEscrito(json);
  assert.deepEqual(escrito.secciones[0].parrafos, ["1. Uno", "| A |\n| --- |", "- Dentro"]);
});

test("exportar Word, ODT y PDF con formato y pie de IA", () => {
  const e = escritoDeTexto(MD);
  const docx = docxDeEscrito(e);
  const d = parte(docx, "word/document.xml");
  for (const x of ['<w:u w:val="single"/>', "<w:tbl>", '<w:jc w:val="center"/>', 'w:val="Cita"', 'w:val="Subtitulo"', "Radicó | tutela"]) assert.ok(d.includes(x), x);
  assert.ok(parte(docx, "word/footer1.xml").includes("Generado con IA. Favor revisar."));
  assert.ok(parte(docxDeEscrito(e, { titulo: true }), "word/document.xml").includes('<w:pStyle w:val="Titulo"/></w:pPr><w:r><w:t xml:space="preserve">Acción de tutela'));
  assert.ok(!parte(docxDeEscrito(e, { pie: false }), "word/document.xml").includes("footerReference"));
  const odt = odtDeEscrito(e);
  const c = parte(odt, "content.xml");
  for (const x of ["<table:table ", "TNU\"", "Subtitulo", "CuerpoCentro", "CuerpoDerecha"].filter((y) => y !== 'TNU"')) assert.ok(c.includes(x), x);
  assert.ok(parte(odt, "styles.xml").includes("Generado con IA. Favor revisar."));
  const h = htmlDocumento({ asunto: e.asunto, secciones: e.secciones });
  for (const x of ["<u>solicitó</u>", "<blockquote>", '<table class="doc-tabla">', '<p class="al-derecha">', "Generado con IA. Favor revisar."]) assert.ok(h.includes(x), x);
  assert.ok(!htmlDocumento({ asunto: "x", secciones: [] }, { pie: false }).includes("Generado con IA"));
  assert.equal(parrafoHtml("<script>"), "<p>&lt;script&gt;</p>");
});

test("Cambiar un párrafo conserva la viñeta y la alineación", () => {
  const b = bloquesDeCuerpo(MD).find((x) => x.texto === "- Dos");
  assert.match(aplicarBloque(MD, b, "Dos, con detalle."), /\n- Dos, con detalle\.\n/);
  const c = bloquesDeCuerpo(MD)[0];
  assert.match(aplicarBloque(MD, c, "Texto nuevo"), /\{centro\} Texto nuevo/);
});

test("guardar desde el editor conserva el id aunque el párrafo cambie entero y deja historial manual", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-fmt-"));
  const db = abrirBase(path.join(dir, "grokvig.sqlite"));
  const p = crearProyecto(db, { nombre: "T", tipo: "tutela" });
  await conversar({ db, datosDir: dir, proyectoId: p.id, mensaje: "tutela", resolverModelo: () => ({ id: "gguf:a", nombre: "A", usa: true, origen: "local" }), pedirTexto: async () => ({ texto: MD, origen: "local" }) });
  const d = leerProyecto(db, p.id);
  const json = escritoAJson(escritoDeTexto(d.actual.cuerpo), d.bloques.map((b) => b.id));
  // El usuario reescribe por completo el primer párrafo y pone en negrita otro.
  json.content.find((n) => n.attrs?.bloque === d.bloques[0].id).content = [{ type: "text", text: "Algo totalmente distinto." }];
  const { escrito, ids } = jsonAEscrito(json);
  const r = guardarEdicionDocumento(db, p.id, textoDeEscrito(escrito), ids);
  assert.equal(r.cambiados, 1);
  const despues = leerProyecto(db, p.id);
  assert.equal(despues.bloques[0].id, d.bloques[0].id);
  assert.match(despues.bloques[0].texto, /Algo totalmente distinto/);
  assert.equal(historialBloque(db, d.bloques[0].id)[0].origen, "manual");
  assert.match(JSON.stringify(despues.memoria), /Editado a mano/);
  assert.equal(Number(uno(db, "SELECT COUNT(*) n FROM doc_bloque WHERE proyecto_id = ?", [p.id]).n), 10);
});

test("el editor empaquetado existe y es local", () => {
  const ruta = new URL("../renderer/vendor/editor.js", import.meta.url);
  const js = fs.readFileSync(ruta, "utf8");
  assert.ok(js.includes("data-bloque"), "corra npm run editor");
  assert.doesNotMatch(js, /https?:\/\/(?!prosemirror|tiptap|github|www\.w3)[a-z0-9.-]+\/[^"'\s]*\.(js|css)/i);
  const html = fs.readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
  assert.match(html, /script-src 'self'/);
});
