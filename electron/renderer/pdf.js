// Pantalla Herramientas PDF: unir, separar, rotar y firmar. Todo pasa en
// este computador (pdf-lib); la ventana solo elige archivos y avisa.
import { ANGULOS, NIVELES_COMPRIMIR } from "../compartido/pdftools.js";
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
  firmar: ["Firmar", "Pone su firma donde usted la arrastre, con constancia verificable.", ["Elija el PDF y acomode la firma sobre la página.", "Escriba quien firma y acepte la declaración.", "Firme, guarde y verifique cuando quiera."]],
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
  if (cual === "firmar") {
    pintarVistaFirma();
    cargarPerfilesFirma();
  }
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
      prepararFirma();
    }
    return null;
  }
  ayuda.textContent = `${info.nombre}: ${info.paginas} ${info.paginas === 1 ? "página" : "páginas"}.`;
  estado(`pdf-${clave}-estado`, "");
  if (clave === "firmar") {
      pdf.firmarInfo = info;
      prepararFirma();
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

// ---------- Firmar: la página de verdad, la firma donde usted la ponga ----------
// Todo en canvas (la CSP bloquea data: y estilos en línea): la página se
// dibuja con pdfjs y la firma se arrastra con el dedo o el ratón.

let visorMod = null;
const firma = {
  doc: null, paginas: 0, pagina: 1, datos: null,
  caja: null, // {x, y, w} en puntos PDF, y medida desde abajo
  memoria: new Map(), // página -> canvas ya dibujado (máximo 5)
  turno: 0,
  accion: null, // {modo: "mover"|"agrandar", dx, dy}
  verificarRuta: "",
};

async function visor() {
  if (!visorMod) visorMod = await import("./vendor/visor.js");
  return visorMod;
}

function detallePaginaFirma() {
  const d = pdf.firmarInfo?.detalle?.[firma.pagina - 1];
  return { width: Number(d?.ancho) || 612, height: Number(d?.alto) || 792 };
}

function altoCaja(w) {
  const c = lienzo();
  const aspecto = c.height / Math.max(1, c.width);
  return Math.max(24, w * aspecto);
}

function cajaDefecto() {
  const p = detallePaginaFirma();
  const w = Math.min(Number($("pdf-firma-ancho").value) || 150, p.width - 20);
  return { x: Math.max(10, (p.width - w) / 2), y: 80, w };
}

function prepararFirma() {
  firma.pagina = 1;
  firma.caja = null;
  firma.datos = null;
  firma.memoria.clear();
  cerrarDocFirma();
  pintarVistaFirma();
  cargarPerfilesFirma();
}

async function cerrarDocFirma() {
  try {
    await visorMod?.cerrarPdf(firma.doc);
  } catch {
    /* ya cerrado */
  }
  firma.doc = null;
}

async function paginaDibujada(pagina) {
  const guardada = firma.memoria.get(pagina);
  if (guardada) return guardada;
  const v = await visor();
  if (!firma.datos) {
    const r = await window.vigencia.pdfArchivo(pdf.firmar);
    if (!r?.ok) throw new Error(r?.error || "No pude leer el PDF.");
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    firma.datos = bytes;
    firma.paginas = r.paginas || 0;
  }
  if (!firma.doc) {
    const { doc, paginas } = await v.cargarPdf(firma.datos);
    firma.doc = doc;
    firma.paginas = paginas;
  }
  const p = detallePaginaFirma();
  const escala = Math.min(1.5, 560 / p.width);
  const copia = document.createElement("canvas");
  await v.pintarPagina(firma.doc, pagina, copia, escala);
  firma.memoria.set(pagina, copia);
  while (firma.memoria.size > 5) firma.memoria.delete(firma.memoria.keys().next().value);
  return copia;
}

function rectEnVista() {
  const vista = $("pdf-firma-vista-canvas");
  const p = detallePaginaFirma();
  const k = vista.width / p.width;
  const c = firma.caja || cajaDefecto();
  const h = altoCaja(c.w);
  return { x: c.x * k, y: (p.height - c.y - h) * k, w: c.w * k, h: h * k, k };
}

async function pintarVistaFirma() {
  const turno = ++firma.turno;
  const previo = $("pdf-firma-vista-canvas");
  const vacia = $("pdf-firma-vista-vacia");
  if (!previo) return;
  const total = pdf.firmarInfo?.paginas || 0;
  if (!pdf.firmar || !total) {
    $("pdf-firma-pagina-num").textContent = "Sin PDF";
    previo.width = 330;
    previo.height = 120;
    const ctx = previo.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, previo.width, previo.height);
    if (vacia) vacia.hidden = false;
    return;
  }
  firma.pagina = Math.min(total, Math.max(1, firma.pagina));
  $("pdf-firma-pagina-num").textContent = `Página ${firma.pagina} de ${total}`;
  if (vacia) vacia.hidden = true;
  try {
    const copia = await paginaDibujada(firma.pagina);
    if (turno !== firma.turno) return;
    previo.width = copia.width;
    previo.height = copia.height;
    const ctx = previo.getContext("2d");
    ctx.drawImage(copia, 0, 0);
  } catch (error) {
    if (turno !== firma.turno) return;
    estado("pdf-firmar-estado", error?.message || "No pude dibujar la página. Igual puede firmar con tamaño y página.", true);
    return;
  }
  if (!firmaHayTrazo()) return;
  if (!firma.caja) firma.caja = cajaDefecto();
  const ctx = previo.getContext("2d");
  const r = rectEnVista();
  ctx.drawImage(lienzo(), r.x, r.y, r.w, r.h);
  ctx.strokeStyle = "#17456e";
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  const lado = 12;
  ctx.fillStyle = "#17456e";
  ctx.fillRect(r.x + r.w - lado, r.y + r.h - lado, lado, lado);
}

function vistaAPdf(cx, cy) {
  const vista = $("pdf-firma-vista-canvas");
  const p = detallePaginaFirma();
  const k = vista.width / p.width;
  return { x: cx / k, y: p.height - cy / k };
}

function iniciarArrastreFirma() {
  const vista = $("pdf-firma-vista-canvas");
  const punto = (e) => {
    const rect = vista.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (vista.width / rect.width), y: (e.clientY - rect.top) * (vista.height / rect.height) };
  };
  vista.addEventListener("pointerdown", (e) => {
    if (!pdf.firmar || !firmaHayTrazo()) return;
    e.preventDefault();
    if (!firma.caja) firma.caja = cajaDefecto();
    const { x, y } = punto(e);
    const r = rectEnVista();
    const lado = 14;
    if (x >= r.x + r.w - lado && x <= r.x + r.w && y >= r.y + r.h - lado && y <= r.y + r.h) {
      firma.accion = { modo: "agrandar" };
    } else if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      firma.accion = { modo: "mover", dx: x - r.x, dy: y - r.y };
    } else {
      // Clic afuera: la firma se centra ahí, como en Adobe.
      const p = detallePaginaFirma();
      const w = firma.caja.w;
      const q = vistaAPdf(x, y);
      const h = altoCaja(w);
      firma.caja = {
        x: Math.min(Math.max(10, q.x - w / 2), Math.max(10, p.width - w - 10)),
        y: Math.min(Math.max(10, q.y - h / 2), Math.max(10, p.height - h - 10)),
        w,
      };
      pintarVistaFirma();
      return;
    }
    try {
      vista.setPointerCapture(e.pointerId);
    } catch {
      /* ratones y táctiles reales siempre traen puntero activo */
    }
  });
  vista.addEventListener("pointermove", (e) => {
    if (!firma.accion) return;
    const { x, y } = punto(e);
    const p = detallePaginaFirma();
    const vistaEl = $("pdf-firma-vista-canvas");
    const k = vistaEl.width / p.width;
    if (firma.accion.modo === "agrandar") {
      const arriba = vistaAPdf(x, y);
      const w = Math.min(Math.max(40, arriba.x - firma.caja.x), p.width - 20);
      firma.caja.w = w;
      firma.caja.x = Math.min(Math.max(10, firma.caja.x), Math.max(10, p.width - w - 10));
      const h = altoCaja(w);
      firma.caja.y = Math.min(Math.max(10, firma.caja.y), Math.max(10, p.height - h - 10));
      $("pdf-firma-ancho").value = Math.round(Math.min(350, Math.max(60, w)));
      pintarAncho();
    } else {
      const h = altoCaja(firma.caja.w);
      const nx = (x - firma.accion.dx) / k;
      const arriba = (y - firma.accion.dy) / k;
      firma.caja.x = Math.min(Math.max(10, nx), Math.max(10, p.width - firma.caja.w - 10));
      firma.caja.y = Math.min(Math.max(10, p.height - arriba - h), Math.max(10, p.height - h - 10));
    }
    pintarVistaFirma();
  });
  const soltar = () => {
    firma.accion = null;
  };
  vista.addEventListener("pointerup", soltar);
  vista.addEventListener("pointercancel", soltar);
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
      l.append(nodo("span", "ayuda", "Firma de certificado: se firma en Firmar (firma electrónica con constancia)."));
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
  if (!pdf.firmar) {
    estado("pdf-firmar-estado", "Elija primero el PDF.", true);
    return;
  }
  if (trazoVacio()) {
    estado("pdf-firmar-estado", "Dibuje, suba, escriba o use una firma guardada.", true);
    return;
  }
  const firmante = String($("pdf-firmante-nombre").value || "").trim();
  if (!firmante) {
    estado("pdf-firmar-estado", "Escriba quien firma (nombre del firmante).", true);
    return;
  }
  if (!$("pdf-firma-declaracion").checked) {
    estado("pdf-firmar-estado", "Marque la declaración de aprobación para firmar.", true);
    return;
  }
  if (!firma.caja) firma.caja = cajaDefecto();
  await ocupado("pdf-firmar-estado", "Firmando…", async () => {
    const r = await window.vigencia.pdfFirmar({
      ruta: pdf.firmar,
      firma: lienzo().toDataURL("image/png"),
      paginas: $("pdf-firma-paginas").value,
      ancho: Number($("pdf-firma-ancho").value),
      caja: { pagina: firma.pagina, x: Math.round(firma.caja.x), y: Math.round(firma.caja.y), ancho: Math.round(firma.caja.w) },
      firmante,
      documento: $("pdf-firmante-doc").value,
    });
    if (r?.ok) {
      estado("pdf-firmar-estado", `Firmado con código ${r.codigo}. Guardado en ${r.ruta}`);
      avisar(`Firmado con código ${r.codigo}.`);
      ofrecerLlevar(r.ruta, { como: "resultado" });
    } else if (!r?.cancelado) {
      estado("pdf-firmar-estado", r?.error || "No pude firmar.", "error");
      avisar(r?.error || "No pude firmar.", "error");
    } else {
      estado("pdf-firmar-estado", "");
    }
  });
}

// ---------- Firmas guardadas (reutilizar la misma) ----------

function base64ABitmap(base64) {
  const bin = atob(String(base64 || "").replace(/^data:image\/\w+;base64,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

async function volcarBitmap(bmp) {
  const c = lienzo();
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const escala = Math.min(c.width / bmp.width, c.height / bmp.height);
  const w = bmp.width * escala;
  const h = bmp.height * escala;
  ctx.drawImage(bmp, (c.width - w) / 2, (c.height - h) / 2, w, h);
  if (bmp.close) bmp.close();
  estado("pdf-firmar-estado", "");
  pintarVistaFirma();
}

async function cargarPerfilesFirma() {
  const sel = $("pdf-firma-perfil");
  if (!sel) return;
  sel.replaceChildren();
  const nada = document.createElement("option");
  nada.value = "";
  nada.textContent = "Sin firmas guardadas";
  sel.append(nada);
  try {
    const r = await window.vigencia.firmasListar();
    for (const f of r?.firmas || []) {
      const o = document.createElement("option");
      o.value = String(f.id);
      o.textContent = f.nombre;
      sel.append(o);
    }
    if ((r?.firmas || []).length) nada.textContent = "Elija una firma";
  } catch {
    /* la lista queda vacía */
  }
}

async function usarPerfilFirma() {
  const id = $("pdf-firma-perfil").value;
  if (!id) {
    estado("pdf-firmar-estado", "Elija primero una firma guardada.", true);
    return;
  }
  const r = await window.vigencia.firmaLeer(id);
  if (!r?.ok) {
    estado("pdf-firmar-estado", r?.error || "No pude leer esa firma.", true);
    return;
  }
  try {
    await volcarBitmap(await createImageBitmap(base64ABitmap(r.firma.png)));
    avisar(`Firma ${r.firma.nombre} lista para acomodar.`);
  } catch {
    estado("pdf-firmar-estado", "Esa firma guardada no se pudo dibujar.", true);
  }
}

async function guardarPerfilFirma() {
  if (trazoVacio()) {
    estado("pdf-firmar-estado", "Dibuje, suba o escriba primero su firma.", true);
    return;
  }
  const nombre = String($("pdf-firma-guardar-nombre").value || "").trim();
  const r = await window.vigencia.firmaGuardar({ nombre, png: lienzo().toDataURL("image/png") });
  if (!r?.ok) {
    estado("pdf-firmar-estado", r?.error || "No pude guardarla.", true);
    avisar(r?.error || "No pude guardarla.", "error");
    return;
  }
  $("pdf-firma-guardar-nombre").value = "";
  await cargarPerfilesFirma();
  $("pdf-firma-perfil").value = String(r.id);
  avisar(`Firma ${r.nombre} guardada.`);
}

async function borrarPerfilFirma() {
  const id = $("pdf-firma-perfil").value;
  if (!id) {
    estado("pdf-firmar-estado", "Elija primero una firma guardada.", true);
    return;
  }
  const nombre = $("pdf-firma-perfil").selectedOptions[0]?.textContent || "esa firma";
  if (!window.confirm(`Borrar ${nombre} de este computador?`)) return;
  const r = await window.vigencia.firmaBorrar(id);
  if (!r?.ok) {
    estado("pdf-firmar-estado", r?.error || "No pude borrarla.", true);
    return;
  }
  await cargarPerfilesFirma();
  avisar("Firma borrada.");
}

// ---------- Verificar un firmado ----------

async function verificarFirmado() {
  const caja = $("pdf-verificar-resultado");
  caja.replaceChildren();
  if (!firma.verificarRuta) {
    estado("pdf-verificar-estado", "Elija primero el PDF firmado.", true);
    return;
  }
  await ocupado("pdf-verificar-estado", "Verificando…", async () => {
    const r = await window.vigencia.pdfVerificar(firma.verificarRuta);
    if (!r?.ok) {
      estado("pdf-verificar-estado", r?.error || "No pude verificar.", true);
      avisar(r?.error || "No pude verificar.", "error");
      return;
    }
    estado("pdf-verificar-estado", "");
    const tarjeta = nodo("div", "tarjeta");
    if (r.integro) {
      tarjeta.append(nodo("p", "titulo-lista", "Íntegro: nadie lo cambió después de la firma."));
      const lineas = [`Código ${r.codigo}`];
      if (r.firmante) lineas.push(`Firmó ${r.firmante}${r.documento ? ` (${r.documento})` : ""}`);
      if (r.fecha) lineas.push(`El ${String(r.fecha).slice(0, 10)}`);
      if (r.paginas) lineas.push(`Páginas ${r.paginas}`);
      if (!r.enRegistro) lineas.push("La constancia viene en el PDF; el registro local no está en este computador.");
      tarjeta.append(nodo("p", "meta", lineas.join(" · ")));
      avisar("Firma íntegra.");
    } else {
      tarjeta.append(nodo("p", "titulo-lista", "Alterado: el contenido ya no coincide con la constancia."));
      tarjeta.append(nodo("p", "meta", `Código ${r.codigo}. El hash de hoy es distinto del que se firmó.`));
      avisar("El documento fue alterado.", "error");
    }
    caja.append(tarjeta);
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
  $("pdf-firma-ancho").addEventListener("input", () => {
    pintarAncho();
    if (firma.caja) {
      const p = detallePaginaFirma();
      firma.caja.w = Math.min(Math.max(40, Number($("pdf-firma-ancho").value) || 150), p.width - 20);
    }
    pintarVistaFirma();
  });
  $("pdf-firma-anterior").addEventListener("click", () => {
    firma.pagina -= 1;
    pintarVistaFirma();
  });
  $("pdf-firma-siguiente").addEventListener("click", () => {
    firma.pagina += 1;
    pintarVistaFirma();
  });
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
  $("pdf-firma-usar").addEventListener("click", usarPerfilFirma);
  $("pdf-firma-guardar-boton").addEventListener("click", guardarPerfilFirma);
  $("pdf-firma-borrar-perfil").addEventListener("click", borrarPerfilFirma);
  $("pdf-verificar-elegir").addEventListener("click", async () => {
    const r = await window.vigencia.pdfElegir(false);
    if (!r?.ok || !(r.rutas || []).length) return;
    firma.verificarRuta = r.rutas[0];
    $("pdf-verificar-nombre").textContent = nombreCorto(firma.verificarRuta);
    $("pdf-verificar-resultado").replaceChildren();
    estado("pdf-verificar-estado", "");
  });
  $("pdf-verificar-boton").addEventListener("click", verificarFirmado);
  $("pdf-comprimir-boton").addEventListener("click", comprimir);
  $("pdf-proteger-boton").addEventListener("click", proteger);
  $("pdf-desbloquear-boton").addEventListener("click", desbloquear);
  $("pdf-rellenar-boton").addEventListener("click", rellenar);
  $("pdf-comparar-boton").addEventListener("click", comparar);
  iniciarLienzo();
  iniciarArrastreFirma();
}
