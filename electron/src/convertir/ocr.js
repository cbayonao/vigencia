// OCR local con tesseract.js. El motor y el idioma español no viajan en
// el instalador: se bajan una sola vez desde Modelos de IA a la carpeta
// ocr/ de los datos. Al reconocer nunca se usa la red: langPath apunta a
// esa carpeta y cacheMethod es "none".
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const aqui = path.dirname(fileURLToPath(import.meta.url));

// Versiones fijas, las mismas del package-lock de desarrollo.
export const PAQUETES_OCR = [
  ["tesseract.js", "6.0.1"],
  ["tesseract.js-core", "6.1.2"],
  ["bmp-js", "0.1.0"],
  ["idb-keyval", "6.3.0"],
  ["is-url", "1.2.4"],
  ["node-fetch", "2.7.0"],
  ["whatwg-url", "5.0.0"],
  ["tr46", "0.0.3"],
  ["webidl-conversions", "3.0.1"],
  ["opencollective-postinstall", "2.0.3"],
  ["regenerator-runtime", "0.13.11"],
  ["wasm-feature-detect", "1.9.0"],
  ["zlibjs", "0.3.1"],
];

export const IDIOMA_OCR = {
  id: "spa",
  nombre: "Español",
  url: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz",
};

export const AVISO_OCR = "El reconocimiento de texto (OCR) no está instalado. Para leer PDF escaneados e imágenes, vaya a Menú, Modelos de IA, y pulse Instalar OCR en español. Se descarga una sola vez y después funciona sin internet.";

export function carpetaOcr(datosDir) {
  return process.env.VIGENCIA_OCR_DIR || path.join(datosDir, "ocr");
}

function rutaIdioma(dir, idioma = "spa") {
  return path.join(dir, `${idioma}.traineddata.gz`);
}

// Dónde está tesseract.js: primero lo descargado; en desarrollo, el de
// node_modules (devDependency, no entra al instalador).
export function resolverTesseract(datosDir, { permitirDesarrollo = true } = {}) {
  const dir = carpetaOcr(datosDir);
  const descargado = path.join(dir, "node_modules", "tesseract.js", "package.json");
  if (fs.existsSync(descargado) && fs.existsSync(path.join(dir, "node_modules", "tesseract.js-core", "package.json"))) {
    return path.join(dir, "node_modules", "tesseract.js");
  }
  if (permitirDesarrollo && !aqui.includes("app.asar")) {
    try {
      const req = createRequire(path.join(aqui, "..", "..", "package.json"));
      return path.dirname(req.resolve("tesseract.js/package.json"));
    } catch {
      /* no está en desarrollo */
    }
  }
  return "";
}

export function estadoOcr(datosDir) {
  const dir = carpetaOcr(datosDir);
  const motor = resolverTesseract(datosDir);
  const idioma = fs.existsSync(rutaIdioma(dir));
  return { listo: Boolean(motor && idioma), motor: Boolean(motor), idioma, carpeta: dir, aviso: motor && idioma ? "" : AVISO_OCR };
}

export async function crearLectorOcr(datosDir, { idioma = "spa", logger } = {}) {
  const estado = estadoOcr(datosDir);
  if (!estado.listo) {
    const error = new Error(AVISO_OCR);
    error.codigo = "sin-ocr";
    throw error;
  }
  const raiz = resolverTesseract(datosDir);
  const req = createRequire(path.join(raiz, "package.json"));
  const Tesseract = req(raiz);
  const worker = await Tesseract.createWorker(idioma, 1, {
    langPath: estado.carpeta,
    cacheMethod: "none",
    gzip: true,
    logger: logger || (() => {}),
    errorHandler: () => {},
  });
  return {
    async reconocer(imagen) {
      const { data } = await worker.recognize(imagen);
      return { texto: data.text || "", confianza: Number(data.confidence) || 0 };
    },
    async cerrar() {
      await worker.terminate();
    },
  };
}

// ---------- Descarga, solo cuando el usuario la pide ----------

async function metaDelPaquete(nombre, version, fetchImpl) {
  const r = await fetchImpl(`https://registry.npmjs.org/${nombre}/${version}`);
  if (!r?.ok) throw new Error("No pude consultar el paquete del OCR. Revise la conexión.");
  const meta = await r.json();
  if (!String(meta?.dist?.tarball || "").startsWith("https://")) throw new Error("El registro no devolvió el paquete del OCR.");
  return meta.dist;
}

async function bajar(url, fetchImpl) {
  const r = await fetchImpl(url);
  if (!r?.ok) throw new Error("No pude descargar el OCR. Revise la conexión.");
  return Buffer.from(await r.arrayBuffer());
}

function integridadValida(buffer, integridad) {
  const m = /^sha512-(.+)$/.exec(String(integridad || ""));
  if (!m) return true;
  return crypto.createHash("sha512").update(buffer).digest("base64") === m[1];
}

export async function instalarOcr(datosDir, { onProgreso, fetchImpl = globalThis.fetch } = {}) {
  const dir = carpetaOcr(datosDir);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-ocr-"));
  const destino = path.join(dir, "node_modules");
  const nuevo = `${destino}.nuevo`;
  try {
    fs.rmSync(nuevo, { recursive: true, force: true });
    fs.mkdirSync(nuevo, { recursive: true });
    let i = 0;
    for (const [nombre, version] of PAQUETES_OCR) {
      onProgreso?.({ fase: "motor", paso: ++i, total: PAQUETES_OCR.length + 1, nombre });
      const dist = await metaDelPaquete(nombre, version, fetchImpl);
      const datos = await bajar(dist.tarball, fetchImpl);
      if (!integridadValida(datos, dist.integrity)) throw new Error(`El paquete ${nombre} llegó dañado. Intente otra vez.`);
      const tgz = path.join(tmp, `${nombre}.tgz`);
      fs.writeFileSync(tgz, datos);
      const salida = path.join(tmp, nombre);
      fs.mkdirSync(salida, { recursive: true });
      await exec("tar", ["-xzf", tgz, "-C", salida]);
      fs.cpSync(path.join(salida, "package"), path.join(nuevo, nombre), { recursive: true });
    }
    onProgreso?.({ fase: "idioma", paso: PAQUETES_OCR.length + 1, total: PAQUETES_OCR.length + 1, nombre: IDIOMA_OCR.nombre });
    const idioma = await bajar(IDIOMA_OCR.url, fetchImpl);
    if (idioma[0] !== 0x1f || idioma[1] !== 0x8b) throw new Error("El idioma del OCR llegó dañado. Intente otra vez.");
    fs.writeFileSync(`${rutaIdioma(dir)}.tmp`, idioma);
    fs.renameSync(`${rutaIdioma(dir)}.tmp`, rutaIdioma(dir));
    fs.rmSync(destino, { recursive: true, force: true });
    fs.renameSync(nuevo, destino);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(nuevo, { recursive: true, force: true });
  }
  return estadoOcr(datosDir);
}

export function quitarOcr(datosDir) {
  const dir = carpetaOcr(datosDir);
  fs.rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
  fs.rmSync(rutaIdioma(dir), { force: true });
  return estadoOcr(datosDir);
}
