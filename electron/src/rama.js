import { ahora, causaDePeticion, pausaAleatoriaMs } from "../compartido/logica.js";
import { filas, transaccion, uno } from "./db.js";
import {
  asegurarRadicado,
  guardarActuaciones,
  guardarConsulta,
  guardarDetalle,
  guardarDocumentos,
  guardarSujetos,
} from "./guardar.js";

const ORIGEN = "https://consultaprocesos.ramajudicial.gov.co:448/api/v2";
export const CONSULTA_URL = `${ORIGEN}/Procesos/Consulta/NumeroRadicacion`;
export const DETALLE_URL = `${ORIGEN}/Proceso/Detalle`;
export const SUJETOS_URL = `${ORIGEN}/Proceso/Sujetos`;
export const DOCUMENTOS_URL = `${ORIGEN}/Proceso/Documentos`;
export const ACTUACIONES_URL = `${ORIGEN}/Proceso/Actuaciones`;

const CABECERAS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "es-US,es;q=0.9,en-US;q=0.8,en;q=0.7,es-419;q=0.6",
  origin: "https://consultaprocesos.ramajudicial.gov.co",
  priority: "u=1, i",
  referer: "https://consultaprocesos.ramajudicial.gov.co/",
  "sec-ch-ua": '"Chromium";v="155", "Google Chrome";v="155", "Not A(Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
};

const PAUSA_MS = 500;
const MAX_PAGINAS = 50;
const MAX_FALLOS_SEGUIDOS = 5;
// Lotes de 50 con arranque lento: se empieza de a un expediente y se suma
// uno concurrente por éxito (máximo 5); ante un fallo se vuelve a uno.
// Así la revisión va más rápido sin aporrear a la Rama a la primera.
const TAMANO_LOTE = 50;
const CONCURRENCIA_MAXIMA = 5;

export async function pedirRed(url, params) {
  const destino = new URL(url);
  if (params) {
    for (const [clave, valor] of Object.entries(params)) destino.searchParams.set(clave, String(valor));
  }
  const respuesta = await fetch(destino, { headers: CABECERAS, signal: AbortSignal.timeout(40000) });
  return { status: respuesta.status, text: await respuesta.text() };
}

// El gateway de la Rama devuelve HTML en los errores (502 Bad Gateway de
// Azure): se deja solo el texto para que el registro y los avisos se
// puedan leer en vez de mostrar el HTML crudo.
export function textoErrorRespuesta(valor) {
  return String(valor || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&(amp|quot|lt|gt|#39);/g, (entidad) => ({ "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&#39;": "'" }[entidad] || entidad))
    .replace(/\s+/g, " ")
    .trim();
}

// El gateway (502/503/504) suele recuperarse solo: se reintenta una vez
// más que los demás errores, con esperas crecientes.
const ESPERA_GATEWAY_MS = [2000, 5000, 15000];

const dormirReal = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

async function pausaEntrePeticiones(ctx) {
  const ms = typeof ctx.pausaMs === "function" ? ctx.pausaMs() : PAUSA_MS;
  await ctx.dormir(ms);
}

export async function obtenerJson(url, params, ctx, vacioSiNoHay = false) {
  let ultimo = "sin respuesta";
  for (let intento = 1; intento <= 4; intento += 1) {
    let respuesta;
    try {
      respuesta = await ctx.pedir(url, params);
    } catch (error) {
      ultimo = String(error?.message || error);
      if (intento >= 3) throw new Error(ultimo);
      await ctx.dormir(intento * 2000);
      continue;
    }
    if (respuesta.status === 502 || respuesta.status === 503 || respuesta.status === 504) {
      ultimo = `HTTP ${respuesta.status}: ${textoErrorRespuesta(respuesta.text).slice(0, 200) || "la Rama no responde"}`;
      await ctx.dormir(ESPERA_GATEWAY_MS[Math.min(intento, ESPERA_GATEWAY_MS.length) - 1]);
      continue;
    }
    if (respuesta.status === 429 || respuesta.status === 500) {
      ultimo = `HTTP ${respuesta.status}: ${textoErrorRespuesta(respuesta.text).slice(0, 200)}`;
      if (intento >= 3) throw new Error(ultimo);
      await ctx.dormir(intento * 2000);
      continue;
    }
    if (respuesta.status === 403) {
      const espera = 20 * intento;
      ultimo = "HTTP 403";
      if (intento >= 3) throw new Error(ultimo);
      ctx.log(`  la Rama respondió 403, espero ${espera}s`);
      await ctx.dormir(espera * 1000);
      continue;
    }
    if (respuesta.status === 404 && vacioSiNoHay) {
      await pausaEntrePeticiones(ctx);
      return {};
    }
    if (respuesta.status !== 200) {
      throw new Error(`HTTP ${respuesta.status}: ${textoErrorRespuesta(respuesta.text).slice(0, 300)}`);
    }
    let data;
    try {
      data = JSON.parse(respuesta.text || "");
    } catch {
      throw new Error(`Respuesta que no es JSON: ${String(respuesta.text || "").slice(0, 300)}`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("La respuesta JSON no es un objeto");
    await pausaEntrePeticiones(ctx);
    return data;
  }
  throw new Error(ultimo);
}

function cantidadPaginas(data) {
  const paginacion = data?.paginacion || {};
  const cantidad = Number(paginacion.cantidadPaginas || 1);
  return Number.isInteger(cantidad) && cantidad > 0 ? cantidad : 1;
}

export async function pedirLista(url, clave, paginar, ctx) {
  const items = [];
  let totalEsperado = null;
  let pagina = 1;
  let usarPagina = paginar;
  let rompimos = false;
  while (pagina <= MAX_PAGINAS) {
    if (detenido(ctx)) return { items, completo: true, cancelado: true };
    const params = usarPagina ? { pagina: String(pagina) } : null;
    const data = await obtenerJson(url, params, ctx, true);
    if (!data || !Object.keys(data).length) return { items: [], completo: true };
    const bloque = Array.isArray(data[clave]) ? data[clave].filter((item) => item && typeof item === "object") : [];
    items.push(...bloque);
    if (data.paginacion?.cantidadRegistros != null) {
      const total = Number(data.paginacion.cantidadRegistros);
      totalEsperado = Number.isInteger(total) ? total : null;
    }
    if (!usarPagina) {
      if (cantidadPaginas(data) <= 1) {
        rompimos = true;
        break;
      }
      usarPagina = true;
      pagina = 2;
      continue;
    }
    if (pagina >= cantidadPaginas(data) || bloque.length === 0) {
      rompimos = true;
      break;
    }
    pagina += 1;
  }
  if (!rompimos) return { items, completo: false };
  return { items, completo: totalEsperado == null || items.length === totalEsperado };
}

export async function consultarRadicado(numero, ctx) {
  const paginas = [];
  let pagina = 1;
  while (pagina <= MAX_PAGINAS) {
    if (detenido(ctx)) return { paginas, cancelado: true };
    const data = await obtenerJson(CONSULTA_URL, { numero, SoloActivos: "false", pagina: String(pagina) }, ctx);
    paginas.push(data);
    const cantidad = cantidadPaginas(data);
    if (pagina >= cantidad || !data.procesos?.length) break;
    pagina += 1;
  }
  return { paginas, cancelado: false };
}

function yaConsultado(db, numero) {
  const fila = uno(db, "SELECT consultado_en FROM radicado WHERE numero = ?", [numero]);
  return Boolean(fila?.consultado_en);
}

async function pasoConsulta(db, numeros, actualizar, ctx) {
  let nuevos = 0;
  let errores = 0;
  let fallo = false;
  for (let indice = 0; indice < numeros.length; indice += 1) {
    if (detenido(ctx)) return { nuevos, errores, fallo, cancelado: true };
    const numero = numeros[indice];
    ctx.log(`[consulta ${indice + 1}/${numeros.length}] ${numero}`);
    if (!actualizar && yaConsultado(db, numero)) {
      ctx.log("  ya estaba en la base");
      continue;
    }
    try {
      const { paginas, cancelado } = await consultarRadicado(numero, ctx);
      if (cancelado) return { nuevos, errores, fallo, cancelado: true };
      const ids = transaccion(db, () => guardarConsulta(db, numero, paginas));
      nuevos += ids.length;
      ctx.log(ids.length ? `  procesos=${ids.length}` : "  la Rama no devolvió procesos");
    } catch (error) {
      errores += 1;
      fallo = true;
      ctx.log(`  error: ${error.message}`);
    }
  }
  return { nuevos, errores, fallo };
}

async function pasoDetalle(db, actualizar, radicado, ctx) {
  const condiciones = [];
  const params = [];
  if (radicado) {
    condiciones.push("radicado = ?");
    params.push(radicado);
  } else if (!actualizar) {
    condiciones.push("detalle_consultado_en IS NULL");
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const pendientes = filas(db, `SELECT id_proceso FROM proceso ${where} ORDER BY id_proceso`, params);
  ctx.log(`Detalles pendientes: ${pendientes.length}`);
  let nuevos = 0;
  let errores = 0;
  if (detenido(ctx)) return { nuevos, errores, cancelado: true };
  for (let indice = 0; indice < pendientes.length; indice += 1) {
    if (detenido(ctx)) return { nuevos, errores, cancelado: true };
    const idProceso = pendientes[indice].id_proceso;
    ctx.log(`[detalle ${indice + 1}/${pendientes.length}] ${idProceso}`);
    try {
      const data = await obtenerJson(`${DETALLE_URL}/${idProceso}`, null, ctx);
      transaccion(db, () => guardarDetalle(db, idProceso, data));
      nuevos += 1;
      ctx.log(`  guardado ${textoCorto(data.despacho)}`);
    } catch (error) {
      errores += 1;
      ctx.log(`  error: ${error.message}`);
    }
  }
  return { nuevos, errores };
}

function textoCorto(valor) {
  return String(valor == null ? "" : valor).replace(/\s+/g, " ").trim();
}

// Del último informe, solo los expedientes que fallaron (los no
// intentados y los que ya no están se ignoran): así la siguiente
// corrida no repite lo que ya quedó al día.
export function idsDeFallas(db, fallas) {
  const procesos = filas(db, "SELECT id_proceso, radicado, despacho FROM proceso");
  const mismos = (proceso, falla) => proceso.radicado === falla.radicado
    && String(proceso.despacho || "") === String(falla.despacho || "");
  const vistos = new Set();
  const ids = [];
  for (const falla of fallas || []) {
    const hallado = procesos.find((proceso) => proceso.id_proceso && mismos(proceso, falla))
      || procesos.find((proceso) => proceso.id_proceso && proceso.radicado === falla.radicado);
    const id = Number(hallado?.id_proceso) || 0;
    if (id > 0 && !vistos.has(id)) {
      vistos.add(id);
      ids.push(id);
    }
  }
  return ids;
}

// La búsqueda completa se puede detener desde la ventana: se avisa una
// sola vez y cada fase corta lo pendiente devolviendo cancelado: true.
function detenido(ctx) {
  if (!ctx.cancelada?.()) return false;
  if (!ctx.avisoCancelado) {
    ctx.avisoCancelado = true;
    ctx.log("Búsqueda detenida por el usuario. Lo ya guardado queda en la base.");
  }
  return true;
}

function informeDe(resultados) {
  const fallas = resultados.filter((fila) => !fila.ok).map((fila) => ({
    radicado: fila.radicado,
    despacho: fila.despacho || "",
    causa: fila.causa,
  }));
  return {
    total: resultados.length,
    exitosos: resultados.length - fallas.length,
    fallidos: fallas.length,
    fallas,
  };
}

async function pasoSeguimiento(db, { limite, soloFaltantes, radicado, idProceso, ids = null, soloActuaciones, ctx }) {
  const condiciones = [];
  const params = [];
  if (idProceso) {
    condiciones.push("id_proceso = ?");
    params.push(idProceso);
  } else if (radicado) {
    condiciones.push("radicado = ?");
    params.push(radicado);
  } else if (Array.isArray(ids)) {
    const lista = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    condiciones.push(lista.length ? `id_proceso IN (${lista.map(() => "?").join(",")})` : "0");
    params.push(...lista);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  let procesos = filas(db, `
    SELECT id_proceso, radicado, despacho, sujetos_consultado_en, documentos_consultado_en, actuaciones_consultado_en
    FROM proceso
    ${where}
    ORDER BY id_proceso
  `, params);
  if (soloFaltantes) {
    procesos = procesos.filter((fila) => (soloActuaciones
      ? fila.actuaciones_consultado_en == null
      : fila.sujetos_consultado_en == null || fila.documentos_consultado_en == null || fila.actuaciones_consultado_en == null));
  }
  if (limite > 0) procesos = procesos.slice(0, limite);
  ctx.log(soloActuaciones ? `Actuaciones de ${procesos.length} expediente(s)` : `Seguimiento de ${procesos.length} expediente(s)`);
  const cuenta = { cambios: 0, errores: 0, fallos: 0 };
  const salidas = new Array(procesos.length).fill(null);
  if (detenido(ctx)) return { cambios: 0, errores: 0, informe: soloActuaciones ? informeDe([]) : null, cancelado: true };
  const estado = { parar: false, motivo: "" };
  const anotar = (indice, fila, ok, causa = "") => {
    if (!soloActuaciones) return;
    salidas[indice] = {
      radicado: fila.radicado,
      despacho: fila.despacho || "",
      ok,
      causa: ok ? "" : causa,
    };
  };
  function pararPor(motivo) {
    if (estado.parar) return;
    estado.parar = true;
    estado.motivo = motivo;
    ctx.log(`  paro el seguimiento: ${motivo} Lo pendiente queda para la próxima corrida`);
  }
  async function tarea(indice) {
    const fila = procesos[indice];
    if (detenido(ctx)) return "cancelado";
    if (estado.parar) return "parado";
    ctx.log(`[seguimiento ${indice + 1}/${procesos.length}] ${fila.radicado} idProceso=${fila.id_proceso}`);
    let sujetos = [];
    let sujetosOk = false;
    let documentos = [];
    let documentosOk = false;
    let actuaciones = [];
    let actuacionesOk = false;
    let canceladoLista = false;
    try {
      if (soloActuaciones) {
        const acto = await pedirLista(`${ACTUACIONES_URL}/${fila.id_proceso}`, "actuaciones", true, ctx);
        actuaciones = acto.items;
        actuacionesOk = acto.completo;
        canceladoLista = acto.cancelado;
      } else {
        const sujeto = await pedirLista(`${SUJETOS_URL}/${fila.id_proceso}`, "sujetos", true, ctx);
        const documento = await pedirLista(`${DOCUMENTOS_URL}/${fila.id_proceso}`, "documentos", false, ctx);
        const acto = await pedirLista(`${ACTUACIONES_URL}/${fila.id_proceso}`, "actuaciones", true, ctx);
        sujetos = sujeto.items;
        sujetosOk = sujeto.completo;
        documentos = documento.items;
        documentosOk = documento.completo;
        actuaciones = acto.items;
        actuacionesOk = acto.completo;
        canceladoLista = sujeto.cancelado || documento.cancelado || acto.cancelado;
      }
    } catch (error) {
      cuenta.errores += 1;
      const causa = causaDePeticion(error.message);
      ctx.log(`  error: ${error.message}`);
      anotar(indice, fila, false, causa);
      cuenta.fallos += 1;
      if (String(error.message).includes("403")) {
        pararPor("la Rama bloqueó las peticiones.");
      } else if (cuenta.fallos >= MAX_FALLOS_SEGUIDOS) {
        pararPor("la Rama no respondió varias veces seguidas.");
      }
      return "falla";
    }
    cuenta.fallos = 0;
    if (canceladoLista || detenido(ctx)) return "cancelado";
    if (estado.parar) return "parado";
    if (!uno(db, "SELECT id_proceso FROM proceso WHERE id_proceso = ?", [fila.id_proceso])) {
      ctx.log("  el expediente ya no está en la lista");
      return "ok";
    }
    if (soloActuaciones && !actuacionesOk) {
      cuenta.errores += 1;
      const causa = "Las actuaciones llegaron incompletas.";
      ctx.log(`  ${causa}`);
      anotar(indice, fila, false, causa);
      cuenta.fallos += 1;
      if (cuenta.fallos >= MAX_FALLOS_SEGUIDOS) pararPor("la Rama no respondió varias veces seguidas.");
      return "falla";
    }
    const momento = ahora();
    try {
    transaccion(db, () => {
      if (sujetosOk) {
        cuenta.cambios += guardarSujetos(db, fila.id_proceso, fila.radicado, sujetos, true, fila.sujetos_consultado_en != null, ctx);
        runSilencioso(db, momento, "sujetos_consultado_en", fila.id_proceso);
      } else if (!soloActuaciones) {
        ctx.log("  sujetos incompletos; no se marcan ni se borran");
      }
      if (documentosOk) {
        cuenta.cambios += guardarDocumentos(db, fila.id_proceso, fila.radicado, documentos, true, fila.documentos_consultado_en != null, ctx);
        runSilencioso(db, momento, "documentos_consultado_en", fila.id_proceso);
      } else if (!soloActuaciones) {
        ctx.log("  documentos incompletos; no se marcan ni se borran");
      }
      if (actuacionesOk) {
        cuenta.cambios += guardarActuaciones(db, fila.id_proceso, fila.radicado, actuaciones, true, fila.actuaciones_consultado_en != null, ctx);
        runSilencioso(db, momento, "actuaciones_consultado_en", fila.id_proceso);
      } else {
        ctx.log("  actuaciones incompletas; no se marcan ni se borran");
      }
    });
    } catch (error) {
      cuenta.errores += 1;
      ctx.log(`  error: ${error.message}`);
      anotar(indice, fila, false, "No se pudo guardar la respuesta.");
      cuenta.fallos += 1;
      if (cuenta.fallos >= MAX_FALLOS_SEGUIDOS) pararPor("la Rama no respondió varias veces seguidas.");
      return "falla";
    }
    anotar(indice, fila, true);
    ctx.log(soloActuaciones ? `  actuaciones=${actuaciones.length}` : `  sujetos=${sujetos.length} documentos=${documentos.length} actuaciones=${actuaciones.length}`);
    return "ok";
  }
  async function correrLote(indices) {
    let siguiente = 0;
    let tope = 1;
    let activos = 0;
    let resolveListo;
    let rejectListo;
    const listo = new Promise((res, rej) => { resolveListo = res; rejectListo = rej; });
    const frenar = () => estado.parar || detenido(ctx);
    function masObreros() {
      while (activos < tope && siguiente < indices.length && !frenar()) {
        activos += 1;
        obrero().then(
          () => {
            activos -= 1;
            if (activos === 0) resolveListo();
            else masObreros();
          },
          (error) => {
            activos -= 1;
            if (activos === 0) rejectListo(error);
            else masObreros();
          },
        );
      }
      if (activos === 0) resolveListo();
    }
    async function obrero() {
      for (;;) {
        if (frenar()) return;
        const k = siguiente;
        siguiente += 1;
        if (k >= indices.length) return;
        const r = await tarea(indices[k]);
        if (r === "ok") tope = Math.min(tope + 1, CONCURRENCIA_MAXIMA);
        else tope = 1;
        masObreros();
      }
    }
    masObreros();
    await listo;
  }
  const totalLotes = Math.max(1, Math.ceil(procesos.length / TAMANO_LOTE));
  let cancelado = false;
  for (let ini = 0, lote = 1; ini < procesos.length; ini += TAMANO_LOTE, lote += 1) {
    if (estado.parar || detenido(ctx)) break;
    const indices = [];
    for (let i = ini; i < Math.min(ini + TAMANO_LOTE, procesos.length); i += 1) indices.push(i);
    if (procesos.length > TAMANO_LOTE) ctx.log(`Lote ${lote} de ${totalLotes}: ${indices.length} expediente(s)`);
    await correrLote(indices);
  }
  const resultados = [];
  for (let i = 0; i < procesos.length; i += 1) {
    if (salidas[i]) {
      resultados.push(salidas[i]);
      continue;
    }
    if (detenido(ctx)) {
      cancelado = true;
      break;
    }
    if (estado.parar) {
      cuenta.errores += 1;
      const causa = `No se intentó: ${estado.motivo}`;
      salidas[i] = { radicado: procesos[i].radicado, despacho: procesos[i].despacho || "", ok: false, causa };
      resultados.push(salidas[i]);
    }
  }
  if (cancelado) return { cambios: cuenta.cambios, errores: cuenta.errores, informe: soloActuaciones ? informeDe(resultados) : null, cancelado: true };
  if (soloActuaciones) {
    const informe = informeDe(resultados);
    ctx.log(`Informe: ${informe.total} expediente(s). ${informe.exitosos} actualizados. ${informe.fallidos} con falla.`);
    for (const falla of informe.fallas) {
      ctx.log(`  ${falla.radicado}${falla.despacho ? ` — ${falla.despacho}` : ""}: ${falla.causa}`);
    }
  }
  return { cambios: cuenta.cambios, errores: cuenta.errores, informe: soloActuaciones ? informeDe(resultados) : null };
}

function runSilencioso(db, momento, columna, idProceso) {
  db.prepare(`UPDATE proceso SET ${columna} = ? WHERE id_proceso = ?`).run(momento, idProceso);
}

async function cargarRadicado(db, numero, contexto) {
  transaccion(db, () => asegurarRadicado(db, numero));
  const consulta = await pasoConsulta(db, [numero], true, contexto);
  if (consulta.cancelado) return { consulta, detalle: { nuevos: 0, errores: 0 }, seguimiento: { cambios: 0, errores: 0 }, cancelado: true };
  const detalle = await pasoDetalle(db, true, numero, contexto);
  if (detalle.cancelado) return { consulta, detalle, seguimiento: { cambios: 0, errores: 0 }, cancelado: true };
  const seguimiento = await pasoSeguimiento(db, {
    limite: 0,
    soloFaltantes: false,
    radicado: numero,
    soloActuaciones: false,
    ctx: contexto,
  });
  if (seguimiento.cancelado) return { consulta, detalle, seguimiento, cancelado: true };
  return { consulta, detalle, seguimiento };
}

export async function ejecutarTrabajo({ db, modo, radicado, idProceso = null, numeros = null, ids = null, ctx, pedir, dormir, permitirRed = false, azar = Math.random }) {
  const red = pedir || (permitirRed ? pedirRed : async () => {
    throw new Error("La consulta a la Rama no está habilitada.");
  });
  const contexto = { ...ctx, pedir: red, dormir: dormir || dormirReal, azar };
  let errores = 0;
  let cambios = 0;
  let falloConsulta = false;
  let informe = null;
  contexto.log("--- inicio ---");
  const unoSolo = String(radicado || "").replace(/\D/g, "");
  if (modo === "carga") {
    const lista = [];
    const vistos = new Set();
    for (const crudo of numeros || []) {
      for (const numero of String(crudo || "").matchAll(/(?:^|\D)(\d{23})(?!\d)/g)) {
        if (vistos.has(numero[1])) continue;
        vistos.add(numero[1]);
        lista.push(numero[1]);
      }
    }
    if (!lista.length) throw new Error("No hay radicados de 23 dígitos.");
    contexto.pausaMs = () => pausaAleatoriaMs(contexto.azar);
    contexto.log(`Carga de ${lista.length} radicado(s). Entre cada petición hay una pausa de 1 a 3 segundos.`);
    for (let indice = 0; indice < lista.length; indice += 1) {
      if (detenido(contexto)) return { codigo: 0, errores, cambios, informe: null, cancelado: true };
      const numero = lista[indice];
      contexto.log(`Radicado ${indice + 1} de ${lista.length}: ${numero}`);
      const carga = await cargarRadicado(db, numero, contexto);
      errores += carga.consulta.errores + carga.detalle.errores + carga.seguimiento.errores;
      cambios += carga.seguimiento.cambios;
      falloConsulta = falloConsulta || carga.consulta.fallo;
      if (carga.cancelado) return { codigo: 0, errores, cambios, informe: null, cancelado: true };
    }
    contexto.log(`Carga lista. Cambios: ${cambios}. Errores: ${errores}`);
  } else if (modo === "uno") {
    const id = Number(idProceso);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Ese expediente no está");
    contexto.pausaMs = () => pausaAleatoriaMs(contexto.azar);
    contexto.log("Revisión de un expediente.");
    const seguimiento = await pasoSeguimiento(db, {
      limite: 0,
      soloFaltantes: false,
      radicado: null,
      idProceso: id,
      soloActuaciones: true,
      ctx: contexto,
    });
    cambios += seguimiento.cambios;
    errores += seguimiento.errores;
    informe = seguimiento.informe;
    contexto.log(`Seguimiento listo. Cambios: ${cambios}. Errores: ${seguimiento.errores}`);
  } else if (modo === "agregar") {
    if (unoSolo.length !== 23) throw new Error("El radicado debe tener 23 dígitos");
    contexto.log(`Solo el radicado ${unoSolo}`);
    contexto.log("Radicados a consultar: 1");
    const carga = await cargarRadicado(db, unoSolo, contexto);
    errores += carga.consulta.errores + carga.detalle.errores + carga.seguimiento.errores;
    cambios += carga.seguimiento.cambios;
    falloConsulta = carga.consulta.fallo;
    if (carga.cancelado) return { codigo: 0, errores, cambios, informe: null, cancelado: true };
    contexto.log(`Paso 1 listo. Procesos tocados: ${carga.consulta.nuevos}. Errores: ${carga.consulta.errores}`);
    contexto.log(`Paso 2 listo. Detalles nuevos: ${carga.detalle.nuevos}. Errores: ${carga.detalle.errores}`);
    contexto.log(`Seguimiento listo. Cambios: ${cambios}. Errores: ${carga.seguimiento.errores}`);
  } else {
    contexto.pausaMs = () => pausaAleatoriaMs(contexto.azar);
    contexto.log("Entre cada petición hay una pausa de 1 a 3 segundos.");
    const seguimiento = await pasoSeguimiento(db, {
      limite: 0,
      soloFaltantes: false,
      radicado: null,
      ids: Array.isArray(ids) ? ids : null,
      soloActuaciones: true,
      ctx: contexto,
    });
    cambios += seguimiento.cambios;
    errores += seguimiento.errores;
    informe = seguimiento.informe;
    contexto.log(`Seguimiento listo. Cambios: ${cambios}. Errores: ${seguimiento.errores}`);
  }
  if (cambios) contexto.notificar?.(`${cambios} cambio(s) en los expedientes. Ver avisos.log`);
  contexto.log("--- fin ---");
  return { codigo: falloConsulta ? 1 : 0, errores, cambios, informe };
}
