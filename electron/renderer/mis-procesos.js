// Mis procesos: el tablero que junta todos los procesos (consulta nacional,
// SAMAI, SPOA, estados del juzgado y manuales), con lo propio del despacho,
// las audiencias y los documentos de cada uno. El detalle completo de cada
// sistema sigue en su pantalla: aquí solo se resume y se lleva allá.
import {
  DIAS_QUIETO, ESTADOS_LISTA, MODALIDADES, TIPOS_PROPIA, diasDeSemana, filtrarProcesos, fuenteDe, isoDia, lineaDeTiempo,
  mesCalendario, proximasAudiencias, tipoPropia,
} from "../compartido/misprocesos.js";
import { avisar } from "./aviso.js";
import { boton } from "./escena.js";
import { crearVisor, docUnico } from "./paginas.js";
import { irA } from "./proyectos.js";

const $ = (id) => document.getElementById(id);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const PESTANAS = [["resumen", "Resumen"], ["actuaciones", "Actuaciones"], ["audiencias", "Audiencias"], ["documentos", "Documentos"], ["notas", "Notas"]];
const ORIGEN = { consulta: "Rama Judicial", samai: "SAMAI", spoa: "SPOA", estado: "Estado del juzgado", manual: "Registrada a mano" };

const m = {
  datos: null,
  filtro: { fuente: "", abogado: "", despacho: "", estado: "activos", texto: "" },
  vista: "procesos",
  abierta: "",
  det: null,
  pestana: "resumen",
  linea: "todo",
  editar: false,
  cal: { modo: "mes", ancla: isoDia(new Date()) },
};
const archivo = docUnico();

function nodo(tag, clase = "", contenido = "") {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (contenido !== "" && contenido != null) el.textContent = String(contenido);
  return el;
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

async function llamar(accion, dato, { aviso = true } = {}) {
  let r;
  try {
    r = await window.vigencia.mis(accion, dato);
  } catch {
    r = { ok: false, error: "No pude hacerlo." };
  }
  if (!r?.ok && !r?.cancelado && aviso) avisar(r?.error || "No pude hacerlo.", "error");
  return r?.ok ? r : null;
}

export function fechaLarga(iso) {
  if (!iso) return "Sin fecha";
  const [a, mes, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[mes - 1]} de ${a}`;
}

function fechaCorta(iso) {
  if (!iso) return "Sin fecha";
  const [a, mes, d] = iso.split("-");
  return `${d}/${mes}/${a}`;
}

function haceDias(n) {
  if (n === null || n === undefined) return "Sin actuaciones";
  if (n <= 0) return "Hoy";
  if (n === 1) return "Ayer";
  return `Hace ${n} días`;
}

function hoy() {
  return m.datos?.hoy || isoDia(new Date());
}

function proceso(clave) {
  return m.datos?.procesos.find((p) => p.clave === clave) || null;
}

function campo(etiqueta, control) {
  const l = nodo("label", "mis-campo");
  l.append(nodo("span", "etiqueta", etiqueta), control);
  return l;
}

function entrada(tipo, valor = "", extra = {}) {
  const i = document.createElement("input");
  i.type = tipo;
  i.value = valor || "";
  Object.assign(i, extra);
  return i;
}

function selector(opciones, valor = "") {
  const s = document.createElement("select");
  for (const [v, t] of opciones) s.append(new Option(t, v));
  s.value = valor;
  return s;
}

function areaTexto(valor = "", placeholder = "") {
  const t = document.createElement("textarea");
  t.value = valor;
  t.placeholder = placeholder;
  return t;
}

function insignia(fuente) {
  const f = fuenteDe(fuente);
  const b = nodo("span", `mis-sigla mis-fuente-${f.id}`, f.sigla);
  b.title = f.nombre;
  return b;
}

// ---------- Carga ----------

export async function abrirMisProcesos(clave = "") {
  const r = await llamar("listar");
  if (!r) return;
  m.datos = r;
  llenarFiltros();
  pintarTablero();
  pintarVista();
  if (clave) await abrir(clave);
  else if (m.abierta && proceso(m.abierta)) await abrir(m.abierta, { mantener: true });
  else cerrarPanel();
}

async function recargar() {
  await abrirMisProcesos();
}

function llenarFiltros() {
  const d = m.datos;
  const poner = (id, opciones, valor) => {
    const s = $(id);
    s.replaceChildren(...opciones.map(([v, t]) => new Option(t, v)));
    s.value = opciones.some(([v]) => v === valor) ? valor : "";
  };
  poner("mis-fuente", [["", "Todas las fuentes"], ...d.fuentes.map((f) => [f.id, f.corto])], m.filtro.fuente);
  poner("mis-abogado", [["", "Todos los abogados"], ...d.clientes.map((c) => [String(c.id), [c.nombre, c.apellidos].filter(Boolean).join(" ")])], m.filtro.abogado);
  const despachos = [...new Set(d.procesos.map((p) => p.despacho).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  poner("mis-despacho", [["", "Todos los despachos"], ...despachos.map((x) => [x, x])], m.filtro.despacho);
  const est = $("mis-estado");
  if (!est.options.length) est.replaceChildren(...ESTADOS_LISTA.map((e) => new Option(e.nombre, e.id)));
  est.value = m.filtro.estado;
  m.filtro.fuente = $("mis-fuente").value;
  m.filtro.abogado = $("mis-abogado").value;
  m.filtro.despacho = $("mis-despacho").value;
}

// ---------- Tablero ----------

function kpi(valor, titulo, detalle, alPulsar, clase = "") {
  const b = nodo("button", `mis-kpi ${clase}`.trim());
  b.type = "button";
  b.append(nodo("span", "mis-kpi-valor", valor), nodo("span", "mis-kpi-titulo", titulo));
  if (detalle) b.append(nodo("span", "mis-kpi-detalle", detalle));
  b.addEventListener("click", alPulsar);
  return b;
}

function pintarTablero() {
  const t = m.datos.tablero;
  const caja = $("mis-kpis");
  const fuentes = nodo("div", "mis-kpi mis-kpi-fuentes");
  fuentes.append(nodo("span", "mis-kpi-titulo", "Por fuente"));
  const chips = nodo("div", "mis-chips");
  for (const f of m.datos.fuentes) {
    const n = t.porFuente[f.id] || 0;
    const c = nodo("button", `mis-chip${m.filtro.fuente === f.id ? " elegido" : ""}`);
    c.type = "button";
    c.setAttribute("aria-pressed", m.filtro.fuente === f.id ? "true" : "false");
    c.append(insignia(f.id), nodo("span", "", `${f.corto} ${n}`));
    c.title = f.nombre;
    c.addEventListener("click", () => cambiarFiltro({ fuente: m.filtro.fuente === f.id ? "" : f.id }));
    chips.append(c);
  }
  fuentes.append(chips);
  caja.replaceChildren(
    kpi(t.activos, "Procesos activos", t.recientes ? plural(t.recientes, "con movimiento reciente", "con movimiento reciente") : "Sin movimiento esta semana", () => cambiarFiltro({ estado: "activos", fuente: "" })),
    fuentes,
    kpi(t.audienciasSemana, "Audiencias esta semana", m.datos.sugerencias.length ? plural(m.datos.sugerencias.length, "sugerida por confirmar", "sugeridas por confirmar") : "Vea el calendario", () => elegirVista("calendario"), m.datos.sugerencias.length ? "atento" : ""),
    kpi(t.pendientes, "Pendientes del despacho", t.vencidas ? plural(t.vencidas, "vencida", "vencidas") : "Tareas y memoriales por radicar", () => pintarPendientes(), t.vencidas ? "alerta" : ""),
    kpi(t.quietos, "Quietos", `Sin movimiento en ${DIAS_QUIETO} días`, () => cambiarFiltro({ estado: "quietos" })),
  );
}

function pintarPendientes() {
  elegirVista("procesos");
  const lista = m.datos.pendientes;
  const caja = $("mis-lista");
  caja.replaceChildren();
  const cab = nodo("div", "mis-lista-cabeza");
  cab.append(nodo("h2", "mis-subtitulo", "Pendientes del despacho"), boton("Ver los procesos", "boton-texto", () => pintarLista()));
  caja.append(cab);
  if (!lista.length) caja.append(nodo("p", "ayuda", "No tiene pendientes. Las tareas y los memoriales por radicar aparecen aquí."));
  for (const n of lista) {
    const p = proceso(n.clave);
    const fila = nodo("button", `mis-pendiente${n.vence && n.vence < hoy() ? " vencida" : ""}`);
    fila.type = "button";
    fila.append(nodo("span", "mis-propia-tipo", tipoPropia(n.tipo).nombre), nodo("span", "mis-pendiente-texto", n.texto),
      nodo("span", "ayuda", [p ? p.radicado || p.despacho : "", n.vence ? `vence el ${fechaCorta(n.vence)}` : ""].filter(Boolean).join(", ")));
    fila.addEventListener("click", () => abrir(n.clave, { pestana: "notas" }));
    caja.append(fila);
  }
}

// ---------- Lista ----------

function cambiarFiltro(cambio) {
  Object.assign(m.filtro, cambio);
  llenarFiltros();
  pintarTablero();
  elegirVista("procesos");
}

function pintarLista() {
  const caja = $("mis-lista");
  const lista = filtrarProcesos(m.datos.procesos, m.filtro);
  const total = m.datos.procesos.filter((p) => !p.archivado).length;
  $("mis-cuenta").textContent = lista.length === total ? plural(total, "proceso", "procesos") : `${lista.length} de ${plural(total, "proceso", "procesos")}`;
  caja.replaceChildren();
  if (!m.datos.procesos.length) {
    const vacio = nodo("div", "mis-vacio");
    vacio.append(nodo("h2", "mis-subtitulo", "Aquí estarán todos sus procesos"),
      nodo("p", "ayuda", "Los que agregue en la consulta nacional, SAMAI o SPOA, los que siga desde un estado del juzgado y los que cree a mano."),
      boton("Crear un proceso manual", "boton-cobre", () => nuevoManual()));
    caja.append(vacio);
    return;
  }
  if (!lista.length) caja.append(nodo("p", "ayuda mis-sin", "Ningún proceso coincide con los filtros."));
  for (const p of lista) caja.append(tarjeta(p));
}

function tarjeta(p) {
  const t = nodo("article", `mis-tarjeta${m.abierta === p.clave ? " abierta" : ""}${p.archivado ? " archivada" : ""}`);
  t.tabIndex = 0;
  t.dataset.clave = p.clave;
  t.setAttribute("role", "button");
  t.setAttribute("aria-label", `${fuenteDe(p.fuente).corto}, ${p.radicado || p.despacho || "proceso"}`);
  const cab = nodo("div", "mis-tarjeta-cabeza");
  cab.append(insignia(p.fuente), nodo("span", "mis-radicado mono", p.radicado || "Sin radicado"));
  const marcas = nodo("span", "mis-marcas");
  if (p.reciente) marcas.append(nodo("span", "mis-marca reciente", "Movimiento reciente"));
  else if (p.diasSinMovimiento === null || p.diasSinMovimiento > DIAS_QUIETO) marcas.append(nodo("span", "mis-marca quieto", "Quieto"));
  if (p.vinculable) marcas.append(nodo("span", "mis-marca vincular", "Para vincular"));
  if (p.archivado) marcas.append(nodo("span", "mis-marca", "Archivado"));
  cab.append(marcas);
  t.append(cab, nodo("p", "mis-despacho", p.despacho || "Sin despacho"));
  const partes = [p.demandante, p.demandado].filter(Boolean).join(" contra ");
  if (partes) t.append(nodo("p", "mis-partes", partes));
  const ult = nodo("p", "mis-ultima");
  ult.append(nodo("span", "mis-ultima-fecha", haceDias(p.diasSinMovimiento)), nodo("span", "", p.ultimaActuacion || (p.fuente === "manual" ? "Registre sus actuaciones a mano" : "")));
  t.append(ult);
  const pie = [p.clase, p.cliente && `Cliente ${p.cliente}`, p.abogado && `Abogado ${p.abogado}`].filter(Boolean).join(", ");
  if (pie) t.append(nodo("p", "ayuda mis-pie", pie));
  const ir = () => abrir(p.clave);
  t.addEventListener("click", ir);
  t.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ir();
    }
  });
  return t;
}

function elegirVista(vista) {
  m.vista = vista;
  for (const [id, v] of [["mis-tab-procesos", "procesos"], ["mis-tab-calendario", "calendario"]]) {
    $(id).classList.toggle("elegida", v === vista);
    $(id).setAttribute("aria-selected", v === vista ? "true" : "false");
  }
  $("mis-vista-procesos").hidden = vista !== "procesos";
  $("mis-vista-calendario").hidden = vista !== "calendario";
  pintarVista();
}

function pintarVista() {
  if (m.vista === "calendario") pintarCalendario();
  else pintarLista();
}

// ---------- Panel del proceso ----------

function cerrarPanel() {
  m.abierta = "";
  m.det = null;
  $("mis-panel").hidden = true;
  $("mis-dos").classList.remove("con-panel");
  for (const t of document.querySelectorAll(".mis-tarjeta.abierta")) t.classList.remove("abierta");
}

async function abrir(clave, { pestana = null, mantener = false } = {}) {
  const r = await llamar("detalle", { clave });
  if (!r) return;
  if (m.vista !== "procesos") elegirVista("procesos");
  m.det = r;
  m.abierta = r.proceso.clave;
  if (!mantener) {
    m.pestana = pestana || "resumen";
    m.editar = false;
  } else if (pestana) m.pestana = pestana;
  $("mis-panel").hidden = false;
  $("mis-dos").classList.add("con-panel");
  for (const t of document.querySelectorAll(".mis-tarjeta")) t.classList.toggle("abierta", t.dataset.clave === m.abierta);
  pintarPanel();
}

async function refrescar(pestana) {
  const clave = m.abierta;
  const r = await llamar("listar", undefined, { aviso: false });
  if (r) {
    m.datos = r;
    pintarTablero();
    pintarVista();
  }
  if (clave) await abrir(clave, { mantener: true, pestana });
}

function pintarPanel() {
  const { proceso: p } = m.det;
  const panel = $("mis-panel");
  const cab = nodo("header", "mis-panel-cabeza");
  const fila = nodo("div", "mis-panel-fila");
  fila.append(insignia(p.fuente), nodo("span", "ayuda", p.fuenteNombre));
  const cerrar = boton("Cerrar", "boton-texto", cerrarPanel);
  cerrar.setAttribute("aria-label", "Cerrar el proceso");
  fila.append(cerrar);
  cab.append(fila, nodo("h2", "mis-panel-titulo mono", p.radicado || "Sin radicado"), nodo("p", "mis-despacho", p.despacho || "Sin despacho"));
  const partes = [p.demandante, p.demandado].filter(Boolean).join(" contra ");
  if (partes) cab.append(nodo("p", "mis-partes", partes));
  const acciones = nodo("div", "botones mis-acciones");
  const ver = { consulta: "Ver en la consulta nacional", samai: "Ver en SAMAI", spoa: "Ver en SPOA" }[p.fuente];
  if (ver) acciones.append(boton(ver, "boton-cobre", () => irA({ a: "ver", clave: p.clave })));
  if (p.fuente === "estados" && p.radicado.length === 23 && !p.vinculable) {
    const b = boton("Buscar en la consulta nacional", "boton-linea", () => irA({ a: "seguir", radicado: p.radicado }));
    b.title = "Usa el mismo Agregar de la consulta. Cuando aparezca allí podrá vincularlo sin perder las filas del estado.";
    acciones.append(b);
  }
  if (p.fuente === "manual" || p.fuente === "estados") acciones.append(boton("Editar datos", "boton-linea", () => { m.editar = true; pintarPanel(); }));
  acciones.append(boton(p.archivado ? "Volver a activos" : "Archivar", "boton-texto", async () => {
    if (await llamar("archivar", { clave: p.clave, archivado: !p.archivado })) {
      avisar(p.archivado ? "El proceso volvió a activos." : "Proceso archivado. Lo encuentra en el filtro Archivados.");
      await refrescar();
    }
  }));
  cab.append(acciones);
  if (p.vinculable) {
    const v = nodo("div", "mis-vincular");
    v.append(nodo("p", "", "Este radicado ya está en la consulta nacional. Puede vincularlos: las filas del estado, sus notas y audiencias pasan a ese proceso."),
      boton("Vincular", "boton-cobre", async () => {
        if (await llamar("vincular", { clave: p.clave, destino: p.vinculable })) {
          avisar("Procesos vinculados.");
          m.abierta = p.vinculable;
          await refrescar();
        }
      }));
    cab.append(v);
  }
  const tabs = nodo("div", "pp-tabs mis-pestanas");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Partes del proceso");
  const cuerpo = nodo("div", "mis-panel-cuerpo");
  cuerpo.setAttribute("role", "tabpanel");
  for (const [id, nombre] of PESTANAS) {
    const b = nodo("button", `pp-tab${m.pestana === id ? " elegida" : ""}`, nombre);
    b.type = "button";
    b.id = `mis-pestana-${id}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", m.pestana === id ? "true" : "false");
    b.tabIndex = m.pestana === id ? 0 : -1;
    b.addEventListener("click", () => {
      m.pestana = id;
      pintarPanel();
      $(`mis-pestana-${id}`)?.focus();
    });
    b.addEventListener("keydown", (e) => {
      const i = PESTANAS.findIndex(([x]) => x === id);
      const n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!n) return;
      e.preventDefault();
      m.pestana = PESTANAS[(i + n + PESTANAS.length) % PESTANAS.length][0];
      pintarPanel();
      $(`mis-pestana-${m.pestana}`)?.focus();
    });
    tabs.append(b);
  }
  cuerpo.setAttribute("aria-labelledby", `mis-pestana-${m.pestana}`);
  if (m.editar) cuerpo.append(formaManual(p));
  else ({ resumen: pResumen, actuaciones: pActuaciones, audiencias: pAudiencias, documentos: pDocumentos, notas: pNotas })[m.pestana](cuerpo);
  panel.replaceChildren(cab, tabs, cuerpo);
}

function seccion(titulo, ...hijos) {
  const s = nodo("section", "mis-seccion");
  s.append(nodo("h3", "mis-seccion-titulo", titulo), ...hijos);
  return s;
}

function itemLinea(x) {
  const li = nodo("li", `mis-evento ${x.lado}`);
  const lado = x.lado === "juzgado" ? (ORIGEN[x.origen] || "Juzgado") : "Despacho propio";
  const cab = nodo("div", "mis-evento-cabeza");
  cab.append(nodo("span", `mis-lado ${x.lado}`, lado), nodo("span", "mis-evento-fecha", fechaCorta(x.fecha)));
  li.append(cab, nodo("p", "mis-evento-titulo", x.titulo || "Sin título"));
  if (x.detalle) li.append(nodo("p", "mis-evento-detalle", x.detalle));
  const d = x.dato || {};
  if (x.origen === "estado") li.append(nodo("p", "ayuda", [d.estado_no && `Estado No. ${d.estado_no}`, d.fecha_estado && `del ${fechaCorta(d.fecha_estado)}`, d.juzgado].filter(Boolean).join(", ")));
  if (x.lado === "propio") {
    const pie = nodo("div", "mis-evento-pie");
    if (d.vence) pie.append(nodo("span", `mis-marca${d.estado !== "hecho" && d.vence < hoy() ? " quieto" : ""}`, `Vence el ${fechaCorta(d.vence)}`));
    pie.append(casillaHecho(d));
    li.append(pie);
  } else if (x.origen === "manual" && d.id) {
    li.append(boton("Quitar", "boton-texto", async () => {
      if (await llamar("actuacion-borrar", { id: d.id })) await refrescar();
    }));
  }
  return li;
}

function casillaHecho(n) {
  const l = nodo("label", "casilla mis-hecho");
  const c = entrada("checkbox");
  c.checked = n.estado === "hecho";
  c.addEventListener("change", async () => {
    if (await llamar("propia-marcar", { id: n.id, estado: c.checked ? "hecho" : "pendiente" })) await refrescar();
  });
  l.append(c, nodo("span", "", "Hecho"));
  return l;
}

function pResumen(c) {
  const d = m.det;
  const p = d.proceso;
  const datos = nodo("dl", "mis-datos");
  for (const [k, v] of [["Clase", p.clase], ["Cliente", p.cliente], ["Abogado", p.abogado], ["Última actuación", p.ultimaFecha ? `${fechaLarga(p.ultimaFecha)}, ${haceDias(p.diasSinMovimiento).toLowerCase()}` : "Sin actuaciones"]]) {
    if (!v) continue;
    datos.append(nodo("dt", "", k), nodo("dd", "", v));
  }
  c.append(datos);
  if (d.sugerencias.length) c.append(seccion("Audiencias que sugieren las actuaciones", listaSugerencias(d.sugerencias)));
  const prox = proximasAudiencias(d.audiencias, hoy(), 3);
  if (prox.length) c.append(seccion("Próximas audiencias", listaAudiencias(prox, false)));
  const pend = d.propias.filter((n) => n.estado !== "hecho" && (n.vence || ["tarea", "radicar"].includes(n.tipo)));
  if (pend.length) {
    const ul = nodo("ul", "mis-linea");
    for (const n of pend) ul.append(itemLinea({ lado: "propio", fecha: n.fecha, titulo: tipoPropia(n.tipo).nombre, detalle: n.texto, dato: n }));
    c.append(seccion("Pendientes del despacho", ul));
  }
  const ul = nodo("ul", "mis-linea");
  for (const x of d.linea.slice(0, 5)) ul.append(itemLinea(x));
  const todo = boton("Ver todas las actuaciones", "boton-texto", () => { m.pestana = "actuaciones"; pintarPanel(); });
  c.append(seccion("Lo último", d.linea.length ? ul : nodo("p", "ayuda", "Todavía no hay actuaciones."), todo));
  c.append(formaPropia());
}

function pActuaciones(c) {
  const d = m.det;
  const barra = nodo("div", "mis-filtro-linea");
  barra.setAttribute("role", "group");
  barra.setAttribute("aria-label", "Qué actuaciones ver");
  for (const [id, nombre] of [["todo", "Todas"], ["juzgado", "Del juzgado"], ["propio", "Del despacho"]]) {
    const b = nodo("button", `mis-chip${m.linea === id ? " elegido" : ""}`, nombre);
    b.type = "button";
    b.setAttribute("aria-pressed", m.linea === id ? "true" : "false");
    b.addEventListener("click", () => { m.linea = id; pintarPanel(); });
    barra.append(b);
  }
  c.append(barra, nodo("p", "ayuda", "Las del despacho son suyas: no cambian lo que compara la revisión automática ni generan avisos."));
  const linea = lineaDeTiempo({ juzgado: d.juzgado, propias: d.propias }, m.linea);
  const ul = nodo("ul", "mis-linea");
  for (const x of linea) ul.append(itemLinea(x));
  c.append(linea.length ? ul : nodo("p", "ayuda", "No hay actuaciones con este filtro."));
  c.append(formaPropia());
  if (d.proceso.fuente === "manual" || d.proceso.fuente === "estados") c.append(formaActuacionManual());
}

function formaPropia() {
  const f = nodo("form", "mis-forma");
  f.append(nodo("h3", "mis-seccion-titulo", "Agregar del lado del despacho"));
  const tipo = selector(TIPOS_PROPIA.map((t) => [t.id, t.nombre]), "nota");
  const fecha = entrada("date", hoy());
  const vence = entrada("date", "");
  const texto = areaTexto("", "Por ejemplo: vino el cliente, se le indicó el trámite. O: se elaboró memorial de impulso, pendiente de radicar en el juzgado.");
  texto.required = true;
  const fila = nodo("div", "mis-forma-fila");
  fila.append(campo("Tipo", tipo), campo("Fecha", fecha), campo("Vence (opcional)", vence));
  const proyectos = m.det.proyectos;
  const ligar = selector([["", "Sin documento"], ...proyectos.map((p) => [`p${p.id}`, `Proyecto: ${p.nombre}`]), ...m.det.archivos.map((a) => [`a${a.id}`, `Archivo: ${a.nombre}`])], "");
  f.append(fila, campo("Qué pasó o qué falta", texto));
  if (proyectos.length || m.det.archivos.length) f.append(campo("Ligado a", ligar));
  const enviar = boton("Agregar", "boton-cobre", () => {});
  enviar.type = "submit";
  f.append(enviar);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const l = ligar.value;
    const r = await llamar("propia-guardar", {
      clave: m.abierta, tipo: tipo.value, fecha: fecha.value, vence: vence.value, texto: texto.value,
      proyecto_id: l.startsWith("p") ? Number(l.slice(1)) : null, archivo_id: l.startsWith("a") ? Number(l.slice(1)) : null,
    });
    if (r) {
      avisar("Quedó en el lado del despacho.");
      await refrescar();
    }
  });
  return f;
}

function formaActuacionManual() {
  const f = nodo("form", "mis-forma");
  f.append(nodo("h3", "mis-seccion-titulo", "Agregar una actuación del juzgado a mano"), nodo("p", "ayuda", "Para procesos que no están en ningún sistema. Nadie los consulta: lo que escriba aquí es la historia del proceso."));
  const fecha = entrada("date", hoy());
  const act = entrada("text", "", { required: true, placeholder: "Por ejemplo: Auto admite demanda" });
  const anot = areaTexto("", "Anotación (opcional)");
  const fila = nodo("div", "mis-forma-fila");
  fila.append(campo("Fecha", fecha), campo("Actuación", act));
  const enviar = boton("Agregar actuación", "boton-linea", () => {});
  enviar.type = "submit";
  f.append(fila, campo("Anotación", anot), enviar);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await llamar("actuacion-guardar", { clave: m.abierta, fecha: fecha.value, actuacion: act.value, anotacion: anot.value })) {
      avisar("Actuación agregada.");
      await refrescar();
    }
  });
  return f;
}

function pNotas(c) {
  const d = m.det;
  const ul = nodo("ul", "mis-linea");
  for (const n of d.propias) {
    const li = itemLinea({ lado: "propio", fecha: n.fecha, titulo: tipoPropia(n.tipo).nombre, detalle: n.texto, dato: n });
    li.append(boton("Borrar", "boton-texto", async () => {
      if (await llamar("propia-borrar", { id: n.id })) await refrescar();
    }));
    ul.append(li);
  }
  c.append(d.propias.length ? ul : nodo("p", "ayuda", "No hay notas ni tareas del despacho para este proceso."), formaPropia());
}

// ---------- Audiencias ----------

function textoAudiencia(a) {
  return [fechaLarga(a.fecha), a.hora && `a las ${a.hora}`, a.modalidad].filter(Boolean).join(", ");
}

function listaSugerencias(lista, conProceso = false) {
  const ul = nodo("ul", "mis-sugerencias");
  for (const s of lista) {
    const li = nodo("li", "mis-sugerencia");
    const p = proceso(s.clave);
    li.append(nodo("p", "mis-evento-titulo", textoAudiencia(s)));
    if (conProceso && p) li.append(nodo("p", "ayuda mono", p.radicado || p.despacho));
    li.append(nodo("p", "ayuda", `Lo dice: ${s.origen}`));
    const b = nodo("div", "botones");
    b.append(
      boton("Confirmar", "boton-cobre", async () => {
        if (await llamar("audiencia-guardar", { clave: s.clave, fecha: s.fecha, hora: s.hora, modalidad: s.modalidad, ref: s.ref })) {
          avisar("Audiencia en el calendario, con recordatorio un día y una hora antes.");
          await refrescar();
        }
      }),
      boton("Descartar", "boton-texto", async () => {
        if (await llamar("sugerencia-descartar", { clave: s.clave, fecha: s.fecha, hora: s.hora, ref: s.ref })) await refrescar();
      }),
    );
    li.append(b);
    ul.append(li);
  }
  return ul;
}

function listaAudiencias(lista, conAcciones = true, conProceso = false) {
  const ul = nodo("ul", "mis-audiencias");
  for (const a of lista) {
    const li = nodo("li", `mis-audiencia${a.fecha < hoy() ? " pasada" : ""}`);
    const p = proceso(a.clave);
    const fecha = nodo("div", "mis-audiencia-fecha");
    const [, mes, dia] = a.fecha.split("-");
    fecha.append(nodo("span", "mis-audiencia-dia", Number(dia)), nodo("span", "", MESES[Number(mes) - 1].slice(0, 3)));
    const textos = nodo("div", "mis-audiencia-textos");
    textos.append(nodo("p", "mis-evento-titulo", [a.hora || "Sin hora", a.modalidad && (a.modalidad === "virtual" ? "Virtual" : "Presencial")].filter(Boolean).join(", ")));
    if (conProceso && p) {
      const ir = boton(p.radicado || p.despacho || "Ver el proceso", "boton-texto mis-enlace mono", () => abrir(a.clave, { pestana: "audiencias" }));
      textos.append(ir);
    }
    if (a.lugar) textos.append(nodo("p", "ayuda", a.lugar));
    if (a.notas) textos.append(nodo("p", "ayuda", a.notas));
    li.append(fecha, textos);
    if (conAcciones) {
      const b = nodo("div", "botones");
      b.append(boton("Al calendario (.ics)", "boton-texto", () => exportarIcs([a.id])),
        boton("Quitar", "boton-texto", async () => {
          if (await llamar("audiencia-borrar", { id: a.id })) await refrescar();
        }));
      li.append(b);
    }
    ul.append(li);
  }
  return ul;
}

async function exportarIcs(ids = null) {
  const r = await llamar("ics", { ids });
  if (r && !r.cancelado) avisar(`${plural(r.total, "audiencia guardada", "audiencias guardadas")} en ${r.ruta}. Ábralo con Google Calendar u Outlook.`);
}

function pAudiencias(c) {
  const d = m.det;
  if (d.sugerencias.length) c.append(seccion("Sugeridas por las actuaciones", nodo("p", "ayuda", "Vigencia las leyó en el texto de las actuaciones. No se agregan solas: confirme cada una."), listaSugerencias(d.sugerencias)));
  c.append(seccion("Programadas", d.audiencias.length ? listaAudiencias(d.audiencias) : nodo("p", "ayuda", "No hay audiencias programadas.")));
  const f = nodo("form", "mis-forma");
  f.append(nodo("h3", "mis-seccion-titulo", "Programar una audiencia"));
  const fecha = entrada("date", "", { required: true });
  const hora = entrada("time", "");
  const modalidad = selector([["", "Sin definir"], ...MODALIDADES.map((x) => [x, x === "virtual" ? "Virtual" : "Presencial"])], "");
  const lugar = entrada("text", "", { placeholder: "Enlace de la audiencia o sala y dirección" });
  const notas = areaTexto("", "Notas (opcional)");
  const fila = nodo("div", "mis-forma-fila");
  fila.append(campo("Fecha", fecha), campo("Hora", hora), campo("Modalidad", modalidad));
  const enviar = boton("Programar", "boton-cobre", () => {});
  enviar.type = "submit";
  f.append(fila, campo("Enlace o lugar", lugar), campo("Notas", notas), enviar);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await llamar("audiencia-guardar", { clave: m.abierta, fecha: fecha.value, hora: hora.value, modalidad: modalidad.value, lugar: lugar.value, notas: notas.value })) {
      avisar("Audiencia programada, con recordatorio un día y una hora antes.");
      await refrescar();
    }
  });
  c.append(f);
}

// ---------- Documentos ----------

let vistaPdf = null;

async function verPdf(a, caja) {
  caja.hidden = false;
  caja.replaceChildren(nodo("p", "ayuda", `Abriendo ${a.nombre}.`));
  try {
    const info = await window.vigencia.pdfInfo(a.ruta);
    if (!info?.ok) throw new Error(info?.error || "No pude leer el PDF.");
    const doc = await archivo.abrir(a.ruta);
    if (!doc) return;
    const cab = nodo("div", "mis-lista-cabeza");
    cab.append(nodo("p", "ayuda", `${a.nombre}, ${plural(info.paginas, "página", "páginas")}`), boton("Cerrar la vista", "boton-texto", () => {
      caja.hidden = true;
      archivo.abrir(null);
    }));
    const paginas = nodo("div", "pv-paginas mis-paginas");
    caja.replaceChildren(cab, paginas);
    vistaPdf = crearVisor({ caja: paginas, clase: "pv-pagina" });
    vistaPdf.paginas = info.detalle;
    vistaPdf.zoom = vistaPdf.zoomAncho(0.3, 1.2, 28);
    vistaPdf.armar(doc, info.detalle);
    caja.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  } catch (error) {
    caja.replaceChildren(nodo("p", "ayuda error", error.message || "No pude mostrar el PDF."));
  }
}

function pDocumentos(c) {
  const d = m.det;
  const visor = nodo("div", "mis-visor");
  visor.hidden = true;
  const ul = nodo("ul", "mis-archivos");
  for (const a of d.archivos) {
    const li = nodo("li", `mis-archivo${a.existe ? "" : " falta"}`);
    li.append(nodo("p", "mis-evento-titulo", a.nombre), nodo("p", "ayuda", a.existe ? a.ruta : "No está en su lugar. Puede que lo hayan movido o borrado."));
    const b = nodo("div", "botones");
    if (a.existe) {
      if (/\.pdf$/i.test(a.nombre)) b.append(boton("Ver aquí", "boton-linea", () => verPdf(a, visor)));
      b.append(
        boton("Abrir", "boton-texto", () => llamar("archivo-abrir", { id: a.id })),
        boton("Mostrar en la carpeta", "boton-texto", () => llamar("archivo-abrir", { id: a.id, carpeta: true })),
        boton("Usar con la IA", "boton-texto", async () => {
          avisar("Convirtiendo en este computador.");
          const r = await llamar("archivo-ia", { id: a.id });
          if (r) {
            avisar("Quedó en el contexto del proyecto del proceso.");
            irA({ a: "documentos", proyectoId: r.proyectoId, contexto: true });
          }
        }),
      );
    }
    b.append(boton("Quitar de la lista", "boton-texto", async () => {
      if (await llamar("archivo-quitar", { id: a.id })) await refrescar();
    }));
    li.append(b);
    ul.append(li);
  }
  const agregar = boton("Agregar documentos", "boton-cobre", async () => {
    const r = await llamar("archivos-agregar", { clave: m.abierta });
    if (r?.agregados) {
      avisar(plural(r.agregados, "documento agregado", "documentos agregados"));
      await refrescar();
    }
  });
  c.append(seccion("Archivos del proceso", nodo("p", "ayuda", "PDF, Word o lo que necesite. Vigencia guarda dónde está cada archivo, no una copia: si lo mueve, vuelva a agregarlo."),
    d.archivos.length ? ul : nodo("p", "ayuda", "Todavía no hay archivos."), agregar, visor));
  const pl = nodo("ul", "mis-archivos");
  for (const p of d.proyectos) {
    const li = nodo("li", "mis-archivo");
    li.append(nodo("p", "mis-evento-titulo", p.nombre), nodo("p", "ayuda", `Actualizado el ${fechaCorta(String(p.actualizado_en).slice(0, 10))}`));
    li.append(boton("Abrir en Documentos", "boton-texto", () => irA({ a: "documentos", proyectoId: p.id })));
    pl.append(li);
  }
  const nuevo = boton(d.proyectos.length ? "Abrir el proyecto del proceso" : "Crear el proyecto del proceso", "boton-linea", async () => {
    const r = await llamar("proyecto", { clave: m.abierta });
    if (r) irA({ a: "documentos", proyectoId: r.proyectoId });
  });
  c.append(seccion("Proyectos de Documentos", d.proyectos.length ? pl : nodo("p", "ayuda", "Escritos y memoriales hechos con la IA para este proceso."), nuevo));
}

// ---------- Procesos manuales ----------

function formaManual(p = null) {
  const f = nodo("form", "mis-forma");
  f.append(nodo("h3", "mis-seccion-titulo", p ? "Datos del proceso" : "Nuevo proceso manual"),
    nodo("p", "ayuda", "Para procesos que no están en ningún sistema de consulta. Vigencia no los consulta: usted registra sus actuaciones."));
  const v = {
    radicado: entrada("text", p?.radicado, { placeholder: "Opcional", inputMode: "numeric" }),
    despacho: entrada("text", p?.despacho, { placeholder: "Juzgado, notaría, entidad" }),
    demandante: entrada("text", p?.demandante),
    demandado: entrada("text", p?.demandado),
    clase: entrada("text", p?.clase, { placeholder: "Por ejemplo: Sucesión, Ejecutivo" }),
    cliente: entrada("text", p?.cliente),
  };
  const clientes = m.datos?.clientes || [];
  const abogado = selector([["", "Sin abogado"], ...clientes.map((c) => [String(c.id), [c.nombre, c.apellidos].filter(Boolean).join(" ")])], String(p?.abogadoId ?? ""));
  const f1 = nodo("div", "mis-forma-fila");
  f1.append(campo("Radicado", v.radicado), campo("Despacho", v.despacho));
  const f2 = nodo("div", "mis-forma-fila");
  f2.append(campo("Demandante", v.demandante), campo("Demandado", v.demandado));
  const f3 = nodo("div", "mis-forma-fila");
  f3.append(campo("Clase", v.clase), campo("Cliente", v.cliente), campo("Abogado", abogado));
  const b = nodo("div", "botones");
  const guardar = boton(p ? "Guardar" : "Crear proceso", "boton-cobre", () => {});
  guardar.type = "submit";
  b.append(guardar, boton("Cancelar", "boton-texto", () => {
    if (p) {
      m.editar = false;
      pintarPanel();
    } else cerrarPanel();
  }));
  f.append(f1, f2, f3, b);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const dato = Object.fromEntries(Object.entries(v).map(([k, el]) => [k, el.value]));
    const r = await llamar("manual-guardar", { ...dato, cliente_id: abogado.value || null, id: p ? Number(p.ref) : null });
    if (r) {
      avisar(p ? "Datos guardados." : "Proceso creado. Ya puede registrar sus actuaciones.");
      m.editar = false;
      m.abierta = r.clave;
      await refrescar(p ? null : "actuaciones");
    }
  });
  return f;
}

function nuevoManual() {
  elegirVista("procesos");
  m.abierta = "";
  m.det = null;
  $("mis-panel").hidden = false;
  $("mis-dos").classList.add("con-panel");
  $("mis-panel").replaceChildren(formaManual());
  $("mis-panel").querySelector("input")?.focus();
}

// ---------- Calendario ----------

function audienciasDe(fecha) {
  return m.datos.audiencias.filter((a) => a.fecha === fecha).sort((x, y) => (x.hora || "").localeCompare(y.hora || ""));
}

function chipAudiencia(a) {
  const p = proceso(a.clave);
  const b = nodo("button", `mis-cal-evento ${a.modalidad || "sin"}`, `${a.hora || "Todo el día"} ${p?.radicado ? p.radicado.slice(-11, -2) : p?.despacho || ""}`.trim());
  b.type = "button";
  b.title = [textoAudiencia(a), p?.radicado, p?.despacho, a.lugar].filter(Boolean).join(", ");
  b.addEventListener("click", () => {
    elegirVista("procesos");
    abrir(a.clave, { pestana: "audiencias" });
  });
  return b;
}

function moverCalendario(n) {
  const [a, mes, d] = m.cal.ancla.split("-").map(Number);
  const f = m.cal.modo === "mes" ? new Date(a, mes - 1 + n, 1) : new Date(a, mes - 1, d + 7 * n);
  m.cal.ancla = isoDia(f);
  pintarCalendario();
}

function pintarCalendario() {
  if (!m.datos) return;
  const caja = $("mis-calendario");
  const [a, mes] = m.cal.ancla.split("-").map(Number);
  const barra = nodo("div", "mis-cal-barra");
  const anterior = boton("Anterior", "boton-texto", () => moverCalendario(-1));
  const siguiente = boton("Siguiente", "boton-texto", () => moverCalendario(1));
  const dias = diasDeSemana(m.cal.ancla);
  const nombreMes = MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1);
  const titulo = m.cal.modo === "mes" ? `${nombreMes} de ${a}` : `Semana del ${fechaCorta(dias[0])} al ${fechaCorta(dias[6])}`;
  const modos = nodo("div", "mis-filtro-linea");
  for (const [id, nombre] of [["mes", "Mes"], ["semana", "Semana"]]) {
    const b = nodo("button", `mis-chip${m.cal.modo === id ? " elegido" : ""}`, nombre);
    b.type = "button";
    b.setAttribute("aria-pressed", m.cal.modo === id ? "true" : "false");
    b.addEventListener("click", () => { m.cal.modo = id; pintarCalendario(); });
    modos.append(b);
  }
  const t = nodo("h2", "mis-subtitulo mis-cal-titulo", titulo);
  t.setAttribute("aria-live", "polite");
  barra.append(anterior, t, siguiente, boton("Hoy", "boton-texto", () => { m.cal.ancla = hoy(); pintarCalendario(); }), modos);
  const rejilla = nodo("div", `mis-cal ${m.cal.modo}`);
  rejilla.setAttribute("role", "grid");
  rejilla.setAttribute("aria-label", titulo);
  const cab = nodo("div", "mis-cal-semana cabeza");
  cab.setAttribute("role", "row");
  for (const dn of DIAS) {
    const c = nodo("div", "mis-cal-dia-nombre", dn);
    c.setAttribute("role", "columnheader");
    cab.append(c);
  }
  rejilla.append(cab);
  const semanas = m.cal.modo === "mes" ? mesCalendario(a, mes) : [dias.map((f) => ({ fecha: f, dia: Number(f.slice(8)), delMes: true }))];
  for (const semana of semanas) {
    const fila = nodo("div", "mis-cal-semana");
    fila.setAttribute("role", "row");
    for (const d of semana) {
      const celda = nodo("div", `mis-cal-dia${d.delMes ? "" : " fuera"}${d.fecha === hoy() ? " hoy" : ""}`);
      celda.setAttribute("role", "gridcell");
      celda.append(nodo("span", "mis-cal-numero", d.dia));
      for (const au of audienciasDe(d.fecha)) celda.append(chipAudiencia(au));
      fila.append(celda);
    }
    rejilla.append(fila);
  }
  caja.replaceChildren(barra, rejilla);
  const lado = $("mis-proximas");
  const prox = proximasAudiencias(m.datos.audiencias, hoy(), 12);
  lado.replaceChildren(nodo("h2", "mis-subtitulo", "Próximas audiencias"));
  lado.append(prox.length ? listaAudiencias(prox, false, true) : nodo("p", "ayuda", "No hay audiencias programadas. Prográmelas en cada proceso o confirme las sugeridas."));
  if (prox.length) lado.append(boton("Todas al calendario (.ics)", "boton-linea", () => exportarIcs()));
  if (m.datos.sugerencias.length) {
    lado.append(nodo("h2", "mis-subtitulo", "Sugeridas por las actuaciones"), nodo("p", "ayuda", "Confírmelas con un clic. No se agregan solas."), listaSugerencias(m.datos.sugerencias, true));
  }
}

// ---------- Inicio ----------

export function iniciarMisProcesos() {
  $("mis-buscar").addEventListener("input", () => { m.filtro.texto = $("mis-buscar").value; elegirVista("procesos"); });
  for (const [id, k] of [["mis-fuente", "fuente"], ["mis-abogado", "abogado"], ["mis-despacho", "despacho"], ["mis-estado", "estado"]]) {
    $(id).addEventListener("change", () => cambiarFiltro({ [k]: $(id).value }));
  }
  $("mis-tab-procesos").addEventListener("click", () => elegirVista("procesos"));
  $("mis-tab-calendario").addEventListener("click", () => elegirVista("calendario"));
  $("mis-nuevo").addEventListener("click", nuevoManual);
  $("mis-recargar").addEventListener("click", recargar);
  $("mis-excel").addEventListener("click", async () => {
    const claves = m.datos ? filtrarProcesos(m.datos.procesos, m.filtro).map((p) => p.clave) : [];
    const r = await llamar("exportar", { claves });
    if (r && !r.cancelado) avisar(`${plural(r.total, "proceso", "procesos")} en ${r.ruta}`);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("pantalla-mis").hidden && !$("mis-panel").hidden && !document.querySelector("dialog[open]")) cerrarPanel();
  });
}
