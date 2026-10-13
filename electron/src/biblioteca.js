import { ahora, texto } from "../compartido/logica.js";
import { Aviso, filas, run, uno } from "./db.js";

export const TIPOS_PIEZA = [
  { id: "plantilla", nombre: "Plantilla" },
  { id: "ejemplo", nombre: "Ejemplo" },
  { id: "norma", nombre: "Norma" },
  { id: "estilo", nombre: "Estilo" },
];

const MAX_TEXTO = 20000;
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
    creado_en: fila.creado_en,
    actualizado_en: fila.actualizado_en,
  };
}

function leer(db, id) {
  return piezaDe(uno(db, `
    SELECT id, nombre, tipo, texto, activa, creado_en, actualizado_en
    FROM pieza WHERE id = ?
  `, [id]));
}

export function listarPiezas(db) {
  return filas(db, `
    SELECT id, nombre, tipo, texto, activa, creado_en, actualizado_en
    FROM pieza
    ORDER BY nombre COLLATE NOCASE, id
  `).map((fila) => piezaDe(fila));
}

export function guardarPieza(db, dato = {}) {
  const nombre = texto(dato.nombre);
  const tipo = TIPOS.has(dato.tipo) ? dato.tipo : "";
  const cuerpo = String(dato.texto ?? "").replace(/\r\n/g, "\n").trim();
  if (!nombre) throw new Aviso("Escriba el nombre de la pieza.");
  if (nombre.length > 120) throw new Aviso("El nombre es demasiado largo.");
  if (!tipo) throw new Aviso("Elija si es plantilla, ejemplo, norma o estilo.");
  if (!cuerpo) throw new Aviso("Escriba el texto de la pieza.");
  if (cuerpo.length > MAX_TEXTO) {
    throw new Aviso("Esa pieza es demasiado larga. Recórtela a 20000 caracteres.");
  }
  const marca = ahora();
  const id = Number(dato.id) || 0;
  if (id) {
    const previa = uno(db, "SELECT id FROM pieza WHERE id = ?", [id]);
    if (!previa) throw new Aviso("Esa pieza ya no está.");
    run(db, `
      UPDATE pieza
      SET nombre = ?, tipo = ?, texto = ?, actualizado_en = ?
      WHERE id = ?
    `, [nombre, tipo, cuerpo, marca, id]);
    return leer(db, id);
  }
  const info = run(db, `
    INSERT INTO pieza (nombre, tipo, texto, activa, creado_en, actualizado_en)
    VALUES (?, ?, ?, 1, ?, ?)
  `, [nombre, tipo, cuerpo, marca, marca]);
  return leer(db, Number(info.lastInsertRowid));
}

export function activarPieza(db, id, activa) {
  const clave = Number(id) || 0;
  const previa = uno(db, "SELECT id FROM pieza WHERE id = ?", [clave]);
  if (!previa) throw new Aviso("Esa pieza ya no está.");
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
