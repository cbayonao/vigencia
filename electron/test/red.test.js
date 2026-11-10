import assert from "node:assert/strict";
import test from "node:test";
import { normalizarProxyUrl, validarRed } from "../compartido/red.js";

test("el proxy es opcional y valida el formato", () => {
  assert.equal(normalizarProxyUrl(""), "");
  assert.equal(normalizarProxyUrl(null), "");
  assert.ok(normalizarProxyUrl("servidor:8080")?.includes("servidor"));
  assert.equal(normalizarProxyUrl("http://usuario:clave@servidor:8080/p")?.includes("usuario"), true);
  assert.equal(normalizarProxyUrl("ftp://x"), null);
  assert.equal(normalizarProxyUrl("http://"), null);
});

test("validarRed acepta vacío y rechaza lo imposible", () => {
  const ok = validarRed({ proxy: "" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.valores, { proxy: "" });
  assert.equal(validarRed({ proxy: "servidor:8080" }).valores.proxy.includes("servidor"), true);
  assert.equal(validarRed({ proxy: "ftp://x" }).ok, false);
});
