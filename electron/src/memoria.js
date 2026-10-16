// Memoria del documento y edición por bloques (migración 16). La memoria
// es de este computador: se arma sin modelos y entra al encargo de
// cualquier modelo que se elija después.
import crypto from "node:crypto";
import { ahora } from "../compartido/logica.js";
import { actualizarMemoria, aplicarBloque, diffPalabras, memoriaVacia, sincronizarBloques } from "../compartido/memoria.js";
import { armarEncargoPasaje, marcarCitasDocumento } from "../compartido/documentos.js";
import { Aviso, filas, run, transaccion, uno } from "./db.js";

export function leerMemoria(db, proyectoId) {
  const f = uno(db, "SELECT datos FROM doc_memoria WHERE proyecto_id = ?", [proyectoId]);
  try {
    return { ...memoriaVacia(), ...JSON.parse(f?.datos || "{}") };
  } catch {
    return memoriaVacia();
  }
}

export function guardarMemoria(db, proyectoId, memoria) {
  run(db, `INSERT INTO doc_memoria (proyecto_id, datos, actualizado_en) VALUES (?, ?, ?)
    ON CONFLICT(proyecto_id) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en`, [proyectoId, JSON.stringify(memoria), ahora()]);
  return memoria;
}

export function anotarVuelta(db, proyectoId, datos) {
  return guardarMemoria(db, proyectoId, actualizarMemoria(leerMemoria(db, proyectoId), datos));
}

export function bloquesDelProyecto(db, proyectoId) {
  return filas(db, "SELECT * FROM doc_bloque WHERE proyecto_id = ? ORDER BY orden", [proyectoId]);
}

// Tras cada versión nueva: los párrafos conservan su id si no cambiaron.
export function sincronizar(db, proyectoId, version) {
  if (!version?.cuerpo) return [];
  const previos = bloquesDelProyecto(db, proyectoId);
  const nuevos = sincronizarBloques(previos, version.cuerpo, () => `b${crypto.randomBytes(5).toString("hex")}`);
  transaccion(db, () => {
    run(db, "DELETE FROM doc_bloque WHERE proyecto_id = ?", [proyectoId]);
    const ins = db.prepare("INSERT INTO doc_bloque (id, proyecto_id, orden, seccion, texto, version_id, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const b of nuevos) ins.run(b.id, proyectoId, b.orden, b.seccion || "", b.texto, version.id || null, ahora());
  });
  return nuevos;
}

function ubicar(cuerpo, bloque, todos) {
  const lista = sincronizarBloques(todos, cuerpo, () => "nuevo");
  return lista.find((b) => b.id === bloque.id) || null;
}

export function prepararCambioBloque({ db, proyectoId, bloqueId, pedido, tipo, perfil, cuerpo, fragmentos = [], origen = "local", memoriaTexto = "" }) {
  const todos = bloquesDelProyecto(db, proyectoId);
  const bloque = todos.find((b) => b.id === bloqueId);
  if (!bloque) throw new Aviso("Ese párrafo ya no está en el documento. Vuelva a elegirlo.");
  const encargo = [
    armarEncargoPasaje({ tipo, perfil, documento: cuerpo, pasaje: bloque.texto, pedido, fragmentos, origen }),
    memoriaTexto ? `\nMemoria del documento (respétala):\n${memoriaTexto}` : "",
    "\nDevuelve solo el párrafo nuevo que reemplaza al pasaje. No reescribas el resto del documento.",
  ].join("");
  return { bloque, encargo, hash: crypto.createHash("sha256").update(encargo).digest("hex") };
}

export function guardarPropuesta(db, { proyectoId, bloque, despues, pedido, modelo, origen, fuentesTexto = "" }) {
  const marcado = marcarCitasDocumento([{ titulo: "x", parrafos: [String(despues || "").trim()] }], fuentesTexto)[0].parrafos[0];
  const r = run(db, `INSERT INTO doc_bloque_cambio (proyecto_id, bloque_id, antes, despues, pedido, modelo, origen, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [proyectoId, bloque.id, bloque.texto, marcado, String(pedido || "").slice(0, 500), modelo || "", origen || "local", ahora()]);
  return leerCambio(db, Number(r.lastInsertRowid));
}

export function leerCambio(db, id) {
  const c = uno(db, "SELECT * FROM doc_bloque_cambio WHERE id = ?", [id]);
  return c ? { ...c, diff: diffPalabras(c.antes, c.despues) } : null;
}

export function historialBloque(db, bloqueId) {
  return filas(db, "SELECT * FROM doc_bloque_cambio WHERE bloque_id = ? ORDER BY id DESC", [bloqueId]);
}

// Aceptar aplica solo ese párrafo y deja una versión nueva; rechazar no
// toca el documento. Ambos quedan en la memoria y en el historial.
export function resolverCambio(db, { id, aceptar, guardarVersion, ultimaVersion }) {
  const c = leerCambio(db, id);
  if (!c) throw new Aviso("Ese cambio ya no está.");
  if (c.estado !== "propuesto") throw new Aviso("Ese cambio ya se resolvió.");
  if (!aceptar) {
    run(db, "UPDATE doc_bloque_cambio SET estado = 'rechazado', resuelto_en = ? WHERE id = ?", [ahora(), id]);
    anotarVuelta(db, c.proyecto_id, { decision: `Rechazado: ${c.pedido} (se conservó el texto anterior)` });
    return { cambio: leerCambio(db, id) };
  }
  const actual = ultimaVersion(db, c.proyecto_id);
  const todos = bloquesDelProyecto(db, c.proyecto_id);
  const bloque = ubicar(actual?.cuerpo || "", { id: c.bloque_id }, todos);
  if (!bloque || bloque.texto !== c.antes) throw new Aviso("El párrafo cambió desde la propuesta. Pida el cambio otra vez.");
  const nuevo = aplicarBloque(actual.cuerpo, bloque, c.despues);
  if (!nuevo) throw new Aviso("No pude aplicar el cambio.");
  const v = guardarVersion(db, c.proyecto_id, { cuerpo: nuevo, modelo: c.modelo, origen: c.origen, nota: `Párrafo: ${c.pedido}`.slice(0, 120) });
  run(db, "UPDATE doc_bloque_cambio SET estado = 'aceptado', resuelto_en = ?, version_id = ? WHERE id = ?", [ahora(), v.id, id]);
  // El bloque conserva su id con el texto nuevo.
  run(db, "UPDATE doc_bloque SET texto = ?, version_id = ?, actualizado_en = ? WHERE id = ?", [c.despues, v.id, ahora(), c.bloque_id]);
  sincronizar(db, c.proyecto_id, { ...v, cuerpo: nuevo });
  anotarVuelta(db, c.proyecto_id, { cuerpo: nuevo, decision: `Aceptado en ${bloque.seccion || "el documento"}: ${c.pedido}` });
  return { cambio: leerCambio(db, id), version: v };
}
