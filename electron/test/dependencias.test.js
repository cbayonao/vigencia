import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { builtinModules } from "node:module";

const RAIZ = new URL("..", import.meta.url).pathname;
const SRC = path.join(RAIZ, "src");
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
const DEPS = new Set(Object.keys(pkg.dependencies || {}));
const NODOS = new Set(builtinModules.map((m) => m.replace(/^node:/, "")));

function archivos(dir, salida = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) archivos(ruta, salida);
    else if (/\.c?js$/.test(entrada.name)) salida.push(ruta);
  }
  return salida;
}

// Lo que el código empaquetado importa debe viajar en el instalador:
// o es módulo de Node, o está declarado en dependencies. Un transitivo
// (como pasó con undici) resuelve en desarrollo y revienta instalada.
// "electron" lo pone el entorno en main y preload, no va en node_modules.
test("cada import del main existe en dependencies o es de Node", () => {
  assert.ok(DEPS.size > 0);
  const faltantes = [];
  for (const ruta of archivos(SRC)) {
    const texto = fs.readFileSync(ruta, "utf8");
    const pedidos = new Set();
    for (const m of texto.matchAll(/from\s+["']([^"']+)["']/g)) pedidos.add(m[1]);
    for (const m of texto.matchAll(/require\s*\(\s*["']([^"']+)["']/g)) pedidos.add(m[1]);
    for (const pedido of pedidos) {
      if (pedido.startsWith(".") || pedido.startsWith("/") || pedido.startsWith("node:")) continue;
      const raiz = pedido.split("/")[0];
      if (raiz === "electron") continue;
      if (NODOS.has(raiz) || NODOS.has(`node:${raiz}`) || DEPS.has(raiz)) continue;
      faltantes.push(`${path.relative(SRC, ruta)} importa "${pedido}" que no está en dependencies`);
    }
  }
  assert.deepEqual(faltantes, []);
});
