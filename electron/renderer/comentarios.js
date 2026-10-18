// Diálogo Comentarios y reportes: formulario + lo aprobado por el equipo.
import { avisar } from "./aviso.js";

const $ = (id) => document.getElementById(id);

const estado = { listo: false };
let ui = null;

function nodo(tag, clase, contenido) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (contenido != null) el.textContent = contenido;
  return el;
}

function mostrarError(mensaje) {
  const el = $("comentario-error");
  el.hidden = !mensaje;
  el.textContent = mensaje || "";
}

function fechaCorta(marca) {
  const t = String(marca || "");
  return t ? t.slice(0, 10) : "";
}

const TIPO_NOMBRE = { sugerencia: "Sugerencia", bug: "Error", otro: "Otro" };

function pintarLista(comentarios) {
  const lista = $("comentarios-lista");
  lista.replaceChildren();
  if (!comentarios.length) {
    lista.append(nodo("p", "ayuda", "Todavía no hay comentarios publicados. Sea la primera voz."));
    return;
  }
  for (const c of comentarios) {
    const tarjeta = nodo("article", "tarjeta comentario-tarjeta");
    const quien = [c.nombre || "Anónimo", TIPO_NOMBRE[c.tipo] || "Otro", fechaCorta(c.creado)].filter(Boolean).join(" · ");
    tarjeta.append(nodo("p", "meta", quien));
    tarjeta.append(nodo("p", "acto", c.texto || ""));
    lista.append(tarjeta);
  }
}

async function cargar() {
  $("comentario-estado").textContent = "Trayendo comentarios…";
  try {
    const r = await window.vigencia.comentariosListar();
    if (!r?.ok) {
      $("comentario-estado").textContent = "";
      pintarLista([]);
      if (!$("dialogo-comentarios").hidden) mostrarError(r?.error || "No pude traer los comentarios.");
      return;
    }
    $("comentario-estado").textContent = "";
    mostrarError("");
    pintarLista(r.comentarios || []);
  } catch {
    $("comentario-estado").textContent = "";
    pintarLista([]);
  }
}

async function enviar(evento) {
  evento.preventDefault();
  mostrarError("");
  $("comentario-estado").textContent = "Enviando…";
  $("comentario-enviar").disabled = true;
  try {
    const r = await window.vigencia.comentariosEnviar({
      nombre: $("comentario-nombre").value,
      tipo: $("comentario-tipo").value,
      texto: $("comentario-texto").value,
      trampa: $("comentario-trampa").value,
    });
    if (!r?.ok) {
      mostrarError(r?.error || "No pude enviar el comentario.");
      avisar(r?.error || "No pude enviar el comentario.", "error");
      return;
    }
    $("comentario-texto").value = "";
    $("comentario-estado").textContent = "¡Gracias! Quedó pendiente de revisión.";
    avisar("¡Gracias! Quedó pendiente de revisión.");
  } finally {
    $("comentario-enviar").disabled = false;
    setTimeout(() => {
      if ($("comentario-estado").textContent === "Enviando…") $("comentario-estado").textContent = "";
    }, 100);
  }
}

export async function abrirComentarios() {
  $("comentario-nombre").value = "";
  $("comentario-texto").value = "";
  $("comentario-tipo").value = "sugerencia";
  mostrarError("");
  $("comentario-estado").textContent = "";
  pintarLista([]);
  ui.mostrarDialogo("dialogo-comentarios");
  $("comentario-texto").focus();
  await cargar();
}

export function iniciarComentarios(herramientas) {
  if (estado.listo) return;
  estado.listo = true;
  ui = herramientas;
  $("form-comentario").addEventListener("submit", enviar);
  $("comentarios-cerrar").addEventListener("click", () => ui.ocultarDialogo("dialogo-comentarios"));
}
