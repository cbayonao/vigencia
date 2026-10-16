import { wompiDesdeEnv } from "./comun.mjs";
import { tiendaDynamo, tiendaComentarios } from "./dynamo.mjs";
import { crearServicio } from "./servicio.mjs";

let servicio;

function llavePrivada() {
  if (process.env.LICENCIA_PRIVADA_B64) {
    return Buffer.from(process.env.LICENCIA_PRIVADA_B64, "base64").toString("utf8");
  }
  return process.env.LICENCIA_PRIVADA || "";
}

function obtenerServicio() {
  if (servicio) return servicio;
  const wompi = wompiDesdeEnv();
  servicio = crearServicio({
    tienda: tiendaDynamo(),
    comentarios: tiendaComentarios(),
    claveAdmin: process.env.COMENTARIOS_CLAVE || "",
    wompi,
    privada: llavePrivada(),
    publicaBase: process.env.URL_PUBLICA || "",
    consultar: (referencia) => consultarWompi(referencia, wompi),
  });
  return servicio;
}

async function consultarWompi(referencia, wompi) {
  const url = `${wompi.base}/transactions?reference=${encodeURIComponent(referencia)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${wompi.privada}` } });
  if (!res.ok) throw new Error(`wompi ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method || "GET";
  const path = event?.rawPath || "/";
  let body = event?.body ?? null;
  if (body && event.isBase64Encoded) body = Buffer.from(body, "base64").toString("utf8");
  if (typeof body === "string" && body) {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const resultado = await obtenerServicio().atender({
    method,
    path,
    query: event?.queryStringParameters || {},
    headers: event?.headers || {},
    body,
  });
  const texto = Boolean(resultado.texto);
  return {
    statusCode: resultado.status,
    headers: {
      "content-type": texto ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
      ...(resultado.headers || {}),
    },
    body: texto ? resultado.body : JSON.stringify(resultado.body),
  };
}
