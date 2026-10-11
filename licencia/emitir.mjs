import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { firmarToken } from "./comun.mjs";

const ANOS = 10;

export function codigoDe({ instalacion, privada, ahora = new Date(), anos = ANOS }) {
  if (!/^[a-f0-9]{64}$/.test(String(instalacion || ""))) {
    throw new Error("La instalación no es válida.");
  }
  const hasta = new Date(ahora.getTime());
  hasta.setUTCFullYear(hasta.getUTCFullYear() + anos);
  const token = firmarToken({
    inst: instalacion,
    hasta: hasta.toISOString(),
    iat: Math.floor(ahora.getTime() / 1000),
  }, privada);
  return { token, hasta: hasta.toISOString() };
}

function escribir(ruta, ahora = new Date()) {
  const caja = JSON.parse(fs.readFileSync(ruta, "utf8"));
  const privada = fs.readFileSync(path.join(import.meta.dirname, "claves", "licencia-privada.pem"), "utf8");
  const emitido = codigoDe({ instalacion: caja.id, privada, ahora });
  fs.writeFileSync(ruta, `${JSON.stringify({ ...caja, token: emitido.token, visto: ahora.toISOString() })}\n`, { mode: 0o600 });
  return emitido;
}

const esDirecto = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esDirecto) {
  const ruta = path.resolve(process.argv[2] || path.join(import.meta.dirname, "..", "licencia.json"));
  const emitido = escribir(ruta);
  console.log(`Código guardado. Esta instalación queda abierta hasta ${emitido.hasta.slice(0, 10)}.`);
  console.log(emitido.token);
}
