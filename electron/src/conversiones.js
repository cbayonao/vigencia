// Caché de conversiones a Markdown y archivos de cada proyecto. El .md
// vive en disco (conversiones/ab/<sha256>/documento.md) junto a una copia
// del original y un meta.json; en la base solo van metadatos y trozos.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ahora } from "../compartido/logica.js";
import {
  VERSION_CONVERSOR, encabezadoYaml, estimarTokensMd, extensionDe, quitarEncabezado, trocearMarkdown,
} from "../compartido/convertir.js";
import { Aviso, filas, run, transaccion, uno } from "./db.js";

export function sha256(datos) {
  return crypto.createHash("sha256").update(datos).digest("hex");
}

export function carpetaConversiones(datosDir) {
  return path.join(datosDir, "conversiones");
}

export function carpetaDe(datosDir, hash) {
  return path.join(carpetaConversiones(datosDir), hash.slice(0, 2), hash);
}

function archivoDe(fila) {
  if (!fila) return null;
  let meta = {};
  try {
    meta = JSON.parse(fila.meta || "{}");
  } catch {
    meta = {};
  }
  return { ...fila, meta };
}

export function leerArchivo(db, id) {
  return archivoDe(uno(db, "SELECT * FROM archivo WHERE id = ?", [id]));
}

export function archivoPorHash(db, hash) {
  return archivoDe(uno(db, "SELECT * FROM archivo WHERE sha256 = ?", [hash]));
}

export function listarArchivos(db, { origen = "" } = {}) {
  const sql = origen ? "SELECT * FROM archivo WHERE origen = ? ORDER BY actualizado_en DESC" : "SELECT * FROM archivo ORDER BY actualizado_en DESC";
  return filas(db, sql, origen ? [origen] : []).map(archivoDe);
}

// ¿Ya está convertido con esta versión del conversor? Mismo hash, mismo
// resultado: no se convierte dos veces.
export function enCache(db, datosDir, hash, { forzarOcr = false } = {}) {
  const fila = archivoPorHash(db, hash);
  if (!fila || fila.estado !== "listo" || forzarOcr) return null;
  if (fila.version_conversor !== VERSION_CONVERSOR) return null;
  if (!fila.ruta_md || !fs.existsSync(path.join(datosDir, fila.ruta_md))) return null;
  return fila;
}

// Registra el archivo antes de convertir (estado convirtiendo) y guarda
// la copia del original.
export function prepararArchivo(db, datosDir, { datos, nombre, origen = "usuario", meta = {} }) {
  const hash = sha256(datos);
  const ext = extensionDe(nombre) || "bin";
  const dir = carpetaDe(datosDir, hash);
  fs.mkdirSync(dir, { recursive: true });
  const original = path.join(dir, `original.${ext}`);
  if (!fs.existsSync(original)) fs.writeFileSync(original, datos);
  const marca = ahora();
  const previo = archivoPorHash(db, hash);
  if (previo) {
    const metaNueva = { ...previo.meta, ...meta };
    run(db, "UPDATE archivo SET nombre = ?, estado = 'convirtiendo', error = '', meta = ?, actualizado_en = ? WHERE id = ?", [
      previo.nombre || nombre, JSON.stringify(metaNueva), marca, previo.id,
    ]);
    return { ...leerArchivo(db, previo.id), original };
  }
  const r = run(db, `INSERT INTO archivo (sha256, nombre, extension, bytes, estado, origen, meta, version_conversor, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, 'convirtiendo', ?, ?, ?, ?, ?)`, [hash, nombre, ext, datos.length, origen, JSON.stringify(meta), VERSION_CONVERSOR, marca, marca]);
  return { ...leerArchivo(db, Number(r.lastInsertRowid)), original };
}

export function indexarTrozos(db, archivoId, markdown) {
  const trozos = trocearMarkdown(markdown);
  transaccion(db, () => {
    run(db, "DELETE FROM trozo WHERE archivo_id = ?", [archivoId]);
    const ins = db.prepare("INSERT INTO trozo (archivo_id, orden, pagina, titulo, texto, tokens_aprox) VALUES (?, ?, ?, ?, ?, ?)");
    for (const t of trozos) ins.run(archivoId, t.orden, t.pagina, t.titulo, t.texto, estimarTokensMd(t.texto));
  });
  return trozos.length;
}

export function guardarResultado(db, datosDir, archivoId, resultado, { encabezado = {} } = {}) {
  const fila = leerArchivo(db, archivoId);
  if (!fila) throw new Aviso("Ese archivo ya no está.");
  const dir = carpetaDe(datosDir, fila.sha256);
  fs.mkdirSync(dir, { recursive: true });
  const md = `${encabezadoYaml(encabezado)}${String(resultado.markdown || "").trim()}\n`;
  fs.writeFileSync(path.join(dir, "documento.md"), md);
  const rutaMd = path.relative(datosDir, path.join(dir, "documento.md"));
  const meta = {
    ...fila.meta,
    motor: resultado.motor,
    version_conversor: VERSION_CONVERSOR,
    paginas: resultado.paginas || 0,
    paginas_ocr: resultado.paginasOcr || 0,
    duracion_ms: resultado.duracionMs || 0,
    convertido_en: ahora(),
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ nombre: fila.nombre, sha256: fila.sha256, ...meta }, null, 2));
  run(db, `UPDATE archivo SET ruta_md = ?, estado = 'listo', motor = ?, version_conversor = ?, paginas = ?, paginas_ocr = ?,
    caracteres = ?, tokens_aprox = ?, calidad = ?, error = '', aviso = ?, meta = ?, actualizado_en = ? WHERE id = ?`, [
    rutaMd, resultado.motor || "", VERSION_CONVERSOR, resultado.paginas || 0, resultado.paginasOcr || 0,
    md.length, estimarTokensMd(md), Number(resultado.calidad || 0), resultado.aviso || "", JSON.stringify(meta), ahora(), archivoId,
  ]);
  indexarTrozos(db, archivoId, md);
  return leerArchivo(db, archivoId);
}

export function marcarError(db, archivoId, mensaje, estado = "error") {
  run(db, "UPDATE archivo SET estado = ?, error = ?, actualizado_en = ? WHERE id = ?", [estado, String(mensaje || "").slice(0, 500), ahora(), archivoId]);
  return leerArchivo(db, archivoId);
}

export function leerMarkdown(db, datosDir, id) {
  const fila = leerArchivo(db, id);
  if (!fila?.ruta_md) throw new Aviso("Ese archivo todavía no tiene Markdown.");
  const ruta = path.join(datosDir, fila.ruta_md);
  if (!fs.existsSync(ruta)) throw new Aviso("El Markdown de ese archivo ya no está en la carpeta de datos. Conviértalo otra vez.");
  return { archivo: fila, markdown: fs.readFileSync(ruta, "utf8"), original: rutaOriginal(datosDir, fila) };
}

export function rutaOriginal(datosDir, fila) {
  const ruta = path.join(carpetaDe(datosDir, fila.sha256), `original.${fila.extension}`);
  return fs.existsSync(ruta) ? ruta : "";
}

// Guardar una edición crea una revisión nueva (documento-2.md, ...); la
// conversión original no se pisa.
export function guardarEdicion(db, datosDir, id, markdown) {
  const fila = leerArchivo(db, id);
  if (!fila) throw new Aviso("Ese archivo ya no está.");
  const texto = String(markdown || "").trim();
  if (!texto) throw new Aviso("El Markdown está vacío.");
  const dir = carpetaDe(datosDir, fila.sha256);
  let n = 2;
  while (fs.existsSync(path.join(dir, `documento-${n}.md`))) n++;
  const ruta = path.join(dir, `documento-${n}.md`);
  fs.writeFileSync(ruta, `${texto}\n`);
  run(db, "UPDATE archivo SET ruta_md = ?, caracteres = ?, tokens_aprox = ?, actualizado_en = ? WHERE id = ?", [
    path.relative(datosDir, ruta), texto.length, estimarTokensMd(texto), ahora(), id,
  ]);
  indexarTrozos(db, id, texto);
  return { archivo: leerArchivo(db, id), revision: n };
}

// Limpiar caché: borra .md, copias y trozos de los archivos que ningún
// proyecto ni pieza usa. Los que están en uso se conservan.
export function limpiarCache(db, datosDir) {
  const libres = filas(db, `SELECT * FROM archivo a WHERE NOT EXISTS (SELECT 1 FROM doc_archivo d WHERE d.archivo_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM pieza p WHERE p.archivo_id = a.id)`);
  for (const f of libres) {
    fs.rmSync(carpetaDe(datosDir, f.sha256), { recursive: true, force: true });
    run(db, "DELETE FROM archivo WHERE id = ?", [f.id]);
  }
  return { borrados: libres.length };
}

// ---------- Archivos del proyecto ----------

export function archivosDelProyecto(db, proyectoId) {
  return filas(db, `SELECT a.*, d.incluido, d.agregado_en FROM doc_archivo d JOIN archivo a ON a.id = d.archivo_id
    WHERE d.proyecto_id = ? ORDER BY d.agregado_en, a.id`, [proyectoId]).map(archivoDe);
}

export function agregarAProyecto(db, proyectoId, archivoId) {
  if (!uno(db, "SELECT id FROM doc_proyecto WHERE id = ?", [proyectoId])) throw new Aviso("Ese proyecto ya no está.");
  if (!leerArchivo(db, archivoId)) throw new Aviso("Ese archivo ya no está.");
  run(db, "INSERT OR IGNORE INTO doc_archivo (proyecto_id, archivo_id, incluido, agregado_en) VALUES (?, ?, 1, ?)", [proyectoId, archivoId, ahora()]);
  return archivosDelProyecto(db, proyectoId);
}

export function quitarDeProyecto(db, proyectoId, archivoId) {
  run(db, "DELETE FROM doc_archivo WHERE proyecto_id = ? AND archivo_id = ?", [proyectoId, archivoId]);
  return archivosDelProyecto(db, proyectoId);
}

export function incluirEnContexto(db, proyectoId, archivoId, incluido) {
  run(db, "UPDATE doc_archivo SET incluido = ? WHERE proyecto_id = ? AND archivo_id = ?", [incluido ? 1 : 0, proyectoId, archivoId]);
  return archivosDelProyecto(db, proyectoId);
}

export function trozosDeArchivos(db, ids) {
  const lista = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!lista.length) return [];
  return filas(db, `SELECT t.id, t.archivo_id, t.orden, t.pagina, t.titulo, t.texto, a.nombre FROM trozo t JOIN archivo a ON a.id = t.archivo_id
    WHERE t.archivo_id IN (${lista.map(() => "?").join(",")}) ORDER BY t.archivo_id, t.orden`, lista);
}

// Prefiltro con FTS5 cuando hay muchos trozos: solo los que comparten
// alguna palabra pasan al BM25. Sin FTS5 o sin palabras, todos.
export function candidatosFts(db, ids, palabras, limite = 400) {
  const lista = [...new Set((ids || []).map(Number).filter(Boolean))];
  const terminos = [...new Set((palabras || []).filter((p) => /^[\p{L}\p{N}]{3,}$/u.test(p)))].slice(0, 30);
  if (!lista.length || !terminos.length) return null;
  try {
    const consulta = terminos.map((t) => `"${t}"`).join(" OR ");
    return filas(db, `SELECT t.id, t.archivo_id, t.orden, t.pagina, t.titulo, t.texto, a.nombre FROM trozo_fts f
      JOIN trozo t ON t.id = f.rowid JOIN archivo a ON a.id = t.archivo_id
      WHERE trozo_fts MATCH ? AND t.archivo_id IN (${lista.map(() => "?").join(",")}) ORDER BY bm25(trozo_fts) LIMIT ?`, [consulta, ...lista, limite]);
  } catch {
    return null;
  }
}

// ---------- AGENTS.md del proyecto ----------

export const PLANTILLA_AGENTS = `# Instrucciones del proyecto

## Partes
- Quién representa:
- Contra quién:

## Hechos clave
-

## Pretensiones
-

## Estilo
- Lenguaje claro y respetuoso.

## Lo que no se debe decir
-
`;

export function rutaAgentes(datosDir, proyectoId) {
  return path.join(datosDir, "proyectos", String(Number(proyectoId)), "AGENTS.md");
}

export function leerAgentes(datosDir, proyectoId) {
  const ruta = rutaAgentes(datosDir, proyectoId);
  return fs.existsSync(ruta) ? fs.readFileSync(ruta, "utf8") : "";
}

export function guardarAgentes(datosDir, proyectoId, texto) {
  const ruta = rutaAgentes(datosDir, proyectoId);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const limpio = String(texto || "").replace(/\r\n/g, "\n");
  fs.writeFileSync(`${ruta}.tmp`, limpio);
  fs.renameSync(`${ruta}.tmp`, ruta);
  return limpio;
}

// Texto que entra al contexto: sin el encabezado YAML y sin líneas de
// plantilla vacías.
export function agentesParaContexto(texto) {
  return quitarEncabezado(texto)
    .split("\n")
    .filter((l) => !/^\s*-\s*$/.test(l) && !/^\s*-\s*[^:]+:\s*$/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
