import { fechaCorta, nombreCliente, texto } from "./logica.js";

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
  { id: "sustitucion", claves: ["sustitu"], asunto: "Sustitución de poder" },
  { id: "inadmision", claves: ["inadmis"], asunto: "Inadmisión" },
  { id: "requerimiento", claves: ["requerimiento"], asunto: "Respuesta a requerimiento" },
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
  if (!ultima || (!texto(ultima.actuacion) && !texto(ultima.fecha))) return "";
  const cuando = texto(ultima.fecha) ? `El ${fechaCorta(ultima.fecha)}` : "En el expediente";
  const que = texto(ultima.actuacion) || "una actuación";
  let frase = `${cuando} quedó registrada esta actuación: ${que}.`;
  if (texto(ultima.anotacion)) frase += ` La anotación dice: ${texto(ultima.anotacion)}.`;
  return frase;
}

export function referenciaCorta(escrita, pedido = "") {
  const propia = texto(escrita);
  if (propia) {
    const corta = propia.split(/\s+/).slice(0, 5).join(" ");
    return corta.charAt(0).toUpperCase() + corta.slice(1);
  }
  const tipo = tipoDe(String(pedido || ""));
  if (tipo.id !== "memorial") return tipo.asunto;
  const base = nucleo(oraciones(String(pedido || ""))[0] || "Memorial");
  const corte = base.split(/\s+(?:porque|ya que|debido a que|dado que)\s+/i)[0];
  const corta = corte.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  return corta || "Memorial";
}

export function aplicarPresentante(ficha, proceso, presenta) {
  const copia = { ...(ficha || {}) };
  if (texto(copia.cliente)) return copia;
  if (texto(copia.representado)) {
    copia.cliente = texto(copia.representado);
    copia.cedula = texto(copia.representadoCedula);
    copia.tarjeta = null;
    copia.representado = null;
    copia.representadoRol = null;
    return copia;
  }
  const nombre = texto(presenta);
  const sujetos = proceso?.sujetos || [];
  const sujeto = sujetos.find((item) => texto(item.nombre) === nombre)
    || sujetos.find((item) => texto(item.nombre));
  copia.cliente = texto(sujeto?.nombre) || nombre || "";
  copia.cedula = texto(sujeto?.identificacion);
  copia.tarjeta = null;
  return copia;
}

const CON_NORMA = new Set(["tutela", "reposicion", "apelacion", "copias", "impulso", "cautelar"]);

function parrafosDelPedido(pedido) {
  return oraciones(pedido).map((oracion) => {
    const frase = nucleo(oracion);
    const piezas = partir(frase);
    if (!piezas.soporte) return punto(piezas.pedido);
    const soporte = `${piezas.soporte.charAt(0).toLowerCase()}${piezas.soporte.slice(1)}`;
    return punto(`${piezas.pedido}, porque ${soporte}`);
  });
}

export function redactarEscrito({ expediente, prompt, hoy, referencia } = {}) {
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
  const ficha = { ...(expediente || {}), referencia: referenciaCorta(referencia || expediente?.referencia, pedido) };
  const tipo = tipoDe(pedido);
  const despacho = texto(ficha.despacho) || "Despacho de conocimiento";
  const cliente = texto(ficha.cliente);
  const enNombre = fraseRepresentado(ficha);
  const quien = fraseAbogado(cliente || "El suscrito", ficha);
  const verbo = cliente ? "presento" : "presenta";
  const contacto = [texto(ficha.telefonos), texto(ficha.email), texto(ficha.direccion)].filter(Boolean).join(" · ");
  const avisoRepresentado = [texto(ficha.representadoDireccion), texto(ficha.representadoTelefono)].filter(Boolean).join(" · ");
  const avisos = [];
  if (contacto) avisos.push(`Recibo notificaciones en ${contacto}.`);
  if (avisoRepresentado) avisos.push(`Las notificaciones de ${texto(ficha.representado) || "quien represento"} se reciben en ${avisoRepresentado}.`);
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
        `Referencia: ${ficha.referencia}`,
        `Demandante: ${texto(ficha.demandantes) || "no figura en el expediente"}`,
        `Demandado: ${texto(ficha.demandados) || "no figura en el expediente"}`,
      ].filter(Boolean),
    },
    {
      titulo: "Presentación",
      parrafos: [
        `${quien}${enNombre}, por medio del presente escrito, comedidamente ${verbo} a su despacho lo siguiente.`,
      ],
    },
    {
      titulo: "Cuerpo",
      parrafos: [
        ...parrafosDelPedido(pedido),
        antecedente(ficha),
        CON_NORMA.has(tipo.id) ? fundamentos(tipo) : "",
      ].filter(Boolean),
    },
    ...(avisos.length ? [{ titulo: "Notificaciones", parrafos: avisos }] : []),
    {
      titulo: "Cierre",
      parrafos: [
        "Atentamente,",
        "________________________________",
        cliente || "Firma",
        texto(ficha.cedula) ? `C.C. ${texto(ficha.cedula)}` : "",
        texto(ficha.tarjeta) ? `T.P. ${texto(ficha.tarjeta)}` : "",
      ].filter(Boolean),
    },
  ];
  return { asunto: ficha.referencia, secciones };
}

function fraseAbogado(nombre, ficha) {
  const datos = [
    texto(ficha.cedula) ? `cédula ${texto(ficha.cedula)}` : "",
    texto(ficha.tarjeta) ? `tarjeta profesional ${texto(ficha.tarjeta)}` : "",
  ].filter(Boolean);
  return datos.length ? `${nombre}, con ${datos.join(" y ")}` : nombre;
}

function fraseRepresentado(ficha) {
  const nombre = texto(ficha.representado);
  if (!nombre) return "";
  const lado = texto(ficha.representadoRol);
  const cabeza = `${nombre}${lado ? ` (${lado})` : ""}`;
  const datos = [
    texto(ficha.representadoCedula) ? `cédula ${texto(ficha.representadoCedula)}` : "",
    texto(ficha.representadoDireccion) ? `dirección ${texto(ficha.representadoDireccion)}` : "",
    texto(ficha.representadoTelefono) ? `teléfono ${texto(ficha.representadoTelefono)}` : "",
  ].filter(Boolean);
  const quien = datos.length ? `${cabeza}, con ${datos.join(", ")}` : cabeza;
  return `, en representación de ${quien}`;
}

function ladoRepresentado(rol) {
  const limpio = texto(rol);
  if (limpio === "otro") return "tercero u otra parte";
  return limpio;
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
    cedula: texto(proceso?.cliente?.cedula),
    tarjeta: texto(proceso?.cliente?.tarjeta),
    representado: texto(proceso?.cliente?.representado),
    representadoRol: ladoRepresentado(proceso?.cliente?.representado_rol),
    representadoCedula: texto(proceso?.cliente?.representado_cedula),
    representadoDireccion: texto(proceso?.cliente?.representado_direccion),
    representadoTelefono: texto(proceso?.cliente?.representado_telefono),
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
