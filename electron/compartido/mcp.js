// Lógica pura del conector MCP. No abre sockets ni lee la base: eso vive
// en src/mcp.js. El relevo (mcpb/server/relevo.js) repite la ruta a mano
// porque se empaqueta solo, sin este módulo.
import path from "node:path";

export const MENSAJE_CERRADO = "Abra Vigencia para usar el conector";
export const MENSAJE_PLAN = "Tu plan de Vigencia no está vigente. Renueva en Vigencia, Ajustes, Plan.";
export const MENSAJE_CODIGO = "El código de emparejamiento no coincide. Genérelo de nuevo en Vigencia.";
export const MENSAJE_NO_COMPARTIDO = "Ese caso no está compartido con el conector.";
export const MENSAJE_SOLO_LOCAL = "Ese proyecto está en Solo local y no se puede compartir.";
export const MENSAJE_PRIVADO = "Ese proceso es privado y no se puede compartir.";
export const METODO_EMPAREJAR = "vigencia/emparejar";

export const CLAVE_ACTIVO = "mcp_activo";
export const CLAVE_CODIGO = "mcp_codigo_sha256";

export const PLANES = ["prueba", "vigente", "vencida", "sin_pago"];

// La primera línea del socket, antes del JSON-RPC de MCP. El relevo la
// escribe igual, carácter por carácter: no puede importar este módulo.
export function lineaEmparejar(codigo) {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: METODO_EMPAREJAR,
    params: { codigo: String(codigo || "") },
  });
}

export function codigoDeEmparejar(linea) {
  try {
    const mensaje = JSON.parse(String(linea || ""));
    if (mensaje && mensaje.method === METODO_EMPAREJAR) {
      return { emparejar: true, codigo: String(mensaje.params?.codigo || "") };
    }
  } catch {
    /* no era la línea de emparejamiento */
  }
  return { emparejar: false, codigo: "" };
}

export function errorJsonRpc(linea, mensaje) {
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

// Unix y macOS: el socket queda junto a la base. Windows: tubería con
// nombre, limitada al usuario (el servidor pide readableAll y writableAll
// en falso, que es el DACL del usuario actual).
export function rutaSocket({ plataforma, datosDir, usuario }) {
  if (plataforma === "win32") {
    const nombre = String(usuario || "usuario").replace(/[\\/:*?"<>|]/g, "") || "usuario";
    return `\\\\.\\pipe\\vigencia-mcp-${nombre}`;
  }
  return path.join(String(datosDir || ""), "mcp.sock");
}

// Carpeta de datos de la app instalada. En desarrollo la app usa el
// repositorio (directorioDatos); el relevo, que corre fuera de Electron,
// cae aquí salvo que reciba VIGENCIA_DATOS o VIGENCIA_SOCK.
export function directorioDatosInstalado({ plataforma, env = {} }) {
  const home = env.HOME || env.USERPROFILE || "";
  if (plataforma === "darwin") return path.join(home, "Library", "Application Support", "Vigencia");
  if (plataforma === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Vigencia");
  }
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "Vigencia");
}

// Un proyecto en Solo local y un proceso privado no salen de este computador.
export function puedeCompartir({ tipo, soloLocal = false, esPrivado = false } = {}) {
  if (tipo === "proyecto" && soloLocal) return { ok: false, error: MENSAJE_SOLO_LOCAL };
  if (tipo === "proceso" && esPrivado) return { ok: false, error: MENSAJE_PRIVADO };
  return { ok: true };
}

// vence vacío no caduca. Si la fecha ya llegó, el permiso no vale.
export function permisoSigueVigente(permiso, ahora) {
  if (!permiso) return false;
  if (permiso.nivel !== "lectura" && permiso.nivel !== "proponer") return false;
  if (!permiso.vence) return true;
  const fin = Date.parse(permiso.vence);
  const momento = Date.parse(ahora);
  if (Number.isFinite(fin) && Number.isFinite(momento)) return momento < fin;
  return String(permiso.vence) > String(ahora);
}

export function armarEstado({
  version,
  plan = "sin_pago",
  diasRestantes = null,
  procesos = 0,
  proyectos = 0,
  ultimaRevision = null,
} = {}) {
  const estado = PLANES.includes(plan) ? plan : "sin_pago";
  return {
    version: String(version || ""),
    plan: estado,
    dias_restantes: estado === "prueba" && Number.isInteger(diasRestantes) ? diasRestantes : null,
    procesos_compartidos: Math.max(0, Number(procesos) || 0),
    proyectos_compartidos: Math.max(0, Number(proyectos) || 0),
    ultima_revision: ultimaRevision ? String(ultimaRevision) : null,
  };
}

export function textoEstado(estado) {
  const dias = estado.plan === "prueba" && estado.dias_restantes != null
    ? ` Te quedan ${estado.dias_restantes} días de prueba.`
    : "";
  const revision = estado.ultima_revision ? ` Última revisión: ${estado.ultima_revision}.` : "";
  return `Vigencia ${estado.version}. Plan: ${estado.plan}.${dias} Procesos compartidos: ${estado.procesos_compartidos}. Proyectos compartidos: ${estado.proyectos_compartidos}.${revision}`;
}

export const ESQUEMA_ESTADO = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "plan",
    "dias_restantes",
    "procesos_compartidos",
    "proyectos_compartidos",
    "ultima_revision",
  ],
  properties: {
    version: { type: "string" },
    plan: { type: "string", enum: PLANES },
    dias_restantes: { type: ["integer", "null"] },
    procesos_compartidos: { type: "integer", minimum: 0 },
    proyectos_compartidos: { type: "integer", minimum: 0 },
    ultima_revision: { type: ["string", "null"] },
  },
};
