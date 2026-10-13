import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Humo post-empaquetado: el instalador no sirve sin el motor nativo.
// El JS va dentro del asar y los bins nativos en app.asar.unpacked.
// Uso: node script/verificar-motor.mjs dist/linux-unpacked linux-x64
//      node script/verificar-motor.mjs dist/win-unpacked win-x64
//      node script/verificar-motor.mjs dist/mac mac-arm64
const entrada = process.argv[2];
const plataforma = process.argv[3];
if (!entrada || !plataforma) {
  console.error("Uso: verificar-motor.mjs <carpeta-unpacked|dist> <linux-x64|win-x64|mac-arm64|mac-x64>");
  process.exit(2);
}
let dir = path.resolve(entrada);
if (plataforma.startsWith("mac")) {
  // En mac el empaquetado vive en Vigencia.app/Contents/Resources.
  const apps = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  for (const app of apps) {
    if (!app.isDirectory() || !app.name.endsWith(".app")) continue;
    const contents = path.join(dir, app.name, "Contents");
    if (fs.existsSync(path.join(contents, "Resources", "app.asar"))) {
      dir = contents;
      break;
    }
  }
} else if (!fs.existsSync(path.join(dir, "resources", "app.asar"))) {
  const candidato = plataforma.startsWith("win") ? "win-unpacked" : "linux-unpacked";
  if (fs.existsSync(path.join(dir, candidato, "resources", "app.asar"))) {
    dir = path.join(dir, candidato);
  }
}
const require = createRequire(path.join(import.meta.dirname, "..", "package.json"));
let asar = null;
try {
  asar = require("@electron/asar");
} catch {
  console.error("Falta @electron/asar en node_modules. Corra npm install.");
  process.exit(2);
}
const recursos = plataforma.startsWith("mac")
  ? path.join(dir, "Resources")
  : path.resolve(dir, "resources");
if (!fs.existsSync(path.join(recursos, "app.asar"))) {
  console.error(`No encontré app.asar en ${recursos}.`);
  console.error("No publique este instalador: la IA local fallará.");
  process.exit(1);
}
const empaquetado = asar.listPackage(path.join(recursos, "app.asar"));
const enAsar = new Set(empaquetado.map((ruta) => ruta.replace(/\\/g, "/")));
const exigirAsar = [
  "node_modules/node-llama-cpp/package.json",
  "node_modules/node-llama-cpp/dist/index.js",
  "node_modules/node-llama-cpp/llama/binariesGithubRelease.json",
  `node_modules/@node-llama-cpp/${plataforma}/package.json`,
];
const exigirFuera = [
  `node_modules/@node-llama-cpp/${plataforma}/bins/${plataforma}/llama-addon.node`,
];
const faltan = [
  ...exigirAsar.filter((rel) => !enAsar.has(`/${rel}`)).map((rel) => `asar: ${rel}`),
  ...exigirFuera.filter((rel) => !fs.existsSync(path.join(recursos, "app.asar.unpacked", rel))).map((rel) => `unpacked: ${rel}`),
];
if (faltan.length) {
  console.error(`Falta el motor en ${dir}:`);
  for (const rel of faltan) console.error(`  - ${rel}`);
  console.error("No publique este instalador: la IA local fallará.");
  process.exit(1);
}
// Avisa si se colaron binarios de otras plataformas (engordan sin usarse).
// Tolera win-x64 dentro del asar de linux y viceversa (solo package.json).
const pesadas = ["linux-arm", "linux-x64-cuda", "linux-x64-vulkan"];
if (!plataforma.startsWith("mac")) {
  pesadas.push("mac-");
} else {
  pesadas.push("linux-", "win-");
}
const sobra = [...enAsar].filter((ruta) => pesadas.some((p) => ruta.includes(`@node-llama-cpp/${p}`)));
if (sobra.length) {
  console.warn(`Aviso: hay binarios de otras plataformas en el instalador (${sobra.length} archivos). Engordan el exe sin usarse.`);
}
console.log(`Motor verificado en ${dir} (${plataforma}).`);
