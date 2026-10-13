import test from "node:test";
import assert from "node:assert/strict";
import {
  URL_VERSION,
  compararVersiones,
  consultarVersion,
  archivoParaPlataforma,
  urlDescarga,
} from "../src/actualizar.js";

test("compara versiones por número, no por letra", () => {
  assert.equal(compararVersiones("3.1.0", "3.2.0"), -1);
  assert.equal(compararVersiones("3.2.0", "3.1.0"), 1);
  assert.equal(compararVersiones("3.1.0", "3.1.0"), 0);
  assert.equal(compararVersiones("3.9.0", "3.10.0"), -1);
  assert.equal(compararVersiones("v3.1.0", "3.1.0"), 0);
});

test("elige el instalador de cada computador", () => {
  const info = { archivos: { win32: "Vigencia-Setup.exe", darwin: "Vigencia.dmg", linux: "Vigencia.AppImage" } };
  assert.equal(archivoParaPlataforma(info, "win32"), "Vigencia-Setup.exe");
  assert.equal(archivoParaPlataforma(info, "darwin"), "Vigencia.dmg");
  assert.equal(archivoParaPlataforma(info, "linux"), "Vigencia.AppImage");
  assert.equal(archivoParaPlataforma(info, "freebsd"), null);
  assert.equal(archivoParaPlataforma({}, "linux"), null);
});

test("la descarga sale del CDN", () => {
  assert.equal(urlDescarga("Vigencia.dmg"), "https://vigencia.askleia.co/Vigencia.dmg");
  assert.equal(urlDescarga("Vigencia.dmg", "https://vigencia.askleia.co/"), "https://vigencia.askleia.co/Vigencia.dmg");
  assert.equal(urlDescarga(""), null);
  assert.equal(URL_VERSION, "https://vigencia.askleia.co/version.json");
});

function fetchFalso(info) {
  return async () => ({ ok: true, json: async () => info });
}

test("avisa cuando hay versión nueva y calla cuando no", async () => {
  const info = { version: "3.2.0", notas: "n", archivos: { linux: "Vigencia.AppImage" } };
  const nueva = await consultarVersion("3.1.0", { fetchImpl: fetchFalso(info), platform: "linux" });
  assert.equal(nueva.novedad, true);
  assert.equal(nueva.disponible, "3.2.0");
  assert.equal(nueva.archivo, "Vigencia.AppImage");
  const misma = await consultarVersion("3.2.0", { fetchImpl: fetchFalso(info), platform: "linux" });
  assert.equal(misma.novedad, false);
  assert.equal(misma.archivo, null);
});

test("sin red o sin respuesta no tumba nada", async () => {
  const cae = await consultarVersion("3.1.0", {
    fetchImpl: async () => { throw new Error("sin red"); },
  });
  assert.equal(cae.disponible, null);
  assert.equal(cae.novedad, false);
  const mala = await consultarVersion("3.1.0", { fetchImpl: async () => ({ ok: false }) });
  assert.equal(mala.disponible, null);
  const rota = await consultarVersion("3.1.0", {
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error(" roto"); } }),
  });
  assert.equal(rota.disponible, null);
});
