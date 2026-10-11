import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { estadoLicencia, urlServicio } from "../compartido/licencia.js";

export function rutaLicencia(dir) {
  return path.join(dir, "licencia.json");
}

export function leerCaja(dir) {
  try {
    const dato = JSON.parse(fs.readFileSync(rutaLicencia(dir), "utf8"));
    if (dato && typeof dato === "object") return dato;
  } catch {
    /* todavía no hay archivo */
  }
  return null;
}

export function guardarCaja(dir, caja) {
  const ruta = rutaLicencia(dir);
  const temporal = `${ruta}.${process.pid}.tmp`;
  fs.writeFileSync(temporal, `${JSON.stringify(caja)}\n`, { mode: 0o600 });
  fs.renameSync(temporal, ruta);
}

export function asegurarInstalacion(dir) {
  const caja = leerCaja(dir) || {};
  if (/^[a-f0-9]{64}$/.test(String(caja.id || ""))) return caja;
  const siguiente = { id: crypto.randomBytes(32).toString("hex"), token: "", visto: "" };
  guardarCaja(dir, siguiente);
  return siguiente;
}

export function fotoLicencia(dir, ahora = new Date(), env = process.env) {
  const caja = asegurarInstalacion(dir);
  return {
    ...estadoLicencia({
      token: caja.token,
      instalacion: caja.id,
      ahora,
      visto: caja.visto,
    }),
    conectado: Boolean(urlServicio(env)),
  };
}

async function leerJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function leerPlan({ dir, env = process.env, pedir = fetch, ahora = new Date() } = {}) {
  const base = urlServicio(env);
  if (!base) return fotoLicencia(dir, ahora, env);
  const caja = asegurarInstalacion(dir);
  try {
    const res = await pedir(`${base}/estado?instalacion=${encodeURIComponent(caja.id)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const json = await leerJson(res);
    if (res.ok) aplicarRespuesta(dir, caja, json, ahora);
  } catch {
    /* sin red se usa el comprobante guardado */
  }
  const foto = fotoLicencia(dir, ahora, env);
  return foto;
}

function aplicarRespuesta(dir, caja, json, ahora) {
  const visto = json.ahora || caja.visto || "";
  if (json.token) {
    guardarCaja(dir, { ...caja, token: json.token, visto: visto || ahora.toISOString() });
    return;
  }
  if (visto) guardarCaja(dir, { ...caja, visto });
}

export async function iniciarPlan({ dir, env = process.env, pedir = fetch, ahora = new Date() } = {}) {
  const base = urlServicio(env);
  if (!base) return { ok: false, error: "El pago todavía no está conectado." };
  const caja = asegurarInstalacion(dir);
  let res;
  try {
    res = await pedir(`${base}/iniciar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instalacion: caja.id }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: "No pude abrir el pago." };
  }
  const json = await leerJson(res);
  if (!res.ok) return { ok: false, error: json.error || "No pude abrir el pago." };
  if (json.token) aplicarRespuesta(dir, caja, json, ahora);
  const foto = fotoLicencia(dir, ahora, env);
  if (foto.estado === "vigente") return { ok: true, ...foto };
  if (!json.url) return { ok: false, error: "Wompi no entregó la página de pago." };
  return { ok: true, url: json.url, ...foto, estado: json.estado || foto.estado };
}

export function activarCodigo({ dir, codigo, ahora = new Date(), env = process.env } = {}) {
  const caja = asegurarInstalacion(dir);
  const limpio = String(codigo || "").replace(/\s+/g, "");
  const revisado = estadoLicencia({ token: limpio, instalacion: caja.id, ahora });
  if (revisado.estado === "vencida") {
    return { ok: false, error: "Ese código ya se venció.", ...fotoLicencia(dir, ahora, env) };
  }
  if (revisado.estado !== "vigente") {
    return { ok: false, error: "Ese código no abre esta instalación.", ...fotoLicencia(dir, ahora, env) };
  }
  guardarCaja(dir, { ...caja, token: limpio, visto: ahora.toISOString() });
  return { ok: true, ...fotoLicencia(dir, ahora, env) };
}

export async function confirmarPlan({ dir, env = process.env, pedir = fetch, ahora = new Date() } = {}) {
  const base = urlServicio(env);
  if (!base) return { ok: false, error: "El pago todavía no está conectado.", ...fotoLicencia(dir, ahora, env) };
  const caja = asegurarInstalacion(dir);
  let res;
  try {
    res = await pedir(`${base}/estado?instalacion=${encodeURIComponent(caja.id)}`, {
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: "No pude confirmar el pago.", ...fotoLicencia(dir, ahora, env) };
  }
  const json = await leerJson(res);
  if (!res.ok) return { ok: false, error: json.error || "No pude confirmar el pago.", ...fotoLicencia(dir, ahora, env) };
  aplicarRespuesta(dir, caja, json, ahora);
  const foto = fotoLicencia(dir, ahora, env);
  if (foto.estado === "vigente") return { ok: true, ...foto };
  if (json.pendiente) return { ok: true, ...foto, estado: "pendiente" };
  return { ok: false, error: "Todavía no hay un pago confirmado.", ...foto };
}
