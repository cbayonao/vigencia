// Relevo del conector. Sin dependencias de npm: Claude Desktop lo lanza por
// stdio y este archivo copia cada línea al socket de Vigencia, y al revés.
// Si Vigencia está cerrada, cada solicitud recibe un error legible.
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MENSAJE_CERRADO = "Abra Vigencia para usar el conector";

// Igual que lineaEmparejar de compartido/mcp.js. Este archivo no lo importa:
// el .mcpb se empaqueta solo.
export function lineaEmparejar(codigo) {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "vigencia/emparejar",
    params: { codigo: String(codigo || "") },
  });
}

export function rutaRelevo(env = process.env, plataforma = process.platform) {
  if (env.VIGENCIA_SOCK) return env.VIGENCIA_SOCK;
  if (plataforma === "win32") {
    const usuario = String(env.USERNAME || "usuario").replace(/[\\/:*?"<>|]/g, "") || "usuario";
    return `\\\\.\\pipe\\vigencia-mcp-${usuario}`;
  }
  return path.join(directorioDatos(env, plataforma), "mcp.sock");
}

function directorioDatos(env, plataforma) {
  if (env.VIGENCIA_DATOS) return env.VIGENCIA_DATOS;
  const home = env.HOME || env.USERPROFILE || "";
  if (plataforma === "darwin") return path.join(home, "Library", "Application Support", "Vigencia");
  if (plataforma === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Vigencia");
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "Vigencia");
}

// Respuesta JSON-RPC para una solicitud. Una notificación (sin id) no se
// responde. Una línea que no es JSON se ignora.
export function errorDeSolicitud(linea, mensaje) {
  const texto = String(linea || "").trim();
  if (!texto) return null;
  let mensajeJson;
  try {
    mensajeJson = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!mensajeJson || typeof mensajeJson !== "object" || !mensajeJson.method) return null;
  if (!Object.hasOwn(mensajeJson, "id") || mensajeJson.id === undefined) return null;
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: mensajeJson.id,
    error: { code: -32000, message: mensaje },
  })}\n`;
}

function leerLineas(entrada, alLinea) {
  let buf = Buffer.alloc(0);
  const onData = (chunk) => {
    const dato = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buf = Buffer.concat([buf, dato]);
    let corte = buf.indexOf(0x0a);
    while (corte !== -1) {
      const linea = buf.subarray(0, corte).toString("utf8").replace(/\r$/, "");
      buf = buf.subarray(corte + 1);
      alLinea(linea);
      corte = buf.indexOf(0x0a);
    }
  };
  entrada.on("data", onData);
  return {
    parar() {
      entrada.off("data", onData);
      return buf;
    },
  };
}

export function conectarRelevo({ ruta = rutaRelevo(), entrada = process.stdin, salida = process.stdout } = {}) {
  // La entrada se queda quieta hasta saber si Vigencia contestó. Así no se
  // pierde el primer mensaje ni se mezcla con el modo de error.
  if (typeof entrada.pause === "function") entrada.pause();
  let modo = "espera";
  const socket = net.createConnection(ruta);

  socket.on("connect", () => {
    if (modo !== "espera") return;
    modo = "conectado";
    // El código llega por el entorno (VIGENCIA_CODIGO) y solo viaja en esta
    // primera línea. No se escribe en la salida ni en un registro.
    const previa = `${lineaEmparejar(process.env.VIGENCIA_CODIGO || "")}\n`;
    socket.write(previa, () => {
      if (modo !== "conectado") return;
      entrada.pipe(socket);
      socket.pipe(salida);
      if (typeof entrada.resume === "function") entrada.resume();
    });
  });
  socket.on("error", () => {
    if (modo !== "espera") return;
    modo = "cerrado";
    socket.destroy();
    leerLineas(entrada, (linea) => {
      const respuesta = errorDeSolicitud(linea, MENSAJE_CERRADO);
      if (respuesta) salida.write(respuesta);
    });
    if (typeof entrada.resume === "function") entrada.resume();
  });
  socket.on("close", () => {
    if (modo === "conectado" && typeof salida.end === "function") salida.end();
  });
  return {
    cerrar() {
      modo = "cerrado";
      socket.destroy();
    },
  };
}

function esEntrada() {
  const entrada = process.argv[1];
  if (!entrada) return false;
  return import.meta.url === pathToFileURL(entrada).href;
}

if (esEntrada()) {
  process.stdout.on("error", () => {});
  conectarRelevo();
}
