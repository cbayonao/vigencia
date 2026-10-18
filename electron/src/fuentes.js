// Fuentes de la biblioteca que vienen de un archivo. Todo archivo pasa por
// el conversor (convertirConCache: caché por hash, utilityProcess, OCR) y
// la fuente queda ligada a él con pieza.archivo_id. Así Documentos usa los
// trozos con página del archivo y no un texto troceado otra vez.
import fs from "node:fs";
import path from "node:path";
import { esConvertible, extensionDe, textoLegible } from "../compartido/convertir.js";
import { claseDeNombre } from "../compartido/documentos.js";
import { guardarPieza, leerPieza, MAX_FUENTE } from "./biblioteca.js";
import { leerArchivo, leerMarkdown } from "./conversiones.js";
import { Aviso, run, uno } from "./db.js";

export const MAX_BYTES_ARCHIVO = 300 * 1024 * 1024;

// Texto que se guarda en pieza.texto: legible y dentro del tope. Los
// trozos del archivo conservan todo, con página.
export function textoDeArchivo(db, datosDir, archivoId) {
  const { markdown } = leerMarkdown(db, datosDir, Number(archivoId) || 0);
  return textoLegible(markdown).slice(0, MAX_FUENTE);
}

function nombreSinExtension(nombre) {
  return String(nombre || "Fuente").replace(/\.[^.]+$/, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Fuente";
}

// Crea (o devuelve, si ya existe) la fuente ligada a un archivo convertido.
export function piezaDeArchivo(db, datosDir, archivoId, { nombre = "", clase = "" } = {}) {
  const archivo = leerArchivo(db, Number(archivoId) || 0);
  if (!archivo) throw new Aviso("Ese archivo ya no está.");
  if (archivo.estado !== "listo") throw new Aviso("Ese archivo todavía no está convertido.");
  const previa = uno(db, "SELECT id FROM pieza WHERE archivo_id = ? ORDER BY id LIMIT 1", [archivo.id]);
  if (previa) return { pieza: leerPieza(db, previa.id), repetida: true };
  const texto = textoDeArchivo(db, datosDir, archivo.id);
  if (!texto) throw new Aviso("Ese archivo quedó sin texto. Si es escaneado, instale el OCR y reconviértalo.");
  const rotulo = nombreSinExtension(nombre || archivo.nombre);
  const pieza = guardarPieza(db, {
    nombre: rotulo,
    clase: clase || (archivo.origen === "jurisprudencia" ? "jurisprudencia" : claseDeNombre(rotulo)),
    etiquetas: [],
    texto,
    origen: archivo.nombre.slice(0, 200),
    archivoId: archivo.id,
  });
  return { pieza, repetida: false };
}

// ¿El texto que el usuario va a guardar es el mismo que salió del archivo?
// Si lo editó, la fuente no se liga: sus trozos ya no coincidirían.
export function mismoTextoQueArchivo(db, datosDir, archivoId, texto) {
  try {
    const esperado = textoDeArchivo(db, datosDir, archivoId).replace(/\r\n/g, "\n").trim();
    return esperado === String(texto || "").replace(/\r\n/g, "\n").trim();
  } catch {
    return false;
  }
}

// Revisa una ruta antes de leerla: tipo convertible y tamaño.
export function revisarRuta(ruta) {
  const nombre = path.basename(String(ruta || ""));
  if (!nombre) return "No llegó la ruta del archivo.";
  if (!esConvertible(nombre)) return `Ese tipo de archivo (.${extensionDe(nombre) || "sin extensión"}) todavía no se puede leer.`;
  let st;
  try {
    st = fs.statSync(ruta);
  } catch {
    return "No encuentro ese archivo.";
  }
  if (!st.isFile()) return "Eso no es un archivo.";
  if (st.size > MAX_BYTES_ARCHIVO) return "El archivo pesa más de 300 MB.";
  return "";
}

// Importa archivos a la biblioteca por el conversor. `convertirDatos` es
// el de registrarConvertir (o uno de prueba). Devuelve las fuentes creadas
// y los errores por archivo, sin cortar la tanda.
export async function importarABiblioteca({ db, datosDir, rutas, convertirDatos, mensajeHumano = (e) => e?.message || String(e) }) {
  const fuentes = [];
  const errores = [];
  for (const ruta of (Array.isArray(rutas) ? rutas : []).map(String).slice(0, 50)) {
    const archivo = path.basename(ruta);
    const problema = revisarRuta(ruta);
    if (problema) {
      errores.push({ archivo, error: problema });
      continue;
    }
    try {
      const r = await convertirDatos({ datos: fs.readFileSync(ruta), nombre: archivo, meta: { herramienta: "biblioteca" } });
      if (r.error || !r.archivo) {
        errores.push({ archivo, error: r.error || "No pude convertirlo." });
        continue;
      }
      const { pieza, repetida } = piezaDeArchivo(db, datosDir, r.archivo.id);
      fuentes.push({ id: pieza.id, nombre: pieza.nombre, archivoId: r.archivo.id, repetida, aviso: r.archivo.aviso || "" });
    } catch (error) {
      errores.push({ archivo, error: mensajeHumano(error) });
    }
  }
  return { fuentes, errores };
}

export function piezaDelArchivo(db, archivoId) {
  const fila = uno(db, "SELECT id FROM pieza WHERE archivo_id = ? ORDER BY id LIMIT 1", [Number(archivoId) || 0]);
  return fila ? leerPieza(db, fila.id) : null;
}

// Liga una fuente ya guardada a su archivo (importar con revisión previa).
export function ligarArchivo(db, piezaId, archivoId) {
  run(db, "UPDATE pieza SET archivo_id = ? WHERE id = ?", [Number(archivoId) || null, Number(piezaId) || 0]);
  return leerPieza(db, piezaId);
}
