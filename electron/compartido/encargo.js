// Un solo encargo: el modelo escribe el memorial completo.
// Las piezas apagadas o quitadas para esta generación no entran.

export const LINEAMIENTOS = [
  "Los hechos, nombres, fechas, radicado y despacho salen del expediente o de lo que el usuario escribió. Si falta un dato, escribe [Dato pendiente: …].",
  "Una cita de artículo, ley o decreto solo entra si está en la biblioteca, en la petición o en el expediente. Si quieres citar algo que no está, escribe [Cita no aportada] o no la cites.",
  "No inventes una parte, un abogado ni una actuación. Si el expediente dice a quién representa el abogado, escribe desde ese lado. Si trae cédula, tarjeta profesional, dirección o teléfono del abogado o de quien representa, úsalos. Si no están, no los inventes.",
  "La respuesta es el memorial, en este orden: Señor Juez, el despacho y E. S. D.; la referencia en tres a cinco palabras, el radicado y las partes; quién presenta el escrito y el contenido que pidió el usuario; al final Atentamente y la firma. No abras secciones de relleno.",
];

function listaExcluir(excluir) {
  return new Set(
    (Array.isArray(excluir) ? excluir : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id)),
  );
}

export function piezasDelEncargo(piezas, excluir = []) {
  const fuera = listaExcluir(excluir);
  return (piezas || []).filter((pieza) => {
    if (!pieza || pieza.activa === false || pieza.activa === 0) return false;
    if (pieza.id != null && fuera.has(Number(pieza.id))) return false;
    return Boolean(String(pieza.texto || "").trim());
  });
}

export const MAX_DUDAS = 4;

const FORMA_MEMORIAL = [
  "Responde solo el memorial, con este formato:",
  "Asunto: título breve",
  "",
  "## Título de la sección",
  "Párrafos de esa sección.",
  "",
  "No escribas comentarios, notas ni instrucciones fuera del memorial.",
];

function respuestaAclaracion(aclaracion) {
  return String(aclaracion?.respuesta || "").trim();
}

function preguntasAclaracion(aclaracion) {
  return (Array.isArray(aclaracion?.preguntas) ? aclaracion.preguntas : [])
    .map((pregunta) => String(pregunta || "").trim())
    .filter(Boolean)
    .slice(0, MAX_DUDAS);
}

export function armarEncargo({ contexto, peticion, piezas, excluir, hoy, aclaracion, ejemplo, referencia } = {}) {
  const activas = piezasDelEncargo(piezas, excluir);
  const biblioteca = activas.length
    ? activas.map((pieza) => `### ${pieza.nombre} (${pieza.tipo})\n${String(pieza.texto).trim()}`).join("\n\n")
    : "(No hay piezas activas. Redacta solo con el expediente y la petición.)";
  const cerrar = Boolean(respuestaAclaracion(aclaracion));
  const lineas = [
    "Eres un abogado y redactas el escrito que el usuario va a presentar. El usuario aporta el contexto. Tú decides la estructura.",
    "",
    "Lineamientos, que no puedes omitir:",
    ...LINEAMIENTOS.map((linea, i) => `${i + 1}. ${linea}`),
    "",
  ];
  if (cerrar) {
    lineas.push(
      "Esta es la última vuelta. Entrega el memorial. No hagas más preguntas.",
      "Si aún falta un dato, escríbelo como [Dato pendiente: …].",
      "",
      ...FORMA_MEMORIAL,
    );
  } else {
    lineas.push(
      ...FORMA_MEMORIAL,
      "",
      "Solo si falta un dato que cambie el escrito (qué se pide, contra quién, qué derecho o un plazo), no redactes el memorial y responde únicamente así:",
      "DUDAS:",
      "1. pregunta",
      "2. pregunta",
      "",
      "Máximo cuatro preguntas. Un dato menor no se pregunta: va como [Dato pendiente: …] dentro del memorial.",
    );
  }
  if (hoy) lineas.push("", `Fecha: ${hoy}`);
  lineas.push(
    "",
    "Expediente:",
    String(contexto || "").trim() || "(Sin expediente.)",
    "",
    "Biblioteca del usuario:",
    biblioteca,
    "",
    "Petición del usuario:",
    String(peticion || "").trim() || "(Sin petición.)",
  );
  const corta = String(referencia || "").trim();
  if (corta) lineas.push("", `Referencia del escrito, úsala tal cual: ${corta}`);
  const adjunto = String(ejemplo || "").trim();
  if (adjunto) {
    lineas.push(
      "",
      "Memorial que el usuario adjuntó. Úsalo para entender la forma y los pormenores. No copies un dato que contradiga el expediente:",
      adjunto,
    );
  }
  if (cerrar) {
    const preguntas = preguntasAclaracion(aclaracion);
    lineas.push("", "Aclaración del usuario:");
    if (preguntas.length) {
      lineas.push("Preguntas:");
      preguntas.forEach((pregunta, i) => lineas.push(`${i + 1}. ${pregunta}`));
    }
    lineas.push("Respuesta:", respuestaAclaracion(aclaracion));
  }
  return lineas.join("\n");
}

export function fuentesDelEncargo({ contexto, peticion, piezas, excluir, aclaracion, ejemplo } = {}) {
  const activas = piezasDelEncargo(piezas, excluir);
  return [contexto, peticion, ejemplo, respuestaAclaracion(aclaracion), ...activas.map((pieza) => `${pieza.nombre}\n${pieza.texto}`)]
    .filter((parte) => String(parte || "").trim())
    .join("\n");
}

function limpiarCercas(texto) {
  const crudo = String(texto || "").replace(/\r\n/g, "\n").trim();
  const cerca = crudo.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  return cerca ? cerca[1].trim() : crudo;
}

function tituloLimpio(linea, max = 80) {
  return String(linea || "")
    .replace(/^[#*\s]+/, "")
    .replace(/[*#:\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function aParrafos(bloque) {
  return String(bloque || "")
    .split(/\n+/)
    .map((linea) => linea.trim())
    .filter((linea) => linea && !/^#{1,3}[ \t]+/.test(linea) && !/^[-*_]{3,}$/.test(linea));
}

export function partirEscrito(respuesta) {
  const crudo = limpiarCercas(respuesta);
  if (!crudo) return { asunto: "Escrito", secciones: [] };
  const lineas = crudo.split("\n");
  let cursor = 0;
  while (cursor < lineas.length && !lineas[cursor].trim()) cursor += 1;
  let asunto = "";
  const candidata = (lineas[cursor] || "").replace(/^\*+|\*+$/g, "").trim();
  const asuntoMatch = candidata.match(/^asunto\s*:\s*(.+)$/i);
  if (asuntoMatch) {
    asunto = tituloLimpio(asuntoMatch[1], 120);
    cursor += 1;
  }
  const cuerpo = lineas.slice(cursor).join("\n").trim();
  const marcas = [...cuerpo.matchAll(/^#{1,3}[ \t]+(.+)$/gm)];
  if (!marcas.length) {
    const parrafos = aParrafos(cuerpo);
    if (!parrafos.length) return { asunto: asunto || "Escrito", secciones: [] };
    return {
      asunto: asunto || "Escrito",
      secciones: [{ titulo: "Escrito", parrafos }],
    };
  }
  const secciones = [];
  const previo = aParrafos(cuerpo.slice(0, marcas[0].index));
  if (previo.length) secciones.push({ titulo: "Texto", parrafos: previo });
  for (let i = 0; i < marcas.length; i += 1) {
    const titulo = tituloLimpio(marcas[i][1]);
    const desde = marcas[i].index + marcas[i][0].length;
    const hasta = i + 1 < marcas.length ? marcas[i + 1].index : cuerpo.length;
    const parrafos = aParrafos(cuerpo.slice(desde, hasta));
    if (titulo && parrafos.length) secciones.push({ titulo, parrafos });
  }
  if (!secciones.length) {
    const parrafos = aParrafos(cuerpo);
    return {
      asunto: asunto || "Escrito",
      secciones: parrafos.length ? [{ titulo: "Escrito", parrafos }] : [],
    };
  }
  if (!asunto) {
    asunto = secciones.find((seccion) => seccion.titulo !== "Texto")?.titulo || "Escrito";
  }
  return { asunto: asunto.slice(0, 120), secciones };
}

function normalizar(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/art\.\s*/g, "articulo ")
    .replace(/\s+/g, " ")
    .trim();
}

function contieneNucleo(fuentes, nucleo) {
  const escapado = nucleo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escapado}([^a-z0-9]|$)`).test(fuentes);
}

function nucleoDe(cita) {
  const normal = normalizar(cita);
  const match = normal.match(/^(articulo|ley|decreto)\s+(\d+)/);
  return match ? `${match[1]} ${match[2]}` : normal;
}

const CITA = String.raw`\b(?:art(?:ículo|\.)\s*\d+|ley\s+\d+(?:\s+de\s+\d{4})?|decreto\s+\d+(?:\s+de\s+\d{4})?)`;

export function marcarCitas(secciones, fuentes) {
  const base = normalizar(fuentes);
  return (secciones || []).map((seccion) => ({
    ...seccion,
    parrafos: (seccion.parrafos || []).map((parrafo) => String(parrafo).replace(new RegExp(CITA, "gi"), (match, offset, todo) => {
      const despues = todo.slice(offset + match.length, offset + match.length + 22);
      if (/^\s*\[Cita no aportada\]/.test(despues)) return match;
      return contieneNucleo(base, nucleoDe(match)) ? match : `${match} [Cita no aportada]`;
    })),
  }));
}

export function escritoDesdeRespuesta(respuesta, fuentes) {
  const escrito = partirEscrito(respuesta);
  return {
    asunto: escrito.asunto,
    secciones: marcarCitas(escrito.secciones, fuentes),
  };
}

function lineaLimpia(linea) {
  return String(linea || "").replace(/^\*+|\*+$/g, "").trim();
}

function esMarcaDudas(linea) {
  return /^dudas\s*:?\s*$/i.test(lineaLimpia(linea));
}

function textoPregunta(linea) {
  return lineaLimpia(linea).replace(/^(?:\d+[.)]\s*|[-*]\s+)/, "").trim();
}

function esPregunta(linea) {
  const pregunta = textoPregunta(linea);
  return Boolean(pregunta) && pregunta.endsWith("?");
}

function tieneFormaDeEscrito(crudo) {
  return /^asunto\s*:/im.test(crudo) || /^#{1,3}[ \t]+/m.test(crudo);
}

function preguntasDeBloque(lineas) {
  const preguntas = [];
  for (const linea of lineas) {
    const limpia = linea.trim();
    if (!limpia || esMarcaDudas(limpia)) continue;
    if (/^asunto\s*:/i.test(lineaLimpia(limpia)) || /^#{1,3}[ \t]+/.test(limpia)) break;
    const pregunta = textoPregunta(limpia);
    if (!pregunta) continue;
    preguntas.push(pregunta);
    if (preguntas.length >= MAX_DUDAS) break;
  }
  return preguntas;
}

function detectarDudas(crudo) {
  if (!crudo) return null;
  const lineas = crudo.split("\n");
  let inicio = 0;
  while (inicio < lineas.length && !lineas[inicio].trim()) inicio += 1;
  if (esMarcaDudas(lineas[inicio] || "")) {
    const preguntas = preguntasDeBloque(lineas.slice(inicio + 1));
    return preguntas.length ? preguntas : null;
  }
  if (tieneFormaDeEscrito(crudo)) return null;
  const utiles = lineas.map((linea) => linea.trim()).filter(Boolean);
  if (!utiles.length || !utiles.every((linea) => esPregunta(linea))) return null;
  return utiles.map((linea) => textoPregunta(linea)).slice(0, MAX_DUDAS);
}

function quitarBloqueDudas(crudo) {
  const lineas = crudo.split("\n");
  let cursor = 0;
  while (cursor < lineas.length && !lineas[cursor].trim()) cursor += 1;
  if (!esMarcaDudas(lineas[cursor] || "")) return crudo;
  cursor += 1;
  while (cursor < lineas.length) {
    const limpia = lineas[cursor].trim();
    if (/^asunto\s*:/i.test(lineaLimpia(limpia)) || /^#{1,3}[ \t]+/.test(limpia)) break;
    cursor += 1;
  }
  return lineas.slice(cursor).join("\n").trim();
}

export function clasificarRespuesta(respuesta, opciones = {}) {
  const crudo = limpiarCercas(respuesta);
  if (!opciones.cerrar) {
    const preguntas = detectarDudas(crudo);
    if (preguntas?.length) return { tipo: "dudas", preguntas };
  }
  const escrito = partirEscrito(opciones.cerrar ? quitarBloqueDudas(crudo) : crudo);
  return { tipo: "escrito", asunto: escrito.asunto, secciones: escrito.secciones };
}
