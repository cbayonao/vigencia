import assert from "node:assert/strict";
import test from "node:test";
import {
  SISTEMAS,
  SISTEMA_INICIAL,
  guardarOcultos,
  leerOcultos,
  sistemaElegible,
  sistemasVisibles,
} from "../compartido/sistemas.js";

test("la barra trae los ocho sistemas y cinco están listos", () => {
  assert.deepEqual(SISTEMAS.map((sistema) => sistema.id), [
    "consulta", "micrositio", "spoa", "samai", "juris", "externa", "supersociedades", "sic",
  ]);
  assert.deepEqual(SISTEMAS.filter((sistema) => sistema.listo).map((sistema) => sistema.id), ["consulta", "micrositio", "spoa", "samai", "juris"]);
  assert.equal(SISTEMA_INICIAL, "consulta");
});

test("quitar un sistema lo esconde y la consulta nacional no se puede quitar", () => {
  const ocultos = leerOcultos('["spoa","consulta","inventado","sic"]');
  assert.deepEqual([...ocultos].sort(), ["sic", "spoa"]);
  const visibles = sistemasVisibles(ocultos).map((sistema) => sistema.id);
  assert.deepEqual(visibles, ["consulta", "micrositio", "samai", "juris", "externa", "supersociedades"]);
  assert.equal(guardarOcultos(ocultos), '["spoa","sic"]');
});

test("lo guardado dañado deja todos los sistemas a la vista", () => {
  assert.equal(leerOcultos("no es json").size, 0);
  assert.equal(leerOcultos('{"spoa":true}').size, 0);
  assert.equal(leerOcultos(null).size, 0);
  assert.equal(sistemasVisibles().length, 8);
});

test("un sistema escondido o desconocido vuelve a la consulta nacional", () => {
  const ocultos = new Set(["samai"]);
  assert.equal(sistemaElegible("samai", ocultos), "consulta");
  assert.equal(sistemaElegible("otro", ocultos), "consulta");
  assert.equal(sistemaElegible("sic", ocultos), "sic");
});
