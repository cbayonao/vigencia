// Documentos: proyectos de redacción por conversación. Todo vive en la base
// local (migración 11). El texto solo sale si el perfil o el proyecto usan
// un modelo de nube con la clave del usuario.
import { ahora, texto } from "../compartido/logica.js";
import { fichaDeDetalle } from "../compartido/redactor.js";
import {
  TIPOS_DOCUMENTO, armarEncargoDocumento, armarEncargoPasaje, contarAvisos, escritoDeTexto,
  fragmentosRelevantes, fuentesDeCitas, interpretarRespuesta, marcarCitasDocumento,
  nombreTipo, plantillaBasica, presupuestoDe, reemplazarPasaje, textoDeEscrito,
} from "../compartido/documentos.js";
import { Aviso, detalleProceso, filas, guardarUso, run, transaccion, uno } from "./db.js";
import { listarPiezas } from "./biblioteca.js";
import { contextoExpediente, modeloParaDocumento, textoParaDocumento } from "./ia.js";
import { fechaInforme } from "./informe.js";

const TIPOS = new Set(TIPOS_DOCUMENTO.map((t) => t.id));

function lista(valor) {
  try {
    const dato = JSON.parse(String(valor || "[]"));
    return Array.isArray(dato) ? dato : [];
  } catch {
    return [];
  }
}

function enteros(valor) {
  return [...new Set((Array.isArray(valor) ? valor : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

// ---------- Perfiles ----------

function perfilDe(fila) {
  if (!fila) return null;
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    instrucciones: fila.instrucciones,
    estilo: fila.estilo,
    modelo: fila.modelo,
    tipos: lista(fila.tipos).filter((t) => TIPOS.has(t)),
    fuentes: enteros(lista(fila.fuentes)),
  };
}

export function listarPerfiles(db) {
  return filas(db, "SELECT * FROM doc_perfil ORDER BY nombre COLLATE NOCASE, id").map(perfilDe);
}

export function leerPerfil(db, id) {
  return perfilDe(uno(db, "SELECT * FROM doc_perfil WHERE id = ?", [Number(id) || 0]));
}

export function guardarPerfil(db, dato = {}) {
  const nombre = texto(dato.nombre);
  if (!nombre) throw new Aviso("Escriba el nombre del perfil.");
  if (nombre.length > 80) throw new Aviso("El nombre del perfil es demasiado largo.");
  const instrucciones = String(dato.instrucciones || "").trim().slice(0, 4000);
  const estilo = String(dato.estilo || "").trim().slice(0, 2000);
  const modelo = String(dato.modelo || "").trim().slice(0, 200);
  const tipos = JSON.stringify((Array.isArray(dato.tipos) ? dato.tipos : []).filter((t) => TIPOS.has(t)));
  const fuentes = JSON.stringify(enteros(dato.fuentes));
  const marca = ahora();
  const id = Number(dato.id) || 0;
  if (id) {
    if (!leerPerfil(db, id)) throw new Aviso("Ese perfil ya no está.");
    run(db, `UPDATE doc_perfil SET nombre = ?, instrucciones = ?, estilo = ?, modelo = ?, tipos = ?, fuentes = ?, actualizado_en = ? WHERE id = ?`,
      [nombre, instrucciones, estilo, modelo, tipos, fuentes, marca, id]);
    return leerPerfil(db, id);
  }
  const info = run(db, `INSERT INTO doc_perfil (nombre, instrucciones, estilo, modelo, tipos, fuentes, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nombre, instrucciones, estilo, modelo, tipos, fuentes, marca, marca]);
  return leerPerfil(db, Number(info.lastInsertRowid));
}

export function borrarPerfil(db, id) {
  if (!leerPerfil(db, id)) throw new Aviso("Ese perfil ya no está.");
  run(db, "UPDATE doc_proyecto SET perfil_id = NULL WHERE perfil_id = ?", [Number(id)]);
  run(db, "DELETE FROM doc_perfil WHERE id = ?", [Number(id)]);
}

// ---------- Proyectos ----------

function proyectoDe(fila) {
  if (!fila) return null;
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    tipo: fila.tipo,
    tipoNombre: nombreTipo(fila.tipo),
    perfil_id: fila.perfil_id == null ? null : Number(fila.perfil_id),
    id_proceso: fila.id_proceso == null ? null : Number(fila.id_proceso),
    archivado: Boolean(fila.archivado),
    creado_en: fila.creado_en,
    actualizado_en: fila.actualizado_en,
  };
}

function exigirProyecto(db, id) {
  const fila = proyectoDe(uno(db, "SELECT * FROM doc_proyecto WHERE id = ?", [Number(id) || 0]));
  if (!fila) throw new Aviso("Ese proyecto ya no está.");
  return fila;
}

function tocar(db, id) {
  run(db, "UPDATE doc_proyecto SET actualizado_en = ? WHERE id = ?", [ahora(), id]);
}

export function listarProyectos(db, { archivados = false } = {}) {
  return filas(db, `
    SELECT p.*, (SELECT MAX(numero) FROM doc_version v WHERE v.proyecto_id = p.id) AS versiones,
           (SELECT radicado FROM proceso WHERE id_proceso = p.id_proceso) AS radicado
    FROM doc_proyecto p WHERE p.archivado = ? ORDER BY p.actualizado_en DESC, p.id DESC
  `, [archivados ? 1 : 0]).map((fila) => ({ ...proyectoDe(fila), versiones: Number(fila.versiones || 0), radicado: fila.radicado || "" }));
}

export function crearProyecto(db, dato = {}) {
  const nombre = texto(dato.nombre) || "Documento sin nombre";
  if (nombre.length > 120) throw new Aviso("El nombre es demasiado largo.");
  const tipo = TIPOS.has(dato.tipo) ? dato.tipo : "otro";
  const perfil = dato.perfil_id ? leerPerfil(db, dato.perfil_id) : null;
  const idProceso = Number(dato.id_proceso) || null;
  if (idProceso && !uno(db, "SELECT id_proceso FROM proceso WHERE id_proceso = ?", [idProceso])) {
    throw new Aviso("Ese expediente no está.");
  }
  const marca = ahora();
  return transaccion(db, () => {
    const info = run(db, `INSERT INTO doc_proyecto (nombre, tipo, perfil_id, id_proceso, archivado, creado_en, actualizado_en) VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [nombre, tipo, perfil?.id || null, idProceso, marca, marca]);
    const id = Number(info.lastInsertRowid);
    const existentes = new Set(listarPiezas(db).map((p) => p.id));
    for (const pieza of enteros([...(perfil?.fuentes || []), ...(dato.fuentes || [])])) {
      if (existentes.has(pieza)) run(db, "INSERT OR IGNORE INTO doc_fuente (proyecto_id, pieza_id) VALUES (?, ?)", [id, pieza]);
    }
    return exigirProyecto(db, id);
  });
}

export function actualizarProyecto(db, id, dato = {}) {
  const actual = exigirProyecto(db, id);
  const nombre = dato.nombre == null ? actual.nombre : texto(dato.nombre);
  if (!nombre) throw new Aviso("Escriba el nombre del proyecto.");
  if (nombre.length > 120) throw new Aviso("El nombre es demasiado largo.");
  const tipo = dato.tipo == null ? actual.tipo : (TIPOS.has(dato.tipo) ? dato.tipo : "otro");
  let perfil = actual.perfil_id;
  if (dato.perfil_id !== undefined) perfil = dato.perfil_id && leerPerfil(db, dato.perfil_id) ? Number(dato.perfil_id) : null;
  let proceso = actual.id_proceso;
  if (dato.id_proceso !== undefined) {
    proceso = Number(dato.id_proceso) || null;
    if (proceso && !uno(db, "SELECT id_proceso FROM proceso WHERE id_proceso = ?", [proceso])) throw new Aviso("Ese expediente no está.");
  }
  const archivado = dato.archivado == null ? actual.archivado : Boolean(dato.archivado);
  run(db, `UPDATE doc_proyecto SET nombre = ?, tipo = ?, perfil_id = ?, id_proceso = ?, archivado = ?, actualizado_en = ? WHERE id = ?`,
    [nombre, tipo, perfil, proceso, archivado ? 1 : 0, ahora(), actual.id]);
  return exigirProyecto(db, actual.id);
}

export function elegirFuentes(db, id, ids) {
  const actual = exigirProyecto(db, id);
  const existentes = new Set(listarPiezas(db).map((p) => p.id));
  transaccion(db, () => {
    run(db, "DELETE FROM doc_fuente WHERE proyecto_id = ?", [actual.id]);
    for (const pieza of enteros(ids)) {
      if (existentes.has(pieza)) run(db, "INSERT INTO doc_fuente (proyecto_id, pieza_id) VALUES (?, ?)", [actual.id, pieza]);
    }
    tocar(db, actual.id);
  });
}

export function duplicarProyecto(db, id) {
  const actual = exigirProyecto(db, id);
  const marca = ahora();
  return transaccion(db, () => {
    const info = run(db, `INSERT INTO doc_proyecto (nombre, tipo, perfil_id, id_proceso, archivado, creado_en, actualizado_en) VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [`${actual.nombre} (copia)`.slice(0, 120), actual.tipo, actual.perfil_id, actual.id_proceso, marca, marca]);
    const nuevo = Number(info.lastInsertRowid);
    run(db, "INSERT INTO doc_fuente (proyecto_id, pieza_id) SELECT ?, pieza_id FROM doc_fuente WHERE proyecto_id = ?", [nuevo, actual.id]);
    const mapa = new Map();
    for (const v of filas(db, "SELECT * FROM doc_version WHERE proyecto_id = ? ORDER BY numero", [actual.id])) {
      const r = run(db, `INSERT INTO doc_version (proyecto_id, numero, cuerpo, autor, modelo, origen, nota, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nuevo, v.numero, v.cuerpo, v.autor, v.modelo, v.origen, v.nota, v.creado_en]);
      mapa.set(Number(v.id), Number(r.lastInsertRowid));
    }
    for (const m of filas(db, "SELECT * FROM doc_mensaje WHERE proyecto_id = ? ORDER BY id", [actual.id])) {
      run(db, `INSERT INTO doc_mensaje (proyecto_id, rol, texto, version_id, dudas, origen, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nuevo, m.rol, m.texto, m.version_id == null ? null : mapa.get(Number(m.version_id)) ?? null, m.dudas, m.origen, m.creado_en]);
    }
    return exigirProyecto(db, nuevo);
  });
}

export function borrarProyecto(db, id) {
  const actual = exigirProyecto(db, id);
  transaccion(db, () => {
    run(db, "DELETE FROM doc_mensaje WHERE proyecto_id = ?", [actual.id]);
    run(db, "DELETE FROM doc_version WHERE proyecto_id = ?", [actual.id]);
    run(db, "DELETE FROM doc_fuente WHERE proyecto_id = ?", [actual.id]);
    run(db, "DELETE FROM doc_proyecto WHERE id = ?", [actual.id]);
  });
}

// ---------- Versiones y mensajes ----------

function versionDe(fila, conCuerpo = true) {
  if (!fila) return null;
  const escrito = escritoDeTexto(fila.cuerpo);
  return {
    id: Number(fila.id),
    numero: Number(fila.numero),
    autor: fila.autor,
    modelo: fila.modelo,
    origen: fila.origen,
    nota: fila.nota,
    creado_en: fila.creado_en,
    asunto: escrito.asunto,
    avisos: contarAvisos(escrito.secciones),
    ...(conCuerpo ? { cuerpo: fila.cuerpo } : {}),
  };
}

export function ultimaVersion(db, proyectoId) {
  return versionDe(uno(db, "SELECT * FROM doc_version WHERE proyecto_id = ? ORDER BY numero DESC LIMIT 1", [proyectoId]));
}

export function leerVersion(db, versionId) {
  const v = versionDe(uno(db, "SELECT * FROM doc_version WHERE id = ?", [Number(versionId) || 0]));
  if (!v) throw new Aviso("Esa versión ya no está.");
  return v;
}

export function guardarVersion(db, proyectoId, { cuerpo, autor = "modelo", modelo = "", origen = "local", nota = "" } = {}) {
  const actual = exigirProyecto(db, proyectoId);
  const limpio = String(cuerpo || "").replace(/\r\n/g, "\n").trim();
  if (!limpio) throw new Aviso("El documento está vacío.");
  if (limpio.length > 300000) throw new Aviso("El documento es demasiado largo.");
  const previa = ultimaVersion(db, actual.id);
  if (previa && previa.cuerpo === limpio) return previa;
  const numero = (previa?.numero || 0) + 1;
  const info = run(db, `INSERT INTO doc_version (proyecto_id, numero, cuerpo, autor, modelo, origen, nota, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [actual.id, numero, limpio, autor, String(modelo || ""), origen === "nube" ? "nube" : "local", String(nota || "").slice(0, 300), ahora()]);
  tocar(db, actual.id);
  return leerVersion(db, Number(info.lastInsertRowid));
}

export function restaurarVersion(db, versionId) {
  const v = uno(db, "SELECT * FROM doc_version WHERE id = ?", [Number(versionId) || 0]);
  if (!v) throw new Aviso("Esa versión ya no está.");
  return guardarVersion(db, v.proyecto_id, { cuerpo: v.cuerpo, autor: "restaurada", modelo: v.modelo, origen: v.origen, nota: `Restaurada de la versión ${v.numero}` });
}

function agregarMensaje(db, proyectoId, { rol, texto: cuerpo, versionId = null, dudas = null, origen = "local" }) {
  run(db, `INSERT INTO doc_mensaje (proyecto_id, rol, texto, version_id, dudas, origen, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [proyectoId, rol, String(cuerpo || "").slice(0, 20000), versionId, dudas ? JSON.stringify(dudas) : "", origen === "nube" ? "nube" : "local", ahora()]);
}

function mensajes(db, proyectoId) {
  return filas(db, "SELECT * FROM doc_mensaje WHERE proyecto_id = ? ORDER BY id", [proyectoId]).map((m) => ({
    id: Number(m.id),
    rol: m.rol,
    texto: m.texto,
    version_id: m.version_id == null ? null : Number(m.version_id),
    dudas: lista(m.dudas),
    origen: m.origen,
    creado_en: m.creado_en,
  }));
}

function fuentesDelProyecto(db, proyectoId) {
  const ids = new Set(filas(db, "SELECT pieza_id FROM doc_fuente WHERE proyecto_id = ?", [proyectoId]).map((f) => Number(f.pieza_id)));
  return listarPiezas(db).filter((p) => ids.has(p.id));
}

export function leerProyecto(db, id) {
  const proyecto = exigirProyecto(db, id);
  const proceso = proyecto.id_proceso ? uno(db, "SELECT id_proceso, radicado, despacho FROM proceso WHERE id_proceso = ?", [proyecto.id_proceso]) : null;
  return {
    proyecto: { ...proyecto, radicado: proceso?.radicado || "", despacho: proceso?.despacho || "" },
    perfil: proyecto.perfil_id ? leerPerfil(db, proyecto.perfil_id) : null,
    mensajes: mensajes(db, proyecto.id),
    versiones: filas(db, "SELECT * FROM doc_version WHERE proyecto_id = ? ORDER BY numero DESC", [proyecto.id]).map((v) => versionDe(v, false)),
    actual: ultimaVersion(db, proyecto.id),
    fuentes: fuentesDelProyecto(db, proyecto.id).map((p) => p.id),
  };
}

// ---------- Una vuelta de conversación ----------

function expedienteDe(db, proyecto) {
  if (!proyecto.id_proceso) return { ficha: {}, contexto: "" };
  const proceso = detalleProceso(db, proyecto.id_proceso);
  if (!proceso) return { ficha: {}, contexto: "" };
  const ficha = fichaDeDetalle(proceso);
  const partes = (proceso.sujetos || []).map((s) => `- ${s.rol_base || "parte"}: ${s.nombre}${s.identificacion ? `, identificación ${s.identificacion}` : ""}`);
  const contexto = [contextoExpediente(ficha, proceso, 15), partes.length ? `Partes:\n${partes.join("\n")}` : ""].filter(Boolean).join("\n");
  return { ficha, contexto };
}

function dudasPendientes(historia) {
  const ultimo = historia[historia.length - 1];
  return ultimo?.rol === "asistente" && ultimo.dudas?.length ? ultimo.dudas : null;
}

export function modeloDelProyecto(datosDir, perfil, modeloId) {
  return modeloParaDocumento(datosDir, modeloId || perfil?.modelo || "");
}

// mensaje: lo que escribió el usuario. pasaje: texto elegido del documento
// para reescribir solo esa parte. documento: si el usuario editó a mano,
// el texto editado se guarda como versión antes de la vuelta.
export async function conversar({ db, datosDir, proyectoId, mensaje, modeloId, pasaje, documento, onProgreso, hoy = ahora().slice(0, 10), pedirTexto = textoParaDocumento, resolverModelo = modeloDelProyecto }) {
  const pedido = String(mensaje || "").trim();
  if (!pedido) throw new Aviso("Escriba qué necesita del documento.");
  const datos = leerProyecto(db, proyectoId);
  const { proyecto, perfil } = datos;
  if (documento != null && String(documento).trim() && String(documento).trim() !== (datos.actual?.cuerpo || "")) {
    guardarVersion(db, proyecto.id, { cuerpo: documento, autor: "usuario", nota: "Edición directa" });
  }
  const historia = mensajes(db, proyecto.id);
  const preguntas = dudasPendientes(historia);
  agregarMensaje(db, proyecto.id, { rol: "usuario", texto: pasaje ? `${pedido}\n\nPasaje elegido: ${pasaje}` : pedido });
  const actual = ultimaVersion(db, proyecto.id);
  const elegido = resolverModelo(datosDir, perfil, modeloId);
  const { ficha, contexto } = expedienteDe(db, proyecto);
  const hoyLargo = fechaInforme(String(hoy).slice(0, 10));

  if (!elegido.usa) {
    if (actual) {
      agregarMensaje(db, proyecto.id, { rol: "asistente", texto: "Con el modelo Sencillo solo se arma la plantilla básica. Para que el documento cambie con cada mensaje elija un modelo local o de nube en Modelos de IA. Mientras tanto puede editar el texto a mano." });
      return { ...leerProyecto(db, proyecto.id), modelo: elegido };
    }
    const base = plantillaBasica({ tipo: proyecto.tipo, ficha, pedido });
    const v = guardarVersion(db, proyecto.id, { cuerpo: textoDeEscrito(base), autor: "plantilla", modelo: "Plantilla básica", nota: "Plantilla básica" });
    agregarMensaje(db, proyecto.id, { rol: "asistente", texto: `Armé la versión ${v.numero} con la plantilla básica de ${nombreTipo(proyecto.tipo).toLowerCase()}. Los datos que faltan quedan como [Dato pendiente]. Para redactar y revisar por conversación elija un modelo en Modelos de IA.`, versionId: v.id });
    return { ...leerProyecto(db, proyecto.id), modelo: elegido };
  }

  const lim = presupuestoDe(elegido.origen);
  const fuentes = fuentesDelProyecto(db, proyecto.id);
  const consulta = [pedido, pasaje, nombreTipo(proyecto.tipo), actual?.asunto, ...historia.filter((m) => m.rol === "usuario").slice(-3).map((m) => m.texto)].filter(Boolean).join(" ");
  const fragmentos = fragmentosRelevantes(fuentes, consulta, { presupuesto: lim.fuentes });
  const citables = fuentesDeCitas({ expediente: contexto, fragmentos, historia: [...historia, { rol: "usuario", texto: pedido }], documentoPrevio: "", pedido });
  // Una cita que ya estaba en la versión anterior sin marca la aportó el
  // usuario al editar o venía de las fuentes: no se vuelve a marcar si el
  // usuario la escribió a mano.
  const editadas = filas(db, "SELECT cuerpo FROM doc_version WHERE proyecto_id = ? AND autor = 'usuario'", [proyecto.id]).map((f) => f.cuerpo).join("\n");
  const fuentesTexto = [citables, editadas].join("\n");
  const avance = (dato) => {
    try {
      onProgreso?.({ proyectoId: proyecto.id, texto: dato?.texto || "", pasaje: Boolean(pasaje) });
    } catch {
      /* la ventana ya no escucha */
    }
  };

  let respuesta;
  try {
    const onUsoDoc = (uso) => guardarUso(db, { ...uso, motivo: "documento", proyectoId: proyecto.id });
    if (pasaje && actual) {
      respuesta = await pedirTexto({
        datosDir, modeloId: elegido.id, onProgreso: avance, onUso: onUsoDoc,
        encargo: armarEncargoPasaje({ tipo: proyecto.tipo, perfil, documento: actual.cuerpo, pasaje, pedido, fragmentos, origen: elegido.origen }),
      });
    } else {
      respuesta = await pedirTexto({
        datosDir, modeloId: elegido.id, onProgreso: avance, onUso: onUsoDoc,
        encargo: armarEncargoDocumento({
          tipo: proyecto.tipo, perfil, expediente: contexto, fragmentos, historia, documento: actual?.cuerpo || "", pedido,
          hoy: hoyLargo, origen: elegido.origen,
          aclaracion: preguntas ? { preguntas, respuesta: pedido } : null,
          cerrar: Boolean(preguntas),
        }),
      });
    }
  } catch (error) {
    if (error instanceof Aviso) throw error;
    console.error(error);
    agregarMensaje(db, proyecto.id, { rol: "asistente", texto: "El modelo no respondió. El documento quedó como estaba. Intente otra vez o elija otro modelo.", origen: elegido.origen });
    return { ...leerProyecto(db, proyecto.id), modelo: elegido, error: true };
  }
  const crudo = String(respuesta?.texto || "");
  const origen = respuesta?.origen || elegido.origen;
  const nombreModelo = respuesta?.nombre || elegido.nombre;

  if (pasaje && actual) {
    const marcado = marcarCitasDocumento([{ titulo: "x", parrafos: [crudo.trim()] }], fuentesTexto)[0].parrafos[0];
    const nuevo = reemplazarPasaje(actual.cuerpo, pasaje, marcado);
    if (!nuevo) {
      agregarMensaje(db, proyecto.id, { rol: "asistente", texto: "No pude ubicar ese pasaje en el documento. Elija un texto que aparezca una sola vez.", origen });
      return { ...leerProyecto(db, proyecto.id), modelo: elegido };
    }
    const v = guardarVersion(db, proyecto.id, { cuerpo: nuevo, modelo: nombreModelo, origen, nota: `Pasaje: ${pedido}` });
    agregarMensaje(db, proyecto.id, { rol: "asistente", texto: `Reescribí el pasaje. Quedó la versión ${v.numero}.${resumenAvisos(v.avisos)}`, versionId: v.id, origen });
    return { ...leerProyecto(db, proyecto.id), modelo: elegido };
  }

  const leido = interpretarRespuesta(crudo, { cerrar: Boolean(preguntas) || Boolean(actual), fuentes: fuentesTexto });
  if (leido.tipo === "dudas") {
    agregarMensaje(db, proyecto.id, { rol: "asistente", texto: "Antes de redactar necesito saber:", dudas: leido.preguntas, origen });
    return { ...leerProyecto(db, proyecto.id), modelo: elegido };
  }
  if (leido.tipo !== "documento") {
    agregarMensaje(db, proyecto.id, { rol: "asistente", texto: "El modelo no devolvió un documento. El texto quedó como estaba.", origen });
    return { ...leerProyecto(db, proyecto.id), modelo: elegido, error: true };
  }
  const cuerpo = textoDeEscrito({ asunto: leido.asunto, secciones: leido.secciones });
  const v = guardarVersion(db, proyecto.id, { cuerpo, modelo: nombreModelo, origen, nota: pedido.slice(0, 120) });
  const verbo = actual ? "Revisé el documento" : "Redacté el documento";
  agregarMensaje(db, proyecto.id, { rol: "asistente", texto: `${verbo}. Quedó la versión ${v.numero}.${resumenAvisos(v.avisos)}`, versionId: v.id, origen });
  return { ...leerProyecto(db, proyecto.id), modelo: elegido };
}

function resumenAvisos(avisos) {
  const partes = [];
  if (avisos?.citas) partes.push(`${avisos.citas} ${avisos.citas === 1 ? "cita no aportada" : "citas no aportadas"}`);
  if (avisos?.datos) partes.push(`${avisos.datos} ${avisos.datos === 1 ? "dato pendiente" : "datos pendientes"}`);
  return partes.length ? ` Revise ${partes.join(" y ")}.` : "";
}

export function escritoDeVersion(version) {
  const escrito = escritoDeTexto(version?.cuerpo || "");
  return { asunto: escrito.asunto, secciones: escrito.secciones, origen: version?.origen === "nube" ? "nube" : "local" };
}
