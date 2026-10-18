// Pantalla Convertir a Markdown y la sección OCR de Modelos de IA. Todo
// se convierte en este computador; la ventana solo muestra la cola, el
// resultado y deja editarlo.
import { documentoHtml } from "../compartido/formato.js";
import { avisar } from "./aviso.js";

const $ = (id) => document.getElementById(id);
const cv = { cola: new Map(), elegido: null, ui: null, proyectos: [], vista: "bonita", temporizador: 0 };

function nodo(tag, clase, texto) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

function estado(id, mensaje, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = mensaje || "";
  el.classList.toggle("error", error);
}

function textoFase(p) {
  if (p.fase === "en cola") return "En cola";
  if (p.fase === "leyendo") return p.total ? `Leyendo página ${p.pagina} de ${p.total}` : "Leyendo";
  if (p.fase === "ocr") return `OCR página ${p.pagina} de ${p.total}`;
  if (p.fase === "listo") return p.cache ? "Listo (ya estaba convertido)" : "Listo";
  if (p.fase === "error") return p.codigo === "cancelado" ? "Cancelado" : `Error: ${p.error || ""}`;
  return p.fase || "";
}

function pintarCola() {
  const caja = $("conv-cola");
  caja.replaceChildren();
  for (const [clave, p] of cv.cola) {
    const fila = nodo("div", "conv-fila");
    fila.append(nodo("span", "", p.nombre || "archivo"), nodo("span", "ayuda", textoFase(p)));
    const cancelar = nodo("button", "boton-texto", "Cancelar");
    cancelar.type = "button";
    cancelar.hidden = !p.id || ["listo", "error"].includes(p.fase);
    cancelar.addEventListener("click", () => window.vigencia.convertirCancelar(p.id));
    fila.append(cancelar);
    const barra = nodo("div", "conv-barra");
    const i = nodo("i");
    const avance = p.fase === "listo" ? 1 : p.total ? p.pagina / p.total : 0.05;
    i.style.width = `${Math.round(avance * 100)}%`;
    barra.append(i);
    fila.append(barra);
    fila.dataset.clave = clave;
    caja.append(fila);
  }
}

async function pintarLista() {
  const r = await window.vigencia.convertirInicio();
  const caja = $("conv-lista");
  caja.replaceChildren();
  if (!r?.ok) return estado("conv-ocr", r?.error || "No pude leer los convertidos.", true);
  estado("conv-ocr", r.ocr?.listo ? "OCR en español instalado: los PDF escaneados y las imágenes se leen en este computador." : r.ocr?.aviso || "");
  if (!r.archivos.length) caja.append(nodo("p", "ayuda", "Todavía no hay archivos convertidos."));
  for (const a of r.archivos) {
    const fila = nodo("div", "conv-fila");
    const detalle = [a.estado, a.paginas ? `${a.paginas} págs.` : "", a.paginas_ocr ? `${a.paginas_ocr} con OCR` : "", a.tokens_aprox ? `${Number(a.tokens_aprox).toLocaleString("es-CO")} tokens aprox.` : ""].filter(Boolean).join(", ");
    fila.append(nodo("span", "", a.nombre), nodo("span", "ayuda", detalle));
    const ver = nodo("button", "boton-texto", "Ver");
    ver.type = "button";
    ver.disabled = a.estado !== "listo";
    ver.addEventListener("click", () => abrirVista(a.id));
    fila.append(ver);
    const renombrar = nodo("button", "boton-texto", "Renombrar");
    renombrar.type = "button";
    renombrar.addEventListener("click", () => editarNombre(fila, a));
    fila.append(renombrar);
    if (a.error) fila.append(nodo("span", "ayuda error", a.error));
    caja.append(fila);
  }
}

async function editarNombre(fila, a) {
  const actual = fila.querySelector("span");
  if (!actual) return;
  const entrada = document.createElement("input");
  entrada.value = a.nombre || "";
  entrada.maxLength = 120;
  entrada.setAttribute("aria-label", "Nuevo nombre del archivo");
  actual.replaceWith(entrada);
  entrada.focus();
  entrada.select();
  let listo = false;
  const cerrar = async (guardar) => {
    if (listo) return;
    listo = true;
    if (guardar) {
      const r = await window.vigencia.convertirRenombrar(a.id, entrada.value);
      if (!r?.ok) {
        estado("conv-ocr", r?.error || "No pude cambiar el nombre.", true);
        avisar(r?.error || "No pude cambiar el nombre.", "error");
      } else {
        avisar(`Ahora se llama “${r.archivo?.nombre || entrada.value.trim()}”.`);
        if (cv.elegido?.id === a.id && r.archivo) {
          cv.elegido = { ...cv.elegido, nombre: r.archivo.nombre };
          $("conv-vista-titulo").textContent = r.archivo.nombre;
        }
      }
    }
    await pintarLista();
  };
  entrada.addEventListener("keydown", (e) => {
    if (e.key === "Enter") cerrar(true);
    else if (e.key === "Escape") cerrar(false);
  });
  entrada.addEventListener("blur", () => cerrar(true));
}

function pintarBonito() {
  const vista = $("conv-bonito");
  if (!vista || $("conv-vista").hidden) return;
  try {
    vista.innerHTML = documentoHtml($("conv-md").value) || '<p class="ayuda">Nada que mostrar todavía.</p>';
  } catch {
    vista.replaceChildren(nodo("p", "ayuda error", "No pude dibujar la vista."));
  }
}

function programarBonito() {
  window.clearTimeout(cv.temporizador);
  cv.temporizador = window.setTimeout(pintarBonito, 250);
}

function elegirVista(cual) {
  cv.vista = cual;
  const bonita = cual === "bonita";
  $("conv-bonito").hidden = !bonita;
  $("conv-md").hidden = bonita;
  $("tab-vista-bonita").classList.toggle("elegida", bonita);
  $("tab-vista-codigo").classList.toggle("elegida", !bonita);
  $("tab-vista-bonita").setAttribute("aria-selected", String(bonita));
  $("tab-vista-codigo").setAttribute("aria-selected", String(!bonita));
  if (bonita) pintarBonito();
}

async function abrirVista(id) {
  const r = await window.vigencia.convertirLeer(id);
  if (!r?.ok) return estado("conv-ocr", r?.error || "No pude abrirlo.", true);
  cv.elegido = r.archivo;
  $("conv-vista").hidden = false;
  $("conv-vista-titulo").textContent = r.archivo.nombre;
  $("conv-md").value = r.markdown;
  elegirVista("bonita");
  const vista = $("conv-bonito");
  vista.scrollTop = 0;
  estado("conv-vista-estado", r.archivo.aviso || "");
  const original = $("conv-original");
  original.replaceChildren();
  // La política de la ventana no deja abrir file:// en un marco; se muestra
  // dónde quedó la copia del original. Pendiente: visor por el servidor local.
  original.append(nodo("p", "ayuda", r.original ? `Copia del original guardada en: ${r.original}` : "No hay copia del original."));
  original.append(nodo("p", "ayuda", `Motor: ${r.archivo.motor || "sin dato"}. Calidad del texto: ${Math.round(Number(r.archivo.calidad || 0) * 100)} %.`));
  const inicio = await window.vigencia.documentosInicio();
  cv.proyectos = inicio?.ok ? inicio.proyectos || [] : [];
  const sel = $("conv-proyecto");
  sel.replaceChildren(new Option(cv.proyectos.length ? "Elegir proyecto" : "No hay proyectos en Documentos", ""));
  for (const p of cv.proyectos) sel.append(new Option(p.nombre, String(p.id)));
  // Sube la página de golpe (el suave arrastra el panel interno al final).
  $("conv-vista").scrollIntoView({ block: "start" });
  vista.scrollTop = 0;
}

async function convertir(rutas) {
  if (!rutas.length) return;
  const r = await window.vigencia.convertirRutas(rutas, null, $("conv-forzar-ocr").checked);
  for (const x of r?.resultados || []) {
    if (x.error && !x.archivo) cv.cola.set(`x-${x.nombre}-${Date.now()}`, { nombre: x.nombre, fase: "error", error: x.error });
  }
  pintarCola();
  await pintarLista();
  const ultimo = (r?.resultados || []).filter((x) => x.archivo?.estado === "listo").pop();
  if (ultimo) await abrirVista(ultimo.archivo.id);
}

export async function pintarOcr() {
  const r = await window.vigencia.convertirOcrEstado();
  const listo = Boolean(r?.ok && r.ocr?.listo);
  estado("ocr-estado", listo ? "Instalado. Funciona sin internet." : "No está instalado.");
  $("ocr-instalar").hidden = listo;
  $("ocr-quitar").hidden = !listo;
}

export function abrirConvertir() {
  pintarCola();
  pintarLista();
}

export function iniciarConvertir(ui) {
  cv.ui = ui;
  window.vigencia.alConvertir((p) => {
    if (!p) return;
    const clave = String(p.archivoId || p.id || p.nombre);
    cv.cola.set(clave, { ...(cv.cola.get(clave) || {}), ...p });
    if (!$("pantalla-convertir").hidden) pintarCola();
  });
  $("conv-elegir").addEventListener("click", async () => {
    const r = await window.vigencia.convertirElegir();
    await convertir(r?.rutas || []);
  });
  const zona = $("conv-soltar");
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("sobre");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
  zona.addEventListener("drop", async (e) => {
    e.preventDefault();
    zona.classList.remove("sobre");
    const rutas = [...(e.dataTransfer?.files || [])].map((f) => window.vigencia.rutaDeArchivo(f)).filter(Boolean);
    await convertir(rutas);
  });
  $("conv-limpiar").addEventListener("click", async () => {
    const r = await window.vigencia.convertirLimpiarCache();
    estado("conv-ocr", r?.ok ? `Se borraron ${r.borrados} conversiones que ningún proyecto ni la biblioteca usaban.` : r?.error || "No pude limpiar.", !r?.ok);
    $("conv-vista").hidden = true;
    await pintarLista();
  });
  $("conv-guardar").addEventListener("click", async () => {
    if (!cv.elegido) return;
    const r = await window.vigencia.convertirGuardarEdicion(cv.elegido.id, $("conv-md").value);
    estado("conv-vista-estado", r?.ok ? `Guardé la revisión ${r.revision}. La conversión original se conserva.` : r?.error || "No pude guardar.", !r?.ok);
    avisar(r?.ok ? `Revisión ${r.revision} guardada.` : (r?.error || "No pude guardar."), r?.ok ? "ok" : "error");
  });
  $("conv-copiar").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("conv-md").value);
      estado("conv-vista-estado", "Markdown copiado.");
      avisar("Markdown copiado.");
    } catch {
      estado("conv-vista-estado", "No pude copiar.", true);
      avisar("No pude copiar.", "error");
    }
  });
  $("conv-guardar-como").addEventListener("click", async () => {
    if (!cv.elegido) return;
    const r = await window.vigencia.convertirGuardarComo(cv.elegido.id);
    if (r?.ok) {
      estado("conv-vista-estado", `Guardado en ${r.ruta}`);
      avisar("Archivo .md guardado.");
    } else if (!r?.cancelado) {
      estado("conv-vista-estado", r?.error || "No pude guardarlo.", true);
      avisar(r?.error || "No pude guardarlo.", "error");
    }
  });
  $("conv-a-biblioteca").addEventListener("click", async () => {
    if (!cv.elegido) return;
    const r = await window.vigencia.convertirABiblioteca(cv.elegido.id);
    estado("conv-vista-estado", r?.ok ? "Quedó en la biblioteca." : r?.error || "No pude agregarlo.", !r?.ok);
    avisar(r?.ok ? "Quedó en la biblioteca." : (r?.error || "No pude agregarlo."), r?.ok ? "ok" : "error");
  });
  $("conv-a-proyecto").addEventListener("click", async () => {
    const id = Number($("conv-proyecto").value);
    if (!cv.elegido || !id) return estado("conv-vista-estado", "Elija un proyecto.", true);
    const r = await window.vigencia.proyectoArchivoAgregar(id, cv.elegido.id);
    estado("conv-vista-estado", r?.ok ? "Quedó en los archivos del proyecto." : r?.error || "No pude agregarlo.", !r?.ok);
    avisar(r?.ok ? "Quedó en los archivos del proyecto." : (r?.error || "No pude agregarlo."), r?.ok ? "ok" : "error");
  });
  $("conv-reocr").addEventListener("click", async () => {
    if (!cv.elegido) return;
    estado("conv-vista-estado", "Reconvirtiendo con OCR...");
    const r = await window.vigencia.convertirReconvertir(cv.elegido.id);
    if (!r?.ok || r.error) {
      estado("conv-vista-estado", r?.error || "No pude reconvertir.", true);
      avisar(r?.error || "No pude reconvertir.", "error");
      return;
    }
    await abrirVista(r.archivo.id);
    await pintarLista();
    avisar("Reconvertido con OCR.");
  });
  $("ocr-instalar").addEventListener("click", async () => {
    $("ocr-instalar").disabled = true;
    const quitar = window.vigencia.alOcrProgreso((p) => estado("ocr-estado", `Descargando ${p.nombre} (${p.paso} de ${p.total})`));
    try {
      const r = await window.vigencia.convertirOcrInstalar();
      if (!r?.ok) estado("ocr-estado", r?.error || "No pude instalar el OCR.", true);
      else await pintarOcr();
    } finally {
      quitar();
      $("ocr-instalar").disabled = false;
    }
  });
  $("ocr-quitar").addEventListener("click", async () => {
    await window.vigencia.convertirOcrQuitar();
    await pintarOcr();
  });
  $("tab-vista-bonita").addEventListener("click", () => elegirVista("bonita"));
  $("tab-vista-codigo").addEventListener("click", () => elegirVista("codigo"));
  $("conv-md").addEventListener("input", programarBonito);
}
