// Mis procesos en la base: arma el tablero con los procesos de todas las
// fuentes y guarda lo propio del despacho (notas, tareas, audiencias,
// archivos y procesos manuales o de estados) en tablas mp_*. El monitor no
// lee ni escribe ninguna de ellas: lo que compara sigue en actuacion,
// samai_actuacion y spoa_actuacion.
import fs from "node:fs";
import path from "node:path";
import { ahora } from "../compartido/logica.js";
import {
  FUENTES, MODALIDADES, TIPOS_PROPIA, contarTablero, fechaIso, fuenteDe, icsDeAudiencias, isoDia, lineaDeTiempo,
  recordatoriosDebidos, refAudiencia, registrosDeEstado, sugerirAudiencias, unificarProcesos, DIAS_RECIENTE,
} from "../compartido/misprocesos.js";
import { filas, listarClientes, listarProcesos, run, transaccion, uno } from "./db.js";
import { crearProyecto } from "./documentos.js";
import { libroDeHojas } from "./excel.js";

class Aviso extends Error {}

function texto(v, max = 4000) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function largo(v, max = 8000) {
  return String(v ?? "").replace(/\r/g, "").trim().slice(0, max);
}

function partirClave(clave) {
  const m = String(clave || "").match(/^(cn|sa|sp|ma):(.+)$/);
  if (!m) throw new Aviso("Ese proceso no está.");
  return { tipo: m[1], ref: m[2] };
}

function hoyLocal() {
  return isoDia(new Date());
}

// ---------- Lista ----------

function filasSamai(db) {
  return filas(db, `SELECT c.guid, c.radicado, c.clase, c.despacho, c.demandante, c.demandado,
      (SELECT a.fecha FROM samai_actuacion a WHERE a.guid = c.guid ORDER BY a.id LIMIT 1) AS ultima_fecha,
      (SELECT a.actuacion FROM samai_actuacion a WHERE a.guid = c.guid ORDER BY a.id LIMIT 1) AS ultima_actuacion
    FROM samai_caso c`);
}

function filasSpoa(db) {
  return filas(db, `SELECT c.noticia, c.despacho, c.estado, c.etapa,
      (SELECT a.fecha FROM spoa_actuacion a WHERE a.noticia = c.noticia ORDER BY a.id LIMIT 1) AS ultima_fecha,
      (SELECT a.descripcion FROM spoa_actuacion a WHERE a.noticia = c.noticia ORDER BY a.id LIMIT 1) AS ultima_actuacion
    FROM spoa_caso c`);
}

function filasManuales(db) {
  return filas(db, `SELECT m.*, TRIM(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellidos, '')) AS abogado,
      (SELECT a.fecha FROM mp_actuacion a WHERE a.clave = 'ma:' || m.id ORDER BY a.fecha DESC, a.id DESC LIMIT 1) AS ultima_fecha,
      (SELECT a.actuacion FROM mp_actuacion a WHERE a.clave = 'ma:' || m.id ORDER BY a.fecha DESC, a.id DESC LIMIT 1) AS ultima_actuacion
    FROM mp_proceso m LEFT JOIN cliente c ON c.id = m.cliente_id`);
}

export function listarMisProcesos(db, { hoy = hoyLocal() } = {}) {
  const desde = new Date(Date.now() - DIAS_RECIENTE * 24 * 60 * 60 * 1000).toISOString();
  const recientes = filas(db, "SELECT DISTINCT id_proceso FROM aviso WHERE id_proceso IS NOT NULL AND creado_en >= ?", [desde])
    .map((f) => `cn:${f.id_proceso}`);
  const procesos = unificarProcesos({
    consulta: listarProcesos(db),
    samai: filasSamai(db),
    spoa: filasSpoa(db),
    manuales: filasManuales(db),
    marcas: filas(db, "SELECT clave, archivado FROM mp_marca"),
    recientes,
    hoy,
  });
  const pendientes = filas(db, "SELECT id, clave, tipo, fecha, texto, vence, estado FROM mp_propia WHERE estado = 'pendiente' ORDER BY CASE WHEN vence = '' THEN 1 ELSE 0 END, vence, fecha DESC");
  const audiencias = listarAudiencias(db);
  return {
    procesos,
    audiencias,
    pendientes,
    clientes: listarClientes(db),
    tablero: contarTablero({ procesos, audiencias, propias: pendientes, hoy }),
    fuentes: FUENTES,
    hoy,
  };
}

export function listarAudiencias(db) {
  return filas(db, "SELECT * FROM mp_audiencia WHERE estado = 'activa' ORDER BY fecha, hora");
}

// Todos los radicados que el usuario sigue en cualquier fuente (Estados los
// marca como "Usted sigue este proceso").
export function radicadosSeguidos(db) {
  const todos = filas(db, `SELECT radicado FROM proceso UNION SELECT radicado FROM samai_caso
    UNION SELECT radicado FROM mp_proceso WHERE vinculo = ''`);
  return [...new Set(todos.map((f) => String(f.radicado || "").replace(/\D/g, "")).filter(Boolean))];
}

// ---------- Detalle ----------

function actuacionesJuzgado(db, clave, radicado) {
  const { tipo, ref } = partirClave(clave);
  let salida = [];
  if (tipo === "cn") {
    salida = filas(db, "SELECT fecha_actuacion AS fecha, actuacion, anotacion FROM actuacion WHERE id_proceso = ? ORDER BY fecha_actuacion DESC, consecutivo DESC", [Number(ref)])
      .map((a) => ({ ...a, origen: "consulta" }));
  } else if (tipo === "sa") {
    salida = filas(db, "SELECT COALESCE(NULLIF(fecha, ''), fecha_registro) AS fecha, actuacion, anotacion FROM samai_actuacion WHERE guid = ? ORDER BY id", [ref])
      .map((a) => ({ ...a, origen: "samai" }));
  } else if (tipo === "sp") {
    salida = filas(db, "SELECT fecha, descripcion AS actuacion, '' AS anotacion FROM spoa_actuacion WHERE noticia = ? ORDER BY id", [ref])
      .map((a) => ({ ...a, origen: "spoa" }));
  }
  // Las del estado del juzgado y las manuales: por clave y, si hay
  // radicado, las de ese radicado aunque se hayan guardado en otra clave.
  const propias = filas(db, `SELECT id, fecha, actuacion, anotacion, origen, estado_no, fecha_estado, juzgado FROM mp_actuacion
    WHERE clave = ? OR (? <> '' AND radicado = ?) ORDER BY fecha DESC, id DESC`, [clave, radicado || "", radicado || ""])
    .map((a) => ({ ...a, origen: a.origen === "estado" ? "estado" : "manual" }));
  return [...salida, ...propias];
}

export function detalleMisProcesos(db, clave, { hoy = hoyLocal() } = {}) {
  const lista = listarMisProcesos(db, { hoy });
  let proceso = lista.procesos.find((p) => p.clave === clave);
  if (!proceso && clave.startsWith("ma:")) {
    const m = uno(db, "SELECT vinculo FROM mp_proceso WHERE id = ?", [Number(clave.slice(3))]);
    if (m?.vinculo) proceso = lista.procesos.find((p) => p.clave === m.vinculo);
  }
  if (!proceso) throw new Aviso("Ese proceso ya no está.");
  const c = proceso.clave;
  const juzgado = actuacionesJuzgado(db, c, proceso.radicado);
  const propias = filas(db, "SELECT * FROM mp_propia WHERE clave = ? ORDER BY fecha DESC, id DESC", [c]);
  const todas = filas(db, "SELECT * FROM mp_audiencia WHERE clave = ? ORDER BY fecha, hora", [c]);
  const sugerencias = sugerirAudiencias(juzgado.map((a) => ({ ...a, clave: c, radicado: proceso.radicado })), {
    hoy,
    conocidas: todas.map((a) => a.ref || refAudiencia(c, a.fecha, a.hora)),
  });
  const { tipo, ref } = partirClave(c);
  const proyectos = filas(db, `SELECT id, nombre, tipo, actualizado_en FROM doc_proyecto
    WHERE archivado = 0 AND (proceso_clave = ? OR (? = 'cn' AND id_proceso = ?)) ORDER BY actualizado_en DESC`, [c, tipo, tipo === "cn" ? Number(ref) : -1]);
  const archivos = filas(db, "SELECT id, ruta, nombre, creado_en FROM mp_archivo WHERE clave = ? ORDER BY id DESC", [c])
    .map((a) => ({ ...a, existe: fs.existsSync(a.ruta) }));
  return {
    proceso: { ...proceso, fuenteNombre: fuenteDe(proceso.fuente).nombre },
    juzgado,
    propias,
    linea: lineaDeTiempo({ juzgado, propias }),
    audiencias: todas.filter((a) => a.estado === "activa"),
    sugerencias,
    proyectos,
    archivos,
    clientes: lista.clientes,
  };
}

// ---------- Actuaciones propias (lado del despacho) ----------

export function guardarPropia(db, dato = {}) {
  const clave = String(dato.clave || "");
  partirClave(clave);
  const tipo = TIPOS_PROPIA.some((t) => t.id === dato.tipo) ? dato.tipo : "nota";
  const fecha = fechaIso(dato.fecha) || hoyLocal();
  const cuerpo = largo(dato.texto);
  if (!cuerpo) throw new Aviso("Escriba qué pasó o qué falta.");
  const vence = fechaIso(dato.vence);
  const estado = dato.estado === "hecho" ? "hecho" : "pendiente";
  const marca = ahora();
  const valores = [tipo, fecha, cuerpo, vence, estado, Number(dato.proyecto_id) || null, Number(dato.archivo_id) || null, marca];
  if (dato.id) {
    run(db, "UPDATE mp_propia SET tipo = ?, fecha = ?, texto = ?, vence = ?, estado = ?, proyecto_id = ?, archivo_id = ?, actualizado_en = ? WHERE id = ?", [...valores, Number(dato.id)]);
    return Number(dato.id);
  }
  return Number(run(db, "INSERT INTO mp_propia (tipo, fecha, texto, vence, estado, proyecto_id, archivo_id, actualizado_en, clave, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [...valores, clave, marca]).lastInsertRowid);
}

export function marcarPropia(db, id, estado) {
  run(db, "UPDATE mp_propia SET estado = ?, actualizado_en = ? WHERE id = ?", [estado === "hecho" ? "hecho" : "pendiente", ahora(), Number(id)]);
}

export function borrarPropia(db, id) {
  run(db, "DELETE FROM mp_propia WHERE id = ?", [Number(id)]);
}

// ---------- Procesos manuales y actuaciones a mano ----------

export function guardarManual(db, dato = {}) {
  const valores = {
    radicado: texto(dato.radicado, 40),
    despacho: texto(dato.despacho, 300),
    demandante: texto(dato.demandante, 600),
    demandado: texto(dato.demandado, 600),
    clase: texto(dato.clase, 200),
    cliente: texto(dato.cliente, 300),
  };
  if (!valores.despacho && !valores.radicado && !valores.demandante && !valores.demandado) throw new Aviso("Escriba al menos el despacho o las partes.");
  const abogado = Number(dato.cliente_id) || null;
  const marca = ahora();
  if (dato.id) {
    run(db, `UPDATE mp_proceso SET radicado = ?, despacho = ?, demandante = ?, demandado = ?, clase = ?, cliente = ?, cliente_id = ?, actualizado_en = ? WHERE id = ?`,
      [...Object.values(valores), abogado, marca, Number(dato.id)]);
    return `ma:${Number(dato.id)}`;
  }
  const origen = dato.origen === "estados" ? "estados" : "manual";
  const id = run(db, `INSERT INTO mp_proceso (radicado, despacho, demandante, demandado, clase, cliente, cliente_id, origen, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...Object.values(valores), abogado, origen, marca, marca]).lastInsertRowid;
  return `ma:${Number(id)}`;
}

export function guardarActuacionManual(db, dato = {}) {
  const clave = String(dato.clave || "");
  if (partirClave(clave).tipo !== "ma") throw new Aviso("Las actuaciones a mano son solo para procesos manuales: las demás las trae su sistema.");
  const actuacion = texto(dato.actuacion, 600);
  if (!actuacion) throw new Aviso("Escriba la actuación.");
  const m = uno(db, "SELECT radicado FROM mp_proceso WHERE id = ?", [Number(clave.slice(3))]);
  return Number(run(db, `INSERT INTO mp_actuacion (clave, radicado, origen, fecha, actuacion, anotacion, creado_en) VALUES (?, ?, 'manual', ?, ?, ?, ?)`,
    [clave, String(m?.radicado || "").replace(/\D/g, ""), fechaIso(dato.fecha) || hoyLocal(), actuacion, largo(dato.anotacion, 4000), ahora()]).lastInsertRowid);
}

export function borrarActuacionManual(db, id) {
  run(db, "DELETE FROM mp_actuacion WHERE id = ? AND origen = 'manual'", [Number(id)]);
}

export function archivarProceso(db, clave, archivado) {
  partirClave(clave);
  run(db, "INSERT INTO mp_marca (clave, archivado) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET archivado = excluded.archivado", [clave, archivado ? 1 : 0]);
}

// Un proceso de estados (o manual) que ya está en otro sistema: lo propio
// pasa a ese proceso y las actuaciones del estado se quedan (salen por el
// radicado).
export function vincularProceso(db, claveManual, claveDestino) {
  const { tipo, ref } = partirClave(claveManual);
  partirClave(claveDestino);
  if (tipo !== "ma") throw new Aviso("Solo se vinculan procesos manuales o de estados.");
  transaccion(db, () => {
    for (const tabla of ["mp_propia", "mp_audiencia", "mp_actuacion"]) run(db, `UPDATE ${tabla} SET clave = ? WHERE clave = ?`, [claveDestino, claveManual]);
    run(db, "UPDATE OR IGNORE mp_archivo SET clave = ? WHERE clave = ?", [claveDestino, claveManual]);
    run(db, "UPDATE doc_proyecto SET proceso_clave = ? WHERE proceso_clave = ?", [claveDestino, claveManual]);
    run(db, "UPDATE mp_proceso SET vinculo = ?, actualizado_en = ? WHERE id = ?", [claveDestino, ahora(), Number(ref)]);
  });
}

// ---------- Estados del juzgado ----------

function claveDeRadicado(db, radicado) {
  const cn = uno(db, "SELECT id_proceso FROM proceso WHERE radicado = ? ORDER BY id_proceso LIMIT 1", [radicado]);
  if (cn) return `cn:${cn.id_proceso}`;
  const sa = uno(db, "SELECT guid FROM samai_caso WHERE radicado = ? LIMIT 1", [radicado]);
  if (sa) return `sa:${sa.guid}`;
  const ma = uno(db, "SELECT id, vinculo FROM mp_proceso WHERE radicado = ? ORDER BY id LIMIT 1", [radicado]);
  if (ma) return ma.vinculo || `ma:${ma.id}`;
  return "";
}

// Guarda las filas del estado como historia de sus procesos. Con crear,
// los radicados que no sigue nadie quedan como procesos de Estados; sin
// crear, solo se guardan las filas de los que ya sigue. Sin repetir
// radicado, fecha del auto y actuación.
export function guardarDesdeEstado(db, { filas: entrada = [], meta = {}, crear = false } = {}) {
  const registros = registrosDeEstado(entrada, meta);
  const r = { procesos: 0, nuevas: 0, repetidas: 0, claves: [] };
  transaccion(db, () => {
    for (const reg of registros) {
      let clave = claveDeRadicado(db, reg.radicado);
      if (!clave) {
        if (!crear) continue;
        const marca = ahora();
        const id = run(db, `INSERT INTO mp_proceso (origen, radicado, despacho, demandante, demandado, clase, creado_en, actualizado_en) VALUES ('estados', ?, ?, ?, ?, ?, ?, ?)`,
          [reg.radicado, reg.despacho, reg.demandante, reg.demandado, reg.clase, marca, marca]).lastInsertRowid;
        clave = `ma:${Number(id)}`;
        r.procesos += 1;
      }
      const hecho = run(db, `INSERT OR IGNORE INTO mp_actuacion (clave, radicado, origen, fecha, actuacion, anotacion, estado_no, fecha_estado, juzgado, firma, creado_en)
        VALUES (?, ?, 'estado', ?, ?, ?, ?, ?, ?, ?, ?)`, [clave, reg.radicado, reg.fechaAuto, reg.actuacion, reg.anotacion, reg.estadoNo, reg.fechaEstado, reg.juzgado, reg.firma, ahora()]);
      if (Number(hecho.changes)) r.nuevas += 1;
      else r.repetidas += 1;
      if (!r.claves.includes(clave)) r.claves.push(clave);
    }
  });
  return r;
}

// ---------- Audiencias ----------

export function guardarAudiencia(db, dato = {}) {
  const clave = String(dato.clave || "");
  partirClave(clave);
  const fecha = fechaIso(dato.fecha);
  if (!fecha) throw new Aviso("Elija la fecha de la audiencia.");
  const hora = /^\d{2}:\d{2}$/.test(String(dato.hora || "")) ? dato.hora : "";
  const modalidad = MODALIDADES.includes(dato.modalidad) ? dato.modalidad : "";
  const valores = [fecha, hora, modalidad, texto(dato.lugar, 600), largo(dato.notas, 2000)];
  if (dato.id) {
    run(db, "UPDATE mp_audiencia SET fecha = ?, hora = ?, modalidad = ?, lugar = ?, notas = ?, avisos = '' WHERE id = ?", [...valores, Number(dato.id)]);
    return Number(dato.id);
  }
  const ref = String(dato.ref || "");
  return Number(run(db, "INSERT INTO mp_audiencia (fecha, hora, modalidad, lugar, notas, clave, origen, ref, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [...valores, clave, ref ? "sugerida" : "manual", ref, ahora()]).lastInsertRowid);
}

export function borrarAudiencia(db, id) {
  run(db, "DELETE FROM mp_audiencia WHERE id = ?", [Number(id)]);
}

export function descartarSugerencia(db, { clave, fecha, hora = "", ref }) {
  partirClave(clave);
  run(db, "INSERT INTO mp_audiencia (clave, fecha, hora, origen, ref, estado, creado_en) VALUES (?, ?, ?, 'sugerida', ?, 'descartada', ?)",
    [clave, fechaIso(fecha) || "", hora || "", String(ref || refAudiencia(clave, fecha, hora)), ahora()]);
}

function conProceso(db, audiencias) {
  const procesos = new Map(listarMisProcesos(db).procesos.map((p) => [p.clave, p]));
  return audiencias.map((a) => {
    const p = procesos.get(a.clave);
    return { ...a, radicado: p?.radicado || "", despacho: p?.despacho || "", partes: [p?.demandante, p?.demandado].filter(Boolean).join(" contra ") };
  });
}

export function icsDe(db, ids = null) {
  let lista = listarAudiencias(db);
  if (Array.isArray(ids) && ids.length) lista = lista.filter((a) => ids.map(Number).includes(a.id));
  if (!lista.length) throw new Aviso("No hay audiencias para exportar.");
  return { ics: icsDeAudiencias(conProceso(db, lista)), total: lista.length };
}

// Los recordatorios que tocan ahora, ya marcados para no repetirlos.
export function tomarRecordatorios(db, ahoraMs = Date.now()) {
  const debidos = recordatoriosDebidos(listarAudiencias(db), ahoraMs);
  for (const d of debidos) run(db, "UPDATE mp_audiencia SET avisos = ? WHERE id = ?", [d.marcar, d.id]);
  return debidos.length ? conProceso(db, debidos.map((d) => ({ ...d.audiencia, cual: d.cual }))) : [];
}

// ---------- Archivos y proyectos ----------

export function agregarArchivos(db, clave, rutas = []) {
  partirClave(clave);
  let n = 0;
  for (const ruta of rutas.map(String).filter(Boolean).slice(0, 50)) {
    if (!fs.existsSync(ruta)) continue;
    n += Number(run(db, "INSERT OR IGNORE INTO mp_archivo (clave, ruta, nombre, creado_en) VALUES (?, ?, ?, ?)", [clave, ruta, path.basename(ruta), ahora()]).changes);
  }
  return n;
}

export function archivoDe(db, id) {
  const a = uno(db, "SELECT * FROM mp_archivo WHERE id = ?", [Number(id)]);
  if (!a) throw new Aviso("Ese archivo ya no está en la lista.");
  return a;
}

export function quitarArchivo(db, id) {
  run(db, "DELETE FROM mp_archivo WHERE id = ?", [Number(id)]);
}

// El proyecto de Documentos del proceso: el más reciente ligado a él o uno
// nuevo con su nombre.
export function proyectoDelProceso(db, clave) {
  const { tipo, ref } = partirClave(clave);
  const ya = uno(db, `SELECT id FROM doc_proyecto WHERE archivado = 0 AND (proceso_clave = ? OR (? = 'cn' AND id_proceso = ?)) ORDER BY actualizado_en DESC LIMIT 1`,
    [clave, tipo, tipo === "cn" ? Number(ref) : -1]);
  if (ya) return Number(ya.id);
  const p = listarMisProcesos(db).procesos.find((x) => x.clave === clave);
  const nombre = texto(`Proceso ${p?.radicado || p?.despacho || ""}`, 110) || "Proceso";
  const proyecto = crearProyecto(db, { nombre, id_proceso: tipo === "cn" ? Number(ref) : null });
  run(db, "UPDATE doc_proyecto SET proceso_clave = ? WHERE id = ?", [clave, proyecto.id]);
  return Number(proyecto.id);
}

// ---------- Excel ----------

const COLUMNAS_LISTA = [
  { titulo: "Fuente", campo: "fuenteCorto" },
  { titulo: "Radicado", campo: "radicado" },
  { titulo: "Despacho", campo: "despacho" },
  { titulo: "Clase", campo: "clase" },
  { titulo: "Demandante", campo: "demandante" },
  { titulo: "Demandado", campo: "demandado" },
  { titulo: "Cliente", campo: "cliente" },
  { titulo: "Abogado", campo: "abogado" },
  { titulo: "Última actuación", campo: "ultimaActuacion" },
  { titulo: "Fecha", campo: "ultimaFecha" },
  { titulo: "Días sin movimiento", campo: "diasSinMovimiento" },
];

export function excelDeLista(procesos) {
  const filasLibro = procesos.map((p) => COLUMNAS_LISTA.map((c) => (c.campo === "fuenteCorto" ? fuenteDe(p.fuente).corto : p[c.campo] ?? "")));
  return libroDeHojas([{ nombre: "Mis procesos", columnas: COLUMNAS_LISTA.map((c) => c.titulo), filas: filasLibro }]);
}

// ---------- Canales ----------

export function registrarMisProcesos({ ipcMain, dialog, shell, db, ventana, mensajeHumano, convertirDatos }) {
  const responder = async (fn) => {
    try {
      return { ok: true, ...(await fn()) };
    } catch (error) {
      return { ok: false, error: error instanceof Aviso ? error.message : mensajeHumano(error) };
    }
  };
  const canal = (nombre, fn) => ipcMain.handle(nombre, (_e, dato) => responder(() => fn(dato || {})));
  canal("mis-listar", () => listarMisProcesos(db()));
  canal("mis-detalle", (d) => detalleMisProcesos(db(), String(d.clave || "")));
  canal("mis-radicados", () => ({ radicados: radicadosSeguidos(db()) }));
  canal("mis-propia-guardar", (d) => ({ id: guardarPropia(db(), d) }));
  canal("mis-propia-marcar", (d) => (marcarPropia(db(), d.id, d.estado), {}));
  canal("mis-propia-borrar", (d) => (borrarPropia(db(), d.id), {}));
  canal("mis-manual-guardar", (d) => ({ clave: guardarManual(db(), d) }));
  canal("mis-actuacion-guardar", (d) => ({ id: guardarActuacionManual(db(), d) }));
  canal("mis-actuacion-borrar", (d) => (borrarActuacionManual(db(), d.id), {}));
  canal("mis-archivar", (d) => (archivarProceso(db(), String(d.clave || ""), Boolean(d.archivado)), {}));
  canal("mis-vincular", (d) => (vincularProceso(db(), String(d.clave || ""), String(d.destino || "")), {}));
  canal("mis-estados-guardar", (d) => guardarDesdeEstado(db(), { filas: Array.isArray(d.filas) ? d.filas : [], meta: d.meta || {}, crear: Boolean(d.crear) }));
  canal("mis-audiencia-guardar", (d) => ({ id: guardarAudiencia(db(), d) }));
  canal("mis-audiencia-borrar", (d) => (borrarAudiencia(db(), d.id), {}));
  canal("mis-sugerencia-descartar", (d) => (descartarSugerencia(db(), d), {}));
  canal("mis-ics", async (d) => {
    const { ics, total } = icsDe(db(), d.ids);
    const elegido = await dialog.showSaveDialog(ventana(), {
      title: "Exportar audiencias al calendario",
      defaultPath: total === 1 ? "audiencia.ics" : "audiencias.ics",
      filters: [{ name: "Calendario", extensions: ["ics"] }],
    });
    if (elegido.canceled || !elegido.filePath) return { cancelado: true };
    const ruta = elegido.filePath.toLowerCase().endsWith(".ics") ? elegido.filePath : `${elegido.filePath}.ics`;
    fs.writeFileSync(ruta, ics, "utf8");
    return { ruta, total };
  });
  canal("mis-exportar", async (d) => {
    const claves = new Set(Array.isArray(d.claves) ? d.claves : []);
    const procesos = listarMisProcesos(db()).procesos.filter((p) => !claves.size || claves.has(p.clave));
    if (!procesos.length) throw new Aviso("No hay procesos para exportar.");
    const elegido = await dialog.showSaveDialog(ventana(), { title: "Exportar a Excel", defaultPath: "mis-procesos.xls", filters: [{ name: "Excel", extensions: ["xls"] }] });
    if (elegido.canceled || !elegido.filePath) return { cancelado: true };
    const ruta = elegido.filePath.toLowerCase().endsWith(".xls") ? elegido.filePath : `${elegido.filePath}.xls`;
    fs.writeFileSync(ruta, excelDeLista(procesos), "utf8");
    return { ruta, total: procesos.length };
  });
  canal("mis-archivos-agregar", async (d) => {
    const clave = String(d.clave || "");
    let rutas = Array.isArray(d.rutas) ? d.rutas : null;
    if (!rutas) {
      const r = await dialog.showOpenDialog(ventana(), { title: "Agregar documentos al proceso", properties: ["openFile", "multiSelections"] });
      rutas = r.canceled ? [] : r.filePaths;
    }
    return { agregados: agregarArchivos(db(), clave, rutas) };
  });
  canal("mis-archivo-quitar", (d) => (quitarArchivo(db(), d.id), {}));
  canal("mis-archivo-abrir", async (d) => {
    const a = archivoDe(db(), d.id);
    if (d.carpeta) shell.showItemInFolder(a.ruta);
    else {
      const error = await shell.openPath(a.ruta);
      if (error) throw new Aviso("No pude abrir el archivo. Puede que lo hayan movido.");
    }
    return {};
  });
  // Usar con la IA: el archivo convertido en este computador entra al
  // contexto del proyecto de Documentos del proceso.
  canal("mis-archivo-ia", async (d) => {
    const a = archivoDe(db(), d.id);
    if (!convertirDatos) throw new Aviso("El conversor todavía no está listo.");
    if (!fs.existsSync(a.ruta)) throw new Aviso("Ese archivo ya no está en su lugar.");
    const proyectoId = proyectoDelProceso(db(), a.clave);
    const r = await convertirDatos({ datos: fs.readFileSync(a.ruta), nombre: a.nombre, meta: { herramienta: "mis-procesos" }, proyectoId });
    if (r.error || !r.archivo) throw new Aviso(r.error || "No pude convertirlo.");
    return { proyectoId, archivoId: r.archivo.id };
  });
  canal("mis-proyecto", (d) => ({ proyectoId: proyectoDelProceso(db(), String(d.clave || "")) }));
}
