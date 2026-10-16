import { ahora, texto } from "../compartido/logica.js";
import { Aviso, filas, run, uno } from "./db.js";
import { CLASES_FUENTE, claseDePieza, leerEtiquetas, tipoDeClase } from "../compartido/documentos.js";

export const TIPOS_PIEZA = [
  { id: "plantilla", nombre: "Plantilla" },
  { id: "ejemplo", nombre: "Ejemplo" },
  { id: "norma", nombre: "Norma" },
  { id: "estilo", nombre: "Estilo" },
];

const MAX_TEXTO = 20000;
// Las fuentes de Documentos pueden ser leyes enteras: se recuperan por
// fragmentos, así que admiten más texto. Al escrito solo entra una pieza
// de hasta MAX_TEXTO.
const MAX_FUENTE = 600000;
const TIPOS = new Set(TIPOS_PIEZA.map((tipo) => tipo.id));

function piezaDe(fila) {
  if (!fila) return null;
  const tipo = TIPOS_PIEZA.find((item) => item.id === fila.tipo);
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    tipo: fila.tipo,
    tipoNombre: tipo?.nombre || fila.tipo,
    texto: fila.texto,
    activa: Boolean(fila.activa),
    clase: claseDePieza(fila),
    etiquetas: leerEtiquetas(fila.etiquetas),
    origen: fila.origen || "",
    largo: String(fila.texto || "").length,
    creado_en: fila.creado_en,
    actualizado_en: fila.actualizado_en,
  };
}

function leer(db, id) {
  return piezaDe(uno(db, `
    SELECT id, nombre, tipo, texto, activa, clase, etiquetas, origen, creado_en, actualizado_en
    FROM pieza WHERE id = ?
  `, [id]));
}

export function listarPiezas(db) {
  return filas(db, `
    SELECT id, nombre, tipo, texto, activa, clase, etiquetas, origen, creado_en, actualizado_en
    FROM pieza
    ORDER BY nombre COLLATE NOCASE, id
  `).map((fila) => piezaDe(fila));
}

export function guardarPieza(db, dato = {}) {
  const nombre = texto(dato.nombre);
  const clase = CLASES_FUENTE.some((item) => item.id === dato.clase) ? dato.clase : "";
  const tipo = TIPOS.has(dato.tipo) ? dato.tipo : tipoDeClase(clase);
  const etiquetas = leerEtiquetas(dato.etiquetas).join(", ");
  const origen = String(dato.origen || "").trim().slice(0, 200);
  const cuerpo = String(dato.texto ?? "").replace(/\r\n/g, "\n").trim();
  if (!nombre) throw new Aviso("Escriba el nombre de la pieza.");
  if (nombre.length > 120) throw new Aviso("El nombre es demasiado largo.");
  if (!tipo) throw new Aviso("Elija si es plantilla, ejemplo, norma o estilo.");
  if (!cuerpo) throw new Aviso("Escriba el texto de la pieza.");
  if (!clase && cuerpo.length > MAX_TEXTO) {
    throw new Aviso("Esa pieza es demasiado larga. Recórtela a 20000 caracteres.");
  }
  if (cuerpo.length > MAX_FUENTE) {
    throw new Aviso("Esa fuente es demasiado larga. Recórtela a 600000 caracteres.");
  }
  const claseFinal = clase || claseDePieza({ tipo });
  const marca = ahora();
  const id = Number(dato.id) || 0;
  if (id) {
    const previa = uno(db, "SELECT id FROM pieza WHERE id = ?", [id]);
    if (!previa) throw new Aviso("Esa pieza ya no está.");
    run(db, `
      UPDATE pieza
      SET nombre = ?, tipo = ?, texto = ?, clase = ?, etiquetas = COALESCE(?, etiquetas), origen = COALESCE(?, origen), actualizado_en = ?
      WHERE id = ?
    `, [nombre, tipo, cuerpo, claseFinal, dato.etiquetas == null ? null : etiquetas, dato.origen == null ? null : origen, marca, id]);
    if (cuerpo.length > MAX_TEXTO) run(db, "UPDATE pieza SET activa = 0 WHERE id = ?", [id]);
    return leer(db, id);
  }
  const info = run(db, `
    INSERT INTO pieza (nombre, tipo, texto, activa, clase, etiquetas, origen, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [nombre, tipo, cuerpo, clase || cuerpo.length > MAX_TEXTO ? 0 : 1, claseFinal, etiquetas, origen, marca, marca]);
  return leer(db, Number(info.lastInsertRowid));
}

export function activarPieza(db, id, activa) {
  const clave = Number(id) || 0;
  const previa = uno(db, "SELECT id, length(texto) AS largo FROM pieza WHERE id = ?", [clave]);
  if (!previa) throw new Aviso("Esa pieza ya no está.");
  if (activa && Number(previa.largo) > MAX_TEXTO) {
    throw new Aviso("Esa fuente es larga para el escrito. Úsela desde Documentos, que toma solo los fragmentos que sirven.");
  }
  run(db, "UPDATE pieza SET activa = ?, actualizado_en = ? WHERE id = ?", [
    activa ? 1 : 0,
    ahora(),
    clave,
  ]);
  return leer(db, clave);
}

export function borrarPieza(db, id) {
  const clave = Number(id) || 0;
  const previa = uno(db, "SELECT id FROM pieza WHERE id = ?", [clave]);
  if (!previa) throw new Aviso("Esa pieza ya no está.");
  run(db, "DELETE FROM pieza WHERE id = ?", [clave]);
}

// Biblioteca de Documentos: la misma tabla pieza, filtrada por clase,
// etiqueta y texto. Sin el texto completo para que la lista sea liviana.
export function buscarFuentes(db, { texto: consulta = "", clase = "", etiqueta = "" } = {}) {
  const palabras = String(consulta || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\s+/).filter(Boolean);
  const marca = String(etiqueta || "").trim().toLowerCase();
  return listarPiezas(db).filter((pieza) => {
    if (clase && pieza.clase !== clase) return false;
    if (marca && !pieza.etiquetas.includes(marca)) return false;
    if (!palabras.length) return true;
    const heno = `${pieza.nombre} ${pieza.etiquetas.join(" ")} ${pieza.texto}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return palabras.every((p) => heno.includes(p));
  }).map(({ texto: cuerpo, ...resto }) => ({ ...resto, muestra: cuerpo.slice(0, 220) }));
}

export function etiquetasUsadas(db) {
  const todas = new Set();
  for (const pieza of listarPiezas(db)) for (const e of pieza.etiquetas) todas.add(e);
  return [...todas].sort();
}

export function leerPieza(db, id) {
  return leer(db, Number(id) || 0);
}
