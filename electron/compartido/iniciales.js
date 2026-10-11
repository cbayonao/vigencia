import { texto } from "./logica.js";

export const TIPOS_INICIALES = {
  demanda: {
    titulo: "Demanda",
    asunto: "Demanda",
    norma: "Artículos 82 y siguientes del Código General del Proceso",
    intro: "Con los requisitos del artículo 82 del CGP: juez, partes, pretensiones, hechos, pruebas, fundamentos, cuantía y notificaciones.",
    requisitos: [
      "Juez a quien se dirige",
      "Nombre, domicilio e identificación de las partes (NIT si es persona jurídica)",
      "Apoderado del demandante, si lo hay",
      "Pretensiones con precisión y claridad",
      "Hechos determinados, clasificados y numerados",
      "Petición de pruebas",
      "Fundamentos de derecho",
      "Cuantía, cuando define competencia o trámite",
      "Direcciones de notificación de las partes",
    ],
    reglaIA: "Estructura de demanda según el artículo 82 del CGP. Si falta un dato exigido por ese artículo, escribe [Dato pendiente: …] en vez de inventarlo.",
  },
  tutela: {
    titulo: "Acción de tutela",
    asunto: "Acción de tutela",
    norma: "Artículo 86 de la Constitución y Decreto 2591 de 1991",
    intro: "Con el contenido del artículo 14 del Decreto 2591 de 1991: hechos, derecho vulnerado, accionado y juramento.",
    requisitos: [
      "Acción u omisión que la motiva",
      "Derecho fundamental vulnerado o amenazado",
      "Autoridad o persona accionada",
      "Juramento de no haber presentado otra tutela por los mismos hechos",
      "Nombres y lugar de ubicación del solicitante",
    ],
    reglaIA: "Estructura de tutela según el artículo 14 del Decreto 2591 de 1991. No cites jurisprudencia ni artículos distintos. Si falta un dato, escribe [Dato pendiente: …] en vez de inventarlo.",
  },
  peticion: {
    titulo: "Derecho de petición",
    asunto: "Derecho de petición",
    norma: "Ley 1755 de 2015 (artículos 13 a 16)",
    intro: "Con el contenido del artículo 16 de la Ley 1755 de 2015: autoridad, solicitante, objeto, razones y documentos.",
    requisitos: [
      "Autoridad a la que se dirige",
      "Nombres, identificación y dirección del solicitante",
      "Objeto claro de la petición",
      "Razones que la fundamentan",
      "Documentos que se aportan",
    ],
    reglaIA: "Estructura de derecho de petición según el artículo 16 de la Ley 1755 de 2015 (respuesta en 15 días hábiles). Si falta un dato, escribe [Dato pendiente: …] en vez de inventarlo.",
  },
};

export const CAMPOS_INICIALES = [
  { id: "ciudad", etiqueta: "Ciudad", tipo: "texto", placeholder: "Bogotá" },
  { id: "presentante", etiqueta: "Quien presenta (nombre completo)", tipo: "texto", placeholder: "Nombres y apellidos" },
  { id: "identificacion", etiqueta: "Identificación", tipo: "texto", placeholder: "Cédula o NIT" },
  { id: "domicilio", etiqueta: "Domicilio y dirección de notificaciones", tipo: "texto", placeholder: "Dirección, ciudad, correo, teléfono" },
  { id: "contraparte", etiqueta: "Demandado o accionado", tipo: "texto", placeholder: "Nombre de la persona o entidad" },
  { id: "autoridad", etiqueta: "Juez o autoridad a quien se dirige", tipo: "texto", placeholder: "Ej.: Juez Civil Municipal de Bogotá" },
  { id: "hechos", etiqueta: "Hechos (uno por línea)", tipo: "area", placeholder: "Cuente lo ocurrido, un hecho por línea." },
  { id: "pretensiones", etiqueta: "Lo que pide (una petición por línea)", tipo: "area", placeholder: "Lo que le pide al juez o a la autoridad." },
  { id: "pruebas", etiqueta: "Pruebas", tipo: "area", placeholder: "Documentos y pruebas que aporta o pide." },
  { id: "cuantia", etiqueta: "Cuantía y juramento estimatorio (solo demanda)", tipo: "texto", placeholder: "Valor y juramento, si aplica" },
  { id: "derecho", etiqueta: "Derecho vulnerado (solo tutela)", tipo: "texto", placeholder: "Ej.: derecho a la salud, al debido proceso" },
  { id: "juramento", etiqueta: "Juro no haber presentado otra tutela por estos hechos (solo tutela)", tipo: "marca", placeholder: "" },
  { id: "instruccion", etiqueta: "Instrucción para la IA", tipo: "area", placeholder: "Dígale a la IA cómo quiere el documento." },
];

function pendiente(valor, nombre) {
  return texto(valor) || `[Dato pendiente: ${nombre}]`;
}

function lineas(valor) {
  return String(valor || "")
    .split(/\n+/)
    .map((linea) => linea.trim().replace(/^[-\d.)\s]+/, ""))
    .filter(Boolean);
}

function punto(frase) {
  const limpia = frase.trim().replace(/[.!?]+$/g, "");
  return `${limpia}.`;
}

export function redactarInicial({ tipo, datos = {}, hoy }) {
  const definicion = TIPOS_INICIALES[tipo];
  if (!definicion) {
    const error = new Error("Elija si inicia demanda, tutela o derecho de petición.");
    error.aviso = true;
    throw error;
  }
  const hechos = lineas(datos.hechos);
  const pretensiones = lineas(datos.pretensiones);
  if (!hechos.length && !texto(datos.instruccion)) {
    const error = new Error("Cuente los hechos o escriba la instrucción para la IA.");
    error.aviso = true;
    throw error;
  }
  const quien = texto(datos.presentante) || "El suscrito";
  const secciones = [
    {
      titulo: "Destinatario",
      parrafos: [
        datos.ciudad && hoy ? `${texto(datos.ciudad)}, ${hoy}` : (hoy || ""),
        tipo === "peticion" ? "Señor(a)" : "Señor Juez",
        pendiente(datos.autoridad, tipo === "peticion" ? "autoridad a la que se dirige" : "juez a quien se dirige"),
        "E. S. D.",
      ].filter(Boolean),
    },
    {
      titulo: "Referencia",
      parrafos: [
        `Asunto: ${definicion.asunto} (${definicion.norma})`,
        `Presenta: ${pendiente(datos.presentante, "nombre de quien presenta")}${texto(datos.identificacion) ? `, ${texto(datos.identificacion)}` : ""}`,
        `Contra: ${pendiente(datos.contraparte, "demandado o accionado")}`,
      ],
    },
    {
      titulo: "Presentación",
      parrafos: [`${quien} presenta esta ${definicion.titulo.toLowerCase()} ante su despacho.`],
    },
    {
      titulo: "Hechos",
      parrafos: hechos.length
        ? hechos.map((hecho, i) => `${i + 1}. ${punto(hecho)}`)
        : ["[Dato pendiente: hechos determinados, clasificados y numerados]"],
    },
    {
      titulo: tipo === "demanda" ? "Pretensiones" : "Peticiones",
      parrafos: pretensiones.length
        ? pretensiones.map((item, i) => `${i + 1}. ${punto(item)}`)
        : ["[Dato pendiente: lo que se pide, con precisión y claridad]"],
    },
    {
      titulo: "Fundamentos",
      parrafos: [fundamentoDe(tipo)],
    },
    {
      titulo: "Pruebas",
      parrafos: lineas(datos.pruebas).length
        ? lineas(datos.pruebas).map((item, i) => `${i + 1}. ${punto(item)}`)
        : ["Se aportan los documentos relacionados y los que ya obren en poder de la contraparte."],
    },
  ];
  if (tipo === "demanda") {
    secciones.push({
      titulo: "Cuantía",
      parrafos: [texto(datos.cuantia) || "[Dato pendiente: cuantía y juramento estimatorio, si aplica]"],
    });
  }
  if (tipo === "tutela") {
    secciones.push({
      titulo: "Juramento",
      parrafos: [
        datos.juramento
          ? `Bajo juramento manifiesto que no he presentado otra acción de tutela por los mismos hechos y derechos${texto(datos.derecho) ? ` (${texto(datos.derecho)})` : ""}.`
          : "[Dato pendiente: juramento de no haber presentado otra tutela por estos hechos]",
      ],
    });
  }
  secciones.push(
    {
      titulo: "Notificaciones",
      parrafos: [`Recibo notificaciones en ${pendiente(datos.domicilio, "dirección de notificaciones")}.`],
    },
    {
      titulo: "Cierre",
      parrafos: ["Atentamente,", "________________________________", texto(datos.presentante) || "Firma"],
    },
  );
  return { asunto: definicion.asunto, secciones };
}

function fundamentoDe(tipo) {
  if (tipo === "tutela") {
    return "La acción de tutela está prevista en el artículo 86 de la Constitución Política y se desarrolla en el Decreto 2591 de 1991. Esta solicitud reúne el contenido del artículo 14 de ese decreto: hechos, derecho vulnerado, accionado y juramento.";
  }
  if (tipo === "peticion") {
    return "El derecho de petición está previsto en el artículo 23 de la Constitución y se desarrolla en la Ley 1755 de 2015. Esta petición reúne el contenido del artículo 16 de esa ley y debe responderse dentro de los términos del artículo 14.";
  }
  return "Esta demanda reúne los requisitos del artículo 82 del Código General del Proceso: juez, partes, pretensiones, hechos, pruebas, fundamentos, cuantía y notificaciones.";
}

export function requisitosDe(tipo) {
  return TIPOS_INICIALES[tipo]?.requisitos || [];
}

export function reglaDe(tipo) {
  return TIPOS_INICIALES[tipo]?.reglaIA || "";
}
