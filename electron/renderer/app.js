import {
  causaDelFallo,
  etiquetaCliente,
  fechaCorta,
  instanteLocal,
  nombreCliente,
  normalizarRadicado,
  ordenEs,
  texto,
  textoPausa,
  tipoClave,
  tituloLista,
  tramosDeActuaciones,
  visibles,
} from "../compartido/logica.js";
import { validarHorarios } from "../compartido/horario.js";
import { CAMPOS_INICIALES, TIPOS_INICIALES } from "../compartido/iniciales.js";
import {
  SISTEMAS,
  SISTEMA_INICIAL,
  guardarOcultos,
  leerOcultos,
  sistemaDe,
  sistemaElegible,
  sistemasVisibles,
} from "../compartido/sistemas.js";
import { coincideBusqueda, especialidadDe } from "../compartido/pp.js";
import { planAbierto } from "../compartido/plan.js";
import { CAPAS_DOCUMENTOS, abrirDocumentos, iniciarDocumentos, refrescarModelosDocumentos } from "./documentos.js";
import { abrirJuris, iniciarJuris } from "./juris.js";
import { abrirConvertir, iniciarConvertir, pintarOcr } from "./convertir.js";
import { abrirComentarios, iniciarComentarios } from "./comentarios.js";

const $ = (id) => document.getElementById(id);
const estado = {
  procesos: [],
  clientes: [],
  tipo: "todos",
  despacho: "todos",
  cliente: "todos",
  consulta: "",
  idAbierto: null,
  radicadoVacio: null,
  detalle: null,
  qAct: "",
  recientes: true,
  borrarId: null,
  eliminarId: null,
  formAsignar: false,
  editando: null,
  pausaHasta: null,
  revisando: false,
  agregando: false,
  cargando: false,
  puntual: false,
  expediente: null,
  informe: null,
  ejemploDocx: null,
  relojPausa: 0,
  soloIds: null,
  automatica: null,
  sistema: SISTEMA_INICIAL,
  ocultos: new Set(),
};

function nodo(tag, clase, contenido) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (contenido != null) el.textContent = contenido;
  return el;
}

function ayuda(mensaje, error = false) {
  const caja = $("ayuda");
  caja.textContent = mensaje;
  caja.classList.toggle("error", error);
}

function valorFiltro(valor) {
  return !valor || valor === "todos" ? "" : valor;
}

const menusAbiertos = new Set();

function cerrarMenus() {
  for (const menu of [...menusAbiertos]) menu.cerrar();
}

function menuDesplegable({ etiqueta, clase = "boton-linea boton-icono", titulo = "", items = [] }) {
  const raiz = nodo("div", "menu-raiz");
  const boton = nodo("button", clase, etiqueta);
  boton.type = "button";
  boton.setAttribute("aria-haspopup", "menu");
  boton.setAttribute("aria-expanded", "false");
  const menu = nodo("div", "combo-menu menu");
  menu.hidden = true;
  raiz.append(boton);
  let abierto = false;

  function pintar() {
    menu.replaceChildren();
    if (titulo) menu.append(nodo("p", "combo-titulo", titulo));
    for (const item of items) {
      if (item.separador) {
        menu.append(nodo("div", "combo-separador"));
        continue;
      }
      if (item.titulo) {
        menu.append(nodo("p", "combo-titulo", item.titulo));
        continue;
      }
      const opcion = nodo("button", "combo-opcion", item.etiqueta);
      opcion.type = "button";
      opcion.addEventListener("click", () => {
        cerrar();
        item.alHacer?.();
      });
      menu.append(opcion);
    }
  }

  function colocar() {
    const rect = boton.getBoundingClientRect();
    const ancho = Math.min(360, Math.max(rect.width, 220), window.innerWidth - 24);
    menu.style.width = `${ancho}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - ancho - 12)}px`;
    const alto = menu.offsetHeight || 160;
    const abajo = rect.bottom + 4;
    menu.style.top = `${abajo + alto > window.innerHeight ? Math.max(8, rect.top - alto - 4) : abajo}px`;
  }

  function cerrar() {
    if (!abierto) return;
    abierto = false;
    menu.hidden = true;
    menu.remove();
    boton.setAttribute("aria-expanded", "false");
    menusAbiertos.delete(api);
  }

  function abrir() {
    cerrarMenus();
    pintar();
    abierto = true;
    menu.hidden = false;
    document.body.append(menu);
    boton.setAttribute("aria-expanded", "true");
    menusAbiertos.add(api);
    colocar();
  }

  boton.addEventListener("click", () => (abierto ? cerrar() : abrir()));
  document.addEventListener("click", (evento) => {
    if (!abierto) return;
    if (raiz.contains(evento.target) || menu.contains(evento.target)) return;
    cerrar();
  });
  document.addEventListener("keydown", (evento) => {
    if (!abierto || evento.key !== "Escape") return;
    evento.stopImmediatePropagation();
    cerrar();
  });
  window.addEventListener("resize", () => {
    if (abierto) colocar();
  });

  const api = { raiz, boton, cerrar };
  return api;
}

window.addEventListener("scroll", cerrarMenus, true);

function combo(host, { busca, onCambio }) {
  const raiz = nodo("div", "combo");
  const boton = nodo("button", "combo-boton");
  boton.type = "button";
  boton.setAttribute("aria-haspopup", "listbox");
  boton.setAttribute("aria-expanded", "false");
  const menu = nodo("div", "combo-menu");
  menu.hidden = true;
  const entrada = nodo("input");
  entrada.className = "combo-busca";
  entrada.placeholder = busca;
  entrada.setAttribute("aria-label", busca);
  const opciones = nodo("div", "combo-opciones");
  opciones.setAttribute("role", "listbox");
  menu.append(entrada, opciones);
  raiz.append(boton);
  host.append(raiz);
  document.body.append(menu);
  let items = [];
  let actual = "";
  let abierto = false;

  function etiqueta(valor) {
    return items.find((item) => item.value === valor)?.label || "";
  }

  function pintar(filtro = "") {
    opciones.replaceChildren();
    const q = filtro.trim().toLowerCase();
    const visiblesMenu = items.filter((item) => !q || item.label.toLowerCase().includes(q));
    if (!visiblesMenu.length) {
      opciones.append(nodo("p", "nota", "Nada coincide."));
      return;
    }
    for (const item of visiblesMenu) {
      const opcion = nodo("button", item.value === actual ? "combo-opcion activa" : "combo-opcion", item.label);
      opcion.type = "button";
      opcion.addEventListener("click", () => elegir(item.value));
      opciones.append(opcion);
    }
  }

  function colocar() {
    const rect = boton.getBoundingClientRect();
    const ancho = Math.min(640, Math.max(rect.width, 320), window.innerWidth - 24);
    menu.style.width = `${ancho}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - ancho - 12)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  }

  function cerrar() {
    abierto = false;
    menu.hidden = true;
    boton.setAttribute("aria-expanded", "false");
  }

  function abrir() {
    document.querySelectorAll(".combo-menu").forEach((otro) => {
      if (otro !== menu) otro.hidden = true;
    });
    abierto = true;
    menu.hidden = false;
    boton.setAttribute("aria-expanded", "true");
    entrada.value = "";
    pintar();
    colocar();
    entrada.focus();
  }

  function elegir(valor) {
    actual = valor;
    boton.textContent = etiqueta(valor);
    cerrar();
    onCambio(valor);
  }

  boton.addEventListener("click", () => (abierto ? cerrar() : abrir()));
  entrada.addEventListener("input", () => pintar(entrada.value));
  document.addEventListener("click", (evento) => {
    if (!abierto) return;
    if (raiz.contains(evento.target) || menu.contains(evento.target)) return;
    cerrar();
  });
  document.addEventListener("keydown", (evento) => {
    if (!abierto || evento.key !== "Escape") return;
    evento.stopImmediatePropagation();
    cerrar();
  });
  window.addEventListener("resize", () => {
    if (abierto) colocar();
  });
  $("lista-scroll").addEventListener("scroll", cerrar);

  return {
    set(opcionesNuevas, valor) {
      items = opcionesNuevas;
      actual = items.some((item) => item.value === valor) ? valor : (items[0]?.value || "");
      boton.textContent = etiqueta(actual);
      return actual;
    },
    get() {
      return actual;
    },
    cerrar,
  };
}

const comboTipo = combo($("combo-tipo"), {
  busca: "Buscar tipo",
  onCambio(valor) {
    estado.tipo = valor;
    pintarLista();
  },
});
const comboDespacho = combo($("combo-despacho"), {
  busca: "Buscar despacho",
  onCambio(valor) {
    estado.despacho = valor;
    pintarLista();
  },
});
const comboCliente = combo($("combo-cliente"), {
  busca: "Buscar abogado",
  onCambio(valor) {
    estado.cliente = valor;
    pintarLista();
  },
});

const CAPAS = [
  "dialogo-busqueda",
  "dialogo-csv",
  "dialogo-directorio",
  "dialogo-asignar",
  "dialogo-cliente",
  "dialogo-borrar",
  "dialogo-eliminar",
  "dialogo-escrito",
  "dialogo-modelos",
  "dialogo-informe",
  "dialogo-iniciar",
  "dialogo-ajustes",
  "dialogo-biblioteca",
  "dialogo-pieza",
  "dialogo-actualizar",
  "dialogo-sistemas",
  "dialogo-pp-doc",
  "dialogo-gasto",
  "dialogo-comentarios",
  ...CAPAS_DOCUMENTOS,
];

function cerrarMenuOpciones() {
  const lista = $("menu-lista");
  const boton = $("menu-boton");
  if (!lista || lista.hidden) return;
  lista.hidden = true;
  boton?.setAttribute("aria-expanded", "false");
}

function cerrarCombos() {
  comboTipo.cerrar();
  comboDespacho.cerrar();
  comboCliente.cerrar();
  cerrarMenus();
  cerrarMenuOpciones();
}

function dialogoAlFrente() {
  let cima = null;
  for (const id of CAPAS) {
    if (!$(id).hidden) cima = id;
  }
  return cima;
}

function acomodarCapas() {
  const cima = dialogoAlFrente();
  for (const id of CAPAS) {
    const el = $(id);
    const cubierto = Boolean(cima) && id !== cima && !el.hidden;
    el.inert = cubierto;
    el.classList.toggle("cortina-bajo", cubierto);
  }
}

function mostrarDialogo(id) {
  cerrarCombos();
  $(id).hidden = false;
  acomodarCapas();
}

function ocultarDialogo(id) {
  $(id).hidden = true;
  acomodarCapas();
}

function focosDe(id) {
  return [...$(id).querySelectorAll("input, textarea, select, button")].filter((el) => {
    if (el.disabled || el.hidden) return false;
    if (el.closest("[hidden]")) return false;
    return true;
  });
}

function enfocarDialogo(id) {
  const campo = focosDe(id)[0];
  if (campo) campo.focus();
}

function llenarFiltros() {
  const tipos = new Map();
  const despachos = new Map();
  let sinCliente = 0;
  const porCliente = new Map();
  for (const proceso of estado.procesos) {
    if (proceso.sin_expediente) continue;
    const clave = tipoClave(proceso.tipo_proceso);
    if (clave) tipos.set(clave, (tipos.get(clave) || 0) + 1);
    const despacho = (texto(proceso.despacho) || "");
    if (despacho) despachos.set(despacho, (despachos.get(despacho) || 0) + 1);
    if (!proceso.cliente_id) sinCliente += 1;
    else porCliente.set(proceso.cliente_id, (porCliente.get(proceso.cliente_id) || 0) + 1);
  }
  const opcionesTipo = [{ value: "todos", label: "Todos los tipos" }];
  for (const clave of [...tipos.keys()].sort(ordenEs)) opcionesTipo.push({ value: clave, label: `${clave} (${tipos.get(clave)})` });
  estado.tipo = comboTipo.set(opcionesTipo, estado.tipo);
  const opcionesDespacho = [{ value: "todos", label: "Todos los despachos" }];
  for (const nombre of [...despachos.keys()].sort(ordenEs)) {
    opcionesDespacho.push({ value: nombre, label: `${nombre} (${despachos.get(nombre)})` });
  }
  estado.despacho = comboDespacho.set(opcionesDespacho, estado.despacho);
  const opcionesCliente = [
    { value: "todos", label: "Todos los abogados" },
    { value: "sin", label: `Sin abogado (${sinCliente})` },
  ];
  for (const cliente of estado.clientes) {
    opcionesCliente.push({
      value: String(cliente.id),
      label: `${etiquetaCliente(cliente, estado.clientes)} (${porCliente.get(cliente.id) || 0})`,
    });
  }
  estado.cliente = comboCliente.set(opcionesCliente, estado.cliente);
}

function listaVisible() {
  const lista = visibles(
    estado.procesos,
    estado.consulta,
    valorFiltro(estado.tipo),
    valorFiltro(estado.despacho) ? estado.despacho : "",
    valorFiltro(estado.cliente),
  );
  if (!estado.soloIds) return lista;
  const ids = new Set(estado.soloIds.map(Number));
  return lista.filter((proceso) => ids.has(Number(proceso.id_proceso)));
}

function esActual(proceso) {
  if (proceso.id_proceso && estado.idAbierto) return Number(proceso.id_proceso) === Number(estado.idAbierto);
  return Boolean(proceso.sin_expediente && proceso.radicado === estado.radicadoVacio);
}

function pintarLista() {
  const lista = listaVisible();
  const enConsulta = estado.procesos.filter((proceso) => !proceso.sin_expediente).length;
  $("resumen").textContent = `${enConsulta} expedientes`;
  const hayFiltro = Boolean(estado.soloIds || estado.consulta.trim() || valorFiltro(estado.tipo) || valorFiltro(estado.despacho) || valorFiltro(estado.cliente));
  $("cuenta").textContent = !hayFiltro && lista.length === enConsulta
    ? `${lista.length} por última actuación`
    : `${lista.length} de ${enConsulta}`;
  const activo = $("filtro-activo");
  activo.replaceChildren();
  if (estado.soloIds) {
    const fila = nodo("div", "hermanos");
    fila.append(nodo("p", "", `Cambios de la revisión automática (${estado.soloIds.length})`));
    const todos = nodo("button", "boton-texto", "Ver todos");
    todos.type = "button";
    todos.addEventListener("click", () => {
      estado.soloIds = null;
      pintarLista();
    });
    fila.append(todos);
    activo.append(fila);
  }
  if (valorFiltro(estado.despacho)) activo.append(nodo("p", "", estado.despacho));
  if (valorFiltro(estado.cliente)) {
    const cliente = estado.clientes.find((item) => String(item.id) === estado.cliente);
    const rotulo = estado.cliente === "sin" ? "Sin abogado" : (cliente ? etiquetaCliente(cliente, estado.clientes) : "");
    if (rotulo) activo.append(nodo("p", "", rotulo));
  }
  $("nota").hidden = true;
  $("nota").textContent = "";
  const contenedor = $("lista");
  contenedor.replaceChildren();
  if (!lista.length) {
    contenedor.append(nodo("p", "vacio-lista", "Ningún expediente coincide."));
    return;
  }
  for (const proceso of lista) {
    const tipo = tipoClave(proceso.tipo_proceso);
    const titulo = tituloLista(proceso);
    const despacho = texto(proceso.despacho) || "";
    const contexto = [tipo, despacho && despacho !== titulo ? despacho : ""].filter(Boolean).join(" · ");
    const tarjeta = nodo("article", `tarjeta${esActual(proceso) ? " activa" : ""}`);
    tarjeta.tabIndex = 0;
    tarjeta.setAttribute("role", "button");
    tarjeta.dataset.id = proceso.id_proceso ? String(proceso.id_proceso) : "";
    tarjeta.dataset.radicado = proceso.radicado || "";
    tarjeta.dataset.vacio = proceso.sin_expediente ? "1" : "0";
    tarjeta.append(nodo("p", "cuando", proceso.fecha_ultima_actuacion ? fechaCorta(proceso.fecha_ultima_actuacion) : "Sin actuación"));
    tarjeta.append(nodo("p", "acto", texto(proceso.ultima_actuacion) || (proceso.sin_expediente ? "No está en esta consulta" : "Sin texto de actuación")));
    tarjeta.append(nodo("p", "titulo-lista", titulo));
    tarjeta.append(nodo("p", "radicado-lista mono", proceso.radicado || ""));
    if (contexto) tarjeta.append(nodo("p", "meta", contexto));
    if (proceso.cliente_id) {
      const aQuien = texto(proceso.representado) ? ` · representa a ${texto(proceso.representado)}` : "";
      tarjeta.append(nodo("p", "meta cliente-lista", `Abogado · ${nombreCliente(proceso)}${aQuien}`));
    }
    const abrir = () => {
      if (tarjeta.dataset.vacio === "1") abrirVacio(proceso.radicado);
      else abrirId(proceso.id_proceso);
    };
    tarjeta.addEventListener("click", abrir);
    tarjeta.addEventListener("keydown", (evento) => {
      if (evento.key !== "Enter" && evento.key !== " ") return;
      evento.preventDefault();
      abrir();
    });
    contenedor.append(tarjeta);
  }
}

function marcar() {
  const tarjeta = [...document.querySelectorAll(".tarjeta")].find((item) => {
    if (estado.idAbierto) return item.dataset.id === String(estado.idAbierto);
    return item.dataset.vacio === "1" && item.dataset.radicado === estado.radicadoVacio;
  });
  document.querySelectorAll(".tarjeta.activa").forEach((item) => item.classList.remove("activa"));
  if (!tarjeta) return;
  tarjeta.classList.add("activa");
  tarjeta.scrollIntoView({ block: "nearest" });
}

function vacioInicial() {
  const detalle = $("detalle");
  detalle.replaceChildren();
  const caja = nodo("div", "vacio-detalle");
  caja.append(nodo("h2", "serif", "Elige un expediente"));
  caja.append(nodo("p", "", "La lista va por la última actuación. Puedes buscar por radicado, parte, despacho, abogado o tipo. La tecla / enfoca el buscador."));
  detalle.append(caja);
}

function pintarMensaje(mensaje, detalle = "") {
  const caja = $("detalle");
  caja.replaceChildren();
  const bloque = nodo("div", "vacio-detalle");
  bloque.append(nodo("h2", "serif", mensaje));
  if (detalle) bloque.append(nodo("p", "causa-error", detalle));
  caja.append(bloque);
}

function abrirVacio(radicado) {
  const proceso = estado.procesos.find((item) => item.sin_expediente && item.radicado === radicado);
  if (!proceso) return;
  estado.idAbierto = null;
  estado.detalle = null;
  estado.radicadoVacio = radicado;
  const detalle = $("detalle");
  detalle.replaceChildren();
  const cabecera = nodo("div", "cabecera lectura");
  cabecera.append(nodo("p", "radicado-grande mono", proceso.radicado || ""));
  cabecera.append(nodo("h2", "expediente-titulo serif", "No está en esta consulta"));
  cabecera.append(nodo("p", "despacho", "Este radicado no aparece en la Rama Judicial. La búsqueda en otro sistema queda para después."));
  cabecera.append(nodo("p", "despacho", "Cuando la Rama devuelva el expediente podrás asignarle un abogado."));
  detalle.append(cabecera);
  marcar();
}

async function abrirId(id) {
  estado.qAct = "";
  estado.recientes = true;
  const respuesta = await window.vigencia.detalle(id);
  if (!respuesta.ok || !respuesta.proceso) {
    pintarMensaje("No pude abrir ese expediente.", respuesta.error || "");
    return;
  }
  estado.idAbierto = Number(id);
  estado.radicadoVacio = null;
  estado.detalle = respuesta.proceso;
  pintarExpediente();
  marcar();
}

function tituloExpediente(proceso) {
  const dantes = (proceso.sujetos || []).filter((s) => s.rol_base === "demandante" && s.nombre).map((s) => s.nombre);
  const dados = (proceso.sujetos || []).filter((s) => s.rol_base === "demandado" && s.nombre).map((s) => s.nombre);
  if (dantes.length || dados.length) return `${dantes.join(", ") || "Sin demandante"} contra ${dados.join(", ") || "Sin demandado"}`;
  return texto(proceso.despacho) || "Expediente privado";
}

function pintarExpediente() {
  cerrarMenus();
  cerrarMenuOpciones();
  const proceso = estado.detalle;
  const detalle = $("detalle");
  detalle.replaceChildren();
  detalle.append(fichaExpediente(proceso));
  const partes = seccionPartes(proceso);
  if (partes) detalle.append(partes);
  detalle.append(tarjetaCliente(proceso));
  const cabAct = nodo("div", "actos-cabeza");
  cabAct.append(nodo("h2", "seccion serif", "Actuaciones"));
  cabAct.append(nodo("span", "actos-total", String((proceso.actuaciones || []).length)));
  detalle.append(cabAct);
  detalle.append(ctaMemorial(proceso));
  if (!proceso.actuaciones_consultado_en) {
    detalle.append(nodo("p", "nota sangria", "Las actuaciones todavía no se han consultado."));
    return;
  }
  if (!(proceso.actuaciones || []).length) {
    detalle.append(nodo("p", "nota sangria", "Este expediente no tiene actuaciones registradas."));
    return;
  }
  const herramientas = nodo("div", "herramientas");
  const busca = nodo("input");
  busca.placeholder = "Fecha, actuación o anotación";
  busca.setAttribute("aria-label", "Buscar actuación");
  busca.value = estado.qAct;
  busca.addEventListener("input", () => {
    estado.qAct = busca.value;
    pintarActos();
  });
  const orden = nodo("button", "boton-linea", estado.recientes ? "Antiguas primero" : "Recientes primero");
  orden.type = "button";
  orden.id = "boton-orden";
  orden.title = "Cambia el orden de las actuaciones";
  orden.addEventListener("click", () => {
    estado.recientes = !estado.recientes;
    orden.textContent = estado.recientes ? "Antiguas primero" : "Recientes primero";
    pintarActos();
  });
  herramientas.append(busca, orden);
  detalle.append(herramientas);
  const cuenta = nodo("p", "cuenta sangria", "");
  cuenta.id = "cuenta-act";
  detalle.append(cuenta);
  const actos = nodo("div", "actos");
  actos.id = "actos";
  detalle.append(actos);
  pintarActos();
}

function fichaExpediente(proceso) {
  const ficha = nodo("div", "cabecera lectura ficha");
  const arriba = nodo("div", "ficha-arriba");
  const textoFicha = nodo("div", "ficha-texto");
  const linea = [tipoClave(proceso.tipo_proceso), texto(proceso.clase_proceso)].filter(Boolean).join(" · ");
  textoFicha.append(nodo("p", "kicker", linea || texto(proceso.despacho) || "Expediente"));
  textoFicha.append(nodo("h2", "expediente-titulo serif", tituloExpediente(proceso)));
  const fila = nodo("div", "fila-radicado");
  fila.append(nodo("p", "radicado-grande mono", proceso.radicado || ""));
  fila.append(botonCopiarRadicado(proceso));
  textoFicha.append(fila);
  arriba.append(textoFicha, accionesExpediente(proceso));
  ficha.append(arriba);
  const datos = filaDatos(proceso);
  if (datos) ficha.append(datos);
  return ficha;
}

function etiquetaHermano(otro) {
  const base = texto(otro.despacho) || texto(otro.clase_proceso) || "Otro expediente";
  const cuando = otro.fecha_ultima_actuacion ? fechaCorta(otro.fecha_ultima_actuacion) : "";
  return cuando ? `${base} · ${cuando}` : base;
}

function accionesExpediente(proceso) {
  const fila = nodo("div", "acciones-exp");
  const actualizarUno = nodo("button", "boton-linea", "Actualizar");
  actualizarUno.type = "button";
  actualizarUno.id = "actualizar-uno";
  actualizarUno.title = "Revisa solo las actuaciones de este expediente";
  const ocupadoUno = Boolean(estado.revisando || estado.cargando || estado.puntual);
  actualizarUno.disabled = ocupadoUno;
  if (estado.puntual && Number(estado.expediente) === Number(proceso.id_proceso)) actualizarUno.textContent = "Revisando…";
  actualizarUno.addEventListener("click", () => actualizarEste(proceso));
  const hermanos = estado.procesos.filter((otro) => otro.radicado === proceso.radicado && otro.id_proceso && Number(otro.id_proceso) !== Number(proceso.id_proceso));
  const items = [];
  if (hermanos.length) {
    items.push(
      { titulo: `Expedientes de este radicado (${hermanos.length + 1})` },
      ...hermanos.map((otro) => ({
        etiqueta: etiquetaHermano(otro),
        alHacer: () => abrirId(otro.id_proceso),
      })),
      { separador: true },
    );
  }
  items.push({ etiqueta: "Eliminar expediente", alHacer: () => pedirEliminar(proceso) });
  const mas = menuDesplegable({ etiqueta: "⋯", titulo: "Acciones del expediente", items });
  fila.append(actualizarUno, mas.raiz);
  return fila;
}

function ultimaDe(proceso) {
  let ultima = null;
  for (const act of proceso.actuaciones || []) {
    if (!ultima || String(act.fecha_actuacion || "") >= String(ultima.fecha_actuacion || "")) ultima = act;
  }
  return ultima;
}

function ctaMemorial(proceso) {
  const caja = nodo("div", "cta-memorial");
  const info = nodo("div", "cta-texto");
  info.append(nodo("p", "cta-titulo", "¿Responder a lo último del proceso?"));
  const ultima = ultimaDe(proceso);
  if (ultima) {
    const que = [texto(ultima.actuacion), ultima.fecha_actuacion ? fechaCorta(ultima.fecha_actuacion) : ""].filter(Boolean).join(" · ");
    if (que) info.append(nodo("p", "cta-ultima", `Última: ${que}`));
  } else {
    info.append(nodo("p", "cta-ultima", "Arma un memorial con los datos de este expediente, en este computador."));
  }
  const boton = nodo("button", "boton-cobre cta-boton", "✎ Crear documento");
  boton.type = "button";
  boton.title = "Arma un memorial con este expediente, en este computador";
  boton.addEventListener("click", abrirEscrito);
  caja.append(info, boton);
  return caja;
}

function botonCopiarRadicado(proceso) {
  const copiar = nodo("button", "boton-icono", "⧉");
  copiar.type = "button";
  copiar.title = "Copiar radicado";
  copiar.setAttribute("aria-label", "Copiar radicado");
  copiar.addEventListener("click", async () => {
    const respuesta = await window.vigencia.copiar(proceso.radicado);
    if (!respuesta.ok) return;
    copiar.textContent = "✓";
    copiar.classList.add("ok");
    setTimeout(() => {
      if (copiar.isConnected) {
        copiar.textContent = "⧉";
        copiar.classList.remove("ok");
      }
    }, 1600);
  });
  return copiar;
}

function filaDatos(proceso) {
  const filas = [
    ["Subclase", texto(proceso.subclase_proceso)],
    ["Despacho", texto(proceso.despacho)],
    ["Departamento", texto(proceso.departamento)],
    ["Ubicación", texto(proceso.ubicacion)],
    ["Fecha del proceso", proceso.fecha_proceso ? fechaCorta(proceso.fecha_proceso) : ""],
    ["Última actuación", proceso.fecha_ultima_actuacion ? fechaCorta(proceso.fecha_ultima_actuacion) : ""],
  ].filter(([, valor]) => Boolean(valor));
  if (!filas.length) return null;
  const caja = nodo("div", "datos");
  for (const [clave, valor] of filas) {
    const dato = nodo("div", "dato");
    dato.append(nodo("p", "dato-clave", clave), nodo("p", "dato-valor", valor));
    caja.append(dato);
  }
  return caja;
}

const ROLES_PARTE = [
  ["demandante", "Demandantes"],
  ["demandado", "Demandados"],
  ["defensor", "Defensores"],
  ["curador", "Curadores"],
  ["otro", "Otras partes"],
];

function seccionPartes(proceso) {
  const sujetos = (proceso.sujetos || []).filter((sujeto) => texto(sujeto.nombre));
  if (!sujetos.length) return null;
  const seccion = nodo("section", "partes");
  seccion.append(nodo("h2", "seccion serif", "Partes"));
  const grilla = nodo("div", "partes-grilla");
  for (const [rol, titulo] of ROLES_PARTE) {
    const grupo = sujetos.filter((sujeto) => (sujeto.rol_base || "otro") === rol);
    if (!grupo.length) continue;
    const columna = nodo("div", "partes-columna");
    columna.append(nodo("p", "partes-rol", titulo));
    for (const sujeto of grupo) {
      const item = nodo("div", "parte");
      item.append(nodo("p", "parte-nombre", texto(sujeto.nombre)));
      const notas = [];
      if (texto(sujeto.identificacion)) notas.push(texto(sujeto.identificacion));
      if (sujeto.es_emplazado) notas.push("Emplazado");
      if (notas.length) item.append(nodo("p", "parte-nota", notas.join(" · ")));
      columna.append(item);
    }
    grilla.append(columna);
  }
  seccion.append(grilla);
  return seccion;
}

function tarjetaCliente(proceso) {
  const caja = nodo("div", "cliente-caja");
  const arriba = nodo("div", "cliente-arriba");
  arriba.append(nodo("p", "kicker", "Abogado"));
  const cliente = proceso.cliente;
  if (!cliente) {
    const asignar = nodo("button", "boton-cobre", "Asignar abogado");
    asignar.type = "button";
    asignar.addEventListener("click", abrirAsignar);
    arriba.append(asignar);
    caja.append(arriba, nodo("p", "despacho", "Este expediente no tiene abogado."));
    return caja;
  }
  const acciones = nodo("div", "cliente-acciones");
  const cambiar = nodo("button", "boton-linea", "Cambiar");
  cambiar.type = "button";
  cambiar.addEventListener("click", abrirAsignar);
  const menu = menuDesplegable({
    etiqueta: "⋯",
    titulo: "Abogado",
    items: [
      { etiqueta: "Editar abogado", alHacer: () => abrirFormulario(cliente, false) },
      { etiqueta: "Quitar abogado", alHacer: () => asignarA(null) },
    ],
  });
  acciones.append(cambiar, menu.raiz);
  arriba.append(acciones);
  const datos = nodo("div", "cliente-datos");
  datos.append(nodo("p", "cliente-nombre", nombreCliente(cliente)));
  const identidad = [
    texto(cliente.cedula) ? `C.C. ${texto(cliente.cedula)}` : "",
    texto(cliente.tarjeta) ? `T.P. ${texto(cliente.tarjeta)}` : "",
  ].filter(Boolean).join(" · ");
  if (identidad) datos.append(nodo("p", "despacho", identidad));
  const contacto = [texto(cliente.telefonos), texto(cliente.email), texto(cliente.direccion)].filter(Boolean).join(" · ");
  if (contacto) datos.append(nodo("p", "despacho", contacto));
  datos.append(controlRepresentado(proceso));
  caja.append(arriba, datos);
  return caja;
}

const ETIQUETA_ROL = {
  demandante: "demandante",
  demandado: "demandado",
  defensor: "defensor",
  curador: "curador",
  otro: "tercero u otra parte",
};

function campoRepresentado(etiquetaTexto, valor, tipo = "text") {
  const etiqueta = nodo("label", "etiqueta", etiquetaTexto);
  const campo = document.createElement(tipo === "area" ? "textarea" : "input");
  if (tipo !== "area") campo.type = "text";
  campo.maxLength = tipo === "area" ? 300 : 80;
  campo.value = valor || "";
  campo.setAttribute("aria-label", etiquetaTexto);
  etiqueta.append(campo);
  return { etiqueta, campo };
}

function controlRepresentado(proceso) {
  const fila = nodo("div", "representado");
  const etiqueta = nodo("label", "etiqueta", "Representa a");
  etiqueta.htmlFor = "representado-elige";
  const opciones = [];
  const select = document.createElement("select");
  select.id = "representado-elige";
  select.append(new Option("Sin indicar", ""));
  for (const [rol] of ROLES_PARTE) {
    for (const sujeto of proceso.sujetos || []) {
      if (sujeto.rol_base !== rol || !texto(sujeto.nombre)) continue;
      opciones.push({
        rol,
        nombre: texto(sujeto.nombre),
        cedula: texto(sujeto.identificacion) || "",
      });
      select.append(new Option(`${texto(sujeto.nombre)} · ${ETIQUETA_ROL[rol] || rol}`, String(opciones.length - 1)));
    }
  }
  select.append(new Option("Texto libre", "__libre"));
  const libre = document.createElement("input");
  libre.type = "text";
  libre.maxLength = 200;
  libre.placeholder = "Quién representa, si no está entre las partes";
  libre.setAttribute("aria-label", "Representado en texto libre");
  const cedula = campoRepresentado("Cédula", texto(proceso.cliente?.representado_cedula));
  const direccion = campoRepresentado("Dirección de notificación", texto(proceso.cliente?.representado_direccion), "area");
  const telefono = campoRepresentado("Teléfono", texto(proceso.cliente?.representado_telefono));
  const datos = nodo("div", "representado-datos");
  datos.append(cedula.etiqueta, direccion.etiqueta, telefono.etiqueta);
  const actual = texto(proceso.cliente?.representado);
  const rol = texto(proceso.cliente?.representado_rol);
  const indice = opciones.findIndex((opcion) => opcion.rol === rol && opcion.nombre === actual);
  if (indice >= 0) select.value = String(indice);
  else if (actual) {
    select.value = "__libre";
    libre.value = actual;
  }
  libre.hidden = select.value !== "__libre";
  datos.hidden = !select.value;
  function pedido() {
    if (!select.value) return { texto: "", rol: "", cedula: "", direccion: "", telefono: "" };
    if (select.value === "__libre") {
      return {
        texto: libre.value,
        rol: "",
        cedula: cedula.campo.value,
        direccion: direccion.campo.value,
        telefono: telefono.campo.value,
      };
    }
    const opcion = opciones[Number(select.value)];
    return {
      texto: opcion.nombre,
      rol: opcion.rol,
      cedula: cedula.campo.value,
      direccion: direccion.campo.value,
      telefono: telefono.campo.value,
    };
  }
  select.addEventListener("change", () => {
    libre.hidden = select.value !== "__libre";
    datos.hidden = !select.value;
    if (select.value === "__libre") {
      if (!libre.value && actual) libre.value = actual;
      libre.focus();
      return;
    }
    if (!select.value) {
      guardarRepresentadoEnFicha(pedido());
      return;
    }
    const opcion = opciones[Number(select.value)];
    const mismo = opcion.nombre === actual && opcion.rol === rol;
    if (!mismo) {
      cedula.campo.value = opcion.cedula || "";
      direccion.campo.value = "";
      telefono.campo.value = "";
    }
    guardarRepresentadoEnFicha(pedido());
  });
  libre.addEventListener("change", () => {
    if (texto(libre.value)) guardarRepresentadoEnFicha(pedido());
  });
  for (const campo of [cedula.campo, direccion.campo, telefono.campo]) {
    campo.addEventListener("change", () => {
      if (texto(pedido().texto)) guardarRepresentadoEnFicha(pedido());
    });
  }
  fila.append(etiqueta, select, libre, datos);
  return fila;
}

async function guardarRepresentadoEnFicha(dato) {
  if (!estado.idAbierto) return;
  const respuesta = await window.vigencia.guardarRepresentado(estado.idAbierto, dato);
  if (!respuesta.ok) {
    ayuda(respuesta.error, true);
    return;
  }
  await cargar();
  await abrirId(estado.idAbierto);
}

function pintarActos() {
  const proceso = estado.detalle;
  const actos = $("actos");
  const cuenta = $("cuenta-act");
  if (!proceso || !actos || !cuenta) return;
  let filas = [...(proceso.actuaciones || [])];
  const partes = estado.qAct.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (partes.length) {
    filas = filas.filter((act) => {
      const bolsa = [act.fecha_actuacion, act.actuacion, act.anotacion].map((campo) => texto(campo) || "").join(" ").toLowerCase();
      return partes.every((parte) => bolsa.includes(parte));
    });
  }
  if (!estado.recientes) filas.reverse();
  const total = (proceso.actuaciones || []).length;
  cuenta.textContent = filas.length === total ? `${total} actuaciones` : `${filas.length} de ${total} actuaciones`;
  actos.replaceChildren();
  if (!filas.length) {
    actos.append(nodo("p", "nota", "Ninguna actuación coincide."));
    return;
  }
  const linea = nodo("div", "timeline");
  const marcaUltima = estado.recientes && !estado.qAct.trim();
  let primera = true;
  for (const tramo of tramosDeActuaciones(filas)) {
    const bloque = nodo("section", "tramo");
    const cabeza = nodo("div", "tramo-cabeza");
    const cuando = document.createElement("time");
    cuando.className = "tramo-fecha";
    cuando.dateTime = texto(tramo.clave).slice(0, 10);
    cuando.textContent = fechaCorta(tramo.clave);
    cabeza.append(cuando);
    if (tramo.actos.length > 1) cabeza.append(nodo("span", "tramo-cuenta", `${tramo.actos.length} actuaciones`));
    bloque.append(cabeza);
    const cuerpo = nodo("div", "tramo-cuerpo");
    for (const act of tramo.actos) {
      const tarjeta = nodo("article", "tramo-acto");
      if (marcaUltima && primera) {
        primera = false;
        tarjeta.classList.add("reciente");
        tarjeta.append(nodo("span", "etiqueta-ultima", "Última"));
      }
      tarjeta.append(nodo("strong", "", texto(act.actuacion) || "Sin descripción"));
      if (texto(act.anotacion)) tarjeta.append(nodo("p", "anotacion", texto(act.anotacion)));
      cuerpo.append(tarjeta);
    }
    bloque.append(cuerpo);
    linea.append(bloque);
  }
  actos.append(linea);
}

function partesDelEscrito(proceso) {
  const sujetos = proceso?.sujetos || [];
  const nombres = (rol) => sujetos.filter((sujeto) => sujeto.rol_base === rol && texto(sujeto.nombre)).map((sujeto) => texto(sujeto.nombre));
  const demandantes = nombres("demandante");
  const demandados = nombres("demandado");
  if (demandantes.length || demandados.length) {
    return `${demandantes.join(", ") || "Sin demandante"} contra ${demandados.join(", ") || "Sin demandado"}`;
  }
  const otros = sujetos.map((sujeto) => texto(sujeto.nombre)).filter(Boolean);
  return otros.join(", ") || "Sin partes cargadas";
}

function pintarCartaEscrito() {
  const proceso = estado.detalle;
  if (!proceso) return;
  $("escrito-despacho").textContent = texto(proceso.despacho) || "Despacho de conocimiento";
  $("escrito-radicado").textContent = proceso.radicado || "Sin radicado";
  $("escrito-partes").textContent = partesDelEscrito(proceso);
  $("escrito-referencia").value = "";
  const abogado = nombreCliente(proceso.cliente);
  const elige = $("escrito-quien-elige");
  const quien = $("escrito-quien");
  if (abogado) {
    elige.hidden = true;
    const representado = texto(proceso.cliente?.representado);
    quien.textContent = representado
      ? `Presenta ${abogado}, en representación de ${representado}.`
      : `Presenta ${abogado}.`;
    return;
  }
  const select = $("escrito-presenta");
  select.replaceChildren();
  const orden = ROLES_PARTE.map(([rol]) => rol);
  const sujetos = (proceso.sujetos || [])
    .filter((sujeto) => texto(sujeto.nombre))
    .sort((a, b) => orden.indexOf(a.rol_base) - orden.indexOf(b.rol_base) || texto(a.nombre).localeCompare(texto(b.nombre), "es"));
  for (const sujeto of sujetos) {
    const rol = ETIQUETA_ROL[sujeto.rol_base] || sujeto.rol_base || "parte";
    select.append(new Option(`${texto(sujeto.nombre)} · ${rol}`, texto(sujeto.nombre)));
  }
  if (!sujetos.length) select.append(new Option("Quien suscribe", ""));
  elige.hidden = false;
  quien.textContent = "Este expediente no tiene abogado. Elija la parte que presenta el escrito.";
}

function quitarDocxEscrito() {
  estado.ejemploDocx = null;
  const entrada = $("escrito-docx");
  if (entrada) entrada.value = "";
  $("escrito-docx-nota").textContent = "Si ya tiene un memorial, se usa para entender la forma y los pormenores.";
  $("escrito-docx-quitar").hidden = true;
}

function abrirEscrito() {
  if (!estado.detalle?.id_proceso) return;
  estado.borrador = null;
  $("escrito-prompt").value = "";
  $("escrito-error").hidden = true;
  $("escrito-error").textContent = "";
  $("escrito-estado").hidden = true;
  $("escrito-estado").textContent = "";
  $("escrito-vista").hidden = true;
  $("escrito-vista").replaceChildren();
  $("escrito-vivo").hidden = true;
  $("escrito-vivo").replaceChildren();
  $("escrito-word").disabled = true;
  $("escrito-pdf").disabled = true;
  $("escrito-generar").disabled = false;
  quitarDocxEscrito();
  pintarCartaEscrito();
  olvidarDudas("escrito");
  mostrarDialogo("dialogo-escrito");
  cargarModelosEscrito();
  $("escrito-prompt").focus();
}

async function cargarModelosEscrito() {
  const select = $("escrito-modelo");
  select.replaceChildren();
  const respuesta = await window.vigencia.modelosListar();
  const modelos = respuesta?.ok ? respuesta.modelos : [{ id: "sencillo", nombre: "Sencillo (plantilla básica)", detalle: "" }];
  const activo = respuesta?.ok ? respuesta.activo : "sencillo";
  for (const modelo of modelos) {
    const opcion = document.createElement("option");
    opcion.value = modelo.id;
    opcion.textContent = modelo.nombre;
    opcion.title = modelo.detalle || modelo.nombre;
    select.append(opcion);
  }
  select.value = modelos.some((modelo) => modelo.id === activo) ? activo : "sencillo";
  pintarNotaModelo();
  await pintarContextoGeneracion();
}

function pintarNotaModelo() {
  const select = $("escrito-modelo");
  const nota = $("escrito-modelo-nota");
  const elegido = select.selectedOptions[0];
  const sencillo = !elegido || elegido.value === "sencillo";
  nota.textContent = sencillo
    ? "Plantilla básica: no usa modelo ni la biblioteca. Siempre arma el mismo memorial."
    : (elegido.title || "");
  const notaContexto = $("escrito-contexto-nota");
  if (notaContexto) {
    notaContexto.textContent = sencillo
      ? "La plantilla básica no usa estas piezas."
      : "Quite la marca para dejar una pieza por fuera solo esta vez.";
  }
}

async function cargar() {
  const respuesta = await window.vigencia.listar();
  if (!respuesta.ok) {
    $("resumen").textContent = "No pude leer la base.";
    $("cuenta").textContent = "Sin datos";
    ayuda(respuesta.error || "No pude leer la base.", true);
    return;
  }
  estado.procesos = respuesta.procesos;
  estado.clientes = respuesta.clientes;
  llenarFiltros();
  pintarLista();
}

function pintarActualizar() {
  window.clearTimeout(estado.relojPausa);
  const fin = instanteLocal(estado.pausaHasta);
  const bloqueado = fin != null && fin > Date.now();
  $("actualizar").disabled = Boolean(estado.revisando || estado.cargando || estado.puntual) || bloqueado;
  $("actualizar").textContent = estado.revisando ? "Revisando…" : "Actualizar todo";
  $("actualizar").title = estado.revisando
    ? "Revisando las actuaciones. Puedes agregar un radicado mientras tanto."
    : (bloqueado ? textoPausa(estado.pausaHasta) : "Revisa solo las actuaciones de cada expediente");
  if (bloqueado && !estado.revisando) {
    estado.relojPausa = window.setTimeout(pintarActualizar, fin - Date.now());
  }
}

function pintarOcupados() {
  $("agregar").disabled = Boolean(estado.agregando || estado.cargando);
  $("agregar").title = estado.revisando && !estado.agregando && !estado.cargando
    ? "Puedes agregar un radicado mientras se revisan las actuaciones."
    : "";
  $("recargar").disabled = Boolean(estado.revisando || estado.agregando || estado.cargando);
  $("cargar-csv").disabled = Boolean(estado.revisando || estado.agregando || estado.cargando || estado.puntual);
  $("cargar-csv").textContent = estado.cargando ? "Cargando…" : "Cargar CSV";
  const uno = $("actualizar-uno");
  if (uno) {
    const este = estado.puntual && Number(estado.expediente) === Number(estado.detalle?.id_proceso);
    uno.disabled = Boolean(estado.revisando || estado.cargando || estado.puntual);
    uno.textContent = este ? "Revisando…" : "Actualizar";
  }
  pintarActualizar();
}

function tomarMarcas(dato) {
  if (!dato) return;
  if ("revisando" in dato) estado.revisando = Boolean(dato.revisando);
  if ("agregando" in dato) estado.agregando = Boolean(dato.agregando);
  if ("cargando" in dato) estado.cargando = Boolean(dato.cargando);
  if ("puntual" in dato) estado.puntual = Boolean(dato.puntual);
  if ("expediente" in dato) estado.expediente = dato.expediente || null;
}

function mostrarCaja(error = false) {
  $("caja-registro").hidden = false;
  $("registro").classList.toggle("registro-error", error);
}

function aplicarAgregar(dato) {
  const lineas = dato.lineas || [];
  if (lineas.length) {
    $("dialogo-log").textContent = dato.corriendo ? lineas.slice(-20).join("\n") : lineas.join("\n");
  }
  if (dato.corriendo) return;
  const numero = dato.radicado || normalizarRadicado($("nuevo").value);
  if (dato.exit_code) mostrarFallo(numero, dato.exit_code, lineas, dato.fin);
  else {
    ocultarDialogo("dialogo-busqueda");
    if (!estado.revisando && !estado.cargando && lineas.length) {
      $("registro-titulo").textContent = "Registro de la búsqueda";
      $("registro").classList.remove("registro-error");
      $("registro").textContent = `${lineas.join("\n")}\nTerminó ${dato.fin || ""}.`;
      mostrarCaja(false);
    }
  }
  cargar().then(() => {
    if (!dato.exit_code) mostrarAgregado(numero);
  });
}

function aplicarRevision(dato) {
  const lineas = dato.lineas || [];
  if (lineas.length || dato.fin) {
    let cierre = "";
    if (!dato.corriendo && dato.fin) {
      if (dato.exit_code) {
        const causa = causaDelFallo(lineas, dato.exit_code);
        cierre = `\n${causa}\nTerminó con error a las ${dato.fin}.`;
        mostrarCaja(true);
      } else {
        cierre = `\nTerminó ${dato.fin}.`;
        mostrarCaja(false);
      }
    } else {
      mostrarCaja(false);
    }
    $("registro-titulo").textContent = dato.modo === "carga"
      ? "Carga de radicados"
      : (dato.origen && dato.origen !== "manual" ? "Revisión automática" : "Registro");
    $("registro").textContent = `${lineas.join("\n")}${cierre}`;
  }
  if (!dato.corriendo) {
    const id = estado.idAbierto;
    cargar().then(() => {
      if (!id) return;
      const sigue = estado.procesos.some((proceso) => Number(proceso.id_proceso) === Number(id));
      if (sigue) abrirId(id);
      else if (Number(estado.idAbierto) === Number(id)) {
        estado.idAbierto = null;
        estado.detalle = null;
        vacioInicial();
      }
    });
  }
}

function textoConteo(informe) {
  const total = Number(informe?.total) || 0;
  const exitosos = Number(informe?.exitosos) || 0;
  const fallidos = Number(informe?.fallidos) || 0;
  const expedientes = total === 1 ? "1 expediente" : `${total} expedientes`;
  const bien = exitosos === 1 ? "1 se actualizó" : `${exitosos} se actualizaron`;
  const mal = fallidos === 1 ? "1 falló" : `${fallidos} fallaron`;
  return `${expedientes}. ${bien}. ${mal}.`;
}

function pintarVerInforme() {
  $("ver-informe").hidden = !estado.informe;
}

function mostrarInforme(informe) {
  if (!informe) return;
  estado.informe = informe;
  pintarVerInforme();
  $("informe-cuando").textContent = informe.creadoEn ? `Revisión del ${informe.creadoEn}.` : "";
  $("informe-resumen").textContent = textoConteo(informe);
  const caja = $("informe-fallas");
  caja.replaceChildren();
  const fallas = informe.fallas || [];
  if (!fallas.length) {
    caja.append(nodo("p", "nota", "Todos los expedientes se actualizaron."));
  } else {
    for (const falla of fallas) {
      const tarjeta = nodo("article", "falla");
      tarjeta.append(nodo("p", "mono", falla.radicado || ""));
      if (falla.despacho) tarjeta.append(nodo("p", "despacho", falla.despacho));
      tarjeta.append(nodo("p", "falla-causa", falla.causa || "La petición falló."));
      const reintentar = nodo("button", "boton-linea", "Reintentar");
      reintentar.type = "button";
      reintentar.addEventListener("click", () => reintentarFalla(falla));
      tarjeta.append(reintentar);
      caja.append(tarjeta);
    }
  }
  mostrarDialogo("dialogo-informe");
  $("informe-cerrar").focus();
}

async function actualizarEste(proceso) {
  if (!proceso?.id_proceso) return;
  const respuesta = await window.vigencia.actualizarUno(proceso.id_proceso);
  if (!respuesta.ok) ayuda(respuesta.error || "No pude actualizar este expediente.", true);
}

async function reintentarFalla(falla) {
  const mismoDespacho = (proceso) => proceso.radicado === falla.radicado
    && (texto(proceso.despacho) || "") === (texto(falla.despacho) || "");
  const hallado = estado.procesos.find((proceso) => proceso.id_proceso && mismoDespacho(proceso))
    || estado.procesos.find((proceso) => proceso.id_proceso && proceso.radicado === falla.radicado);
  if (!hallado) {
    ayuda("Ese expediente ya no está en la lista.", true);
    return;
  }
  ocultarDialogo("dialogo-informe");
  await abrirId(hallado.id_proceso);
  await actualizarEste(hallado);
}

function aplicarUno(dato) {
  if (dato.corriendo) return;
  const falla = (dato.informe?.fallas || [])[0];
  if (falla) ayuda(`${falla.radicado}: ${falla.causa}`, true);
  else if (dato.exit_code) ayuda("No se pudo actualizar este expediente.", true);
  else if (!dato.informe || !dato.informe.total) ayuda("Ese expediente ya no está en la lista.", true);
  else ayuda("Se actualizaron las actuaciones de este expediente.");
  const id = estado.idAbierto;
  cargar().then(() => {
    if (!id) return;
    const sigue = estado.procesos.some((proceso) => Number(proceso.id_proceso) === Number(id));
    if (sigue) abrirId(id);
    else if (Number(estado.idAbierto) === Number(id)) {
      estado.idAbierto = null;
      estado.detalle = null;
      vacioInicial();
    }
  });
}

function aplicarCorrida(dato) {
  tomarMarcas(dato);
  if (dato.modo === "agregar") aplicarAgregar(dato);
  else if (dato.modo === "uno") aplicarUno(dato);
  else if (dato.modo === "todo" || dato.modo === "carga") aplicarRevision(dato);
  if (dato.modo === "todo" && !dato.corriendo && dato.informe) {
    const informe = { ...dato.informe, creadoEn: dato.fin || estado.informe?.creadoEn || "" };
    if (dato.origen && dato.origen !== "manual") {
      estado.informe = informe;
      pintarVerInforme();
    } else {
      mostrarInforme(informe);
    }
  }
  pintarOcupados();
}

function prepararDialogo(numero) {
  $("dialogo-titulo").textContent = "Buscando el radicado en la Rama";
  $("dialogo-numero").textContent = numero;
  $("dialogo-causa").hidden = true;
  $("dialogo-causa").textContent = "";
  $("dialogo-barra").hidden = false;
  $("dialogo-log").classList.remove("registro-error");
  $("dialogo-log").textContent = "Esperando la respuesta de la Rama…";
  $("dialogo-cerrar").hidden = true;
  if (!estado.revisando && !estado.cargando) {
    $("registro-titulo").textContent = "Registro de la búsqueda";
    $("registro").classList.remove("registro-error");
    $("registro").textContent = "Esperando la respuesta de la Rama…";
    mostrarCaja(false);
  }
  mostrarDialogo("dialogo-busqueda");
}

function mostrarFallo(numero, codigo, lineas, fin) {
  const causa = causaDelFallo(lineas, codigo);
  $("dialogo-titulo").textContent = "La búsqueda falló";
  $("dialogo-causa").hidden = false;
  $("dialogo-causa").textContent = causa;
  $("dialogo-barra").hidden = true;
  $("dialogo-log").classList.add("registro-error");
  $("dialogo-log").textContent = lineas.length ? lineas.join("\n") : "El proceso no escribió nada.";
  $("dialogo-cerrar").hidden = false;
  if (estado.revisando || estado.cargando) {
    ayuda(causa, true);
    return;
  }
  $("registro-titulo").textContent = "Registro de la búsqueda";
  mostrarCaja(true);
  const cierre = fin ? `\nTerminó con error a las ${fin}.` : "";
  $("registro").textContent = `${causa}\n\n${lineas.join("\n")}${cierre}`;
  pintarMensaje(`La búsqueda de ${numero} falló`, `${causa}\n\nEl registro completo está arriba. La ventana de la búsqueda sigue abierta hasta que la cierres.`);
  ayuda(causa, true);
}

async function mostrarAgregado(numero) {
  $("nuevo").value = "";
  ayuda("Número de radicación, 23 dígitos.");
  estado.consulta = numero;
  $("busqueda").value = numero;
  estado.tipo = "todos";
  estado.despacho = "todos";
  estado.cliente = "todos";
  llenarFiltros();
  pintarLista();
  const lista = listaVisible();
  const encontrado = lista.find((proceso) => proceso.radicado === numero && proceso.id_proceso)
    || estado.procesos.find((proceso) => proceso.radicado === numero && proceso.id_proceso);
  if (encontrado) {
    await abrirId(encontrado.id_proceso);
    return;
  }
  const vacio = estado.procesos.find((proceso) => proceso.sin_expediente && proceso.radicado === numero);
  if (vacio) {
    abrirVacio(numero);
    return;
  }
  pintarMensaje(`La Rama no devolvió procesos para ${numero}.`);
}

function abrirFormulario(cliente, asignar) {
  estado.formAsignar = asignar;
  estado.editando = cliente?.id || null;
  $("form-titulo").textContent = cliente ? "Editar abogado" : "Nuevo abogado";
  $("cli-nombre").value = cliente?.nombre || "";
  $("cli-apellidos").value = cliente?.apellidos || "";
  $("cli-cedula").value = cliente?.cedula || "";
  $("cli-tarjeta").value = cliente?.tarjeta || "";
  $("cli-telefonos").value = cliente?.telefonos || "";
  $("cli-direccion").value = cliente?.direccion || "";
  $("cli-email").value = cliente?.email || "";
  $("cli-error").hidden = true;
  mostrarDialogo("dialogo-cliente");
  requestAnimationFrame(() => $("cli-nombre").focus());
}

function cerrarFormulario() {
  ocultarDialogo("dialogo-cliente");
  const cima = dialogoAlFrente();
  if (cima === "dialogo-asignar") $("asig-busca").focus();
  else if (cima === "dialogo-directorio") $("dir-nuevo").focus();
}

async function guardarFormulario(evento) {
  evento.preventDefault();
  const respuesta = await window.vigencia.guardarCliente({
    id: estado.editando,
    nombre: $("cli-nombre").value,
    apellidos: $("cli-apellidos").value,
    cedula: $("cli-cedula").value,
    tarjeta: $("cli-tarjeta").value,
    telefonos: $("cli-telefonos").value,
    direccion: $("cli-direccion").value,
    email: $("cli-email").value,
  });
  if (!respuesta.ok) {
    $("cli-error").hidden = false;
    $("cli-error").textContent = respuesta.error;
    return;
  }
  if (estado.formAsignar && estado.idAbierto) {
    const asignado = await window.vigencia.asignarCliente(estado.idAbierto, respuesta.id);
    if (!asignado.ok) {
      $("cli-error").hidden = false;
      $("cli-error").textContent = asignado.error;
      return;
    }
  }
  ocultarDialogo("dialogo-cliente");
  ocultarDialogo("dialogo-asignar");
  await cargar();
  if (estado.idAbierto) await abrirId(estado.idAbierto);
  if (!$("dialogo-directorio").hidden) pintarDirectorio();
}

function pintarDirectorio() {
  const caja = $("directorio");
  caja.replaceChildren();
  if (!estado.clientes.length) {
    caja.append(nodo("p", "nota", "Todavía no hay abogados."));
    return;
  }
  for (const cliente of estado.clientes) {
    const fila = nodo("article", "persona");
    const info = nodo("div");
    info.append(nodo("h3", "", nombreCliente(cliente)));
    const extra = [
      texto(cliente.cedula) ? `C.C. ${texto(cliente.cedula)}` : "",
      texto(cliente.tarjeta) ? `T.P. ${texto(cliente.tarjeta)}` : "",
      texto(cliente.telefonos),
      texto(cliente.email),
      texto(cliente.direccion),
    ].filter(Boolean).join(" · ");
    if (extra) info.append(nodo("p", "", extra));
    const acciones = nodo("div", "hermanos");
    const editar = nodo("button", "boton-linea", "Editar");
    editar.type = "button";
    editar.addEventListener("click", () => abrirFormulario(cliente, false));
    const borrar = nodo("button", "boton-texto", "Borrar");
    borrar.type = "button";
    borrar.addEventListener("click", () => {
      estado.borrarId = cliente.id;
      $("borrar-texto").textContent = `¿Borrar a ${nombreCliente(cliente)}? Los expedientes quedan sin ese abogado. El expediente no se borra.`;
      mostrarDialogo("dialogo-borrar");
      $("borrar-cancelar").focus();
    });
    acciones.append(editar, borrar);
    fila.append(info, acciones);
    caja.append(fila);
  }
}

function abrirAsignar() {
  $("asig-busca").value = "";
  pintarAsignar();
  mostrarDialogo("dialogo-asignar");
  $("asig-busca").focus();
}

function pintarAsignar() {
  const q = $("asig-busca").value.trim().toLowerCase();
  const caja = $("asig-lista");
  caja.replaceChildren();
  const lista = estado.clientes.filter((cliente) => nombreCliente(cliente).toLowerCase().includes(q));
  if (!lista.length) {
    caja.append(nodo("p", "nota", "No hay abogados con ese nombre."));
    return;
  }
  for (const cliente of lista) {
    const boton = nodo("button", "combo-opcion", etiquetaCliente(cliente, estado.clientes));
    boton.type = "button";
    boton.addEventListener("click", () => asignarA(cliente.id));
    caja.append(boton);
  }
}

async function asignarA(clienteId) {
  if (!estado.idAbierto) return;
  const respuesta = await window.vigencia.asignarCliente(estado.idAbierto, clienteId);
  if (!respuesta.ok) {
    ayuda(respuesta.error, true);
    return;
  }
  ocultarDialogo("dialogo-asignar");
  await cargar();
  await abrirId(estado.idAbierto);
}

function mover(delta) {
  const lista = listaVisible();
  if (!lista.length) return;
  let indice = lista.findIndex(esActual);
  if (indice >= 0) indice = Math.max(0, Math.min(lista.length - 1, indice + delta));
  else indice = delta < 0 ? lista.length - 1 : 0;
  const proceso = lista[indice];
  if (proceso.sin_expediente) abrirVacio(proceso.radicado);
  else abrirId(proceso.id_proceso);
}

function escribiendo(evento) {
  const tag = evento.target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || evento.target?.isContentEditable;
}

document.addEventListener("keydown", (evento) => {
  const cima = dialogoAlFrente();
  if (evento.key === "Tab" && cima) {
    const campos = focosDe(cima);
    if (!campos.length) return;
    const primero = campos[0];
    const ultimo = campos.at(-1);
    const adentro = $(cima).contains(document.activeElement);
    if (evento.shiftKey && (!adentro || document.activeElement === primero)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && (!adentro || document.activeElement === ultimo)) {
      evento.preventDefault();
      primero.focus();
    }
    return;
  }
  if (evento.key === "Escape") {
    if (cima === "dialogo-cliente") cerrarFormulario();
    else if (cima === "dialogo-ajustes" || cima === "dialogo-csv" || cima === "dialogo-borrar" || cima === "dialogo-eliminar" || cima === "dialogo-escrito" || cima === "dialogo-modelos" || cima === "dialogo-iniciar" || cima === "dialogo-informe" || cima === "dialogo-asignar" || cima === "dialogo-directorio" || cima === "dialogo-biblioteca" || cima === "dialogo-pieza" || cima === "dialogo-actualizar" || cima === "dialogo-sistemas" || cima === "dialogo-pp-doc" || cima === "dialogo-gasto" || CAPAS_DOCUMENTOS.includes(cima)) ocultarDialogo(cima);
    else if (cima === "dialogo-busqueda" && !$("dialogo-cerrar").hidden) ocultarDialogo(cima);
    return;
  }
  if (cima || escribiendo(evento) || estado.sistema !== SISTEMA_INICIAL) return;
  if (evento.key === "/") {
    evento.preventDefault();
    document.querySelector("#busqueda")?.focus();
  } else if (evento.key === "ArrowDown") {
    evento.preventDefault();
    mover(1);
  } else if (evento.key === "ArrowUp") {
    evento.preventDefault();
    mover(-1);
  }
});

let relojBusqueda = 0;
$("busqueda").addEventListener("input", () => {
  window.clearTimeout(relojBusqueda);
  relojBusqueda = window.setTimeout(() => {
    estado.consulta = $("busqueda").value;
    pintarLista();
  }, 150);
});

$("nuevo").addEventListener("input", () => {
  const digitos = normalizarRadicado($("nuevo").value);
  if ($("nuevo").value !== digitos) $("nuevo").value = digitos;
  if (!digitos) ayuda("Número de radicación, 23 dígitos.");
  else if (digitos.length < 23) ayuda(`${digitos.length} de 23 dígitos.`);
  else ayuda("Listo para buscar en la Rama.");
});
$("nuevo").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") $("agregar").click();
});

function pintarColumnaCsv() {
  const seleccion = (estado.columnasCsv || []).find((item) => String(item.indice) === $("csv-columna").value);
  const cantidad = seleccion?.cantidad || 0;
  $("csv-cuenta").textContent = cantidad
    ? `${cantidad} radicado${cantidad === 1 ? "" : "s"} de 23 dígitos.`
    : "Esa columna no tiene radicados de 23 dígitos.";
  $("csv-cargar").disabled = !cantidad;
}

function abrirCsv(respuesta) {
  estado.columnasCsv = respuesta.columnas || [];
  $("csv-archivo").textContent = respuesta.nombre || "";
  $("csv-error").hidden = true;
  const select = $("csv-columna");
  select.replaceChildren();
  const orden = [...estado.columnasCsv].sort((a, b) => b.cantidad - a.cantidad || a.indice - b.indice);
  for (const columna of orden) {
    const opcion = document.createElement("option");
    opcion.value = String(columna.indice);
    opcion.textContent = `${columna.nombre} (${columna.cantidad})`;
    select.append(opcion);
  }
  pintarColumnaCsv();
  mostrarDialogo("dialogo-csv");
  select.focus();
}

$("cargar-csv").addEventListener("click", async () => {
  const respuesta = await window.vigencia.elegirCsv();
  if (!respuesta?.ok) {
    if (!respuesta?.cancelado) ayuda(respuesta?.error || "No pude abrir el archivo.", true);
    return;
  }
  abrirCsv(respuesta);
});
$("csv-columna").addEventListener("change", pintarColumnaCsv);
$("csv-cancelar").addEventListener("click", () => ocultarDialogo("dialogo-csv"));
$("csv-cargar").addEventListener("click", async () => {
  $("csv-error").hidden = true;
  const respuesta = await window.vigencia.cargarCsv(Number($("csv-columna").value));
  if (!respuesta.ok) {
    $("csv-error").hidden = false;
    $("csv-error").textContent = respuesta.error;
    return;
  }
  ocultarDialogo("dialogo-csv");
  estado.cargando = true;
  $("registro").classList.remove("registro-error");
  $("registro-titulo").textContent = "Carga de radicados";
  $("registro").textContent = `Cargando ${respuesta.total} radicado${respuesta.total === 1 ? "" : "s"}…`;
  mostrarCaja(false);
  pintarOcupados();
});

$("agregar").addEventListener("click", async () => {
  const numero = normalizarRadicado($("nuevo").value);
  if (numero.length !== 23) {
    ayuda("El radicado debe tener 23 dígitos.", true);
    return;
  }
  ayuda("Buscando en la Rama…");
  const respuesta = await window.vigencia.agregar(numero);
  if (!respuesta.ok) {
    ayuda(respuesta.error, true);
    return;
  }
  estado.agregando = true;
  pintarOcupados();
  prepararDialogo(numero);
});

$("actualizar").addEventListener("click", async () => {
  const respuesta = await window.vigencia.actualizar();
  if (!respuesta.ok) {
    if (respuesta.hasta) estado.pausaHasta = respuesta.hasta;
    pintarActualizar();
    ayuda(respuesta.error, true);
    if (respuesta.error === "Ya hay una consulta en curso.") mostrarCaja(false);
    return;
  }
  estado.pausaHasta = respuesta.hasta;
  estado.revisando = true;
  $("registro").classList.remove("registro-error");
  $("registro").textContent = "Revisando actuaciones…";
  $("registro-titulo").textContent = "Registro";
  mostrarCaja(false);
  pintarOcupados();
});

$("recargar").addEventListener("click", async () => {
  $("recargar").disabled = true;
  await cargar();
  if (estado.idAbierto) await abrirId(estado.idAbierto);
  else if (estado.radicadoVacio) abrirVacio(estado.radicadoVacio);
  $("recargar").disabled = false;
});

$("salir").addEventListener("click", () => window.vigencia.salir());
$("ocultar-registro").addEventListener("click", () => {
  $("caja-registro").hidden = true;
});
$("dialogo-cerrar").addEventListener("click", () => {
  ocultarDialogo("dialogo-busqueda");
});
$("informe").addEventListener("click", async () => {
  $("informe").disabled = true;
  const textoBoton = $("informe").textContent;
  $("informe").textContent = "Armando…";
  const respuesta = await window.vigencia.informeDiario();
  $("informe").disabled = false;
  $("informe").textContent = textoBoton;
  if (!respuesta.ok) {
    if (!respuesta.cancelado) ayuda(respuesta.error || "No pude armar los informes.", true);
    return;
  }
  const n = Number(respuesta.cantidad) || 0;
  ayuda(n === 1 ? "Se guardó 1 informe en PDF." : `Se guardaron ${n} informes en PDF, uno por abogado.`);
});

$("abrir-clientes").addEventListener("click", () => {
  pintarDirectorio();
  mostrarDialogo("dialogo-directorio");
  enfocarDialogo("dialogo-directorio");
});
$("dir-cerrar").addEventListener("click", () => {
  ocultarDialogo("dialogo-directorio");
});
$("dir-nuevo").addEventListener("click", () => abrirFormulario(null, false));
$("form-cancelar").addEventListener("click", cerrarFormulario);
$("form-cliente").addEventListener("submit", guardarFormulario);
$("asig-cancelar").addEventListener("click", () => {
  ocultarDialogo("dialogo-asignar");
});
$("asig-nuevo").addEventListener("click", () => abrirFormulario(null, true));
$("asig-busca").addEventListener("input", pintarAsignar);
$("borrar-cancelar").addEventListener("click", () => {
  ocultarDialogo("dialogo-borrar");
  if (dialogoAlFrente()) enfocarDialogo(dialogoAlFrente());
});
function pedirEliminar(proceso) {
  estado.eliminarId = proceso.id_proceso;
  const despacho = texto(proceso.despacho);
  const otros = estado.procesos.filter((otro) => otro.radicado === proceso.radicado && Number(otro.id_proceso) !== Number(proceso.id_proceso));
  let mensaje = `¿Eliminar el expediente ${proceso.radicado || ""}${despacho ? `, ${despacho}` : ""}? Se borra de este computador, con sus actuaciones. La Rama no se modifica.`;
  if (otros.length === 1) mensaje += " El otro expediente de este radicado se queda.";
  else if (otros.length > 1) mensaje += ` Los otros ${otros.length} expedientes de este radicado se quedan.`;
  $("eliminar-texto").textContent = mensaje;
  mostrarDialogo("dialogo-eliminar");
  $("eliminar-cancelar").focus();
}

$("descargar").addEventListener("click", async () => {
  const ids = listaVisible().map((proceso) => proceso.id_proceso).filter(Boolean);
  if (!ids.length) {
    ayuda("No hay expedientes con esos filtros.", true);
    return;
  }
  const respuesta = await window.vigencia.exportarExcel(ids);
  if (!respuesta.ok) {
    if (!respuesta.cancelado) ayuda(respuesta.error || "No pude guardar el Excel.", true);
    return;
  }
  const n = Number(respuesta.actuaciones) || 0;
  ayuda(n === 1 ? "Excel guardado. Hay 1 actuación de hoy." : `Excel guardado. Hay ${n} actuaciones de hoy.`);
});

$("escrito-cancelar").addEventListener("click", () => ocultarDialogo("dialogo-escrito"));
$("escrito-modelo").addEventListener("change", async () => {
  olvidarDudas("escrito");
  pintarNotaModelo();
  const respuesta = await window.vigencia.modelosUsar($("escrito-modelo").value);
  if (!respuesta?.ok) {
    $("escrito-error").hidden = false;
    $("escrito-error").textContent = respuesta?.error || "No pude cambiar el modelo.";
  }
});
$("escrito-config").addEventListener("click", abrirConfigModelos);
$("abrir-modelos").addEventListener("click", abrirConfigModelos);
$("config-importar").addEventListener("click", async () => {
  const respuesta = await window.vigencia.modelosImportar();
  if (!respuesta?.ok) {
    if (!respuesta?.cancelado) {
      $("modelos-error").hidden = false;
      $("modelos-error").textContent = respuesta?.error || "No pude importar el modelo.";
    }
    return;
  }
  await pintarModelos();
  await cargarModelosEscrito();
});
async function abrirConfigModelos() {
  pintarOcr();
  await pintarModelos();
  await pintarGastoCorto();
  mostrarDialogo("dialogo-modelos");
  $("modelos-cerrar").focus();
}

function dolares(valor) {
  const n = Number(valor) || 0;
  if (n > 0 && n < 0.01) return "< 0.01 USD";
  return `${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} USD`;
}

function pintarGastoResumen(bloque, caja) {
  caja.replaceChildren();
  const t = bloque?.totales || {};
  const linea = nodo("p", "ayuda", `${Number(t.llamadas) || 0} llamadas · ${Number(t.entrada || 0).toLocaleString("es-CO")} de entrada + ${Number(t.salida || 0).toLocaleString("es-CO")} de salida · ${dolares(t.costo)}`);
  caja.append(linea);
  for (const fila of bloque?.porProveedor || []) {
    const p = nodo("p", "ayuda", `${fila.proveedor || "?"} · ${fila.modelo || "?"}: ${fila.llamadas} · ${dolares(fila.costo)}`);
    caja.append(p);
  }
  for (const fila of (bloque?.recientes || []).slice(0, 20)) {
    const p = nodo("p", "ayuda", `${String(fila.fecha || "").slice(0, 16).replace("T", " ")} · ${fila.proveedor || "?"} · ${fila.modelo || "?"} · ${fila.motivo || ""} · ${dolares(fila.costo)}`);
    caja.append(p);
  }
}

async function pintarGastoCorto() {
  try {
    const r = await window.vigencia.gastoResumen();
    if (!r?.ok) return;
    const t = r.mes?.totales || {};
    $("gasto-resumen-corto").textContent = (Number(t.llamadas) || 0)
      ? `Este mes: ${t.llamadas} llamadas · ${dolares(t.costo)}.`
      : "Sin llamadas a la nube todavía.";
  } catch {
    /* la ventana ya no escucha */
  }
}

async function abrirGasto(mes) {
  try {
    const r = await window.vigencia.gastoResumen();
    if (!r?.ok) return;
    pintarGastoResumen(mes ? r.mes : r.todo, $("gasto-tablas"));
    mostrarDialogo("dialogo-gasto");
  } catch {
    /* la ventana ya no escucha */
  }
}
$("gasto-ver").addEventListener("click", () => abrirGasto(true));
$("gasto-mes").addEventListener("click", () => abrirGasto(true));
$("gasto-todo").addEventListener("click", () => abrirGasto(false));
$("gasto-cerrar").addEventListener("click", () => ocultarDialogo("dialogo-gasto"));

function tarjetaModelo(item) {
  const tarjeta = nodo("article", "persona");
  const info = nodo("div");
  info.append(nodo("h3", "", item.nombre));
  info.append(nodo("p", "", item.detalle || ""));
  const estadoLinea = nodo("p", "modelo-estado", "");
  estadoLinea.hidden = true;
  info.append(estadoLinea);
  tarjeta.append(info);
  const acciones = nodo("div", "hermanos");
  const boton = nodo("button", item.instalado ? "boton-linea" : "boton-cobre", item.instalado ? "Instalado ✓" : "Descargar");
  boton.type = "button";
  boton.disabled = item.instalado;
  if (!item.instalado) {
    boton.addEventListener("click", () => descargarRecomendado(item, boton, estadoLinea));
  }
  acciones.append(boton);
  tarjeta.append(acciones);
  return tarjeta;
}

function pintarMotor(estado) {
  const linea = $("motor-estado");
  const boton = $("motor-instalar");
  if (!estado?.plataforma) {
    linea.textContent = "Este computador no tiene un motor preparado. Use el modelo Sencillo.";
    boton.hidden = true;
    return;
  }
  boton.hidden = false;
  if (estado.listo) {
    linea.textContent = "Motor listo en este computador.";
    boton.textContent = "Volver a instalar";
    boton.className = "boton-linea";
  } else {
    linea.textContent = "El motor no está instalado. Los modelos GGUF lo necesitan.";
    boton.textContent = "Instalar motor";
    boton.className = "boton-cobre";
  }
}

async function pintarModelos() {
  const caja = $("modelos-lista");
  caja.replaceChildren();
  $("nubes-lista").replaceChildren();
  $("modelos-error").hidden = true;
  const motor = await window.vigencia.motorEstado();
  if (motor?.ok) pintarMotor(motor);
  else $("motor-estado").textContent = motor?.error || "No pude revisar el motor.";
  const respuesta = await window.vigencia.modelosRecomendados();
  if (!respuesta?.ok) {
    $("modelos-error").hidden = false;
    $("modelos-error").textContent = respuesta?.error || "No pude leer el catálogo.";
    return;
  }
  for (const item of respuesta.modelos || []) caja.append(tarjetaModelo(item));
  const nubes = await window.vigencia.modelosNube();
  if (nubes?.ok) {
    for (const nube of nubes.nubes || []) $("nubes-lista").append(tarjetaNube(nube));
  }
}

function tarjetaNube(nube) {
  const tarjeta = nodo("article", "persona");
  const info = nodo("div", "nube-info");
  info.append(nodo("h3", "", nube.nombre));
  const form = nodo("div", "nube-form");
  const campoModelo = nodo("input");
  campoModelo.placeholder = "Nombre del modelo";
  campoModelo.value = nube.modelo || "";
  campoModelo.setAttribute("aria-label", `Modelo de ${nube.nombre}`);
  campoModelo.autocomplete = "off";
  if ((nube.modelos || []).length) {
    const listaId = `modelos-${nube.id}`;
    campoModelo.setAttribute("list", listaId);
    const lista = document.createElement("datalist");
    lista.id = listaId;
    for (const sugerido of nube.modelos) {
      const opcion = document.createElement("option");
      opcion.value = sugerido;
      lista.append(opcion);
    }
    form.append(campoModelo, lista);
  } else {
    form.append(campoModelo);
  }
  if (nube.editableBase) {
    const campoBase = nodo("input");
    campoBase.placeholder = "Dirección base (https://…)";
    campoBase.value = nube.base || "";
    campoBase.setAttribute("aria-label", "Dirección base del proveedor");
    campoBase.autocomplete = "off";
    form.append(campoBase);
  }
  const campoClave = nodo("input");
  campoClave.type = "password";
  campoClave.placeholder = nube.tieneClave ? "Clave guardada (escríbala para cambiarla)" : "Pegue su clave";
  campoClave.setAttribute("aria-label", `Clave de ${nube.nombre}`);
  campoClave.autocomplete = "off";
  form.append(campoClave);
  const verClave = nodo("button", "boton-texto", "Mostrar");
  verClave.type = "button";
  verClave.title = "Muestra la clave escrita para revisarla";
  verClave.addEventListener("click", () => {
    const visible = campoClave.type === "text";
    campoClave.type = visible ? "password" : "text";
    verClave.textContent = visible ? "Mostrar" : "Ocultar";
  });
  form.append(verClave);
  info.append(form);
  const pistaClave = nodo("p", "ayuda", nube.claveAyuda ? `La clave ${nube.claveAyuda}` : "");
  pistaClave.hidden = !nube.claveAyuda;
  info.append(pistaClave);
  const revisarForma = () => {
    const valor = campoClave.value.trim();
    if (!valor || !(nube.clavePrefijos || []).length) {
      pistaClave.hidden = !nube.claveAyuda;
      pistaClave.textContent = nube.claveAyuda ? `La clave ${nube.claveAyuda}` : "";
      return;
    }
    const bien = nube.clavePrefijos.some((p) => valor.startsWith(p));
    pistaClave.hidden = false;
    pistaClave.textContent = bien ? "Formato válido. Pulse Probar para confirmar con el proveedor." : `Esa forma no coincide: la clave ${nube.claveAyuda}`;
  };
  campoClave.addEventListener("input", revisarForma);
  const estadoLinea = nodo("p", "modelo-estado", nube.tieneClave ? `Clave guardada en este computador${nube.huellaClave ? ` (${nube.huellaClave})` : ""}.` : "");
  estadoLinea.hidden = !nube.tieneClave;
  info.append(estadoLinea);
  const pintarEstado = (clase, texto) => {
    estadoLinea.hidden = false;
    estadoLinea.classList.remove("ok", "mal");
    if (clase) estadoLinea.classList.add(clase);
    estadoLinea.textContent = texto;
  };
  tarjeta.append(info);
  const acciones = nodo("div", "hermanos");
  const probar = nodo("button", "boton-linea", "Probar");
  probar.type = "button";
  probar.title = "Prueba la conexión con lo escrito, sin guardar";
  const guardar = nodo("button", "boton-cobre", "Guardar");
  guardar.type = "button";
  guardar.disabled = true;
  guardar.title = "Se habilita cuando la prueba funciona";
  const marcaProbada = (valor) => {
    probar.dataset.probado = valor;
  };
  const invalidaPrueba = () => {
    marcaProbada("");
    guardar.disabled = true;
    guardar.textContent = "Guardar";
  };
  for (const campo of form.querySelectorAll("input")) {
    campo.addEventListener("input", invalidaPrueba);
  }
  probar.addEventListener("click", async () => {
    probar.disabled = true;
    probar.textContent = "Probando…";
    $("modelos-error").hidden = true;
    pintarEstado("", "Probando la conexión…");
    const base = nube.editableBase ? form.children[1].value : undefined;
    const respuesta = await window.vigencia.modelosProbar({
      proveedor: nube.id,
      key: campoClave.value,
      modelo: campoModelo.value,
      base,
    });
    probar.disabled = false;
    probar.textContent = "Probar";
    if (!respuesta?.ok) {
      invalidaPrueba();
      pintarEstado("mal", `No sirve: ${respuesta?.error || "no pude probar la conexión."}`);
      return;
    }
    marcaProbada(JSON.stringify([campoClave.value, campoModelo.value, base || ""]));
    guardar.disabled = false;
    pintarEstado("ok", `Funciona (“${respuesta.muestra || "ok"}”). Ya puede guardar.`);
  });
  guardar.addEventListener("click", async () => {
    if (guardar.disabled) return;
    const base = nube.editableBase ? form.children[1].value : undefined;
    if (probar.dataset.probado !== JSON.stringify([campoClave.value, campoModelo.value, base || ""])) {
      invalidaPrueba();
      $("modelos-error").hidden = false;
      $("modelos-error").textContent = "Pruebe la conexión primero: cambió algo después de la prueba.";
      return;
    }
    guardar.disabled = true;
    const respuesta = await window.vigencia.modelosGuardarNube({
      proveedor: nube.id,
      key: campoClave.value,
      modelo: campoModelo.value,
      base,
    });
    guardar.disabled = false;
    if (!respuesta?.ok) {
      $("modelos-error").hidden = false;
      $("modelos-error").textContent = respuesta?.error || "No pude guardar la clave.";
      return;
    }
    $("modelos-error").hidden = true;
    campoClave.value = "";
    campoClave.placeholder = "Clave guardada (escríbala para cambiarla)";
    estadoLinea.hidden = false;
    estadoLinea.textContent = "Clave guardada en este computador.";
    await cargarModelosEscrito();
  });
  acciones.append(probar, guardar);
  tarjeta.append(acciones);
  return tarjeta;
}

function porcentajeDescarga(recibidos, total) {
  if (!total) return "Descargando…";
  return `Descargando… ${Math.min(100, Math.round((recibidos / total) * 100))}%`;
}

async function descargarRecomendado(item, boton, estadoLinea) {
  boton.disabled = true;
  boton.textContent = "Descargando…";
  estadoLinea.hidden = false;
  estadoLinea.textContent = "Descargando…";
  const dejarDeEscuchar = window.vigencia.alModelo((avance) => {
    if (avance?.id !== item.id) return;
    estadoLinea.textContent = porcentajeDescarga(avance.recibidos, avance.total);
  });
  let respuesta = null;
  try {
    respuesta = await window.vigencia.modelosDescargar(item.id);
  } finally {
    dejarDeEscuchar();
  }
  if (!respuesta?.ok) {
    boton.disabled = false;
    boton.textContent = "Descargar";
    $("modelos-error").hidden = false;
    $("modelos-error").textContent = respuesta?.error || "No pude descargar el modelo.";
    return;
  }
  boton.textContent = "Instalado ✓";
  estadoLinea.textContent = "Listo. Ya puede cerrar y elegirlo en Modelo.";
  await cargarModelosEscrito();
}

$("motor-instalar").addEventListener("click", async () => {
  const boton = $("motor-instalar");
  const linea = $("motor-estado");
  boton.disabled = true;
  linea.textContent = "Descargando el motor…";
  $("modelos-error").hidden = true;
  const dejarDeEscuchar = window.vigencia.alMotor((avance) => {
    if (avance?.fase === "extraer") linea.textContent = "Instalando el motor…";
    else linea.textContent = porcentajeDescarga(avance?.recibidos, avance?.total);
  });
  let respuesta = null;
  try {
    respuesta = await window.vigencia.motorInstalar();
  } finally {
    dejarDeEscuchar();
    boton.disabled = false;
  }
  if (!respuesta?.ok) {
    $("modelos-error").hidden = false;
    $("modelos-error").textContent = respuesta?.error || "No pude instalar el motor.";
    linea.textContent = "No se pudo instalar el motor.";
    return;
  }
  pintarMotor(respuesta);
});
$("motor-diagnosticar").addEventListener("click", async () => {
  const boton = $("motor-diagnosticar");
  const caja = $("motor-detalle");
  const copiar = $("motor-copiar");
  boton.disabled = true;
  copiar.hidden = true;
  $("modelos-error").hidden = true;
  caja.textContent = "Revisando paso a paso…";
  caja.hidden = false;
  let respuesta = null;
  try {
    respuesta = await window.vigencia.motorDiagnostico();
  } catch {
    respuesta = { ok: false };
  } finally {
    boton.disabled = false;
  }
  if (!respuesta?.ok) {
    $("modelos-error").hidden = false;
    $("modelos-error").textContent = respuesta?.error || "No pude correr el diagnóstico.";
    caja.hidden = true;
    return;
  }
  const lineas = [`App: ${respuesta.version || "?" }`, `Plataforma: ${respuesta.plataforma || "desconocida"}`];
  for (const paso of respuesta.pasos || []) lineas.push(`${paso.ok ? "✓" : "✕"} ${paso.nombre}: ${paso.detalle}`);
  caja.textContent = lineas.join("\n");
  copiar.hidden = false;
});
$("motor-copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("motor-detalle").textContent);
    $("motor-copiar").textContent = "Copiado ✓";
    setTimeout(() => {
      $("motor-copiar").textContent = "Copiar detalle";
    }, 2000);
  } catch {
    $("modelos-error").hidden = false;
    $("modelos-error").textContent = "No pude copiar. Seleccione el texto y cópielo a mano.";
  }
});
let actualizacionPendiente = null;
function abrirActualizacion(info) {
  actualizacionPendiente = info;
  $("actualizar-error").hidden = true;
  $("actualizar-progreso").hidden = true;
  const boton = $("actualizar-descargar");
  boton.disabled = false;
  boton.textContent = "Descargar";
  if (!info?.novedad) {
    $("actualizar-texto").textContent = `Tiene la versión ${info?.actual || "instalada"}. No hay nada nuevo.`;
    $("actualizar-descargar").hidden = true;
    $("actualizar-omitir").hidden = true;
  } else {
    $("actualizar-texto").textContent = `Tiene la ${info.actual} y ya salió la ${info.disponible}. Se descarga el instalador y usted lo instala.`;
    $("actualizar-descargar").hidden = false;
    $("actualizar-omitir").hidden = false;
  }
  mostrarDialogo("dialogo-actualizar");
}
$("buscar-actualizacion").addEventListener("click", async () => {
  $("actualizar-texto").textContent = "Revisando…";
  $("actualizar-error").hidden = true;
  $("actualizar-progreso").hidden = true;
  $("actualizar-descargar").hidden = true;
  $("actualizar-omitir").hidden = true;
  mostrarDialogo("dialogo-actualizar");
  let respuesta = null;
  try {
    respuesta = await window.vigencia.actualizacionComprobar();
  } catch {
    respuesta = { ok: false };
  }
  if (!respuesta?.ok) {
    $("actualizar-texto").textContent = "No pude revisar. Verifique la conexión e intente de nuevo.";
    return;
  }
  abrirActualizacion(respuesta);
});
$("actualizar-descargar").addEventListener("click", async () => {
  const info = actualizacionPendiente;
  if (!info?.archivo) return;
  const boton = $("actualizar-descargar");
  boton.disabled = true;
  boton.textContent = "Descargando…";
  $("actualizar-error").hidden = true;
  const progreso = $("actualizar-progreso");
  progreso.hidden = false;
  progreso.textContent = "Descargando…";
  const dejar = window.vigencia.alDescargaApp((avance) => {
    progreso.textContent = avance?.fase === "descarga" && avance?.total
      ? porcentajeDescarga(avance.recibidos, avance.total)
      : "Descargando…";
  });
  let respuesta = null;
  try {
    respuesta = await window.vigencia.actualizacionDescargar(info.archivo);
  } finally {
    dejar();
    boton.disabled = false;
    boton.textContent = "Descargar";
  }
  if (!respuesta?.ok) {
    $("actualizar-error").hidden = false;
    $("actualizar-error").textContent = respuesta?.error || "No pude descargar.";
    return;
  }
  progreso.textContent = respuesta.accion === "carpeta"
    ? "Descargado. Ábralo desde la carpeta que se mostró."
    : respuesta.accion === "montar"
      ? "Descargado. Arrastre Vigencia a Aplicaciones e iníciela desde allí."
      : "Descargado. Siga el instalador; al terminar abra Vigencia de nuevo.";
});
$("actualizar-omitir").addEventListener("click", async () => {
  if (actualizacionPendiente?.disponible) await window.vigencia.actualizacionOmitir(actualizacionPendiente.disponible);
  ocultarDialogo("dialogo-actualizar");
});
$("actualizar-cerrar").addEventListener("click", () => ocultarDialogo("dialogo-actualizar"));
let ppDocActual = null;
let ppDocToken = null;
async function verPpDoc(d) {
  ppDocActual = d;
  ppDocToken = null;
  $("pp-doc-titulo").textContent = d.nombre || "Documento";
  $("pp-doc-info").textContent = "Cargando vista previa…";
  $("pp-doc-marco").removeAttribute("src");
  mostrarDialogo("dialogo-pp-doc");
  let respuesta = null;
  try {
    respuesta = await window.vigencia.ppVista(d.url, d.nombre);
  } catch {
    respuesta = { ok: false };
  }
  if (!respuesta?.ok) {
    $("pp-doc-info").textContent = respuesta?.error || "No pude traer el documento.";
    return;
  }
  const kb = Math.max(1, Math.round((respuesta.tamano || 0) / 1024));
  ppDocToken = respuesta.token;
  $("pp-doc-info").textContent = `${d.nombre || ""}${d.fecha ? ` · ${d.fecha}` : ""} · ${kb} KB en memoria, sin descargar.`;
  $("pp-doc-marco").src = respuesta.url;
}
$("pp-doc-navegador").addEventListener("click", () => {
  if (ppDocActual?.url) window.vigencia.ppAbrir(ppDocActual.url);
});
$("pp-doc-descargar").addEventListener("click", async () => {
  if (!ppDocActual?.url) return;
  const boton = $("pp-doc-descargar");
  boton.disabled = true;
  $("pp-doc-info").textContent = "Descargando…";
  let respuesta = null;
  try {
    respuesta = await window.vigencia.ppDescargarDoc(ppDocActual.url, ppDocActual.nombre, ppDocToken);
  } catch {
    respuesta = { ok: false };
  } finally {
    boton.disabled = false;
  }
  if (!respuesta?.ok) {
    if (!respuesta?.cancelado) $("pp-doc-info").textContent = respuesta?.error || "No pude descargar.";
    return;
  }
  $("pp-doc-info").textContent = `Guardado en ${respuesta.ruta}`;
});
$("pp-doc-cerrar").addEventListener("click", () => {
  $("pp-doc-marco").removeAttribute("src");
  ocultarDialogo("dialogo-pp-doc");
});
window.vigencia.alPpNovedades(() => {
  elegirSistema("micrositio");
  elegirPpTab("cargados");
  pintarPpCargados();
});
window.vigencia.alSpoaNovedades(() => {
  elegirSistema("spoa");
  pintarSpCasos();
});
window.vigencia.alSamaiNovedades(() => {
  elegirSistema("samai");
  pintarSamaiCasos();
});
window.vigencia.alActualizacion((info) => abrirActualizacion(info));
$("modelos-cerrar").addEventListener("click", () => {
  ocultarDialogo("dialogo-modelos");
  refrescarModelosDocumentos();
  if (dialogoAlFrente() === "dialogo-escrito") $("escrito-prompt").focus();
});
$("escrito-prompt").addEventListener("input", () => {
  estado.borrador = null;
  $("escrito-word").disabled = true;
  $("escrito-pdf").disabled = true;
  olvidarDudas("escrito");
});
$("escrito-referencia").addEventListener("input", () => {
  estado.borrador = null;
  $("escrito-word").disabled = true;
  $("escrito-pdf").disabled = true;
  olvidarDudas("escrito");
});
$("escrito-docx").addEventListener("change", () => {
  const archivo = $("escrito-docx").files?.[0];
  if (!archivo) return;
  if (!/\.docx$/i.test(archivo.name) || archivo.size > 1_500_000) {
    $("escrito-error").hidden = false;
    $("escrito-error").textContent = archivo.size > 1_500_000
      ? "El Word es demasiado grande. Use uno de menos de 1,5 MB."
      : "Adjunte un archivo .docx.";
    quitarDocxEscrito();
    return;
  }
  const lector = new FileReader();
  lector.onload = () => {
    const base64 = String(lector.result || "").split(",")[1] || "";
    estado.ejemploDocx = { nombre: archivo.name, base64 };
    $("escrito-docx-nota").textContent = archivo.name;
    $("escrito-docx-quitar").hidden = false;
    $("escrito-error").hidden = true;
    olvidarDudas("escrito");
  };
  lector.readAsDataURL(archivo);
});
$("escrito-docx-quitar").addEventListener("click", () => quitarDocxEscrito());
function olvidarDudas(prefijo) {
  if (prefijo === "escrito") estado.dudasEscrito = null;
  else estado.dudasIniciar = null;
  const caja = $(`${prefijo}-dudas`);
  if (!caja) return;
  caja.hidden = true;
  $(`${prefijo}-dudas-lista`).replaceChildren();
  $(`${prefijo}-aclaracion`).value = "";
  $(`${prefijo}-generar`).textContent = prefijo === "escrito" ? "Redactar" : "Generar documento";
}

function mostrarDudas(prefijo, preguntas) {
  if (prefijo === "escrito") estado.dudasEscrito = preguntas;
  else estado.dudasIniciar = preguntas;
  const lista = $(`${prefijo}-dudas-lista`);
  lista.replaceChildren();
  for (const pregunta of preguntas) lista.append(nodo("li", "", pregunta));
  $(`${prefijo}-dudas`).hidden = false;
  $(`${prefijo}-vivo`).hidden = true;
  $(`${prefijo}-vista`).hidden = true;
  $(`${prefijo}-word`).disabled = true;
  $(`${prefijo}-pdf`).disabled = true;
  $(`${prefijo}-generar`).textContent = "Redactar con esta respuesta";
  $(`${prefijo}-estado`).hidden = false;
  $(`${prefijo}-estado`).textContent = "El modelo necesita estos datos para redactar. Responda una sola vez.";
  $(`${prefijo}-aclaracion`).focus();
}

function aclaracionPendiente(prefijo) {
  const preguntas = prefijo === "escrito" ? estado.dudasEscrito : estado.dudasIniciar;
  if (!preguntas?.length) return null;
  const respuesta = String($(`${prefijo}-aclaracion`).value || "").trim();
  if (!respuesta) return null;
  return { preguntas, respuesta };
}

$("escrito-generar").addEventListener("click", async () => {
  if (!estado.detalle?.id_proceso) return;
  const aclaracion = aclaracionPendiente("escrito");
  if (estado.dudasEscrito && !aclaracion) {
    $("escrito-error").hidden = false;
    $("escrito-error").textContent = "Escriba la respuesta a las preguntas.";
    $("escrito-estado").hidden = true;
    return;
  }
  $("escrito-error").hidden = true;
  $("escrito-estado").hidden = false;
  $("escrito-estado").textContent = aclaracion
    ? "Redactando con su respuesta…"
    : (String($("escrito-modelo").value || "").startsWith("nube:")
      ? "Pidiendo el memorial al proveedor con su clave…"
      : "Redactando en este computador…");
  if (aclaracion) $("escrito-dudas").hidden = true;
  $("escrito-generar").disabled = true;
  $("escrito-word").disabled = true;
  $("escrito-pdf").disabled = true;
  const vivo = $("escrito-vivo");
  vivo.replaceChildren();
  const escribiendo = nodo("p", "vivo-titulo", "Escribiendo…");
  const lineas = nodo("div", "vivo-lineas");
  vivo.append(escribiendo, lineas);
  const porSeccion = new Map();
  const dejarDeEscuchar = window.vigencia.alBorrador((avance) => {
    if ($("dialogo-escrito").hidden) return;
    vivo.hidden = false;
    $("escrito-vista").hidden = true;
    let bloque = porSeccion.get(avance.seccion);
    if (!bloque) {
      bloque = nodo("div", "vivo-bloque");
      bloque.append(nodo("p", "vivo-seccion", avance.seccion));
      bloque.append(nodo("p", "vivo-texto", ""));
      porSeccion.set(avance.seccion, bloque);
      lineas.append(bloque);
    }
    escribiendo.textContent = `Escribiendo ${avance.seccion.toLowerCase()}…`;
    const parrafo = bloque.lastChild;
    parrafo.textContent = avance.texto;
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "▌";
    parrafo.append(caret);
    vivo.scrollTop = vivo.scrollHeight;
  });
  let respuesta = null;
  try {
    respuesta = await window.vigencia.generarBorrador(
      estado.detalle.id_proceso,
      $("escrito-prompt").value,
      $("escrito-modelo").value,
      excluirMarcadas("escrito-contexto"),
      aclaracion,
      {
        referencia: $("escrito-referencia").value,
        presenta: $("escrito-quien-elige").hidden ? "" : $("escrito-presenta").value,
        ejemploDocx: estado.ejemploDocx?.base64 || "",
      },
    );
  } finally {
    dejarDeEscuchar();
  }
  $("escrito-generar").disabled = false;
  if (!respuesta.ok) {
    $("escrito-error").hidden = false;
    $("escrito-error").textContent = respuesta.error;
    $("escrito-estado").hidden = true;
    if (estado.dudasEscrito) $("escrito-dudas").hidden = false;
    return;
  }
  if (respuesta.dudas?.length) {
    mostrarDudas("escrito", respuesta.dudas);
    return;
  }
  olvidarDudas("escrito");
  estado.borrador = {
    asunto: respuesta.asunto,
    secciones: respuesta.secciones,
    origen: respuesta.origen === "nube" ? "nube" : "local",
  };
  $("escrito-estado").textContent = respuesta.respaldo
    ? "El modelo no respondió. Este texto es la plantilla básica. Puede guardarlo o generar de nuevo."
    : `Borrador listo con ${respuesta.modelo?.nombre || "el modelo local"}. Revise la vista previa.`;
  $("escrito-vivo").hidden = true;
  const vista = $("escrito-vista");
  vista.hidden = false;
  vista.innerHTML = respuesta.vista || "";
  vista.scrollTop = 0;
  $("escrito-word").disabled = false;
  $("escrito-pdf").disabled = false;
});
async function guardarBorrador(cual) {
  if (!estado.borrador || !estado.detalle?.id_proceso) return;
  const boton = cual === "pdf" ? $("escrito-pdf") : $("escrito-word");
  boton.disabled = true;
  const guardar = cual === "pdf" ? window.vigencia.guardarBorradorPdf : window.vigencia.guardarBorradorWord;
  const respuesta = await guardar(estado.detalle.id_proceso, estado.borrador);
  boton.disabled = false;
  if (!respuesta.ok) {
    if (!respuesta.cancelado) {
      $("escrito-error").hidden = false;
      $("escrito-error").textContent = respuesta.error || "No pude guardar el documento.";
    }
    return;
  }
  ocultarDialogo("dialogo-escrito");
  ayuda(cual === "pdf" ? "Se descargó el memorial en PDF." : "Se guardó el escrito de Word.");
}
$("escrito-word").addEventListener("click", () => guardarBorrador("word"));
$("escrito-pdf").addEventListener("click", () => guardarBorrador("pdf"));
$("form-escrito").addEventListener("submit", (evento) => {
  evento.preventDefault();
  $("escrito-generar").click();
});
$("informe-cerrar").addEventListener("click", () => ocultarDialogo("dialogo-informe"));

function excluirMarcadas(id) {
  const caja = $(id);
  if (!caja) return [];
  return [...caja.querySelectorAll("input[data-pieza]")]
    .filter((input) => !input.checked)
    .map((input) => Number(input.dataset.pieza));
}

function pintarContexto(caja, piezas) {
  if (!caja) return;
  const excluidos = new Set(excluirMarcadas(caja.id));
  caja.replaceChildren();
  const activas = (piezas || []).filter((pieza) => pieza.activa);
  if (!activas.length) {
    caja.append(nodo("p", "ayuda", "No hay piezas activas. Cree alguna en Biblioteca."));
    return;
  }
  for (const pieza of activas) {
    const etiqueta = nodo("label", "casilla");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.pieza = String(pieza.id);
    input.checked = !excluidos.has(Number(pieza.id));
    input.addEventListener("change", () => {
      olvidarDudas(caja.id === "iniciar-contexto" ? "iniciar" : "escrito");
    });
    etiqueta.append(input, document.createTextNode(`${pieza.nombre} · ${pieza.tipoNombre}`));
    caja.append(etiqueta);
  }
}

async function pintarContextoGeneracion() {
  const respuesta = await window.vigencia.piezasListar();
  estado.piezas = respuesta?.ok ? respuesta.piezas : [];
  pintarContexto($("escrito-contexto"), estado.piezas);
  pintarContexto($("iniciar-contexto"), estado.piezas);
  if (!$("dialogo-biblioteca").hidden) pintarBiblioteca();
}

function errorBiblioteca(mensaje) {
  const caja = $("biblioteca-error");
  caja.hidden = !mensaje;
  caja.textContent = mensaje || "";
}

function pintarBiblioteca() {
  const caja = $("biblioteca-lista");
  caja.replaceChildren();
  const piezas = estado.piezas || [];
  if (!piezas.length) {
    caja.append(nodo("p", "nota", "Todavía no hay piezas. Cree una o importe un .txt."));
    return;
  }
  for (const pieza of piezas) {
    const tarjeta = nodo("article", `persona${pieza.activa ? "" : " pieza-off"}`);
    const info = nodo("div");
    info.append(nodo("h3", "", pieza.nombre));
    info.append(nodo("p", "", `${pieza.tipoNombre}${pieza.activa ? "" : " · apagada"}`));
    const preview = String(pieza.texto || "").replace(/\s+/g, " ").trim();
    info.append(nodo("p", "ayuda", preview.length > 180 ? `${preview.slice(0, 180)}…` : preview));
    tarjeta.append(info);
    const acciones = nodo("div", "hermanos");
    const editar = nodo("button", "boton-linea", "Editar");
    editar.type = "button";
    editar.addEventListener("click", () => abrirFormaPieza(pieza));
    const interruptor = nodo("button", "boton-linea", pieza.activa ? "Apagar" : "Encender");
    interruptor.type = "button";
    interruptor.addEventListener("click", () => cambiarPieza(pieza));
    const borrar = nodo("button", "boton-texto", "Borrar");
    borrar.type = "button";
    borrar.addEventListener("click", () => confirmarBorrarPieza(pieza, borrar));
    acciones.append(editar, interruptor, borrar);
    tarjeta.append(acciones);
    caja.append(tarjeta);
  }
}

async function cambiarPieza(pieza) {
  errorBiblioteca("");
  const respuesta = await window.vigencia.piezaActivar(pieza.id, !pieza.activa);
  if (!respuesta?.ok) {
    errorBiblioteca(respuesta?.error || "No pude cambiar la pieza.");
    return;
  }
  await pintarContextoGeneracion();
}

async function confirmarBorrarPieza(pieza, boton) {
  if (boton.dataset.confirmar !== "1") {
    boton.dataset.confirmar = "1";
    boton.textContent = "Confirmar";
    return;
  }
  errorBiblioteca("");
  const respuesta = await window.vigencia.piezaBorrar(pieza.id);
  if (!respuesta?.ok) {
    errorBiblioteca(respuesta?.error || "No pude borrar la pieza.");
    return;
  }
  await pintarContextoGeneracion();
}

function abrirFormaPieza(pieza) {
  estado.piezaId = pieza?.id || null;
  $("pieza-titulo").textContent = pieza?.id ? "Editar pieza" : "Nueva pieza";
  $("pieza-nombre").value = pieza?.nombre || "";
  $("pieza-tipo").value = pieza?.tipo || "plantilla";
  $("pieza-texto").value = pieza?.texto || "";
  $("pieza-error").hidden = true;
  mostrarDialogo("dialogo-pieza");
  $("pieza-nombre").focus();
}

async function abrirBiblioteca() {
  errorBiblioteca("");
  await pintarContextoGeneracion();
  mostrarDialogo("dialogo-biblioteca");
  $("biblioteca-nueva").focus();
}

$("biblioteca-cerrar").addEventListener("click", () => ocultarDialogo("dialogo-biblioteca"));
$("biblioteca-nueva").addEventListener("click", () => abrirFormaPieza(null));
$("abrir-biblioteca").addEventListener("click", abrirBiblioteca);
$("escrito-biblioteca").addEventListener("click", abrirBiblioteca);
$("iniciar-biblioteca").addEventListener("click", abrirBiblioteca);
$("pieza-cancelar").addEventListener("click", () => ocultarDialogo("dialogo-pieza"));
async function tomarTxt(archivo, enFormulario) {
  const leido = (await archivo.text()).replace(/^\uFEFF/, "");
  const recortado = leido.length > 20000;
  const textoPieza = leido.slice(0, 20000);
  const nombre = archivo.name.replace(/\.txt$/i, "").slice(0, 120);
  if (enFormulario) {
    if (!$("pieza-nombre").value.trim()) $("pieza-nombre").value = nombre;
    $("pieza-texto").value = textoPieza;
  } else {
    abrirFormaPieza({ nombre, tipo: "plantilla", texto: textoPieza });
  }
  if (recortado) {
    $("pieza-error").hidden = false;
    $("pieza-error").textContent = "Se tomaron los primeros 20000 caracteres.";
  }
}
$("pieza-pegar").addEventListener("click", () => $("pieza-archivo").click());
$("biblioteca-importar").addEventListener("click", () => $("biblioteca-archivo").click());
$("pieza-archivo").addEventListener("change", async () => {
  const archivo = $("pieza-archivo").files?.[0];
  $("pieza-archivo").value = "";
  if (archivo) await tomarTxt(archivo, true);
});
$("biblioteca-archivo").addEventListener("change", async () => {
  const archivo = $("biblioteca-archivo").files?.[0];
  $("biblioteca-archivo").value = "";
  if (archivo) await tomarTxt(archivo, false);
});
$("form-pieza").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  $("pieza-error").hidden = true;
  const respuesta = await window.vigencia.piezaGuardar({
    id: estado.piezaId,
    nombre: $("pieza-nombre").value,
    tipo: $("pieza-tipo").value,
    texto: $("pieza-texto").value,
  });
  if (!respuesta?.ok) {
    $("pieza-error").hidden = false;
    $("pieza-error").textContent = respuesta?.error || "No pude guardar la pieza.";
    return;
  }
  ocultarDialogo("dialogo-pieza");
  await pintarContextoGeneracion();
});

// --- Iniciar proceso (demanda, tutela o petición, sin radicado) ---
estado.iniciar = { tipo: null, borrador: null };

function pintarTiposIniciar() {
  const caja = $("iniciar-tipos");
  caja.replaceChildren();
  for (const [id, definicion] of Object.entries(TIPOS_INICIALES)) {
    const boton = nodo("button", `tipo-iniciar${estado.iniciar.tipo === id ? " activo" : ""}`, definicion.titulo);
    boton.type = "button";
    boton.title = definicion.norma;
    boton.addEventListener("click", () => elegirTipoInicial(id));
    caja.append(boton);
  }
}

function elegirTipoInicial(id) {
  estado.iniciar.tipo = id;
  estado.iniciar.borrador = null;
  pintarTiposIniciar();
  const definicion = TIPOS_INICIALES[id];
  $("iniciar-intro").hidden = false;
  $("iniciar-intro").textContent = `${definicion.intro} Requisitos: ${definicion.requisitos.join(" · ")}.`;
  const campos = $("iniciar-campos");
  campos.replaceChildren();
  for (const campo of CAMPOS_INICIALES) {
    if (campo.id === "cuantia" && id !== "demanda") continue;
    if ((campo.id === "derecho" || campo.id === "juramento") && id !== "tutela") continue;
    const etiqueta = nodo("label", "etiqueta", campo.etiqueta);
    etiqueta.htmlFor = `ini-${campo.id}`;
    campos.append(etiqueta);
    if (campo.tipo === "area") {
      const area = nodo("textarea");
      area.id = `ini-${campo.id}`;
      area.placeholder = campo.placeholder;
      area.addEventListener("input", invalidarInicial);
      campos.append(area);
    } else if (campo.tipo === "marca") {
      const casilla = nodo("label", "casilla");
      const cheque = document.createElement("input");
      cheque.type = "checkbox";
      cheque.id = `ini-${campo.id}`;
      cheque.addEventListener("change", invalidarInicial);
      casilla.append(cheque, document.createTextNode("Sí, lo juro"));
      campos.append(casilla);
    } else {
      const entrada = nodo("input");
      entrada.id = `ini-${campo.id}`;
      entrada.placeholder = campo.placeholder;
      entrada.autocomplete = "off";
      entrada.addEventListener("input", invalidarInicial);
      campos.append(entrada);
    }
  }
  invalidarInicial();
}

function datosIniciales() {
  const datos = {};
  for (const campo of CAMPOS_INICIALES) {
    const el = $(`ini-${campo.id}`);
    if (!el) continue;
    datos[campo.id] = campo.tipo === "marca" ? el.checked : el.value;
  }
  return datos;
}

function invalidarInicial() {
  estado.iniciar.borrador = null;
  $("iniciar-word").disabled = true;
  $("iniciar-pdf").disabled = true;
  olvidarDudas("iniciar");
}

function abrirIniciar() {
  estado.iniciar = { tipo: null, borrador: null };
  pintarTiposIniciar();
  $("iniciar-intro").hidden = true;
  $("iniciar-campos").replaceChildren();
  $("iniciar-error").hidden = true;
  $("iniciar-estado").hidden = true;
  $("iniciar-vivo").hidden = true;
  $("iniciar-vivo").replaceChildren();
  $("iniciar-vista").hidden = true;
  $("iniciar-vista").replaceChildren();
  $("iniciar-word").disabled = true;
  $("iniciar-pdf").disabled = true;
  $("iniciar-generar").disabled = false;
  olvidarDudas("iniciar");
  const select = $("iniciar-modelo");
  select.replaceChildren();
  mostrarDialogo("dialogo-iniciar");
  pintarContextoGeneracion();
  window.vigencia.modelosListar().then((respuesta) => {
    const modelos = respuesta?.ok ? respuesta.modelos : [{ id: "sencillo", nombre: "Sencillo (plantilla básica)" }];
    for (const modelo of modelos) {
      const opcion = document.createElement("option");
      opcion.value = modelo.id;
      opcion.textContent = modelo.nombre;
      opcion.title = modelo.detalle || modelo.nombre;
      select.append(opcion);
    }
  });
}

$("iniciar-modelo").addEventListener("change", () => olvidarDudas("iniciar"));
$("iniciar").addEventListener("click", abrirIniciar);
$("iniciar-cancelar").addEventListener("click", () => ocultarDialogo("dialogo-iniciar"));
$("form-iniciar").addEventListener("submit", (evento) => {
  evento.preventDefault();
  $("iniciar-generar").click();
});
$("iniciar-generar").addEventListener("click", async () => {
  if (!estado.iniciar.tipo) {
    $("iniciar-error").hidden = false;
    $("iniciar-error").textContent = "Elija si inicia demanda, tutela o derecho de petición.";
    return;
  }
  const aclaracion = aclaracionPendiente("iniciar");
  if (estado.dudasIniciar && !aclaracion) {
    $("iniciar-error").hidden = false;
    $("iniciar-error").textContent = "Escriba la respuesta a las preguntas.";
    $("iniciar-estado").hidden = true;
    return;
  }
  $("iniciar-error").hidden = true;
  $("iniciar-estado").hidden = false;
  $("iniciar-estado").textContent = aclaracion
    ? "Redactando con su respuesta…"
    : (String($("iniciar-modelo").value || "").startsWith("nube:")
      ? "Pidiendo el documento al proveedor con su clave…"
      : "Redactando en este computador…");
  if (aclaracion) $("iniciar-dudas").hidden = true;
  $("iniciar-generar").disabled = true;
  $("iniciar-word").disabled = true;
  $("iniciar-pdf").disabled = true;
  const vivo = $("iniciar-vivo");
  vivo.replaceChildren();
  vivo.append(nodo("p", "vivo-titulo", "Escribiendo…"), nodo("div", "vivo-lineas"));
  const lineas = vivo.lastChild;
  const porSeccion = new Map();
  const dejarDeEscuchar = window.vigencia.alBorrador((avance) => {
    if ($("dialogo-iniciar").hidden) return;
    vivo.hidden = false;
    $("iniciar-vista").hidden = true;
    let bloque = porSeccion.get(avance.seccion);
    if (!bloque) {
      bloque = nodo("div", "vivo-bloque");
      bloque.append(nodo("p", "vivo-seccion", avance.seccion));
      bloque.append(nodo("p", "vivo-texto", ""));
      porSeccion.set(avance.seccion, bloque);
      lineas.append(bloque);
    }
    vivo.firstChild.textContent = `Escribiendo ${avance.seccion.toLowerCase()}…`;
    const parrafo = bloque.lastChild;
    parrafo.textContent = avance.texto;
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "▌";
    parrafo.append(caret);
    vivo.scrollTop = vivo.scrollHeight;
  });
  let respuesta = null;
  try {
    respuesta = await window.vigencia.iniciarGenerar(
      estado.iniciar.tipo,
      datosIniciales(),
      $("iniciar-modelo").value,
      excluirMarcadas("iniciar-contexto"),
      aclaracion,
    );
  } finally {
    dejarDeEscuchar();
  }
  $("iniciar-generar").disabled = false;
  if (!respuesta.ok) {
    $("iniciar-error").hidden = false;
    $("iniciar-error").textContent = respuesta.error;
    $("iniciar-estado").hidden = true;
    if (estado.dudasIniciar) $("iniciar-dudas").hidden = false;
    return;
  }
  if (respuesta.dudas?.length) {
    mostrarDudas("iniciar", respuesta.dudas);
    return;
  }
  olvidarDudas("iniciar");
  const definicion = TIPOS_INICIALES[estado.iniciar.tipo];
  estado.iniciar.borrador = {
    asunto: respuesta.asunto,
    secciones: respuesta.secciones,
    origen: respuesta.origen === "nube" ? "nube" : "local",
    titulo: definicion.titulo,
    presentante: datosIniciales().presentante,
    contraparte: datosIniciales().contraparte,
    autoridad: datosIniciales().autoridad,
  };
  $("iniciar-estado").textContent = respuesta.respaldo
    ? "El modelo no respondió. Este texto es la plantilla básica. Puede guardarlo o generar de nuevo."
    : `Documento listo con ${respuesta.modelo?.nombre || "el modelo"}. Revise la vista previa. Cuando lo radique y tenga los 23 dígitos, agréguelo en la lista.`;
  $("iniciar-vivo").hidden = true;
  const vista = $("iniciar-vista");
  vista.hidden = false;
  vista.innerHTML = respuesta.vista || "";
  vista.scrollTop = 0;
  $("iniciar-word").disabled = false;
  $("iniciar-pdf").disabled = false;
});
async function guardarInicial(cual) {
  if (!estado.iniciar.borrador) return;
  const boton = cual === "pdf" ? $("iniciar-pdf") : $("iniciar-word");
  boton.disabled = true;
  const actual = estado.iniciar.borrador;
  const respuesta = await window.vigencia.iniciarGuardar({
    borrador: { asunto: actual.asunto, secciones: actual.secciones, origen: actual.origen },
    formato: cual,
    titulo: actual.titulo,
    presentante: actual.presentante,
    contraparte: actual.contraparte,
    autoridad: actual.autoridad,
  });
  boton.disabled = false;
  if (!respuesta.ok) {
    if (!respuesta.cancelado) {
      $("iniciar-error").hidden = false;
      $("iniciar-error").textContent = respuesta.error || "No pude guardar el documento.";
    }
    return;
  }
  ocultarDialogo("dialogo-iniciar");
  ayuda(cual === "pdf" ? "Se descargó el documento en PDF." : "Se guardó el documento de Word.");
}
$("iniciar-word").addEventListener("click", () => guardarInicial("word"));
$("iniciar-pdf").addEventListener("click", () => guardarInicial("pdf"));
$("ver-informe").addEventListener("click", () => {
  if (estado.informe) mostrarInforme(estado.informe);
});
$("eliminar-cancelar").addEventListener("click", () => {
  ocultarDialogo("dialogo-eliminar");
});
$("eliminar-confirmar").addEventListener("click", async () => {
  const id = estado.eliminarId;
  const respuesta = await window.vigencia.borrarProceso(id);
  ocultarDialogo("dialogo-eliminar");
  if (!respuesta.ok) {
    ayuda(respuesta.error, true);
    return;
  }
  if (Number(estado.idAbierto) === Number(id)) {
    estado.idAbierto = null;
    estado.detalle = null;
  }
  await cargar();
  if (estado.idAbierto) await abrirId(estado.idAbierto);
  else vacioInicial();
  ayuda("El expediente se eliminó de este computador.");
});

$("borrar-confirmar").addEventListener("click", async () => {
  const respuesta = await window.vigencia.borrarCliente(estado.borrarId);
  ocultarDialogo("dialogo-borrar");
  if (!respuesta.ok) {
    ayuda(respuesta.error, true);
    return;
  }
  await cargar();
  if (estado.idAbierto) await abrirId(estado.idAbierto);
  if (!$("dialogo-directorio").hidden) pintarDirectorio();
});

function pintarTema() {
  const oscuro = document.documentElement.dataset.tema === "oscuro";
  const etiqueta = oscuro ? "Tema claro" : "Tema oscuro";
  $("tema").textContent = etiqueta;
  $("tema").setAttribute("aria-pressed", oscuro ? "true" : "false");
  $("licencia-tema").textContent = etiqueta;
  window.vigencia.tema(oscuro ? "oscuro" : "claro");
}

function cambiarTema() {
  const tema = document.documentElement.dataset.tema === "oscuro" ? "claro" : "oscuro";
  document.documentElement.dataset.tema = tema;
  try {
    localStorage.setItem("vigencia-tema", tema);
  } catch {
    /* el cambio vale para esta ventana */
  }
  pintarTema();
}

$("tema").addEventListener("click", cambiarTema);
$("licencia-tema").addEventListener("click", cambiarTema);
pintarTema();

const CLAVE_OCULTOS = "vigencia-sistemas-ocultos";
const CLAVE_PLEGADA = "vigencia-sistemas-plegada";

function leerGuardado(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardarLocal(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* el cambio vale para esta ventana */
  }
}

function pintarSistemas() {
  const documentos = $("sistema-documentos");
  documentos.classList.toggle("activo", estado.sistema === "documentos");
  $("sistema-convertir").classList.toggle("activo", estado.sistema === "convertir");
  if (estado.sistema === "documentos") documentos.setAttribute("aria-current", "page");
  else documentos.removeAttribute("aria-current");
  const lista = $("sistemas-lista");
  lista.replaceChildren();
  for (const sistema of sistemasVisibles(estado.ocultos)) {
    const boton = nodo("button", "sistema");
    boton.type = "button";
    boton.title = sistema.fuente ? `${sistema.nombre} · ${sistema.fuente}` : sistema.nombre;
    if (sistema.id === estado.sistema) {
      boton.classList.add("activo");
      boton.setAttribute("aria-current", "page");
    }
    boton.append(nodo("span", "sistema-sigla", sistema.sigla));
    const textos = nodo("span", "sistema-textos sistemas-texto");
    textos.append(nodo("span", "sistema-nombre", sistema.nombre));
    if (sistema.fuente) textos.append(nodo("span", "sistema-fuente", sistema.fuente));
    boton.append(textos);
    if (!sistema.listo) boton.append(nodo("span", "sistema-pronto sistemas-texto", "Pronto"));
    boton.addEventListener("click", () => elegirSistema(sistema.id));
    lista.append(boton);
  }
}

function elegirDocumentos() {
  estado.sistema = "documentos";
  cerrarCombos();
  for (const id of ["pantalla-consulta", "pantalla-pp", "pantalla-spoa", "pantalla-samai", "pantalla-juris", "pantalla-construccion", "pantalla-convertir"]) $(id).hidden = true;
  $("pantalla-documentos").hidden = false;
  document.title = "Documentos";
  pintarSistemas();
  abrirDocumentos();
}

function elegirConvertir() {
  estado.sistema = "convertir";
  cerrarCombos();
  for (const id of ["pantalla-consulta", "pantalla-pp", "pantalla-spoa", "pantalla-samai", "pantalla-juris", "pantalla-construccion", "pantalla-documentos"]) $(id).hidden = true;
  $("pantalla-convertir").hidden = false;
  document.title = "Convertir a Markdown";
  pintarSistemas();
  $("sistema-convertir").classList.add("activo");
  abrirConvertir();
}

function elegirSistema(id) {
  if (id === "documentos") {
    elegirDocumentos();
    return;
  }
  if (id === "convertir") {
    elegirConvertir();
    return;
  }
  $("pantalla-documentos").hidden = true;
  $("pantalla-convertir").hidden = true;
  $("sistema-convertir").classList.remove("activo");
  const sistema = sistemaDe(sistemaElegible(id, estado.ocultos));
  estado.sistema = sistema.id;
  cerrarCombos();
  const propia = sistema.id === SISTEMA_INICIAL;
  const pp = sistema.id === "micrositio";
  const spoa = sistema.id === "spoa";
  const samai = sistema.id === "samai";
  const juris = sistema.id === "juris";
  $("pantalla-consulta").hidden = !propia;
  $("pantalla-pp").hidden = !pp;
  $("pantalla-spoa").hidden = !spoa;
  $("pantalla-samai").hidden = !samai;
  $("pantalla-juris").hidden = !juris;
  $("pantalla-construccion").hidden = propia || pp || spoa || samai || juris;
  if (!propia && !pp && !spoa && !samai && !juris) {
    $("obra-sistema").textContent = sistema.fuente ? `${sistema.nombre} · ${sistema.fuente}` : sistema.nombre;
    $("obra-texto").textContent = `Estamos construyendo la consulta de ${sistema.nombre}. Mientras tanto, sus expedientes siguen en la consulta nacional unificada.`;
  }
  if (pp) abrirPp();
  if (spoa) pintarSpCasos();
  if (samai) abrirSamai();
  if (juris) abrirJuris();
  document.title = `${propia ? "Procesos" : sistema.nombre} · Vigencia`;
  pintarSistemas();
}

function plegarSistemas(plegada) {
  $("sistemas").classList.toggle("plegada", plegada);
  const boton = $("sistemas-plegar");
  boton.setAttribute("aria-expanded", plegada ? "false" : "true");
  boton.title = plegada ? "Desplegar la barra" : "Plegar la barra";
  boton.querySelector(".sistemas-flecha").textContent = plegada ? "»" : "«";
}

function abrirSistemas() {
  const caja = $("sistemas-opciones");
  caja.replaceChildren();
  for (const sistema of SISTEMAS) {
    const etiqueta = nodo("label", "casilla");
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.value = sistema.id;
    casilla.checked = sistema.fijo || !estado.ocultos.has(sistema.id);
    casilla.disabled = Boolean(sistema.fijo);
    const textos = nodo("span");
    textos.append(nodo("strong", "", sistema.fuente ? `${sistema.nombre} · ${sistema.fuente}` : sistema.nombre));
    if (sistema.fijo) textos.append(nodo("small", "", "Siempre a la vista: aquí están los expedientes y la revisión automática."));
    else if (!sistema.listo) textos.append(nodo("small", "", "Próximamente."));
    etiqueta.append(casilla, textos);
    caja.append(etiqueta);
  }
  mostrarDialogo("dialogo-sistemas");
  caja.querySelector("input:not(:disabled)")?.focus();
}

$("form-sistemas").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const ocultos = new Set();
  for (const casilla of $("sistemas-opciones").querySelectorAll("input[type=checkbox]")) {
    if (!casilla.disabled && !casilla.checked) ocultos.add(casilla.value);
  }
  estado.ocultos = leerOcultos(guardarOcultos(ocultos));
  guardarLocal(CLAVE_OCULTOS, guardarOcultos(estado.ocultos));
  ocultarDialogo("dialogo-sistemas");
  elegirSistema(estado.sistema);
});
$("sistemas-cancelar").addEventListener("click", () => ocultarDialogo("dialogo-sistemas"));
$("abrir-sistemas").addEventListener("click", abrirSistemas);
$("sistemas-ajustar").addEventListener("click", abrirSistemas);
$("obra-volver").addEventListener("click", () => elegirSistema(SISTEMA_INICIAL));
$("sistemas-plegar").addEventListener("click", () => {
  const plegada = !$("sistemas").classList.contains("plegada");
  plegarSistemas(plegada);
  guardarLocal(CLAVE_PLEGADA, plegada ? "1" : "0");
});

estado.ocultos = leerOcultos(leerGuardado(CLAVE_OCULTOS));
plegarSistemas(leerGuardado(CLAVE_PLEGADA) === "1");
elegirSistema(SISTEMA_INICIAL);

function textoMarca(marca) {
  return marca ? `${fechaCorta(marca)} ${String(marca).slice(11, 16)}` : "";
}

function pintarAutomatica(info) {
  if (!info) return;
  estado.automatica = info;
  if ("actualizarHasta" in info) {
    estado.pausaHasta = info.actualizarHasta || null;
    pintarActualizar();
  }
  const ultima = info.ultima;
  let linea = "Última revisión automática: todavía no";
  if (ultima) {
    linea = `Última revisión automática: ${textoMarca(ultima.inicio)}`;
    if (ultima.estado === "interrumpida") linea += " · interrumpida";
    else {
      linea += ` · ${ultima.revisados || 0} revisados · ${ultima.cambiados || 0} con cambios`;
      if (ultima.errores) linea += ` · ${ultima.errores} con error`;
    }
  }
  if (info.proxima) linea += ` · próxima ${textoMarca(info.proxima)}`;
  $("ultima-auto").textContent = linea;
  $("ultima-auto").hidden = false;
}

async function abrirAjustes() {
  const respuesta = await window.vigencia.ajustes();
  if (respuesta?.ok) pintarAutomatica(respuesta);
  const info = estado.automatica || {};
  const horas = info.horas || ["07:00", "13:00"];
  $("aj-hora1").value = horas[0] || "";
  $("aj-hora2").value = horas[1] || "";
  $("aj-inicio").checked = info.inicioSesion !== false;
  $("aj-error").hidden = true;
  $("aj-ultima").textContent = $("ultima-auto").textContent;
  mostrarDialogo("dialogo-ajustes");
  $("aj-hora1").focus();
}

function errorAjustes(mensaje) {
  $("aj-error").hidden = false;
  $("aj-error").textContent = mensaje;
}

async function guardarAjustesForm(evento) {
  evento.preventDefault();
  const valido = validarHorarios([$("aj-hora1").value, $("aj-hora2").value]);
  if (!valido.ok) {
    errorAjustes(valido.error);
    return;
  }
  const respuesta = await window.vigencia.guardarAjustes({ horas: valido.horas, inicioSesion: $("aj-inicio").checked });
  if (!respuesta.ok) {
    errorAjustes(respuesta.error || "No pude guardar las horas.");
    return;
  }
  pintarAutomatica(respuesta);
  ocultarDialogo("dialogo-ajustes");
  ayuda(`Revisión automática a las ${respuesta.horas.join(" y ")}.`);
}

async function verCambios(ids) {
  const lista = (ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!lista.length) return;
  elegirSistema(SISTEMA_INICIAL);
  await cargar();
  estado.consulta = "";
  $("busqueda").value = "";
  estado.tipo = "todos";
  estado.despacho = "todos";
  estado.cliente = "todos";
  llenarFiltros();
  estado.soloIds = lista;
  pintarLista();
  await abrirId(lista[0]);
}

$("abrir-ajustes").addEventListener("click", abrirAjustes);
$("menu-boton").addEventListener("click", (evento) => {
  evento.stopPropagation();
  cerrarMenus();
  const lista = $("menu-lista");
  const abierto = !lista.hidden;
  if (abierto) cerrarMenuOpciones();
  else {
    lista.hidden = false;
    $("menu-boton").setAttribute("aria-expanded", "true");
  }
});
$("menu-lista").addEventListener("click", (evento) => {
  if (evento.target.closest("button") && !evento.target.closest("button").disabled) cerrarMenuOpciones();
});
document.addEventListener("click", (evento) => {
  const lista = $("menu-lista");
  if (!lista || lista.hidden) return;
  if ($("menu-raiz").contains(evento.target)) return;
  cerrarMenuOpciones();
});
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  const lista = $("menu-lista");
  if (lista && !lista.hidden) {
    evento.stopImmediatePropagation();
    cerrarMenuOpciones();
    $("menu-boton").focus();
  }
});
window.addEventListener("resize", cerrarMenuOpciones);
window.addEventListener("scroll", cerrarMenuOpciones, true);
$("aj-cancelar").addEventListener("click", () => ocultarDialogo("dialogo-ajustes"));
$("aj-quitar2").addEventListener("click", () => {
  $("aj-hora2").value = "";
});
$("form-ajustes").addEventListener("submit", guardarAjustesForm);
window.vigencia.alRevisionAutomatica(pintarAutomatica);
window.vigencia.alAbrirCambios((ids) => {
  verCambios(ids);
});
window.vigencia.alCorrida(aplicarCorrida);

let aplicacionLista = false;
let estadoPlan = "";
let datoPlan = null;

function pintarPuerta(info) {
  estadoPlan = info?.estado || "";
  datoPlan = info || null;
  const abierta = planAbierto(info?.estado);
  $("licencia").hidden = abierta;
  $("aplicacion").hidden = !abierta;
  const banner = $("aviso-prueba");
  banner.hidden = info?.estado !== "prueba";
  if (info?.estado === "prueba") {
    const n = Number(info?.diasRestantes) || 0;
    banner.textContent = `Prueba gratis: ${n} ${n === 1 ? "día" : "días"} restantes · Ver el plan`;
  }
  $("licencia-seguir").hidden = info?.estado !== "prueba";
  if (abierta) return;
  // La puerta real siempre trae sus botones (consultar el plan los esconde).
  for (const id of ["iniciar-plan", "ya-pague", "licencia-codigo", "activar-codigo"]) $(id).hidden = false;
  const etiquetaCodigo = document.querySelector('#licencia label[for="licencia-codigo"]');
  if (etiquetaCodigo) etiquetaCodigo.hidden = false;
  $("licencia-seguir").textContent = "Seguir probando";
  const vencida = info?.estado === "vencida";
  const precio = info?.precioTexto || "$599.900";
  const hasta = info?.hasta ? fechaCorta(String(info.hasta).slice(0, 10)) : "";
  $("licencia-titulo").textContent = vencida ? "El plan se venció" : "Se acabó la prueba gratis";
  $("iniciar-plan").textContent = vencida ? "Pagar el otro año" : "Iniciar el plan";
  $("licencia-texto").textContent = vencida
    ? `El año terminó${hasta && hasta !== "Sin fecha" ? ` el ${hasta}` : ""}. Los expedientes siguen en este computador. Esta es la única página hasta pagar el otro año, ${precio}. El nuevo año empieza cuando Wompi confirme el pago.`
    : `Tuviste 20 días gratis y se acabaron. Para seguir usando Vigencia paga el plan: ${precio} por un año. Tus expedientes siguen en este computador y nada se borra. El año empieza cuando Wompi confirma el pago.`;
}

function mostrarPlan() {
  cerrarMenuOpciones();
  // La puerta pinta el pago; aquí solo se consulta: a una cuenta vigente
  // no se le ofrece pagar de nuevo, solo se le muestra su vigencia.
  const idsPago = ["iniciar-plan", "ya-pague", "pago-navegador", "licencia-codigo", "activar-codigo"];
  const etiquetaCodigo = document.querySelector('#licencia label[for="licencia-codigo"]');
  if (estadoPlan === "vigente") {
    const hasta = datoPlan?.hasta ? fechaCorta(String(datoPlan.hasta).slice(0, 10)) : "";
    $("licencia-titulo").textContent = "Tu plan está vigente";
    $("licencia-texto").textContent = hasta && hasta !== "Sin fecha"
      ? `Tu año va hasta el ${hasta}. Tus expedientes siguen en este computador.`
      : "Tu plan está vigente. Tus expedientes siguen en este computador.";
    for (const id of idsPago) $(id).hidden = true;
    if (etiquetaCodigo) etiquetaCodigo.hidden = true;
    $("licencia-aviso").textContent = "";
    $("licencia-seguir").hidden = false;
    $("licencia-seguir").textContent = "Volver";
  } else {
    for (const id of idsPago) $(id).hidden = false;
    $("pago-navegador").hidden = true;
    if (etiquetaCodigo) etiquetaCodigo.hidden = false;
    $("licencia-seguir").hidden = estadoPlan !== "prueba";
    $("licencia-seguir").textContent = "Seguir probando";
    pintarPuerta(datoPlan);
    if (estadoPlan === "prueba") {
      const n = Number(datoPlan?.diasRestantes) || 0;
      const precio = datoPlan?.precioTexto || "$599.900";
      $("licencia-titulo").textContent = "Tu prueba gratis";
      $("licencia-texto").textContent = `Te ${n === 1 ? "queda 1 día" : `quedan ${n} días`} gratis con todo incluido. Cuando se acaben, el plan cuesta ${precio} por un año y tus expedientes siguen en este computador.`;
    }
  }
  // Se consulta el plan encima de la app; Seguir probando/Volver devuelve.
  $("licencia").hidden = false;
  $("aplicacion").hidden = true;
}

async function entrarSiVigente(info) {
  if (!planAbierto(info?.estado) || aplicacionLista) return;
  aplicacionLista = true;
  const estadoInicial = await window.vigencia.estado();
  estado.pausaHasta = estadoInicial.actualizarHasta || null;
  pintarAutomatica(estadoInicial.automatica);
  estado.informe = estadoInicial.informe || null;
  pintarVerInforme();
  const trabajos = estadoInicial.trabajos || {};
  if (trabajos.todo?.corriendo) aplicarCorrida(trabajos.todo);
  if (trabajos.carga?.corriendo) aplicarCorrida(trabajos.carga);
  if (trabajos.uno?.corriendo) aplicarCorrida(trabajos.uno);
  if (trabajos.agregar?.corriendo) {
    prepararDialogo(trabajos.agregar.radicado || "");
    aplicarCorrida(trabajos.agregar);
  }
  if (!trabajos.todo?.corriendo && !trabajos.carga?.corriendo && !trabajos.uno?.corriendo && !trabajos.agregar?.corriendo) pintarOcupados();
  await cargar();
  if (estadoInicial.abrirCambios?.length) await verCambios(estadoInicial.abrirCambios);
  if (!estado.idAbierto && !estado.radicadoVacio) vacioInicial();
}

async function refrescarLicencia() {
  const info = await window.vigencia.licencia();
  pintarPuerta(info);
  await entrarSiVigente(info);
  return info;
}

$("iniciar-plan").addEventListener("click", async () => {
  $("iniciar-plan").disabled = true;
  $("licencia-aviso").textContent = "Abriendo el pago…";
  const respuesta = await window.vigencia.iniciarPlan();
  $("iniciar-plan").disabled = false;
  if (!respuesta?.ok) {
    $("licencia-aviso").textContent = respuesta?.error || "No pude abrir el pago.";
    return;
  }
  if (planAbierto(respuesta.estado)) {
    $("licencia-aviso").textContent = "";
    pintarPuerta(respuesta);
    await entrarSiVigente(respuesta);
    return;
  }
  $("pago-navegador").hidden = false;
  $("licencia-aviso").textContent = "Cuando termines en Wompi, pulsa Ya pagué.";
});

$("licencia-seguir").addEventListener("click", () => {
  $("licencia").hidden = true;
  $("aplicacion").hidden = !planAbierto(estadoPlan);
});

$("aviso-prueba").addEventListener("click", mostrarPlan);
$("ver-plan").addEventListener("click", mostrarPlan);

$("ya-pague").addEventListener("click", async () => {
  $("ya-pague").disabled = true;
  $("licencia-aviso").textContent = "Confirmando el pago…";
  const respuesta = await window.vigencia.confirmarPlan();
  $("ya-pague").disabled = false;
  if (planAbierto(respuesta?.estado)) {
    $("licencia-aviso").textContent = "";
    pintarPuerta(respuesta);
    await entrarSiVigente(respuesta);
    return;
  }
  $("licencia-aviso").textContent = respuesta?.estado === "pendiente"
    ? "Wompi todavía no confirma el pago."
    : (respuesta?.error || "Todavía no hay un pago confirmado.");
});

$("activar-codigo").addEventListener("click", async () => {
  $("activar-codigo").disabled = true;
  $("licencia-aviso").textContent = "Revisando el código…";
  const respuesta = await window.vigencia.activarCodigo($("licencia-codigo").value);
  $("activar-codigo").disabled = false;
  if (planAbierto(respuesta?.estado)) {
    $("licencia-codigo").value = "";
    $("licencia-aviso").textContent = "";
    pintarPuerta(respuesta);
    await entrarSiVigente(respuesta);
    return;
  }
  $("licencia-aviso").textContent = respuesta?.error || "Ese código no abre esta instalación.";
});

$("pago-navegador").addEventListener("click", async () => {
  const respuesta = await window.vigencia.abrirPagoNavegador();
  if (!respuesta?.ok) $("licencia-aviso").textContent = respuesta?.error || "Primero inicia el plan.";
});

$("licencia-salir").addEventListener("click", () => window.vigencia.salir());
window.vigencia.alPago(() => {
  $("ya-pague").click();
});
try {
  await refrescarLicencia();
} catch (error) {
  // Si el arranque falla, la puerta lo dice en vez de quedar muda.
  $("licencia").hidden = false;
  $("aplicacion").hidden = true;
  $("licencia-titulo").textContent = "No pude arrancar";
  $("licencia-texto").textContent = `Vigencia no pudo leer su estado: ${error?.message || error}. Revise que la carpeta de datos se pueda escribir e intente de nuevo.`;
  throw error;
}

const ppPantalla = { deptos: false, muni: "", lista: [], despachoSel: "" };

function llenarOpciones(select, opciones) {
  select.replaceChildren();
  for (const [valor, texto] of opciones) select.append(new Option(texto, valor));
}

function opcionesDistintas(lista, fn) {
  const vistos = new Map();
  for (const d of lista) {
    const etiqueta = fn(d.nombre);
    vistos.set(etiqueta, (vistos.get(etiqueta) || 0) + 1);
  }
  return [...vistos].map(([etiqueta, n]) => [etiqueta, `${etiqueta} (${n})`]);
}

function elegirPpTab(cual) {
  const buscar = cual !== "cargados";
  $("pp-tab-buscar").classList.toggle("elegida", buscar);
  $("pp-tab-cargados").classList.toggle("elegida", !buscar);
  $("pp-tab-buscar").setAttribute("aria-selected", buscar ? "true" : "false");
  $("pp-tab-cargados").setAttribute("aria-selected", !buscar ? "true" : "false");
  $("pp-panel-buscar").hidden = !buscar;
  $("pp-panel-cargados").hidden = buscar;
}
$("pp-tab-buscar").addEventListener("click", () => elegirPpTab("buscar"));
$("pp-tab-cargados").addEventListener("click", () => elegirPpTab("cargados"));
$("pp-frecuencia").addEventListener("change", async () => {
  await window.vigencia.ppGuardarFrecuencia(Number($("pp-frecuencia").value));
});

async function abrirPp() {
  if (!ppPantalla.deptos) {
    const respuesta = await window.vigencia.ppDeptos();
    if (!respuesta?.ok) {
      $("pp-estado").textContent = respuesta?.error || "No pude leer el catálogo.";
      return;
    }
    ppPantalla.deptos = true;
    llenarOpciones($("pp-depto"), respuesta.deptos.map((d) => [d.codigo, `${d.codigo} · ${d.nombre}`]));
    $("pp-depto").dispatchEvent(new Event("change"));
  }
  await pintarPpCargados();
}

async function pintarPpDespachos() {
  const muni = $("pp-muni").value;
  if (muni !== ppPantalla.muni) {
    const respuesta = await window.vigencia.ppDespachos($("pp-depto").value, muni, "");
    ppPantalla.muni = muni;
    ppPantalla.lista = respuesta?.ok ? respuesta.despachos : [];
    ppPantalla.despachoSel = "";
    llenarOpciones($("pp-especialidad"), [["", "Todas"], ...opcionesDistintas(ppPantalla.lista, especialidadDe)]);
    $("pp-texto").value = "";
  }
  aplicarFiltrosPp();
}

function aplicarFiltrosPp() {
  const esp = $("pp-especialidad").value;
  const texto = $("pp-texto").value;
  const caja = $("pp-despacho");
  caja.replaceChildren();
  let n = 0;
  for (const d of ppPantalla.lista) {
    if (esp && especialidadDe(d.nombre) !== esp) continue;
    if (!coincideBusqueda(`${d.codigo} ${d.nombre}`, texto)) continue;
    n++;
    const marca = d.estado === "lista" ? ` ✓ ${d.avisos}` : d.estado === "cancelada" ? " (incompleta)" : "";
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "pp-despacho" + (d.codigo === ppPantalla.despachoSel ? " elegido" : "");
    boton.setAttribute("role", "option");
    boton.setAttribute("aria-selected", d.codigo === ppPantalla.despachoSel ? "true" : "false");
    const codigo = document.createElement("span");
    codigo.className = "mono pp-codigo";
    codigo.textContent = d.codigo;
    const nombre = document.createElement("span");
    nombre.className = "pp-nombre";
    nombre.textContent = d.nombre + marca;
    boton.append(codigo, nombre);
    boton.addEventListener("click", () => {
      ppPantalla.despachoSel = d.codigo;
      aplicarFiltrosPp();
    });
    caja.append(boton);
  }
  $("pp-cuenta").textContent = n === ppPantalla.lista.length ? `${n}` : `${n} de ${ppPantalla.lista.length}`;
}

$("pp-depto").addEventListener("change", async () => {
  const respuesta = await window.vigencia.ppMunicipios($("pp-depto").value);
  const munis = respuesta?.ok ? respuesta.municipios : [];
  llenarOpciones($("pp-muni"), munis.map((m) => [m.codigo, `${m.nombre} (${m.despachos})`]));
  await pintarPpDespachos();
});
$("pp-muni").addEventListener("change", pintarPpDespachos);
$("pp-especialidad").addEventListener("change", aplicarFiltrosPp);
$("pp-texto").addEventListener("input", aplicarFiltrosPp);

$("pp-cargar").addEventListener("click", async () => {
  const despacho = ppPantalla.despachoSel;
  if (!despacho) {
    $("pp-estado").textContent = "Elija un despacho de la lista.";
    return;
  }
  const respuesta = await window.vigencia.ppCargar($("pp-depto").value, despacho);
  if (!respuesta?.ok) {
    $("pp-estado").textContent = respuesta?.error || "No pude empezar.";
    return;
  }
  $("pp-cancelar").hidden = false;
  $("pp-barra").hidden = false;
  $("pp-cargar").disabled = true;
  $("pp-estado").textContent = "Empezando la carga en segundo plano…";
});
$("pp-cancelar").addEventListener("click", () => window.vigencia.ppCancelar());
window.vigencia.alPp((estado) => {
  if (estado.terminado) {
    $("pp-cancelar").hidden = true;
    $("pp-barra").hidden = true;
    $("pp-cargar").disabled = false;
    $("pp-estado").textContent = estado.error && !estado.avisos
      ? `Terminó con error: ${estado.error}`
      : `${estado.nuevos || estado.avisos} nuevos: ${estado.docs} documentos en ${estado.pagina} páginas.`;
    pintarPpCargados();
    if (estado.despacho) verPpDespacho(estado.despacho);
    return;
  }
  $("pp-estado").textContent = `Página ${estado.pagina} de ${estado.paginas}: ${estado.avisos} avisos, ${estado.docs} documentos…`;
});

async function pintarPpCargados() {
  const respuesta = await window.vigencia.ppCargados();
  const caja = $("pp-cargados");
  caja.replaceChildren();
  const cargados = respuesta?.ok ? respuesta.cargados : [];
  $("pp-tab-cuenta").textContent = cargados.length ? `(${cargados.length})` : "";
  const frec = await window.vigencia.ppFrecuencia();
  if (frec?.ok) $("pp-frecuencia").value = String(frec.horas);
  for (const c of cargados) {
    const tarjeta = nodo("article", "persona");
    const info = nodo("div");
    info.append(nodo("h3", "", c.codigo));
    info.append(nodo("p", "", String(c.nombre || "").slice(0, 80)));
    info.append(nodo("p", "modelo-estado", `${c.avisos} avisos · ${c.docs} documentos · ${c.actualizada || ""}`));
    tarjeta.append(info);
    const acciones = nodo("div", "hermanos");
    const ver = nodo("button", "boton-linea", "Ver");
    ver.type = "button";
    ver.addEventListener("click", () => verPpDespacho(c.codigo));
    const olvidar = nodo("button", "boton-texto", "Olvidar");
    olvidar.type = "button";
    olvidar.addEventListener("click", async () => {
      await window.vigencia.ppOlvidar(c.codigo);
      await pintarPpCargados();
      if (ppPantalla.despacho === c.codigo) {
        $("pp-lista").replaceChildren();
        $("pp-vacio").hidden = false;
      }
    });
    acciones.append(ver, olvidar);
    tarjeta.append(acciones);
    caja.append(tarjeta);
  }
}

async function verPpDespacho(codigo) {
  ppPantalla.despacho = codigo;
  $("pp-vacio").hidden = true;
  const caja = $("pp-lista");
  caja.replaceChildren();
  const respuesta = await window.vigencia.ppPublicaciones(codigo);
  for (const p of respuesta?.ok ? respuesta.publicaciones : []) {
    const tarjeta = nodo("article", "persona");
    const info = nodo("div");
    info.append(nodo("h3", "", p.titulo || "(sin título)"));
    const meta = nodo("p", "pp-meta");
    if (p.fecha) meta.append(nodo("span", "etiqueta-ultima", p.fecha));
    if (p.tipo) meta.append(nodo("span", "pp-tipo", p.tipo));
    meta.append(nodo("span", "pp-cuenta-docs", `${p.docs} documento(s)`));
    info.append(meta);
    const docs = nodo("div");
    docs.hidden = true;
    info.append(docs);
    tarjeta.append(info);
    const acciones = nodo("div", "hermanos");
    const boton = nodo("button", "boton-linea", "Documentos");
    boton.type = "button";
    boton.addEventListener("click", async () => {
      if (!docs.hidden) {
        docs.hidden = true;
        boton.textContent = "Documentos";
        return;
      }
      const r = await window.vigencia.ppDocumentos(p.id);
      docs.replaceChildren();
      for (const d of r?.ok ? r.documentos : []) {
        const fila = nodo("div", "pp-doc");
        const icono = nodo("span", "pp-doc-icono", "📄");
        icono.setAttribute("aria-hidden", "true");
        const datos = nodo("div", "pp-doc-info");
        datos.append(nodo("p", "pp-doc-nombre", d.nombre || "Documento"));
        if (d.fecha) datos.append(nodo("p", "pp-doc-fecha", d.fecha));
        const acciones = nodo("div", "pp-doc-acciones");
        const ver = nodo("button", "boton-linea pp-mini", "Ver");
        ver.type = "button";
        ver.addEventListener("click", () => verPpDoc(d));
        const bajar = nodo("button", "boton-linea pp-mini", "Descargar");
        bajar.type = "button";
        bajar.addEventListener("click", async () => {
          bajar.disabled = true;
          let r2 = null;
          try {
            r2 = await window.vigencia.ppDescargarDoc(d.url, d.nombre, null);
          } catch {
            r2 = { ok: false };
          } finally {
            bajar.disabled = false;
          }
          bajar.textContent = r2?.ok ? "Guardado ✓" : "Reintentar";
          setTimeout(() => {
            bajar.textContent = "Descargar";
          }, 2500);
        });
        acciones.append(ver, bajar);
        fila.append(icono, datos, acciones);
        docs.append(fila);
      }
      docs.hidden = false;
      boton.textContent = "Ocultar";
    });
    acciones.append(boton);
    tarjeta.append(acciones);
    caja.append(tarjeta);
  }
}

const spPantalla = { casos: [] };

function textoSpCaso(c) {
  return `${c.noticia} ${c.despacho} ${c.estado} ${c.etapa}`;
}

async function pintarSpCasos() {
  const respuesta = await window.vigencia.spoaCasos();
  spPantalla.casos = respuesta?.ok ? respuesta.casos : [];
  const estados = [...new Set(spPantalla.casos.map((c) => c.estado).filter(Boolean))].sort();
  const etapas = [...new Set(spPantalla.casos.map((c) => c.etapa).filter(Boolean))].sort();
  const actualEstado = $("spoa-estado").value;
  const actualEtapa = $("spoa-etapa").value;
  llenarOpciones($("spoa-estado"), [["", "Todos"], ...estados.map((e) => [e, e])]);
  llenarOpciones($("spoa-etapa"), [["", "Todas"], ...etapas.map((e) => [e, e])]);
  if (estados.includes(actualEstado)) $("spoa-estado").value = actualEstado;
  if (etapas.includes(actualEtapa)) $("spoa-etapa").value = actualEtapa;
  aplicarFiltrosSp();
}

function aplicarFiltrosSp() {
  const caja = $("spoa-casos");
  caja.replaceChildren();
  const estado = $("spoa-estado").value;
  const etapa = $("spoa-etapa").value;
  const texto = $("spoa-texto").value;
  for (const c of spPantalla.casos) {
    if (estado && c.estado !== estado) continue;
    if (etapa && c.etapa !== etapa) continue;
    if (!coincideBusqueda(textoSpCaso(c), texto)) continue;
    const tarjeta = nodo("article", "persona");
    const info = nodo("div");
    info.append(nodo("h3", "mono spoa-noticia", c.noticia));
    info.append(nodo("p", "", String(c.despacho || "").slice(0, 80)));
    info.append(nodo("p", "modelo-estado", `${c.estado || ""} · ${c.etapa || ""} · ${c.actuaciones} actuaciones`));
    tarjeta.append(info);
    const acciones = nodo("div", "hermanos");
    const ver = nodo("button", "boton-linea", "Ver");
    ver.type = "button";
    ver.addEventListener("click", () => verSpCaso(c.noticia));
    const olvidar = nodo("button", "boton-texto", "Olvidar");
    olvidar.type = "button";
    olvidar.addEventListener("click", async () => {
      await window.vigencia.spoaOlvidar(c.noticia);
      await pintarSpCasos();
    });
    acciones.append(ver, olvidar);
    tarjeta.append(acciones);
    caja.append(tarjeta);
  }
}

function pintarSpFicha(caso) {
  const caja = $("spoa-ficha");
  caja.replaceChildren();
  $("spoa-vacio").hidden = true;
  const ficha = nodo("div", "cabecera lectura ficha");
  const arriba = nodo("div", "ficha-arriba");
  const textoFicha = nodo("div", "ficha-texto");
  textoFicha.append(nodo("p", "kicker", [caso.estado, caso.etapa, caso.ley].filter(Boolean).join(" · ") || "SPOA"));
  textoFicha.append(nodo("h2", "expediente-titulo serif", caso.despacho || "Sin despacho"));
  const fila = nodo("div", "fila-radicado");
  fila.append(nodo("p", "radicado-grande mono", caso.noticia || ""));
  textoFicha.append(fila);
  arriba.append(textoFicha);
  ficha.append(arriba);
  const datos = [
    ["Unidad", caso.unidad], ["Seccional", caso.seccional], ["Dirección", caso.direccion],
    ["Teléfono", caso.telefono], ["Asignación", caso.fecha_asignacion],
    ["Hechos", [caso.muni_hecho, caso.depto_hecho, caso.fecha_hechos].filter(Boolean).join(" · ")],
  ].filter(([, valor]) => Boolean(valor));
  if (datos.length) {
    const cajaDatos = nodo("div", "datos");
    for (const [clave, valor] of datos) {
      const dato = nodo("div", "dato");
      dato.append(nodo("p", "dato-clave", clave), nodo("p", "dato-valor", valor));
      cajaDatos.append(dato);
    }
    ficha.append(cajaDatos);
  }
  if ((caso.delitos || []).length) {
    ficha.append(nodo("p", "etiqueta", "Delitos"));
    const lista = nodo("div", "spoa-delitos");
    for (const delito of caso.delitos) {
      const parte = nodo("div", "parte");
      parte.append(nodo("p", "parte-nombre", delito));
      lista.append(parte);
    }
    ficha.append(lista);
  }
  ficha.append(nodo("p", "etiqueta", `Actuaciones (${(caso.actuaciones || []).length})`));
  const linea = nodo("div", "spoa-actos");
  for (const a of caso.actuaciones || []) {
    const tarjeta = nodo("article", "persona");
    const info = nodo("div");
    if (a.fecha) info.append(nodo("span", "etiqueta-ultima", a.fecha));
    info.append(nodo("p", "spoa-acto", a.descripcion || ""));
    tarjeta.append(info);
    linea.append(tarjeta);
  }
  ficha.append(linea);
  caja.append(ficha);
}

async function verSpCaso(noticia) {
  const respuesta = await window.vigencia.spoaCaso(noticia);
  if (respuesta?.ok && respuesta.caso) pintarSpFicha(respuesta.caso);
}

$("spoa-estado").addEventListener("change", aplicarFiltrosSp);
$("spoa-etapa").addEventListener("change", aplicarFiltrosSp);
$("spoa-texto").addEventListener("input", aplicarFiltrosSp);

$("spoa-consultar").addEventListener("click", async () => {
  const numero = $("spoa-numero").value.trim();
  $("spoa-ayuda").textContent = "Consultando en la Fiscalía…";
  let respuesta = null;
  try {
    respuesta = await window.vigencia.spoaConsultar(numero);
  } catch {
    respuesta = { ok: false };
  }
  if (!respuesta?.ok) {
    $("spoa-ayuda").textContent = respuesta?.error || "No pude consultar.";
    return;
  }
  $("spoa-ayuda").textContent = respuesta.nuevas
    ? `Guardado con ${respuesta.nuevas} actuaciones nuevas.`
    : "Guardado sin actuaciones nuevas.";
  pintarSpFicha(respuesta.caso);
  pintarSpCasos();
});

const samaiPantalla = { corps: false, casos: [] };

function textoSamaiCaso(c) {
  return `${c.radicado} ${c.despacho} ${c.clase} ${c.demandante} ${c.demandado}`;
}

async function abrirSamai() {
  if (!samaiPantalla.corps) {
    const respuesta = await window.vigencia.samaiCorporaciones();
    if (!respuesta?.ok) {
      $("samai-ayuda").textContent = respuesta?.error || "No pude leer los juzgados.";
      return;
    }
    samaiPantalla.corps = true;
    llenarOpciones($("samai-corporacion"), respuesta.corporaciones.map((c) => [c.codigo, c.nombre]));
    const bogota = respuesta.corporaciones.find((c) => c.codigo === "1100133");
    if (bogota) $("samai-corporacion").value = "1100133";
  }
  await pintarSamaiCasos();
}

$("samai-buscar").addEventListener("click", async () => {
  const criterio = $("samai-criterio").value.trim();
  if (!criterio) {
    $("samai-ayuda").textContent = "Escriba la cédula o el radicado.";
    return;
  }
  $("samai-ayuda").textContent = "Buscando en el Consejo de Estado…";
  let respuesta = null;
  try {
    respuesta = await window.vigencia.samaiBuscar(criterio, $("samai-corporacion").value);
  } catch {
    respuesta = { ok: false };
  }
  if (!respuesta?.ok) {
    $("samai-ayuda").textContent = respuesta?.error || "No pude buscar.";
    return;
  }
  if (!respuesta.procesos.length) {
    $("samai-ayuda").textContent = "Sin resultados para esa búsqueda.";
    return;
  }
  $("samai-ayuda").textContent = `${respuesta.total} resultado(s). Elija uno para guardarlo con sus actuaciones.`;
  pintarSamaiResultados(respuesta.procesos);
  await pintarSamaiCasos();
});

function pintarSamaiResultados(procesos) {
  $("samai-vacio").hidden = true;
  const caja = $("samai-ficha");
  caja.replaceChildren();
  for (const p of procesos) {
    const tarjeta = nodo("article", "persona");
    const info = nodo("div");
    info.append(nodo("h3", "mono spoa-noticia", p.radicado));
    info.append(nodo("p", "", `${p.demandante || ""} contra ${p.demandado || ""}`.slice(0, 120)));
    info.append(nodo("p", "modelo-estado", `${p.clase || ""} · ${p.despacho || ""}`.slice(0, 120)));
    tarjeta.append(info);
    const acciones = nodo("div", "hermanos");
    const ver = nodo("button", "boton-cobre", "Guardar");
    ver.type = "button";
    ver.addEventListener("click", () => verSamaiProceso(p.guid));
    acciones.append(ver);
    tarjeta.append(acciones);
    caja.append(tarjeta);
  }
}

async function verSamaiProceso(guid) {
  $("samai-vacio").hidden = true;
  $("samai-ficha").replaceChildren();
  $("samai-ficha").append(nodo("p", "ayuda", "Trayendo las actuaciones…"));
  let respuesta = null;
  try {
    respuesta = await window.vigencia.samaiVer(guid);
  } catch {
    respuesta = { ok: false };
  }
  if (!respuesta?.ok || !respuesta.caso) {
    $("samai-ficha").replaceChildren();
    $("samai-ficha").append(nodo("p", "ayuda error", respuesta?.error || "No pude traer las actuaciones."));
    return;
  }
  pintarSamaiFicha(respuesta.caso);
  pintarSamaiCasos();
}

function pintarSamaiFicha(caso) {
  const caja = $("samai-ficha");
  caja.replaceChildren();
  $("samai-vacio").hidden = true;
  const ficha = nodo("div", "cabecera lectura ficha");
  const arriba = nodo("div", "ficha-arriba");
  const textoFicha = nodo("div", "ficha-texto");
  textoFicha.append(nodo("p", "kicker", [caso.clase, caso.vigente === "SI" ? "Vigente" : ""].filter(Boolean).join(" · ") || "SAMAI"));
  textoFicha.append(nodo("h2", "expediente-titulo serif", caso.despacho_lindo || caso.despacho || "Sin despacho"));
  const fila = nodo("div", "fila-radicado");
  fila.append(nodo("p", "radicado-grande mono", caso.radicado || ""));
  textoFicha.append(fila);
  arriba.append(textoFicha);
  ficha.append(arriba);
  const datos = [
    ["Ponente", caso.ponente], ["Titular", caso.titular], ["Ingreso", caso.fecha_ingreso],
    ["Demandante", caso.demandante], ["Demandado", caso.demandado], ["Asunto", caso.asunto],
  ].filter(([, valor]) => Boolean(valor));
  if (datos.length) {
    const cajaDatos = nodo("div", "datos");
    for (const [clave, valor] of datos) {
      const dato = nodo("div", "dato");
      dato.append(nodo("p", "dato-clave", clave), nodo("p", "dato-valor", valor));
      cajaDatos.append(dato);
    }
    ficha.append(cajaDatos);
  }
  ficha.append(nodo("p", "etiqueta", `Actuaciones (${(caso.actuaciones || []).length})`));
  const linea = nodo("div", "spoa-actos");
  for (const a of caso.actuaciones || []) {
    const tarjeta = nodo("article", "persona");
    const info = nodo("div");
    if (a.fecha) info.append(nodo("span", "etiqueta-ultima", a.fecha));
    info.append(nodo("p", "spoa-acto", a.actuacion || ""));
    if (a.anotacion) info.append(nodo("p", "pp-doc-fecha", a.anotacion));
    if (a.estado || a.anexos) info.append(nodo("p", "pp-doc-fecha", `${a.estado || ""}${a.anexos ? ` · ${a.anexos} anexos` : ""}`.trim()));
    tarjeta.append(info);
    linea.append(tarjeta);
  }
  ficha.append(linea);
  caja.append(ficha);
}

function aplicarFiltrosSamai() {
  const caja = $("samai-lista");
  caja.replaceChildren();
  const clase = $("samai-clase").value;
  const texto = $("samai-texto").value;
  let n = 0;
  for (const c of samaiPantalla.casos) {
    if (clase && c.clase !== clase) continue;
    if (!coincideBusqueda(textoSamaiCaso(c), texto)) continue;
    n++;
    const tarjeta = nodo("article", "persona");
    const info = nodo("div");
    info.append(nodo("h3", "mono spoa-noticia", c.radicado));
    info.append(nodo("p", "", `${c.demandante || ""} contra ${c.demandado || ""}`.slice(0, 120)));
    info.append(nodo("p", "modelo-estado", `${c.clase || ""} · ${c.actuaciones} actuaciones`));
    tarjeta.append(info);
    const acciones = nodo("div", "hermanos");
    const ver = nodo("button", "boton-linea", "Ver");
    ver.type = "button";
    ver.addEventListener("click", () => verSamaiGuardado(c.guid));
    const olvidar = nodo("button", "boton-texto", "Olvidar");
    olvidar.type = "button";
    olvidar.addEventListener("click", async () => {
      await window.vigencia.samaiOlvidar(c.guid);
      await pintarSamaiCasos();
    });
    acciones.append(ver, olvidar);
    tarjeta.append(acciones);
    caja.append(tarjeta);
  }
  $("samai-cuenta").textContent = n === samaiPantalla.casos.length ? `${n}` : `${n} de ${samaiPantalla.casos.length}`;
}

async function pintarSamaiCasos() {
  const respuesta = await window.vigencia.samaiCasos();
  samaiPantalla.casos = respuesta?.ok ? respuesta.casos : [];
  const clases = [...new Set(samaiPantalla.casos.map((c) => c.clase).filter(Boolean))].sort();
  const actual = $("samai-clase").value;
  llenarOpciones($("samai-clase"), [["", "Todas"], ...clases.map((e) => [e, e])]);
  if (clases.includes(actual)) $("samai-clase").value = actual;
  aplicarFiltrosSamai();
}

async function verSamaiGuardado(guid) {
  const respuesta = await window.vigencia.samaiCaso(guid);
  if (respuesta?.ok && respuesta.caso) pintarSamaiFicha(respuesta.caso);
}

$("samai-clase").addEventListener("change", aplicarFiltrosSamai);
$("samai-texto").addEventListener("input", aplicarFiltrosSamai);

$("sistema-documentos").addEventListener("click", () => elegirSistema("documentos"));
$("sistema-convertir").addEventListener("click", () => elegirSistema("convertir"));
iniciarDocumentos({ mostrarDialogo, ocultarDialogo, menuDesplegable, abrirConfigModelos });
iniciarConvertir({ abrirConfigModelos });
iniciarJuris();
iniciarComentarios({ mostrarDialogo, ocultarDialogo });
$("abrir-comentarios").addEventListener("click", abrirComentarios);
