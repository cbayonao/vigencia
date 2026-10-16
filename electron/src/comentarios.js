// Comentarios y reportes desde la app. Van al servicio de licencias
// (misma base que el plan) y quedan pendientes de revisión: el equipo los
// aprueba en la página de administración antes de mostrarse.
import { urlServicio } from "../compartido/licencia.js";
import { Aviso } from "./db.js";

const TIPOS = new Set(["sugerencia", "bug", "otro"]);

function base(env = process.env) {
  const url = urlServicio(env);
  if (!url) throw new Aviso("Los comentarios necesitan internet y el servicio no está conectado.");
  return url;
}

export async function listarComentarios({ env = process.env, pedir = fetch } = {}) {
  let res;
  try {
    res = await pedir(`${base(env)}/comentarios`, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Aviso("Sin internet no puedo traer los comentarios.");
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
    throw new Aviso("El servicio no respondió bien. Intente más tarde.");
  }
  if (!res.ok) throw new Aviso(json.error || "No pude traer los comentarios.");
  return Array.isArray(json.comentarios) ? json.comentarios : [];
}

export async function enviarComentario({ nombre, tipo, texto, trampa, env = process.env, pedir = fetch } = {}) {
  const limpio = {
    nombre: String(nombre || "").trim().slice(0, 60),
    tipo: TIPOS.has(tipo) ? tipo : "otro",
    texto: String(texto || "").trim().slice(0, 1000),
    trampa: String(trampa || ""),
  };
  if (limpio.texto.length < 3) throw new Aviso("Escriba su comentario (mínimo 3 letras).");
  let res;
  try {
    res = await pedir(`${base(env)}/comentarios`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(limpio),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Aviso("Sin internet no puedo enviar el comentario.");
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
    throw new Aviso("El servicio no respondió bien. Intente más tarde.");
  }
  if (!res.ok) throw new Aviso(json.error || "No pude enviar el comentario.");
  return json;
}
