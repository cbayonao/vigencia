// Firmar como en Adobe (Rellenar y firmar): el PDF se ve en la ventana con
// pdfjs (vendor/visor.js), el usuario arrastra firmas guardadas y campos
// de texto a cualquier página, los mueve, agranda, duplica o quita, y
// src/pdftools.js los estampa con pdf-lib en un PDF nuevo.
// Todo se dibuja en canvas: la CSP no deja estilos en línea ni data: en
// <img>. Cada marca guarda su caja en puntos de la página tal como se ve
// (zoom 1, ya girada y recortada); cajaAPdf en compartido/pdftools.js es
// la única que la pasa al espacio del PDF.
import { TEXTO_ALTO, fechaHoy, lineaDeTexto, parsearRangos, tamanoVista } from "../compartido/pdftools.js";
import { avisar } from "./aviso.js";
import { aBytes, abrirDoc, cerrarDoc, crearVisor, limitar } from "./paginas.js";
import { alAbrir, estado, nodo, nombreCorto, ocupado, ofrecerLlevar, pdf, pintarUno } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const FUENTE_FIRMA = "Firma Vigencia"; // Great Vibes (OFL), renderer/fuentes
const LETRA_CAMPO = "Helvetica, Arial, sans-serif"; // la que pone pdf-lib
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const MANIJA = 6; // medio lado de la manija, en píxeles de pantalla
const MAX_HISTORIA = 50;
const MAX_MEMORIA = 12;

const f = {
  firmas: [], imagenes: new Map(), // id de la firma -> { png, bmp, aspecto }
  marcas: [], sel: null, armada: null, arrastrada: null, historia: [], accion: null, sigId: 1,
  trazos: [], firmado: "", verificarRuta: "", turno: 0,
};

const aviso = (mensaje, error = true) => estado("pdf-firmar-estado", mensaje, error);

// ---------- Visor (renderer/paginas.js, el mismo de las otras herramientas) ----------

let vista = null;

export function mostrarVisorFirma(si) {
  $("firma-visor").hidden = !si;
  if (si) cargarFirmas();
}

function crearVista() {
  vista ||= crearVisor({
    caja: $("firma-paginas"),
    clase: "firma-pagina",
    alCrear: escucharPagina,
    encima: dibujarMarcas,
    maxMemoria: MAX_MEMORIA,
    alCambiarPagina: pintarBarra,
  });
  return vista;
}

async function abrirFirma(info) {
  const turno = ++f.turno;
  const v = crearVista();
  const viejo = v.doc;
  v.vaciar();
  cerrarDoc(viejo);
  Object.assign(f, { marcas: [], sel: null, historia: [] });
  $("firma-pista").textContent = info ? "Abriendo el PDF." : "Elija a la izquierda el PDF que va a firmar.";
  pintarBarra();
  if (!info || !pdf.firmar) return;
  let doc;
  try {
    doc = await abrirDoc(pdf.firmar);
    if (turno !== f.turno) return cerrarDoc(doc);
  } catch (error) {
    $("firma-pista").textContent = "";
    aviso(error?.message || "No pude abrir el PDF.");
    return;
  }
  $("firma-pista").textContent = "Arrastre una firma o un campo a la página, o tóquelo y luego toque la página. Mueva con el ratón, agrande desde las esquinas, Supr quita.";
  v.paginas = info.detalle || [];
  v.zoom = v.zoomAncho(ZOOM_MIN, 1.5);
  v.armar(doc, info.detalle || []);
  pintarBarra();
}

function cambiarZoom(z) {
  vista?.cambiarZoom(z, ZOOM_MIN, ZOOM_MAX);
  pintarBarra();
}

// Encima del dibujo de pdfjs: las marcas, con borde y manijas en la elegida.
function dibujarMarcas(n, ctx, z) {
  for (const m of f.marcas) {
    if (m.pagina !== n) continue;
    if (m.tipo === "texto") {
      const { tamano, base } = lineaDeTexto(m);
      ctx.fillStyle = "#0d0d0d";
      ctx.font = `${tamano * z}px ${LETRA_CAMPO}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(m.texto, base.x * z, (base.y + base.h) * z);
    } else {
      const img = f.imagenes.get(m.firmaId);
      if (img) ctx.drawImage(img.bmp, m.x * z, m.y * z, m.w * z, m.h * z);
    }
    if (m.id !== f.sel) continue;
    ctx.strokeStyle = "#17456e";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(m.x * z, m.y * z, m.w * z, m.h * z);
    ctx.setLineDash([]);
    for (const [x, y] of esquinas(m)) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x * z - MANIJA, y * z - MANIJA, MANIJA * 2, MANIJA * 2);
      ctx.strokeRect(x * z - MANIJA, y * z - MANIJA, MANIJA * 2, MANIJA * 2);
    }
  }
}

const componer = (n) => vista?.componer(n);
const componerTodas = () => vista?.componerTodas();

// ---------- Marcas: poner, mover, agrandar, duplicar, quitar, deshacer ----------

const esquinas = (m) => [[m.x, m.y], [m.x + m.w, m.y], [m.x, m.y + m.h], [m.x + m.w, m.y + m.h]];

function esquinaEn(m, p) {
  const r = (MANIJA * 1.6) / vista.zoom;
  return esquinas(m).findIndex(([x, y]) => Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r);
}

function marcaEn(n, p) {
  for (let i = f.marcas.length - 1; i >= 0; i--) {
    const m = f.marcas[i];
    if (m.pagina === n && p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h) return m;
  }
  return null;
}

function puntoEn(c, e) {
  const r = c.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * (c.width / r.width)) / vista.zoom, y: ((e.clientY - r.top) * (c.height / r.height)) / vista.zoom };
}

function guardarHistoria(antes = f.marcas.map((m) => ({ ...m }))) {
  f.historia.push(antes);
  if (f.historia.length > MAX_HISTORIA) f.historia.shift();
}

function elegir(id) {
  const antes = f.marcas.find((m) => m.id === f.sel)?.pagina;
  f.sel = id;
  const ahora = f.marcas.find((m) => m.id === id);
  if (antes) componer(antes);
  if (ahora && ahora.pagina !== antes) componer(ahora.pagina);
  if (ahora?.tipo === "texto") $("firma-letra").value = String(Math.round(lineaDeTexto(ahora).tamano));
  pintarBarra();
}

function letra() {
  return limitar(Math.round(Number($("firma-letra").value) || 11), 6, 48);
}

function medirTexto(texto, tamano) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${tamano}px ${LETRA_CAMPO}`;
  return { w: Math.max(4, ctx.measureText(texto).width), h: tamano * TEXTO_ALTO };
}

function textoDeCampo(campo) {
  if (campo === "fecha") return fechaHoy();
  const texto = String($(campo === "nombre" ? "pdf-firmante-nombre" : "firma-texto-libre").value || "").replace(/\s+/g, " ").trim();
  if (!texto) aviso(campo === "nombre" ? "Escriba primero su nombre en Quien firma." : "Escriba primero el texto que quiere poner.");
  return texto;
}

function poner(que, n, p) {
  const t = tamanoVista(vista.paginas[n - 1]);
  let m;
  if (que.tipo === "firma") {
    const img = f.imagenes.get(que.firmaId);
    if (!img) return;
    const w = Math.min(150, t.ancho * 0.8);
    m = { tipo: "firma", firmaId: que.firmaId, w, h: w / img.aspecto };
  } else {
    const texto = textoDeCampo(que.campo);
    if (!texto) return;
    m = { tipo: "texto", texto, ...medirTexto(texto, letra()) };
  }
  guardarHistoria();
  Object.assign(m, { id: f.sigId++, pagina: n, x: limitar(p.x - m.w / 2, 0, t.ancho - m.w), y: limitar(p.y - m.h / 2, 0, t.alto - m.h) });
  f.marcas.push(m);
  f.armada = null;
  aviso("", false);
  pintarFirmas();
  elegir(m.id);
}

function quitar() {
  if (!f.sel) return;
  const m = f.marcas.find((x) => x.id === f.sel);
  guardarHistoria();
  f.marcas = f.marcas.filter((x) => x.id !== f.sel);
  f.sel = null;
  if (m) componer(m.pagina);
  pintarBarra();
}

// Duplicar: en la misma página corrida un poco, o en las páginas que diga.
function duplicar() {
  const m = f.marcas.find((x) => x.id === f.sel);
  if (!m) return;
  const pedido = String($("firma-duplicar-en").value || "").trim();
  let destinos = [m.pagina];
  if (pedido) {
    const r = parsearRangos(pedido, vista.paginas.length);
    if (r.error) return aviso(r.error);
    destinos = r.indices.map((i) => i + 1);
  }
  guardarHistoria();
  let ultima = null;
  for (const n of destinos) {
    const t = tamanoVista(vista.paginas[n - 1]);
    const corre = pedido ? 0 : 14;
    ultima = { ...m, id: f.sigId++, pagina: n, x: limitar(m.x + corre, 0, t.ancho - m.w), y: limitar(m.y + corre, 0, t.alto - m.h) };
    f.marcas.push(ultima);
    componer(n);
  }
  elegir(ultima.id);
  if (pedido) avisar(`Copiada en ${destinos.length} ${destinos.length === 1 ? "página" : "páginas"}.`);
}

function deshacer() {
  if (!f.historia.length) return;
  f.marcas = f.historia.pop();
  f.sel = null;
  componerTodas();
  pintarBarra();
}

function escucharPagina(c) {
  const n = Number(c.dataset.pagina);
  c.addEventListener("pointerdown", (e) => {
    const p = puntoEn(c, e);
    if (f.armada) return poner(f.armada, n, p);
    const sel = f.marcas.find((m) => m.id === f.sel && m.pagina === n);
    const esquina = sel ? esquinaEn(sel, p) : -1;
    const m = esquina >= 0 ? sel : marcaEn(n, p);
    elegir(m?.id ?? null);
    if (!m) return;
    e.preventDefault();
    f.accion = { m, n, esquina, antes: f.marcas.map((x) => ({ ...x })), dx: p.x - m.x, dy: p.y - m.y, aspecto: m.w / m.h, movida: false,
      fija: { x: esquina % 2 ? m.x : m.x + m.w, y: esquina > 1 ? m.y : m.y + m.h } };
    try {
      c.setPointerCapture(e.pointerId);
    } catch {
      /* ratones y táctiles reales siempre traen puntero activo */
    }
  });
  c.addEventListener("pointermove", (e) => {
    const p = puntoEn(c, e);
    const a = f.accion;
    if (!a) {
      const sel = f.marcas.find((m) => m.id === f.sel && m.pagina === n);
      c.classList.toggle("armada", Boolean(f.armada));
      c.classList.toggle("esquina", !f.armada && Boolean(sel) && esquinaEn(sel, p) >= 0);
      c.classList.toggle("mover", !f.armada && !c.classList.contains("esquina") && Boolean(marcaEn(n, p)));
      return;
    }
    const t = tamanoVista(vista.paginas[n - 1]);
    const m = a.m;
    if (a.esquina < 0) {
      m.x = limitar(p.x - a.dx, 0, t.ancho - m.w);
      m.y = limitar(p.y - a.dy, 0, t.alto - m.h);
    } else {
      // La esquina opuesta queda quieta y se conserva la proporción.
      const derecha = a.esquina % 2 === 1;
      const abajo = a.esquina > 1;
      const libreX = derecha ? t.ancho - a.fija.x : a.fija.x;
      const libreY = abajo ? t.alto - a.fija.y : a.fija.y;
      const w = limitar(Math.max(Math.abs(p.x - a.fija.x), Math.abs(p.y - a.fija.y) * a.aspecto), 8, Math.min(libreX, libreY * a.aspecto));
      m.w = w;
      m.h = w / a.aspecto;
      m.x = derecha ? a.fija.x : a.fija.x - w;
      m.y = abajo ? a.fija.y : a.fija.y - m.h;
    }
    a.movida = true;
    componer(n);
  });
  const soltar = () => {
    if (f.accion?.movida) guardarHistoria(f.accion.antes);
    f.accion = null;
    pintarBarra();
  };
  c.addEventListener("pointerup", soltar);
  c.addEventListener("pointercancel", soltar);
  c.addEventListener("dragover", (e) => {
    if (f.arrastrada) e.preventDefault();
  });
  c.addEventListener("drop", (e) => {
    if (!f.arrastrada) return;
    e.preventDefault();
    poner(f.arrastrada, n, puntoEn(c, e));
    f.arrastrada = null;
  });
}

function pintarBarra() {
  const v = vista || { lienzos: [], actual: 1, zoom: 1 };
  const total = v.lienzos.length;
  $("firma-pagina-num").textContent = total ? `Página ${v.actual} de ${total}` : "Sin PDF";
  $("firma-zoom").textContent = `${Math.round(v.zoom * 100)} %`;
  for (const id of ["firma-alejar", "firma-acercar", "firma-ajustar"]) $(id).disabled = !total;
  $("firma-anterior").disabled = !total || v.actual <= 1;
  $("firma-siguiente").disabled = !total || v.actual >= total;
  $("firma-duplicar").disabled = !f.sel;
  $("firma-quitar").disabled = !f.sel;
  $("firma-deshacer").disabled = !f.historia.length;
  const n = f.marcas.length;
  $("firma-cuantas").textContent = n ? `${n} ${n === 1 ? "marca puesta" : "marcas puestas"} en ${new Set(f.marcas.map((m) => m.pagina)).size} ${new Set(f.marcas.map((m) => m.pagina)).size === 1 ? "página" : "páginas"}.` : "";
}

// ---------- Mis firmas ----------

async function cargarFirmas() {
  const r = await window.vigencia.firmasListar();
  f.firmas = r?.ok ? r.firmas : [];
  for (const x of f.firmas) {
    if (f.imagenes.has(x.id)) continue;
    try {
      const bmp = await createImageBitmap(new Blob([aBytes(x.png)], { type: "image/png" }));
      f.imagenes.set(x.id, { png: x.png, bmp, aspecto: bmp.width / Math.max(1, bmp.height) });
    } catch {
      /* una firma dañada no tumba la lista */
    }
  }
  pintarFirmas();
}

function armar(que) {
  const igual = f.armada && f.armada.tipo === que.tipo && f.armada.firmaId === que.firmaId && f.armada.campo === que.campo;
  f.armada = igual ? null : que;
  if (f.armada && f.armada.tipo === "texto" && !textoDeCampo(que.campo)) f.armada = null;
  else if (f.armada) aviso(pdf.firmar ? "Ahora toque la página donde va." : "Elija primero el PDF.", !pdf.firmar);
  pintarFirmas();
}

function arrastrable(el, que) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    f.arrastrada = que;
    e.dataTransfer?.setData("text/plain", que.tipo);
  });
  el.addEventListener("dragend", () => {
    f.arrastrada = null;
  });
}

function pintarFirmas() {
  const lista = $("firma-lista");
  lista.replaceChildren();
  if (!f.firmas.length) lista.append(nodo("p", "ayuda", "Todavía no tiene firmas guardadas. Cree una abajo: dibújela, súbala o escríbala."));
  for (const x of f.firmas) {
    const img = f.imagenes.get(x.id);
    const item = nodo("div", "firma-item");
    item.classList.toggle("elegida", f.armada?.firmaId === x.id);
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.title = "Toque y luego toque la página, o arrástrela a la página";
    const mini = document.createElement("canvas");
    mini.className = "firma-mini";
    mini.width = 150;
    mini.height = 50;
    if (img) {
      const k = Math.min(mini.width / img.bmp.width, mini.height / img.bmp.height);
      mini.getContext("2d").drawImage(img.bmp, (mini.width - img.bmp.width * k) / 2, (mini.height - img.bmp.height * k) / 2, img.bmp.width * k, img.bmp.height * k);
    }
    const nombre = nodo("span", "firma-nombre", x.nombre);
    const renombrarBtn = nodo("button", "boton-texto", "Renombrar");
    const borrarBtn = nodo("button", "boton-texto", "Borrar");
    renombrarBtn.type = "button";
    borrarBtn.type = "button";
    renombrarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      renombrar(nombre, x);
    });
    borrarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      borrar(x);
    });
    const botones = nodo("div", "firma-botones");
    botones.append(renombrarBtn, borrarBtn);
    item.append(mini, nombre, botones);
    item.addEventListener("click", () => armar({ tipo: "firma", firmaId: x.id }));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === item) armar({ tipo: "firma", firmaId: x.id });
    });
    arrastrable(item, { tipo: "firma", firmaId: x.id });
    lista.append(item);
  }
  for (const campo of ["nombre", "fecha", "libre"]) $(`firma-campo-${campo}`).classList.toggle("elegida", f.armada?.campo === campo);
}

function renombrar(nombreEl, x) {
  const campo = document.createElement("input");
  campo.value = x.nombre;
  campo.maxLength = 60;
  campo.setAttribute("aria-label", "Nuevo nombre de la firma");
  nombreEl.replaceWith(campo);
  campo.focus();
  campo.select();
  let hecho = false;
  const terminar = async (guardar) => {
    if (hecho) return;
    hecho = true;
    if (guardar && campo.value.trim() && campo.value.trim() !== x.nombre) {
      const r = await window.vigencia.firmaRenombrar(x.id, campo.value);
      if (r?.ok) avisar(`Ahora se llama ${r.nombre}.`);
      else aviso(r?.error || "No pude cambiarle el nombre.");
    }
    await cargarFirmas();
  };
  campo.addEventListener("click", (e) => e.stopPropagation());
  campo.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") terminar(true);
    if (e.key === "Escape") terminar(false);
  });
  campo.addEventListener("blur", () => terminar(true));
}

async function borrar(x) {
  if (!window.confirm(`¿Borrar la firma ${x.nombre} de este computador? Las que ya puso en la página se quedan.`)) return;
  const r = await window.vigencia.firmaBorrar(x.id);
  if (!r?.ok) return aviso(r?.error || "No pude borrarla.");
  if (f.armada?.firmaId === x.id) f.armada = null;
  await cargarFirmas();
  avisar("Firma borrada.");
}

// ---------- Nueva firma: dibujar, subir o escribir ----------

function lienzo() {
  return $("pdf-firma-lienzo");
}

// Dibuja en píxeles reales del lienzo (sin la escala del trazo).
function enPixeles(fn) {
  const ctx = lienzo().getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    fn(ctx, lienzo());
  } finally {
    ctx.restore();
  }
}

function recordarTrazo() {
  enPixeles((ctx, c) => f.trazos.push(ctx.getImageData(0, 0, c.width, c.height)));
  if (f.trazos.length > 30) f.trazos.shift();
}

function trazoVacio() {
  let vacio = true;
  enPixeles((ctx, c) => {
    const datos = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < datos.length && vacio; i += 4) if (datos[i] !== 0) vacio = false;
  });
  return vacio;
}

function limpiarLienzo() {
  if (!trazoVacio()) recordarTrazo();
  enPixeles((ctx, c) => ctx.clearRect(0, 0, c.width, c.height));
}

function deshacerTrazo() {
  const previo = f.trazos.pop();
  enPixeles((ctx, c) => (previo ? ctx.putImageData(previo, 0, 0) : ctx.clearRect(0, 0, c.width, c.height)));
}

// Fondo blanco a transparente, con borde suave para que no quede aserrado.
function quitarFondo() {
  enPixeles((ctx, c) => {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const claro = Math.min(d[i], d[i + 1], d[i + 2]);
      if (claro > 230) d[i + 3] = 0;
      else if (claro > 180) d[i + 3] = Math.round((d[i + 3] * (230 - claro)) / 50);
    }
    ctx.putImageData(img, 0, 0);
  });
}

async function subirImagen(archivo) {
  try {
    // createImageBitmap no pasa por img-src de la CSP (new Image con data: sí).
    const bmp = await createImageBitmap(archivo);
    recordarTrazo();
    enPixeles((ctx, c) => {
      ctx.clearRect(0, 0, c.width, c.height);
      const k = Math.min(c.width / bmp.width, c.height / bmp.height);
      ctx.drawImage(bmp, (c.width - bmp.width * k) / 2, (c.height - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    });
    bmp.close?.();
    if ($("firma-quitar-fondo").checked) quitarFondo();
    aviso("", false);
  } catch {
    aviso("Esa imagen no se pudo leer. Use PNG o JPG.");
  }
}

async function escribirFirma() {
  const texto = String($("pdf-firma-texto").value || "").trim().slice(0, 60);
  if (!texto) return aviso("Escriba su nombre primero.");
  try {
    await document.fonts.load(`80px "${FUENTE_FIRMA}"`);
  } catch {
    /* sin la letra queda en cursiva del sistema */
  }
  recordarTrazo();
  enPixeles((ctx, c) => {
    ctx.clearRect(0, 0, c.width, c.height);
    let tam = c.height * 0.6;
    ctx.font = `${tam}px "${FUENTE_FIRMA}", cursive`;
    const ancho = ctx.measureText(texto).width;
    if (ancho > c.width * 0.92) tam *= (c.width * 0.92) / ancho;
    ctx.font = `${tam}px "${FUENTE_FIRMA}", cursive`;
    ctx.fillStyle = "#1a2a3a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(texto, c.width / 2, c.height / 2);
  });
  if (!$("firma-guardar-nombre").value.trim()) $("firma-guardar-nombre").value = texto;
  aviso("", false);
}

// Recorta lo transparente alrededor: la caja en la página es la firma.
function recortada() {
  const c = lienzo();
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  enPixeles((ctx) => {
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  });
  const borde = 6;
  x0 = Math.max(0, x0 - borde);
  y0 = Math.max(0, y0 - borde);
  const w = Math.min(c.width, x1 + borde + 1) - x0;
  const h = Math.min(c.height, y1 + borde + 1) - y0;
  const salida = document.createElement("canvas");
  salida.width = w;
  salida.height = h;
  salida.getContext("2d").drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return salida;
}

async function guardarNueva() {
  if (trazoVacio()) return aviso("Dibuje, suba o escriba primero su firma.");
  const nombre = $("firma-guardar-nombre").value.trim() || `Firma ${f.firmas.length + 1}`;
  const r = await window.vigencia.firmaGuardar({ nombre, png: recortada().toDataURL("image/png") });
  if (!r?.ok) {
    aviso(r?.error || "No pude guardarla.");
    return avisar(r?.error || "No pude guardarla.", "error");
  }
  $("firma-guardar-nombre").value = "";
  $("pdf-firma-texto").value = "";
  f.trazos = [];
  enPixeles((ctx, c) => ctx.clearRect(0, 0, c.width, c.height));
  await cargarFirmas();
  f.armada = { tipo: "firma", firmaId: r.id };
  pintarFirmas();
  aviso(pdf.firmar ? `Firma ${r.nombre} guardada. Toque la página donde va o arrástrela.` : `Firma ${r.nombre} guardada.`, false);
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
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1a2a3a";
  let dibujando = false;
  let x = 0;
  let y = 0;
  const punto = (e) => {
    const rect = c.getBoundingClientRect();
    return [(e.clientX - rect.left) * (600 / rect.width), (e.clientY - rect.top) * (200 / rect.height)];
  };
  c.addEventListener("pointerdown", (e) => {
    recordarTrazo();
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
    dibujando = false;
  };
  c.addEventListener("pointerup", soltar);
  c.addEventListener("pointercancel", soltar);
}

// ---------- Firmar y guardar ----------

async function firmar() {
  if (!pdf.firmar || !vista?.doc) return aviso("Elija primero el PDF.");
  if (!f.marcas.length) return aviso("Ponga primero una firma o un texto sobre la página.");
  const constancia = $("pdf-firma-constancia").checked;
  const firmante = String($("pdf-firmante-nombre").value || "").trim();
  if (constancia && !firmante) return aviso("Para la constancia escriba quien firma.");
  if (constancia && !$("pdf-firma-declaracion").checked) return aviso("Marque la declaración para agregar la constancia.");
  const ids = [...new Set(f.marcas.filter((m) => m.tipo === "firma").map((m) => m.firmaId))];
  const marcas = f.marcas.map((m) => ({ pagina: m.pagina, tipo: m.tipo, imagen: ids.indexOf(m.firmaId), texto: m.texto, x: m.x, y: m.y, w: m.w, h: m.h }));
  await ocupado("pdf-firmar-estado", "Firmando", async () => {
    const r = await window.vigencia.pdfFirmar({
      ruta: pdf.firmar,
      imagenes: ids.map((id) => f.imagenes.get(id).png),
      marcas,
      constancia,
      firmante,
      documento: $("pdf-firmante-doc").value,
    });
    if (r?.ok) {
      const codigo = r.codigo ? ` con código ${r.codigo}` : "";
      aviso(`Firmado${codigo}. Guardado en ${r.ruta}`, false);
      avisar(`PDF firmado${codigo}.`);
      f.firmado = r.ruta;
      $("firma-abrir-firmado").hidden = false;
      if (r.codigo) elegirVerificar(r.ruta);
      ofrecerLlevar(r.ruta, { como: "resultado" });
    } else if (!r?.cancelado) {
      aviso(r?.error || "No pude firmar.");
      avisar(r?.error || "No pude firmar.", "error");
    } else {
      aviso("", false);
    }
  });
}

async function abrirFirmado() {
  if (!f.firmado) return;
  pdf.firmar = f.firmado;
  $("firma-abrir-firmado").hidden = true;
  await pintarUno("firmar");
}

// ---------- Verificar un firmado ----------

function elegirVerificar(ruta) {
  f.verificarRuta = ruta;
  $("pdf-verificar-nombre").textContent = nombreCorto(ruta);
  $("pdf-verificar-resultado").replaceChildren();
  estado("pdf-verificar-estado", "");
}

async function verificarFirmado() {
  const caja = $("pdf-verificar-resultado");
  caja.replaceChildren();
  if (!f.verificarRuta) return estado("pdf-verificar-estado", "Elija primero el PDF firmado.", true);
  await ocupado("pdf-verificar-estado", "Verificando", async () => {
    const r = await window.vigencia.pdfVerificar(f.verificarRuta);
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
      if (!r.enRegistro) lineas.push("La constancia viene en el PDF; el registro local no está en este computador");
      tarjeta.append(nodo("p", "meta", `${lineas.join(". ")}.`));
      avisar("Firma íntegra.");
    } else {
      tarjeta.append(nodo("p", "titulo-lista", "Alterado: el contenido ya no coincide con la constancia."));
      tarjeta.append(nodo("p", "meta", `Código ${r.codigo}. El hash de hoy es distinto del que se firmó.`));
      avisar("El documento fue alterado.", "error");
    }
    caja.append(tarjeta);
  });
}

// ---------- Arranque ----------

export function iniciarFirma() {
  alAbrir.firmar = abrirFirma;
  iniciarLienzo();
  $("pdf-firma-deshacer-trazo").addEventListener("click", deshacerTrazo);
  $("pdf-firma-limpiar").addEventListener("click", limpiarLienzo);
  $("pdf-firma-subir").addEventListener("click", () => $("pdf-firma-archivo").click());
  $("pdf-firma-archivo").addEventListener("change", () => {
    const archivo = $("pdf-firma-archivo").files?.[0];
    $("pdf-firma-archivo").value = "";
    if (archivo) subirImagen(archivo);
  });
  $("pdf-firma-poner-texto").addEventListener("click", escribirFirma);
  $("pdf-firma-texto").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      escribirFirma();
    }
  });
  $("firma-guardar").addEventListener("click", guardarNueva);
  for (const campo of ["nombre", "fecha", "libre"]) {
    const boton = $(`firma-campo-${campo}`);
    boton.addEventListener("click", () => armar({ tipo: "texto", campo }));
    arrastrable(boton, { tipo: "texto", campo });
  }
  $("firma-letra").addEventListener("change", () => {
    const m = f.marcas.find((x) => x.id === f.sel && x.tipo === "texto");
    if (!m) return;
    guardarHistoria();
    Object.assign(m, medirTexto(m.texto, letra()));
    componer(m.pagina);
    pintarBarra();
  });
  $("firma-anterior").addEventListener("click", () => vista?.irA(vista.actual - 1));
  $("firma-siguiente").addEventListener("click", () => vista?.irA(vista.actual + 1));
  $("firma-alejar").addEventListener("click", () => cambiarZoom((vista?.zoom ?? 1) / 1.25));
  $("firma-acercar").addEventListener("click", () => cambiarZoom((vista?.zoom ?? 1) * 1.25));
  $("firma-ajustar").addEventListener("click", () => cambiarZoom(crearVista().zoomAncho(ZOOM_MIN, ZOOM_MAX)));
  $("firma-duplicar").addEventListener("click", duplicar);
  $("firma-quitar").addEventListener("click", quitar);
  $("firma-deshacer").addEventListener("click", deshacer);
  $("firma-paginas").addEventListener("scroll", () => vista?.paginaActual(), { passive: true });
  $("pdf-firmar-boton").addEventListener("click", firmar);
  $("firma-abrir-firmado").addEventListener("click", abrirFirmado);
  $("pdf-verificar-elegir").addEventListener("click", async () => {
    const r = await window.vigencia.pdfElegir(false);
    if (r?.ok && (r.rutas || []).length) elegirVerificar(r.rutas[0]);
  });
  $("pdf-verificar-boton").addEventListener("click", verificarFirmado);
  document.addEventListener("keydown", (e) => {
    if ($("firma-visor").hidden || $("pantalla-pdf").hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "") || e.target?.isContentEditable) return;
    const tecla = e.key.toLowerCase();
    if ((e.key === "Delete" || e.key === "Backspace") && f.sel) {
      e.preventDefault();
      quitar();
    } else if ((e.ctrlKey || e.metaKey) && tecla === "z") {
      e.preventDefault();
      deshacer();
    } else if ((e.ctrlKey || e.metaKey) && tecla === "d" && f.sel) {
      e.preventDefault();
      duplicar();
    } else if (e.key === "Escape") {
      f.armada = null;
      pintarFirmas();
      elegir(null);
    }
  });
  pintarBarra();
}
