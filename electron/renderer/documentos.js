// Pantalla Documentos: proyectos, conversación, hoja viva, versiones,
// biblioteca de fuentes y perfiles. Todo pasa por window.vigencia.
import { contarAvisos, diferencias, escritoDeTexto, estimarTokens } from "../compartido/documentos.js";

const $ = (id) => document.getElementById(id);
const doc = {
  listo: false,
  inicio: null,
  archivados: false,
  abierto: null,
  datos: null,
  versionVista: null,
  modelo: "",
  editando: false,
  pasaje: "",
  pasajeRef: "",
  enviando: false,
  bibMarcadas: new Set(),
  bibFiltro: { texto: "", clase: "", etiqueta: "" },
  perfilEditado: null,
  confirmar: null,
};
let ui = null;

function nodo(tag, clase, contenido) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (contenido != null) el.textContent = contenido;
  return el;
}

function opcion(valor, etiqueta) {
  const o = document.createElement("option");
  o.value = valor;
  o.textContent = etiqueta;
  return o;
}

function fechaCorta(marca) {
  const t = String(marca || "");
  return t ? `${t.slice(0, 10)} ${t.slice(11, 16)}` : "";
}

function mostrarError(id, mensaje) {
  const el = $(id);
  el.hidden = !mensaje;
  el.textContent = mensaje || "";
}

function estadoChat(mensaje, error = false) {
  $("doc-estado").textContent = mensaje || "";
  $("doc-estado").classList.toggle("error", error);
}

// ---------- Inicio y lista ----------

async function cargarInicio() {
  const r = await window.vigencia.documentosInicio();
  if (!r?.ok) {
    estadoChat(r?.error || "No pude abrir Documentos.", true);
    return;
  }
  doc.inicio = r;
  pintarLista();
}

function pintarLista() {
  const lista = $("doc-lista");
  lista.replaceChildren();
  const filtro = String($("doc-buscar").value || "").toLowerCase().trim();
  const proyectos = (doc.archivados ? doc.inicio?.archivados : doc.inicio?.proyectos) || [];
  const visibles = proyectos.filter((p) => !filtro || `${p.nombre} ${p.tipoNombre} ${p.radicado}`.toLowerCase().includes(filtro));
  if (!visibles.length) {
    lista.append(nodo("p", "ayuda", doc.archivados ? "No hay documentos archivados." : "Todavía no hay documentos. Cree el primero."));
  }
  for (const p of visibles) {
    const tarjeta = nodo("button", "tarjeta doc-tarjeta");
    tarjeta.type = "button";
    if (p.id === doc.abierto) tarjeta.classList.add("activa");
    tarjeta.append(nodo("span", "doc-tarjeta-nombre", p.nombre));
    const linea = [p.tipoNombre, p.versiones ? `${p.versiones} ${p.versiones === 1 ? "versión" : "versiones"}` : "sin versiones"];
    if (p.radicado) linea.push(p.radicado);
    tarjeta.append(nodo("span", "doc-tarjeta-meta", linea.join(", ")));
    tarjeta.addEventListener("click", () => abrirProyecto(p.id));
    lista.append(tarjeta);
  }
  $("doc-tab-activos").classList.toggle("elegida", !doc.archivados);
  $("doc-tab-archivados").classList.toggle("elegida", doc.archivados);
  $("doc-tab-activos").setAttribute("aria-selected", String(!doc.archivados));
  $("doc-tab-archivados").setAttribute("aria-selected", String(doc.archivados));
}

function llenarTipos(select, actual) {
  select.replaceChildren(...(doc.inicio?.tipos || []).map((t) => opcion(t.id, t.nombre)));
  if (actual) select.value = actual;
}

function llenarPerfiles(select, actual) {
  select.replaceChildren(opcion("", "Sin perfil"), ...(doc.inicio?.perfiles || []).map((p) => opcion(String(p.id), p.nombre)));
  select.value = actual ? String(actual) : "";
}

function llenarExpedientes(select, actual) {
  select.replaceChildren(opcion("", "Sin expediente"), ...(doc.inicio?.expedientes || []).map((e) => opcion(String(e.id), `${e.radicado}, ${e.titulo}`.slice(0, 120))));
  select.value = actual ? String(actual) : "";
}

function llenarModelos(select, actual, conPreferido = false) {
  const soloLocal = !conPreferido && doc.datos?.proyecto?.solo_local;
  const modelos = (doc.inicio?.modelos?.modelos || []).filter((m) => !soloLocal || !String(m.id).startsWith("nube:"));
  const items = modelos.map((m) => opcion(m.id, m.nombre));
  if (conPreferido) items.unshift(opcion("", "El que esté activo en Modelos de IA"));
  select.replaceChildren(...items);
  const metaDisponible = !conPreferido && modelos.some((m) => m.id === "nube:meta");
  select.value = actual && modelos.some((m) => m.id === actual)
    ? actual
    : (conPreferido ? "" : metaDisponible ? "nube:meta" : (doc.inicio?.modelos?.activo || "sencillo"));
}

// ---------- Proyecto abierto ----------

async function abrirProyecto(id, { conservarVista = false } = {}) {
  const r = await window.vigencia.documentosProyecto(id, doc.modelo || undefined);
  if (!r?.ok) {
    estadoChat(r?.error || "No pude abrir ese documento.", true);
    return;
  }
  if (doc.abierto !== id) {
    doc.modelo = "";
    doc.pasaje = "";
    doc.pasajeRef = "";
    doc.editando = false;
  }
  doc.abierto = id;
  doc.datos = r;
  if (!doc.modelo) doc.modelo = r.modelo?.id || "";
  if (!conservarVista) doc.versionVista = r.actual?.id || null;
  pintarProyecto();
  pintarContexto();
  pintarLista();
}

function modeloElegido() {
  const modelos = doc.inicio?.modelos?.modelos || [];
  return modelos.find((m) => m.id === doc.modelo) || null;
}

async function pintarContexto() {
  const caja = $("doc-contexto");
  if (!doc.abierto) {
    caja.textContent = "Sin llamadas a la nube todavía.";
    return;
  }
  let r = null;
  try {
    r = await window.vigencia.gastoUltimo(doc.abierto);
  } catch {
    r = { ok: false };
  }
  if (!r?.ok || !r.hay) {
    caja.textContent = "Sin llamadas a la nube todavía.";
    return;
  }
  const total = (Number(r.entrada) || 0) + (Number(r.salida) || 0);
  const tokens = `${total.toLocaleString("es-CO")} de ${Number(r.ventana).toLocaleString("es-CO")} tokens`;
  caja.textContent = r.porcentaje == null
    ? `Última llamada: ${tokens}.`
    : `Contexto usado: ~${r.porcentaje}% (${tokens}).`;
}

function pintarPrivacidad() {
  const m = modeloElegido();
  const caja = $("doc-privacidad");
  const nube = String(m?.id || "").startsWith("nube:");
  caja.classList.toggle("nube", nube);
  if (doc.datos?.proyecto?.solo_local && !nube) {
    caja.textContent = "Solo local: este proyecto no envía nada a la nube. Conversión, OCR y redacción quedan en este computador.";
    return;
  }
  if (nube) {
    caja.textContent = `Antes de cada envío verá el texto exacto. Con ${m.nombre} su mensaje, el documento, los datos del expediente vinculado y los fragmentos de las fuentes salen a internet hacia ese proveedor, con su clave.`;
  } else if (String(m?.id || "").startsWith("gguf:")) {
    caja.textContent = "El modelo corre en este computador. Nada sale a internet.";
  } else {
    caja.textContent = "Modelo Sencillo: arma la plantilla básica en este computador. Para conversar con el documento elija un modelo local o de nube.";
  }
}

function pintarProyecto() {
  const d = doc.datos;
  $("doc-sin-proyecto").hidden = Boolean(d);
  $("doc-proyecto").hidden = !d;
  $("doc-herramientas").hidden = !d?.actual;
  if (!d) {
    $("doc-hoja-caja").replaceChildren(nodo("p", "ayuda doc-papel-vacio", "Aquí se ve el documento mientras se escribe."));
    $("doc-avisos").hidden = true;
    $("doc-pista-pasaje").hidden = true;
    return;
  }
  $("doc-titulo").textContent = d.proyecto.nombre;
  pintarMenu();
  llenarTipos($("doc-tipo"), d.proyecto.tipo);
  llenarPerfiles($("doc-perfil"), d.proyecto.perfil_id);
  llenarModelos($("doc-modelo"), doc.modelo);
  doc.modelo = $("doc-modelo").value;
  llenarExpedientes($("doc-expediente"), d.proyecto.id_proceso);
  const nFuentes = d.fuentes.length;
  $("doc-fuentes-resumen").textContent = nFuentes ? `${nFuentes} ${nFuentes === 1 ? "fuente elegida" : "fuentes elegidas"}` : "Sin fuentes: solo se cita lo del expediente y sus mensajes.";
  const archivos = d.archivos || [];
  const dentro = archivos.filter((a) => a.incluido).length;
  $("doc-archivos-resumen").textContent = archivos.length ? `${archivos.length} ${archivos.length === 1 ? "archivo" : "archivos"}, ${dentro} en el contexto` : "Sin archivos del proyecto.";
  $("doc-solo-local").checked = Boolean(d.proyecto.solo_local);
  pintarPrivacidad();
  pintarMensajes();
  pintarVersiones();
  pintarHoja();
  pintarPasaje();
}

function pintarMenu() {
  const caja = $("doc-menu");
  caja.replaceChildren();
  const d = doc.datos;
  const menu = ui.menuDesplegable({
    etiqueta: "⋯",
    titulo: "Documento",
    items: [
      { etiqueta: "Cambiar el nombre", alHacer: () => abrirNombre() },
      { etiqueta: "Duplicar", alHacer: () => duplicar() },
      { etiqueta: d.proyecto.archivado ? "Sacar del archivo" : "Archivar", alHacer: () => archivar(!d.proyecto.archivado) },
      { separador: true },
      { etiqueta: "Eliminar", alHacer: () => pedirBorrar() },
    ],
  });
  caja.append(menu.raiz || menu);
}

function pintarMensajes() {
  const caja = $("doc-mensajes");
  caja.replaceChildren();
  const lista = doc.datos?.mensajes || [];
  if (!lista.length) {
    caja.append(nodo("p", "ayuda doc-mensajes-vacio", "Cuéntele al asistente qué documento necesita, para quién y qué pide. Si falta un dato importante, le preguntará antes de redactar."));
  }
  for (const m of lista) {
    const burbuja = nodo("div", `doc-msj doc-msj-${m.rol}`);
    burbuja.append(nodo("p", "doc-msj-texto", m.texto));
    if (m.dudas?.length) burbuja.append(bloqueDudas(m));
    const pie = [fechaCorta(m.creado_en)];
    if (m.rol === "asistente" && m.origen === "nube") pie.push("respondido en la nube");
    burbuja.append(nodo("span", "doc-msj-pie", pie.join(", ")));
    if (m.version_id) {
      const ver = nodo("button", "boton-texto doc-msj-ver", "Ver esta versión");
      ver.type = "button";
      ver.addEventListener("click", () => verVersion(m.version_id));
      burbuja.append(ver);
    }
    caja.append(burbuja);
  }
  caja.scrollTop = caja.scrollHeight;
}

// Las dudas de la IA se responden aquí mismo, pregunta por pregunta, con
// un clic: como responder un comentario en un editor, sin redactar el
// mensaje a mano.
function bloqueDudas(m) {
  const caja = nodo("div", "doc-dudas-caja");
  caja.append(nodo("p", "doc-dudas-titulo", "Antes de redactar necesito saber:"));
  const campos = [];
  m.dudas.forEach((pregunta, i) => {
    const fila = nodo("label", "doc-duda");
    fila.append(nodo("span", "doc-dudas-num", `${i + 1}`));
    const cuerpo = nodo("span", "doc-duda-cuerpo");
    cuerpo.append(nodo("span", "doc-duda-pregunta", pregunta));
    const campo = document.createElement("input");
    campo.type = "text";
    campo.placeholder = "Su respuesta";
    campo.setAttribute("aria-label", `Respuesta a: ${pregunta}`);
    campo.autocomplete = "off";
    cuerpo.append(campo);
    fila.append(cuerpo);
    caja.append(fila);
    campos.push(campo);
  });
  const pie = nodo("div", "doc-dudas-pie");
  const ayuda = nodo("span", "ayuda", "Responda y el asistente redacta.");
  const boton = nodo("button", "boton-cobre doc-dudas-enviar", "Responder y redactar");
  boton.type = "button";
  const responder = () => {
    const lineas = [];
    m.dudas.forEach((pregunta, i) => {
      const r = campos[i].value.trim();
      if (r) lineas.push(`${i + 1}. ${pregunta}\nRespuesta: ${r}`);
    });
    if (!lineas.length) {
      estadoChat("Responda al menos una pregunta para seguir.", true);
      campos[0]?.focus();
      return;
    }
    if (lineas.length < m.dudas.length) lineas.push("(Las demás preguntas quedan como [Dato pendiente].)");
    $("doc-mensaje").value = lineas.join("\n\n");
    enviar();
  };
  boton.addEventListener("click", responder);
  for (const campo of campos) {
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        responder();
      }
    });
  }
  pie.append(ayuda, boton);
  caja.append(pie);
  return caja;
}

function pintarVersiones() {
  const sel = $("doc-version");
  const vs = doc.datos?.versiones || [];
  sel.replaceChildren(...vs.map((v) => opcion(String(v.id), `Versión ${v.numero}${v.id === doc.datos.actual?.id ? ", actual" : ""}, ${autorDe(v)}`)));
  if (doc.versionVista) sel.value = String(doc.versionVista);
}

function autorDe(v) {
  return { usuario: "editada por usted", restaurada: "restaurada", plantilla: "plantilla básica" }[v.autor] || v.modelo || "modelo";
}

let cuerpoVista = "";

async function verVersion(id) {
  doc.versionVista = Number(id);
  pintarVersiones();
  await pintarHoja();
}

async function cuerpoDeVersion(id) {
  if (!id) return "";
  if (doc.datos?.actual?.id === id) return doc.datos.actual.cuerpo;
  const r = await window.vigencia.documentosVersion(id);
  return r?.ok ? r.version.cuerpo : "";
}

function conMarcas(contenedor, valor) {
  const partes = String(valor).split(/(\[Cita no aportada\]|\[Dato pendiente[^\]]*\])/);
  for (const parte of partes) {
    if (!parte) continue;
    if (/^\[Cita no aportada\]$/.test(parte)) contenedor.append(nodo("mark", "doc-marca-cita", parte));
    else if (/^\[Dato pendiente/.test(parte)) contenedor.append(nodo("mark", "doc-marca-dato", parte));
    else contenedor.append(document.createTextNode(parte));
  }
}

function hojaDe(cuerpo, origen) {
  const escrito = escritoDeTexto(cuerpo);
  const hoja = nodo("article", "doc-hoja doc-hoja-viva");
  hoja.append(nodo("p", "marca", "Vista del documento"));
  hoja.append(nodo("h1", "", escrito.asunto));
  for (const s of escrito.secciones) {
    const sec = nodo("section");
    if (!["Escrito", "Texto", "Destinatario", "Referencia", "Cierre"].includes(s.titulo)) sec.append(nodo("h2", "", s.titulo));
    let n = 0;
    for (const p of s.parrafos) {
      n += 1;
      sec.append(parrafoDe(s.titulo, n, p));
    }
    hoja.append(sec);
  }
  hoja.append(nodo("p", "pie", origen === "nube"
    ? "Borrador armado con apoyo de IA en la nube usando su clave. Verifique los hechos y las citas antes de presentarlo."
    : "Borrador armado en este computador. Verifique los hechos y las citas antes de presentarlo."));
  return { hoja, escrito };
}

// Cada párrafo de la hoja trae sus acciones: corregirlo solo a él o
// citarlo en el mensaje. Es el corazón del editor: el abogado apunta a un
// pedazo pequeño en vez de reescribir todo.
function parrafoDe(seccion, numero, texto) {
  const caja = nodo("div", "doc-parrafo");
  const ref = `${seccion} · ¶${numero}`;
  caja.dataset.pasaje = String(texto || "");
  caja.dataset.ref = ref;
  const el = nodo("p", /___/.test(texto) ? "firma" : "");
  conMarcas(el, texto);
  const acciones = nodo("div", "doc-parrafo-acciones");
  const corregir = nodo("button", "doc-parrafo-btn", "✎ Corregir solo este");
  corregir.type = "button";
  corregir.title = `Corregir solo este párrafo (${ref})`;
  corregir.setAttribute("aria-label", `Corregir solo el párrafo ${numero} de ${seccion}`);
  corregir.addEventListener("click", () => elegirPasaje(texto, ref));
  const citar = nodo("button", "doc-parrafo-btn", "❝ Citar");
  citar.type = "button";
  citar.title = "Traer este párrafo a su mensaje";
  citar.setAttribute("aria-label", `Citar el párrafo ${numero} de ${seccion} en el mensaje`);
  citar.addEventListener("click", () => citarParrafo(texto, ref));
  acciones.append(corregir, citar);
  caja.append(el, acciones);
  if (doc.pasaje && String(texto) === doc.pasaje) caja.classList.add("elegido");
  return caja;
}

const PLACEHOLDER_MENSAJE = "Pida el documento o un cambio: hazlo más corto, agrega la sentencia que le aporto, cambia el tono";

function elegirPasaje(texto, ref = "") {
  const limpio = String(texto || "").trim();
  if (limpio.length < 12) {
    estadoChat("Ese párrafo es muy corto para corregirlo solo.", true);
    return;
  }
  if (doc.versionVista !== doc.datos?.actual?.id) {
    estadoChat("Vea la versión actual para corregir un párrafo.", true);
    return;
  }
  doc.pasaje = limpio;
  doc.pasajeRef = ref || "Pasaje elegido";
  pintarPasaje();
  pintarHojaElegido();
  $("doc-mensaje").placeholder = "Diga cómo corregir ese párrafo: más corto, más formal, agregue la cita…";
  $("doc-mensaje").focus();
}

function citarParrafo(texto, ref = "") {
  const limpio = String(texto || "").trim();
  if (!limpio) return;
  const cita = limpio.length > 280 ? `${limpio.slice(0, 280)} [...]` : limpio;
  const caja = $("doc-mensaje");
  const prefijo = caja.value && !caja.value.endsWith("\n") ? "\n" : "";
  caja.value = `${caja.value}${prefijo}> ${ref ? `(${ref}) ` : ""}${cita}\n`;
  caja.focus();
  estadoChat(`Párrafo ${ref || "elegido"} traído a su mensaje.`);
}

function pintarHojaElegido() {
  for (const caja of document.querySelectorAll("#doc-hoja-caja .doc-parrafo")) {
    caja.classList.toggle("elegido", Boolean(doc.pasaje) && caja.dataset.pasaje === doc.pasaje);
  }
}

async function pintarHoja() {
  const d = doc.datos;
  const caja = $("doc-hoja-caja");
  if (!d?.actual) {
    caja.replaceChildren(nodo("p", "ayuda doc-papel-vacio", "Aquí se ve el documento mientras se escribe. Todavía no hay versiones."));
    $("doc-avisos").hidden = true;
    $("doc-herramientas").hidden = true;
    $("doc-pista-pasaje").hidden = true;
    return;
  }
  $("doc-herramientas").hidden = false;
  const id = doc.versionVista || d.actual.id;
  const v = d.versiones.find((x) => x.id === id) || d.actual;
  cuerpoVista = await cuerpoDeVersion(v.id);
  const { hoja, escrito } = hojaDe(cuerpoVista, v.origen);
  if (v.id !== d.actual.id) {
    const aviso = nodo("div", "doc-no-actual");
    aviso.append(nodo("span", "", `Está viendo la versión ${v.numero}. La actual es la ${d.actual.numero}.`));
    const restaurar = nodo("button", "boton-linea", "Restaurar esta versión");
    restaurar.type = "button";
    restaurar.addEventListener("click", () => restaurar_(v.id));
    const volver = nodo("button", "boton-texto", "Ver la actual");
    volver.type = "button";
    volver.addEventListener("click", () => verVersion(d.actual.id));
    aviso.append(volver, restaurar);
    caja.replaceChildren(aviso, hoja);
  } else {
    caja.replaceChildren(hoja);
  }
  pintarAvisos(contarAvisos(escrito.secciones));
  $("doc-pista-pasaje").hidden = false;
  pintarHojaElegido();
  $("doc-editar").disabled = v.id !== d.actual.id;
  $("doc-comparar").disabled = v.numero <= 1;
  $("doc-hoja-caja").hidden = doc.editando;
  $("doc-edicion").hidden = !doc.editando;
}

function pintarAvisos(avisos) {
  const caja = $("doc-avisos");
  caja.replaceChildren();
  const partes = [];
  if (avisos.citas) partes.push(`${avisos.citas} ${avisos.citas === 1 ? "cita no está" : "citas no están"} en sus fuentes, el expediente ni sus mensajes. Aporte el texto o quítela${avisos.citas === 1 ? "" : "s"}.`);
  if (avisos.datos) partes.push(`${avisos.datos} ${avisos.datos === 1 ? "dato pendiente" : "datos pendientes"} por completar.`);
  caja.classList.toggle("doc-avisos-alerta", Boolean(avisos.citas));
  for (const p of partes) caja.append(nodo("p", "", p));
  caja.append(nodo("p", "doc-avisos-verificar", "Verifique los hechos y las citas antes de presentarlo."));
  caja.hidden = false;
}

function pintarPasaje() {
  $("doc-pasaje").hidden = !doc.pasaje;
  $("doc-pasaje-ref").hidden = !doc.pasaje;
  $("doc-pasaje-ref").textContent = doc.pasajeRef || "Pasaje";
  const muestra = doc.pasaje.length > 140 ? `${doc.pasaje.slice(0, 140)} [...]` : doc.pasaje;
  $("doc-pasaje-texto").textContent = doc.pasaje ? `${muestra} (${doc.pasaje.length} caracteres)` : "";
}

function quitarPasaje() {
  doc.pasaje = "";
  doc.pasajeRef = "";
  pintarPasaje();
  pintarHojaElegido();
  $("doc-mensaje").placeholder = PLACEHOLDER_MENSAJE;
}

// ---------- Enviar un mensaje ----------

function vivo(textoVivo) {
  const caja = $("doc-vivo");
  caja.hidden = false;
  caja.replaceChildren();
  caja.append(nodo("p", "vivo-titulo", doc.pasaje ? "Reescribiendo el pasaje" : "Escribiendo el documento"));
  const t = nodo("p", "vivo-texto", textoVivo);
  t.append(nodo("span", "caret", "▍"));
  caja.append(t);
  caja.scrollTop = caja.scrollHeight;
}

async function enviar(evento) {
  evento?.preventDefault();
  if (doc.enviando || !doc.datos) return;
  const mensaje = String($("doc-mensaje").value || "").trim();
  if (!mensaje) {
    estadoChat("Escriba qué necesita del documento.", true);
    return;
  }
  doc.enviando = true;
  $("doc-enviar").disabled = true;
  const nube = String(doc.modelo).startsWith("nube:");
  estadoChat(nube ? "Pidiendo el texto al proveedor con su clave" : "Redactando en este computador");
  const documento = doc.editando ? $("doc-texto").value : null;
  // Eco inmediato: el mensaje se ve en el chat sin esperar la respuesta.
  const eco = nodo("div", "doc-msj doc-msj-usuario");
  eco.append(nodo("p", "doc-msj-texto", mensaje));
  const vacio = document.querySelector("#doc-mensajes .doc-mensajes-vacio");
  if (vacio) vacio.remove();
  $("doc-mensajes").append(eco);
  $("doc-mensajes").scrollTop = $("doc-mensajes").scrollHeight;
  $("doc-mensaje").value = "";
  const quitar = window.vigencia.alDocumento((dato) => {
    if (dato?.proyectoId === doc.abierto) vivo(dato.texto || "");
  });
  try {
    let confirmado = "";
    if (nube) {
      const previa = await window.vigencia.documentosRevisarEnvio({ id: doc.abierto, mensaje, modelo: doc.modelo, pasaje: doc.pasaje, documento });
      if (!previa?.ok) {
        eco.remove();
        $("doc-mensaje").value = mensaje;
        estadoChat(previa?.error || "No pude preparar el envío.", true);
        return;
      }
      confirmado = await revisarEnvio(previa);
      if (!confirmado) {
        eco.remove();
        $("doc-mensaje").value = mensaje;
        estadoChat("No se envió nada.");
        return;
      }
    }
    const r = await window.vigencia.documentosConversar({
      id: doc.abierto,
      mensaje,
      modelo: doc.modelo,
      pasaje: doc.pasaje,
      documento,
      confirmado,
    });
    if (!r?.ok) {
      eco.remove();
      estadoChat(r?.error || "No pude enviar el mensaje.", true);
      return;
    }
    doc.pasaje = "";
    doc.pasajeRef = "";
    doc.editando = false;
    doc.datos = { ...r };
    $("doc-mensaje").placeholder = PLACEHOLDER_MENSAJE;
    doc.versionVista = r.actual?.id || null;
    estadoChat(r.error ? "El modelo no respondió." : "");
    pintarProyecto();
    pintarContexto();
    await cargarInicio();
  } finally {
    quitar();
    $("doc-vivo").hidden = true;
    doc.enviando = false;
    $("doc-enviar").disabled = false;
  }
}

// ---------- Acciones del proyecto ----------

async function cambiarProyecto(cambios) {
  const r = await window.vigencia.documentosActualizar(doc.abierto, cambios);
  if (!r?.ok) {
    estadoChat(r?.error || "No pude guardar el cambio.", true);
    return;
  }
  await cargarInicio();
  await abrirProyecto(doc.abierto, { conservarVista: true });
}

function abrirNombre() {
  $("doc-nombre-valor").value = doc.datos.proyecto.nombre;
  ui.mostrarDialogo("dialogo-doc-nombre");
  $("doc-nombre-valor").focus();
}

async function duplicar() {
  const r = await window.vigencia.documentosDuplicar(doc.abierto);
  if (!r?.ok) return estadoChat(r?.error || "No pude duplicar.", true);
  await cargarInicio();
  await abrirProyecto(r.proyecto.id);
}

async function archivar(archivado) {
  await cambiarProyecto({ archivado });
  doc.archivados = archivado;
  pintarLista();
}

function pedirBorrar() {
  $("doc-confirmar-titulo").textContent = "Eliminar el documento";
  $("doc-confirmar-texto").textContent = `Se borran de este computador la conversación y todas las versiones de ${doc.datos.proyecto.nombre}. Las fuentes de la biblioteca y el expediente no se tocan.`;
  doc.confirmar = async () => {
    const r = await window.vigencia.documentosBorrar(doc.abierto);
    if (!r?.ok) return estadoChat(r?.error || "No pude eliminar.", true);
    doc.abierto = null;
    doc.datos = null;
    pintarProyecto();
    await cargarInicio();
  };
  ui.mostrarDialogo("dialogo-doc-confirmar");
}

async function restaurar_(id) {
  const r = await window.vigencia.documentosRestaurar(id);
  if (!r?.ok) return estadoChat(r?.error || "No pude restaurar.", true);
  ui.ocultarDialogo("dialogo-doc-historial");
  await abrirProyecto(doc.abierto);
  await cargarInicio();
}

async function exportar(formato) {
  const id = doc.versionVista || doc.datos?.actual?.id;
  if (!id) return;
  const r = await window.vigencia.documentosExportar(id, formato, $("doc-pie-ia").checked);
  if (r?.ok) estadoChat(`Guardado en ${r.ruta}`);
  else if (!r?.cancelado) estadoChat(r?.error || "No pude guardar el archivo.", true);
}

// ---------- Edición directa y pasaje ----------

function empezarEdicion() {
  doc.editando = true;
  $("doc-texto").value = doc.datos.actual.cuerpo;
  $("doc-hoja-caja").hidden = true;
  $("doc-edicion").hidden = false;
  $("doc-texto").focus();
}

function cancelarEdicion() {
  doc.editando = false;
  $("doc-hoja-caja").hidden = false;
  $("doc-edicion").hidden = true;
}

async function guardarEdicion() {
  const r = await window.vigencia.documentosGuardarTexto(doc.abierto, $("doc-texto").value);
  if (!r?.ok) return estadoChat(r?.error || "No pude guardar la edición.", true);
  doc.editando = false;
  await abrirProyecto(doc.abierto);
  await cargarInicio();
}

function tomarPasaje() {
  let elegido = "";
  if (doc.editando) {
    const t = $("doc-texto");
    elegido = t.value.slice(t.selectionStart, t.selectionEnd);
  } else {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && $("doc-hoja-caja").contains(sel.anchorNode)) elegido = sel.toString();
  }
  elegido = elegido.trim();
  if (elegido.length >= 12 && doc.versionVista === doc.datos?.actual?.id) {
    doc.pasaje = elegido;
    doc.pasajeRef = "Selección";
    pintarPasaje();
    pintarHojaElegido();
    $("doc-mensaje").placeholder = "Diga cómo corregir ese pasaje: más corto, más formal, agregue la cita…";
  }
}

// ---------- Historial y diferencias ----------

async function abrirHistorial() {
  const lista = $("doc-historial-lista");
  lista.replaceChildren();
  for (const v of doc.datos.versiones) {
    const fila = nodo("div", "doc-hist-fila");
    const textos = nodo("div");
    textos.append(nodo("strong", "", `Versión ${v.numero}`), nodo("span", "doc-tarjeta-meta", `${fechaCorta(v.creado_en)}, ${autorDe(v)}`));
    if (v.nota) textos.append(nodo("span", "doc-tarjeta-meta", v.nota));
    if (v.avisos?.citas) textos.append(nodo("span", "doc-marca-cita", `${v.avisos.citas} sin fuente`));
    const botones = nodo("div", "botones");
    const ver = nodo("button", "boton-texto", "Ver");
    ver.type = "button";
    ver.addEventListener("click", async () => {
      ui.ocultarDialogo("dialogo-doc-historial");
      await verVersion(v.id);
    });
    botones.append(ver);
    const previa = doc.datos.versiones.find((x) => x.numero === v.numero - 1);
    if (previa) {
      const cmp = nodo("button", "boton-texto", "Cambios");
      cmp.type = "button";
      cmp.addEventListener("click", () => mostrarDiferencias(previa.id, v.id));
      botones.append(cmp);
    }
    if (v.id !== doc.datos.actual.id) {
      const res = nodo("button", "boton-linea", "Restaurar");
      res.type = "button";
      res.addEventListener("click", () => restaurar_(v.id));
      botones.append(res);
    }
    fila.append(textos, botones);
    lista.append(fila);
  }
  $("doc-historial-vista").replaceChildren(nodo("p", "ayuda", "Elija Cambios para ver qué cambió frente a la versión anterior, por sección y por párrafo."));
  ui.mostrarDialogo("dialogo-doc-historial");
}

async function mostrarDiferencias(antesId, despuesId) {
  const [a, b] = await Promise.all([cuerpoDeVersion(antesId), cuerpoDeVersion(despuesId)]);
  const dif = diferencias(a, b);
  const vista = $("doc-historial-vista");
  vista.replaceChildren();
  const na = doc.datos.versiones.find((v) => v.id === antesId)?.numero;
  const nb = doc.datos.versiones.find((v) => v.id === despuesId)?.numero;
  vista.append(nodo("p", "doc-dif-resumen", `De la versión ${na} a la ${nb}: ${dif.cuenta.agregado} agregados, ${dif.cuenta.cambiado} cambiados y ${dif.cuenta.quitado} quitados.`));
  for (const grupo of dif.secciones) {
    const hay = grupo.cambios.some((c) => c.tipo !== "igual");
    const sec = nodo("section", `doc-dif-seccion${hay ? "" : " doc-dif-igual"}`);
    sec.append(nodo("h3", "", grupo.seccion));
    if (!hay) {
      sec.append(nodo("p", "ayuda", "Sin cambios."));
    } else {
      const limpio = (t) => String(t || "").replace(/^##\s+/, "Título: ");
      for (const c of grupo.cambios) {
        if (c.tipo === "igual") continue;
        c.texto = limpio(c.texto);
        c.antes = limpio(c.antes);
        if (c.tipo === "cambiado") {
          sec.append(nodo("p", "doc-dif-quitado", c.antes), nodo("p", "doc-dif-agregado", c.texto));
        } else {
          sec.append(nodo("p", c.tipo === "agregado" ? "doc-dif-agregado" : "doc-dif-quitado", c.texto));
        }
      }
    }
    vista.append(sec);
  }
}

async function compararConAnterior() {
  const id = doc.versionVista || doc.datos.actual.id;
  const v = doc.datos.versiones.find((x) => x.id === id);
  const previa = doc.datos.versiones.find((x) => x.numero === v.numero - 1);
  if (!previa) return;
  await abrirHistorial();
  await mostrarDiferencias(previa.id, v.id);
}

// ---------- Nuevo documento ----------

function abrirNuevo() {
  $("doc-nuevo-nombre").value = "";
  llenarTipos($("doc-nuevo-tipo"), "tutela");
  llenarPerfiles($("doc-nuevo-perfil"), doc.inicio?.perfiles?.[0]?.id);
  llenarExpedientes($("doc-nuevo-expediente"), null);
  mostrarError("doc-nuevo-error", "");
  ui.mostrarDialogo("dialogo-doc-nuevo");
  $("doc-nuevo-nombre").focus();
}

async function crearNuevo(evento) {
  evento.preventDefault();
  const r = await window.vigencia.documentosCrear({
    nombre: $("doc-nuevo-nombre").value,
    tipo: $("doc-nuevo-tipo").value,
    perfil_id: Number($("doc-nuevo-perfil").value) || null,
    id_proceso: Number($("doc-nuevo-expediente").value) || null,
  });
  if (!r?.ok) return mostrarError("doc-nuevo-error", r?.error || "No pude crear el documento.");
  ui.ocultarDialogo("dialogo-doc-nuevo");
  doc.archivados = false;
  await cargarInicio();
  await abrirProyecto(r.proyecto.id);
  $("doc-mensaje").focus();
}

// ---------- Biblioteca ----------

function nombreClase(id) {
  return (doc.inicio?.clases || []).find((c) => c.id === id)?.nombre || id;
}

async function abrirBiblioteca() {
  doc.bibMarcadas = new Set(doc.datos?.fuentes || []);
  $("doc-bib-usar").hidden = !doc.datos;
  const soltado = $("doc-bib-soltar-estado");
  soltado.hidden = true;
  soltado.textContent = "";
  $("doc-bib-clase").replaceChildren(opcion("", "Todas las clases"), ...(doc.inicio?.clases || []).map((c) => opcion(c.id, c.nombre)));
  $("doc-bib-clase").value = doc.bibFiltro.clase;
  await pintarBiblioteca();
  ui.mostrarDialogo("dialogo-doc-biblioteca");
  $("doc-bib-buscar").focus();
}

async function pintarBiblioteca() {
  const r = await window.vigencia.documentosFuentesBuscar(doc.bibFiltro);
  if (!r?.ok) return mostrarError("doc-bib-error", r?.error || "No pude leer la biblioteca.");
  mostrarError("doc-bib-error", "");
  const sel = $("doc-bib-etiqueta");
  sel.replaceChildren(opcion("", "Todas las etiquetas"), ...r.etiquetas.map((e) => opcion(e, e)));
  sel.value = r.etiquetas.includes(doc.bibFiltro.etiqueta) ? doc.bibFiltro.etiqueta : "";
  const lista = $("doc-bib-lista");
  lista.replaceChildren();
  if (!r.fuentes.length) lista.append(nodo("p", "ayuda", "No hay fuentes con ese filtro. Pegue o importe la primera."));
  for (const f of r.fuentes) {
    const fila = nodo("div", "doc-bib-fila");
    if (doc.datos) {
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.checked = doc.bibMarcadas.has(f.id);
      casilla.setAttribute("aria-label", `Usar ${f.nombre}`);
      casilla.addEventListener("change", () => {
        if (casilla.checked) doc.bibMarcadas.add(f.id);
        else doc.bibMarcadas.delete(f.id);
        cuentaMarcadas();
      });
      fila.append(casilla);
    }
    const textos = nodo("div", "doc-bib-textos");
    textos.append(nodo("strong", "", f.nombre));
    const meta = [nombreClase(f.clase), `${f.largo.toLocaleString("es-CO")} caracteres (≈ ${Math.max(1, Math.ceil(f.largo / 4)).toLocaleString("es-CO")} tokens)`];
    if (f.etiquetas.length) meta.push(f.etiquetas.join(", "));
    if (f.origen) meta.push(f.origen);
    textos.append(nodo("span", "doc-tarjeta-meta", meta.join(", ")), nodo("span", "doc-bib-muestra", f.muestra));
    const botones = nodo("div", "botones");
    const editar = nodo("button", "boton-texto", "Editar");
    editar.type = "button";
    editar.addEventListener("click", () => abrirFuente(f.id));
    const borrar = nodo("button", "boton-texto", "Borrar");
    borrar.type = "button";
    borrar.addEventListener("click", () => {
      $("doc-confirmar-titulo").textContent = "Borrar la fuente";
      $("doc-confirmar-texto").textContent = `${f.nombre} se borra de la biblioteca de este computador y deja de estar en los documentos que la usaban. Las versiones ya escritas no cambian.`;
      doc.confirmar = async () => {
        const rb = await window.vigencia.documentosFuenteBorrar(f.id);
        if (!rb?.ok) return mostrarError("doc-bib-error", rb?.error || "No pude borrarla.");
        doc.bibMarcadas.delete(f.id);
        await pintarBiblioteca();
        if (doc.abierto) await abrirProyecto(doc.abierto, { conservarVista: true });
      };
      ui.mostrarDialogo("dialogo-doc-confirmar");
    });
    botones.append(editar, borrar);
    fila.append(textos, botones);
    lista.append(fila);
  }
  cuentaMarcadas();
}

function cuentaMarcadas() {
  $("doc-bib-cuenta").textContent = doc.datos ? `${doc.bibMarcadas.size} marcadas para este documento` : "";
}

async function usarMarcadas() {
  const r = await window.vigencia.documentosFuentes(doc.abierto, [...doc.bibMarcadas]);
  if (!r?.ok) return mostrarError("doc-bib-error", r?.error || "No pude guardar las fuentes.");
  ui.ocultarDialogo("dialogo-doc-biblioteca");
  await abrirProyecto(doc.abierto, { conservarVista: true });
}

let fuenteEditada = null;

async function abrirFuente(id = null, previo = null) {
  fuenteEditada = id;
  $("doc-fuente-titulo").textContent = id ? "Editar fuente" : "Nueva fuente";
  $("doc-fuente-clase").replaceChildren(...(doc.inicio?.clases || []).map((c) => opcion(c.id, c.nombre)));
  let f = previo || { nombre: "", clase: "ley", etiquetas: [], texto: "", origen: "" };
  if (id) {
    const r = await window.vigencia.documentosFuenteLeer(id);
    if (!r?.ok) return mostrarError("doc-bib-error", r?.error || "No pude abrir la fuente.");
    f = r.fuente;
  }
  $("doc-fuente-nombre").value = f.nombre;
  $("doc-fuente-clase").value = f.clase;
  $("doc-fuente-etiquetas").value = (f.etiquetas || []).join(", ");
  $("doc-fuente-texto").value = f.texto;
  $("doc-fuente-texto").dataset.origen = f.origen || "";
  largoFuente();
  mostrarError("doc-fuente-error", "");
  ui.mostrarDialogo("dialogo-doc-fuente");
  $("doc-fuente-nombre").focus();
}

function largoFuente() {
  const n = $("doc-fuente-texto").value.length;
  const tokens = estimarTokens($("doc-fuente-texto").value).toLocaleString("es-CO");
  const base = `${n.toLocaleString("es-CO")} caracteres (≈ ${tokens} tokens)`;
  $("doc-fuente-largo").textContent = n > 20000
    ? `${base}. Es larga: al modelo solo viajan los fragmentos que sirven para cada mensaje.`
    : `${base}.`;
}

async function guardarFuente(evento) {
  evento.preventDefault();
  const r = await window.vigencia.documentosFuenteGuardar({
    id: fuenteEditada,
    nombre: $("doc-fuente-nombre").value,
    clase: $("doc-fuente-clase").value,
    etiquetas: $("doc-fuente-etiquetas").value,
    texto: $("doc-fuente-texto").value,
    origen: $("doc-fuente-texto").dataset.origen || "",
  });
  if (!r?.ok) return mostrarError("doc-fuente-error", r?.error || "No pude guardar la fuente.");
  ui.ocultarDialogo("dialogo-doc-fuente");
  if (doc.datos && !fuenteEditada) doc.bibMarcadas.add(r.fuente.id);
  await cargarInicio();
  if (!$("dialogo-doc-biblioteca").hidden) await pintarBiblioteca();
}

async function importarFuente() {
  const r = await window.vigencia.documentosFuenteImportar();
  if (!r?.ok) {
    if (!r?.cancelado) mostrarError("doc-bib-error", r?.error || "No pude leer ese archivo.");
    return;
  }
  const clase = /sentencia|t-\d|c-\d|su-\d/i.test(r.nombre) ? "jurisprudencia" : (/ley|decreto|c[oó]digo/i.test(r.nombre) ? "ley" : "nota");
  await abrirFuente(null, { nombre: r.nombre.slice(0, 120), clase, etiquetas: [], texto: r.texto, origen: r.archivo });
}

// ---------- Arrastrar y soltar fuentes ----------

const EXTENSIONES_FUENTE = [".txt", ".md", ".docx", ".pdf"];

function estadoSoltar(mensaje, error = false) {
  const el = $("doc-bib-soltar-estado");
  el.hidden = !mensaje;
  el.textContent = mensaje || "";
  el.classList.toggle("error", error);
}

function extensionDe(nombre) {
  const base = String(nombre || "").toLowerCase();
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i) : "";
}

async function soltarFuentes(archivos) {
  const rutas = [];
  const rechazados = [];
  for (const f of archivos || []) {
    const ruta = window.vigencia.rutaDeArchivo(f) || f?.path || "";
    const nombre = f?.name || (ruta ? ruta.split(/[/\\]/).pop() : "") || "archivo";
    if (!ruta) {
      rechazados.push(nombre);
      continue;
    }
    if (!EXTENSIONES_FUENTE.includes(extensionDe(nombre))) {
      rechazados.push(nombre);
      continue;
    }
    rutas.push(ruta);
  }
  if (!rutas.length) {
    estadoSoltar(`Ningún archivo sirve: use ${EXTENSIONES_FUENTE.join(", ")}.${rechazados.length ? ` No entró: ${rechazados.join(", ")}.` : ""}`, true);
    return;
  }
  $("doc-bib-soltar").classList.add("ocupada");
  estadoSoltar(`Leyendo ${rutas.length} ${rutas.length === 1 ? "archivo" : "archivos"}…`);
  try {
    const r = await window.vigencia.documentosFuentesImportarRutas(rutas);
    if (!r?.ok) {
      estadoSoltar(r?.error || "No pude leer esos archivos.", true);
      return;
    }
    for (const f of r.fuentes || []) doc.bibMarcadas.add(f.id);
    await pintarBiblioteca();
    const partes = [];
    if (r.fuentes?.length) partes.push(`${r.fuentes.length} ${r.fuentes.length === 1 ? "fuente agregada y marcada" : "fuentes agregadas y marcadas"}`);
    if (r.errores?.length) partes.push(`${r.errores.length} fallaron: ${r.errores.map((x) => x.archivo).join(", ")}`);
    if (rechazados.length) partes.push(`no entraron: ${rechazados.join(", ")}`);
    let mensaje = `${partes.join(". ")}.`;
    if (doc.datos && r.fuentes?.length) mensaje += " Pulse Usar las marcadas.";
    estadoSoltar(mensaje, Boolean(r.errores?.length));
  } finally {
    $("doc-bib-soltar").classList.remove("ocupada");
  }
}

function tiposDe(e) {
  try {
    return [...(e.dataTransfer?.types || [])].map((t) => String(t).toLowerCase());
  } catch {
    return [];
  }
}

function iniciarSoltar() {
  const zona = $("doc-bib-soltar");
  const dialogo = $("dialogo-doc-biblioteca");
  if (!zona || !dialogo) return;
  let contador = 0;
  dialogo.addEventListener("dragenter", (e) => {
    if (!tiposDe(e).includes("files")) return;
    contador += 1;
    zona.classList.add("arrastrando");
  });
  dialogo.addEventListener("dragleave", () => {
    contador = Math.max(0, contador - 1);
    if (!contador) zona.classList.remove("arrastrando");
  });
  dialogo.addEventListener("dragover", (e) => {
    if (tiposDe(e).includes("files")) e.preventDefault();
  });
  dialogo.addEventListener("drop", async (e) => {
    if (!tiposDe(e).includes("files")) return;
    e.preventDefault();
    contador = 0;
    zona.classList.remove("arrastrando");
    const archivos = [...(e.dataTransfer?.files || [])];
    if (archivos.length) await soltarFuentes(archivos);
  });
  // La zona también funciona con clic y teclado: abre el importador.
  zona.addEventListener("click", (e) => {
    if (e.target === zona || e.target.closest(".doc-soltar-texto, .doc-soltar-icono")) importarFuente();
  });
  zona.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      importarFuente();
    }
  });
  // Soltar un archivo sobre el texto de una fuente lo importa y lo abre
  // para revisarlo antes de guardar.
  const texto = $("doc-fuente-texto");
  texto.addEventListener("dragover", (e) => {
    if (tiposDe(e).includes("files")) e.preventDefault();
  });
  texto.addEventListener("drop", async (e) => {
    if (!tiposDe(e).includes("files")) return;
    e.preventDefault();
    const primero = [...(e.dataTransfer?.files || [])].find((f) => (window.vigencia.rutaDeArchivo(f) || f?.path) && EXTENSIONES_FUENTE.includes(extensionDe(f.name || f.path || "")));
    if (!primero) {
      mostrarError("doc-fuente-error", `Suelte un archivo ${EXTENSIONES_FUENTE.join(", ")}.`);
      return;
    }
    mostrarError("doc-fuente-error", "");
    const r = await window.vigencia.documentosFuentesImportarRutas([window.vigencia.rutaDeArchivo(primero) || primero.path]);
    if (!r?.ok) {
      mostrarError("doc-fuente-error", r?.error || "No pude leer ese archivo.");
      return;
    }
    const id = r.fuentes?.[0]?.id;
    if (!id) {
      mostrarError("doc-fuente-error", r.errores?.[0]?.error || "No pude leer ese archivo.");
      return;
    }
    if (doc.datos) doc.bibMarcadas.add(id);
    await cargarInicio();
    if (!$("dialogo-doc-biblioteca").hidden) await pintarBiblioteca();
    await abrirFuente(id);
  });
}

// ---------- Perfiles ----------

async function abrirPerfiles() {
  await cargarInicio();
  pintarPerfiles(doc.datos?.perfil?.id || doc.inicio?.perfiles?.[0]?.id || null);
  ui.mostrarDialogo("dialogo-doc-perfiles");
}

async function pintarPerfiles(elegido) {
  const lista = $("doc-perfiles-lista");
  lista.replaceChildren();
  for (const p of doc.inicio?.perfiles || []) {
    const b = nodo("button", "tarjeta doc-tarjeta");
    b.type = "button";
    if (p.id === elegido) b.classList.add("activa");
    b.append(nodo("span", "doc-tarjeta-nombre", p.nombre));
    b.addEventListener("click", () => pintarPerfiles(p.id));
    lista.append(b);
  }
  const p = (doc.inicio?.perfiles || []).find((x) => x.id === elegido) || { id: null, nombre: "", instrucciones: "", estilo: "", modelo: "", tipos: [], fuentes: [] };
  doc.perfilEditado = p.id;
  $("doc-perfil-nombre").value = p.nombre;
  $("doc-perfil-instrucciones").value = p.instrucciones;
  $("doc-perfil-estilo").value = p.estilo;
  llenarModelos($("doc-perfil-modelo"), p.modelo, true);
  $("doc-perfil-borrar").hidden = !p.id;
  const tipos = $("doc-perfil-tipos");
  tipos.replaceChildren();
  for (const t of doc.inicio?.tipos || []) tipos.append(casilla("doc-perfil-tipo", t.id, t.nombre, p.tipos.includes(t.id)));
  const fuentes = $("doc-perfil-fuentes");
  fuentes.replaceChildren();
  const r = await window.vigencia.documentosFuentesBuscar({});
  for (const f of r?.fuentes || []) fuentes.append(casilla("doc-perfil-fuente", String(f.id), f.nombre, p.fuentes.includes(f.id)));
  if (!(r?.fuentes || []).length) fuentes.append(nodo("p", "ayuda", "La biblioteca está vacía."));
  mostrarError("doc-perfil-error", "");
}

function casilla(nombre, valor, etiqueta, marcada) {
  const l = nodo("label", "casilla");
  const c = document.createElement("input");
  c.type = "checkbox";
  c.name = nombre;
  c.value = valor;
  c.checked = marcada;
  l.append(c, nodo("span", "", etiqueta));
  return l;
}

async function guardarPerfil(evento) {
  evento.preventDefault();
  const marcadas = (nombre) => [...document.querySelectorAll(`input[name=${nombre}]:checked`)].map((c) => c.value);
  const r = await window.vigencia.documentosPerfilGuardar({
    id: doc.perfilEditado,
    nombre: $("doc-perfil-nombre").value,
    instrucciones: $("doc-perfil-instrucciones").value,
    estilo: $("doc-perfil-estilo").value,
    modelo: $("doc-perfil-modelo").value,
    tipos: marcadas("doc-perfil-tipo"),
    fuentes: marcadas("doc-perfil-fuente").map(Number),
  });
  if (!r?.ok) return mostrarError("doc-perfil-error", r?.error || "No pude guardar el perfil.");
  await cargarInicio();
  await pintarPerfiles(r.perfil.id);
  if (doc.abierto) await abrirProyecto(doc.abierto, { conservarVista: true });
}

function borrarPerfil() {
  const p = (doc.inicio?.perfiles || []).find((x) => x.id === doc.perfilEditado);
  if (!p) return;
  $("doc-confirmar-titulo").textContent = "Borrar el perfil";
  $("doc-confirmar-texto").textContent = `${p.nombre} se borra. Los documentos que lo usaban quedan sin perfil y conservan sus versiones.`;
  doc.confirmar = async () => {
    const r = await window.vigencia.documentosPerfilBorrar(p.id);
    if (!r?.ok) return mostrarError("doc-perfil-error", r?.error || "No pude borrarlo.");
    await cargarInicio();
    await pintarPerfiles(doc.inicio?.perfiles?.[0]?.id || null);
    if (doc.abierto) await abrirProyecto(doc.abierto, { conservarVista: true });
  };
  ui.mostrarDialogo("dialogo-doc-confirmar");
}

// ---------- Arranque ----------

export const CAPAS_DOCUMENTOS = [
  "dialogo-doc-nuevo",
  "dialogo-doc-biblioteca",
  "dialogo-doc-perfiles",
  "dialogo-doc-historial",
  "dialogo-doc-fuente",
  "dialogo-doc-nombre",
  "dialogo-doc-confirmar",
];

export async function abrirDocumentos() {
  await cargarInicio();
  if (doc.abierto) await abrirProyecto(doc.abierto, { conservarVista: true });
  else pintarProyecto();
}

// ---------- Revisar envío ----------

function revisarEnvio(previa) {
  const inf = previa.informe || {};
  $("envio-resumen").textContent = `Va a enviar ${Number(inf.caracteres || 0).toLocaleString("es-CO")} caracteres (cerca de ${Number(inf.tokens || 0).toLocaleString("es-CO")} tokens) a ${inf.modelo || "la nube"}, con su clave. ${inf.expediente ? "Incluye datos del expediente vinculado. " : ""}${inf.agentes ? "Incluye las instrucciones del proyecto. " : ""}Nada sale si pulsa No enviar.`;
  const lista = $("envio-archivos");
  lista.replaceChildren();
  for (const a of inf.archivos || []) {
    lista.append(nodo("p", "ayuda", `${a.nombre}: ${a.fragmentos} ${a.fragmentos === 1 ? "fragmento" : "fragmentos"}${a.paginas?.length ? `, páginas ${a.paginas.join(", ")}` : ""}`));
  }
  for (const f of inf.fuentes || []) lista.append(nodo("p", "ayuda", `Fuente de la biblioteca: ${f}`));
  if (!lista.children.length) lista.append(nodo("p", "ayuda", "No van archivos ni fuentes."));
  $("envio-texto").textContent = previa.texto || "";
  $("envio-texto").hidden = true;
  $("envio-ver").textContent = "Ver texto exacto";
  ui.mostrarDialogo("dialogo-revisar-envio");
  return new Promise((resolve) => {
    const cerrar = (valor) => {
      $("envio-enviar").onclick = null;
      $("envio-cancelar").onclick = null;
      ui.ocultarDialogo("dialogo-revisar-envio");
      resolve(valor);
    };
    $("envio-enviar").onclick = () => cerrar(inf.hash || "");
    $("envio-cancelar").onclick = () => cerrar("");
  });
}

// ---------- Contexto del proyecto: archivos y AGENTS.md ----------

async function abrirContexto() {
  if (!doc.abierto) return;
  $("doc-ctx-estado").textContent = "";
  const r = await window.vigencia.proyectoAgentesLeer(doc.abierto);
  doc.plantillaAgentes = r?.plantilla || "";
  $("doc-ctx-agentes").value = r?.ok ? r.texto : "";
  $("doc-ctx-agentes").placeholder = doc.plantillaAgentes;
  await pintarArchivosCtx();
  ui.mostrarDialogo("dialogo-doc-contexto");
}

async function pintarArchivosCtx() {
  const r = await window.vigencia.proyectoArchivos(doc.abierto);
  const caja = $("doc-ctx-archivos");
  caja.replaceChildren();
  const lista = r?.ok ? r.archivos : [];
  if (!lista.length) caja.append(nodo("p", "ayuda", "Todavía no hay archivos en este proyecto."));
  for (const a of lista) {
    const fila = nodo("div", "ctx-archivo");
    const marca = document.createElement("input");
    marca.type = "checkbox";
    marca.checked = Boolean(a.incluido);
    marca.title = "Incluir en el contexto";
    marca.addEventListener("change", async () => {
      await window.vigencia.proyectoArchivoIncluir(doc.abierto, a.id, marca.checked);
      await abrirProyecto(doc.abierto, { conservarVista: true });
    });
    const detalle = [a.estado === "listo" ? "listo" : a.estado, a.paginas ? `${a.paginas} págs.` : "", a.paginas_ocr ? `${a.paginas_ocr} con OCR` : "", `${Number(a.tokens_aprox || 0).toLocaleString("es-CO")} tokens aprox.`].filter(Boolean).join(", ");
    const nombre = nodo("span", "nombre", `${a.nombre} (${detalle})`);
    if (a.aviso) nombre.title = a.aviso;
    const quitar = nodo("button", "boton-texto", "Quitar");
    quitar.type = "button";
    quitar.addEventListener("click", async () => {
      await window.vigencia.proyectoArchivoQuitar(doc.abierto, a.id);
      await pintarArchivosCtx();
      await abrirProyecto(doc.abierto, { conservarVista: true });
    });
    fila.append(marca, nombre, quitar);
    caja.append(fila);
    if (a.aviso) caja.append(nodo("p", "ayuda", a.aviso));
  }
}

async function convertirAlProyecto(rutas) {
  if (!rutas.length || !doc.abierto) return;
  $("doc-ctx-estado").textContent = `Convirtiendo ${rutas.length} ${rutas.length === 1 ? "archivo" : "archivos"} en este computador...`;
  const quitar = window.vigencia.alConvertir((p) => {
    if (p?.fase === "ocr") $("doc-ctx-estado").textContent = `${p.nombre}: leyendo con OCR la página ${p.pagina} de ${p.total}`;
    else if (p?.fase === "leyendo" && p.total) $("doc-ctx-estado").textContent = `${p.nombre}: página ${p.pagina} de ${p.total}`;
  });
  try {
    const r = await window.vigencia.convertirRutas(rutas, doc.abierto);
    const errores = (r?.resultados || []).filter((x) => x.error).map((x) => `${x.nombre}: ${x.error}`);
    $("doc-ctx-estado").textContent = errores.length ? errores.join(" ") : "Listo. Los archivos quedaron en el proyecto.";
  } finally {
    quitar();
  }
  await pintarArchivosCtx();
  await abrirProyecto(doc.abierto, { conservarVista: true });
}

function rutasDe(archivos) {
  return [...(archivos || [])].map((f) => window.vigencia.rutaDeArchivo(f) || f?.path || "").filter(Boolean);
}

function iniciarContexto() {
  $("doc-abrir-ctx").addEventListener("click", abrirContexto);
  $("doc-ctx-cerrar").addEventListener("click", () => ui.ocultarDialogo("dialogo-doc-contexto"));
  $("doc-ctx-plantilla").addEventListener("click", () => {
    if (!$("doc-ctx-agentes").value.trim()) $("doc-ctx-agentes").value = doc.plantillaAgentes || "";
  });
  $("doc-ctx-guardar").addEventListener("click", async () => {
    const r = await window.vigencia.proyectoAgentesGuardar(doc.abierto, $("doc-ctx-agentes").value);
    $("doc-ctx-estado").textContent = r?.ok ? "Instrucciones guardadas." : r?.error || "No pude guardarlas.";
  });
  $("doc-ctx-elegir").addEventListener("click", async () => {
    const r = await window.vigencia.convertirElegir();
    await convertirAlProyecto(r?.rutas || []);
  });
  const zona = $("doc-ctx-soltar");
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("sobre");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
  zona.addEventListener("drop", async (e) => {
    e.preventDefault();
    zona.classList.remove("sobre");
    await convertirAlProyecto(rutasDe(e.dataTransfer?.files));
  });
  $("envio-ver").addEventListener("click", () => {
    const t = $("envio-texto");
    t.hidden = !t.hidden;
    $("envio-ver").textContent = t.hidden ? "Ver texto exacto" : "Ocultar texto";
  });
  $("doc-solo-local").addEventListener("change", async () => {
    await cambiarProyecto({ solo_local: $("doc-solo-local").checked });
    await abrirProyecto(doc.abierto, { conservarVista: true });
  });
}

export function iniciarDocumentos(herramientas) {
  if (doc.listo) return;
  doc.listo = true;
  ui = herramientas;
  iniciarContexto();
  $("doc-nuevo").addEventListener("click", abrirNuevo);
  $("doc-nuevo-2").addEventListener("click", abrirNuevo);
  $("form-doc-nuevo").addEventListener("submit", crearNuevo);
  $("doc-nuevo-cancelar").addEventListener("click", () => ui.ocultarDialogo("dialogo-doc-nuevo"));
  $("doc-buscar").addEventListener("input", pintarLista);
  $("doc-tab-activos").addEventListener("click", () => { doc.archivados = false; pintarLista(); });
  $("doc-tab-archivados").addEventListener("click", () => { doc.archivados = true; pintarLista(); });
  $("doc-form").addEventListener("submit", enviar);
  $("doc-mensaje").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar(e);
  });
  $("doc-tipo").addEventListener("change", () => cambiarProyecto({ tipo: $("doc-tipo").value }));
  $("doc-perfil").addEventListener("change", () => {
    doc.modelo = "";
    cambiarProyecto({ perfil_id: Number($("doc-perfil").value) || null });
  });
  $("doc-expediente").addEventListener("change", () => cambiarProyecto({ id_proceso: Number($("doc-expediente").value) || null }));
  $("doc-modelo").addEventListener("change", () => {
    doc.modelo = $("doc-modelo").value;
    pintarPrivacidad();
  });
  $("doc-elegir-fuentes").addEventListener("click", abrirBiblioteca);
  $("doc-abrir-biblioteca").addEventListener("click", abrirBiblioteca);
  $("doc-abrir-perfiles").addEventListener("click", abrirPerfiles);
  $("doc-abrir-modelos").addEventListener("click", async () => {
    await ui.abrirConfigModelos();
  });
  $("doc-version").addEventListener("change", () => verVersion(Number($("doc-version").value)));
  $("doc-historial").addEventListener("click", abrirHistorial);
  $("doc-comparar").addEventListener("click", compararConAnterior);
  $("doc-historial-cerrar").addEventListener("click", () => ui.ocultarDialogo("dialogo-doc-historial"));
  $("doc-editar").addEventListener("click", empezarEdicion);
  $("doc-edicion-cancelar").addEventListener("click", cancelarEdicion);
  $("doc-edicion-guardar").addEventListener("click", guardarEdicion);
  $("doc-word").addEventListener("click", () => exportar("docx"));
  $("doc-pdf").addEventListener("click", () => exportar("pdf"));
  $("doc-odt").addEventListener("click", () => exportar("odt"));
  $("doc-hoja-caja").addEventListener("mouseup", tomarPasaje);
  $("doc-texto").addEventListener("mouseup", tomarPasaje);
  $("doc-texto").addEventListener("keyup", (e) => { if (e.shiftKey) tomarPasaje(); });
  $("doc-pasaje-quitar").addEventListener("click", quitarPasaje);
  $("doc-bib-buscar").addEventListener("input", () => { doc.bibFiltro.texto = $("doc-bib-buscar").value; pintarBiblioteca(); });
  $("doc-bib-clase").addEventListener("change", () => { doc.bibFiltro.clase = $("doc-bib-clase").value; pintarBiblioteca(); });
  $("doc-bib-etiqueta").addEventListener("change", () => { doc.bibFiltro.etiqueta = $("doc-bib-etiqueta").value; pintarBiblioteca(); });
  $("doc-bib-cerrar").addEventListener("click", () => ui.ocultarDialogo("dialogo-doc-biblioteca"));
  $("doc-bib-nueva").addEventListener("click", () => abrirFuente());
  $("doc-bib-importar").addEventListener("click", importarFuente);
  iniciarSoltar();
  $("doc-bib-usar").addEventListener("click", usarMarcadas);
  $("form-doc-fuente").addEventListener("submit", guardarFuente);
  $("doc-fuente-cancelar").addEventListener("click", () => ui.ocultarDialogo("dialogo-doc-fuente"));
  $("doc-fuente-texto").addEventListener("input", largoFuente);
  $("form-doc-perfil").addEventListener("submit", guardarPerfil);
  $("doc-perfil-nuevo").addEventListener("click", () => pintarPerfiles(null));
  $("doc-perfil-borrar").addEventListener("click", borrarPerfil);
  $("doc-perfiles-cerrar").addEventListener("click", () => ui.ocultarDialogo("dialogo-doc-perfiles"));
  $("form-doc-nombre").addEventListener("submit", async (e) => {
    e.preventDefault();
    ui.ocultarDialogo("dialogo-doc-nombre");
    await cambiarProyecto({ nombre: $("doc-nombre-valor").value });
  });
  $("doc-nombre-cancelar").addEventListener("click", () => ui.ocultarDialogo("dialogo-doc-nombre"));
  $("doc-confirmar-no").addEventListener("click", () => ui.ocultarDialogo("dialogo-doc-confirmar"));
  $("doc-confirmar-si").addEventListener("click", async () => {
    ui.ocultarDialogo("dialogo-doc-confirmar");
    const accion = doc.confirmar;
    doc.confirmar = null;
    await accion?.();
  });
}

// Tras cambiar los modelos en Modelos de IA, la lista se relee.
export async function refrescarModelosDocumentos() {
  if (!doc.listo) return;
  await cargarInicio();
  if (doc.datos) pintarProyecto();
}

export { escritoDeTexto };
