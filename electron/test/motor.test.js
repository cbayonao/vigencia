import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AVISO_MOTOR,
  archivoDePaquete,
  asegurarCopiaMotor,
  debeOmitir,
  esFalloDeMotor,
  esRutaRelease,
  estadoMotor,
  extraerPaquete,
  instalarMotor,
  plataformaDe,
  prepararReleaseMotor,
  urlDelTarball,
  versionDelPaquete,
} from "../src/motor.js";

test("la plataforma de este tipo de computador tiene paquete de npm", () => {
  assert.deepEqual(plataformaDe("linux", "x64"), { carpeta: "linux-x64", paquete: "@node-llama-cpp/linux-x64" });
  assert.deepEqual(plataformaDe("win32", "x64"), { carpeta: "win-x64", paquete: "@node-llama-cpp/win-x64" });
  assert.deepEqual(plataformaDe("darwin", "arm64"), { carpeta: "mac-arm64-metal", paquete: "@node-llama-cpp/mac-arm64-metal" });
  assert.equal(plataformaDe("linux", "arm64")?.carpeta, "linux-arm64");
  assert.equal(plataformaDe("freebsd", "x64"), null);
});

test("reconoce el json que el motor lee al arrancar y no otra ruta", () => {
  assert.equal(esRutaRelease("/app/node_modules/node-llama-cpp/llama/binariesGithubRelease.json"), true);
  assert.equal(esRutaRelease("C:\\app\\node_modules\\node-llama-cpp\\llama\\binariesGithubRelease.json"), true);
  assert.equal(esRutaRelease("/app/otra/binariesGithubRelease.json"), false);
});

test("si el release no está en el instalador, la lectura igual devuelve v0.5.0", async () => {
  prepararReleaseMotor();
  const ruta = path.join(os.tmpdir(), "node-llama-cpp", "llama", "binariesGithubRelease.json");
  const leido = await fs.promises.readFile(ruta, "utf8");
  assert.equal(JSON.parse(leido).release, "v0.5.0");
  const real = fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8");
  assert.match(real, /"name": "vigencia"/);
});

test("el aviso del motor nombra el menú y no pide reinstalar", () => {
  assert.match(AVISO_MOTOR, /Modelos de IA/);
  assert.doesNotMatch(AVISO_MOTOR, /Reinstale/);
  assert.equal(esFalloDeMotor({ name: "NoBinaryFoundError", message: "NoBinaryFoundError" }), true);
  assert.equal(esFalloDeMotor({ code: "ENOENT", message: "binariesGithubRelease.json" }), true);
  assert.equal(esFalloDeMotor(new Error("out of memory")), false);
});

test("la versión sale del opcional que declara node-llama-cpp", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-ver-"));
  const paquete = path.join(dir, "node_modules", "node-llama-cpp");
  fs.mkdirSync(paquete, { recursive: true });
  fs.writeFileSync(path.join(paquete, "package.json"), JSON.stringify({
    optionalDependencies: { "@node-llama-cpp/linux-x64": "3.22.1" },
  }));
  assert.equal(versionDelPaquete(dir, "@node-llama-cpp/linux-x64"), "3.22.1");
  assert.equal(versionDelPaquete(path.join(dir, "no-esta"), "@node-llama-cpp/linux-x64"), "3.22.1");
});

test("la url del tarball solo acepta https del registro", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ dist: { tarball: "https://registry.npmjs.org/paquete.tgz" } }),
  });
  assert.equal(
    await urlDelTarball("@node-llama-cpp/linux-x64", "3.22.1", fetchImpl),
    "https://registry.npmjs.org/paquete.tgz",
  );
  await assert.rejects(
    () => urlDelTarball("@node-llama-cpp/linux-x64", "3.22.1", async () => ({
      ok: true,
      json: async () => ({ dist: { tarball: "http://ejemplo.invalid/a.tgz" } }),
    })),
  );
});

function tarballFalso(dir) {
  const paquete = path.join(dir, "armado", "package");
  fs.mkdirSync(path.join(paquete, "dist"), { recursive: true });
  fs.mkdirSync(path.join(paquete, "bins", "linux-x64"), { recursive: true });
  fs.writeFileSync(path.join(paquete, "dist", "index.js"), "export const marca = \"falso\";\n");
  fs.writeFileSync(path.join(paquete, "bins", "linux-x64", "llama-addon.node"), "");
  fs.writeFileSync(path.join(paquete, "package.json"), "{\"name\":\"@node-llama-cpp/linux-x64\"}\n");
  const tgz = path.join(dir, "motor.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", path.join(dir, "armado"), "package"]);
  return tgz;
}

test("instalar desde un tarball deja el binario en la carpeta de datos y el gancho lo entrega", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-motor-"));
  const tgz = tarballFalso(dir);
  const estado = await instalarMotor(dir, {
    tarball: tgz,
    platform: "linux",
    arch: "x64",
    raiz: dir,
    recursos: "",
  });
  assert.equal(estado.listo, true);
  assert.equal(estado.origen, "descarga");
  assert.equal(estado.plataforma, "linux-x64");
  const indice = archivoDePaquete(dir, "@node-llama-cpp/linux-x64");
  assert.equal(indice.endsWith(`${path.sep}dist${path.sep}index.js`), true);
  assert.equal(archivoDePaquete(dir, "@node-llama-cpp/../otra"), null);
  const cargado = await import("@node-llama-cpp/linux-x64");
  assert.equal(cargado.marca, "falso");
});

test("sin descarga, el estado mira el binario que ya trae la aplicación", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-app-"));
  const bins = path.join(dir, "node_modules", "@node-llama-cpp", "win-x64", "bins", "win-x64");
  fs.mkdirSync(bins, { recursive: true });
  fs.writeFileSync(path.join(bins, "llama-addon.node"), "");
  const estado = estadoMotor(path.join(dir, "datos"), {
    platform: "win32",
    arch: "x64",
    raiz: dir,
    recursos: "",
  });
  assert.equal(estado.listo, true);
  assert.equal(estado.origen, "aplicacion");
});

test("la copia fuera del asar deja el JS, el release y el binario, sin el código fuente", () => {
  assert.equal(debeOmitir("node-llama-cpp/llama/llama.cpp/src/a.cpp"), true);
  assert.equal(debeOmitir("node-llama-cpp/dist/index.js"), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-asar-"));
  const nodeModules = path.join(dir, "app.asar", "node_modules");
  fs.mkdirSync(path.join(nodeModules, "node-llama-cpp", "dist"), { recursive: true });
  fs.mkdirSync(path.join(nodeModules, "node-llama-cpp", "llama", "llama.cpp"), { recursive: true });
  fs.writeFileSync(path.join(nodeModules, "node-llama-cpp", "dist", "index.js"), "export const marca = 1;\n");
  fs.writeFileSync(path.join(nodeModules, "node-llama-cpp", "llama", "llama.cpp", "grande.cpp"), "x");
  fs.writeFileSync(path.join(nodeModules, "node-llama-cpp", "package.json"), "{}\n");
  const unpacked = path.join(dir, "app.asar.unpacked", "node_modules", "@node-llama-cpp", "linux-x64", "bins", "linux-x64");
  fs.mkdirSync(unpacked, { recursive: true });
  fs.writeFileSync(path.join(unpacked, "llama-addon.node"), "bin");
  const datos = path.join(dir, "datos");
  const indice = asegurarCopiaMotor(datos, {
    paqueteInstalado: path.join(nodeModules, "node-llama-cpp", "package.json"),
    recursos: dir,
    platform: "linux",
    arch: "x64",
  });
  assert.equal(fs.existsSync(indice), true);
  assert.equal(fs.existsSync(path.join(datos, "motor", "node_modules", "node-llama-cpp", "llama", "llama.cpp", "grande.cpp")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(datos, "motor", "node_modules", "node-llama-cpp", "llama", "binariesGithubRelease.json"), "utf8")).release, "v0.5.0");
  assert.equal(fs.readFileSync(path.join(datos, "motor", "node_modules", "@node-llama-cpp", "linux-x64", "bins", "linux-x64", "llama-addon.node"), "utf8"), "bin");
});

test("extraer rechaza un paquete sin el binario", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-vacio-"));
  const paquete = path.join(dir, "armado", "package", "dist");
  fs.mkdirSync(paquete, { recursive: true });
  fs.writeFileSync(path.join(paquete, "index.js"), "export const marca = 1;\n");
  const tgz = path.join(dir, "vacio.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", path.join(dir, "armado"), "package"]);
  await assert.rejects(() => extraerPaquete(tgz, path.join(dir, "destino")), /no trae el binario/);
});
