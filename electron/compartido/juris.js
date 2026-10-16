// Jurisprudencia: lógica pura (sin red ni base) para buscar sentencias en
// las relatorías y traerlas como fuentes de la biblioteca. La usan
// src/juris.js y los tests.
//
// Fuentes con búsqueda verificada en vivo (oct 2026):
// - csj: Corte Suprema, WebRelatoria JSF (sesión + ViewState, XML parcial)
// - ccc: Corte Constitucional, buscador_new JSON (Elasticsearch)
// - ce: Consejo de Estado y tribunales, SAMAI Titulación (WebForms delta)
export const FUENTES_JURIS = [
  {
    id: "csj",
    nombre: "Corte Suprema de Justicia",
    origen: "WebRelatoria · Rama Judicial",
    filtros: ["texto", "sala", "ponente", "radicado", "providencia", "fechaIni", "fechaFin", "tipo", "clase"],
    ayuda: "Escriba el tema con sus palabras. Con Más filtros suma sala, ponente, radicado, providencia, fechas, tipo o clase.",
  },
  {
    id: "ccc",
    nombre: "Corte Constitucional",
    origen: "Relatoría · buscador oficial",
    filtros: ["texto", "tipo", "fechaIni", "fechaFin"],
    ayuda: "Texto libre, tipo (T, C, SU, A o Auto) y fechas. Devuelve número, síntesis, ponente y enlace al texto.",
  },
  {
    id: "ce",
    nombre: "Consejo de Estado y tribunales",
    origen: "SAMAI · Titulación de providencias",
    filtros: ["texto", "corporacion"],
    ayuda: "Elija la corporación (Consejo de Estado o un tribunal) y escriba el tema. Trae ficha y texto por token.",
  },
];

export const SALAS_CSJ = [
  { id: "", nombre: "Todas las salas" },
  { id: "civil", nombre: "Civil, Agraria y Rural" },
  { id: "laboral", nombre: "Laboral" },
  { id: "penal", nombre: "Penal" },
  { id: "plena", nombre: "Sala Plena" },
];

export const TIPOS_CCC = [
  { id: "", nombre: "Todos los tipos" },
  { id: "T", nombre: "Tutela (T)" },
  { id: "C", nombre: "Constitucionalidad (C)" },
  { id: "SU", nombre: "Unificación (SU)" },
  { id: "A", nombre: "Auto (A)" },
];

// Corporaciones de Titulación conocidas; la lista viva se lee del sitio.
export const CORPORACIONES_CE_BASE = [
  { codigo: "1100103", nombre: "Consejo de Estado" },
  { codigo: "2500023", nombre: "Tribunal Administrativo de Cundinamarca" },
];

export function fuenteDe(id) {
  return FUENTES_JURIS.find((f) => f.id === id) || null;
}

// ---------- Limpieza de HTML sin DOM (corre también en Node) ----------

const ENTIDADES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", iquest: "¿", quest: "?", excl: "¡",
  uuml: "ü", Uuml: "Ü", ordf: "ª", ordm: "º", laquo: "«", raquo: "»",
  mdash: "—", ndash: "–", hellip: "…", oelig: "œ",
};

export function desentizar(valor) {
  return String(valor || "").replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (todo, cod) => {
    if (cod[0] === "#") {
      const n = cod[1] === "x" || cod[1] === "X" ? parseInt(cod.slice(2), 16) : parseInt(cod.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[cod] ?? todo;
  });
}

export function textoDeHtml(valor) {
  return desentizar(String(valor || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t\x0b\f\r]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

// ---------- Validación ----------

export function validarBusqueda({ fuente, texto, corporacion } = {}) {
  if (!fuenteDe(fuente)) return "Elija una fuente para buscar.";
  if (fuente === "ce" && !String(corporacion || "").trim()) return "Elija la corporación.";
  if (String(texto || "").trim().length < 3) return "Escriba al menos 3 letras del tema.";
  return "";
}

// ---------- Corte Suprema: XML parcial de JSF ----------

export function extraerViewStateCSJ(html) {
  const m = String(html || "").match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/)
    || String(html || "").match(/<update id="j_id1:javax\.faces\.ViewState:0">(.*?)<\/update>/s);
  return m ? m[1] : "";
}

export function extraerUpdate(xml, id) {
  const m = String(xml || "").match(new RegExp(`<update id="${id}">([\\s\\S]*?)<\\/update>`));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
}

export function totalCSJ(xml) {
  const m = extraerUpdate(xml, "resultForm:pagText2").match(/Resultado:\s*\d+\s*\/\s*([\d.,]+)/);
  return m ? Number(m[1].replace(/[.,]/g, "")) : 0;
}

const ETIQUETAS_CSJ = {
  "ID:": "id",
  "NÚMERO DE PROCESO:": "proceso",
  "NÚMERO DE PROVIDENCIA:": "providencia",
  "CLASE DE ACTUACIÓN:": "clase",
  "TIPO DE PROVIDENCIA:": "tipo",
  "FECHA:": "fecha",
  "PONENTE:": "ponente",
  "TEMA:": "tema",
};

const SALAS_CONOCIDAS = [
  "SALA DE CASACIÓN CIVIL, AGRARIA Y RURAL",
  "SALA DE DESCONGESTIÓN LABORAL",
  "SALA DE CASACIÓN LABORAL",
  "SALA DE CASACIÓN PENAL",
  "SALA ESPECIAL DE PRIMERA INSTANCIA",
  "SALA ESPECIAL DE INSTRUCCIÓN",
  "SALA PLENA",
];

function partirSala(cabeza) {
  const mayus = cabeza.toUpperCase();
  for (const sala of SALAS_CONOCIDAS) {
    if (mayus.startsWith(sala)) {
      const resto = cabeza.slice(sala.length).trim();
      // "DESCONGESTIÓN LABORAL N.º 3" trae su número pegado.
      const numero = resto.match(/^(N\.º\s*\d+)\s*(.*)$/i);
      if (numero) return { sala: `${cabeza.slice(0, sala.length)} ${numero[1]}`.trim(), subtipo: numero[2].trim() };
      return { sala: cabeza.slice(0, sala.length).trim(), subtipo: resto };
    }
  }
  return { sala: cabeza, subtipo: "" };
}

export function filasCSJ(xml) {
  const tabla = extraerUpdate(xml, "resultForm:jurisTable");
  const filas = [];
  for (const m of tabla.matchAll(/<tr data-ri="\d+" data-rk="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    // La ficha a veces viene en un solo <td>: se trabaja el texto plano y
    // se corta por etiquetas conocidas. Los </td> se vuelven espacio para
    // no pegar celdas ("RURAL"+"TUTELA").
    const plano = textoDeHtml(m[2].replace(/<\/(td|th)\s*>/gi, " ")).replace(/\s+/g, " ").trim();
    const fila = { fuente: "csj", ref: m[1], sala: "", subtipo: "", tema: "" };
    const nombres = Object.keys(ETIQUETAS_CSJ);
    const cortes = [];
    const planoMayus = plano.toUpperCase();
    for (const nombre of nombres) {
      let desde = 0;
      for (;;) {
        const i = planoMayus.indexOf(nombre, desde);
        if (i < 0) break;
        // Evita falsos positivos dentro de palabras (p. ej. ID en OLVIDO).
        const antes = planoMayus[i - 1] || " ";
        if (/[\s(|]/.test(antes) || i === 0) {
          cortes.push({ nombre, pos: i });
          break;
        }
        desde = i + 1;
      }
    }
    cortes.sort((a, b) => a.pos - b.pos);
    if (cortes.length) {
      const cabeza = plano.slice(0, cortes[0].pos).trim();
      const partido = partirSala(cabeza);
      fila.sala = partido.sala;
      fila.subtipo = partido.subtipo;
    } else {
      fila.sala = plano;
    }
    for (let k = 0; k < cortes.length; k += 1) {
      const valor = plano.slice(cortes[k].pos + cortes[k].nombre.length, k + 1 < cortes.length ? cortes[k + 1].pos : undefined).trim();
      const clave = ETIQUETAS_CSJ[cortes[k].nombre];
      if (clave === "tema") fila.tema = valor;
      else if (clave && !(clave in fila && fila[clave])) fila[clave] = valor;
      else if (clave === "id" && !fila.id) fila.id = valor;
    }
    if (!fila.ref) continue;
    fila.titulo = [fila.providencia, fila.clase].filter(Boolean).join(" · ") || `Registro ${fila.ref}`;
    filas.push(fila);
  }
  return filas;
}

// ---------- Corte Constitucional: JSON ----------

export function normalizarCCC(origen) {
  const numero = String(origen?.prov_sentencia || "").trim();
  const ruta = String(origen?.rutahtml || "").trim();
  return {
    fuente: "ccc",
    ref: String(origen?.prov_id || numero || ""),
    numero,
    tipo: String(origen?.prov_tipo || ""),
    fecha: String(origen?.prov_f_sentencia || ""),
    magistrado: Array.isArray(origen?.prov_magistrados) ? origen.prov_magistrados.join(", ") : "",
    expediente: String(origen?.prov_expediente || ""),
    tema: String(origen?.prov_tema || ""),
    sintesis: String(origen?.prov_sintesis || ""),
    titulo: numero || "Sentencia",
    url: ruta ? `https://www.corteconstitucional.gov.co/relatoria/${ruta}` : "",
  };
}

// ---------- Consejo de Estado: delta de WebForms ----------

export function extraerAspx(html) {
  const campo = (nombre) => {
    const m = String(html || "").match(new RegExp(`name="${nombre}"[^>]*value="([^"]*)"`));
    return m ? m[1] : "";
  };
  return {
    viewstate: campo("__VIEWSTATE"),
    eventvalidation: campo("__EVENTVALIDATION"),
    generator: campo("__VIEWSTATEGENERATOR") || "7261BA90",
  };
}

export function corporacionesDe(html) {
  const sel = String(html || "").match(/<select[^>]*CorporacionesTitulanDataList[^>]*>([\s\S]*?)<\/select>/);
  if (!sel) return [];
  return [...sel[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)/g)]
    .map((m) => ({ codigo: m[1], nombre: textoDeHtml(m[2]).trim() }))
    .filter((c) => c.codigo && c.nombre);
}

export function panelDe(delta, panel) {
  const partes = String(delta || "").split("|");
  for (let i = 0; i < partes.length; i += 1) {
    if (partes[i] === "updatePanel" && partes[i + 1] === panel) return partes[i + 2] || "";
  }
  return "";
}

const ETIQUETAS_CE = {
  "Núm. del proceso:": "proceso",
  "Interno:": "interno",
  "Fecha proceso:": "fecha",
  "Clase del proceso:": "clase",
  "Titular:": "ponente",
  "Sala de decisión:": "sala",
  "Providencia del:": "providenciaDe",
  "Actor:": "actor",
  "Demandado:": "demandado",
};

export function itemsCE(delta) {
  const panel = panelDe(delta, "MainContent_PanelUpdate") || String(delta || "");
  // Cada providencia abre con su botón de orden (OrdenButton_N) y trae su
  // radicado (HypRadicado_N): esos son los límites limpios del ítem.
  const cortes = [...panel.matchAll(/OrdenButton_(\d+)/g)].map((m) => ({ indice: Number(m[1]), pos: m.index }));
  const marcas = new Map([...panel.matchAll(/HypRadicado_(\d+)/g)].map((m) => [Number(m[1]), m.index]));
  const items = [];
  for (let k = 0; k < cortes.length; k += 1) {
    const inicio = Math.max(0, panel.lastIndexOf("<", cortes[k].pos));
    const fin = k + 1 < cortes.length ? Math.max(inicio, panel.lastIndexOf("<", cortes[k + 1].pos)) : panel.length;
    const bloque = panel.slice(inicio, fin);
    if (!marcas.has(cortes[k].indice) && !/VerProvidencia\.aspx/.test(bloque)) continue;
    const item = { fuente: "ce", ref: `ce-${cortes[k].indice}`, tema: "" };
    const celdas = bloque.split(/<\/td>|<\/div>|<br\s*\/?>/i)
      .flatMap((c) => textoDeHtml(c).split("\n"))
      .map((c) => c.trim())
      .filter(Boolean);
    for (let i = 0; i < celdas.length; i += 1) {
      // La etiqueta y el valor a veces van en celdas seguidas y a veces en
      // la misma línea ("Interno: 2535-2023").
      let clave = ETIQUETAS_CE[celdas[i]];
      let valor = "";
      if (!clave) {
        const hallada = Object.keys(ETIQUETAS_CE).find((e) => celdas[i].startsWith(e));
        if (hallada) {
          clave = ETIQUETAS_CE[hallada];
          valor = celdas[i].slice(hallada.length).trim();
        }
      }
      if (clave) {
        if (!valor) {
          valor = (celdas[i + 1] || "").split("\n")[0].trim();
          // Un valor con < es un ancla cortada por el límite del bloque:
          // no asigna y no consume la celda siguiente.
          if (/[<>]/.test(valor)) continue;
          i += 1;
        }
        item[clave] = valor.split("\n")[0].trim();
      }
    }
    const guid = bloque.match(/list_procesos\.aspx\?guid=([0-9a-zA-Z]+)/);
    if (guid) item.guid = guid[1];
    if (!item.proceso) {
      const rad = bloque.match(/HypRadicado_\d+"[^>]*>([^<]+)/);
      if (rad) item.proceso = rad[1].trim();
    }
    const tokens = [...new Set([...bloque.matchAll(/VerProvidencia\.aspx\?tokenDocumento=([A-Za-z0-9_,\-]+)/g)].map((m) => m[1]))];
    if (tokens.length) item.token = tokens[0];
    if (tokens.length > 1) item.tokens = tokens;
    item.titulo = [item.proceso, item.clase].filter(Boolean).join(" · ") || "Providencia";
    if (item.proceso || item.token) items.push(item);
  }
  return items;
}

// ---------- Para guardar como fuente de la biblioteca ----------

export function nombreFuente(sentencia) {
  const base = sentencia?.numero || sentencia?.providencia || sentencia?.proceso || sentencia?.titulo || "Sentencia";
  const corp = sentencia?.fuente === "csj" ? "CSJ" : sentencia?.fuente === "ccc" ? "Corte Constitucional" : "Consejo de Estado";
  return `${base} · ${corp}`.slice(0, 120);
}

export function etiquetasFuente(sentencia) {
  const lista = [];
  if (sentencia?.tipo) lista.push(String(sentencia.tipo).toLowerCase().slice(0, 40));
  if (sentencia?.clase) lista.push(String(sentencia.clase).toLowerCase().slice(0, 40));
  if (sentencia?.sala) lista.push(String(sentencia.sala).toLowerCase().slice(0, 40));
  lista.push("jurisprudencia");
  return [...new Set(lista)].slice(0, 20);
}
