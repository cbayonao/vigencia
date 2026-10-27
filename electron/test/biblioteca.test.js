import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { piezasDelEncargo } from "../compartido/encargo.js";
import { activarPieza, borrarPieza, guardarPieza, listarPiezas } from "../src/biblioteca.js";
import { abrirBase, Aviso, run, uno } from "../src/db.js";

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-biblio-"));
  const db = abrirBase(path.join(dir, "grokvig.sqlite"));
  return {
    db,
    borrar() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("la migración 5 deja piezas de ejemplo que se pueden editar, apagar y borrar", () => {
  const tmp = temporal();
  try {
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM schema_migracion").n), 21);
    const iniciales = listarPiezas(tmp.db);
    assert.equal(iniciales.filter((pieza) => pieza.tipo === "norma").length, 3);
    assert.equal(iniciales.filter((pieza) => pieza.tipo === "estilo").length, 1);
    assert.ok(iniciales.every((pieza) => pieza.activa));

    const creada = guardarPieza(tmp.db, {
      nombre: "Mi plantilla",
      tipo: "plantilla",
      texto: "Señor Juez:\nSolicito copias.",
    });
    assert.equal(creada.activa, true);
    assert.equal(creada.tipoNombre, "Plantilla");
    const editada = guardarPieza(tmp.db, {
      id: creada.id,
      nombre: "Mi plantilla",
      tipo: "ejemplo",
      texto: "Ejemplo de copias.",
    });
    assert.equal(editada.tipo, "ejemplo");
    assert.equal(editada.activa, true);

    const apagada = activarPieza(tmp.db, creada.id, false);
    assert.equal(apagada.activa, false);
    assert.equal(piezasDelEncargo(listarPiezas(tmp.db)).some((pieza) => pieza.id === creada.id), false);

    run(tmp.db, "INSERT INTO radicado (numero) VALUES (?)", ["11001311001220220008900"]);
    run(tmp.db, "INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (7, ?, 0)", ["11001311001220220008900"]);
    borrarPieza(tmp.db, creada.id);
    assert.equal(listarPiezas(tmp.db).some((pieza) => pieza.id === creada.id), false);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM proceso").n), 1);
    assert.throws(() => borrarPieza(tmp.db, creada.id), Aviso);
    assert.throws(() => guardarPieza(tmp.db, { nombre: "", tipo: "norma", texto: "x" }), /nombre/);
    assert.throws(() => guardarPieza(tmp.db, { nombre: "A", tipo: "otro", texto: "x" }), /plantilla/);
  } finally {
    tmp.borrar();
  }
});
