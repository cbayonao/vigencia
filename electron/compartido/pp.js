// Publicaciones procesales: lo que no depende de Electron ni de la red.
// El portlet devuelve JSON para el catálogo y HTML para la búsqueda y el
// detalle. Cada despacho pinta distinto: no se ata a una tabla fija.

export const PP_BASE = "https://publicacionesprocesales.ramajudicial.gov.co";
export const PP_INICIO = `${PP_BASE}/web/publicaciones-procesales/inicio`;
export const PP_PORTLET = "co_com_avanti_efectosProcesales_PublicacionesEfectosProcesalesPortletV2_INSTANCE_BIyXQFHVaYaq";
export const PP_NS = `_${PP_PORTLET}_`;
export const PP_PORTLET_ID = 178845807;
export const PP_POR_PAGINA = 10;
export const PP_ULTIMAS_PAGINAS = 5;

// Solo las primeras páginas: el portlet ordena lo nuevo primero, así que
// las 5 primeras son lo último publicado. Pedir la cola traía lo más viejo
// (2024) en despachos con más de 50 publicaciones.
export function rangoPaginas(total, porPagina = PP_POR_PAGINA, ultimas = PP_ULTIMAS_PAGINAS) {
  const paginas = Math.max(1, Math.ceil(Number(total || 0) / porPagina));
  return { inicio: 1, fin: Math.min(paginas, ultimas), total: paginas };
}

// Nombre seguro para guardar el PDF en el PC del usuario.
export function nombreArchivoPdf(nombre) {
  const base = String(nombre || "documento").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  const limpio = base || "documento";
  return limpio.toLowerCase().endsWith(".pdf") ? limpio : `${limpio}.pdf`;
}

// Búsqueda avanzada: todas las palabras, en cualquier orden y sin tildes.
export function normalizarTexto(valor) {
  return String(valor || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function coincideBusqueda(texto, consulta) {
  const palabras = normalizarTexto(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return true;
  const base = normalizarTexto(texto);
  return palabras.every((palabra) => base.includes(palabra));
}

// Tipo grueso para segmentar listas largas (Bogotá trae cientos).
export function tipoDe(nombre) {
  const n = ` ${String(nombre || "").toUpperCase()} `;
  if (n.includes(" TRIBUNAL ")) return "Tribunales";
  if (n.includes(" JUZGADO ")) return "Juzgados";
  if (n.includes(" CORTE ") || n.includes(" CONSEJO ")) return "Cortes y consejos";
  return "Otros";
}

const ESPECIALIDADES = [
  ["Pequeñas causas", ["QUEÑAS CAUSAS"]],
  ["Penal", ["PENAL"]],
  ["Civil", ["CIVIL"]],
  ["Laboral", ["LABORAL"]],
  ["Familia", ["FAMILIA"]],
  ["Administrativo", ["ADMINISTRATIV"]],
  ["Disciplinario", ["DISCIPLIN"]],
  ["Promiscuo", ["PROMISCUO"]],
  ["Ejecución", ["EJECUCI"]],
  ["Restitución", ["RESTITUCI"]],
  ["Extinción", ["EXTINCI"]],
  ["Agrario", ["AGRARI"]],
  ["Aduanero", ["ADUANER"]],
];

export function especialidadDe(nombre) {
  const n = ` ${String(nombre || "").toUpperCase()} `;
  for (const [etiqueta, claves] of ESPECIALIDADES) {
    if (claves.some((k) => n.includes(k))) return etiqueta;
  }
  return "Otra";
}

// El código del despacho trae el DANE: depto(2) + municipio(3) + resto.
export function muniDe(codigo) {
  const digitos = String(codigo || "").replace(/\D/g, "");
  if (digitos.length < 5) return "";
  return digitos.slice(0, 5);
}

export function deptoDe(codigo) {
  return muniDe(codigo).slice(0, 2);
}

function limpiar(html) {
  return String(html || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function esDocumento(href) {
  const h = String(href || "").toLowerCase();
  return h.includes("get_file") || h.includes("/documents/") || h.includes(".pdf");
}

function enlaces(bloque, base = PP_BASE) {
  const docs = [];
  const patron = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  let m = null;
  while ((m = patron.exec(bloque)) !== null) {
    if (!esDocumento(m[1])) continue;
    let url = m[1].replace(/&amp;/g, "&");
    if (url.startsWith("/")) url = base + url;
    const nombre = limpiar(m[2]);
    if (url && nombre) docs.push({ nombre, url });
  }
  return docs;
}

const FECHA = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}-[a-z]{3}-\d{4}(?: \d{2}:\d{2}(?::\d{2})?)?|\d{1,2} [a-z]{3} \d{4})`;

// Filas `<tr class=" col-xs-12 tramites ">` (los espacios son literales).
export function extraerFilas(html) {
  const filas = [];
  const patron = /<tr class=" col-xs-12 tramites ".*?<\/tr>/gs;
  let m = null;
  while ((m = patron.exec(html || "")) !== null) filas.push(extraerFila(m[0]));
  return filas;
}

export function extraerFila(row) {
  let titulo = "";
  let url = "";
  let detalle = "";
  const patron = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  let m = null;
  while ((m = patron.exec(row)) !== null) {
    const texto = limpiar(m[2]);
    if (texto === "Ver detalle") detalle = m[1].replace(/&amp;/g, "&");
    else if (texto && !titulo) {
      titulo = texto;
      url = m[1].replace(/&amp;/g, "&");
    }
  }
  const tit = row.match(/title="([^"]+)"[^>]*>\s*Notificación/s);
  const categorias = {};
  const span = /<span class="categoria-ep">(.*?)<\/span>/gs;
  let s = null;
  while ((s = span.exec(row)) !== null) {
    const etiqueta = limpiar(s[1]);
    const corte = etiqueta.indexOf(":");
    if (corte > 0) categorias[etiqueta.slice(0, corte).trim()] = etiqueta.slice(corte + 1).trim();
  }
  const fecha = row.match(new RegExp(`<p class="publish-date">.*?(${FECHA})`, "s"));
  const articulo = (detalle.match(/articleId=(\d+)/) || [])[1] || "";
  return {
    titulo,
    titulo_attr: tit ? tit[1].replace(/&amp;/g, "&") : "",
    url,
    detalle_url: detalle,
    article_id: articulo,
    categorias,
    fecha: fecha ? fecha[1] : "",
  };
}

export function totalDe(html) {
  const m = String(html || "").match(/Mostrando el intervalo [0-9 -]+ de ([0-9.]+)/);
  return m ? Number(m[1].replace(/\./g, "")) : 0;
}

// Detalle: tabla tabla-docs-* con filas, o enlace en div.resumen-publicacion
// (la tabla viene vacía). Solo enlaces de documentos.
export function extraerDocumentos(html) {
  const docs = [];
  const vistos = new Set();
  const tablas = String(html || "").match(/<table[^>]*id="tabla-docs-[^"]*"[^>]*>.*?<\/table>/gs) || [];
  for (const tabla of tablas) {
    const filas = tabla.match(/<tr.*?<\/tr>/gs) || [];
    for (const fila of filas) {
      const fecha = (limpiar(fila).match(new RegExp(FECHA)) || [])[0] || "";
      for (const doc of enlaces(fila)) {
        if (vistos.has(doc.url)) continue;
        vistos.add(doc.url);
        docs.push({ ...doc, fecha, origen: "tabla" });
      }
    }
  }
  const resumenes = String(html || "").match(/<div class="[^"]*resumen-publicacion[^"]*".*?<\/div>\s*(?:<\/div>)?/gs) || [];
  let fechaMeta = "";
  const meta = String(html || "").match(/Fecha de publicación<\/b>.*?<p>(.*?)<\/p>/s);
  if (meta) fechaMeta = limpiar(meta[1]);
  for (const resumen of resumenes) {
    for (const doc of enlaces(resumen)) {
      if (vistos.has(doc.url)) continue;
      vistos.add(doc.url);
      docs.push({ ...doc, fecha: fechaMeta, origen: "resumen" });
    }
  }
  return docs;
}
