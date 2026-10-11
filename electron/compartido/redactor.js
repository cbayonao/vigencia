import { fechaCorta, nombreCliente, texto } from "./logica.js";

const PEDIDO = /^(se\s+)?(libre|ordene|requiera|conceda|revoque|confirme|compulse|fije|señale|corra|notifique|expida|entregue|reconozca|decrete|declare|tenga|impulse|remita|suspenda|levante|archive|oficie)/i;

const TIPOS = [
  { id: "tutela", claves: ["tutela"], asunto: "Acción de tutela" },
  { id: "reposicion", claves: ["reposición", "reposicion"], asunto: "Recurso de reposición" },
  { id: "apelacion", claves: ["apelación", "apelacion"], asunto: "Recurso de apelación" },
  { id: "copias", claves: ["copias", "copia del", "copia de"], asunto: "Solicitud de copias" },
  { id: "impulso", claves: ["impulso", "impulsa"], asunto: "Impulso procesal" },
  { id: "cautelar", claves: ["cautelar", "embargo"], asunto: "Solicitud de medida cautelar" },
  { id: "desistimiento", claves: ["desist"], asunto: "Desistimiento" },
  { id: "contestacion", claves: ["contestación", "contestacion", "contestar"], asunto: "Contestación" },
  { id: "alegatos", claves: ["alegato"], asunto: "Alegatos de conclusión" },
  { id: "traslado", claves: ["traslado"], asunto: "Pronunciamiento en el traslado" },
];

function tipoDe(prompt) {
  const normal = prompt.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  const hallado = TIPOS.find((tipo) => tipo.claves.some((clave) => {
    const limpia = clave.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
    return normal.includes(limpia);
  }));
  return hallado || { id: "memorial", asunto: "Memorial" };
}

function oraciones(prompt) {
  return prompt
    .split(/\n+|(?<=[.!?])\s+/)
    .map((parte) => parte.trim())
    .filter(Boolean);
}

function nucleo(oracion) {
  let frase = oracion.replace(/[.!?]+$/g, "").trim();
  frase = frase.replace(/^(por favor[, ]+|quiero que |necesito que |solicito que |pida que |pedir que |favor |hay que )/i, "");
  frase = frase.trim();
  if (!frase) frase = oracion.replace(/[.!?]+$/g, "").trim();
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

function partir(frase) {
  const corte = frase.match(/^(.+?)\s+(?:porque|ya que|debido a que|dado que)\s+(.+)$/i);
  if (!corte) return { pedido: frase, soporte: "" };
  const pedido = corte[1].trim();
  const soporte = corte[2].trim();
  return {
    pedido: pedido.charAt(0).toUpperCase() + pedido.slice(1),
    soporte: soporte.charAt(0).toUpperCase() + soporte.slice(1),
  };
}

function esSoloTipo(frase, tipo) {
  const normal = frase.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  const marcas = [tipo.asunto, ...(tipo.claves || [])].map((clave) => clave.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase());
  return marcas.includes(normal);
}

function punto(frase) {
  const limpia = frase.trim().replace(/[.!?]+$/g, "");
  return `${limpia}.`;
}

function fundamentos(tipo) {
  if (tipo.id === "tutela") {
    return "La acción de tutela está prevista en el artículo 86 de la Constitución Política y se desarrolla en el Decreto 2591 de 1991. Se presenta para la protección inmediata de los derechos fundamentales que se indican en las peticiones.";
  }
  if (tipo.id === "reposicion") {
    return "El recurso de reposición se interpone para que este mismo despacho examine de nuevo la providencia. La revisión que se pide es únicamente la que queda escrita en las peticiones.";
  }
  if (tipo.id === "apelacion") {
    return "El recurso de apelación se interpone para que el superior revise la providencia, en los términos de la petición y con los antecedentes que ya obran en el expediente.";
  }
  if (tipo.id === "copias") {
    return "La solicitud de copias se formula para consultar las piezas del expediente y ejercer la defensa. Se pide en la forma concreta que indican las peticiones.";
  }
  if (tipo.id === "impulso") {
    return "El juez dirige el proceso y debe impulsarlo. Con este memorial se pide el trámite concreto que se señala, a partir de lo que ya consta en el expediente.";
  }
  if (tipo.id === "cautelar") {
    return "La medida cautelar se pide para asegurar la efectividad de la pretensión, en los términos exactos de las peticiones y sin extenderla a hechos que no estén relatados.";
  }
  return "Este memorial se presenta ante el juez que dirige el proceso, con apoyo en las normas que rigen el trámite. La petición se limita a lo que aquí se escribe y a lo que ya aparece en el expediente.";
}

function antecedente(expediente) {
  const ultima = expediente.ultima;
  if (!ultima || (!texto(ultima.actuacion) && !texto(ultima.fecha))) {
    return "En el expediente de la referencia no hay una actuación posterior que deba reseñarse en este memorial.";
  }
  const cuando = texto(ultima.fecha) ? `El ${fechaCorta(ultima.fecha)}` : "En el expediente";
  const que = texto(ultima.actuacion) || "una actuación";
  let frase = `${cuando} quedó registrada esta actuación: ${que}.`;
  if (texto(ultima.anotacion)) frase += ` La anotación dice: ${texto(ultima.anotacion)}.`;
  return frase;
}

export function redactarEscrito({ expediente, prompt, hoy }) {
  const pedido = texto(prompt);
  if (!pedido) {
    const error = new Error("Escriba qué debe pedirle al juzgado.");
    error.aviso = true;
    throw error;
  }
  if (pedido.length > 4000) {
    const error = new Error("La petición es demasiado larga. Resúmala en menos de 4000 caracteres.");
    error.aviso = true;
    throw error;
  }
  const ficha = expediente || {};
  const tipo = tipoDe(pedido);
  const despacho = texto(ficha.despacho) || "Despacho de conocimiento";
  const partes = oraciones(pedido).map(nucleo);
  const hechos = [];
  const peticiones = [];
  for (const frase of partes) {
    const piezas = partir(frase);
    if (piezas.soporte) hechos.push(punto(piezas.soporte));
    if (!esSoloTipo(piezas.pedido, tipo) && (PEDIDO.test(piezas.pedido) || piezas.soporte)) peticiones.push(punto(piezas.pedido));
    else if (!piezas.soporte) hechos.push(punto(piezas.pedido));
  }
  if (!hechos.length) hechos.push("Los hechos en que se apoya la petición son los que ya constan en el expediente y los que se indican en este memorial.");
  if (!peticiones.length) peticiones.push("Proveer de conformidad con lo expuesto en los hechos.");
  const proceso = [texto(ficha.tipo_proceso), texto(ficha.clase_proceso)].filter(Boolean).join(" · ");
  const cliente = texto(ficha.cliente);
  const quien = cliente || "El suscrito";
  const verbo = cliente ? "presento" : "presenta";
  const pido = cliente ? "Solicito" : "Se solicita";
  const pieza = tipo.id === "memorial" ? "este memorial" : `este memorial de ${tipo.asunto.toLowerCase()}`;
  const contacto = [texto(ficha.telefonos), texto(ficha.email), texto(ficha.direccion)].filter(Boolean).join(" · ");
  const lugar = texto(ficha.departamento);
  const secciones = [
    {
      titulo: "Destinatario",
      parrafos: [
        lugar ? `${lugar}, ${hoy}` : hoy,
        "Señor Juez",
        despacho,
        "E. S. D.",
      ],
    },
    {
      titulo: "Referencia",
      parrafos: [
        `Radicado: ${texto(ficha.radicado) || "sin número"}`,
        proceso ? `Proceso: ${proceso}` : "",
        `Demandante: ${texto(ficha.demandantes) || "no figura en el expediente"}`,
        `Demandado: ${texto(ficha.demandados) || "no figura en el expediente"}`,
        `Asunto: ${tipo.asunto}`,
      ].filter(Boolean),
    },
    {
      titulo: "Presentación",
      parrafos: [
        `${quien}, dentro del expediente de la referencia, comedidamente ${verbo} ${pieza} ante su despacho.`,
      ],
    },
    {
      titulo: "Antecedentes",
      parrafos: [antecedente(ficha)],
    },
    {
      titulo: "Hechos",
      parrafos: hechos.map((hecho, indice) => `${indice + 1}. ${hecho}`),
    },
    {
      titulo: "Fundamentos",
      parrafos: [fundamentos(tipo)],
    },
    {
      titulo: "Peticiones",
      parrafos: peticiones.map((item, indice) => `${indice + 1}. ${item}`),
    },
    {
      titulo: "Pruebas",
      parrafos: [`${pido} que se tengan como prueba las piezas del expediente, en especial la actuación reseñada, y los documentos que se arrimen con este memorial.`],
    },
    {
      titulo: "Anexos",
      parrafos: ["Los documentos que se acompañan a este memorial y los que ya obran en el expediente."],
    },
    {
      titulo: "Notificaciones",
      parrafos: [contacto ? `Recibo notificaciones en ${contacto}.` : "Recibo notificaciones en la dirección que figure en el expediente."],
    },
    {
      titulo: "Cierre",
      parrafos: [
        "Del señor juez, comedidamente,",
        "Atentamente,",
        "________________________________",
        cliente || "Firma",
      ],
    },
  ];
  return { asunto: tipo.asunto, secciones };
}

export function fichaDeDetalle(proceso) {
  const sujetos = proceso?.sujetos || [];
  const unir = (rol) => sujetos.filter((sujeto) => sujeto.rol_base === rol && texto(sujeto.nombre)).map((sujeto) => sujeto.nombre).join(", ");
  const ultima = (proceso?.actuaciones || [])[0] || null;
  return {
    radicado: proceso?.radicado,
    despacho: proceso?.despacho,
    departamento: proceso?.departamento,
    tipo_proceso: proceso?.tipo_proceso,
    clase_proceso: proceso?.clase_proceso,
    demandantes: unir("demandante"),
    demandados: unir("demandado"),
    cliente: nombreCliente(proceso?.cliente),
    telefonos: proceso?.cliente?.telefonos,
    email: proceso?.cliente?.email,
    direccion: proceso?.cliente?.direccion,
    ultima: ultima ? {
      fecha: ultima.fecha_actuacion,
      actuacion: ultima.actuacion,
      anotacion: ultima.anotacion,
    } : null,
  };
}
