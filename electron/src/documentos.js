// Documentos: proyectos de redacción por conversación. Todo vive en la base
// local (migración 11). El texto solo sale si el perfil o el proyecto usan
// un modelo de nube con la clave del usuario.
import crypto from "node:crypto";
import { ahora, texto } from "../compartido/logica.js";
import { bloqueDeArchivos, fragmentosDeTrozos, informeArchivos, recortarAgentes, repartirFuentes } from "../compartido/contexto.js";
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
import { bloqueMemoria } from "../compartido/memoria.js";
import { anotarVuelta, bloquesDelProyecto, guardarEdicionUsuario, guardarPropuesta, historialBloque, leerMemoria, prepararCambioBloque, resolverCambio, sincronizar } from "./memoria.js";
import { agentesParaContexto, archivosDelProyecto, candidatosFts, leerAgentes, leerArchivo, trozosDeArchivos } from "./conversiones.js";
import { detalleArchivo } from "../compartido/convertir.js";

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
    solo_local: fila.solo_local == null ? true : Boolean(fila.solo_local),
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
  const soloLocal = dato.solo_local == null ? actual.solo_local : Boolean(dato.solo_local);
  run(db, `UPDATE doc_proyecto SET nombre = ?, tipo = ?, perfil_id = ?, id_proceso = ?, archivado = ?, solo_local = ?, actualizado_en = ? WHERE id = ?`,
    [nombre, tipo, perfil, proceso, archivado ? 1 : 0, soloLocal ? 1 : 0, ahora(), actual.id]);
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
    run(db, "UPDATE doc_proyecto SET solo_local = ? WHERE id = ?", [actual.solo_local ? 1 : 0, nuevo]);
    run(db, "INSERT INTO doc_archivo (proyecto_id, archivo_id, incluido, agregado_en) SELECT ?, archivo_id, incluido, agregado_en FROM doc_archivo WHERE proyecto_id = ?", [nuevo, actual.id]);
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
    run(db, "DELETE FROM doc_archivo WHERE proyecto_id = ?", [actual.id]);
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
  const nueva = guardarVersion(db, v.proyecto_id, { cuerpo: v.cuerpo, autor: "restaurada", modelo: v.modelo, origen: v.origen, nota: `Restaurada de la versión ${v.numero}` });
  sincronizar(db, v.proyecto_id, nueva);
  anotarVuelta(db, v.proyecto_id, { cuerpo: nueva.cuerpo, decision: `Restaurada la versión ${v.numero}` });
  return nueva;
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

// Fuentes elegidas con sus trozos: la que viene de un archivo convertido
// lleva los trozos guardados (con página); la de antes, sin archivo, se
// trocea al vuelo como siempre. También trae el archivo para el informe.
export function fuentesConTrozos(db, proyectoId) {
  const fuentes = fuentesDelProyecto(db, proyectoId);
  const ids = fuentes.map((p) => p.archivo_id).filter(Boolean);
  if (!ids.length) return fuentes;
  const porArchivo = new Map();
  for (const t of trozosDeArchivos(db, ids)) {
    if (!porArchivo.has(t.archivo_id)) porArchivo.set(t.archivo_id, []);
    porArchivo.get(t.archivo_id).push(t);
  }
  return fuentes.map((p) => {
    const trozos = p.archivo_id ? porArchivo.get(p.archivo_id) || [] : [];
    if (!trozos.length) return p;
    return { ...p, trozos, archivo: leerArchivo(db, p.archivo_id) };
  });
}

// Informe de las fuentes de la biblioteca que entran: fragmentos, páginas
// y, si vienen de un archivo, sus datos (OCR, calidad, origen).
export function informeFuentes(fragmentos) {
  const mapa = new Map();
  for (const f of fragmentos || []) {
    const fuente = f.fuente || {};
    const clave = fuente.id ?? fuente.nombre;
    if (!mapa.has(clave)) {
      mapa.set(clave, { id: fuente.id || null, nombre: fuente.nombre || "Fuente", fragmentos: 0, paginas: new Set(), detalle: fuente.archivo ? detalleArchivo(fuente.archivo) : "" });
    }
    const m = mapa.get(clave);
    m.fragmentos++;
    if (f.pagina) m.paginas.add(f.pagina);
  }
  return [...mapa.values()].map((m) => ({ ...m, paginas: [...m.paginas].sort((a, b) => a - b) }));
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
    memoria: leerMemoria(db, proyecto.id),
    bloques: bloquesDelProyecto(db, proyecto.id).map((b) => ({ id: b.id, orden: b.orden, seccion: b.seccion, texto: b.texto })),
    fuentes: fuentesDelProyecto(db, proyecto.id).map((p) => p.id),
    archivos: archivosDelProyecto(db, proyecto.id).map((a) => ({
      id: a.id, nombre: a.nombre, extension: a.extension, estado: a.estado, paginas: a.paginas, paginas_ocr: a.paginas_ocr,
      tokens_aprox: a.tokens_aprox, incluido: Boolean(a.incluido), aviso: a.aviso, origen: a.origen,
    })),
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

export function hashEncargo(encargo) {
  return crypto.createHash("sha256").update(String(encargo || "")).digest("hex");
}

export const AVISO_SOLO_LOCAL = "Este proyecto está en Solo local: no se envía nada a la nube. Elija un modelo local o quite Solo local en Contexto del proyecto.";

// Arma el encargo de la próxima vuelta sin escribir nada en la base. Lo
// usa el diálogo Revisar envío (muestra el texto exacto) y la vuelta misma.
export function prepararVuelta({ db, datosDir, proyectoId, mensaje, modeloId, pasaje, documento, hoy = ahora().slice(0, 10), resolverModelo = modeloDelProyecto }) {
  const pedido = String(mensaje || "").trim();
  if (!pedido) throw new Aviso("Escriba qué necesita del documento.");
  const datos = leerProyecto(db, proyectoId);
  const { proyecto, perfil } = datos;
  const historia = mensajes(db, proyecto.id);
  const preguntas = dudasPendientes(historia);
  const editado = documento != null && String(documento).trim() && String(documento).trim() !== (datos.actual?.cuerpo || "");
  const actual = editado ? { ...(datos.actual || {}), cuerpo: String(documento) } : datos.actual;
  const elegido = resolverModelo(datosDir, perfil, modeloId);
  const { ficha, contexto } = expedienteDe(db, proyecto);
  const hoyLargo = fechaInforme(String(hoy).slice(0, 10));
  if (!elegido.usa) return { datos, proyecto, perfil, historia, preguntas, actual, elegido, ficha, contexto, pedido, encargo: "", informe: null, fragmentos: [], archivosFrag: [] };

  const lim = presupuestoDe(elegido.origen);
  const incluidos = archivosDelProyecto(db, proyecto.id).filter((a) => a.incluido && a.estado === "listo");
  // Si el mismo archivo está en el proyecto y como fuente, entra una vez.
  const yaIncluidos = new Set(incluidos.map((a) => a.id));
  const fuentes = fuentesConTrozos(db, proyecto.id).filter((p) => !p.archivo_id || !yaIncluidos.has(p.archivo_id));
  const reparto = repartirFuentes(lim.fuentes, { hayArchivos: incluidos.length > 0, hayPiezas: fuentes.length > 0 });
  const consulta = [pedido, pasaje, nombreTipo(proyecto.tipo), actual?.asunto, ...historia.filter((m) => m.rol === "usuario").slice(-3).map((m) => m.texto)].filter(Boolean).join(" ");
  const fragmentos = fuentes.length ? fragmentosRelevantes(fuentes, consulta, { presupuesto: reparto.piezas }) : [];
  const ids = incluidos.map((a) => a.id);
  const todos = trozosDeArchivos(db, ids);
  const candidatos = todos.length > 400 ? (candidatosFts(db, ids, terminosDe(consulta)) || todos) : todos;
  const { fragmentos: archivosFrag, recortados } = fragmentosDeTrozos(candidatos, consulta, { presupuesto: reparto.archivos });
  const agentes = recortarAgentes(agentesParaContexto(leerAgentes(datosDir, proyecto.id)), elegido.origen);
  const bloqueArchivos = bloqueDeArchivos(archivosFrag);
  const memoria = bloqueMemoria(leerMemoria(db, proyecto.id), elegido.origen);
  let encargo;
  if (pasaje && actual) {
    encargo = armarEncargoPasaje({ tipo: proyecto.tipo, perfil, documento: actual.cuerpo, pasaje, pedido, fragmentos: [...fragmentos, ...archivosFrag.map((f) => ({ ...f, fuente: { nombre: f.nombre } }))], origen: elegido.origen });
  } else {
    encargo = armarEncargoDocumento({
      tipo: proyecto.tipo, perfil, expediente: contexto, fragmentos, historia, documento: actual?.cuerpo || "", pedido,
      hoy: hoyLargo, origen: elegido.origen,
      aclaracion: preguntas ? { preguntas, respuesta: pedido } : null,
      cerrar: Boolean(preguntas),
      agentes: agentes.texto, archivos: bloqueArchivos, memoria,
    });
  }
  const informe = {
    origen: elegido.origen,
    modelo: elegido.nombre,
    modeloId: elegido.id,
    proveedor: elegido.id.startsWith("nube:") ? elegido.id.slice(5).split(":")[0] : "local",
    caracteres: encargo.length,
    tokens: Math.ceil(encargo.length / 4),
    archivos: informeArchivos(archivosFrag).map((a) => {
      const fila = incluidos.find((x) => x.id === a.id);
      return { ...a, detalle: fila ? detalleArchivo(fila) : "" };
    }),
    archivosRecortados: recortados,
    fuentes: [...new Set(fragmentos.map((f) => f.fuente?.nombre).filter(Boolean))],
    fuentesDetalle: informeFuentes(fragmentos),
    agentes: Boolean(agentes.texto),
    memoria: Boolean(memoria),
    agentesRecortado: agentes.recortado,
    expediente: Boolean(contexto),
    hash: hashEncargo(encargo),
  };
  return { datos, proyecto, perfil, historia, preguntas, actual, elegido, ficha, contexto, pedido, encargo, informe, fragmentos, archivosFrag };
}

function terminosDe(consulta) {
  return String(consulta || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9ñ]+/).filter((t) => t.length > 2);
}

export function registrarEnvio(db, { proyectoId, informe, motivo = "documento" }) {
  run(db, `INSERT INTO envio_nube (fecha, proyecto_id, proveedor, modelo, motivo, caracteres, tokens_aprox, archivos, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    ahora(), proyectoId, informe.proveedor || "", informe.modelo || "", motivo, informe.caracteres || 0, informe.tokens || 0,
    JSON.stringify((informe.archivos || []).map((a) => ({ nombre: a.nombre, paginas: a.paginas }))), informe.hash || "",
  ]);
}

export function enviosDelProyecto(db, proyectoId) {
  return filas(db, "SELECT * FROM envio_nube WHERE proyecto_id = ? ORDER BY id DESC LIMIT 50", [proyectoId]);
}

// mensaje: lo que escribió el usuario. pasaje: texto elegido del documento
// para reescribir solo esa parte. documento: si el usuario editó a mano,
// el texto editado se guarda como versión antes de la vuelta.
// confirmado: el hash del encargo que el usuario vio en Revisar envío. Sin
// él no sale nada a la nube.
export async function conversar({ db, datosDir, proyectoId, mensaje, modeloId, pasaje, documento, confirmado = "", onProgreso, hoy = ahora().slice(0, 10), pedirTexto = textoParaDocumento, resolverModelo = modeloDelProyecto }) {
  const previa = prepararVuelta({ db, datosDir, proyectoId, mensaje, modeloId, pasaje, documento, hoy, resolverModelo });
  if (previa.elegido.usa && previa.elegido.origen === "nube") {
    if (previa.proyecto.solo_local) throw new Aviso(AVISO_SOLO_LOCAL);
    if (!confirmado || confirmado !== previa.informe.hash) {
      const error = new Aviso("Revise el envío antes de mandarlo a la nube.");
      error.codigo = "revisar-envio";
      throw error;
    }
  }
  const { datos, proyecto } = previa;
  if (documento != null && String(documento).trim() && String(documento).trim() !== (datos.actual?.cuerpo || "")) {
    guardarVersion(db, proyecto.id, { cuerpo: documento, autor: "usuario", nota: "Edición directa" });
  }
  const { historia, preguntas, elegido, ficha, contexto, pedido, encargo, fragmentos, archivosFrag } = previa;
  agregarMensaje(db, proyecto.id, { rol: "usuario", texto: pasaje ? `${pedido}\n\nPasaje elegido: ${pasaje}` : pedido });
  const actual = ultimaVersion(db, proyecto.id);

  if (!elegido.usa) {
    if (actual) {
      agregarMensaje(db, proyecto.id, { rol: "asistente", texto: "Con el modelo Sencillo solo se arma la plantilla básica. Para que el documento cambie con cada mensaje elija un modelo local o de nube en Modelos de IA. Mientras tanto puede editar el texto a mano." });
      return { ...leerProyecto(db, proyecto.id), modelo: elegido };
    }
    const base = plantillaBasica({ tipo: proyecto.tipo, ficha, pedido });
    const v = guardarVersion(db, proyecto.id, { cuerpo: textoDeEscrito(base), autor: "plantilla", modelo: "Plantilla básica", nota: "Plantilla básica" });
    sincronizar(db, proyecto.id, { id: v.id, cuerpo: textoDeEscrito(base) });
    anotarVuelta(db, proyecto.id, { pedido, cuerpo: textoDeEscrito(base), modelo: "Plantilla básica" });
    agregarMensaje(db, proyecto.id, { rol: "asistente", texto: `Armé la versión ${v.numero} con la plantilla básica de ${nombreTipo(proyecto.tipo).toLowerCase()}. Los datos que faltan quedan como [Dato pendiente]. Para redactar y revisar por conversación elija un modelo en Modelos de IA.`, versionId: v.id });
    return { ...leerProyecto(db, proyecto.id), modelo: elegido };
  }

  const citables = fuentesDeCitas({ expediente: contexto, fragmentos: [...fragmentos, ...archivosFrag], historia: [...historia, { rol: "usuario", texto: pedido }], documentoPrevio: "", pedido });
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
    if (elegido.origen === "nube") registrarEnvio(db, { proyectoId: proyecto.id, informe: previa.informe });
    respuesta = await pedirTexto({ datosDir, modeloId: elegido.id, onProgreso: avance, onUso: onUsoDoc, encargo });
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
    sincronizar(db, proyecto.id, { id: v.id, cuerpo: nuevo });
    anotarVuelta(db, proyecto.id, { pedido, cuerpo: nuevo, modelo: nombreModelo, fuentes: usadas(previa) });
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
  sincronizar(db, proyecto.id, { id: v.id, cuerpo });
  anotarVuelta(db, proyecto.id, { pedido, cuerpo, modelo: nombreModelo, fuentes: usadas(previa) });
  const verbo = actual ? "Revisé el documento" : "Redacté el documento";
  agregarMensaje(db, proyecto.id, { rol: "asistente", texto: `${verbo}. Quedó la versión ${v.numero}.${resumenAvisos(v.avisos)}`, versionId: v.id, origen });
  return { ...leerProyecto(db, proyecto.id), modelo: elegido };
}

function usadas(previa) {
  return [...new Set([...(previa.fragmentos || []).map((f) => f.fuente?.nombre), ...(previa.archivosFrag || []).map((f) => f.nombre)].filter(Boolean))];
}

// ---------- Edición por bloque: el modelo reescribe solo ese párrafo ----------

export function prepararBloque({ db, datosDir, proyectoId, bloqueId, mensaje, modeloId, resolverModelo = modeloDelProyecto }) {
  const previa = prepararVuelta({ db, datosDir, proyectoId, mensaje, modeloId, pasaje: "x", resolverModelo });
  if (!previa.elegido.usa) throw new Aviso("Para cambiar un párrafo elija un modelo local o de nube en Modelos de IA.");
  if (!previa.actual) throw new Aviso("Todavía no hay documento.");
  if (!bloquesDelProyecto(db, previa.proyecto.id).length) sincronizar(db, previa.proyecto.id, previa.actual);
  const { bloque, encargo, hash } = prepararCambioBloque({
    db, proyectoId: previa.proyecto.id, bloqueId, pedido: previa.pedido, tipo: previa.proyecto.tipo, perfil: previa.perfil,
    cuerpo: previa.actual.cuerpo, fragmentos: [...previa.fragmentos, ...previa.archivosFrag.map((f) => ({ ...f, fuente: { nombre: f.nombre } }))],
    origen: previa.elegido.origen, memoriaTexto: bloqueMemoria(leerMemoria(db, previa.proyecto.id), previa.elegido.origen),
  });
  const informe = { ...previa.informe, caracteres: encargo.length, tokens: Math.ceil(encargo.length / 4), hash };
  return { previa, bloque, encargo, informe };
}

export async function proponerBloque({ db, datosDir, proyectoId, bloqueId, mensaje, modeloId, confirmado = "", onProgreso, pedirTexto = textoParaDocumento, resolverModelo = modeloDelProyecto }) {
  const { previa, bloque, encargo, informe } = prepararBloque({ db, datosDir, proyectoId, bloqueId, mensaje, modeloId, resolverModelo });
  const { elegido, proyecto } = previa;
  if (elegido.origen === "nube") {
    if (proyecto.solo_local) throw new Aviso(AVISO_SOLO_LOCAL);
    if (!confirmado || confirmado !== informe.hash) {
      const error = new Aviso("Revise el envío antes de mandarlo a la nube.");
      error.codigo = "revisar-envio";
      throw error;
    }
    registrarEnvio(db, { proyectoId: proyecto.id, informe, motivo: "parrafo" });
  }
  const r = await pedirTexto({
    datosDir, modeloId: elegido.id, encargo,
    onProgreso: (d) => onProgreso?.({ proyectoId: proyecto.id, texto: d?.texto || "", pasaje: true }),
    onUso: (uso) => guardarUso(db, { ...uso, motivo: "parrafo", proyectoId: proyecto.id }),
  });
  const despues = String(r?.texto || "").trim();
  if (!despues) throw new Aviso("El modelo no devolvió el párrafo. El documento quedó como estaba.");
  const citables = fuentesDeCitas({ expediente: previa.contexto, fragmentos: [...previa.fragmentos, ...previa.archivosFrag], historia: previa.historia, documentoPrevio: previa.actual.cuerpo, pedido: previa.pedido });
  return { cambio: guardarPropuesta(db, { proyectoId: proyecto.id, bloque, despues, pedido: previa.pedido, modelo: r?.nombre || elegido.nombre, origen: r?.origen || elegido.origen, fuentesTexto: citables }) };
}

export function resolverBloque(db, id, aceptar) {
  return resolverCambio(db, { id, aceptar, guardarVersion, ultimaVersion });
}

export { historialBloque };

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

export function guardarEdicionDocumento(db, proyectoId, cuerpo, ids = []) {
  return guardarEdicionUsuario(db, { proyectoId, cuerpo, ids, guardarVersion });
}
