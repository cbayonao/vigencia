import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RENDERER = ["app.js", "documentos.js", "juris.js", "comentarios.js"];

// Lo que el renderer llama por window.vigencia.* tiene que estar expuesto
// en preload: un nombre distinto a lado y lado tumba la acción en silencio.
test("el renderer solo usa puentes expuestos en preload", () => {
  const app = RENDERER
    .map((archivo) => fs.readFileSync(new URL(`../renderer/${archivo}`, import.meta.url), "utf8"))
    .join("\n");
  const preload = fs.readFileSync(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const usados = new Set([...app.matchAll(/window\.vigencia\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  const expuestos = new Set([...preload.matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]));
  assert.ok(usados.size > 0 && expuestos.size > 0);
  for (const nombre of usados) {
    assert.ok(expuestos.has(nombre), `window.vigencia.${nombre} no está expuesto en preload`);
  }
});

// El navegador no resuelve node:*: un import así en el grafo del renderer
// tumba el arranque completo sin error visible (pasó con node:crypto por
// compartido/licencia.js). Lo de Node vive solo en main (src/).
test("el grafo del renderer no importa módulos de Node", () => {
  const raiz = new URL("..", import.meta.url);
  const vistos = new Set();
  const malos = [];
  function visitar(ruta) {
    const clave = path.normalize(ruta);
    if (vistos.has(clave)) return;
    vistos.add(clave);
    let texto = "";
    try {
      texto = fs.readFileSync(clave, "utf8");
    } catch {
      return;
    }
    for (const m of texto.matchAll(/from\s+["']([^"']+)["']/g)) {
      const objetivo = m[1];
      if (objetivo.startsWith("node:")) {
        malos.push(`${path.basename(clave)} importa ${objetivo}`);
        continue;
      }
      if (objetivo.startsWith(".")) {
        visitar(path.resolve(path.dirname(clave), objetivo.endsWith(".js") ? objetivo : `${objetivo}.js`));
      }
    }
  }
  for (const archivo of RENDERER) visitar(new URL(`../renderer/${archivo}`, import.meta.url).pathname);
  assert.deepEqual(malos, []);
});
