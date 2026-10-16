// SPOA (Fiscalía): GET https://consulta-web-bk.fiscalia.gov.co/data/<radicado>
// de 21 o 23 dígitos. Dos particularidades:
// - El servidor entrega la cadena incompleta: solo para este host se acepta
//   sin verificar (node:https por aparte, el fetch global sigue estricto).
// - Responde SOAP (XML) con otro XML escapado adentro en ISO-8859-1.
import https from "node:https";
import { normalizarRadicadoSp, parsearRespuestaSp } from "../compartido/spoa.js";
import { Aviso } from "./db.js";

export const SPOA_HOST = "consulta-web-bk.fiscalia.gov.co";
export const SPOA_URL = `https://${SPOA_HOST}/data`;
const CABECERAS = {
  Accept: "*/*",
  Origin: "https://consulta-web.fiscalia.gov.co",
  Referer: "https://consulta-web.fiscalia.gov.co/",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
};

function pedirTexto(ruta) {
  return new Promise((resolver, rechazar) => {
    const pedido = https.get(
      `https://${SPOA_HOST}${ruta}`,
      {
        headers: CABECERAS,
        rejectUnauthorized: false,
        timeout: 90000,
      },
      (respuesta) => {
        if (respuesta.statusCode !== 200) {
          respuesta.resume();
          rechazar(new Error(`HTTP ${respuesta.statusCode}`));
          return;
        }
        const partes = [];
        respuesta.on("data", (trozo) => partes.push(trozo));
        respuesta.on("end", () => resolver(Buffer.concat(partes).toString("utf8")));
        respuesta.on("error", rechazar);
      },
    );
    pedido.on("timeout", () => pedido.destroy(new Error("sin respuesta")));
    pedido.on("error", rechazar);
  });
}

export async function buscarSp(radicado, veces = 3) {
  const numero = normalizarRadicadoSp(radicado);
  if (numero.length !== 21 && numero.length !== 23) {
    throw new Aviso("El radicado SPOA trae 21 o 23 dígitos.");
  }
  let ultimo = "sin respuesta";
  for (let intento = 1; intento <= veces; intento++) {
    try {
      const sobre = await pedirTexto(`/data/${numero}`);
      const { registros } = parsearRespuestaSp(sobre);
      if (!registros.length) throw new Aviso("Sin resultados para ese radicado.");
      return registros;
    } catch (error) {
      if (error instanceof Aviso) throw error;
      ultimo = String(error?.message || error);
      await new Promise((r) => setTimeout(r, intento * 2000));
    }
  }
  throw new Error(ultimo);
}
