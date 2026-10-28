// Pantalla Convertir a Markdown y la sección OCR de Modelos de IA. Todo
// se convierte en este computador; la ventana solo muestra la cola, el
// resultado y deja editarlo.
import { documentoHtml } from "../compartido/formato.js";
import { detalleArchivo } from "../compartido/convertir.js";
import { avisar } from "./aviso.js";
import { irA, llenarProyectos, moverBarra, textoAvance } from "./proyectos.js";

const $ = (id) => document.getElementById(id);
const cv = { cola: new Map(), elegido: null, ui: null, proyectos: [], vista: "bonita", temporizador: 0, marcados: new Set() };

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
  return textoAvance({ ...p, nombre: "" });
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
    // <progress> y no un ancho en línea: la política de la ventana no deja estilos en línea.
    const barra = document.createElement("progress");
    barra.className = "conv-barra";
    barra.setAttribute("aria-label", `Avance de ${p.nombre || "archivo"}`);
    moverBarra(barra, p);
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
  const vivos = new Set(r.archivos.filter((a) => a.estado === "listo").map((a) => a.id));
  for (const id of [...cv.marcados]) if (!vivos.has(id)) cv.marcados.delete(id);
  for (const a of r.archivos) {
    const fila = nodo("div", "conv-fila conv-fila-marca");
    const marca = document.createElement("input");
    marca.type = "checkbox";
    marca.disabled = a.estado !== "listo";
    marca.checked = cv.marcados.has(a.id);
    marca.setAttribute("aria-label", `Marcar ${a.nombre}`);
    marca.addEventListener("change", () => {
      if (marca.checked) cv.marcados.add(a.id);
      else cv.marcados.delete(a.id);
      pintarMarcados();
    });
    const detalle = [a.estado === "listo" ? "" : a.estado, detalleArchivo(a), a.tokens_aprox ? `${Number(a.tokens_aprox).toLocaleString("es-CO")} tokens aprox.` : ""].filter(Boolean).join(", ");
    fila.append(marca, nodo("span", "", a.nombre), nodo("span", "ayuda", detalle));
    const ver = nodo("button", "boton-texto", "Ver");
    ver.type = "button";
    ver.disabled = a.estado !== "listo";
    ver.addEventListener("click", () => abrirVista(a.id));
    fila.append(ver);
    const renombrar = nodo("button", "boton-texto", "Renombrar");
    renombrar.type = "button";
    renombrar.addEventListener("click", () => editarNombre(fila, a));
    fila.append(renombrar);
    const eliminar = nodo("button", "boton-texto", "Eliminar");
    eliminar.type = "button";
    eliminar.title = "Borra el archivo convertido de este computador";
    eliminar.addEventListener("click", () => eliminarArchivo(a));
    fila.append(eliminar);
    if (a.error) fila.append(nodo("span", "ayuda error", a.error));
    caja.append(fila);
  }
  pintarMarcados();
}

function pintarMarcados() {
  const n = cv.marcados.size;
  $("conv-marcados").hidden = n === 0;
  $("conv-marcados-cuenta").textContent = n === 1 ? "1 archivo marcado." : `${n} archivos marcados.`;
}

// Varias a la vez: al proyecto elegido arriba o a la biblioteca.
async function marcadosAProyecto() {
  const proyecto = Number($("conv-destino").value);
  if (!proyecto) return estado("conv-marcados-estado", "Elija arriba el proyecto de Documentos.", true);
  let bien = 0;
  for (const id of cv.marcados) {
    const r = await window.vigencia.proyectoArchivoAgregar(proyecto, id);
    if (r?.ok) bien++;
  }
  estado("conv-marcados-estado", `${bien} de ${cv.marcados.size} quedaron en el contexto del proyecto.`, bien < cv.marcados.size);
  avisar(`${bien} ${bien === 1 ? "archivo" : "archivos"} en el contexto del proyecto.`, bien ? "ok" : "error");
  $("conv-marcados-abrir").hidden = !bien;
}

async function marcadosABiblioteca() {
  let nuevas = 0;
  let repetidas = 0;
  const errores = [];
  for (const id of cv.marcados) {
    const r = await window.vigencia.convertirABiblioteca(id);
    if (!r?.ok) errores.push(r?.error || "No pude agregarlo.");
    else if (r.repetida) repetidas++;
    else nuevas++;
  }
  const partes = [`${nuevas} ${nuevas === 1 ? "fuente nueva" : "fuentes nuevas"} en la biblioteca`];
  if (repetidas) partes.push(`${repetidas} ya estaban`);
  if (errores.length) partes.push(errores.join(" "));
  estado("conv-marcados-estado", `${partes.join(", ")}.`, Boolean(errores.length));
  avisar(errores.length ? "Algunos no se pudieron agregar." : "Listo en la biblioteca.", errores.length ? "error" : "ok");
}

export async function verConvertido(id, pagina = 0) {
  if (id) await abrirVista(id, Number(pagina) || 0);
}

async function eliminarArchivo(a) {
  if (!window.confirm(`Eliminar ${a.nombre || "el archivo"} de este computador? Si está en un proyecto o en la biblioteca, quítelo de ahí primero.`)) return;
  const r = await window.vigencia.convertirBorrar(a.id);
  if (!r?.ok) {
    estado("conv-ocr", r?.error || "No pude eliminarlo.", true);
    avisar(r?.error || "No pude eliminarlo.", "error");
    return;
  }
  cv.marcados.delete(a.id);
  if (cv.elegido?.id === a.id) {
    cv.elegido = null;
    $("conv-vista").hidden = true;
  }
  avisar(`Eliminé ${a.nombre || "el archivo"}.`);
  await pintarLista();
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
        avisar(`Ahora se llama ${r.archivo?.nombre || entrada.value.trim()}.`);
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

async function abrirVista(id, pagina = 0) {
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
  original.append(nodo("p", "ayuda", `Motor: ${r.archivo.motor || "sin dato"}. ${detalleArchivo(r.archivo) || "Sin datos del archivo"}.`));
  cv.proyectos = await llenarProyectos($("conv-proyecto"), { vacio: "Elegir proyecto", elegido: $("conv-destino").value });
  // Sube la página de golpe (el suave arrastra el panel interno al final).
  $("conv-vista").scrollIntoView({ block: "start" });
  vista.scrollTop = 0;
  if (pagina) {
    const marca = [...vista.querySelectorAll(".conv-pagina")].find((p) => p.textContent.trim() === `página ${pagina}`);
    if (marca) marca.scrollIntoView({ block: "start" });
  }
}

async function convertir(rutas) {
  if (!rutas.length) return;
  // Si arriba hay un proyecto elegido, cada archivo queda en su contexto.
  const proyecto = Number($("conv-destino").value) || null;
  const r = await window.vigencia.convertirRutas(rutas, proyecto, $("conv-forzar-ocr").checked, "convertir");
  const listos = (r?.resultados || []).filter((x) => x.archivo?.estado === "listo").length;
  for (const x of r?.resultados || []) {
    if (x.error && !x.archivo) cv.cola.set(`x-${x.nombre}-${Date.now()}`, { nombre: x.nombre, fase: "error", error: x.error });
  }
  pintarCola();
  await pintarLista();
  const ultimo = (r?.resultados || []).filter((x) => x.archivo?.estado === "listo").pop();
  if (ultimo) await abrirVista(ultimo.archivo.id);
  if (proyecto && listos) {
    const nombre = $("conv-destino").selectedOptions[0]?.textContent || "el proyecto";
    const previo = $("conv-vista-estado").textContent;
    estado("conv-vista-estado", [`${listos} ${listos === 1 ? "archivo quedó" : "archivos quedaron"} en el contexto de ${nombre}.`, previo].filter(Boolean).join(" "));
    avisar("En el contexto del proyecto.");
  }
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
  llenarProyectos($("conv-destino"), { vacio: "Solo convertir, sin proyecto" });
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
    const texto = r?.ok ? (r.repetida ? "Ya estaba en la biblioteca." : "Quedó en la biblioteca, con sus páginas.") : r?.error || "No pude agregarlo.";
    estado("conv-vista-estado", texto, !r?.ok);
    avisar(texto, r?.ok ? "ok" : "error");
  });
  $("conv-a-proyecto").addEventListener("click", async () => {
    const id = Number($("conv-proyecto").value);
    if (!cv.elegido || !id) return estado("conv-vista-estado", "Elija un proyecto.", true);
    const r = await window.vigencia.proyectoArchivoAgregar(id, cv.elegido.id);
    estado("conv-vista-estado", r?.ok ? "Quedó en el contexto del proyecto." : r?.error || "No pude agregarlo.", !r?.ok);
    avisar(r?.ok ? "Quedó en el contexto del proyecto." : (r?.error || "No pude agregarlo."), r?.ok ? "ok" : "error");
  });
  $("conv-abrir-doc").addEventListener("click", () => {
    const id = Number($("conv-proyecto").value);
    if (!id) return estado("conv-vista-estado", "Elija el proyecto que quiere abrir.", true);
    irA({ a: "documentos", proyectoId: id, contexto: true });
  });
  $("conv-marcados-proyecto").addEventListener("click", marcadosAProyecto);
  $("conv-marcados-biblioteca").addEventListener("click", marcadosABiblioteca);
  $("conv-marcados-limpiar").addEventListener("click", () => {
    cv.marcados.clear();
    pintarLista();
  });
  $("conv-marcados-abrir").addEventListener("click", () => {
    const id = Number($("conv-destino").value);
    if (id) irA({ a: "documentos", proyectoId: id, contexto: true });
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
