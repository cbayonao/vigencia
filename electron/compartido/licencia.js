import crypto from "node:crypto";

export const PRECIO_PESOS = 599900;
export const PRECIO_CENTAVOS = PRECIO_PESOS * 100;
export const MONEDA = "COP";

export const LLAVE_PUBLICA = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmFsrZ/ntOmFlRVVguBzC
cXjdmUUrghUpGkQnqUOmDQ8CHfobtPM9zL4irQ5zLXyTWehZynWeqgfZvrZs0khf
DTYSLTPZmdwctfuQfpnrgsSM/u2OPi4uveI5injSdmfQiNkbjfKN32s7YM107aYj
DFRH3+0Kw1o6E0iYb/RxcAUzZcuA3D4VtKHTjvxtFyMhW1oShuiiCWHrHyFnnETM
sYZfh9qd+osAIgxuOIXBr0rIBGfrdlH2X7Zr7tYF4pR1ILCAEIZHXufFQtGv9PGr
J1Z/NCxKXruUOClF71IIXz8+mhzKbGOC0R+a8r3LEf+UgHOMvxaA0rDG7x6EuTuz
YwIDAQAB
-----END PUBLIC KEY-----`;

const HOLGURA_MS = 5 * 60 * 1000;

export function textoPrecio(pesos = PRECIO_PESOS) {
  const n = Math.round(Number(pesos) || 0);
  return `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export const URL_SERVICIO = "https://7j8bqraswk.execute-api.us-east-1.amazonaws.com";

export function urlServicio(env = process.env) {
  const crudo = Object.prototype.hasOwnProperty.call(env, "VIGENCIA_LICENCIA_URL")
    ? env.VIGENCIA_LICENCIA_URL
    : URL_SERVICIO;
  const candidato = String(crudo || "").trim().replace(/\/$/, "");
  if (candidato.startsWith("https://")) return candidato;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(candidato)) return candidato;
  return "";
}

export function leerToken(token, publica = LLAVE_PUBLICA) {
  const partes = String(token || "").split(".");
  if (partes.length !== 3) return null;
  let firma;
  try {
    firma = Buffer.from(partes[2], "base64url");
  } catch {
    return null;
  }
  const ok = crypto.verify("sha256", Buffer.from(`${partes[0]}.${partes[1]}`), publica, firma);
  if (!ok) return null;
  try {
    return JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function estadoLicencia({ token, instalacion, ahora = new Date(), visto = "", publica = LLAVE_PUBLICA } = {}) {
  const dato = leerToken(token, publica);
  if (!dato || dato.inst !== instalacion || typeof dato.hasta !== "string") {
    return { estado: "sin_pago", precioTexto: textoPrecio() };
  }
  const hastaMs = Date.parse(dato.hasta);
  const iatMs = Number(dato.iat) * 1000;
  if (!Number.isFinite(hastaMs)) return { estado: "sin_pago", precioTexto: textoPrecio() };
  const ahoraMs = ahora.getTime();
  const vistoMs = Date.parse(visto || "");
  const relojAtras = (Number.isFinite(iatMs) && ahoraMs + HOLGURA_MS < iatMs)
    || (Number.isFinite(vistoMs) && ahoraMs + HOLGURA_MS < vistoMs);
  if (relojAtras || ahoraMs >= hastaMs) {
    return { estado: "vencida", hasta: dato.hasta, precioTexto: textoPrecio() };
  }
  return { estado: "vigente", hasta: dato.hasta, precioTexto: textoPrecio() };
}
