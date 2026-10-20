// Estados: el listado de estado del juzgado (PDF, Excel, Word o HTML) como
// tabla que se ordena, se filtra y se corrige a mano, con el PDF al lado y
// la fila resaltada en su página. Cruza los radicados con Mis procesos:
// las filas de los que ya sigue quedan como historia de esos procesos, y
// los demás se pueden seguir uno a uno o varios a la vez. La lectura es de
// compartido/estados.js (proceso principal).
import { COLUMNAS, filtrarFilas, marcarSeguidos, normalizarRadicadoEstado, ordenarFilas } from "../compartido/estados.js";
import { pdfACaja, tamanoVista } from "../compartido/pdftools.js";
import { avisar } from "./aviso.js";
import { boton, crearEscena, zonaVacia } from "./escena.js";
import { crearVisor, docUnico } from "./paginas.js";
import { estado, nodo, ofrecerLlevar } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const EXT = /\.(pdf|xlsx|xls|ods|csv|docx|html?)$/i;
const EDITABLES = new Set(["clase", "demandante", "demandado", "actuacion", "anotacion", "fecha", "cuaderno", "folios"]);
const CONFIANZA = { media: "Revisar", baja: "Dudosa" };
const ETIQUETA_ARMADO = { armado: "Armado, no viene en el PDF", supuesto: "Supuesto, revíselo", verificado: "Armado y verificado en la consulta" };

// El radicado supuesto no se agrega hasta verificarlo o corregirlo.
const sePuedeSeguir = (f) => Boolean(f?.radicado) && f.radicadoArmado !== "supuesto";

async function verificar(f) {
  const fila = original(f);
  if (!fila?.radicado) return;
  const r = await window.vigencia.estadosVerificar(fila.radicado);
  if (!r?.ok) {
    avisar(r?.error || "No pude consultar la Rama.", "error");
    return;
  }
  if (!r.existe) {
    avisar("La consulta de la Rama no tiene ese radicado. Revise el juzgado o corrija el número.", "error");
    return;
  }
  fila.radicadoArmado = "verificado";
  fila.radicadoNota = r.despacho ? `Verificado en la consulta: ${r.despacho}.` : "Verificado en la consulta.";
  if (fila.confianza === "baja") fila.confianza = "media";
  avisar("El radicado existe en la consulta de la Rama.");
  pintarTabla();
}

const e = {
  lotes: [],
  seguidos: new Set(),
  filtro: { texto: "", soloSeguidos: false, soloAvisos: false },
  orden: { campo: "id", sentido: 1 },
  activa: null,
  verPdf: true,
  loteVisto: null,
  capas: new Map(),
  elegidas: new Set(),
};
let es = null;
let vista = null;
const archivo = docUnico();
let siguiente = 1;

// ---------- Archivos ----------

async function elegir() {
  const r = await window.vigencia.estadosElegir();
  if (r?.ok && r.rutas?.length) await agregar(r.rutas);
}

async function agregar(rutas) {
  const nuevas = rutas.filter((r) => EXT.test(r) && !e.lotes.some((l) => l.ruta === r));
  if (!nuevas.length) return;
  await es.trabajando(nuevas.length === 1 ? "Leyendo el estado." : `Leyendo ${nuevas.length} estados.`, async () => {
    for (const ruta of nuevas) {
      const r = await window.vigencia.estadosLeer(ruta);
      if (!r?.ok) {
        estado("pdf-estados-estado", r?.error || "No pude leer ese estado.", true);
        avisar(r?.error || "No pude leer ese estado.", "error");
        continue;
      }
      const lote = { ...r, clave: siguiente++, info: null };
      if (/\.pdf$/i.test(ruta)) {
        const info = await window.vigencia.pdfInfo(ruta);
        if (info?.ok) lote.info = info;
      }
      e.lotes.push(lote);
      estado("pdf-estados-estado", "");
    }
  });
  await refrescarSeguidos();
  await guardarSeguidos(e.lotes.filter((l) => nuevas.includes(l.ruta)));
  pintar();
  const ultimo = e.lotes[e.lotes.length - 1];
  if (ultimo) {
    avisar(`${plural(ultimo.filas.length, "fila leída", "filas leídas")} de ${ultimo.nombre}.`);
    ofrecerTabla(ultimo);
  }
}

function limpiar() {
  e.lotes = [];
  e.elegidas = new Set();
  e.activa = null;
  e.loteVisto = null;
  archivo.abrir(null);
  pintar();
}

// Usar con la IA recibe la tabla en Markdown, no el PDF crudo.
async function ofrecerTabla(lote) {
  const r = await window.vigencia.estadosMarkdown({ nombre: lote.nombre, meta: lote.meta, filas: lote.filas });
  if (r?.ok) ofrecerLlevar(r.ruta, { como: "tabla", nombre: `${lote.nombre.replace(/\.[^.]+$/, "")} (tabla)` });
}

// Radicados de todo lo que el usuario sigue (Mis procesos).
export async function refrescarSeguidos() {
  try {
    const r = await window.vigencia.mis("radicados");
    e.seguidos = new Set(r?.ok ? r.radicados : []);
  } catch {
    e.seguidos = new Set();
  }
  for (const lote of e.lotes) lote.filas = marcarSeguidos(lote.filas, e.seguidos);
  if (e.lotes.length) pintarTabla();
}

// Las filas de los procesos que ya sigue quedan como su historia en Mis
// procesos (sin repetir radicado, fecha del auto y actuación).
async function guardarSeguidos(lotes) {
  let nuevas = 0;
  for (const l of lotes) {
    const filas = l.filas.filter((f) => f.seguido);
    if (!filas.length) continue;
    const r = await window.vigencia.mis("estados-guardar", { filas, meta: l.meta, crear: false });
    if (r?.ok) nuevas += r.nuevas;
  }
  if (nuevas) avisar(`${plural(nuevas, "actuación nueva guardada", "actuaciones nuevas guardadas")} en Mis procesos.`);
}

// Seguir: el proceso queda en Mis procesos con fuente Estados y la fila del
// estado como su primera actuación. Sin consultar ningún sistema.
async function seguirFilas(filas) {
  const porLote = new Map();
  for (const f of filas) {
    const fila = original(f);
    if (!sePuedeSeguir(fila)) continue;
    if (!porLote.has(f.lote)) porLote.set(f.lote, []);
    porLote.get(f.lote).push(fila);
  }
  let procesos = 0;
  let ultima = "";
  for (const [clave, lista] of porLote) {
    const lote = e.lotes.find((l) => l.clave === clave);
    const r = await window.vigencia.mis("estados-guardar", { filas: lista, meta: lote?.meta || {}, crear: true });
    if (!r?.ok) {
      avisar(r?.error || "No pude agregarlos.", "error");
      continue;
    }
    procesos += r.procesos;
    ultima = r.claves.at(-1) || ultima;
  }
  e.elegidas = new Set();
  await refrescarSeguidos();
  pintarElegidas();
  if (procesos || ultima) {
    avisar(procesos ? `${plural(procesos, "proceso agregado", "procesos agregados")} a Mis procesos.` : "Ya estaba en Mis procesos: se guardó la fila del estado.");
    estado("pdf-estados-estado", "Quedaron en Mis procesos, con la fila del estado como actuación.");
  }
  return ultima;
}

function seguir(fila) {
  if (sePuedeSeguir(fila)) seguirFilas([fila]);
}

function pintarElegidas() {
  if (!e.botonVarios) return;
  const n = e.elegidas.size;
  e.botonVarios.textContent = n ? `Agregar los seleccionados (${n})` : "Agregar los seleccionados";
  e.botonVarios.disabled = !n;
}

async function exportar(formato) {
  const lotes = e.lotes.map((l) => ({ nombre: l.nombre, meta: l.meta, filas: l.filas }));
  const r = await window.vigencia.estadosExportar(formato, lotes);
  if (r?.cancelado) return;
  if (!r?.ok) {
    estado("pdf-estados-estado", r?.error || "No pude exportar.", true);
    return;
  }
  estado("pdf-estados-estado", `${plural(r.filas, "fila guardada", "filas guardadas")}.`);
  avisar(formato === "csv" ? "CSV guardado." : "Excel guardado.");
}

// ---------- Vista ----------

function todas() {
  return e.lotes.flatMap((l) => l.filas.map((f) => ({ ...f, lote: l.clave, clave: `${l.clave}-${f.id}` })));
}

function columnasVisibles() {
  const usadas = new Set(["radicado", "actuacion", "fecha"]);
  for (const l of e.lotes) for (const c of l.columnas || []) usadas.add(c);
  return COLUMNAS.filter((c) => usadas.has(c.id));
}

function pintar() {
  const hay = e.lotes.length > 0;
  $("pdf-estados-excel").disabled = !hay;
  $("pdf-estados-csv").disabled = !hay;
  $("pdf-estados-limpiar").hidden = !hay;
  $("pdf-estados-nombre").textContent = hay
    ? e.lotes.map((l) => `${l.nombre}: ${plural(l.filas.length, "fila", "filas")}`).join("; ")
    : "Ningún estado elegido.";
  es.barra.hidden = !hay;
  if (!hay) {
    es.cuerpo.replaceChildren(zonaVacia({
      ilustracion: "estados",
      titulo: "Suelte aquí los estados del juzgado",
      texto: "El listado de estado en PDF, o el mismo estado en Excel, Word o HTML. Puede soltar varios a la vez.",
      boton: "Elegir estados",
      alElegir: elegir,
      alSoltar: agregar,
      filtro: rutasEstado,
    }));
    vista = null;
    return;
  }
  const hayPdf = e.lotes.some((l) => l.info);
  const conPdf = e.verPdf && hayPdf;
  pintarBarra(hayPdf);
  const resumen = nodo("div", "pv-est-resumen");
  for (const l of e.lotes) resumen.append(tarjetaLote(l));
  const dos = nodo("div", `pv-estados${conPdf ? "" : " sin-pdf"}`);
  const tabla = nodo("div", "pv-est-tabla");
  tabla.setAttribute("role", "region");
  tabla.setAttribute("aria-label", "Tabla del estado");
  tabla.tabIndex = 0;
  e.cajaTabla = tabla;
  const lado = nodo("aside", "pv-est-vista");
  lado.setAttribute("aria-label", "PDF del estado");
  lado.hidden = !conPdf;
  e.titulo = nodo("p", "ayuda pv-est-vista-titulo", "Toque una fila para verla en su página.");
  const paginas = nodo("div", "pv-paginas pv-est-paginas");
  lado.append(e.titulo, paginas);
  dos.append(tabla, lado);
  es.cuerpo.replaceChildren(resumen, dos);
  e.capas = new Map();
  e.loteVisto = null;
  vista = crearVisor({
    caja: paginas,
    clase: "pv-pagina",
    envolver: (canvas, n, geo) => {
      const env = nodo("div", "pv-pagina-envoltura");
      const t = tamanoVista(geo);
      const svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "pv-capa pv-est-capa");
      svg.setAttribute("viewBox", `0 0 ${t.ancho} ${t.alto}`);
      svg.setAttribute("preserveAspectRatio", "none");
      e.capas.set(n, { svg, geo });
      env.append(canvas, svg);
      return env;
    },
  });
  pintarTabla();
  const primero = e.lotes.find((l) => l.info);
  if (primero && conPdf) mostrarLote(primero);
}

function tarjetaLote(l) {
  const t = nodo("section", "pv-est-lote");
  const m = l.meta || {};
  const titulo = [m.estado ? `Estado No. ${m.estado}` : "Estado", m.fecha ? `del ${m.fecha}` : ""].filter(Boolean).join(" ");
  const textos = nodo("div", "pv-est-lote-textos");
  textos.append(nodo("p", "pv-archivo-nombre", titulo), nodo("p", "ayuda", [m.juzgado, l.nombre].filter(Boolean).join(", ")));
  const cifras = nodo("div", "pv-cifras");
  const seguidas = l.filas.filter((f) => f.seguido).length;
  const conAvisos = l.filas.filter((f) => f.avisos.length).length;
  cifras.append(nodo("span", "pv-cifra", plural(l.filas.length, "fila", "filas")));
  if (seguidas) cifras.append(nodo("span", "pv-cifra agregado", plural(seguidas, "que usted sigue", "que usted sigue")));
  if (conAvisos) cifras.append(nodo("span", "pv-cifra quitado", plural(conAvisos, "para revisar", "para revisar")));
  if (l.tipo === "ocr" || l.tipo === "texto") cifras.append(nodo("span", "pv-cifra cambiado", l.tipo === "ocr" ? "Leído con OCR" : "Sin columnas"));
  t.append(textos, cifras);
  const extra = [...(l.avisos || []), l.aviso].filter(Boolean);
  if (extra.length) t.append(nodo("p", "ayuda error", extra.join(" ")));
  if (l.notas?.length) {
    const d = nodo("details", "pv-est-notas");
    d.append(nodo("summary", "", `Texto del estado fuera de la tabla (${l.notas.length})`));
    for (const n of l.notas) d.append(nodo("p", "ayuda", `Página ${n.pagina}: ${n.texto || n.aviso}`));
    t.append(d);
  }
  return t;
}

function pintarBarra(hayPdf) {
  const buscar = document.createElement("input");
  buscar.type = "search";
  buscar.className = "campo pv-est-buscar";
  buscar.placeholder = "Buscar en el estado";
  buscar.setAttribute("aria-label", "Buscar en el estado");
  buscar.value = e.filtro.texto;
  buscar.addEventListener("input", () => {
    e.filtro.texto = buscar.value;
    pintarTabla();
  });
  const casilla = (texto, clave) => {
    const l = nodo("label", "casilla");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = e.filtro[clave];
    c.addEventListener("change", () => {
      e.filtro[clave] = c.checked;
      pintarTabla();
    });
    l.append(c, nodo("span", "", texto));
    return l;
  };
  e.cuenta = nodo("span", "ayuda pv-est-cuenta", "");
  const ver = boton(e.verPdf ? "Ocultar PDF" : "Ver PDF", "boton-texto", () => {
    e.verPdf = !e.verPdf;
    pintar();
  });
  ver.setAttribute("aria-pressed", String(e.verPdf));
  ver.hidden = !hayPdf;
  e.botonVarios = boton("Agregar los seleccionados", "boton-linea", () => seguirFilas(todas().filter((f) => e.elegidas.has(f.clave))));
  e.botonVarios.title = "Los agrega a Mis procesos con la fila del estado como actuación";
  pintarElegidas();
  es.barra.replaceChildren(buscar, casilla("Solo los que sigo", "soloSeguidos"), casilla("Solo para revisar", "soloAvisos"), e.cuenta, e.botonVarios, ver);
}

function pintarTabla() {
  if (!e.cajaTabla) return;
  const cols = columnasVisibles();
  const varios = e.lotes.length > 1;
  const filas = ordenarFilas(filtrarFilas(todas(), e.filtro), e.orden.campo, e.orden.sentido);
  const total = e.lotes.reduce((n, l) => n + l.filas.length, 0);
  if (e.cuenta) e.cuenta.textContent = filas.length === total ? plural(total, "fila", "filas") : `${filas.length} de ${total} filas`;
  const t = nodo("table", "pv-est");
  const cab = nodo("thead", "");
  const tr = nodo("tr", "");
  const titulo = (id, texto) => {
    const th = nodo("th", "");
    th.scope = "col";
    if (!id) {
      th.textContent = texto;
      return th;
    }
    const activo = e.orden.campo === id;
    th.setAttribute("aria-sort", activo ? (e.orden.sentido > 0 ? "ascending" : "descending") : "none");
    const b = boton(texto, "pv-est-orden", () => {
      e.orden = { campo: id, sentido: activo ? -e.orden.sentido : 1 };
      pintarTabla();
    });
    b.title = `Ordenar por ${texto.toLowerCase()}`;
    if (activo) b.classList.add(e.orden.sentido > 0 ? "sube" : "baja");
    th.append(b);
    return th;
  };
  tr.append(titulo("id", "No."));
  if (varios) tr.append(titulo("", "Estado"));
  for (const c of cols) tr.append(titulo(c.id, c.nombre));
  tr.append(titulo("", "Seguimiento"));
  cab.append(tr);
  const cuerpo = nodo("tbody", "");
  for (const f of filas) cuerpo.append(...filaTabla(f, cols, varios));
  t.append(cab, cuerpo);
  if (!filas.length) {
    const vacio = nodo("tr", "");
    const td = nodo("td", "ayuda pv-est-nada", "Ninguna fila con ese filtro.");
    td.colSpan = cols.length + 2 + (varios ? 1 : 0);
    vacio.append(td);
    cuerpo.append(vacio);
  }
  e.cajaTabla.replaceChildren(t);
}

function original(f) {
  return e.lotes.find((l) => l.clave === f.lote)?.filas.find((x) => x.id === f.id);
}

function filaTabla(f, cols, varios) {
  const tr = nodo("tr", `pv-est-fila confianza-${f.confianza}${f.seguido ? " seguido" : ""}${e.activa === f.clave ? " activa" : ""}`);
  tr.dataset.clave = f.clave;
  tr.addEventListener("click", (ev) => {
    if (ev.target.closest("button")) return;
    activar(f);
  });
  const num = nodo("td", "pv-est-num");
  num.append(nodo("span", "", String(f.id)));
  if (CONFIANZA[f.confianza]) {
    const b = nodo("span", `pv-est-confianza ${f.confianza}`, CONFIANZA[f.confianza]);
    b.title = f.avisos.join(" ");
    num.append(b);
  }
  tr.append(num);
  if (varios) {
    const l = e.lotes.find((x) => x.clave === f.lote);
    tr.append(nodo("td", "ayuda", l?.meta?.estado ? `No. ${l.meta.estado}${l.meta.fecha ? `, ${l.meta.fecha}` : ""}` : l?.nombre || ""));
  }
  for (const c of cols) tr.append(celda(f, c));
  const seg = nodo("td", "pv-est-seguir");
  if (f.seguido) seg.append(nodo("span", "pv-est-sigue", "Usted sigue este proceso"));
  else if (sePuedeSeguir(f)) {
    const l = nodo("label", "pv-est-elegir");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = e.elegidas.has(f.clave);
    c.setAttribute("aria-label", `Elegir la fila ${f.id} para agregarla`);
    c.addEventListener("change", () => {
      if (c.checked) e.elegidas.add(f.clave);
      else e.elegidas.delete(f.clave);
      pintarElegidas();
    });
    l.append(c);
    const b = boton("Seguir este proceso", "boton-linea pv-est-boton", () => seguir(f));
    b.title = "Lo agrega a Mis procesos con la fila del estado como actuación";
    seg.append(l, b);
  }
  tr.append(seg);
  const salida = [tr];
  if (f.avisos.length) {
    const av = nodo("tr", "pv-est-aviso");
    const td = nodo("td", "");
    td.colSpan = cols.length + 2 + (varios ? 1 : 0);
    td.textContent = `Revisar: ${f.avisos.join(" ")}`;
    av.append(td);
    salida.push(av);
  }
  return salida;
}

function celda(f, c) {
  const td = nodo("td", `pv-est-${c.id}`);
  if (c.id === "radicado") {
    const texto = nodo("span", "pv-est-editable", f.radicadoTexto || f.radicado);
    editable(texto, f, "radicadoTexto", `Radicado de la fila ${f.id}`);
    td.append(texto);
    const num = nodo("span", `pv-est-rad23${f.radicado ? "" : " falta"}${f.radicadoArmado ? ` armado ${f.radicadoArmado}` : ""}`, f.radicado || "Sin los 23 dígitos");
    if (f.radicadoNota) num.title = f.radicadoNota;
    td.append(num);
    // Armado con el juzgado del estado: se marca para no confundirlo con uno
    // leído del PDF, y se puede verificar con una consulta a la Rama.
    if (f.radicadoArmado) {
      td.append(nodo("span", "pv-est-armado", ETIQUETA_ARMADO[f.radicadoArmado] || ""));
      if (f.radicadoArmado !== "verificado") td.append(boton("Verificar en la consulta", "boton-linea pv-est-boton", () => verificar(f)));
    }
    return td;
  }
  const span = nodo("span", "pv-est-editable", f[c.id] || "");
  if (EDITABLES.has(c.id)) editable(span, f, c.id, `${c.nombre} de la fila ${f.id}`);
  td.append(span);
  return td;
}

// Corregir a mano: lo editado se guarda en la fila y sale así al exportar.
function editable(el, f, campo, etiqueta) {
  el.contentEditable = "plaintext-only";
  el.spellcheck = false;
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", etiqueta);
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      el.blur();
    }
  });
  el.addEventListener("blur", () => {
    const fila = original(f);
    if (!fila) return;
    const valor = el.textContent.replace(/\s+/g, " ").trim();
    if (valor === (fila[campo] || "")) return;
    fila[campo] = valor;
    fila.editada = true;
    if (campo === "radicadoTexto") {
      const r = normalizarRadicadoEstado(valor);
      fila.radicado = r.numero;
      fila.radicadoNota = r.nota;
      fila.radicadoArmado = "";
      fila.seguido = Boolean(r.numero) && e.seguidos.has(r.numero);
    }
    pintarTabla();
  });
}

// ---------- PDF al lado, con la fila resaltada ----------

async function mostrarLote(l) {
  if (!vista || !l?.info) return false;
  if (e.loteVisto === l.clave) return true;
  e.loteVisto = l.clave;
  e.capas = new Map();
  const doc = await archivo.abrir(l.ruta);
  if (!doc || e.loteVisto !== l.clave) return false;
  vista.paginas = l.info.detalle;
  vista.zoom = vista.zoomAncho(0.3, 1.2, 28);
  vista.armar(doc, l.info.detalle);
  e.titulo.textContent = `${l.nombre}. Toque una fila para verla en su página.`;
  return true;
}

async function activar(f) {
  e.activa = f.clave;
  for (const tr of e.cajaTabla.querySelectorAll("tr.activa")) tr.classList.remove("activa");
  e.cajaTabla.querySelector(`tr[data-clave="${f.clave}"]`)?.classList.add("activa");
  const l = e.lotes.find((x) => x.clave === f.lote);
  if (!e.verPdf || !l?.info) {
    if (e.titulo) e.titulo.textContent = l?.info ? "" : "Esta fila no viene de un PDF: no hay página para mostrar.";
    return;
  }
  if (!(await mostrarLote(l))) return;
  for (const { svg } of e.capas.values()) svg.replaceChildren();
  const caja = f.caja;
  const capa = caja && e.capas.get(caja.pagina);
  e.titulo.textContent = caja ? `Fila ${f.id}, página ${caja.pagina} de ${l.info.paginas}.` : `Fila ${f.id}: sin lugar en la página.`;
  if (!capa) return;
  const v = pdfACaja(caja, capa.geo);
  const rect = document.createElementNS(SVGNS, "rect");
  for (const [k, valor] of Object.entries({ x: v.x, y: v.y, width: v.w, height: v.h, rx: 3 })) rect.setAttribute(k, String(valor));
  rect.setAttribute("class", "pv-est-resalte");
  capa.svg.append(rect);
  // La página y luego la fila, centrada en la vista.
  const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
  vista.irA(caja.pagina);
  const raiz = e.capas.get(caja.pagina).svg.closest(".pv-paginas");
  const lienzo = vista.lienzos[caja.pagina - 1];
  if (raiz && lienzo) {
    const escala = lienzo.getBoundingClientRect().height / tamanoVista(capa.geo).alto;
    const arriba = raiz.scrollTop + lienzo.getBoundingClientRect().top - raiz.getBoundingClientRect().top + v.y * escala - raiz.clientHeight / 3;
    raiz.scrollTo({ top: Math.max(0, arriba), behavior: quieto ? "auto" : "smooth" });
  }
}

function rutasEstado(ev) {
  return [...(ev.dataTransfer?.files || [])].map((f) => window.vigencia.rutaDeArchivo(f)).filter((r) => EXT.test(r || ""));
}

export function iniciarEstadosPdf() {
  es = crearEscena("estados", {
    titulo: "Estados",
    ayuda: "El estado del juzgado como tabla: ordene, filtre, corrija y vea cuáles procesos sigue.",
    llena: true,
    alSoltar: agregar,
    filtro: rutasEstado,
  });
  $("pdf-elegir-estados").addEventListener("click", elegir);
  $("pdf-estados-limpiar").addEventListener("click", limpiar);
  $("pdf-estados-excel").addEventListener("click", () => exportar("xls"));
  $("pdf-estados-csv").addEventListener("click", () => exportar("csv"));
  $("pdf-tab-estados").addEventListener("click", () => refrescarSeguidos());
  pintar();
}
