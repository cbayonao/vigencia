// Pantalla Herramientas PDF. Todo pasa en este computador (pdf-lib en el
// proceso principal, pdfjs en la ventana); ningún PDF sale a internet.
// Este archivo es el marco: elegir herramienta, elegir un archivo y Usar con
// la IA. Cada herramienta pinta su vista a la derecha:
//   pdf-paginas.js  Unir, Separar, Girar (miniaturas)
//   pdf-archivo.js  Comprimir, Proteger, Desbloquear
//   pdf-rellenar.js Rellenar (campos sobre la página)
//   pdf-comparar.js Comparar (dos visores y los cambios)
//   pdf-estados.js  Estados del juzgado a tabla
//   firma.js        Firmar
// Las piezas comunes están en escena.js (vacío, progreso, resultado) y
// paginas.js (el visor de páginas).
import { tamanoHumano } from "../compartido/pdfvisual.js";
import { avisar } from "./aviso.js";
import { conAvance, irA, llenarProyectos } from "./proyectos.js";
import { iniciarFirma, mostrarVisorFirma } from "./firma.js";
import { iniciarArchivoPdf } from "./pdf-archivo.js";
import { iniciarCompararPdf } from "./pdf-comparar.js";
import { iniciarEstadosPdf, refrescarSeguidos } from "./pdf-estados.js";
import { iniciarPaginasPdf } from "./pdf-paginas.js";
import { iniciarRellenarPdf } from "./pdf-rellenar.js";

const $ = (id) => document.getElementById(id);
const HERRAMIENTAS_PDF = ["unir", "separar", "rotar", "firmar", "comprimir", "proteger", "desbloquear", "rellenar", "comparar", "estados"];
export const pdf = { llevar: null, llevado: null, listo: false, herramienta: "unir", separar: "", rotar: "", firmar: "", comprimir: "", proteger: "", desbloquear: "", rellenar: "", compararA: "", compararB: "" };

// Cada herramienta de un archivo deja aquí qué hacer al elegirlo:
// alAbrir[clave](info | null, ruta). info es null si no se pudo leer.
export const alAbrir = {};

export function nodo(tag, clase, contenido) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (contenido != null) el.textContent = contenido;
  return el;
}

export function estado(id, mensaje, error = false) {
  const el = $(id);
  el.textContent = mensaje || "";
  el.classList.toggle("error", error);
}

// Corre una acción mostrando "trabajando" con pulso hasta que termina.
export async function ocupado(idEstado, texto, fn) {
  const el = $(idEstado);
  el.classList.add("procesando");
  estado(idEstado, texto);
  try {
    return await fn();
  } finally {
    el.classList.remove("procesando");
  }
}

export function nombreCorto(ruta) {
  return String(ruta || "").split(/[/\\]/).pop() || ruta;
}

function elegirHerramienta(cual) {
  pdf.herramienta = cual;
  for (const h of HERRAMIENTAS_PDF) {
    $(`pdf-panel-${h}`).hidden = h !== cual;
    const escena = $(`pv-${h}`);
    if (escena) escena.hidden = h !== cual;
    const tab = $(`pdf-tab-${h}`);
    tab.classList.toggle("elegida", h === cual);
    tab.setAttribute("aria-selected", String(h === cual));
  }
  $("pdf-escenas").hidden = cual === "firmar";
  mostrarVisorFirma(cual === "firmar");
}

// ---------- Usar con la IA: convertir o llevar al contexto ----------

const COMO_LLEVAR = {
  elegido: "el PDF que eligió",
  resultado: "el PDF que acaba de guardar",
  temporal: "una copia temporal sin contraseña, aunque no haya guardado una",
  tabla: "la tabla del estado en Markdown",
};

// Deja listo el panel Usar con la IA para un PDF: el elegido, el que salió
// de una herramienta o la copia temporal ya desbloqueada.
export async function ofrecerLlevar(ruta, { como = "elegido", nombre = "" } = {}) {
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

// ---------- Un archivo: el de cada herramienta ----------

export async function elegirUno(clave) {
  const r = await window.vigencia.pdfElegir(false);
  if (r?.ok && (r.rutas || []).length) await ponerUno(clave, r.rutas[0]);
}

// Elegido o soltado: lo deja en la herramienta y se lo pasa a su vista.
export async function ponerUno(clave, ruta) {
  if (!ruta) return;
  pdf[clave] = ruta;
  const info = await pintarUno(clave);
  // Con contraseña no se puede leer: se ofrece después de desbloquear.
  if (clave !== "desbloquear" && clave !== "proteger" && info) ofrecerLlevar(ruta);
}

export async function pintarUno(clave) {
  const ayuda = $(`pdf-${clave}-nombre`);
  const ruta = pdf[clave];
  const info = ruta ? await window.vigencia.pdfInfo(ruta) : null;
  if (!info?.ok) {
    ayuda.textContent = ruta ? nombreCorto(ruta) : "Ningún PDF elegido.";
    estado(`pdf-${clave}-estado`, info && ruta && clave !== "desbloquear" ? (info.error || "") : "", Boolean(info && !info.ok && clave !== "desbloquear"));
    await alAbrir[clave]?.(null, ruta);
    return null;
  }
  ayuda.textContent = `${info.nombre}: ${info.paginas} ${info.paginas === 1 ? "página" : "páginas"}, ${tamanoHumano(info.bytes)}.`;
  estado(`pdf-${clave}-estado`, "");
  await alAbrir[clave]?.(info, ruta);
  return info;
}

// ---------- Arranque ----------

export async function abrirPdf() {
  await llenarProyectos($("pdf-llevar-proyecto"), { vacio: "Elija un proyecto" });
  // Al volver de Seguir este proceso, la tabla de Estados ya lo marca.
  if (pdf.herramienta === "estados") refrescarSeguidos();
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
  for (const clave of ["separar", "rotar", "firmar", "comprimir", "proteger", "desbloquear", "rellenar"]) {
    $(`pdf-elegir-${clave}`).addEventListener("click", () => elegirUno(clave));
  }
  iniciarPaginasPdf();
  iniciarArchivoPdf();
  iniciarRellenarPdf();
  iniciarCompararPdf();
  iniciarEstadosPdf();
  iniciarFirma();
  elegirHerramienta(pdf.herramienta);
}
