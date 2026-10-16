// SAMAI (Consejo de Estado): POST JSON a Jprocesos.ashx/buscar.
// Responde {ok, data:{items, page, pageSize, total, totalPages}}.
// El detalle (actuaciones) pide captcha, así que la búsqueda trae la ficha
// con las partes y el detalle se abre en el navegador.

export const SAMAI_BASE = "https://samai.consejodeestado.gov.co";
export const SAMAI_BUSCAR = `${SAMAI_BASE}/Vistas/Casos/Jprocesos.ashx/buscar`;
export const SAMAI_CORPORACIONES = `${SAMAI_BASE}/Vistas/Casos/Jprocesos.ashx/corporaciones`;

export function normalizarCriterioSam(valor) {
  return String(valor || "").trim();
}

export function esRadicadoSam(criterio) {
  return /^\d{21}$|^\d{23}$/.test(normalizarCriterioSam(criterio).replace(/\D/g, ""));
}

export function parsearProcesoSam(item) {
  const identidad = item?.identidadDespacho || {};
  return {
    radicado: String(item?.radicado || ""),
    corporacion: String(item?.corporacion || ""),
    guid: String(item?.guid || ""),
    ponente: String(item?.ponente || ""),
    despacho: String(item?.nombreDespachoOperativo || item?.despacho || ""),
    despacho_lindo: String(identidad.officeName || item?.nombreDespachoOperativo || ""),
    titular: String(identidad.currentHolder || ""),
    clase: String(item?.clase || ""),
    fecha_ingreso: String(item?.fechaIngreso || ""),
    vigente: String(item?.vigente || ""),
    asunto: String(item?.asunto || "").replace(/\s+/g, " ").trim(),
    demandante: String(item?.demandante || ""),
    demandado: String(item?.demandado || ""),
    url_detalle: String(item?.urlDetalle || ""),
  };
}

export function parsearRespuestaSam(datos) {
  const data = datos?.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    procesos: items.map(parsearProcesoSam),
    pagina: Number(data.page) || 1,
    total: Number(data.total) || 0,
    paginas: Number(data.totalPages) || 0,
  };
}

export function parsearCorporacionesSam(datos) {
  const lista = Array.isArray(datos) ? datos : datos?.data || [];
  return lista
    .filter((c) => c && c.value)
    .map((c) => ({ codigo: String(c.value), nombre: String(c.text || c.value) }));
}

// El "no soy un robot": junta los textos de Lbldato1..N sin espacios.
export function extraerDesafioSam(html) {
  const partes = [];
  const patron = /id="MainContent_LbldatoN?\d*"[^>]*>([^<]*)</g;
  let m = null;
  while ((m = patron.exec(String(html || ""))) !== null) partes.push(m[1]);
  return partes.join("").replace(/\s+/g, "");
}

export function extraerCamposSam(html) {
  const campos = {};
  const patron = /<input[^>]*name="([^"]+)"[^>]*>/g;
  let m = null;
  while ((m = patron.exec(String(html || ""))) !== null) {
    const valor = m[0].match(/value="([^"]*)"/);
    campos[m[1]] = valor ? valor[1] : "";
  }
  return campos;
}

function celdas(fila) {
  const out = [];
  const patron = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
  let m = null;
  while ((m = patron.exec(fila)) !== null) {
    out.push(m[1].replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim());
  }
  return out;
}

export function extraerActuacionesSam(html) {
  const tabla = String(html || "").match(/<table[^>]*id="MainContent_GridViewHistoricoActuaciones"[\s\S]*?<\/table>/);
  if (!tabla) return [];
  const filas = tabla[0].match(/<tr[\s\S]*?<\/tr>/g) || [];
  const actos = [];
  for (const fila of filas.slice(1)) {
    const c = celdas(fila);
    if (c.length < 8 || !c[1]) continue;
    actos.push({
      fecha_registro: c[1] || "",
      fecha: c[2] || "",
      actuacion: c[3] || "",
      anotacion: c[4] || "",
      estado: c[5] || "",
      anexos: c[6] || "",
      indice: c[7] || "",
    });
  }
  return actos;
}
