// Pantalla Herramientas PDF: unir, separar, rotar y firmar. Todo pasa en
// este computador (pdf-lib); la ventana solo elige archivos y avisa.
import { ANGULOS, NIVELES_COMPRIMIR, POSICIONES_FIRMA, cajaFirma } from "../compartido/pdftools.js";
import { diferencias } from "../compartido/documentos.js";
import { avisar } from "./aviso.js";
import { conAvance, irA, llenarProyectos } from "./proyectos.js";

const $ = (id) => document.getElementById(id);
const HERRAMIENTAS_PDF = ["unir", "separar", "rotar", "firmar", "comprimir", "proteger", "desbloquear", "rellenar", "comparar"];
const pdf = { llevar: null, llevado: null, listo: false, herramienta: "unir", unir: [], separar: "", rotar: "", firmar: "", comprimir: "", proteger: "", desbloquear: "", rellenar: "", compararA: "", compararB: "", firmarInfo: null };

let arrastreDesde = -1;

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

function estado(id, mensaje, error = false) {
  const el = $(id);
  el.textContent = mensaje || "";
  el.classList.toggle("error", error);
}

// Corre una acción mostrando "trabajando" con pulso hasta que termina.
async function ocupado(idEstado, texto, fn) {
  const el = $(idEstado);
  el.classList.add("procesando");
  estado(idEstado, texto);
  try {
    return await fn();
  } finally {
    el.classList.remove("procesando");
  }
}

// Ayuda de cada herramienta en el panel derecho: nada de vacíos.
const AYUDA_PDF = {
  unir: ["Unir", "Junta varios PDF en uno solo, en el orden que usted deje.", ["Agregue con Elegir o arrastrando.", "Ordene con ↑ ↓ o arrastrando la fila.", "Pulse Unir y guardar."]],
  separar: ["Separar", "Saca unas páginas a un PDF nuevo, sin tocar el original.", ["Elija el PDF.", "Escriba las páginas, por ejemplo 1-3, 5.", "Pulse Separar y guardar."]],
  rotar: ["Girar", "Endereza páginas chuecas 90, 180 o 270 grados.", ["Elija el PDF.", "Páginas vacío significa todas.", "Elija el giro y pulse Girar y guardar."]],
  firmar: ["Firmar", "Pone su firma dibujada donde usted diga.", ["Elija el PDF.", "Dibuje, suba o escriba su firma.", "Elija página, posición y tamaño."]],
  comprimir: ["Comprimir", "Achica las fotos sin tocar el texto ni las tablas.", ["Elija el PDF.", "Elija la calidad.", "Si no tiene fotos, casi no cambia."]],
  proteger: ["Proteger", "Le pone contraseña AES-256: sin ella nadie lo abre.", ["Elija el PDF.", "Escriba la contraseña y guárdela bien.", "El original queda intacto."]],
  desbloquear: ["Desbloquear", "Quita la contraseña y deja el PDF limpio.", ["Elija el PDF con contraseña.", "Escriba la contraseña actual.", "Sin la contraseña no se puede."]],
  rellenar: ["Rellenar", "Diligencia los campos del formulario y lo aplana.", ["Elija el PDF con formulario.", "Llene cada campo.", "Desmarque aplanar si quiere seguir editando."]],
  comparar: ["Comparar", "Muestra qué se agregó, cambió o quitó entre dos PDF.", ["Elija los dos archivos.", "El resultado sale aquí a la derecha."]],
};

function pintarAyudaPdf() {
  const caja = $("pdf-detalle");
  if (!caja) return;
  caja.replaceChildren();
  const [titulo, desc, pasos] = AYUDA_PDF[pdf.herramienta] || AYUDA_PDF.unir;
  const tarjeta = nodo("div", "juris-card");
  tarjeta.append(nodo("h2", "seccion serif", titulo));
  tarjeta.append(nodo("p", "", desc));
  const ol = nodo("ol", "pdf-pasos");
  for (const p of pasos) ol.append(nodo("li", "", p));
  tarjeta.append(ol);
  caja.append(tarjeta);
  const vacio = document.querySelector("#pantalla-pdf .juris-vacio");
  if (vacio) vacio.hidden = true;
}

function nombreCorto(ruta) {
  return String(ruta || "").split(/[/\\]/).pop() || ruta;
}

function elegirHerramienta(cual) {
  pdf.herramienta = cual;
  for (const h of HERRAMIENTAS_PDF) {
    $(`pdf-panel-${h}`).hidden = h !== cual;
    const tab = $(`pdf-tab-${h}`);
    tab.classList.toggle("elegida", h === cual);
    tab.setAttribute("aria-selected", String(h === cual));
  }
  pintarAyudaPdf();
  if (cual === "firmar") pintarVistaFirma();
}

// ---------- Usar con la IA: convertir o llevar al contexto ----------

const COMO_LLEVAR = {
  elegido: "el PDF que eligió",
  resultado: "el PDF que acaba de guardar",
  temporal: "una copia temporal sin contraseña, aunque no haya guardado una",
};

// Deja listo el panel Usar con la IA para un PDF: el elegido, el que salió
// de una herramienta o la copia temporal ya desbloqueada.
async function ofrecerLlevar(ruta, { como = "elegido", nombre = "" } = {}) {
  if (!ruta) return;
  pdf.llevar = { ruta, como, nombre: nombre || nombreCorto(ruta) };
  pdf.llevado = null;
  $("pdf-llevar-nombre").textContent = `${pdf.llevar.nombre}, ${COMO_LLEVAR[como] || COMO_LLEVAR.elegido}.`;
  $("pdf-llevar-siguiente").hidden = true;
  estado("pdf-llevar-estado", "");
  await llenarProyectos($("pdf-llevar-proyecto"), { vacio: "Elija un proyecto" });
}

async function llevar(conProyecto) {
  if (!pdf.llevar) {
    estado("pdf-llevar-estado", "Elija o suelte primero un PDF.", true);
    return;
  }
  const proyectoId = Number($("pdf-llevar-proyecto").value) || null;
  if (conProyecto && !proyectoId) {
    estado("pdf-llevar-estado", "Elija primero el proyecto de Documentos.", true);
    return;
  }
  for (const id of ["pdf-llevar-convertir", "pdf-llevar-contexto"]) $(id).disabled = true;
  try {
    const r = await conAvance({ estado: $("pdf-llevar-estado"), barra: $("pdf-llevar-avance") }, () => window.vigencia.pdfAProyecto({
      ruta: pdf.llevar.ruta,
      nombre: pdf.llevar.nombre,
      proyectoId: conProyecto ? proyectoId : null,
      forzarOcr: $("pdf-llevar-ocr").checked,
    }));
    if (!r?.ok) {
      estado("pdf-llevar-estado", r?.error || "No pude convertirlo.", true);
      avisar(r?.error || "No pude convertirlo.", "error");
      return;
    }
    pdf.llevado = { archivoId: r.archivo.id, proyectoId: conProyecto ? proyectoId : null };
    const base = r.cache ? "Ya estaba convertido." : "Convertido a Markdown en este computador.";
    const aviso = r.archivo.aviso ? ` ${r.archivo.aviso}` : "";
    estado("pdf-llevar-estado", conProyecto ? `${base} Quedó en el contexto del proyecto.${aviso}` : `${base}${aviso}`, Boolean(r.archivo.aviso));
    avisar(conProyecto ? "PDF en el contexto del proyecto." : "PDF convertido a Markdown.");
    $("pdf-llevar-siguiente").hidden = false;
    $("pdf-llevar-abrir").hidden = !conProyecto;
  } finally {
    for (const id of ["pdf-llevar-convertir", "pdf-llevar-contexto"]) $(id).disabled = false;
  }
}

// ---------- Unir ----------

async function agregarUnir(rutas) {
  for (const ruta of rutas || []) {
    if (ruta && !pdf.unir.includes(ruta)) pdf.unir.push(ruta);
  }
  await pintarUnir();
}

async function pintarUnir() {
  const caja = $("pdf-unir-lista");
  caja.replaceChildren();
  if (!pdf.unir.length) caja.append(nodo("p", "ayuda", "Todavía no hay PDF. Elija o arrastre al menos 2."));
  for (let i = 0; i < pdf.unir.length; i += 1) {
    const ruta = pdf.unir[i];
    const fila = nodo("div", "conv-fila");
    fila.draggable = true;
    fila.dataset.indice = String(i);
    fila.append(nodo("span", "", `${i + 1}. ${nombreCorto(ruta)}`));
    const grupo = nodo("div", "botones");
    const subir = nodo("button", "boton-texto", "↑");
    subir.type = "button";
    subir.title = "Subir en el orden";
    subir.disabled = i === 0;
    subir.addEventListener("click", () => {
      [pdf.unir[i - 1], pdf.unir[i]] = [pdf.unir[i], pdf.unir[i - 1]];
      pintarUnir();
    });
    const bajar = nodo("button", "boton-texto", "↓");
    bajar.type = "button";
    bajar.title = "Bajar en el orden";
    bajar.disabled = i === pdf.unir.length - 1;
    bajar.addEventListener("click", () => {
      [pdf.unir[i + 1], pdf.unir[i]] = [pdf.unir[i], pdf.unir[i + 1]];
      pintarUnir();
    });
    const quitar = nodo("button", "boton-texto", "Quitar");
    quitar.type = "button";
    quitar.addEventListener("click", () => {
      pdf.unir.splice(i, 1);
      pintarUnir();
    });
    grupo.append(subir, bajar, quitar);
    fila.append(grupo);
    fila.addEventListener("dragstart", (e) => {
      arrastreDesde = i;
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(i));
      } catch {
        /* algunos navegadores lo exigen igual */
      }
      fila.classList.add("arrastrando");
    });
    fila.addEventListener("dragend", () => {
      arrastreDesde = -1;
      pintarUnir();
    });
    fila.addEventListener("dragover", (e) => {
      if (arrastreDesde < 0 || arrastreDesde === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = fila.getBoundingClientRect();
      const arriba = (e.clientY - rect.top) < rect.height / 2;
      fila.classList.toggle("destino-arriba", arriba);
      fila.classList.toggle("destino-abajo", !arriba);
      fila.dataset.lado = arriba ? "arriba" : "abajo";
    });
    fila.addEventListener("dragleave", () => {
      fila.classList.remove("destino-arriba", "destino-abajo");
    });
    fila.addEventListener("drop", (e) => {
      e.preventDefault();
      const desde = arrastreDesde;
      if (desde < 0 || desde === i) return;
      const [movida] = pdf.unir.splice(desde, 1);
      const lado = fila.dataset.lado === "arriba" ? 0 : 1;
      let destino = desde < i ? i - 1 + lado : i + lado;
      destino = Math.max(0, Math.min(pdf.unir.length, destino));
      pdf.unir.splice(destino, 0, movida);
      arrastreDesde = -1;
      pintarUnir();
    });
    caja.append(fila);
  }
  $("pdf-unir-boton").disabled = pdf.unir.length < 2;
}

async function unir() {
  await ocupado("pdf-unir-estado", "Uniendo…", async () => {
    const r = await window.vigencia.pdfUnir(pdf.unir);
    if (r?.ok) {
      estado("pdf-unir-estado", `Guardado en ${r.ruta}`);
      avisar("PDF unido y guardado.");
      ofrecerLlevar(r.ruta, { como: "resultado" });
      pdf.unir = [];
      pintarUnir();
    } else if (!r?.cancelado) {
      estado("pdf-unir-estado", r?.error || "No pude unirlos.", true);
      avisar(r?.error || "No pude unirlos.", "error");
    } else {
      estado("pdf-unir-estado", "");
    }
  });
}

// ---------- Un archivo: separar, rotar, firmar ----------

async function elegirUno(clave) {
  const r = await window.vigencia.pdfElegir(false);
  if (!r?.ok || !(r.rutas || []).length) return;
  pdf[clave] = r.rutas[0];
  const info = await pintarUno(clave);
  if (clave === "rellenar") await pintarCampos();
  // Con contraseña no se puede leer: se ofrece después de desbloquear.
  if (clave !== "desbloquear" && clave !== "proteger" && info) ofrecerLlevar(pdf[clave]);
}

async function pintarUno(clave) {
  const ayuda = $(`pdf-${clave}-nombre`);
  const info = await window.vigencia.pdfInfo(pdf[clave]);
  if (!info?.ok) {
    ayuda.textContent = pdf[clave] ? nombreCorto(pdf[clave]) : "Ningún PDF elegido.";
    estado(`pdf-${clave}-estado`, info && pdf[clave] ? (info.error || "") : "", Boolean(info && !info.ok));
    if (clave === "firmar") {
      pdf.firmarInfo = null;
      pintarVistaFirma();
    }
    return null;
  }
  ayuda.textContent = `${info.nombre}: ${info.paginas} ${info.paginas === 1 ? "página" : "páginas"}.`;
  estado(`pdf-${clave}-estado`, "");
  if (clave === "firmar") {
    pdf.firmarInfo = info;
    pintarVistaFirma();
  }
  return info;
}

async function separar() {
  await ocupado("pdf-separar-estado", "Separando…", async () => {
    const r = await window.vigencia.pdfSeparar(pdf.separar, $("pdf-separar-rangos").value);
    if (r?.ok) {
      estado("pdf-separar-estado", `Guardado en ${r.ruta}`);
      avisar("Páginas separadas y guardadas.");
      ofrecerLlevar(r.ruta, { como: "resultado" });
    } else if (!r?.cancelado) {
      estado("pdf-separar-estado", r?.error || "No pude separar.", true);
      avisar(r?.error || "No pude separar.", "error");
    } else {
      estado("pdf-separar-estado", "");
    }
  });
}

async function rotar() {
  await ocupado("pdf-rotar-estado", "Girando…", async () => {
    const r = await window.vigencia.pdfRotar(pdf.rotar, $("pdf-rotar-rangos").value, Number($("pdf-rotar-angulo").value));
    if (r?.ok) {
      estado("pdf-rotar-estado", `Guardado en ${r.ruta}`);
      avisar("PDF girado y guardado.");
      ofrecerLlevar(r.ruta, { como: "resultado" });
    } else if (!r?.cancelado) {
      estado("pdf-rotar-estado", r?.error || "No pude girar.", true);
      avisar(r?.error || "No pude girar.", "error");
    } else {
      estado("pdf-rotar-estado", "");
    }
  });
}

// ---------- Firmar ----------

function lienzo() {
  return $("pdf-firma-lienzo");
}

function trazoVacio() {
  const c = lienzo();
  const ctx = c.getContext("2d");
  const datos = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < datos.length; i += 4) {
    if (datos[i] !== 0) return false;
  }
  return true;
}

function limpiarFirma() {
  const c = lienzo();
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  estado("pdf-firmar-estado", "");
  pintarVistaFirma();
}

// Vista previa: la página en proporción real con la firma puesta donde
// va a quedar. Todo con canvas (la CSP bloquea data: y estilos en línea,
// así que nada de <img> ni style.* aquí).
function firmaHayTrazo() {
  return !trazoVacio();
}

function paginaVista() {
  const detalle = pdf.firmarInfo?.detalle || [];
  const pedido = String($("pdf-firma-paginas").value || "").trim().toLowerCase();
  let indice = 0;
  const m = pedido.match(/^(\d+)/);
  if (m) indice = Math.min(detalle.length - 1, Math.max(0, Number(m[1]) - 1));
  const d = detalle[indice] || { ancho: 612, alto: 792 };
  return { width: Number(d.ancho) || 612, height: Number(d.alto) || 792 };
}

function pintarVistaFirma() {
  const vista = document.querySelector("#pantalla-pdf .pdf-vista");
  const previo = $("pdf-firma-vista-canvas");
  const vacia = $("pdf-firma-vista-vacia");
  if (!vista || !previo) return;
  const pagina = paginaVista();
  const anchoVista = 330;
  const altoVista = Math.max(80, Math.round((anchoVista * pagina.height) / pagina.width));
  previo.width = anchoVista;
  previo.height = altoVista;
  const ctx = previo.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, previo.width, previo.height);
  ctx.strokeStyle = "#c9b8a4";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, previo.width - 2, previo.height - 2);
  if (!firmaHayTrazo()) {
    if (vacia) vacia.hidden = false;
    return;
  }
  if (vacia) vacia.hidden = true;
  const firma = lienzo();
  const ancho = Number($("pdf-firma-ancho").value) || 150;
  const caja = cajaFirma($("pdf-firma-posicion").value, pagina, ancho, ancho / 3);
  const k = previo.width / pagina.width;
  ctx.drawImage(firma, caja.x * k, (pagina.height - caja.y - caja.h) * k, caja.w * k, caja.h * k);
}

function pintarAncho() {
  $("pdf-firma-ancho-valor").textContent = `${$("pdf-firma-ancho").value} px`;
}

async function dibujarImagenEnLienzo(file) {
  // createImageBitmap no pasa por img-src de la CSP (new Image + data: sí
  // lo bloquearía): el lienzo es la única fuente de verdad.
  try {
    const bmp = await createImageBitmap(file);
    const c = lienzo();
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    const escala = Math.min(c.width / bmp.width, c.height / bmp.height, 1);
    const w = bmp.width * escala;
    const h = bmp.height * escala;
    ctx.drawImage(bmp, (c.width - w) / 2, (c.height - h) / 2, w, h);
    if (bmp.close) bmp.close();
    estado("pdf-firmar-estado", "");
    pintarVistaFirma();
  } catch {
    estado("pdf-firmar-estado", "Esa imagen no se pudo leer.", true);
  }
}

function ponerTextoEnLienzo() {
  const texto = String($("pdf-firma-texto").value || "").trim().slice(0, 60);
  if (!texto) {
    estado("pdf-firmar-estado", "Escriba su nombre primero.", true);
    return;
  }
  const c = lienzo();
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#1a2a3a";
  ctx.font = "italic 64px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, c.width / 2, c.height / 2);
  estado("pdf-firmar-estado", "");
  pintarVistaFirma();
}

// ---------- Comprimir ----------

function tamanoHumano(n) {
  const v = Number(n) || 0;
  if (v > 1048576) return `${(v / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(v / 1024))} KB`;
}

async function comprimir() {
  await ocupado("pdf-comprimir-estado", "Comprimiendo…", async () => {
    const r = await window.vigencia.pdfComprimir(pdf.comprimir, $("pdf-comprimir-nivel").value);
    if (r?.ok) {
      const pct = r.antes > 0 ? Math.round((1 - r.despues / r.antes) * 100) : 0;
      estado("pdf-comprimir-estado", `De ${tamanoHumano(r.antes)} a ${tamanoHumano(r.despues)} (${pct}% menos, ${r.nivel}). ${r.tocadas} ${r.tocadas === 1 ? "foto tocada" : "fotos tocadas"}.`);
      avisar(`Comprimido: ${pct}% menos.`);
      ofrecerLlevar(r.ruta, { como: "resultado" });
    } else if (!r?.cancelado) {
      estado("pdf-comprimir-estado", r?.error || "No pude comprimir.", true);
      avisar(r?.error || "No pude comprimir.", "error");
    } else {
      estado("pdf-comprimir-estado", "");
    }
  });
}

// ---------- Proteger y desbloquear ----------

async function proteger() {
  const clave = String($("pdf-proteger-clave").value || "");
  if (!clave) {
    estado("pdf-proteger-estado", "Escriba una contraseña.", true);
    return;
  }
  await ocupado("pdf-proteger-estado", "Protegiendo…", async () => {
    const r = await window.vigencia.pdfProteger(pdf.proteger, clave);
    if (r?.ok) {
      $("pdf-proteger-clave").value = "";
      estado("pdf-proteger-estado", `Guardado en ${r.ruta}. Guarde bien la contraseña: sin ella nadie lo abre.`);
      avisar("PDF protegido y guardado.");
    } else if (!r?.cancelado) {
      estado("pdf-proteger-estado", r?.error || "No pude proteger.", true);
      avisar(r?.error || "No pude proteger.", "error");
    } else {
      estado("pdf-proteger-estado", "");
    }
  });
}

async function desbloquear() {
  const clave = String($("pdf-desbloquear-clave").value || "");
  if (!clave) {
    estado("pdf-desbloquear-estado", "Escriba la contraseña actual.", true);
    return;
  }
  await ocupado("pdf-desbloquear-estado", "Abriendo…", async () => {
    const r = await window.vigencia.pdfDesbloquear(pdf.desbloquear, clave);
    if (r?.ok) {
      $("pdf-desbloquear-clave").value = "";
      estado("pdf-desbloquear-estado", `Guardado en ${r.ruta}, ya sin contraseña.`);
      avisar("PDF desbloqueado y guardado.");
      ofrecerLlevar(r.ruta, { como: "resultado" });
    } else if (r?.cancelado && r.temporal) {
      // No guardó copia, pero la versión sin contraseña sirve para la IA.
      $("pdf-desbloquear-clave").value = "";
      estado("pdf-desbloquear-estado", "No guardó copia. Igual puede llevarlo a la IA desde Usar con la IA.");
      ofrecerLlevar(r.temporal, { como: "temporal", nombre: r.nombre });
    } else if (!r?.cancelado) {
      estado("pdf-desbloquear-estado", r?.error || "No pude abrirlo.", true);
      avisar(r?.error || "No pude abrirlo.", "error");
    } else {
      estado("pdf-desbloquear-estado", "");
    }
  });
}

// ---------- Rellenar ----------

async function pintarCampos() {
  const caja = $("pdf-rellenar-campos");
  caja.replaceChildren();
  if (!pdf.rellenar) return;
  const r = await window.vigencia.pdfCampos(pdf.rellenar);
  if (!r?.ok) {
    estado("pdf-rellenar-estado", r?.error || "No pude leer los campos.", true);
    return;
  }
  estado("pdf-rellenar-estado", `${r.total} ${r.total === 1 ? "campo" : "campos"}.`);
  for (const c of r.campos || []) {
    const l = nodo("label", "pdf-campo");
    l.append(nodo("span", "etiqueta", c.nombre));
    if (c.tipo === "casilla") {
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.dataset.campo = c.nombre;
      l.append(casilla);
    } else if (c.tipo === "lista" || c.tipo === "opcion") {
      const sel = document.createElement("select");
      sel.dataset.campo = c.nombre;
      sel.replaceChildren(opcion("", "Sin elegir"), ...(c.opciones || []).map((o) => opcion(o, o)));
      if (c.actual) sel.value = c.actual;
      l.append(sel);
    } else if (c.tipo === "lista-multiple") {
      const sel = document.createElement("select");
      sel.multiple = true;
      sel.dataset.campo = c.nombre;
      sel.replaceChildren(...(c.opciones || []).map((o) => opcion(o, o)));
      l.append(sel);
    } else if (c.tipo === "firma-digital") {
      l.append(nodo("span", "ayuda", "Firma certificada: se firma a mano en Firmar."));
    } else {
      const campo = document.createElement("input");
      campo.dataset.campo = c.nombre;
      campo.value = c.actual || "";
      campo.maxLength = 500;
      campo.autocomplete = "off";
      l.append(campo);
    }
    caja.append(l);
  }
}

async function rellenar() {
  const valores = {};
  for (const el of document.querySelectorAll("#pdf-rellenar-campos [data-campo]")) {
    const nombre = el.dataset.campo;
    if (el.type === "checkbox") valores[nombre] = el.checked;
    else if (el.multiple) valores[nombre] = [...el.selectedOptions].map((o) => o.value);
    else valores[nombre] = el.value;
  }
  await ocupado("pdf-rellenar-estado", "Guardando…", async () => {
    const r = await window.vigencia.pdfRellenar(pdf.rellenar, valores, $("pdf-rellenar-aplanar").checked);
    if (r?.ok) {
      estado("pdf-rellenar-estado", `Guardado en ${r.ruta}.`);
      avisar("Formulario diligenciado y guardado.");
      ofrecerLlevar(r.ruta, { como: "resultado" });
    } else if (!r?.cancelado) {
      estado("pdf-rellenar-estado", r?.error || "No pude guardar.", true);
      avisar(r?.error || "No pude guardar.", "error");
    } else {
      estado("pdf-rellenar-estado", "");
    }
  });
}

// ---------- Comparar ----------

async function elegirComparar(cual) {
  const r = await window.vigencia.pdfElegir(false);
  if (!r?.ok || !(r.rutas || []).length) return;
  ofrecerLlevar(r.rutas[0]);
  if (cual === "a") {
    pdf.compararA = r.rutas[0];
    $("pdf-comparar-nombre-a").textContent = `Primero: ${nombreCorto(pdf.compararA)}.`;
  } else {
    pdf.compararB = r.rutas[0];
    $("pdf-comparar-nombre-b").textContent = `Segundo: ${nombreCorto(pdf.compararB)}.`;
  }
}

async function comparar() {
  await ocupado("pdf-comparar-estado", "Comparando…", async () => {
    const r = await window.vigencia.pdfComparar(pdf.compararA, pdf.compararB);
    if (!r?.ok) {
      estado("pdf-comparar-estado", r?.error || "No pude comparar.", true);
      avisar(r?.error || "No pude comparar.", "error");
      return;
    }
  const dif = diferencias(r.textoA || "", r.textoB || "");
  const caja = $("pdf-detalle");
  caja.replaceChildren();
  const tarjeta = nodo("div", "juris-card");
  tarjeta.append(nodo("p", "doc-dif-resumen", `Del primero al segundo: ${dif.cuenta.agregado} agregados, ${dif.cuenta.cambiado} cambiados y ${dif.cuenta.quitado} quitados.`));
  for (const grupo of dif.secciones) {
    const hay = grupo.cambios.some((c) => c.tipo !== "igual");
    if (!hay) continue;
    const sec = nodo("section", "doc-dif-seccion");
    sec.append(nodo("h3", "", grupo.seccion));
    for (const c of grupo.cambios) {
      if (c.tipo === "igual") continue;
      if (c.tipo === "cambiado") sec.append(nodo("p", "doc-dif-quitado", c.antes), nodo("p", "doc-dif-agregado", c.texto));
      else sec.append(nodo("p", c.tipo === "agregado" ? "doc-dif-agregado" : "doc-dif-quitado", c.texto));
    }
    tarjeta.append(sec);
  }
  if (!tarjeta.querySelector(".doc-dif-seccion")) tarjeta.append(nodo("p", "ayuda", "Dicen lo mismo."));
  caja.append(tarjeta);
  caja.scrollIntoView({ block: "start" });
  estado("pdf-comparar-estado", "");
  avisar("Comparación lista.");
  });
}

async function firmar() {
  if (trazoVacio()) {
    estado("pdf-firmar-estado", "Dibuje, suba o escriba primero su firma.", true);
    return;
  }
  await ocupado("pdf-firmar-estado", "Firmando…", async () => {
    const r = await window.vigencia.pdfFirmar({
      ruta: pdf.firmar,
      firma: lienzo().toDataURL("image/png"),
      paginas: $("pdf-firma-paginas").value,
      posicion: $("pdf-firma-posicion").value,
      ancho: Number($("pdf-firma-ancho").value),
    });
    if (r?.ok) {
      estado("pdf-firmar-estado", `Guardado en ${r.ruta}`);
      avisar("PDF firmado y guardado.");
      ofrecerLlevar(r.ruta, { como: "resultado" });
    } else if (!r?.cancelado) {
      estado("pdf-firmar-estado", r?.error || "No pude firmar.", "error");
      avisar(r?.error || "No pude firmar.", "error");
    } else {
      estado("pdf-firmar-estado", "");
    }
  });
}

function iniciarLienzo() {
  const c = lienzo();
  const escala = window.devicePixelRatio || 1;
  c.width = 600 * escala;
  c.height = 200 * escala;
  const ctx = c.getContext("2d");
  ctx.scale(escala, escala);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1a2a3a";
  let dibujando = false;
  let x = 0;
  let y = 0;
  const punto = (e) => {
    const rect = c.getBoundingClientRect();
    return [(e.clientX - rect.left) * (600 / rect.width), (e.clientY - rect.top) * (200 / rect.height)];
  };
  c.addEventListener("pointerdown", (e) => {
    dibujando = true;
    [x, y] = punto(e);
    try {
      c.setPointerCapture(e.pointerId);
    } catch {
      /* ratones y táctiles reales siempre traen puntero activo */
    }
  });
  c.addEventListener("pointermove", (e) => {
    if (!dibujando) return;
    const [nx, ny] = punto(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    x = nx;
    y = ny;
  });
  const soltar = () => {
    if (!dibujando) return;
    dibujando = false;
    pintarVistaFirma();
  };
  c.addEventListener("pointerup", soltar);
  c.addEventListener("pointercancel", soltar);
}

// ---------- Arranque ----------

export async function abrirPdf() {
  await pintarUnir();
  await llenarProyectos($("pdf-llevar-proyecto"), { vacio: "Elija un proyecto" });
}

export function iniciarPdf() {
  if (pdf.listo) return;
  pdf.listo = true;
  for (const h of HERRAMIENTAS_PDF) {
    $(`pdf-tab-${h}`).addEventListener("click", () => elegirHerramienta(h));
  }
  // Soltar un PDF sobre Usar con la IA también lo deja listo.
  const llevarZona = $("pdf-llevar");
  llevarZona.addEventListener("dragover", (e) => {
    e.preventDefault();
    llevarZona.classList.add("sobre");
  });
  llevarZona.addEventListener("dragleave", () => llevarZona.classList.remove("sobre"));
  llevarZona.addEventListener("drop", (e) => {
    e.preventDefault();
    llevarZona.classList.remove("sobre");
    const ruta = [...(e.dataTransfer?.files || [])].map((f) => window.vigencia.rutaDeArchivo(f)).find((r) => /\.pdf$/i.test(r || ""));
    if (ruta) ofrecerLlevar(ruta);
    else estado("pdf-llevar-estado", "Suelte un archivo PDF.", true);
  });
  $("pdf-llevar-convertir").addEventListener("click", () => llevar(false));
  $("pdf-llevar-contexto").addEventListener("click", () => llevar(true));
  $("pdf-llevar-ver").addEventListener("click", () => {
    if (pdf.llevado?.archivoId) irA({ a: "convertir", archivoId: pdf.llevado.archivoId });
  });
  $("pdf-llevar-abrir").addEventListener("click", () => {
    if (pdf.llevado?.proyectoId) irA({ a: "documentos", proyectoId: pdf.llevado.proyectoId, contexto: true });
  });
  $("pdf-elegir-unir").addEventListener("click", async () => {
    const r = await window.vigencia.pdfElegir(true);
    if (r?.ok) {
      await agregarUnir(r.rutas);
      if (r.rutas?.length === 1) ofrecerLlevar(r.rutas[0]);
    }
  });
  const zona = $("pdf-soltar");
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("sobre");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
  zona.addEventListener("drop", async (e) => {
    e.preventDefault();
    zona.classList.remove("sobre");
    const rutas = [...(e.dataTransfer?.files || [])].map((f) => window.vigencia.rutaDeArchivo(f)).filter(Boolean);
    if (rutas.length) {
      await agregarUnir(rutas);
      avisar(rutas.length === 1 ? "PDF agregado." : `${rutas.length} PDF agregados.`);
    }
  });
  $("pdf-unir-boton").addEventListener("click", unir);
  $("pdf-unir-limpiar").addEventListener("click", () => {
    pdf.unir = [];
    pintarUnir();
  });
  for (const clave of ["separar", "rotar", "firmar", "comprimir", "proteger", "desbloquear", "rellenar"]) {
    $(`pdf-elegir-${clave}`).addEventListener("click", () => elegirUno(clave));
  }
  $("pdf-elegir-comparar-a").addEventListener("click", () => elegirComparar("a"));
  $("pdf-elegir-comparar-b").addEventListener("click", () => elegirComparar("b"));
  $("pdf-rotar-angulo").replaceChildren(...ANGULOS.map((g) => opcion(String(g), `${g}°`)));
  $("pdf-comprimir-nivel").replaceChildren(...NIVELES_COMPRIMIR.map((n) => opcion(n.id, n.nombre)));
  $("pdf-comprimir-nivel").value = "media";
  $("pdf-separar-boton").addEventListener("click", separar);
  $("pdf-rotar-boton").addEventListener("click", rotar);
  $("pdf-firma-posicion").replaceChildren(...POSICIONES_FIRMA.map((p) => opcion(p.id, p.nombre)));
  $("pdf-firma-ancho").addEventListener("input", () => {
    pintarAncho();
    pintarVistaFirma();
  });
  $("pdf-firma-posicion").addEventListener("change", pintarVistaFirma);
  $("pdf-firma-paginas").addEventListener("input", pintarVistaFirma);
  pintarAncho();
  $("pdf-firma-limpiar").addEventListener("click", limpiarFirma);
  $("pdf-firmar-boton").addEventListener("click", firmar);
  $("pdf-firma-subir").addEventListener("click", () => $("pdf-firma-archivo").click());
  $("pdf-firma-archivo").addEventListener("change", () => {
    const f = $("pdf-firma-archivo").files?.[0];
    $("pdf-firma-archivo").value = "";
    if (!f) return;
    dibujarImagenEnLienzo(f);
  });
  $("pdf-firma-poner-texto").addEventListener("click", ponerTextoEnLienzo);
  $("pdf-firma-texto").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ponerTextoEnLienzo();
    }
  });
  $("pdf-comprimir-boton").addEventListener("click", comprimir);
  $("pdf-proteger-boton").addEventListener("click", proteger);
  $("pdf-desbloquear-boton").addEventListener("click", desbloquear);
  $("pdf-rellenar-boton").addEventListener("click", rellenar);
  $("pdf-comparar-boton").addEventListener("click", comparar);
  iniciarLienzo();
}
