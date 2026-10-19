// Rellenar: el formulario se ve con el visor de páginas (renderer/paginas.js)
// y cada campo es un control de verdad encima de su lugar. La capa es un SVG
// con viewBox en puntos de la página (zoom 1) y un foreignObject por caja,
// así el zoom la escala sola y no hace falta ningún estilo en línea (CSP).
// pdfACaja (compartido/pdftools.js) pasa el /Rect del PDF a esa caja. La
// lista de la derecha y la capa muestran los mismos valores.
import { pdfACaja, tamanoVista } from "../compartido/pdftools.js";
import { boton, correr, crearEscena, terminar, zonaVacia } from "./escena.js";
import { crearVisor, docUnico } from "./paginas.js";
import { alAbrir, elegirUno, estado, nodo, pdf, ponerUno } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const r = { info: null, archivo: docUnico(), campos: [], valores: new Map(), activo: "", aviso: "" };
let er = null;
let vista = null;

async function abrirRellenar(info) {
  Object.assign(r, { info, campos: [], valores: new Map(), activo: "", aviso: "" });
  er.mostrarPie();
  if (!info) return pintarRellenar();
  const c = await window.vigencia.pdfCampos(pdf.rellenar);
  if (r.info !== info) return;
  if (c?.ok) {
    r.campos = c.campos || [];
    for (const campo of r.campos) r.valores.set(campo.nombre, valorInicial(campo));
    estado("pdf-rellenar-estado", "");
  } else {
    r.aviso = c?.error || "No pude leer los campos.";
    estado("pdf-rellenar-estado", r.aviso, true);
  }
  pintarRellenar();
  try {
    const doc = await r.archivo.abrir(pdf.rellenar);
    if (!doc || r.info !== info) return;
    vista.paginas = info.detalle;
    vista.zoom = vista.zoomAncho(0.5, 1.6, 48);
    vista.armar(doc, info.detalle);
    pintarZoom();
  } catch (error) {
    estado("pdf-rellenar-estado", error?.message || "No pude abrir el PDF.", true);
  }
}

function valorInicial(campo) {
  if (campo.tipo === "casilla") return false;
  if (campo.tipo === "lista-multiple") return [];
  return campo.actual || "";
}

const lleno = (v) => (Array.isArray(v) ? v.length > 0 : v === true || (typeof v === "string" && v.trim() !== ""));

// ---------- Controles: el mismo campo en la capa y en la lista ----------

function opcion(valor, etiqueta) {
  const o = document.createElement("option");
  o.value = valor;
  o.textContent = etiqueta;
  return o;
}

function control(campo, { caja = null, enCapa = false } = {}) {
  const nombre = campo.nombre;
  let el;
  if (campo.tipo === "casilla") {
    el = document.createElement("input");
    el.type = "checkbox";
  } else if (campo.tipo === "opcion" && enCapa) {
    el = document.createElement("input");
    el.type = "radio";
    el.name = `pv-radio-${r.campos.indexOf(campo)}`;
    el.value = caja?.valor || "";
  } else if (campo.tipo === "lista" || campo.tipo === "opcion") {
    el = document.createElement("select");
    el.replaceChildren(opcion("", "Sin elegir"), ...(campo.opciones || []).map((o) => opcion(o, o)));
  } else if (campo.tipo === "lista-multiple") {
    el = document.createElement("select");
    el.multiple = true;
    el.replaceChildren(...(campo.opciones || []).map((o) => opcion(o, o)));
  } else if (campo.multilinea) {
    el = document.createElement("textarea");
    el.maxLength = 2000;
  } else {
    el = document.createElement("input");
    el.maxLength = 500;
    el.autocomplete = "off";
  }
  el.dataset.campo = nombre;
  el.setAttribute("aria-label", enCapa ? `${nombre}${campo.tipo === "opcion" && caja?.valor ? `: ${caja.valor}` : ""}` : nombre);
  el.className = enCapa ? "pv-campo-sobre" : "pv-campo-lista";
  const evento = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio" ? "change" : "input";
  el.addEventListener(evento, () => {
    r.valores.set(nombre, leer(el, campo));
    sincronizar(nombre, el);
    pintarCuenta();
  });
  el.addEventListener("focus", () => activar(nombre, enCapa ? "capa" : "lista", el));
  escribir(el, r.valores.get(nombre));
  return el;
}

function leer(el, campo) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "radio") return el.checked ? el.value : r.valores.get(campo.nombre);
  if (el.multiple) return [...el.selectedOptions].map((o) => o.value);
  return el.value;
}

function escribir(el, valor) {
  if (el.type === "checkbox") el.checked = Boolean(valor);
  else if (el.type === "radio") el.checked = valor === el.value && valor !== "";
  else if (el.multiple) for (const o of el.options) o.selected = (valor || []).includes(o.value);
  else el.value = valor ?? "";
}

function delCampo(nombre) {
  return [...er.raiz.querySelectorAll("[data-campo]")].filter((x) => x.dataset.campo === nombre);
}

function sincronizar(nombre, origen) {
  const valor = r.valores.get(nombre);
  for (const el of delCampo(nombre)) if (el !== origen && el.tagName !== "DIV" && el.tagName !== "LI") escribir(el, valor);
  const fila = r.lista?.querySelector(`li[data-fila="${CSS.escape(nombre)}"]`);
  fila?.classList.toggle("lleno", lleno(valor));
}

// El campo en uso se resalta en la capa y en la lista, y la otra se mueve
// hasta él.
function activar(nombre, desde, el) {
  if (r.activo === nombre) return;
  r.activo = nombre;
  for (const x of er.raiz.querySelectorAll(".activo")) x.classList.remove("activo");
  for (const fo of er.raiz.querySelectorAll("foreignObject")) fo.classList.toggle("activo", fo.dataset.nombre === nombre);
  const fila = r.lista?.querySelector(`li[data-fila="${CSS.escape(nombre)}"]`);
  fila?.classList.add("activo");
  const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (desde === "capa") {
    fila?.scrollIntoView({ block: "nearest", behavior: quieto });
    return;
  }
  const campo = r.campos.find((c) => c.nombre === nombre);
  const primera = campo?.cajas?.[0];
  if (!primera || !vista) return;
  const fo = [...er.raiz.querySelectorAll("foreignObject")].find((x) => x.dataset.nombre === nombre);
  if (fo) fo.scrollIntoView({ block: "center", behavior: quieto });
  else vista.irA(primera.pagina, true);
  el?.focus({ preventScroll: true });
}

// ---------- Capa sobre cada página ----------

function capaDePagina(n, geo) {
  const t = tamanoVista(geo);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "pv-capa");
  svg.setAttribute("viewBox", `0 0 ${t.ancho} ${t.alto}`);
  svg.setAttribute("preserveAspectRatio", "none");
  for (const campo of r.campos) {
    (campo.cajas || []).forEach((caja) => {
      if (caja.pagina !== n) return;
      const v = pdfACaja(caja, geo);
      const fo = document.createElementNS(SVGNS, "foreignObject");
      for (const [k, valor] of Object.entries({ x: v.x, y: v.y, width: Math.max(4, v.w), height: Math.max(4, v.h) })) fo.setAttribute(k, String(valor));
      fo.dataset.nombre = campo.nombre;
      fo.setAttribute("class", `pv-sobre tipo-${campo.tipo}${v.h > 26 ? " alto" : ""}`);
      if (campo.tipo === "firma-digital") {
        const caja = nodo("div", "pv-sobre-firma", "Firma digital");
        caja.title = "Campo de firma con certificado: aquí no se llena. Su firma visible se pone en Firmar.";
        fo.append(caja);
      } else {
        fo.append(control(campo, { caja, enCapa: true }));
      }
      svg.append(fo);
    });
  }
  return svg;
}

function pintarZoom() {
  if (r.zoomTexto && vista) r.zoomTexto.textContent = `${Math.round(vista.zoom * 100)} %`;
}

function pintarCuenta() {
  if (!r.cuenta) return;
  const editables = r.campos.filter((c) => c.tipo !== "firma-digital");
  const llenos = editables.filter((c) => lleno(r.valores.get(c.nombre))).length;
  r.cuenta.textContent = `${plural(editables.length, "campo", "campos")}, ${plural(llenos, "lleno", "llenos")}.`;
}

function pintarRellenar() {
  er.barra.hidden = !r.info;
  $("pdf-rellenar-boton").disabled = !r.info || !r.campos.length;
  if (!r.info) {
    vista?.vaciar();
    er.cuerpo.replaceChildren(zonaVacia({
      ilustracion: "rellenar",
      titulo: "Elija el PDF con formulario",
      texto: "Verá el formulario tal cual y podrá escribir en cada campo sobre la página, o en la lista de al lado.",
      alElegir: () => elegirUno("rellenar"),
      alSoltar: (rutas) => ponerUno("rellenar", rutas[0]),
    }));
    return;
  }
  r.zoomTexto = nodo("span", "ayuda", "100 %");
  r.pagina = nodo("span", "ayuda", "");
  r.cuenta = nodo("span", "ayuda pv-barra-resumen", "");
  er.barra.replaceChildren(
    boton("Alejar", "boton-linea", () => {
      vista?.cambiarZoom(vista.zoom / 1.25, 0.4, 3);
      pintarZoom();
    }),
    r.zoomTexto,
    boton("Acercar", "boton-linea", () => {
      vista?.cambiarZoom(vista.zoom * 1.25, 0.4, 3);
      pintarZoom();
    }),
    boton("Ajustar al ancho", "boton-texto", () => {
      vista?.cambiarZoom(vista.zoomAncho(0.4, 3, 48), 0.4, 3);
      pintarZoom();
    }),
    r.pagina,
    r.cuenta,
  );
  const dos = nodo("div", "pv-rellenar");
  const paginas = nodo("div", "pv-paginas");
  paginas.setAttribute("aria-label", "Páginas del formulario");
  const lado = nodo("aside", "pv-lista-campos");
  lado.setAttribute("aria-label", "Campos del formulario");
  dos.append(paginas, lado);
  er.cuerpo.replaceChildren(dos);
  vista = crearVisor({
    caja: paginas,
    clase: "pv-pagina",
    envolver: (canvas, n, geo) => {
      const env = nodo("div", "pv-pagina-envoltura");
      env.append(canvas, capaDePagina(n, geo));
      return env;
    },
    alCambiarPagina: (n) => {
      r.pagina.textContent = `Página ${n} de ${r.info.paginas}`;
    },
  });
  paginas.addEventListener("scroll", () => vista.paginaActual(), { passive: true });
  r.pagina.textContent = `Página 1 de ${r.info.paginas}`;
  pintarLista(lado);
  pintarCuenta();
}

function pintarLista(lado) {
  lado.replaceChildren();
  if (r.aviso) {
    lado.append(nodo("p", "ayuda error", r.aviso), nodo("p", "ayuda", "Para escribir encima de un PDF sin campos, use Firmar: allí se ponen textos donde quiera."));
    r.lista = null;
    return;
  }
  lado.append(nodo("p", "etiqueta primera", "Campos"));
  const lista = nodo("ul", "pv-campos");
  r.lista = lista;
  const orden = [...r.campos].sort((a, b) => {
    const pa = a.cajas?.[0]?.pagina ?? 1e9;
    const pb = b.cajas?.[0]?.pagina ?? 1e9;
    return pa - pb || (b.cajas?.[0]?.y ?? 0) - (a.cajas?.[0]?.y ?? 0);
  });
  let paginaVista = null;
  for (const campo of orden) {
    const pagina = campo.cajas?.[0]?.pagina ?? null;
    if (pagina !== paginaVista) {
      paginaVista = pagina;
      lista.append(nodo("li", "pv-campos-pagina", pagina ? `Página ${pagina}` : "Sin lugar en la página"));
    }
    const li = nodo("li", `pv-campo-fila${lleno(r.valores.get(campo.nombre)) ? " lleno" : ""}`);
    li.dataset.fila = campo.nombre;
    const l = nodo("label", "");
    l.append(nodo("span", "pv-campo-nombre", campo.nombre));
    if (campo.tipo === "firma-digital") {
      l.append(nodo("span", "ayuda", "Firma con certificado: aquí no se llena. Su firma visible se pone en Firmar."));
    } else {
      l.append(control(campo));
    }
    li.append(l);
    lista.append(li);
  }
  lado.append(lista);
}

async function rellenar() {
  const valores = {};
  for (const campo of r.campos) {
    if (campo.tipo === "firma-digital") continue;
    valores[campo.nombre] = r.valores.get(campo.nombre);
  }
  await correr(er, "pdf-rellenar-estado", "Guardando el formulario.", async () => {
    const x = await window.vigencia.pdfRellenar(pdf.rellenar, valores, $("pdf-rellenar-aplanar").checked);
    terminar(er, "pdf-rellenar-estado", x, {
      titulo: "Formulario diligenciado",
      detalle: $("pdf-rellenar-aplanar").checked ? "Los campos quedaron fijos en el PDF." : "Los campos siguen editables.",
      aviso: "Formulario diligenciado y guardado.",
      error: "No pude guardar.",
    });
  });
}

export function iniciarRellenarPdf() {
  er = crearEscena("rellenar", { titulo: "Rellenar", ayuda: "Escriba en cada campo sobre la página o en la lista; los dos van juntos.", llena: true, alSoltar: (x) => ponerUno("rellenar", x[0]) });
  alAbrir.rellenar = abrirRellenar;
  $("pdf-rellenar-boton").addEventListener("click", rellenar);
  pintarRellenar();
}
