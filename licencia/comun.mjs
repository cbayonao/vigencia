import crypto from "node:crypto";

export const PRECIO_PESOS = 599900;
export const PRECIO_CENTAVOS = PRECIO_PESOS * 100;
export const MONEDA = "COP";

export function textoPrecio(pesos = PRECIO_PESOS) {
  const n = Math.round(Number(pesos) || 0);
  return `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function firmaIntegridad(referencia, centavos, moneda, secreto) {
  const sum = crypto.createHash("sha256")
    .update(String(referencia) + String(centavos) + String(moneda) + String(secreto))
    .digest("hex");
  return sum;
}

export function urlCheckout({ publica, referencia, centavos, moneda, integridad, redirect }) {
  const firma = firmaIntegridad(referencia, centavos, moneda, integridad);
  const partes = [
    `public-key=${encodeURIComponent(publica)}`,
    `currency=${encodeURIComponent(moneda)}`,
    `amount-in-cents=${centavos}`,
    `reference=${encodeURIComponent(referencia)}`,
    `signature:integrity=${firma}`,
  ];
  if (String(redirect || "").startsWith("https://")) {
    partes.push(`redirect-url=${encodeURIComponent(redirect)}`);
  }
  return `https://checkout.wompi.co/p/?${partes.join("&")}`;
}

export function b64url(dato) {
  return Buffer.from(dato).toString("base64url");
}

export function firmarToken(payload, privadaPem) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const cuerpo = b64url(JSON.stringify(payload));
  const datos = `${header}.${cuerpo}`;
  const firma = crypto.sign("sha256", Buffer.from(datos), privadaPem);
  return `${datos}.${b64url(firma)}`;
}

export function siguienteHasta(anteriorIso, ahora) {
  const previa = Date.parse(anteriorIso || "");
  const base = Number.isFinite(previa) && previa > ahora.getTime() ? previa : ahora.getTime();
  const hasta = new Date(base);
  hasta.setUTCFullYear(hasta.getUTCFullYear() + 1);
  return hasta.toISOString();
}

function valorEn(data, ruta) {
  let actual = data;
  for (const parte of String(ruta || "").split(".")) {
    if (!actual || typeof actual !== "object" || !(parte in actual)) return null;
    actual = actual[parte];
  }
  if (actual == null) return "";
  if (typeof actual === "string") return actual;
  if (typeof actual === "number" || typeof actual === "boolean") return String(actual);
  return null;
}

export function verificarEvento(cuerpo, secreto) {
  if (!secreto) return { ok: false, error: "eventos sin secreto" };
  let env;
  try {
    env = typeof cuerpo === "string" ? JSON.parse(cuerpo) : cuerpo;
  } catch {
    return { ok: false, error: "evento ilegible" };
  }
  const propiedades = env?.signature?.properties;
  const checksum = String(env?.signature?.checksum || "");
  if (!Array.isArray(propiedades) || !checksum) return { ok: false, error: "firma ausente" };
  let cadena = "";
  for (const ruta of propiedades) {
    const valor = valorEn(env.data, ruta);
    if (valor == null) return { ok: false, error: "propiedad ausente" };
    cadena += valor;
  }
  cadena += String(env.timestamp ?? "");
  cadena += secreto;
  const got = crypto.createHash("sha256").update(cadena).digest("hex");
  const a = Buffer.from(got);
  const b = Buffer.from(checksum.toLowerCase());
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "firma inválida" };
  }
  const tx = env.data?.transaction || {};
  return {
    ok: true,
    evento: env.event || "",
    referencia: String(tx.reference || ""),
    status: String(tx.status || ""),
  };
}

export function aprobada(filas, referencia, centavos) {
  for (const tx of filas || []) {
    if (tx.reference !== referencia) continue;
    if (String(tx.currency || "").toUpperCase() !== MONEDA) continue;
    if (Number(tx.amount_in_cents) !== Number(centavos)) continue;
    if (tx.status === "APPROVED") return tx;
  }
  return null;
}

export function wompiDesdeEnv(env = process.env) {
  const publica = String(env.WOMPI_PUBLIC_KEY || "").trim();
  const privada = String(env.WOMPI_PRIVATE_KEY || "").trim();
  const integridad = String(env.WOMPI_INTEGRITY_SECRET || "").trim();
  const eventos = String(env.WOMPI_EVENTS_SECRET || "").trim();
  const sandbox = String(env.WOMPI_ENV || "sandbox").toLowerCase() !== "production";
  return {
    lista: Boolean(publica && privada && integridad),
    publica,
    privada,
    integridad,
    eventos,
    sandbox,
    base: sandbox ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1",
  };
}
