// Jurisprudencia: red con sesión propia por fuente. Patrones ya probados
// en la app: jarra de cookies a mano (pp.js), JSF parcial (CSJ), JSON
// directo (Corte Constitucional) y WebForms delta (SAMAI Titulación).
//
// Hallazgos del spike en vivo (oct 2026):
// - CSJ: GET index.xhtml da JSESSIONID + ViewState; el POST ajax devuelve
//   XML parcial con la tabla y el total. Pausa de 1 a 3 s entre peticiones.
// - CCC: GET JSON con X-APIWEB-KEY; el texto vive en /relatoria/<rutahtml>.
// - CE: exige GET al portal + GET al buscador en el MISMO proceso
//   (keep-alive; si no, la granja responde MAC failed). Reintenta la
//   sesión completa cuando el delta trae error.
import { pausaAleatoriaMs } from "../compartido/logica.js";
import {
  corporacionesDe, extraerAspx, extraerViewStateCSJ, filasCSJ,
  itemsCE, normalizarCCC, textoDeHtml, totalCSJ, etiquetasFuente, nombreFuente,
  validarBusqueda,
} from "../compartido/juris.js";
import { Aviso } from "./db.js";
import { guardarPieza } from "./biblioteca.js";
import { textoDePdfCompleto } from "./pdftexto.js";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const CSJ_BASE = "https://consultajurisprudencial.ramajudicial.gov.co/WebRelatoria/csj/index.xhtml";
const CCC_BUSCADOR = "https://www.corteconstitucional.gov.co/relatoria/buscador_new/";
const CCC_LLAVE = "6a91a35a-f81c-83e9-853d-aff98152378a";
const CE_BASE = "https://samai.consejodeestado.gov.co";
const CE_BUSCADOR = `${CE_BASE}/TitulacionRelatoria/BuscadorProvidenciasTituladas.aspx`;

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const pausa = () => dormir(pausaAleatoriaMs());

function sesionVacia() {
  return { cookies: new Map(), extras: {} };
}

function guardarCookies(sesion, respuesta) {
  const hechas = typeof respuesta.headers?.getSetCookie === "function" ? respuesta.headers.getSetCookie() : [];
  for (const cruda of hechas) {
    const par = String(cruda).split(";")[0];
    const i = par.indexOf("=");
    if (i > 0) sesion.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}

function cabeceras(sesion, extra = {}) {
  const base = { "user-agent": UA, accept: "*/*", ...extra };
  if (sesion.cookies.size) base.cookie = [...sesion.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  return base;
}

async function pedir(sesion, url, { metodo = "GET", cuerpo = null, tipo = "text", cabecerasExtra = {} } = {}, veces = 3) {
  let ultimo = "sin respuesta";
  for (let intento = 1; intento <= veces; intento += 1) {
    let respuesta = null;
    try {
      const init = { method: metodo, headers: cabeceras(sesion, cabecerasExtra), signal: AbortSignal.timeout(60000) };
      if (cuerpo != null) init.body = cuerpo;
      respuesta = await fetch(url, init);
    } catch (error) {
      ultimo = String(error?.message || error);
      await dormir(intento * 2000);
      continue;
    }
    guardarCookies(sesion, respuesta);
    if ([429, 500, 502, 503, 504].includes(respuesta.status)) {
      ultimo = `HTTP ${respuesta.status}`;
      await dormir(intento * 2000);
      continue;
    }
    if (!respuesta.ok) {
      ultimo = `HTTP ${respuesta.status}`;
      await dormir(intento * 2000);
      continue;
    }
    return tipo === "json" ? await respuesta.json() : await respuesta.text();
  }
  throw new Aviso(`La fuente no respondió (${ultimo}). Intente de nuevo.`);
}

// ---------- Corte Suprema (JSF) ----------

const SALAS_CSJ_VALOR = {
  civil: [["searchForm:scivil", "SALA DE CASACIÓN CIVIL"]],
  laboral: [
    ["searchForm:slaboral", "SALA DE CASACIÓN LABORAL"],
    ["searchForm:slaboral", "SALA DE DESCONGESTIÓN LABORAL N.º 1"],
    ["searchForm:slaboral", "SALA DE DESCONGESTIÓN LABORAL N.º 2"],
    ["searchForm:slaboral", "SALA DE DESCONGESTIÓN LABORAL N.º 3"],
    ["searchForm:slaboral", "SALA DE DESCONGESTIÓN LABORAL N.º 4"],
  ],
  penal: [
    ["searchForm:spenal", "Sala de Casación Penal"],
    ["searchForm:spenal", "Sala Especial de Primera Instancia"],
    ["searchForm:spenal", "Sala Especial de Instrucción"],
  ],
  plena: [["searchForm:splena", "SALA PLENA"]],
};

export async function abrirSesionCSJ() {
  const sesion = sesionVacia();
  const html = await pedir(sesion, CSJ_BASE);
  sesion.extras.viewstate = extraerViewStateCSJ(html);
  if (!sesion.extras.viewstate) throw new Aviso("La Corte Suprema no entregó sesión. Intente de nuevo.");
  return sesion;
}

function cuerpoCSJ(sesion, filtros = {}) {
  const p = new URLSearchParams();
  p.set("javax.faces.partial.ajax", "true");
  p.set("javax.faces.source", "searchForm:searchButton");
  p.set("javax.faces.partial.execute", "@all");
  p.set("javax.faces.partial.render", "resultForm:jurisTable resultForm:pagText2 resultForm:selectAllButton");
  p.set("searchForm:searchButton", "searchForm:searchButton");
  p.set("searchForm", "searchForm");
  p.set("searchForm:temaInput", String(filtros.texto || ""));
  for (const [clave, valor] of SALAS_CSJ_VALOR[filtros.sala] || []) p.append(clave, valor);
  p.set("searchForm:tutelaselect", "TODO");
  p.set("searchForm:options1", "0");
  p.set("searchForm:fulltxtInput", "");
  p.set("searchForm:ponenteInput", String(filtros.ponente || ""));
  p.set("searchForm:fechaIniCal", String(filtros.fechaIni || ""));
  p.set("searchForm:fechaFinCal", String(filtros.fechaFin || ""));
  p.set("searchForm:radicadoInput", String(filtros.radicado || ""));
  p.set("searchForm:providenciaInput", String(filtros.providencia || ""));
  p.set("searchForm:idInput", "");
  p.set("searchForm:tipoInput", String(filtros.tipo || ""));
  p.set("searchForm:claseInput", String(filtros.clase || ""));
  for (const campo of ["fuente", "juris", "procedencia", "delitos", "sujetos", "servidor", "categoria"]) {
    p.set(`searchForm:${campo}Input`, "");
  }
  p.set("javax.faces.ViewState", sesion.extras.viewstate || "");
  return p.toString();
}

export async function buscarCSJ(filtros = {}) {
  const sesion = await abrirSesionCSJ();
  await pausa();
  const xml = await pedir(sesion, CSJ_BASE, {
    metodo: "POST",
    cuerpo: cuerpoCSJ(sesion, filtros),
    cabecerasExtra: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "faces-request": "partial/ajax",
      "x-requested-with": "XMLHttpRequest",
      origin: "https://consultajurisprudencial.ramajudicial.gov.co",
      referer: CSJ_BASE,
    },
  });
  const nuevo = extraerViewStateCSJ(xml);
  if (nuevo) sesion.extras.viewstate = nuevo;
  if (/<error>/.test(xml)) throw new Aviso("La Corte Suprema rechazó la búsqueda. Intente de nuevo.");
  return { filas: filasCSJ(xml), total: totalCSJ(xml) };
}

// ---------- Corte Constitucional (JSON) ----------

export async function buscarCCC({ texto, tipo = "", fechaIni = "1992-01-01", fechaFin = "", max = 50 } = {}) {
  const sesion = sesionVacia();
  const hoy = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    searchOption: "texto",
    fini: String(fechaIni || "1992-01-01"),
    ffin: String(fechaFin || hoy).slice(0, 10),
    buscar_por: String(texto || ""),
    maxprov: String(Math.min(100, Math.max(1, Number(max) || 50))),
    slop: "1",
    accion: "search",
    tipo: "json",
  });
  if (tipo) params.set("tw_And1", tipo);
  const datos = await pedir(sesion, `${CCC_BUSCADOR}?${params}`, {
    tipo: "json",
    cabecerasExtra: { accept: "application/json, text/plain, */*", "x-apiweb-key": CCC_LLAVE, referer: "https://www.corteconstitucional.gov.co/relatoria/" },
  });
  const hits = datos?.data?.hits?.hits || datos?.hits?.hits || [];
  const total = datos?.data?.hits?.total?.value ?? datos?.hits?.total?.value ?? hits.length;
  return { filas: hits.map((h) => normalizarCCC(h?._source || {})), total: Number(total) || 0 };
}

export async function leerCCC(url) {
  const sesion = sesionVacia();
  // Las páginas de relatoría clásicas llegan en latin1: se decodifica según
  // la cabecera o el meta, y si el UTF-8 deja reemplazos se usa latin1.
  const respuesta = await fetch(String(url || ""), {
    headers: cabeceras(sesion, { accept: "text/html,*/*" }),
    signal: AbortSignal.timeout(60000),
  });
  guardarCookies(sesion, respuesta);
  if (!respuesta.ok) throw new Aviso(`La Corte Constitucional respondió HTTP ${respuesta.status}. Intente de nuevo.`);
  const bytes = Buffer.from(await respuesta.arrayBuffer());
  const cabecera = String(respuesta.headers.get("content-type") || "");
  const meta = bytes.slice(0, 4000).toString("latin1").match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase() || "";
  const nombre = (cabecera.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || meta || "utf-8").toLowerCase();
  let html = bytes.toString(nombre.includes("iso") || nombre.includes("latin") || nombre.includes("1252") ? "latin1" : "utf8");
  if (html.includes("�")) html = bytes.toString("latin1");
  const cuerpo = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || html;
  return textoDeHtml(cuerpo).slice(0, 600000);
}

// ---------- Consejo de Estado y tribunales (WebForms) ----------

export async function abrirSesionCE() {
  const sesion = sesionVacia();
  await pedir(sesion, `${CE_BASE}/`);
  await pausa();
  const html = await pedir(sesion, CE_BUSCADOR, { cabecerasExtra: { referer: `${CE_BASE}/` } });
  const campos = extraerAspx(html);
  if (!campos.viewstate) throw new Aviso("El Consejo de Estado no entregó sesión. Intente de nuevo.");
  sesion.extras = { ...campos, corporaciones: corporacionesDe(html) };
  return sesion;
}

function cuerpoCE(sesion, { texto, corporacion }) {
  const p = new URLSearchParams();
  p.set("ctl00$MainContent$ScriptManager1", "ctl00$MainContent$PanelUpdate|ctl00$MainContent$BusquedaRapidaLinkButton");
  p.set("__EVENTTARGET", "ctl00$MainContent$BusquedaRapidaLinkButton");
  p.set("__EVENTARGUMENT", "");
  p.set("__LASTFOCUS", "");
  p.set("__VIEWSTATE", sesion.extras.viewstate || "");
  p.set("__VIEWSTATEGENERATOR", sesion.extras.generator || "7261BA90");
  p.set("__SCROLLPOSITIONX", "0");
  p.set("__SCROLLPOSITIONY", "0");
  p.set("__EVENTVALIDATION", sesion.extras.eventvalidation || "");
  p.set("ctl00$RolActual", "");
  p.set("ctl00$TiempoSessionHiddenField", "");
  p.set("ctl00$MainContent$CorporacionesTitulanDataList", String(corporacion || ""));
  p.set("ctl00$MainContent$BusquedaRapidaTextBox", String(texto || ""));
  p.set("ctl00$MainContent$NumeroRadicacionTextBox", "");
  p.set("stepactive", "1");
  p.set("__ASYNCPOST", "true");
  return p.toString();
}

export async function buscarCE({ texto, corporacion } = {}) {
  let ultimo = null;
  for (let intento = 1; intento <= 3; intento += 1) {
    const sesion = await abrirSesionCE();
    await pausa();
    const delta = await pedir(sesion, CE_BUSCADOR, {
      metodo: "POST",
      cuerpo: cuerpoCE(sesion, { texto, corporacion }),
      cabecerasExtra: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "x-microsoftajax": "Delta=true",
        origin: CE_BASE,
        referer: CE_BUSCADOR,
      },
    });
    if (/MAC failed|error\|500/.test(delta)) {
      ultimo = "la granja del Consejo de Estado cambió de servidor";
      await dormir(intento * 3000);
      continue;
    }
    const corporaciones = sesion.extras.corporaciones?.length ? sesion.extras.corporaciones : null;
    return { filas: itemsCE(delta), total: itemsCE(delta).length, corporaciones };
  }
  throw new Aviso(`El Consejo de Estado no respondió (${ultimo}). Intente de nuevo.`);
}

export async function leerCE(token) {
  // El visor incrusta URLs firmadas (SAS, unas horas) a los PDF en Azure:
  // se leen de VerProvidenciaViewer.init y se extrae el texto con el lector
  // de PDF propio (sin dependencias nativas).
  const sesion = sesionVacia();
  const url = `${CE_BASE}/PaginasTransversales/VerProvidencia.aspx?tokenDocumento=${encodeURIComponent(String(token || ""))}`;
  const html = await pedir(sesion, url, { cabecerasExtra: { referer: CE_BUSCADOR } });
  const pdfs = [...new Set(
    [...html.matchAll(/VerProvidenciaViewer\.init\('[^']+',\s*\{"url":"(https:[^"]+?\.pdf\?[^"]+)"/g)]
      .map((m) => m[1].replace(/&amp;/g, "&")),
  )].slice(0, 5);
  if (!pdfs.length) throw new Aviso("Esa providencia no trajo documento para leer. Ábrala en el navegador.");
  const partes = [];
  for (const pdf of pdfs) {
    await pausa();
    let respuesta = null;
    try {
      respuesta = await fetch(pdf, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(90000) });
    } catch {
      continue;
    }
    if (!respuesta.ok) continue;
    const leido = await textoDePdfCompleto(Buffer.from(await respuesta.arrayBuffer()));
    if (leido.ok && leido.texto.trim()) partes.push(leido.texto.trim());
  }
  const texto = partes.join("\n\n===== Siguiente documento =====\n\n").trim().slice(0, 600000);
  if (!texto) throw new Aviso("El PDF llegó sin texto (puede ser escaneado). Ábralo en el navegador.");
  return texto;
}

// ---------- Entrada única y guardado ----------

export async function buscarJuris({ fuente, texto, filtros = {} } = {}) {
  const error = validarBusqueda({ fuente, texto, corporacion: filtros.corporacion });
  if (error) throw new Aviso(error);
  if (fuente === "csj") return { ...(await buscarCSJ({ texto, ...filtros })), fuente };
  if (fuente === "ccc") return { ...(await buscarCCC({ texto, ...filtros })), fuente };
  return { ...(await buscarCE({ texto, corporacion: filtros.corporacion })), fuente };
}

export async function leerJuris(sentencia) {
  if (sentencia?.fuente === "ccc" && sentencia.url) return leerCCC(sentencia.url);
  if (sentencia?.fuente === "ce" && sentencia.token) return leerCE(sentencia.token);
  throw new Aviso("Esa sentencia todavía no tiene lectura directa: ábrala en el navegador desde su ficha.");
}

export function guardarJuris(db, sentencia, textoCompleto) {
  const cuerpo = String(textoCompleto || "").trim();
  if (!cuerpo) throw new Aviso("No hay texto para guardar.");
  return guardarPieza(db, {
    nombre: nombreFuente(sentencia),
    clase: "jurisprudencia",
    etiquetas: etiquetasFuente(sentencia),
    texto: cuerpo.slice(0, 600000),
    origen: [sentencia?.numero, sentencia?.providencia, sentencia?.proceso].filter(Boolean).join(" · ").slice(0, 200),
  });
}
