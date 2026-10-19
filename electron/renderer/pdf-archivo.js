// Herramientas PDF del archivo entero: Comprimir (antes y después con la
// página de muestra), Proteger (fuerza de la contraseña y permisos) y
// Desbloquear (vista de la primera página ya abierta). Las cuentas puras
// están en compartido/pdfvisual.js; los dibujos, en renderer/paginas.js.
import { NIVELES_COMPRIMIR } from "../compartido/pdftools.js";
import { PERMISOS, fuerzaClave, permisosP, porcentajeAhorro, resumenPermisos, tamanoHumano } from "../compartido/pdfvisual.js";
import { boton, botonIcono, correr, crearEscena, icono, ilustracion, terminar, zonaVacia } from "./escena.js";
import { abrirBytes, abrirDoc, cerrarDoc, docUnico, limitar, pintarMiniatura } from "./paginas.js";
import { alAbrir, elegirUno, estado, nodo, pdf, ponerUno } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const LADO_MUESTRA = 340;

const DESCRIPCION_NIVEL = {
  alta: "Las fotos se ven casi iguales. Ahorra poco.",
  media: "Buen equilibrio para enviar por correo.",
  baja: "Lo más liviano. Las fotos pierden detalle.",
};

function campoClave(etiqueta, { id, placeholder, alCambiar, alEnter = null }) {
  const l = nodo("label", "pv-clave");
  l.append(nodo("span", "etiqueta", etiqueta));
  const fila = nodo("div", "pv-clave-fila");
  const campo = document.createElement("input");
  campo.type = "password";
  campo.id = id;
  campo.maxLength = 127;
  campo.autocomplete = "new-password";
  campo.spellcheck = false;
  campo.placeholder = placeholder;
  campo.addEventListener("input", alCambiar);
  if (alEnter) campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") alEnter();
  });
  const ver = botonIcono("ojo", "Mostrar la contraseña", () => {
    const visible = campo.type === "password";
    campo.type = visible ? "text" : "password";
    ver.replaceChildren(icono(visible ? "ojo-no" : "ojo"));
    ver.setAttribute("aria-pressed", String(visible));
    ver.setAttribute("aria-label", visible ? "Ocultar la contraseña" : "Mostrar la contraseña");
    ver.title = ver.getAttribute("aria-label");
  });
  ver.setAttribute("aria-pressed", "false");
  fila.append(campo, ver);
  l.append(fila);
  return { l, campo };
}

// Vacía la contraseña y la vuelve a ocultar si quedó a la vista.
function vaciarClave(campo) {
  campo.value = "";
  if (campo.type === "text") campo.nextElementSibling?.click();
}

function tarjetaArchivo(nombre, detalle, lienzo = null) {
  const t = nodo("div", "pv-archivo");
  if (lienzo) {
    const marco = nodo("div", "pv-archivo-mini");
    marco.append(lienzo);
    t.append(marco);
  }
  const textos = nodo("div", "");
  textos.append(nodo("p", "pv-archivo-nombre", nombre), nodo("p", "ayuda", detalle));
  t.append(textos);
  return t;
}

async function miniaturaDe(doc, pagina, lado = 72) {
  const c = document.createElement("canvas");
  c.className = "pv-lienzo";
  try {
    await pintarMiniatura(doc, 1, c, pagina, lado);
  } catch {
    c.classList.add("pv-error");
  }
  return c;
}

// ---------- Comprimir ----------

const c = { info: null, archivo: docUnico(), nivel: "media", medidas: new Map(), docs: new Map(), pagina: 1, cerca: false, turno: 0 };
let ec = null;

async function abrirComprimir(info) {
  c.turno += 1;
  for (const d of c.docs.values()) cerrarDoc(d);
  Object.assign(c, { info, medidas: new Map(), docs: new Map(), pagina: 1 });
  ec.mostrarPie();
  pintarComprimir();
  if (!info) return;
  try {
    await c.archivo.abrir(pdf.comprimir);
  } catch (error) {
    estado("pdf-comprimir-estado", error?.message || "No pude abrir el PDF.", true);
  }
  medir(c.nivel);
}

async function medir(nivel) {
  c.nivel = nivel;
  pintarPresets();
  if (c.medidas.has(nivel)) return pintarComparacion();
  const turno = c.turno;
  c.midiendo = nivel;
  pintarComparacion();
  const r = await ec.trabajando("Midiendo cuánto queda, sin guardar nada.", () => window.vigencia.pdfComprimir(pdf.comprimir, nivel, true));
  if (turno !== c.turno) return;
  c.midiendo = null;
  if (!r?.ok) {
    estado("pdf-comprimir-estado", r?.error || "No pude medirlo.", true);
    pintarComparacion();
    return;
  }
  c.medidas.set(nivel, r);
  if (r.base64) {
    try {
      c.docs.set(nivel, await abrirBytes(r.base64));
    } catch {
      /* sin vista de muestra */
    }
  }
  if (turno !== c.turno) return;
  pintarPresets();
  pintarComparacion();
}

function pintarComprimir() {
  if (!c.info) {
    ec.cuerpo.replaceChildren(zonaVacia({
      ilustracion: "comprimir",
      titulo: "Elija el PDF que va a achicar",
      texto: "Verá cuánto pesa antes y después de cada calidad, y una página de muestra para comparar.",
      alElegir: () => elegirUno("comprimir"),
      alSoltar: (rutas) => ponerUno("comprimir", rutas[0]),
    }));
    $("pdf-comprimir-boton").disabled = true;
    return;
  }
  c.presets = nodo("div", "pv-presets");
  c.presets.setAttribute("role", "radiogroup");
  c.presets.setAttribute("aria-label", "Calidad");
  c.comparacion = nodo("section", "pv-comparacion");
  c.comparacion.setAttribute("aria-live", "polite");
  c.muestra = nodo("section", "pv-muestra");
  ec.cuerpo.replaceChildren(c.presets, c.comparacion, c.muestra);
  pintarPresets();
  pintarComparacion();
}

function pintarPresets() {
  if (!c.presets) return;
  const conFoco = c.presets.contains(document.activeElement);
  c.presets.replaceChildren(...NIVELES_COMPRIMIR.map((n) => {
    const b = nodo("button", "pv-preset");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(n.id === c.nivel));
    b.tabIndex = n.id === c.nivel ? 0 : -1;
    const m = c.medidas.get(n.id);
    const pct = m ? porcentajeAhorro(m.antes, m.despues) : null;
    b.append(
      nodo("span", "pv-preset-nombre", n.nombre.replace(" (recomendada)", "")),
      nodo("span", "ayuda pv-preset-desc", DESCRIPCION_NIVEL[n.id] || ""),
      nodo("span", "pv-preset-cifra", m ? `${tamanoHumano(m.despues)}${pct > 0 ? `, ${pct} % menos` : ""}` : c.midiendo === n.id ? "Midiendo" : "Toque para medir"),
    );
    if (n.id === "media") b.append(nodo("span", "pv-preset-sello", "Recomendada"));
    b.addEventListener("click", () => medir(n.id));
    b.addEventListener("keydown", (e) => {
      const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!k) return;
      e.preventDefault();
      const i = NIVELES_COMPRIMIR.findIndex((x) => x.id === c.nivel);
      const sig = NIVELES_COMPRIMIR[(i + k + NIVELES_COMPRIMIR.length) % NIVELES_COMPRIMIR.length];
      medir(sig.id);
    });
    return b;
  }));
  if (conFoco) c.presets.querySelector('[aria-checked="true"]')?.focus();
}

function barra(etiqueta, valor, max, clase) {
  const fila = nodo("div", `pv-barra-fila ${clase}`);
  const p = document.createElement("progress");
  p.className = "pv-medidor";
  p.max = Math.max(1, max);
  p.value = valor;
  p.setAttribute("aria-label", `${etiqueta}: ${tamanoHumano(valor)}`);
  fila.append(nodo("span", "pv-barra-etiqueta", etiqueta), p, nodo("span", "pv-barra-cifra", tamanoHumano(valor)));
  return fila;
}

function pintarComparacion() {
  if (!c.comparacion) return;
  const m = c.medidas.get(c.nivel);
  $("pdf-comprimir-boton").disabled = !m;
  if (!m) {
    c.comparacion.replaceChildren(nodo("p", "ayuda", c.midiendo ? "Midiendo esa calidad en este computador." : "Elija una calidad para ver cuánto queda."));
    pintarMuestra();
    return;
  }
  const pct = porcentajeAhorro(m.antes, m.despues);
  const max = Math.max(m.antes, m.despues);
  const cifra = nodo("div", `pv-ahorro${pct > 0 ? "" : " sin-ahorro"}`);
  cifra.append(nodo("span", "pv-ahorro-num", pct > 0 ? `${pct} %` : "0 %"), nodo("span", "pv-ahorro-texto", pct > 0 ? "menos" : "de ahorro"));
  const barras = nodo("div", "pv-barras");
  barras.append(barra("Antes", m.antes, max, "antes"), barra("Después", m.despues, max, "despues"));
  const nota = m.tocadas
    ? `${plural(m.tocadas, "foto achicada", "fotos achicadas")}${m.intactas ? `, ${plural(m.intactas, "quedó igual", "quedaron iguales")}` : ""}. El texto y las tablas no cambian.`
    : "Este PDF no tiene fotos JPEG que achicar: casi no cambia.";
  c.comparacion.replaceChildren(cifra, barras, nodo("p", "ayuda pv-comparacion-nota", nota));
  pintarMuestra();
}

async function pintarMuestra() {
  if (!c.muestra) return;
  const antes = c.archivo.doc;
  const despues = c.docs.get(c.nivel);
  const total = c.info?.paginas || 0;
  if (!antes || !total) {
    c.muestra.replaceChildren();
    return;
  }
  const cabeza = nodo("div", "pv-muestra-cabeza");
  cabeza.append(nodo("h3", "pv-subtitulo", `Página de muestra: ${c.pagina} de ${total}`));
  const anterior = boton("Anterior", "boton-texto", () => {
    c.pagina = limitar(c.pagina - 1, 1, total);
    pintarMuestra();
  });
  anterior.disabled = c.pagina <= 1;
  const siguiente = boton("Siguiente", "boton-texto", () => {
    c.pagina = limitar(c.pagina + 1, 1, total);
    pintarMuestra();
  });
  siguiente.disabled = c.pagina >= total;
  const cerca = boton(c.cerca ? "Ver entera" : "Ver de cerca", "boton-linea", () => {
    c.cerca = !c.cerca;
    pintarMuestra();
  });
  cerca.setAttribute("aria-pressed", String(c.cerca));
  cabeza.append(anterior, siguiente, cerca);
  const lado = c.cerca ? LADO_MUESTRA * 2.5 : LADO_MUESTRA;
  const dos = nodo("div", `pv-muestra-dos${c.cerca ? " cerca" : ""}`);
  const geo = c.info.detalle[c.pagina - 1];
  for (const [titulo, doc] of [["Antes", antes], ["Después", despues]]) {
    const col = nodo("figure", "pv-muestra-col");
    const marco = nodo("div", "pv-muestra-marco");
    if (doc) {
      const lienzo = document.createElement("canvas");
      lienzo.className = "pv-lienzo pv-cargando";
      lienzo.setAttribute("aria-label", `Página ${c.pagina}, ${titulo.toLowerCase()}`);
      marco.append(lienzo);
      pintarMiniatura(doc, c.pagina, lienzo, geo, lado).then(() => lienzo.classList.remove("pv-cargando")).catch(() => lienzo.classList.add("pv-error"));
    } else {
      marco.append(nodo("p", "ayuda", c.midiendo ? "Midiendo." : "Sin vista de esta calidad."));
    }
    col.append(marco, nodo("figcaption", "ayuda", titulo));
    dos.append(col);
  }
  c.muestra.replaceChildren(cabeza, dos);
  // Las dos columnas se mueven juntas al ver de cerca.
  if (c.cerca) {
    const marcos = [...dos.querySelectorAll(".pv-muestra-marco")];
    for (const m of marcos) {
      m.addEventListener("scroll", () => {
        for (const otro of marcos) {
          if (otro === m) continue;
          otro.scrollTop = m.scrollTop;
          otro.scrollLeft = m.scrollLeft;
        }
      }, { passive: true });
    }
  }
}

async function comprimir() {
  const nivel = c.nivel;
  await correr(ec, "pdf-comprimir-estado", "Comprimiendo.", async () => {
    const r = await window.vigencia.pdfComprimir(pdf.comprimir, nivel);
    terminar(ec, "pdf-comprimir-estado", r, {
      titulo: "PDF comprimido",
      detalle: (x) => `De ${tamanoHumano(x.antes)} a ${tamanoHumano(x.despues)}, ${porcentajeAhorro(x.antes, x.despues)} % menos (${x.nivel}).`,
      aviso: "PDF comprimido y guardado.",
      error: "No pude comprimir.",
    });
  });
}

// ---------- Proteger ----------

const p = { info: null, archivo: docUnico(), permisos: {} };
let ep = null;

async function abrirProteger(info) {
  p.info = info;
  ep.mostrarPie();
  pintarProteger();
  if (!info) return;
  try {
    const doc = await p.archivo.abrir(pdf.proteger);
    if (doc && p.info === info && p.cajaArchivo) {
      p.cajaArchivo.replaceChildren(tarjetaArchivo(info.nombre, `${plural(info.paginas, "página", "páginas")}, ${tamanoHumano(info.bytes)}`, await miniaturaDe(doc, info.detalle[0])));
    }
  } catch {
    /* sin miniatura: el nombre basta */
  }
}

function pintarProteger() {
  if (!p.info) {
    ep.cuerpo.replaceChildren(zonaVacia({
      ilustracion: "proteger",
      titulo: "Elija el PDF que va a proteger",
      texto: "Le pone contraseña AES-256: sin ella nadie lo abre. El original queda igual.",
      alElegir: () => elegirUno("proteger"),
      alSoltar: (rutas) => ponerUno("proteger", rutas[0]),
    }));
    $("pdf-proteger-boton").disabled = true;
    return;
  }
  const dos = nodo("div", "pv-dos-columnas");
  const ilu = nodo("div", "pv-ilu-grande");
  p.ilu = ilustracion("proteger", "pv-ilu pv-ilu-animada");
  ilu.append(p.ilu);
  const form = nodo("div", "pv-formulario");
  p.cajaArchivo = nodo("div", "");
  p.cajaArchivo.append(tarjetaArchivo(p.info.nombre, `${plural(p.info.paginas, "página", "páginas")}, ${tamanoHumano(p.info.bytes)}`));
  const clave = campoClave("Contraseña para abrirlo", { id: "pdf-proteger-clave", placeholder: "La que pedirá al abrir", alCambiar: actualizarProteger });
  const repetir = campoClave("Repítala", { id: "pdf-proteger-repetir", placeholder: "Igual que arriba", alCambiar: actualizarProteger });
  p.clave = clave.campo;
  p.repetir = repetir.campo;
  const fuerza = nodo("div", "pv-fuerza");
  p.medidor = document.createElement("meter");
  Object.assign(p.medidor, { min: 0, max: 4, low: 2, high: 3, optimum: 4, value: 0 });
  p.medidor.className = "pv-fuerza-medidor";
  p.medidor.setAttribute("aria-label", "Fuerza de la contraseña");
  p.fuerzaTexto = nodo("span", "pv-fuerza-texto", "");
  p.consejo = nodo("p", "ayuda pv-fuerza-consejo", "");
  fuerza.append(p.medidor, p.fuerzaTexto);
  p.igual = nodo("p", "ayuda pv-igual", "");
  const permisos = nodo("fieldset", "pv-permisos");
  permisos.append(nodo("legend", "etiqueta", "Qué puede hacer quien lo abra"));
  for (const x of PERMISOS) {
    const l = nodo("label", "casilla");
    const caja = document.createElement("input");
    caja.type = "checkbox";
    caja.checked = p.permisos[x.id] !== false;
    caja.addEventListener("change", () => {
      p.permisos[x.id] = caja.checked;
      actualizarProteger();
    });
    l.append(caja, nodo("span", "", x.nombre));
    permisos.append(l);
  }
  p.resumen = nodo("p", "pv-resumen-permisos", "");
  const mas = document.createElement("details");
  mas.className = "pv-mas";
  mas.append(nodo("summary", "", "Contraseña de dueño (opcional)"));
  const duenio = campoClave("Contraseña de dueño", { id: "pdf-proteger-duenio", placeholder: "Si la deja vacía, se crea una al azar", alCambiar: () => {} });
  p.duenio = duenio.campo;
  mas.append(duenio.l, nodo("p", "ayuda", "Con ella se pueden cambiar los permisos después. Sin ella, nadie puede."));
  form.append(p.cajaArchivo, clave.l, fuerza, p.consejo, repetir.l, p.igual, permisos, p.resumen, mas);
  dos.append(ilu, form);
  ep.cuerpo.replaceChildren(dos);
  actualizarProteger();
}

function actualizarProteger() {
  if (!p.clave) return;
  const f = fuerzaClave(p.clave.value);
  p.medidor.value = f.nivel;
  p.fuerzaTexto.textContent = f.texto;
  p.fuerzaTexto.className = `pv-fuerza-texto nivel-${f.nivel}`;
  p.consejo.textContent = f.consejo;
  const coincide = p.clave.value && p.clave.value === p.repetir.value;
  p.igual.textContent = !p.repetir.value ? "" : coincide ? "Coinciden." : "No coinciden todavía.";
  p.igual.classList.toggle("error", Boolean(p.repetir.value) && !coincide);
  p.resumen.textContent = resumenPermisos(p.permisos);
  $("pdf-proteger-boton").disabled = !coincide;
}

async function proteger() {
  const clave = p.clave?.value || "";
  if (!clave || clave !== p.repetir.value) {
    estado("pdf-proteger-estado", "Escriba la contraseña dos veces igual.", true);
    return;
  }
  p.ilu.classList.remove("cerrado");
  await correr(ep, "pdf-proteger-estado", "Cifrando con AES-256.", async () => {
    const r = await window.vigencia.pdfProteger(pdf.proteger, clave, p.duenio.value, permisosP(p.permisos));
    const ok = terminar(ep, "pdf-proteger-estado", r, {
      titulo: "PDF protegido",
      detalle: "Guarde bien la contraseña: sin ella nadie lo abre, ni la app.",
      aviso: "PDF protegido y guardado.",
      error: "No pude proteger.",
      llevar: false,
    });
    if (ok) {
      p.ilu.classList.add("cerrado");
      for (const campo of [p.clave, p.repetir, p.duenio]) vaciarClave(campo);
      actualizarProteger();
    }
  });
}

// ---------- Desbloquear ----------

let ed = null;
const d = { ruta: "" };

function abrirDesbloquear(_info, ruta) {
  d.ruta = ruta || "";
  ed.mostrarPie();
  pintarDesbloquear();
}

function pintarDesbloquear() {
  if (!d.ruta) {
    ed.cuerpo.replaceChildren(zonaVacia({
      ilustracion: "desbloquear",
      titulo: "Elija el PDF con contraseña",
      texto: "Con la contraseña actual queda un PDF limpio, listo para leer o llevar a la IA.",
      alElegir: () => elegirUno("desbloquear"),
      alSoltar: (rutas) => ponerUno("desbloquear", rutas[0]),
    }));
    $("pdf-desbloquear-boton").disabled = true;
    return;
  }
  const dos = nodo("div", "pv-dos-columnas");
  const ilu = nodo("div", "pv-ilu-grande");
  d.ilu = ilustracion("desbloquear", "pv-ilu pv-ilu-animada cerrado");
  ilu.append(d.ilu);
  const form = nodo("div", "pv-formulario");
  const clave = campoClave("Contraseña actual", { id: "pdf-desbloquear-clave", placeholder: "La que abre el PDF hoy", alCambiar: () => {
    $("pdf-desbloquear-boton").disabled = !d.clave.value;
  }, alEnter: () => desbloquear() });
  d.clave = clave.campo;
  form.append(tarjetaArchivo(d.ruta.split(/[/\\]/).pop(), "Con contraseña"), clave.l, nodo("p", "ayuda", "Sin la contraseña no se puede: la app no rompe claves."));
  dos.append(ilu, form);
  ed.cuerpo.replaceChildren(dos);
  $("pdf-desbloquear-boton").disabled = true;
}

async function vistaAbierta(ruta) {
  const fig = nodo("figure", "pv-vista-abierta");
  try {
    const info = await window.vigencia.pdfInfo(ruta);
    const doc = await abrirDoc(ruta);
    const lienzo = await miniaturaDe(doc, info.detalle[0], 220);
    cerrarDoc(doc);
    fig.append(lienzo, nodo("figcaption", "ayuda", `Primera página, ya sin contraseña. ${plural(info.paginas, "página", "páginas")}.`));
    return fig;
  } catch {
    return null;
  }
}

async function desbloquear() {
  const clave = d.clave?.value || "";
  if (!clave) {
    estado("pdf-desbloquear-estado", "Escriba la contraseña actual.", true);
    return;
  }
  await correr(ed, "pdf-desbloquear-estado", "Abriendo el PDF.", async () => {
    const r = await window.vigencia.pdfDesbloquear(pdf.desbloquear, clave);
    if (!r?.ok && !r?.temporal) {
      terminar(ed, "pdf-desbloquear-estado", r, { titulo: "", aviso: "", error: "No pude abrirlo." });
      d.clave.select();
      return;
    }
    vaciarClave(d.clave);
    $("pdf-desbloquear-boton").disabled = true;
    d.ilu.classList.remove("cerrado");
    d.ilu.classList.add("abierto");
    const vista = await vistaAbierta(r.ruta || r.temporal);
    const llevar = { ruta: r.temporal, como: "temporal", nombre: r.nombre };
    if (r.ok) {
      terminar(ed, "pdf-desbloquear-estado", r, { titulo: "PDF sin contraseña", detalle: "Guardado como copia nueva; el original sigue con contraseña.", aviso: "PDF desbloqueado y guardado.", error: "", llevar: { ruta: r.ruta, como: "resultado" }, extra: vista });
    } else {
      terminar(ed, "pdf-desbloquear-estado", { ok: true, rutas: [] }, { titulo: "Abierto, sin guardar copia", detalle: "No guardó copia, pero puede llevarlo a la IA: hay una copia temporal que se borra sola.", aviso: "PDF abierto.", error: "", llevar, extra: vista });
    }
  });
}

// ---------- Arranque ----------

export function iniciarArchivoPdf() {
  ec = crearEscena("comprimir", { titulo: "Comprimir", ayuda: "Achica las fotos sin tocar el texto ni las tablas.", alSoltar: (r) => ponerUno("comprimir", r[0]) });
  ep = crearEscena("proteger", { titulo: "Proteger", ayuda: "Pone contraseña al PDF y elige qué se puede hacer con él.", alSoltar: (r) => ponerUno("proteger", r[0]) });
  ed = crearEscena("desbloquear", { titulo: "Desbloquear", ayuda: "Quita la contraseña con la contraseña actual y deja una copia limpia.", alSoltar: (r) => ponerUno("desbloquear", r[0]) });
  alAbrir.comprimir = abrirComprimir;
  alAbrir.proteger = abrirProteger;
  alAbrir.desbloquear = abrirDesbloquear;
  $("pdf-comprimir-boton").addEventListener("click", comprimir);
  $("pdf-proteger-boton").addEventListener("click", proteger);
  $("pdf-desbloquear-boton").addEventListener("click", desbloquear);
  pintarComprimir();
  pintarProteger();
  pintarDesbloquear();
}
