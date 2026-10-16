import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ahora, nombreCliente, texto } from "../compartido/logica.js";
import { horariosOPredeterminados, validarHorarios } from "../compartido/horario.js";
import { BASE_SQL, COLUMNAS_PROCESO, MIGRACIONES } from "./schema.js";
import { costoAprox } from "./nube.js";

export class Aviso extends Error {}

function args(params) {
  return params.map((valor) => (valor === undefined ? null : valor));
}

function plano(fila) {
  if (!fila) return null;
  const salida = {};
  for (const [clave, valor] of Object.entries(fila)) {
    salida[clave] = typeof valor === "bigint" ? Number(valor) : valor;
  }
  return salida;
}

export function run(db, sql, params = []) {
  return db.prepare(sql).run(...args(params));
}

export function uno(db, sql, params = []) {
  return plano(db.prepare(sql).get(...args(params)));
}

export function filas(db, sql, params = []) {
  return db.prepare(sql).all(...args(params)).map((fila) => plano(fila));
}

export function transaccion(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultado = fn();
    db.exec("COMMIT");
    return resultado;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* la transacción ya estaba cerrada */
    }
    throw error;
  }
}

function columnas(db, tabla) {
  return new Set(filas(db, `PRAGMA table_info(${tabla})`).map((fila) => fila.name));
}

export function migrar(db) {
  db.exec(BASE_SQL);
  const existentes = columnas(db, "proceso");
  for (const columna of COLUMNAS_PROCESO) {
    if (!existentes.has(columna)) {
      db.exec(`ALTER TABLE proceso ADD COLUMN ${columna} TEXT`);
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migracion (
      version INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      aplicada_en TEXT NOT NULL
    );
  `);
  const actual = Number(uno(db, "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migracion").version);
  for (const migracion of MIGRACIONES) {
    if (migracion.version <= actual) continue;
    transaccion(db, () => {
      migracion.up(db);
      run(db, "INSERT INTO schema_migracion (version, nombre, aplicada_en) VALUES (?, ?, ?)", [
        migracion.version,
        migracion.nombre,
        ahora(),
      ]);
    });
  }
}

export function abrirBase(ruta) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 30000");
  db.exec("PRAGMA journal_mode = WAL");
  migrar(db);
  return db;
}

export function listarProcesos(db) {
  const procesos = filas(db, `
    SELECT
        p.id_proceso,
        p.radicado,
        p.despacho,
        p.departamento,
        p.tipo_proceso,
        p.clase_proceso,
        p.subclase_proceso,
        p.ubicacion,
        p.fecha_proceso,
        p.fecha_ultima_actuacion,
        (p.detalle_consultado_en IS NOT NULL) AS detalle_ok,
        (p.actuaciones_consultado_en IS NOT NULL) AS actuaciones_ok,
        (
            SELECT actuacion FROM actuacion a
            WHERE a.id_proceso = p.id_proceso
            ORDER BY fecha_actuacion DESC, consecutivo DESC
            LIMIT 1
        ) AS ultima_actuacion,
        (
            SELECT GROUP_CONCAT(nombre, ' · ')
            FROM sujeto s
            WHERE s.id_proceso = p.id_proceso AND s.rol_base = 'demandante'
        ) AS demandantes,
        (
            SELECT GROUP_CONCAT(nombre, ' · ')
            FROM sujeto s
            WHERE s.id_proceso = p.id_proceso AND s.rol_base = 'demandado'
        ) AS demandados,
        c.id AS cliente_id,
        c.nombre AS cliente_nombre,
        c.apellidos AS cliente_apellidos,
        pc.representado AS representado,
        pc.representado_rol AS representado_rol,
        0 AS sin_expediente
    FROM proceso p
    LEFT JOIN proceso_cliente pc ON pc.id_proceso = p.id_proceso
    LEFT JOIN cliente c ON c.id = pc.cliente_id
    ORDER BY p.fecha_ultima_actuacion DESC, p.radicado
  `);
  return procesos;
}

export function detalleProceso(db, idProceso) {
  const proceso = uno(db, `
    SELECT
        id_proceso, radicado, despacho, departamento, tipo_proceso, clase_proceso,
        subclase_proceso, ubicacion, es_privado, fecha_proceso, fecha_ultima_actuacion,
        actuaciones_consultado_en
    FROM proceso
    WHERE id_proceso = ?
  `, [idProceso]);
  if (!proceso) return null;
  proceso.sujetos = filas(db, `
    SELECT rol_base, nombre, identificacion, es_emplazado
    FROM sujeto
    WHERE id_proceso = ?
    ORDER BY rol_base, nombre
  `, [idProceso]);
  proceso.actuaciones = filas(db, `
    SELECT fecha_actuacion, actuacion, anotacion
    FROM actuacion
    WHERE id_proceso = ?
    ORDER BY fecha_actuacion DESC, consecutivo DESC
  `, [idProceso]);
  proceso.cliente = uno(db, `
    SELECT c.id, c.nombre, c.apellidos, c.cedula, c.tarjeta, c.telefonos, c.direccion, c.email,
           pc.representado, pc.representado_rol,
           pc.representado_cedula, pc.representado_direccion, pc.representado_telefono
    FROM proceso_cliente pc
    JOIN cliente c ON c.id = pc.cliente_id
    WHERE pc.id_proceso = ?
  `, [idProceso]);
  return proceso;
}

function limitar(valor, maximo, etiqueta) {
  if (valor && valor.length > maximo) throw new Aviso(`${etiqueta} es demasiado largo.`);
  return valor;
}

function exigirEntero(valor, etiqueta) {
  const numero = typeof valor === "bigint" ? Number(valor) : Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) throw new Aviso(`${etiqueta} no es válido.`);
  return numero;
}

export function leerPausaActualizar(db) {
  const fila = uno(db, "SELECT hasta FROM pausa_boton WHERE clave = ?", ["actualizar_todo"]);
  return fila?.hasta || null;
}

export function leerInformeRevision(db) {
  const fila = uno(db, "SELECT creado_en, total, exitosos, fallidos, detalle FROM informe_revision WHERE clave = ?", ["ultima"]);
  if (!fila) return null;
  let fallas = [];
  try {
    const parsed = JSON.parse(fila.detalle || "[]");
    if (Array.isArray(parsed)) fallas = parsed;
  } catch {
    fallas = [];
  }
  return {
    creadoEn: fila.creado_en,
    total: Number(fila.total) || 0,
    exitosos: Number(fila.exitosos) || 0,
    fallidos: Number(fila.fallidos) || 0,
    fallas,
  };
}

export function guardarInformeRevision(db, informe) {
  const fallas = (informe?.fallas || []).map((falla) => ({
    radicado: String(falla.radicado || ""),
    despacho: String(falla.despacho || ""),
    causa: String(falla.causa || ""),
  }));
  run(db, `
    INSERT INTO informe_revision (clave, creado_en, total, exitosos, fallidos, detalle)
    VALUES ('ultima', ?, ?, ?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET
      creado_en = excluded.creado_en,
      total = excluded.total,
      exitosos = excluded.exitosos,
      fallidos = excluded.fallidos,
      detalle = excluded.detalle
  `, [
    ahora(),
    Number(informe?.total) || 0,
    Number(informe?.exitosos) || 0,
    Number(informe?.fallidos) || 0,
    JSON.stringify(fallas),
  ]);
}

export function guardarPausaActualizar(db, hasta) {
  run(db, `
    INSERT INTO pausa_boton (clave, hasta) VALUES ('actualizar_todo', ?)
    ON CONFLICT(clave) DO UPDATE SET hasta = excluded.hasta
  `, [hasta]);
  return hasta;
}

export function listarClientes(db) {
  const lista = filas(db, `
    SELECT id, nombre, apellidos, cedula, tarjeta, telefonos, direccion, email
    FROM cliente
  `);
  lista.sort((a, b) => nombreCliente(a).localeCompare(nombreCliente(b), "es", { sensitivity: "base" }));
  return lista;
}

export function guardarCliente(db, datos) {
  const nombre = limitar(texto(datos?.nombre), 120, "El nombre");
  if (!nombre) throw new Aviso("El nombre es obligatorio.");
  const apellidos = limitar(texto(datos?.apellidos), 120, "Los apellidos");
  const cedula = limitar(texto(datos?.cedula), 40, "La cédula");
  const tarjeta = limitar(texto(datos?.tarjeta), 40, "La tarjeta profesional");
  const telefonos = limitar(texto(datos?.telefonos), 200, "Los teléfonos");
  const direccion = limitar(texto(datos?.direccion), 300, "La dirección");
  const email = limitar(texto(datos?.email), 200, "El correo");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Aviso("El correo no parece válido.");
  const momento = ahora();
  if (datos?.id) {
    const id = exigirEntero(datos.id, "El abogado");
    if (!uno(db, "SELECT id FROM cliente WHERE id = ?", [id])) throw new Aviso("Ese abogado no está.");
    run(db, `
      UPDATE cliente
      SET nombre = ?, apellidos = ?, cedula = ?, tarjeta = ?, telefonos = ?, direccion = ?, email = ?, actualizado_en = ?
      WHERE id = ?
    `, [nombre, apellidos, cedula, tarjeta, telefonos, direccion, email, momento, id]);
    return id;
  }
  const info = run(db, `
    INSERT INTO cliente (nombre, apellidos, cedula, tarjeta, telefonos, direccion, email, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [nombre, apellidos, cedula, tarjeta, telefonos, direccion, email, momento, momento]);
  return Number(info.lastInsertRowid);
}

export function borrarCliente(db, idCliente) {
  const id = exigirEntero(idCliente, "El abogado");
  const info = run(db, "DELETE FROM cliente WHERE id = ?", [id]);
  if (!Number(info.changes)) throw new Aviso("Ese abogado no está.");
}

export function borrarProceso(db, idProceso) {
  const id = exigirEntero(idProceso, "El expediente");
  if (!uno(db, "SELECT id_proceso FROM proceso WHERE id_proceso = ?", [id])) {
    throw new Aviso("Ese expediente no está.");
  }
  transaccion(db, () => {
    run(db, "DELETE FROM parte WHERE id_proceso = ?", [id]);
    run(db, "DELETE FROM sujeto WHERE id_proceso = ?", [id]);
    run(db, "DELETE FROM documento WHERE id_proceso = ?", [id]);
    run(db, "DELETE FROM actuacion WHERE id_proceso = ?", [id]);
    run(db, "DELETE FROM proceso_cliente WHERE id_proceso = ?", [id]);
    run(db, "DELETE FROM aviso WHERE id_proceso = ?", [id]);
    run(db, "DELETE FROM proceso WHERE id_proceso = ?", [id]);
  });
}

export function datosParaExcel(db, ids, dia) {
  const limpios = [];
  const vistos = new Set();
  for (const crudo of ids || []) {
    const numero = Number(crudo);
    if (!Number.isInteger(numero) || numero <= 0 || vistos.has(numero)) continue;
    vistos.add(numero);
    limpios.push(numero);
    if (limpios.length >= 5000) break;
  }
  if (!limpios.length) return { procesos: [], actuaciones: [] };
  const porId = new Map(listarProcesos(db).map((proceso) => [Number(proceso.id_proceso), proceso]));
  const procesos = limpios.map((id) => porId.get(id)).filter(Boolean);
  if (!procesos.length) return { procesos: [], actuaciones: [] };
  const marcas = procesos.map(() => "?").join(", ");
  const actuaciones = filas(db, `
    SELECT p.radicado, p.despacho, a.fecha_actuacion, a.actuacion, a.anotacion
    FROM actuacion a
    JOIN proceso p ON p.id_proceso = a.id_proceso
    WHERE a.id_proceso IN (${marcas})
      AND substr(a.fecha_actuacion, 1, 10) = ?
    ORDER BY p.radicado, a.consecutivo DESC
  `, [...procesos.map((proceso) => proceso.id_proceso), dia]);
  return { procesos, actuaciones };
}

function actuacionPublica(fila) {
  return {
    fecha: fila.fecha_actuacion,
    actuacion: fila.actuacion,
    anotacion: fila.anotacion,
  };
}

export function informesDelDia(db, dia) {
  const marca = String(dia || "").slice(0, 10);
  const procesos = listarProcesos(db).filter((proceso) => proceso.cliente_id);
  const ids = [...new Set(procesos.map((proceso) => Number(proceso.id_proceso)))];
  const porProceso = new Map();
  if (ids.length) {
    const marcas = ids.map(() => "?").join(", ");
    const actos = filas(db, `
      SELECT id_proceso, fecha_actuacion, actuacion, anotacion, consecutivo
      FROM actuacion
      WHERE id_proceso IN (${marcas})
      ORDER BY fecha_actuacion DESC, consecutivo DESC
    `, ids);
    for (const acto of actos) {
      const id = Number(acto.id_proceso);
      const lista = porProceso.get(id) || [];
      lista.push(acto);
      porProceso.set(id, lista);
    }
  }
  const porCliente = new Map();
  for (const proceso of procesos) {
    const todas = porProceso.get(Number(proceso.id_proceso)) || [];
    const deHoy = todas
      .filter((acto) => String(acto.fecha_actuacion || "").slice(0, 10) === marca)
      .map(actuacionPublica);
    const primera = todas[0];
    const ficha = {
      radicado: proceso.radicado,
      despacho: proceso.despacho,
      tipo: proceso.tipo_proceso,
      clase: proceso.clase_proceso,
      demandantes: proceso.demandantes,
      demandados: proceso.demandados,
      deHoy,
      ultima: deHoy.length || !primera ? null : actuacionPublica(primera),
    };
    const idCliente = Number(proceso.cliente_id);
    const lista = porCliente.get(idCliente) || [];
    lista.push(ficha);
    porCliente.set(idCliente, lista);
  }
  return listarClientes(db)
    .map((cliente) => ({
      cliente: {
        nombre: cliente.nombre,
        apellidos: cliente.apellidos,
        cedula: cliente.cedula,
        tarjeta: cliente.tarjeta,
        telefonos: cliente.telefonos,
        direccion: cliente.direccion,
        email: cliente.email,
      },
      procesos: porCliente.get(Number(cliente.id)) || [],
    }))
    .filter((informe) => informe.procesos.length);
}

export function asignarCliente(db, idProceso, clienteId) {
  const proceso = exigirEntero(idProceso, "El expediente");
  if (!uno(db, "SELECT id_proceso FROM proceso WHERE id_proceso = ?", [proceso])) {
    throw new Aviso("Ese expediente no está en la base.");
  }
  if (clienteId == null || clienteId === "" || clienteId === "sin") {
    run(db, "DELETE FROM proceso_cliente WHERE id_proceso = ?", [proceso]);
    return;
  }
  const cliente = exigirEntero(clienteId, "El abogado");
  if (!uno(db, "SELECT id FROM cliente WHERE id = ?", [cliente])) throw new Aviso("Ese abogado no está.");
  run(db, `
    INSERT INTO proceso_cliente (id_proceso, cliente_id, asignado_en)
    VALUES (?, ?, ?)
    ON CONFLICT(id_proceso) DO UPDATE SET
      cliente_id = excluded.cliente_id,
      asignado_en = excluded.asignado_en
  `, [proceso, cliente, ahora()]);
}

const ROLES_REPRESENTADO = new Set(["demandante", "demandado", "defensor", "curador", "otro"]);

export function guardarRepresentado(db, idProceso, dato = {}) {
  const proceso = exigirEntero(idProceso, "El expediente");
  if (!uno(db, "SELECT id_proceso FROM proceso_cliente WHERE id_proceso = ?", [proceso])) {
    throw new Aviso("Asigne un abogado antes de indicar a quién representa.");
  }
  const nombre = limitar(texto(dato?.texto ?? dato?.representado), 200, "El representado");
  const rol = texto(dato?.rol);
  const rolLimpio = rol && ROLES_REPRESENTADO.has(rol) ? rol : null;
  const cedula = nombre ? limitar(texto(dato?.cedula), 40, "La cédula") : null;
  const direccion = nombre ? limitar(texto(dato?.direccion), 300, "La dirección") : null;
  const telefono = nombre ? limitar(texto(dato?.telefono), 80, "El teléfono") : null;
  run(db, `
    UPDATE proceso_cliente
    SET representado = ?, representado_rol = ?,
        representado_cedula = ?, representado_direccion = ?, representado_telefono = ?
    WHERE id_proceso = ?
  `, [nombre, nombre ? rolLimpio : null, cedula, direccion, telefono, proceso]);
}

export function leerAjuste(db, clave) {
  const fila = uno(db, "SELECT valor FROM ajuste WHERE clave = ?", [clave]);
  return fila ? fila.valor : null;
}

export function guardarAjuste(db, clave, valor) {
  run(db, `
    INSERT INTO ajuste (clave, valor) VALUES (?, ?)
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
  `, [clave, String(valor)]);
}

export function leerHorarios(db) {
  let lista = null;
  try {
    lista = JSON.parse(leerAjuste(db, "horarios_revision") || "null");
  } catch {
    lista = null;
  }
  return horariosOPredeterminados(lista);
}

export function guardarHorarios(db, lista) {
  const validos = validarHorarios(lista);
  if (!validos.ok) throw new Aviso(validos.error);
  guardarAjuste(db, "horarios_revision", JSON.stringify(validos.horas));
  return validos.horas;
}

export function leerUltimoTurno(db) {
  return leerAjuste(db, "ultimo_turno");
}

export function guardarUltimoTurno(db, turno) {
  if (turno) guardarAjuste(db, "ultimo_turno", turno);
}

export function leerInicioSesion(db) {
  return leerAjuste(db, "inicio_sesion") !== "0";
}

export function guardarInicioSesion(db, activo) {
  guardarAjuste(db, "inicio_sesion", activo ? "1" : "0");
}

export function iniciarRevision(db, { origen, turno = null, inicio = ahora() }) {
  const info = run(db, `
    INSERT INTO revision (origen, turno, inicio, estado) VALUES (?, ?, ?, 'corriendo')
  `, [origen, turno, inicio]);
  return Number(info.lastInsertRowid);
}

export function terminarRevision(db, id, { fin = ahora(), revisados = 0, cambiados = 0, cambios = 0, errores = 0, error = null }) {
  run(db, `
    UPDATE revision SET
      fin = ?, estado = ?, revisados = ?, cambiados = ?, cambios = ?, errores = ?, error = ?
    WHERE id = ?
  `, [fin, error ? "fallo" : "lista", revisados, cambiados, cambios, errores, error, id]);
}

export function cerrarRevisionesColgadas(db) {
  run(db, "UPDATE revision SET estado = 'interrumpida' WHERE estado = 'corriendo'");
}

export function ultimaRevision(db, origenes = ["automatica", "bandeja"]) {
  const marcas = origenes.map(() => "?").join(", ");
  return uno(db, `
    SELECT id, origen, turno, inicio, fin, estado, revisados, cambiados, cambios, errores, error
    FROM revision
    WHERE origen IN (${marcas}) AND estado <> 'corriendo'
    ORDER BY id DESC
    LIMIT 1
  `, origenes);
}

export function ultimoAvisoId(db) {
  return Number(uno(db, "SELECT COALESCE(MAX(id), 0) AS id FROM aviso").id);
}

export function avisosDesde(db, idBase) {
  return filas(db, `
    SELECT a.id, a.id_proceso, COALESCE(a.radicado, p.radicado) AS radicado, a.tipo, a.resumen,
           c.nombre AS cliente_nombre, c.apellidos AS cliente_apellidos
    FROM aviso a
    LEFT JOIN proceso p ON p.id_proceso = a.id_proceso
    LEFT JOIN proceso_cliente pc ON pc.id_proceso = a.id_proceso
    LEFT JOIN cliente c ON c.id = pc.cliente_id
    WHERE a.id > ?
    ORDER BY a.id
  `, [idBase]);
}

export function ppCatalogoVacio(db) {
  return Number(uno(db, "SELECT COUNT(*) AS n FROM pp_despacho").n) === 0;
}

export function sembrarPpCatalogo(db, catalogo) {
  transaccion(db, () => {
    for (const d of catalogo?.deptos || []) {
      run(db, "INSERT OR IGNORE INTO pp_departamento (codigo, nombre) VALUES (?, ?)", [d.codigo, d.nombre]);
    }
    for (const m of catalogo?.munis || []) {
      run(db, "INSERT OR IGNORE INTO pp_municipio (codigo, nombre, depto) VALUES (?, ?, ?)", [
        m.codigo, m.nombre, String(m.codigo).slice(0, 2),
      ]);
    }
    for (const d of catalogo?.despachos || []) {
      run(db, "INSERT OR IGNORE INTO pp_despacho (codigo, nombre, depto, muni) VALUES (?, ?, ?, ?)", [
        d.codigo, d.nombre, d.depto, d.muni,
      ]);
    }
  });
}

export function ppDeptos(db) {
  return filas(db, "SELECT codigo, nombre FROM pp_departamento ORDER BY nombre");
}

export function ppMunicipios(db, depto) {
  return filas(db, `SELECT m.codigo, m.nombre, COUNT(d.codigo) AS despachos
    FROM pp_municipio m LEFT JOIN pp_despacho d ON d.muni = m.codigo AND d.depto = ?
    WHERE m.codigo LIKE ? GROUP BY m.codigo HAVING despachos > 0 ORDER BY m.nombre`, [depto, `${depto}%`]);
}

export function ppDespachos(db, depto, muni, texto = "", limite = 2000) {
  const params = [depto, muni];
  let filtro = "";
  if (String(texto || "").trim()) {
    filtro = "AND (d.codigo LIKE ? OR d.nombre LIKE ?)";
    params.push(`%${texto.trim()}%`, `%${texto.trim()}%`);
  }
  params.push(limite);
  return filas(db, `SELECT d.codigo, d.nombre,
      COALESCE(c.estado, '') AS estado, COALESCE(c.avisos, 0) AS avisos
    FROM pp_despacho d LEFT JOIN pp_carga c ON c.despacho = d.codigo
    WHERE d.depto = ? AND d.muni = ? ${filtro} ORDER BY d.nombre LIMIT ?`, params);
}

export function ppCargados(db) {
  return filas(db, `SELECT c.despacho AS codigo, d.nombre,
      COALESCE(d2.nombre, '') AS depto, c.total, c.avisos,
      (SELECT COUNT(*) FROM pp_documento doc JOIN pp_publicacion p ON p.id = doc.publicacion WHERE p.despacho = c.despacho) AS docs,
      c.actualizada, c.estado
    FROM pp_carga c JOIN pp_despacho d ON d.codigo = c.despacho
    LEFT JOIN pp_departamento d2 ON d2.codigo = d.depto
    ORDER BY c.actualizada DESC`);
}

export function ppPublicaciones(db, despacho) {
  return filas(db, `SELECT p.id, p.titulo, p.fecha, p.url, p.detalle_url, p.tipo,
      (SELECT COUNT(*) FROM pp_documento WHERE publicacion = p.id) AS docs
    FROM pp_publicacion p WHERE p.despacho = ? ORDER BY p.fecha DESC, p.id DESC`, [despacho]);
}

export function ppDocumentos(db, publicacion) {
  return filas(db, "SELECT nombre, url, fecha FROM pp_documento WHERE publicacion = ? ORDER BY id", [publicacion]);
}

export function ppOlvidar(db, despacho) {
  transaccion(db, () => {
    run(db, "DELETE FROM pp_documento WHERE publicacion IN (SELECT id FROM pp_publicacion WHERE despacho = ?)", [despacho]);
    run(db, "DELETE FROM pp_publicacion WHERE despacho = ?", [despacho]);
    run(db, "DELETE FROM pp_carga WHERE despacho = ?", [despacho]);
  });
}

export function guardarSpCaso(db, registro) {
  return transaccion(db, () => {
    run(db, `INSERT INTO spoa_caso (noticia, caso_id, despacho, unidad, seccional, direccion,
        telefono, depto_unidad, muni_unidad, fecha_asignacion, estado, etapa, ley, correo,
        depto_hecho, muni_hecho, fecha_hechos, delitos, reservado, conexado, actualizada)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(noticia) DO UPDATE SET caso_id = excluded.caso_id, despacho = excluded.despacho,
        unidad = excluded.unidad, seccional = excluded.seccional, direccion = excluded.direccion,
        telefono = excluded.telefono, depto_unidad = excluded.depto_unidad, muni_unidad = excluded.muni_unidad,
        fecha_asignacion = excluded.fecha_asignacion, estado = excluded.estado, etapa = excluded.etapa,
        ley = excluded.ley, correo = excluded.correo, depto_hecho = excluded.depto_hecho,
        muni_hecho = excluded.muni_hecho, fecha_hechos = excluded.fecha_hechos, delitos = excluded.delitos,
        reservado = excluded.reservado, conexado = excluded.conexado, actualizada = excluded.actualizada`, [
      registro.noticia || "", registro.caso_id || "", registro.despacho || "",
      registro.unidad?.descripcion || "", registro.unidad?.seccional || "",
      registro.unidad?.direccion || "", registro.unidad?.telefono || "",
      registro.unidad?.depto || "", registro.unidad?.muni || "",
      registro.fecha_asignacion || "", registro.estado || "", registro.etapa || "",
      registro.ley || "", registro.correo || "", registro.hechos?.depto || "",
      registro.hechos?.muni || "", registro.hechos?.fecha || "",
      (registro.delitos || []).join(" # "), registro.reservado || "", registro.conexado || "",
    ]);
    let nuevas = 0;
    for (const a of registro.actuaciones || []) {
      const r = run(db, "INSERT OR IGNORE INTO spoa_actuacion (noticia, fecha, descripcion) VALUES (?, ?, ?)", [
        registro.noticia || "", a.fecha || "", a.descripcion || "",
      ]);
      nuevas += Number(r.changes || 0);
    }
    return nuevas;
  });
}

export function spoaCasos(db) {
  return filas(db, `SELECT c.noticia, c.despacho, c.estado, c.etapa, c.actualizada,
      (SELECT COUNT(*) FROM spoa_actuacion WHERE noticia = c.noticia) AS actuaciones
    FROM spoa_caso c ORDER BY c.actualizada DESC`);
}

export function spoaCaso(db, noticia) {
  const caso = uno(db, "SELECT * FROM spoa_caso WHERE noticia = ?", [noticia]);
  if (!caso) return null;
  return {
    ...caso,
    delitos: String(caso.delitos || "").split(" # ").filter(Boolean),
    actuaciones: filas(db, "SELECT fecha, descripcion FROM spoa_actuacion WHERE noticia = ? ORDER BY id", [noticia]),
  };
}

export function spoaOlvidar(db, noticia) {
  transaccion(db, () => {
    run(db, "DELETE FROM spoa_actuacion WHERE noticia = ?", [noticia]);
    run(db, "DELETE FROM spoa_caso WHERE noticia = ?", [noticia]);
  });
}

export function guardarSamaiCaso(db, proceso) {
  return transaccion(db, () => {
    run(db, `INSERT INTO samai_caso (guid, radicado, corporacion, ponente, despacho,
        despacho_lindo, titular, clase, fecha_ingreso, vigente, asunto, demandante,
        demandado, url_detalle, actualizada)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(guid) DO UPDATE SET radicado = excluded.radicado, corporacion = excluded.corporacion,
        ponente = excluded.ponente, despacho = excluded.despacho, despacho_lindo = excluded.despacho_lindo,
        titular = excluded.titular, clase = excluded.clase, fecha_ingreso = excluded.fecha_ingreso,
        vigente = excluded.vigente, asunto = excluded.asunto, demandante = excluded.demandante,
        demandado = excluded.demandado, url_detalle = excluded.url_detalle, actualizada = excluded.actualizada`, [
      proceso.guid || "", proceso.radicado || "", proceso.corporacion || "", proceso.ponente || "",
      proceso.despacho || "", proceso.despacho_lindo || "", proceso.titular || "", proceso.clase || "",
      proceso.fecha_ingreso || "", proceso.vigente || "", proceso.asunto || "",
      proceso.demandante || "", proceso.demandado || "", proceso.url_detalle || "",
    ]);
    let nuevas = 0;
    for (const a of proceso.actuaciones || []) {
      const r = run(db, `INSERT OR IGNORE INTO samai_actuacion
        (guid, fecha_registro, fecha, actuacion, anotacion, estado, anexos, indice)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        proceso.guid || "", a.fecha_registro || "", a.fecha || "", a.actuacion || "",
        a.anotacion || "", a.estado || "", a.anexos || "", a.indice || "",
      ]);
      nuevas += Number(r.changes || 0);
    }
    return nuevas;
  });
}

export function samaiCasos(db) {
  return filas(db, `SELECT c.guid, c.radicado, c.clase, c.despacho, c.demandante, c.demandado,
      c.actualizada,
      (SELECT COUNT(*) FROM samai_actuacion WHERE guid = c.guid) AS actuaciones
    FROM samai_caso c ORDER BY c.actualizada DESC`);
}

export function samaiCaso(db, guid) {
  const caso = uno(db, "SELECT * FROM samai_caso WHERE guid = ?", [guid]);
  if (!caso) return null;
  return {
    ...caso,
    actuaciones: filas(db, "SELECT fecha_registro, fecha, actuacion, anotacion, estado, anexos, indice FROM samai_actuacion WHERE guid = ? ORDER BY id", [guid]),
  };
}

export function samaiOlvidar(db, guid) {
  transaccion(db, () => {
    run(db, "DELETE FROM samai_actuacion WHERE guid = ?", [guid]);
    run(db, "DELETE FROM samai_caso WHERE guid = ?", [guid]);
  });
}

export const FRECUENCIAS_SISTEMAS = [0, 12, 24, 48];

export function leerFrecuenciaSistemas(db) {
  const crudo = leerAjuste(db, "revision_sistemas_horas") ?? leerAjuste(db, "pp_frecuencia_horas");
  if (crudo === null || crudo === "") return 24;
  const horas = Number(crudo);
  return FRECUENCIAS_SISTEMAS.includes(horas) ? horas : 24;
}

export function guardarFrecuenciaSistemas(db, horas) {
  const n = Number(horas);
  if (!FRECUENCIAS_SISTEMAS.includes(n)) throw new Error("Frecuencia no válida.");
  guardarAjuste(db, "revision_sistemas_horas", String(n));
  return n;
}

export function guardarGasto(db, { proveedor = "", modelo = "", motivo = "", proyectoId = null, entrada = 0, salida = 0, costo = null }) {
  const e = Math.max(0, Math.round(Number(entrada) || 0));
  const s = Math.max(0, Math.round(Number(salida) || 0));
  if (e <= 0 && s <= 0) return;
  run(db, `INSERT INTO gasto_nube (fecha, proveedor, modelo, motivo, proyecto_id, entrada, salida, costo_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    ahora(), proveedor, modelo, motivo, proyectoId, e, s,
    costo == null ? 0 : Number(costo),
  ]);
}

export function resumenGastos(db, { desde = "", limite = 30 } = {}) {
  const filtro = desde ? "WHERE fecha >= ?" : "";
  const params = desde ? [desde] : [];
  const totales = uno(db, `SELECT COUNT(*) AS llamadas, COALESCE(SUM(entrada), 0) AS entrada,
    COALESCE(SUM(salida), 0) AS salida, COALESCE(SUM(costo_usd), 0) AS costo FROM gasto_nube ${filtro}`, params);
  const porProveedor = filas(db, `SELECT proveedor, modelo, COUNT(*) AS llamadas,
    COALESCE(SUM(entrada), 0) AS entrada, COALESCE(SUM(salida), 0) AS salida,
    COALESCE(SUM(costo_usd), 0) AS costo FROM gasto_nube ${filtro}
    GROUP BY proveedor, modelo ORDER BY costo DESC`, params);
  const condProyecto = ["proyecto_id IS NOT NULL", ...(desde ? ["fecha >= ?"] : [])].join(" AND ");
  const paramsProyecto = desde ? [desde] : [];
  const porProyecto = filas(db, `SELECT proyecto_id AS proyecto, COUNT(*) AS llamadas,
    COALESCE(SUM(entrada), 0) AS entrada, COALESCE(SUM(salida), 0) AS salida,
    COALESCE(SUM(costo_usd), 0) AS costo FROM gasto_nube
    WHERE ${condProyecto} GROUP BY proyecto_id ORDER BY costo DESC`, paramsProyecto);
  const recientes = filas(db, `SELECT fecha, proveedor, modelo, motivo, proyecto_id AS proyecto,
    entrada, salida, costo_usd AS costo FROM gasto_nube ${filtro}
    ORDER BY id DESC LIMIT ?`, [...params, limite]);
  return { totales, porProveedor, porProyecto, recientes };
}

export function guardarUso(db, { proveedor = "", modelo = "", motivo = "", proyectoId = null, entrada = 0, salida = 0 }) {
  const e = Math.max(0, Math.round(Number(entrada) || 0));
  const s = Math.max(0, Math.round(Number(salida) || 0));
  if (e <= 0 && s <= 0) return;
  const costo = costoAprox(modelo, e, s) ?? 0;
  guardarGasto(db, { proveedor, modelo, motivo, proyectoId, entrada: e, salida: s, costo });
}

export function ultimoGasto(db, proyectoId) {
  return uno(db, `SELECT fecha, proveedor, modelo, motivo, entrada, salida, costo_usd AS costo
    FROM gasto_nube WHERE proyecto_id = ? ORDER BY id DESC LIMIT 1`, [proyectoId]);
}
