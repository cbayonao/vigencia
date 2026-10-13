import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as moduloNodo from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Aviso } from "./db.js";

// node-llama-cpp 3.22.1 lee este archivo al importarse. El instalador deja
// fuera la carpeta llama/ (ahí está el código fuente, cientos de MB) y con
// ella se iba también este JSON de 28 bytes. Sin él el import falla y la
// ventana dice que el motor no está instalado, aunque el .node sí viajó.
const RELEASE_MOTOR = "v0.5.0";
const RELEASE_JSON = `{\n    "release": "${RELEASE_MOTOR}"\n}\n`;
const NOMBRE_RELEASE = "binariesGithubRelease.json";
const VERSION_RESPALDO = "3.22.1";

export const AVISO_MOTOR = "El motor nativo no está en este computador. Instálelo en Menú, Modelos de IA. El modelo Sencillo no lo necesita.";

const PLATAFORMAS = {
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "win32-x64": "win-x64",
  "win32-arm64": "win-arm64",
  "darwin-x64": "mac-x64",
  "darwin-arm64": "mac-arm64-metal",
};

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
let releaseListo = false;
let ganchoListo = false;
let carpetaDatos = "";

export function plataformaDe(platform = process.platform, arch = process.arch) {
  const carpeta = PLATAFORMAS[`${platform}-${arch}`];
  if (!carpeta) return null;
  return { carpeta, paquete: `@node-llama-cpp/${carpeta}` };
}

export function esRutaRelease(ruta) {
  const normal = String(ruta || "").replaceAll("\\", "/");
  return normal.endsWith(`node-llama-cpp/llama/${NOMBRE_RELEASE}`);
}

function contenidoRelease(opciones) {
  const encoding = typeof opciones === "string" ? opciones : opciones?.encoding;
  if (!encoding) return Buffer.from(RELEASE_JSON);
  return Buffer.from(RELEASE_JSON).toString(encoding);
}

// Si el JSON no está (típico del instalador), la lectura devuelve el release
// de esta versión. Si el archivo existe, se lee tal cual.
export function prepararReleaseMotor() {
  if (releaseListo) return;
  releaseListo = true;
  const leer = fs.readFile;
  fs.readFile = function leerConRelease(ruta, opciones, callback) {
    let cb = callback;
    let opts = opciones;
    if (typeof opciones === "function") {
      cb = opciones;
      opts = undefined;
    }
    if (typeof cb !== "function" || !esRutaRelease(ruta)) return leer.apply(this, arguments);
    const terminar = (error, data) => {
      if (error?.code === "ENOENT") cb(null, contenidoRelease(opts));
      else cb(error, data);
    };
    if (opts === undefined) return leer.call(this, ruta, terminar);
    return leer.call(this, ruta, opts, terminar);
  };
  const leerSync = fs.readFileSync;
  fs.readFileSync = function leerSyncConRelease(ruta, opts) {
    try {
      return leerSync.call(this, ruta, opts);
    } catch (error) {
      if (error?.code === "ENOENT" && esRutaRelease(ruta)) return contenidoRelease(opts);
      throw error;
    }
  };
  const leerPromesa = fs.promises.readFile.bind(fs.promises);
  fs.promises.readFile = async function leerPromesaConRelease(ruta, opts) {
    try {
      return await leerPromesa(ruta, opts);
    } catch (error) {
      if (error?.code === "ENOENT" && esRutaRelease(ruta)) return contenidoRelease(opts);
      throw error;
    }
  };
}

export function esFalloDeMotor(error) {
  const codigo = error?.code || "";
  const nombre = error?.name || "";
  const texto = String(error?.message || error || "");
  if (codigo === "ERR_MODULE_NOT_FOUND" || codigo === "ENOENT") return true;
  if (nombre === "NoBinaryFoundError") return true;
  return /NoBinaryFound|Cannot find package ['"]node-llama-cpp['"]|binariesGithubRelease|llama-addon/.test(texto);
}

export function carpetaPaquete(datosDir, carpeta) {
  return path.join(datosDir, "motor", "node_modules", "@node-llama-cpp", carpeta);
}

export function buscarAddon(raiz) {
  const bins = path.join(raiz, "bins");
  if (!fs.existsSync(bins)) return null;
  for (const nombre of fs.readdirSync(bins)) {
    const candidato = path.join(bins, nombre, "llama-addon.node");
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}

export function archivoDePaquete(datosDir, specifier) {
  if (!datosDir || typeof specifier !== "string" || !specifier.startsWith("@node-llama-cpp/")) return null;
  const carpeta = specifier.slice("@node-llama-cpp/".length);
  if (!carpeta || carpeta.includes("/") || carpeta.includes("\\") || carpeta.includes("..")) return null;
  const raiz = carpetaPaquete(datosDir, carpeta);
  const indice = path.join(raiz, "dist", "index.js");
  if (!fs.existsSync(indice) || !buscarAddon(raiz)) return null;
  return indice;
}

// El motor busca @node-llama-cpp/<plataforma> junto a su propio código.
// Lo descargado vive en la carpeta de datos: este gancho lo encuentra ahí.
export function usarDatosMotor(datosDir) {
  carpetaDatos = datosDir || "";
  if (ganchoListo || typeof moduloNodo.registerHooks !== "function") return;
  ganchoListo = true;
  moduloNodo.registerHooks({
    resolve(specifier, context, next) {
      const local = archivoDePaquete(carpetaDatos, specifier);
      if (!local) return next(specifier, context);
      return { url: pathToFileURL(local).href, shortCircuit: true };
    },
  });
}

function binarioEmpaquetado(plat, opciones) {
  const bases = [opciones.raiz, opciones.recursos ? path.join(opciones.recursos, "app.asar.unpacked") : ""].filter(Boolean);
  for (const base of bases) {
    const addon = buscarAddon(path.join(base, "node_modules", "@node-llama-cpp", plat.carpeta));
    if (addon) return addon;
  }
  return null;
}

export function estadoMotor(datosDir, opciones = {}) {
  const plat = plataformaDe(opciones.platform ?? process.platform, opciones.arch ?? process.arch);
  if (!plat) return { listo: false, plataforma: null, origen: null };
  if (buscarAddon(carpetaPaquete(datosDir, plat.carpeta))) {
    return { listo: true, plataforma: plat.carpeta, origen: "descarga" };
  }
  if (binarioEmpaquetado(plat, opciones)) {
    return { listo: true, plataforma: plat.carpeta, origen: "aplicacion" };
  }
  return { listo: false, plataforma: plat.carpeta, origen: null };
}

export function versionDelPaquete(raiz, paquete) {
  const candidatos = [
    path.join(raiz || "", "node_modules", "node-llama-cpp", "package.json"),
    path.join(raiz || "", "resources", "app.asar", "node_modules", "node-llama-cpp", "package.json"),
  ];
  for (const ruta of candidatos) {
    try {
      const dato = JSON.parse(fs.readFileSync(ruta, "utf8"));
      const version = dato?.optionalDependencies?.[paquete];
      if (version) return version;
    } catch {
      /* el otro candidato */
    }
  }
  return VERSION_RESPALDO;
}

export async function urlDelTarball(paquete, version, fetchImpl = globalThis.fetch) {
  const respuesta = await fetchImpl(`https://registry.npmjs.org/${paquete}/${version}`);
  if (!respuesta?.ok) throw new Aviso("No pude consultar el motor. Revise la conexión.");
  const meta = await respuesta.json();
  const url = meta?.dist?.tarball;
  if (!url || !String(url).startsWith("https://")) throw new Aviso("El registro del motor no devolvió un archivo.");
  return url;
}

export async function descargarA(url, destino, onProgreso, fetchImpl = globalThis.fetch) {
  const respuesta = await fetchImpl(url);
  if (!respuesta?.ok || !respuesta.body) throw new Aviso("No pude descargar el motor. Revise la conexión.");
  const total = Number(respuesta.headers?.get?.("content-length")) || 0;
  const archivo = fs.createWriteStream(destino);
  const lector = respuesta.body.getReader();
  let recibidos = 0;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      recibidos += value.length;
      if (!archivo.write(value)) {
        await new Promise((resolve) => archivo.once("drain", resolve));
      }
      try {
        onProgreso?.({ fase: "descarga", recibidos, total });
      } catch {
        /* la ventana ya no escucha */
      }
    }
  } catch (error) {
    archivo.destroy();
    throw error;
  }
  await new Promise((resolve, reject) => {
    archivo.on("error", reject);
    archivo.end(resolve);
  });
}

export async function extraerPaquete(tgz, destino) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-motor-"));
  try {
    try {
      await exec("tar", ["-xzf", tgz, "-C", tmp]);
    } catch {
      throw new Aviso("No pude extraer el motor. Revise la conexión e intente otra vez.");
    }
    const paquete = path.join(tmp, "package");
    if (!buscarAddon(paquete)) throw new Aviso("El paquete del motor no trae el binario de este computador.");
    fs.rmSync(destino, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.cpSync(paquete, destino, { recursive: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function debeOmitir(relativo) {
  const normal = `/${String(relativo || "").replaceAll("\\", "/")}`;
  if (normal.includes("/node-llama-cpp/llama/llama.cpp")) return true;
  if (normal.includes("/node-llama-cpp/llama/localBuilds")) return true;
  if (normal.includes("/node-llama-cpp/llama/gitRelease.bundle")) return true;
  if (normal.includes("/node-llama-cpp/llama/addon")) return true;
  return /\.(node|so|dll|dylib)$/i.test(normal);
}

export function copiarArbol(origen, destino, raiz = origen) {
  const rel = path.relative(raiz, origen);
  if (rel && debeOmitir(rel)) return;
  const stat = fs.statSync(origen);
  if (stat.isDirectory()) {
    fs.mkdirSync(destino, { recursive: true });
    for (const nombre of fs.readdirSync(origen)) copiarArbol(path.join(origen, nombre), path.join(destino, nombre), raiz);
    return;
  }
  if (!stat.isFile()) return;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origen, destino);
}

function rutaPaqueteInstalado() {
  try {
    return require.resolve("node-llama-cpp/package.json");
  } catch {
    return "";
  }
}

function estaEnAsar(ruta) {
  return String(ruta || "").includes(`${path.sep}.asar${path.sep}`) || String(ruta || "").includes(".asar/");
}

// El instalador mete el JS en el asar. La prueba del binario arranca ese
// archivo en otro proceso, y ese proceso no puede ejecutar una ruta de asar.
// Se copia el JS a la carpeta de datos (archivos reales) y el .node desde
// app.asar.unpacked. La descarga del botón usa la misma carpeta.
export function entradaDelMotor() {
  return asegurarCopiaMotor(carpetaDatos, { recursos: process.resourcesPath });
}

export function asegurarCopiaMotor(datosDir, opciones = {}) {
  if (!datosDir) return null;
  const instalado = opciones.paqueteInstalado ?? rutaPaqueteInstalado();
  if (!estaEnAsar(instalado)) return null;
  const nodeModulesAsar = path.resolve(instalado, "..", "..");
  const destino = path.join(datosDir, "motor", "node_modules");
  const indice = path.join(destino, "node-llama-cpp", "dist", "index.js");
  if (!fs.existsSync(indice)) copiarArbol(nodeModulesAsar, destino);
  const plat = plataformaDe(opciones.platform ?? process.platform, opciones.arch ?? process.arch);
  const unpacked = opciones.recursos
    ? path.join(opciones.recursos, "app.asar.unpacked", "node_modules")
    : "";
  if (unpacked && fs.existsSync(unpacked)) {
    const origenPlat = plat ? path.join(unpacked, "@node-llama-cpp", plat.carpeta) : "";
    if (origenPlat && fs.existsSync(origenPlat)) {
      fs.cpSync(origenPlat, path.join(destino, "@node-llama-cpp", plat.carpeta), { recursive: true });
    }
  }
  const release = path.join(destino, "node-llama-cpp", "llama", NOMBRE_RELEASE);
  if (!fs.existsSync(release)) {
    fs.mkdirSync(path.dirname(release), { recursive: true });
    fs.writeFileSync(release, RELEASE_JSON);
  }
  return fs.existsSync(indice) ? indice : null;
}

export async function instalarMotor(datosDir, opciones = {}) {
  const plat = plataformaDe(opciones.platform ?? process.platform, opciones.arch ?? process.arch);
  if (!plat) throw new Aviso("Este computador no tiene un motor preparado. Use el modelo Sencillo.");
  const destino = carpetaPaquete(datosDir, plat.carpeta);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-motor-"));
  const tgz = path.join(tmp, "motor.tgz");
  try {
    if (opciones.tarball) {
      fs.copyFileSync(opciones.tarball, tgz);
    } else {
      const version = opciones.version || versionDelPaquete(opciones.raiz, plat.paquete);
      const fetchImpl = opciones.fetchImpl;
      const url = await urlDelTarball(plat.paquete, version, fetchImpl);
      await descargarA(url, tgz, opciones.onProgreso, fetchImpl);
    }
    try {
      opciones.onProgreso?.({ fase: "extraer" });
    } catch {
      /* la ventana ya no escucha */
    }
    await extraerPaquete(tgz, destino);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  usarDatosMotor(datosDir);
  return estadoMotor(datosDir, opciones);
}

prepararReleaseMotor();
