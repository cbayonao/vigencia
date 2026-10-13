import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Trae los binarios de Windows del motor aunque se empaquete desde Linux.
// npm no instala opcionales de otra plataforma, así que se baja el tarball
// y se coloca donde electron-builder lo espera. Idempotente.
const RAIZ = path.resolve(import.meta.dirname, "..");
const DESTINO = path.join(RAIZ, "node_modules", "@node-llama-cpp", "win-x64");
const SENAL = path.join(DESTINO, "bins", "win-x64", "llama-addon.node");

function versionEsperada() {
  const dep = JSON.parse(fs.readFileSync(path.join(RAIZ, "node_modules", "node-llama-cpp", "package.json"), "utf8"));
  return dep.optionalDependencies?.["@node-llama-cpp/win-x64"];
}

if (fs.existsSync(SENAL)) {
  console.log("Binarios win-x64 ya presentes.");
  process.exit(0);
}
const version = versionEsperada();
if (!version) {
  console.error("node-llama-cpp no declara el opcional win-x64. Corra npm install primero.");
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-win-"));
try {
  execFileSync("npm", ["pack", `@node-llama-cpp/win-x64@${version}`], { cwd: tmp, stdio: "inherit" });
  const tgz = fs.readdirSync(tmp).find((nombre) => nombre.endsWith(".tgz"));
  if (!tgz) throw new Error("npm pack no dejó el tarball.");
  const extraido = path.join(tmp, "paquete");
  fs.mkdirSync(extraido, { recursive: true });
  execFileSync("tar", ["-xzf", path.join(tmp, tgz), "-C", extraido], { stdio: "inherit" });
  fs.rmSync(DESTINO, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.cpSync(path.join(extraido, "package"), DESTINO, { recursive: true });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!fs.existsSync(SENAL)) {
  console.error("No quedó el binario win-x64 tras extraer el tarball.");
  process.exit(1);
}
console.log("Binarios win-x64 listos para empaquetar.");
