import fs from "node:fs";
import path from "node:path";
import { ahora, fecha, texto } from "../compartido/logica.js";
import { columna, parsearJuzgados, parsearRadicados, tablaCsv } from "./csv.js";
import { filas, run, uno } from "./db.js";

export function bitacoraEn(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ejecucion = path.join(dir, "ejecucion.log");
  const avisos = path.join(dir, "avisos.log");
  const lineas = [];
  return {
    lineas,
    log(msg) {
      const linea = `[${ahora()}] ${msg}`;
      lineas.push(linea);
      fs.appendFileSync(ejecucion, `${linea}\n`, "utf8");
      return linea;
    },
    aviso(linea) {
      fs.appendFileSync(avisos, `${linea}\n`, "utf8");
    },
  };
}

export function rolBase(rol) {
  const nombre = String(rol || "").toLowerCase();
  if (nombre.includes("demandante") || nombre.includes("accionante")) return "demandante";
  if (nombre.includes("demandado") || nombre.includes("indiciado") || nombre.includes("causante")) return "demandado";
  if (nombre.includes("defensor")) return "defensor";
  if (nombre.includes("curador")) return "curador";
  return "otro";
}

export function parsearPartes(sujetos) {
  const crudo = String(sujetos || "").replaceAll("\r", " ").replaceAll("\n", " ").replaceAll("\t", " ");
  const partes = [];
  for (const trozo of crudo.split("|")) {
    const limpio = texto(trozo);
    if (!limpio || !limpio.includes(":")) continue;
    const corte = limpio.indexOf(":");
    const rol = texto(limpio.slice(0, corte));
    const nombre = texto(limpio.slice(corte + 1));
    if (rol && nombre) partes.push({ rol, base: rolBase(rol), nombre });
  }
  return partes;
}

function reemplazarPartes(db, idProceso, sujetos) {
  run(db, "DELETE FROM parte WHERE id_proceso = ?", [idProceso]);
  parsearPartes(sujetos).forEach((parte, indice) => {
    run(db, `
      INSERT INTO parte (id_proceso, orden, rol, rol_base, nombre)
      VALUES (?, ?, ?, ?, ?)
    `, [idProceso, indice + 1, parte.rol, parte.base, parte.nombre]);
  });
}

export function asegurarRadicado(db, numero) {
  run(db, "INSERT OR IGNORE INTO radicado (numero) VALUES (?)", [numero]);
}

export function guardarProcesoConsulta(db, numero, proc) {
  if (proc?.idProceso == null) return null;
  const idProceso = Number(proc.idProceso);
  const sujetos = texto(proc.sujetosProcesales);
  run(db, `
    INSERT INTO proceso (
      id_proceso, radicado, id_conexion, fecha_proceso, fecha_ultima_actuacion,
      despacho, departamento, es_privado, sujetos
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id_proceso) DO UPDATE SET
      radicado = excluded.radicado,
      id_conexion = excluded.id_conexion,
      fecha_proceso = excluded.fecha_proceso,
      fecha_ultima_actuacion = excluded.fecha_ultima_actuacion,
      despacho = excluded.despacho,
      departamento = excluded.departamento,
      es_privado = excluded.es_privado,
      sujetos = excluded.sujetos
  `, [
    idProceso,
    numero,
    proc.idConexion ?? null,
    fecha(proc.fechaProceso),
    fecha(proc.fechaUltimaActuacion),
    texto(proc.despacho),
    texto(proc.departamento),
    proc.esPrivado ? 1 : 0,
    sujetos,
  ]);
  reemplazarPartes(db, idProceso, sujetos);
  return idProceso;
}

export function guardarConsulta(db, numero, paginas) {
  const procesos = [];
  let cantidad = 0;
  for (const pagina of paginas) {
    const lista = Array.isArray(pagina?.procesos) ? pagina.procesos : [];
    for (const item of lista) {
      if (item && typeof item === "object") procesos.push(item);
    }
    const registros = pagina?.paginacion?.cantidadRegistros;
    if (registros != null) cantidad = Number(registros);
  }
  run(db, `
    INSERT INTO radicado (numero, cantidad_registros, consultado_en)
    VALUES (?, ?, ?)
    ON CONFLICT(numero) DO UPDATE SET
      cantidad_registros = excluded.cantidad_registros,
      consultado_en = excluded.consultado_en
  `, [numero, cantidad, ahora()]);
  const ids = [];
  for (const proc of procesos) {
    const idProceso = guardarProcesoConsulta(db, numero, proc);
    if (idProceso != null) ids.push(idProceso);
  }
  return ids;
}

export function guardarDetalle(db, idProceso, data) {
  let radicado = texto(data?.llaveProceso);
  if (radicado) asegurarRadicado(db, radicado);
  const existe = uno(db, "SELECT radicado FROM proceso WHERE id_proceso = ?", [idProceso]);
  if (!existe) {
    if (!radicado) throw new Error(`detalle ${idProceso} sin radicado y sin consulta previa`);
    run(db, "INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (?, ?, 0)", [idProceso, radicado]);
  } else if (!radicado) {
    radicado = existe.radicado;
  }
  run(db, `
    UPDATE proceso SET
      id_reg_proceso = ?,
      radicado = ?,
      id_conexion = COALESCE(?, id_conexion),
      fecha_proceso = COALESCE(?, fecha_proceso),
      despacho = COALESCE(?, despacho),
      codigo_despacho = ?,
      ponente = ?,
      tipo_proceso = ?,
      clase_proceso = ?,
      subclase_proceso = ?,
      recurso = ?,
      ubicacion = ?,
      contenido_radicacion = ?,
      es_privado = ?,
      ultima_actualizacion = ?,
      detalle_consultado_en = ?
    WHERE id_proceso = ?
  `, [
    data?.idRegProceso ?? null,
    radicado,
    data?.idConexion ?? null,
    fecha(data?.fechaProceso),
    texto(data?.despacho),
    texto(data?.codDespachoCompleto),
    texto(data?.ponente),
    texto(data?.tipoProceso),
    texto(data?.claseProceso),
    texto(data?.subclaseProceso),
    texto(data?.recurso),
    texto(data?.ubicacion),
    texto(data?.contenidoRadicacion),
    data?.esPrivado ? 1 : 0,
    texto(data?.ultimaActualizacion),
    ahora(),
    idProceso,
  ]);
}

export function firmaSujeto(fila) {
  return [
    texto(fila?.tipo_sujeto),
    texto(fila?.rol_base),
    Number(fila?.es_emplazado || 0),
    texto(fila?.identificacion),
    texto(fila?.nombre),
  ];
}

export function firmaActuacion(fila) {
  return [
    fila?.consecutivo ?? null,
    fila?.fecha_actuacion ?? null,
    texto(fila?.actuacion),
    texto(fila?.anotacion),
    fila?.fecha_inicial ?? null,
    fila?.fecha_final ?? null,
    fila?.fecha_registro ?? null,
    texto(fila?.cod_regla),
    Number(fila?.con_documentos || 0),
  ];
}

export function prepararSujeto(item) {
  if (item?.idRegSujeto == null) return null;
  const tipo = texto(item.tipoSujeto) || "otro";
  return {
    id_reg_sujeto: Number(item.idRegSujeto),
    tipo_sujeto: tipo,
    rol_base: rolBase(tipo),
    es_emplazado: item.esEmplazado ? 1 : 0,
    identificacion: texto(item.identificacion),
    nombre: texto(item.nombreRazonSocial),
  };
}

export function prepararActuacion(item, idProceso) {
  if (item?.idRegActuacion == null) return null;
  return {
    id_reg_actuacion: Number(item.idRegActuacion),
    id_proceso: idProceso,
    radicado: texto(item.llaveProceso),
    consecutivo: item.consActuacion ?? null,
    fecha_actuacion: fecha(item.fechaActuacion),
    actuacion: texto(item.actuacion),
    anotacion: texto(item.anotacion),
    fecha_inicial: fecha(item.fechaInicial),
    fecha_final: fecha(item.fechaFinal),
    fecha_registro: fecha(item.fechaRegistro),
    cod_regla: texto(item.codRegla),
    con_documentos: item.conDocumentos ? 1 : 0,
  };
}

function jsonOrdenado(valor) {
  if (Array.isArray(valor)) return `[${valor.map(jsonOrdenado).join(",")}]`;
  if (valor && typeof valor === "object") {
    const claves = Object.keys(valor).sort();
    return `{${claves.map((clave) => `${JSON.stringify(clave)}:${jsonOrdenado(valor[clave])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

export function prepararDocumento(item) {
  const conocidos = {
    idRegDocumento: "id_reg_documento",
    idDocumento: "id_reg_documento",
    nombre: "nombre",
    nombreArchivo: "nombre",
    descripcion: "descripcion",
    description: "descripcion",
    Description: "descripcion",
    fechaCarga: "fecha_carga",
    fecha: "fecha_carga",
    tipo: "tipo",
    href: "enlace",
    url: "enlace",
  };
  const salida = {
    id_reg_documento: null,
    nombre: null,
    descripcion: null,
    fecha_carga: null,
    tipo: null,
    enlace: null,
  };
  const usados = new Set();
  for (const [origen, destino] of Object.entries(conocidos)) {
    if (!(origen in item) || item[origen] == null || salida[destino] != null) continue;
    let valor = item[origen];
    if (destino === "id_reg_documento") {
      const numero = Number(valor);
      if (!Number.isInteger(numero)) continue;
      valor = numero;
    } else if (destino === "fecha_carga") {
      valor = fecha(valor);
    } else {
      valor = texto(valor);
    }
    salida[destino] = valor;
    usados.add(origen);
  }
  const extra = {};
  for (const [clave, valor] of Object.entries(item)) {
    if (!usados.has(clave) && !(clave in conocidos) && clave !== "cant") extra[clave] = valor;
  }
  salida.extra = Object.keys(extra).length ? jsonOrdenado(extra) : null;
  if (salida.id_reg_documento != null) salida.clave = `id:${salida.id_reg_documento}`;
  else {
    salida.clave = `txt:${[salida.nombre || "", salida.descripcion || "", salida.fecha_carga || "", salida.extra || ""].join("|")}`;
  }
  return salida;
}

export function firmaDocumento(fila) {
  return [
    fila?.id_reg_documento ?? null,
    texto(fila?.nombre),
    texto(fila?.descripcion),
    fila?.fecha_carga ?? null,
    texto(fila?.tipo),
    texto(fila?.enlace),
    texto(fila?.extra),
  ];
}

function mismaFirma(a, b) {
  return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

function registrarAviso(db, idProceso, radicado, tipo, resumen, ctx) {
  const momento = ahora();
  run(db, `
    INSERT INTO aviso (creado_en, id_proceso, radicado, tipo, resumen)
    VALUES (?, ?, ?, ?, ?)
  `, [momento, idProceso, radicado, tipo, resumen]);
  const linea = `[${momento}] ${tipo} | ${radicado || idProceso} | ${resumen}`;
  ctx.log(linea);
  ctx.aviso(linea);
}

export function guardarSujetos(db, idProceso, radicado, items, completo, notificar, ctx) {
  const nuevos = new Map();
  for (const item of items) {
    const preparado = prepararSujeto(item);
    if (preparado) nuevos.set(preparado.id_reg_sujeto, preparado);
  }
  const anteriores = new Map();
  for (const fila of filas(db, `
    SELECT id_reg_sujeto, tipo_sujeto, rol_base, es_emplazado, identificacion, nombre
    FROM sujeto WHERE id_proceso = ?
  `, [idProceso])) {
    anteriores.set(fila.id_reg_sujeto, fila);
  }
  let cambios = 0;
  for (const [clave, fila] of nuevos) {
    if (!anteriores.has(clave)) {
      run(db, `
        INSERT INTO sujeto (
          id_proceso, id_reg_sujeto, tipo_sujeto, rol_base, es_emplazado, identificacion, nombre
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [idProceso, clave, fila.tipo_sujeto, fila.rol_base, fila.es_emplazado, fila.identificacion, fila.nombre]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "sujeto_nuevo", `${fila.tipo_sujeto}: ${fila.nombre}`, ctx);
      }
    } else if (!mismaFirma(firmaSujeto(fila), firmaSujeto(anteriores.get(clave)))) {
      run(db, `
        UPDATE sujeto SET
          tipo_sujeto = ?, rol_base = ?, es_emplazado = ?, identificacion = ?, nombre = ?
        WHERE id_proceso = ? AND id_reg_sujeto = ?
      `, [fila.tipo_sujeto, fila.rol_base, fila.es_emplazado, fila.identificacion, fila.nombre, idProceso, clave]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "sujeto_actualizado", `${fila.tipo_sujeto}: ${fila.nombre}`, ctx);
      }
    }
  }
  if (completo) {
    for (const [clave, previo] of anteriores) {
      if (nuevos.has(clave)) continue;
      run(db, "DELETE FROM sujeto WHERE id_proceso = ? AND id_reg_sujeto = ?", [idProceso, clave]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "sujeto_retirado", `${previo.tipo_sujeto}: ${previo.nombre}`, ctx);
      }
    }
  }
  return cambios;
}

export function guardarDocumentos(db, idProceso, radicado, items, completo, notificar, ctx) {
  const nuevos = new Map();
  for (const item of items) {
    const preparado = prepararDocumento(item);
    nuevos.set(preparado.clave, preparado);
  }
  const anteriores = new Map();
  for (const fila of filas(db, `
    SELECT clave, id_reg_documento, nombre, descripcion, fecha_carga, tipo, enlace, extra
    FROM documento WHERE id_proceso = ?
  `, [idProceso])) {
    anteriores.set(fila.clave, fila);
  }
  let cambios = 0;
  for (const [clave, fila] of nuevos) {
    const etiqueta = fila.nombre || fila.descripcion || clave;
    if (!anteriores.has(clave)) {
      run(db, `
        INSERT INTO documento (
          id_proceso, clave, id_reg_documento, nombre, descripcion, fecha_carga, tipo, enlace, extra
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [idProceso, clave, fila.id_reg_documento, fila.nombre, fila.descripcion, fila.fecha_carga, fila.tipo, fila.enlace, fila.extra]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "documento_nuevo", etiqueta, ctx);
      }
    } else if (!mismaFirma(firmaDocumento(fila), firmaDocumento(anteriores.get(clave)))) {
      run(db, `
        UPDATE documento SET
          id_reg_documento = ?, nombre = ?, descripcion = ?, fecha_carga = ?, tipo = ?, enlace = ?, extra = ?
        WHERE id_proceso = ? AND clave = ?
      `, [fila.id_reg_documento, fila.nombre, fila.descripcion, fila.fecha_carga, fila.tipo, fila.enlace, fila.extra, idProceso, clave]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "documento_actualizado", etiqueta, ctx);
      }
    }
  }
  if (completo) {
    for (const [clave, previo] of anteriores) {
      if (nuevos.has(clave)) continue;
      run(db, "DELETE FROM documento WHERE id_proceso = ? AND clave = ?", [idProceso, clave]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "documento_retirado", previo.nombre || clave, ctx);
      }
    }
  }
  return cambios;
}

export function guardarActuaciones(db, idProceso, radicado, items, completo, notificar, ctx) {
  const nuevos = new Map();
  for (const item of items) {
    const preparado = prepararActuacion(item, idProceso);
    if (preparado) nuevos.set(preparado.id_reg_actuacion, preparado);
  }
  const anteriores = new Map();
  for (const fila of filas(db, `
    SELECT id_reg_actuacion, consecutivo, fecha_actuacion, actuacion, anotacion,
           fecha_inicial, fecha_final, fecha_registro, cod_regla, con_documentos
    FROM actuacion WHERE id_proceso = ?
  `, [idProceso])) {
    anteriores.set(fila.id_reg_actuacion, fila);
  }
  let cambios = 0;
  for (const [clave, fila] of nuevos) {
    let resumen = `${fila.fecha_actuacion || ""} ${fila.actuacion || ""}`.trim();
    if (fila.anotacion) resumen = `${resumen} — ${fila.anotacion}`;
    if (!anteriores.has(clave)) {
      run(db, `
        INSERT INTO actuacion (
          id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion,
          actuacion, anotacion, fecha_inicial, fecha_final, fecha_registro,
          cod_regla, con_documentos
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        clave, idProceso, fila.radicado || radicado, fila.consecutivo, fila.fecha_actuacion,
        fila.actuacion, fila.anotacion, fila.fecha_inicial, fila.fecha_final, fila.fecha_registro,
        fila.cod_regla, fila.con_documentos,
      ]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "actuacion_nueva", resumen, ctx);
      }
    } else if (!mismaFirma(firmaActuacion(fila), firmaActuacion(anteriores.get(clave)))) {
      run(db, `
        UPDATE actuacion SET
          radicado = ?, consecutivo = ?, fecha_actuacion = ?, actuacion = ?,
          anotacion = ?, fecha_inicial = ?, fecha_final = ?, fecha_registro = ?,
          cod_regla = ?, con_documentos = ?
        WHERE id_reg_actuacion = ?
      `, [
        fila.radicado || radicado, fila.consecutivo, fila.fecha_actuacion, fila.actuacion,
        fila.anotacion, fila.fecha_inicial, fila.fecha_final, fila.fecha_registro,
        fila.cod_regla, fila.con_documentos, clave,
      ]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "actuacion_actualizada", resumen, ctx);
      }
    }
  }
  if (completo) {
    for (const [clave, previo] of anteriores) {
      if (nuevos.has(clave)) continue;
      run(db, "DELETE FROM actuacion WHERE id_reg_actuacion = ?", [clave]);
      if (notificar) {
        cambios += 1;
        registrarAviso(db, idProceso, radicado, "actuacion_retirada", `${previo.fecha_actuacion || ""} ${previo.actuacion || ""}`.trim(), ctx);
      }
    }
  }
  if (completo && nuevos.size) {
    run(db, `
      UPDATE proceso SET fecha_ultima_actuacion = (
        SELECT MAX(fecha_actuacion) FROM actuacion WHERE id_proceso = ?
      )
      WHERE id_proceso = ?
        AND (
          fecha_ultima_actuacion IS NULL
          OR fecha_ultima_actuacion < (
            SELECT MAX(fecha_actuacion) FROM actuacion WHERE id_proceso = ?
          )
        )
    `, [idProceso, idProceso, idProceso]);
  }
  return cambios;
}

export function cargarFichas(db, contenido) {
  const { campos, filas: registros } = tablaCsv(contenido);
  const colRadicado = columna(campos, "RADICADO") || columna(campos, "RADICADOS");
  if (!colRadicado) throw new Error(`No está la columna RADICADO. Columnas: ${campos.join(", ")}`);
  const colCiudad = columna(campos, "CIUDAD");
  const colJuzgado = columna(campos, "JUZGADO");
  const colTipo = columna(campos, "TIPO DE PROCESO");
  const colDemandante = columna(campos, "DEMANDANTE");
  const colDemandado = columna(campos, "DEMANDADO");
  run(db, "DELETE FROM ficha_juzgado");
  run(db, "DELETE FROM ficha_radicado");
  run(db, "DELETE FROM ficha");
  const radicados = [];
  const vistos = new Set();
  registros.forEach((fila, indice) => {
    const info = run(db, `
      INSERT INTO ficha (fila_csv, ciudad, tipo_proceso, demandante, demandado)
      VALUES (?, ?, ?, ?, ?)
    `, [
      indice + 1,
      colCiudad ? texto(fila[colCiudad]) : null,
      colTipo ? texto(fila[colTipo]) : null,
      colDemandante ? texto(fila[colDemandante]) : null,
      colDemandado ? texto(fila[colDemandado]) : null,
    ]);
    const fichaId = Number(info.lastInsertRowid);
    parsearJuzgados(colJuzgado ? fila[colJuzgado] : "").forEach((juzgado, orden) => {
      run(db, `
        INSERT INTO ficha_juzgado (ficha_id, orden, nombre, url) VALUES (?, ?, ?, ?)
      `, [fichaId, orden + 1, juzgado.nombre, juzgado.url]);
    });
    parsearRadicados(fila[colRadicado] || "").forEach((numero, orden) => {
      asegurarRadicado(db, numero);
      run(db, `
        INSERT INTO ficha_radicado (ficha_id, radicado, orden) VALUES (?, ?, ?)
      `, [fichaId, numero, orden + 1]);
      if (!vistos.has(numero)) {
        vistos.add(numero);
        radicados.push(numero);
      }
    });
  });
  return radicados;
}
