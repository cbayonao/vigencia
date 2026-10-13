import { descargarA } from "./motor.js";

export const URL_VERSION = "https://vigencia.askleia.co/version.json";

// Compara versiones tipo "3.1.0": -1 si a < b, 0 si iguales, 1 si a > b.
export function compararVersiones(a, b) {
  const partes = (v) => String(v || "").trim().replace(/^[vV]/, "").split(".").map((x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  });
  const pa = partes(a);
  const pb = partes(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// El instalador que le sirve a este computador, según lo publicado.
export function archivoParaPlataforma(info, platform = process.platform) {
  const archivos = info?.archivos || {};
  if (platform === "win32") return archivos.win32 || null;
  if (platform === "darwin") return archivos.darwin || null;
  if (platform === "linux") return archivos.linux || null;
  return null;
}

// Pregunta al CDN qué versión es la última. Nunca tumba la app: sin red o
// sin respuesta, devuelve disponible nulo y la ventana sigue normal.
export async function consultarVersion(actual, opciones = {}) {
  const url = opciones.url || URL_VERSION;
  const fetchImpl = opciones.fetchImpl || globalThis.fetch;
  const limpia = String(actual || "").trim().replace(/^[vV]/, "");
  let respuesta = null;
  try {
    respuesta = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch {
    return { actual: limpia, disponible: null, novedad: false };
  }
  if (!respuesta?.ok) return { actual: limpia, disponible: null, novedad: false };
  let info = null;
  try {
    info = await respuesta.json();
  } catch {
    return { actual: limpia, disponible: null, novedad: false };
  }
  const disponible = typeof info?.version === "string" ? info.version.trim().replace(/^[vV]/, "") : "";
  if (!disponible) return { actual: limpia, disponible: null, novedad: false };
  const novedad = compararVersiones(limpia, disponible) < 0;
  return {
    actual: limpia,
    disponible,
    novedad,
    archivo: novedad ? archivoParaPlataforma(info, opciones.platform) : null,
    notas: typeof info?.notas === "string" ? info.notas : "",
  };
}

export function urlDescarga(archivo, base = "https://vigencia.askleia.co") {
  if (!archivo) return null;
  return `${String(base).replace(/\/+$/, "")}/${archivo}`;
}

// Baja el instalador a la carpeta temporal, con progreso para la ventana.
export async function descargarActualizacion(archivo, destino, onProgreso, fetchImpl = globalThis.fetch) {
  const url = urlDescarga(archivo);
  if (!url) throw new Error("No hay instalador para este computador.");
  await descargarA(url, destino, onProgreso, fetchImpl);
  return destino;
}
