// Citas nativas de Anthropic. Reconstruye el texto y las citas a partir
// de los eventos SSE de la Messages API: content_block_start puede traer
// el arreglo citations, y content_block_delta trae text_delta o
// citations_delta. El rango es de caracteres en el texto final, no en la
// fuente. Documentación: citations y search results (2026).
import { mencionaNorma } from "./encargo.js";
import { escritoDeTexto, mencionaSentencia } from "./documentos.js";

export const MARCA_SIN_FUENTE = "Sin fuente, verificar";
export const TEXTO_REVISION = "Revisé hechos, citas y peticiones";
export const MODELO_REVISOR = "claude-haiku-5-5";
export const PEDIDO_REVISION = [
  "Revisa el borrador. Lista solo las afirmaciones de hecho o de derecho que no quedan respaldadas por las fuentes citables de este encargo.",
  "Una por línea, con el párrafo o la sección entre corchetes:",
  "- [Hechos] La EPS está obligada a entregar el medicamento.",
  "Si todas tienen respaldo en las fuentes, responde exactamente: Ninguna.",
  "Responde en texto. No uses JSON.",
].join("\n");

function paginaDe(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// pieza:<id> o archivo:<id>:<pagina>. Cualquier otro source queda tal cual.
export function leerFuente(source) {
  const s = String(source || "");
  const archivo = s.match(/^archivo:([^:]+):(\d+)$/);
  if (archivo) return { fuente_tipo: "archivo", fuente_id: archivo[1], pagina: paginaDe(archivo[2]) };
  const pieza = s.match(/^pieza:(.+)$/);
  if (pieza) return { fuente_tipo: "pieza", fuente_id: pieza[1], pagina: null };
  return { fuente_tipo: "search_result", fuente_id: s, pagina: null };
}

function documentoEn(documentos, indice) {
  const lista = Array.isArray(documentos) ? documentos : [];
  const doc = lista[Number(indice)];
  if (!doc) return { fuente_tipo: "documento", fuente_id: String(indice ?? ""), pagina: null, doc: null };
  return { fuente_tipo: doc.tipo || "archivo", fuente_id: String(doc.id ?? indice), pagina: null, doc };
}

export function normalizarCita(citation, documentos = []) {
  if (!citation || typeof citation !== "object") return null;
  const texto_citado = String(citation.cited_text || "");
  if (citation.type === "search_result_location") {
    const fuente = leerFuente(citation.source);
    return { ...fuente, texto_citado };
  }
  if (citation.type === "content_block_location") {
    const base = documentoEn(documentos, citation.document_index);
    const bloque = paginaDe(citation.start_block_index);
    const pagina = bloque == null ? null : (base.doc?.paginas?.[bloque] ?? bloque + 1);
    return { fuente_tipo: base.fuente_tipo, fuente_id: base.fuente_id, pagina, texto_citado };
  }
  if (citation.type === "page_location") {
    const base = documentoEn(documentos, citation.document_index);
    return { fuente_tipo: base.fuente_tipo, fuente_id: base.fuente_id, pagina: paginaDe(citation.start_page_number), texto_citado };
  }
  if (citation.type === "char_location") {
    const base = documentoEn(documentos, citation.document_index);
    return { fuente_tipo: base.fuente_tipo, fuente_id: base.fuente_id, pagina: null, texto_citado };
  }
  return null;
}

function asegurar(bloques, index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return null;
  if (!bloques[i]) bloques[i] = { texto: "", citas: [] };
  return bloques[i];
}

// Un evento ya parseado (el JSON de la línea data:).
export function aplicarEvento(bloques, evento) {
  if (!evento || typeof evento !== "object") return bloques;
  if (evento.type === "content_block_start") {
    const bloque = asegurar(bloques, evento.index);
    if (!bloque) return bloques;
    const cuerpo = evento.content_block || {};
    if (cuerpo.text) bloque.texto += String(cuerpo.text);
    if (Array.isArray(cuerpo.citations)) bloque.citas.push(...cuerpo.citations);
  } else if (evento.type === "content_block_delta") {
    const bloque = asegurar(bloques, evento.index);
    if (!bloque) return bloques;
    const delta = evento.delta || {};
    if (delta.type === "text_delta" && delta.text) bloque.texto += String(delta.text);
    if (delta.type === "citations_delta" && delta.citation) bloque.citas.push(delta.citation);
  }
  return bloques;
}

export function eventosDeSSE(flujo) {
  const eventos = [];
  let nombre = "";
  for (const linea of String(flujo || "").split("\n")) {
    const limpia = linea.trim();
    if (!limpia) {
      nombre = "";
      continue;
    }
    if (limpia.startsWith("event:")) {
      nombre = limpia.slice(6).trim();
      continue;
    }
    if (!limpia.startsWith("data:")) continue;
    const dato = limpia.slice(5).trim();
    if (dato === "[DONE]") break;
    try {
      const json = JSON.parse(dato);
      if (!json.type && nombre) json.type = nombre;
      eventos.push(json);
    } catch {
      /* trozo que no es JSON */
    }
    nombre = "";
  }
  return eventos;
}

export function reconstruirCitas(entrada, { documentos = [] } = {}) {
  const eventos = typeof entrada === "string" ? eventosDeSSE(entrada) : (Array.isArray(entrada) ? entrada : []);
  const bloques = [];
  for (const evento of eventos) aplicarEvento(bloques, evento);
  let cursor = 0;
  let texto = "";
  const citas = [];
  for (const bloque of bloques) {
    if (!bloque) continue;
    const inicio = cursor;
    texto += bloque.texto;
    cursor += bloque.texto.length;
    const fin = cursor;
    for (const cruda of bloque.citas) {
      const cita = normalizarCita(cruda, documentos);
      if (!cita) continue;
      citas.push({ inicio, fin, ...cita });
    }
  }
  return { texto, citas };
}

export function mencionaFuente(texto) {
  return mencionaNorma(texto) || mencionaSentencia(texto);
}

// Citas cuyo rango cae dentro de [offset, offset + fragmento). Los índices
// que devuelve son relativos al fragmento.
export function citasEnFragmento(fragmento, citas, offset = 0) {
  const texto = String(fragmento || "");
  const desde = Number(offset) || 0;
  const hasta = desde + texto.length;
  const local = [];
  for (const c of citas || []) {
    const a = Math.max(Number(c.inicio) || 0, desde);
    const b = Math.min(Number(c.fin) || 0, hasta);
    if (b <= a) continue;
    local.push({ ...c, inicio: a - desde, fin: b - desde });
  }
  return local;
}

function ubicarTrozo(visible, trozo) {
  const v = String(visible || "");
  const t = String(trozo || "");
  if (!t) return null;
  let i = v.indexOf(t);
  if (i >= 0) return { inicio: i, fin: i + t.length };
  const limpio = t.replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
  if (limpio.length < 2) return null;
  i = v.indexOf(limpio);
  return i >= 0 ? { inicio: i, fin: i + limpio.length } : null;
}

// Pasa un rango del markdown del párrafo al texto que se ve en la hoja.
export function proyectarCitas(markdown, visible, citas) {
  const base = String(markdown || "");
  const salida = [];
  for (const c of citas || []) {
    const puesto = ubicarTrozo(visible, base.slice(Number(c.inicio) || 0, Number(c.fin) || 0));
    if (puesto) salida.push({ ...c, inicio: puesto.inicio, fin: puesto.fin });
  }
  return salida;
}

// Párrafo que nombra una norma o una sentencia y ninguna cita nativa cubre
// ese tramo. No toca el texto: [Cita no aportada] sigue donde estaba.
export function parrafosSinFuente(parrafos, citas = []) {
  return (parrafos || []).map((p, indice) => {
    const texto = typeof p === "string" ? p : String(p?.texto || "");
    const inicio = typeof p === "string" ? 0 : Number(p?.inicio) || 0;
    const fin = inicio + texto.length;
    if (!mencionaFuente(texto)) return null;
    const cubierta = (citas || []).some((c) => Number(c.fin) > inicio && Number(c.inicio) < fin);
    if (cubierta) return null;
    return { indice, texto, inicio, fin, marca: MARCA_SIN_FUENTE };
  }).filter(Boolean);
}

// La revisión pide texto, no JSON. Acepta líneas «- [párrafo] afirmación»
// o «- Párrafo X: afirmación». «Ninguna» deja la lista vacía.
export function leerPendientes(texto) {
  const crudo = String(texto || "").trim();
  if (!crudo || /^ninguna\.?$/i.test(crudo)) return [];
  const pendientes = [];
  for (const linea of crudo.split("\n")) {
    const limpia = linea.trim();
    if (!limpia || /^ninguna\.?$/i.test(limpia)) continue;
    const marcada = limpia.match(/^(?:[-*•]|\d+[.)])\s*(?:\[([^\]]+)\]|p[aá]rrafo\s+([^:]{1,80}):)\s*(.+)$/i);
    if (marcada) {
      const afirmacion = String(marcada[3] || "").trim();
      if (afirmacion && !/^ninguna\.?$/i.test(afirmacion)) pendientes.push({ parrafo: String(marcada[1] || marcada[2] || "").trim(), afirmacion });
      continue;
    }
    const suelta = limpia.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (suelta && !/^ninguna\.?$/i.test(suelta[1])) pendientes.push({ parrafo: "", afirmacion: suelta[1].trim() });
  }
  return pendientes;
}

function corto(valor, max = 180) {
  const s = String(valor || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function entradasDeCuerpo(cuerpo) {
  const escrito = escritoDeTexto(cuerpo || "");
  let cursor = 0;
  const entradas = [];
  for (const s of escrito.secciones || []) {
    for (const p of s.parrafos || []) {
      const i = String(cuerpo || "").indexOf(p, cursor);
      const inicio = i >= 0 ? i : cursor;
      entradas.push({ texto: p, inicio, seccion: s.titulo || "" });
      cursor = inicio + String(p).length;
    }
  }
  return entradas;
}

// Lo que hay que mostrar antes de exportar. Vacío: se guarda sin preguntar.
export function avisosDeExportar({ pendientes = [], parrafos = [], citas = [] } = {}) {
  const lista = [];
  for (const p of pendientes || []) {
    const texto = corto(p?.afirmacion || p?.texto);
    if (!texto) continue;
    lista.push({ tipo: "revisor", parrafo: corto(p.parrafo, 80), texto });
  }
  for (const m of parrafosSinFuente(parrafos, citas)) {
    lista.push({ tipo: "sin_fuente", parrafo: corto(m.seccion || parrafos[m.indice]?.seccion || "", 80), texto: corto(m.texto), marca: MARCA_SIN_FUENTE });
  }
  return lista;
}

export function puedeExportar({ avisos = [], revisado = false, formato = "docx" } = {}) {
  const puerta = formato === "docx" || formato === "pdf" || formato === "odt";
  if (!puerta || !avisos.length) return { guardar: true, historial: false };
  if (revisado !== true) return { guardar: false, historial: false };
  return { guardar: true, historial: true };
}

export function notasDeCitas(cuerpo, citas = []) {
  const base = String(cuerpo || "");
  return (citas || []).map((c) => {
    const ancla = base.slice(Number(c.inicio) || 0, Number(c.fin) || 0).replace(/\s+/g, " ").trim();
    const partes = [c.texto_citado, c.titulo, c.pagina != null && c.pagina !== "" ? `página ${c.pagina}` : ""].map((x) => String(x || "").trim()).filter(Boolean);
    return { ancla, texto: partes.join(". ") };
  }).filter((n) => n.texto);
}

export function metricasDeCitas({ versiones = [], gastos = [] } = {}) {
  let conCita = 0;
  let sinFuente = 0;
  let hallazgos = 0;
  for (const v of versiones || []) {
    const citas = v.citas || [];
    conCita += citas.length;
    sinFuente += avisosDeExportar({ parrafos: entradasDeCuerpo(v.cuerpo), citas }).filter((a) => a.tipo === "sin_fuente").length;
    hallazgos += (v.pendientes || []).length;
  }
  const suma = (lista) => Math.round(lista.reduce((s, g) => s + (Number(g.costo) || 0), 0) * 1e6) / 1e6;
  const todos = gastos || [];
  return {
    conCita,
    sinFuente,
    hallazgos,
    costoRevisor: suma(todos.filter((g) => g.motivo === "revisor")),
    costo: suma(todos),
  };
}
