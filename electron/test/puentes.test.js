import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Lo que el renderer llama por window.vigencia.* tiene que estar expuesto
// en preload: un nombre distinto a lado y lado tumba la acción en silencio.
test("el renderer solo usa puentes expuestos en preload", () => {
  const app = fs.readFileSync(new URL("../renderer/app.js", import.meta.url), "utf8");
  const preload = fs.readFileSync(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const usados = new Set([...app.matchAll(/window\.vigencia\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  const expuestos = new Set([...preload.matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]));
  assert.ok(usados.size > 0 && expuestos.size > 0);
  for (const nombre of usados) {
    assert.ok(expuestos.has(nombre), `window.vigencia.${nombre} no está expuesto en preload`);
  }
});
