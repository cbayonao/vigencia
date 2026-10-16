import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Humo post-empaquetado: el instalador no sirve sin el motor nativo.
// El JS va dentro del asar y los bins nativos en app.asar.unpacked.
// Uso: node script/verificar-motor.mjs dist/linux-unpacked linux-x64
//      node script/verificar-motor.mjs dist/win-unpacked win-x64
//      node script/verificar-motor.mjs dist mac-arm64-metal
const entrada = process.argv[2];
const plataforma = process.argv[3];
if (!entrada || !plataforma) {
  console.error("Uso: verificar-motor.mjs <carpeta-unpacked|dist> <linux-x64|win-x64|mac-arm64-metal|mac-x64>");
  process.exit(2);
}
let dir = path.resolve(entrada);
if (plataforma.startsWith("mac")) {
  // electron-builder usa dist/mac-<arch>/Vigencia.app (o dist/mac).
  const bases = [dir, path.join(dir, "mac-arm64"), path.join(dir, "mac-x64"), path.join(dir, "mac")];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const apps = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith(".app"));
    for (const app of apps) {
      const contents = path.join(base, app.name, "Contents");
      if (fs.existsSync(path.join(contents, "Resources", "app.asar"))) {
        dir = contents;
        break;
      }
    }
    if (dir !== path.resolve(entrada)) break;
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
  `node_modules/@node-llama-cpp/${plataforma}`,
];
// El gancho resuelve el binario desde lo desempaquetado: su dist/ y su
// package.json (para la versión) tienen que estar fuera del asar.
const exigirSuelto = [
  `node_modules/@node-llama-cpp/${plataforma}/dist/index.js`,
  `node_modules/@node-llama-cpp/${plataforma}/package.json`,
];
// El .node va en bins/<plataforma>/, pero el layout exacto cambia por SO:
// basta con que el opcional desempaquetado traiga algún .node.
function hayNodeEmpaquetado(base) {
  const pila = [base];
  while (pila.length) {
    const actual = pila.pop();
    let entradas = [];
    try {
      entradas = fs.readdirSync(actual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const ruta = path.join(actual, e.name);
      if (!e.isDirectory() && e.name.endsWith(".node")) return true;
      if (e.isDirectory()) pila.push(ruta);
    }
  }
  return false;
}
const faltan = [
  ...exigirAsar.filter((rel) => !enAsar.has(`/${rel}`)).map((rel) => `asar: ${rel}`),
  ...exigirSuelto
    .filter((rel) => !fs.existsSync(path.join(recursos, "app.asar.unpacked", rel)))
    .map((rel) => `unpacked: ${rel}`),
  ...exigirFuera
    .filter((rel) => !hayNodeEmpaquetado(path.join(recursos, "app.asar.unpacked", rel)))
    .map((rel) => `unpacked: sin .node en ${rel}`),
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

// Conversor a Markdown: pdfjs (con su worker, cmaps y fuentes estándar),
// mammoth, turndown y SheetJS van en el asar. El OCR (tesseract.js y su
// wasm) no viaja en el instalador: se baja desde Modelos de IA.
const exigirConversor = [
  "src/convertir/proceso.js",
  "src/convertir/convertidores.js",
  "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "node_modules/pdfjs-dist/cmaps/UniJIS-UCS2-H.bcmap",
  "node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb",
  "node_modules/mammoth/lib/index.js",
  "node_modules/turndown/package.json",
  "node_modules/xlsx/package.json",
];
const faltanConversor = exigirConversor.filter((rel) => !enAsar.has(`/${rel}`) && !fs.existsSync(path.join(recursos, "app.asar.unpacked", rel)));
if (faltanConversor.length) {
  console.error(`Falta el conversor a Markdown en ${dir}:`);
  for (const rel of faltanConversor) console.error(`  - ${rel}`);
  console.error("No publique este instalador: Convertir a Markdown fallará.");
  process.exit(1);
}
const ocrColado = [...enAsar].filter((ruta) => /node_modules\/tesseract\.js(-core)?\//.test(ruta));
if (ocrColado.length) {
  console.warn(`Aviso: el OCR se coló en el instalador (${ocrColado.length} archivos). Debe bajarse desde Modelos de IA.`);
}
console.log(`Conversor verificado en ${dir}.`);
