// SAMAI (Consejo de Estado): el certificado está bien, fetch normal.
// Sesión fresca (ASP.NET_SessionId) y POST JSON. Reintentos con espera.
import {
  SAMAI_BASE,
  SAMAI_BUSCAR,
  SAMAI_CORPORACIONES,
  esRadicadoSam,
  extraerActuacionesSam,
  extraerCamposSam,
  extraerDesafioSam,
  normalizarCriterioSam,
  parsearCorporacionesSam,
  parsearRespuestaSam,
} from "../compartido/samai.js";

const CABECERAS = {
  accept: "application/json",
  "content-type": "application/json",
  origin: SAMAI_BASE,
  referer: `${SAMAI_BASE}/`,
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
};

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

function guardarCookies(sesion, respuesta) {
  const hechas = typeof respuesta.headers?.getSetCookie === "function" ? respuesta.headers.getSetCookie() : [];
  if (!hechas.length || !sesion) return;
  const mapa = new Map();
  for (const par of String(sesion.cookies || "").split(/;\s*/).filter(Boolean)) {
    const i = par.indexOf("=");
    if (i > 0) mapa.set(par.slice(0, i), par.slice(i + 1));
  }
  for (const cruda of hechas) {
    const par = String(cruda).split(";")[0];
    const i = par.indexOf("=");
    if (i > 0) mapa.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
  sesion.cookies = [...mapa].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function post(sesion, url, cuerpo, veces = 3) {
  let ultimo = "sin respuesta";
  for (let intento = 1; intento <= veces; intento++) {
    try {
      const cabeceras = { ...CABECERAS };
      if (sesion.cookies) cabeceras.cookie = sesion.cookies;
      const respuesta = await fetch(url, {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(90000),
      });
      const hechas = typeof respuesta.headers?.getSetCookie === "function" ? respuesta.headers.getSetCookie() : [];
      if (hechas.length) {
        sesion.cookies = hechas.map((c) => String(c).split(";")[0]).join("; ");
      }
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
      return await respuesta.json();
    } catch (error) {
      ultimo = String(error?.message || error);
      await dormir(intento * 2000);
    }
  }
  throw new Error(ultimo);
}

export async function abrirSesionSam() {
  const sesion = { cookies: "" };
  const respuesta = await fetch(SAMAI_BASE, { headers: { "user-agent": CABECERAS["user-agent"] }, signal: AbortSignal.timeout(90000) });
  guardarCookies(sesion, respuesta);
  await respuesta.arrayBuffer().catch(() => null);
  return sesion;
}

function cuerpoBase(criterio, corporacion, pagina) {
  return {
    tipoBusqueda: esRadicadoSam(criterio) ? "radicado" : "parte",
    criterio: normalizarCriterioSam(criterio),
    fraseExacta: false,
    ambito: "corporacion",
    corporacion: String(corporacion || ""),
    seccion: "",
    ponente: "",
    fechaDesde: "",
    fechaHasta: "",
    estado: "",
    tipoParte: "",
    pagina,
    tamanoPagina: 10,
  };
}

export async function buscarSam(sesion, criterio, corporacion, pagina = 1) {
  const limpio = normalizarCriterioSam(criterio);
  if (!limpio) throw new Error("Escriba la cédula o el radicado.");
  const datos = await post(sesion, SAMAI_BUSCAR, cuerpoBase(limpio, corporacion, pagina));
  if (datos?.ok === false) throw new Error("La búsqueda no devolvió resultados.");
  return parsearRespuestaSam(datos);
}

export async function corporacionesSam(sesion) {
  const cabeceras = { ...CABECERAS, accept: "application/json" };
  if (sesion?.cookies) cabeceras.cookie = sesion.cookies;
  const respuesta = await fetch(SAMAI_CORPORACIONES, {
    headers: cabeceras,
    signal: AbortSignal.timeout(90000),
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  return parsearCorporacionesSam(await respuesta.json());
}

// Actuaciones: GET al detalle, junta los Lbldato sin espacios y devuelve
// el formulario WebForms. Con pausa, porque es lo que retrasa el sitio.
export async function actuacionesSam(sesion, guid, pausaMs = 2000) {
  const url = `${SAMAI_BASE}/Vistas/Casos/list_procesos.aspx?guid=${encodeURIComponent(guid)}`;
  const cabeceras = { ...CABECERAS, accept: "text/html" };
  if (sesion?.cookies) cabeceras.cookie = sesion.cookies;
  const primera = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(120000) });
  if (!primera.ok) throw new Error(`HTTP ${primera.status}`);
  guardarCookies(sesion, primera);
  const html = await primera.text();
  const desafio = extraerDesafioSam(html);
  if (!desafio) throw new Error("El detalle no trae el desafío.");
  const campos = extraerCamposSam(html);
  campos.__EVENTTARGET = "";
  campos.__EVENTARGUMENT = "";
  campos["ctl00$MainContent$TxtCaptcha2"] = desafio;
  campos["ctl00$MainContent$CmdNoRobot"] = "Continuar";
  await new Promise((r) => setTimeout(r, pausaMs));
  const cuerpo = new URLSearchParams(campos).toString();
  const segunda = await fetch(url, {
    method: "POST",
    headers: { ...cabeceras, "content-type": "application/x-www-form-urlencoded" },
    body: cuerpo,
    signal: AbortSignal.timeout(180000),
  });
  if (!segunda.ok) throw new Error(`HTTP ${segunda.status}`);
  return extraerActuacionesSam(await segunda.text());
}
