import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { PIE_IA, docxDeEscrito, odtDeEscrito, textoDeDocx, tramos } from "../src/docx.js";

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
