// Módulo Documentos: lógica pura (sin base ni red) para redactar por
// conversación. La usa src/documentos.js y la prueban los tests.
import { LINEAMIENTOS, MAX_DUDAS, clasificarRespuesta, marcarCitas, partirEscrito } from "./encargo.js";

export const TIPOS_DOCUMENTO = [
  { id: "tutela", nombre: "Tutela" },
  { id: "peticion", nombre: "Derecho de petición" },
  { id: "demanda", nombre: "Demanda" },
  { id: "contestacion", nombre: "Contestación" },
  { id: "recurso", nombre: "Recurso" },
  { id: "memorial", nombre: "Memorial" },
  { id: "contrato", nombre: "Contrato" },
  { id: "concepto", nombre: "Concepto" },
  { id: "poder", nombre: "Poder" },
  { id: "otro", nombre: "Otro" },
];

// La biblioteca es la tabla pieza. Su columna tipo tiene un CHECK de la
// migración 5 (plantilla, ejemplo, norma, estilo); la clase de Documentos
// vive en la columna clase y se traduce a un tipo válido.
export const CLASES_FUENTE = [
  { id: "ley", nombre: "Ley o norma", tipo: "norma" },
  { id: "jurisprudencia", nombre: "Jurisprudencia", tipo: "norma" },
  { id: "doctrina", nombre: "Doctrina", tipo: "norma" },
  { id: "modelo", nombre: "Modelo propio", tipo: "ejemplo" },
  { id: "nota", nombre: "Nota", tipo: "estilo" },
];

export function claseDePieza(pieza) {
  const clase = String(pieza?.clase || "");
  if (CLASES_FUENTE.some((item) => item.id === clase)) return clase;
  if (pieza?.tipo === "norma") return "ley";
  if (pieza?.tipo === "plantilla" || pieza?.tipo === "ejemplo") return "modelo";
  return "nota";
}

export function tipoDeClase(clase) {
  return CLASES_FUENTE.find((item) => item.id === clase)?.tipo || "";
}

export function nombreTipo(id) {
  return TIPOS_DOCUMENTO.find((tipo) => tipo.id === id)?.nombre || "Otro";
}

export function leerEtiquetas(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor || "").split(",");
  const vistas = new Set();
  const salida = [];
  for (const crudo of lista) {
    const limpia = String(crudo || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40);
    if (limpia && !vistas.has(limpia)) {
      vistas.add(limpia);
      salida.push(limpia);
    }
  }
  return salida.slice(0, 20);
}

// ---------- Recuperación: trozos y BM25 local ----------

const VACIAS = new Set(("de la el en y a los las del al se que por con para un una su sus este esta esto como mas pero sin sobre entre hasta desde donde cuando muy o u e lo le les es son fue ser ha han no si ya me mi").split(" "));

export function normalizar(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function terminos(valor) {
  return normalizar(valor)
    .split(/[^a-z0-9ñ-]+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t && (t.length > 2 || /\d/.test(t)) && !VACIAS.has(t));
}

// Parte el texto en trozos de cerca de `tamano` caracteres, por párrafos;
// un párrafo más largo se corta por frases. Cada trozo guarda su orden.
export function trocear(textoFuente, { tamano = 1200, solape = 150 } = {}) {
  const limpio = String(textoFuente || "").replace(/\r\n/g, "\n").trim();
  if (!limpio) return [];
  const piezas = [];
  for (const parrafo of limpio.split(/\n\s*\n|\n(?=\s*(?:art[ií]culo|articulo)\s+\d)/i)) {
    const p = parrafo.replace(/\s+/g, " ").trim();
    if (!p) continue;
    if (p.length <= tamano) {
      piezas.push(p);
      continue;
    }
    let actual = "";
    for (const frase of p.split(/(?<=[.;:])\s+/)) {
      if (actual && actual.length + frase.length + 1 > tamano) {
        piezas.push(actual);
        actual = actual.slice(Math.max(0, actual.length - solape));
      }
      actual = actual ? `${actual} ${frase}` : frase;
      while (actual.length > tamano * 1.5) {
        piezas.push(actual.slice(0, tamano));
        actual = actual.slice(tamano - solape);
      }
    }
    if (actual) piezas.push(actual);
  }
  const trozos = [];
  let actual = "";
  for (const p of piezas) {
    if (actual && actual.length + p.length + 2 > tamano) {
      trozos.push(actual);
      actual = "";
    }
    actual = actual ? `${actual}\n\n${p}` : p;
  }
  if (actual) trozos.push(actual);
  return trozos.map((texto, orden) => ({ orden, texto }));
}

// BM25 sobre los trozos de todas las fuentes. Devuelve los mejores
// fragmentos que caben en `presupuesto` caracteres, en orden de la fuente.
export function fragmentosRelevantes(fuentes, consulta, { presupuesto = 6000, tamano = 1200, k1 = 1.4, b = 0.75 } = {}) {
  const trozos = [];
  for (const fuente of fuentes || []) {
    const cuerpo = String(fuente?.texto || "");
    if (!cuerpo.trim()) continue;
    if (cuerpo.length <= Math.min(presupuesto / 3, tamano)) {
      trozos.push({ fuente, orden: 0, texto: cuerpo.trim(), entero: true });
      continue;
    }
    for (const trozo of trocear(cuerpo, { tamano })) trozos.push({ fuente, ...trozo, entero: false });
  }
  if (!trozos.length) return [];
  const pregunta = [...new Set(terminos(consulta))];
  const docs = trozos.map((trozo) => {
    const lista = terminos(`${trozo.fuente?.nombre || ""} ${trozo.texto}`);
    const tf = new Map();
    for (const t of lista) tf.set(t, (tf.get(t) || 0) + 1);
    return { trozo, tf, largo: lista.length || 1 };
  });
  const promedio = docs.reduce((suma, d) => suma + d.largo, 0) / docs.length;
  const df = new Map();
  for (const t of pregunta) df.set(t, docs.filter((d) => d.tf.has(t)).length);
  for (const d of docs) {
    let puntaje = 0;
    for (const t of pregunta) {
      const f = d.tf.get(t) || 0;
      if (!f) continue;
      const n = df.get(t) || 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      puntaje += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.largo / promedio))));
    }
    if (d.trozo.entero) puntaje += 0.5;
    d.puntaje = puntaje;
  }
  // Una fuente corta (una nota, un estilo) entra entera antes que los
  // trozos: cuesta poco y suele ser una instrucción del usuario.
  const ordenados = [...docs].sort((x, y) => (y.trozo.entero - x.trozo.entero) || y.puntaje - x.puntaje || x.trozo.orden - y.trozo.orden);
  const mejor = Math.max(0, ...docs.filter((d) => !d.trozo.entero).map((d) => d.puntaje));
  const piso = mejor * 0.25;
  const elegidos = [];
  let usado = 0;
  for (const d of ordenados) {
    // Un trozo que apenas coincide no gasta contexto; sin consulta útil se
    // toma el comienzo de cada fuente.
    if (!d.trozo.entero && mejor > 0 && d.puntaje < piso) continue;
    const largo = d.trozo.texto.length;
    if (usado + largo > presupuesto) continue;
    elegidos.push({ ...d.trozo, puntaje: Number(d.puntaje.toFixed(4)) });
    usado += largo;
  }
  const posicion = new Map((fuentes || []).map((fuente, i) => [fuente, i]));
  return elegidos.sort((x, y) => (posicion.get(x.fuente) - posicion.get(y.fuente)) || x.orden - y.orden);
}

export function bloqueDeFragmentos(fragmentos) {
  if (!fragmentos.length) return "(No hay fuentes elegidas para este proyecto.)";
  const grupos = new Map();
  for (const f of fragmentos) {
    const clave = f.fuente;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(f);
  }
  return [...grupos.entries()].map(([fuente, lista]) => {
    const clase = CLASES_FUENTE.find((c) => c.id === claseDePieza(fuente))?.nombre || "Fuente";
    const cuerpo = lista.map((f) => (f.entero ? f.texto : `[Fragmento ${f.orden + 1}] ${f.texto}`)).join("\n\n");
    return `### ${fuente.nombre} (${clase})\n${cuerpo}`;
  }).join("\n\n");
}

// ---------- El documento como texto ----------

export function textoDeEscrito(escrito) {
  const lineas = [];
  if (escrito?.asunto) lineas.push(`Asunto: ${escrito.asunto}`, "");
  for (const seccion of escrito?.secciones || []) {
    lineas.push(`## ${seccion.titulo}`);
    for (const p of seccion.parrafos || []) lineas.push(p, "");
    if (!(seccion.parrafos || []).length) lineas.push("");
  }
  return lineas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function escritoDeTexto(cuerpo) {
  return partirEscrito(cuerpo);
}

// ---------- Citas ----------

const SENTENCIA = String.raw`\b(?:sentencia\s+)?(?:T|C|SU|A)-\d{2,4}(?:\s+de\s+(?:\d{4}|\d{2}))?|\bsentencia\s+(?:de\s+)?(?:casaci[oó]n\s+)?(?:SL|SC|STC|STL|SP)\s?\d+(?:-\d{4})?`;

function nucleoSentencia(cita) {
  const n = normalizar(cita).replace(/^sentencia\s+/, "").replace(/\s+/g, " ").trim();
  const m = n.match(/^(t|c|su|a)-(\d+)(?:\s+de\s+(\d+))?/);
  if (m) return { codigo: `${m[1]}-${m[2]}`, anio: m[3] || "" };
  return { codigo: n.replace(/^(?:de\s+)?(?:casacion\s+)?/, ""), anio: "" };
}

function fuenteTieneSentencia(base, { codigo, anio }) {
  const escapado = codigo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(^|[^a-z0-9])${escapado}([^0-9]|$)`).test(base)) return false;
  if (!anio) return true;
  const corto = anio.length === 2 ? anio : anio.slice(2);
  return new RegExp(`${escapado}\\s*(?:de|/)?\\s*(?:\\d{2})?${corto}`).test(base) || base.includes(anio);
}

// marcarCitas del escrito cubre artículo, ley y decreto; aquí se suman las
// sentencias de la Corte Constitucional y de casación.
export function marcarCitasDocumento(secciones, fuentes) {
  const base = normalizar(fuentes).replace(/\s+/g, " ");
  const conLeyes = marcarCitas(secciones, fuentes);
  return conLeyes.map((seccion) => ({
    ...seccion,
    parrafos: seccion.parrafos.map((parrafo) => String(parrafo).replace(new RegExp(SENTENCIA, "gi"), (match, offset, todo) => {
      const despues = todo.slice(offset + match.length, offset + match.length + 22);
      if (/^\s*\[Cita no aportada\]/.test(despues)) return match;
      return fuenteTieneSentencia(base, nucleoSentencia(match)) ? match : `${match} [Cita no aportada]`;
    })),
  }));
}

export function contarAvisos(secciones) {
  let citas = 0;
  let datos = 0;
  for (const s of secciones || []) {
    for (const p of s.parrafos || []) {
      citas += (String(p).match(/\[Cita no aportada\]/g) || []).length;
      datos += (String(p).match(/\[Dato pendiente[^\]]*\]/g) || []).length;
    }
  }
  return { citas, datos };
}

// ---------- Diferencias entre versiones ----------

export function parrafosDe(cuerpo) {
  if (!String(cuerpo || "").trim()) return [];
  const escrito = escritoDeTexto(cuerpo);
  const lista = [];
  if (escrito.asunto) lista.push({ seccion: "Asunto", texto: escrito.asunto });
  for (const s of escrito.secciones) {
    lista.push({ seccion: s.titulo, texto: `## ${s.titulo}`, titulo: true });
    for (const p of s.parrafos) lista.push({ seccion: s.titulo, texto: p });
  }
  return lista;
}

function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const tabla = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      tabla[i][j] = a[i] === b[j] ? tabla[i + 1][j + 1] + 1 : Math.max(tabla[i + 1][j], tabla[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: "igual", i, j });
      i += 1;
      j += 1;
    } else if (tabla[i + 1][j] >= tabla[i][j + 1]) {
      ops.push({ op: "quitado", i });
      i += 1;
    } else {
      ops.push({ op: "agregado", j });
      j += 1;
    }
  }
  while (i < n) ops.push({ op: "quitado", i: i++ });
  while (j < m) ops.push({ op: "agregado", j: j++ });
  return ops;
}

// Diferencia por párrafo. Un quitado seguido de un agregado en la misma
// sección se muestra como cambiado. Se agrupa por sección.
export function diferencias(antes, despues) {
  const a = parrafosDe(antes);
  const b = parrafosDe(despues);
  const ops = lcs(a.map((p) => p.texto.trim()), b.map((p) => p.texto.trim()));
  const salida = [];
  for (let k = 0; k < ops.length; k += 1) {
    const op = ops[k];
    if (op.op === "igual") {
      salida.push({ tipo: "igual", seccion: b[op.j].seccion, texto: b[op.j].texto });
    } else if (op.op === "quitado") {
      const sig = ops[k + 1];
      if (sig?.op === "agregado" && !a[op.i].titulo && !b[sig.j].titulo) {
        salida.push({ tipo: "cambiado", seccion: b[sig.j].seccion, antes: a[op.i].texto, texto: b[sig.j].texto });
        k += 1;
      } else {
        salida.push({ tipo: "quitado", seccion: a[op.i].seccion, texto: a[op.i].texto });
      }
    } else {
      salida.push({ tipo: "agregado", seccion: b[op.j].seccion, texto: b[op.j].texto });
    }
  }
  const secciones = [];
  for (const item of salida) {
    let grupo = secciones[secciones.length - 1];
    if (!grupo || grupo.seccion !== item.seccion) {
      grupo = { seccion: item.seccion, cambios: [] };
      secciones.push(grupo);
    }
    grupo.cambios.push(item);
  }
  const cuenta = { agregado: 0, quitado: 0, cambiado: 0 };
  for (const item of salida) if (item.tipo in cuenta) cuenta[item.tipo] += 1;
  return { cambios: salida, secciones, cuenta };
}

// ---------- Pasaje elegido ----------

export function reemplazarPasaje(cuerpo, pasaje, nuevo) {
  const texto = String(cuerpo || "");
  const viejo = String(pasaje || "");
  if (!viejo.trim()) return null;
  const donde = texto.indexOf(viejo);
  if (donde < 0 || texto.indexOf(viejo, donde + 1) >= 0) return null;
  const limpio = String(nuevo || "").replace(/^```[a-z]*\n?|```$/g, "").trim().replace(/^["“«]|["”»]$/g, "");
  if (!limpio) return null;
  return texto.slice(0, donde) + limpio + texto.slice(donde + viejo.length);
}

// ---------- El encargo de cada vuelta ----------

const FORMA = [
  "Responde solo el documento completo, con este formato:",
  "Asunto: título breve",
  "",
  "## Título de la sección",
  "Párrafos de esa sección.",
  "",
  "No escribas comentarios, notas ni instrucciones fuera del documento.",
];

const PROPIOS = [
  "Escribe en español de Colombia, con el registro jurídico que corresponde al tipo de documento.",
  "Las sentencias y la doctrina también son citas: solo cítalas si están en las fuentes, en el expediente o en los mensajes del usuario. Si no, escribe [Cita no aportada] o no la cites.",
  "No uses rayas, flechas, comillas curvas ni puntos medios; usa comas, y, a.",
];

function recortar(valor, max) {
  const t = String(valor || "").trim();
  return t.length > max ? `${t.slice(0, max)}\n[...]` : t;
}

export function presupuestoDe(origen) {
  // Un GGUF corre con contexto pequeño (tamanoDeContexto en ia.js): se
  // mandan menos fuentes y menos historia que a la nube.
  return origen === "nube"
    ? { fuentes: 24000, historia: 8000, documento: 30000, expediente: 6000 }
    : { fuentes: 3500, historia: 1500, documento: 6000, expediente: 2000 };
}

export function armarEncargoDocumento({
  tipo, perfil, expediente, fragmentos, historia = [], documento = "", pedido, hoy, origen, aclaracion, cerrar = false,
} = {}) {
  const lim = presupuestoDe(origen);
  const nombre = nombreTipo(tipo);
  const lineas = [
    `Eres un abogado colombiano y redactas un documento de tipo ${nombre}. El usuario te pide cambios en cada mensaje y tú entregas el documento completo ya corregido.`,
  ];
  if (perfil?.instrucciones) lineas.push("", `Perfil ${perfil.nombre || ""}:`.trim(), String(perfil.instrucciones).trim());
  if (perfil?.estilo) lineas.push("", "Estilo:", String(perfil.estilo).trim());
  lineas.push("", "Lineamientos, que no puedes omitir:");
  const reglas = [...LINEAMIENTOS.slice(0, 3), ...PROPIOS];
  if (["tutela", "peticion", "demanda", "contestacion", "recurso", "memorial"].includes(tipo)) reglas.push(LINEAMIENTOS[3].replace("memorial", "escrito"));
  reglas.forEach((r, i) => lineas.push(`${i + 1}. ${r.replaceAll("en la biblioteca, en la petición", "en las fuentes, en los mensajes")}`));
  lineas.push("");
  const actual = String(documento || "").trim();
  if (cerrar || actual) {
    lineas.push(...FORMA);
    if (cerrar) lineas.push("", "No hagas más preguntas. Si aún falta un dato, escríbelo como [Dato pendiente: ...].");
  } else {
    lineas.push(
      ...FORMA,
      "",
      "Solo si falta un dato que cambie el documento (qué se pide, contra quién, qué derecho o un plazo), no redactes y responde únicamente así:",
      "DUDAS:",
      "1. pregunta",
      "",
      `Máximo ${MAX_DUDAS} preguntas. Un dato menor va como [Dato pendiente: ...].`,
    );
  }
  if (hoy) lineas.push("", `Fecha: ${hoy}`);
  lineas.push("", "Expediente:", recortar(expediente, lim.expediente) || "(Sin expediente vinculado.)");
  lineas.push("", "Fuentes del usuario (solo estas se pueden citar):", recortar(bloqueDeFragmentos(fragmentos || []), lim.fuentes + 2000));
  const previos = [];
  let usado = 0;
  for (const m of [...historia].reverse()) {
    const linea = `${m.rol === "usuario" ? "Usuario" : "Asistente"}: ${String(m.texto || "").trim()}`;
    if (usado + linea.length > lim.historia) break;
    previos.unshift(linea);
    usado += linea.length;
  }
  if (previos.length) lineas.push("", "Conversación anterior:", ...previos);
  if (actual) lineas.push("", "Documento actual (la base que debes corregir; conserva lo que el usuario no pidió cambiar):", recortar(actual, lim.documento));
  if (aclaracion?.respuesta) {
    lineas.push("", "Aclaración del usuario:");
    (aclaracion.preguntas || []).forEach((p, i) => lineas.push(`${i + 1}. ${p}`));
    lineas.push("Respuesta:", String(aclaracion.respuesta).trim());
  }
  lineas.push("", "Mensaje del usuario:", String(pedido || "").trim() || "Redacta el documento.");
  return lineas.join("\n");
}

export function armarEncargoPasaje({ tipo, perfil, documento, pasaje, pedido, fragmentos, origen } = {}) {
  const lim = presupuestoDe(origen);
  return [
    `Eres un abogado colombiano. En un documento de tipo ${nombreTipo(tipo)} debes reescribir solo el pasaje indicado.`,
    perfil?.estilo ? `Estilo: ${perfil.estilo}` : "",
    "Responde únicamente el pasaje nuevo, sin comillas ni comentarios. No cites normas ni sentencias que no estén en las fuentes o en el documento; si hace falta, escribe [Cita no aportada].",
    "",
    "Fuentes:",
    recortar(bloqueDeFragmentos(fragmentos || []), lim.fuentes),
    "",
    "Documento completo, para contexto:",
    recortar(documento, lim.documento),
    "",
    "Pasaje que debes reescribir:",
    String(pasaje || "").trim(),
    "",
    "Instrucción:",
    String(pedido || "").trim() || "Mejora la redacción.",
  ].filter((l, i, todo) => l !== "" || todo[i - 1] !== "").join("\n");
}

export function fuentesDeCitas({ expediente, fragmentos, historia, documentoPrevio, pedido, aclaracion } = {}) {
  // Lo que el documento puede citar: expediente, fragmentos enviados,
  // mensajes del usuario y lo que ya estaba en una versión que el usuario
  // aceptó o escribió.
  return [
    expediente,
    ...(fragmentos || []).map((f) => `${f.fuente?.nombre || ""}\n${f.texto}`),
    ...(historia || []).filter((m) => m.rol === "usuario").map((m) => m.texto),
    documentoPrevio,
    pedido,
    aclaracion?.respuesta,
  ].filter((p) => String(p || "").trim()).join("\n");
}

export function interpretarRespuesta(respuesta, { cerrar = false, fuentes = "" } = {}) {
  const c = clasificarRespuesta(respuesta, { cerrar });
  if (c.tipo === "dudas") return { tipo: "dudas", preguntas: c.preguntas };
  const secciones = marcarCitasDocumento(c.secciones, fuentes);
  if (!secciones.length) return { tipo: "vacio" };
  return { tipo: "documento", asunto: c.asunto, secciones, avisos: contarAvisos(secciones) };
}

// ---------- Plantilla básica (modelo Sencillo) ----------

const ESQUELETOS = {
  tutela: ["Hechos", "Derechos vulnerados", "Pretensiones", "Pruebas", "Juramento", "Notificaciones"],
  peticion: ["Objeto de la petición", "Razones", "Peticiones", "Documentos", "Notificaciones"],
  demanda: ["Partes", "Pretensiones", "Hechos", "Fundamentos de derecho", "Pruebas", "Cuantía", "Notificaciones"],
  contestacion: ["Pronunciamiento sobre los hechos", "Pronunciamiento sobre las pretensiones", "Excepciones", "Pruebas", "Notificaciones"],
  recurso: ["Providencia recurrida", "Sustentación", "Petición"],
  memorial: ["Contenido", "Petición"],
  contrato: ["Partes", "Objeto", "Obligaciones de las partes", "Valor y forma de pago", "Duración", "Terminación", "Firmas"],
  concepto: ["Pregunta", "Antecedentes", "Análisis", "Conclusión"],
  poder: ["Otorgamiento", "Facultades", "Aceptación"],
  otro: ["Contenido"],
};

export function plantillaBasica({ tipo, ficha = {}, pedido = "" } = {}) {
  const titulos = ESQUELETOS[tipo] || ESQUELETOS.otro;
  const secciones = [];
  const judicial = ["tutela", "demanda", "contestacion", "recurso", "memorial"].includes(tipo);
  if (judicial) {
    secciones.push({
      titulo: "Destinatario",
      parrafos: ["Señor Juez", ficha.despacho || "[Dato pendiente: despacho]", "E. S. D."],
    });
    const ref = [`Radicado: ${ficha.radicado || "[Dato pendiente: radicado]"}`];
    if (ficha.demandantes) ref.push(`Demandante: ${ficha.demandantes}`);
    if (ficha.demandados) ref.push(`Demandado: ${ficha.demandados}`);
    secciones.push({ titulo: "Referencia", parrafos: ref });
  }
  for (const titulo of titulos) {
    const parrafos = [`[Dato pendiente: ${titulo.toLowerCase()}]`];
    if (titulo === titulos[0] && String(pedido).trim()) parrafos.unshift(String(pedido).trim());
    secciones.push({ titulo, parrafos });
  }
  const firma = ficha.cliente ? [ficha.cliente, ficha.cedula ? `C.C. ${ficha.cedula}` : "", ficha.tarjeta ? `T.P. ${ficha.tarjeta}` : ""].filter(Boolean) : ["[Dato pendiente: firma]"];
  secciones.push({ titulo: "Cierre", parrafos: ["Atentamente,", "_______________________", ...firma] });
  return { asunto: nombreTipo(tipo), secciones };
}

// ---------- Perfiles sembrados ----------

export const PERFILES_SEMILLA = [
  {
    nombre: "Litigante laboral",
    instrucciones: "Actúas como litigante en derecho laboral y de la seguridad social. Ordena los hechos por fechas, identifica el vínculo laboral, los extremos y las acreencias. Pide con claridad cada pretensión.",
    estilo: "Formal, directo, con hechos numerados y peticiones numeradas. Trato de usted.",
    tipos: ["demanda", "tutela", "peticion", "recurso"],
  },
  {
    nombre: "Redactor de contratos",
    instrucciones: "Redactas contratos civiles y comerciales entre particulares. Define las partes, el objeto, las obligaciones, el precio, el plazo, las causales de terminación y la solución de controversias. No agregues cláusulas que el usuario no pidió sin decirlo en una cláusula clara.",
    estilo: "Cláusulas numeradas con título en mayúscula inicial. Lenguaje preciso y sin adornos.",
    tipos: ["contrato", "poder", "otro"],
  },
  {
    nombre: "Constitucionalista de tutelas",
    instrucciones: "Redactas acciones de tutela y derechos de petición. Explica la procedencia, la subsidiariedad y la inmediatez solo con lo que aportan el usuario y sus fuentes. Identifica el derecho fundamental y la autoridad o particular accionado.",
    estilo: "Claro y comprensible para el juez, párrafos cortos, peticiones concretas.",
    tipos: ["tutela", "peticion", "concepto"],
  },
];

export const AVISO_VERIFICAR = "Borrador de apoyo. Verifique los hechos y las citas antes de presentarlo.";
