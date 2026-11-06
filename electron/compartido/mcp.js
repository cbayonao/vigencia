// Lógica pura del conector MCP. No abre sockets ni lee la base: eso vive
// en src/mcp.js. El relevo (mcpb/server/relevo.js) repite la ruta a mano
// porque se empaqueta solo, sin este módulo.
import path from "node:path";

export const MENSAJE_CERRADO = "Abra Vigencia para usar el conector";

export const PLANES = ["prueba", "vigente", "vencida", "sin_pago"];

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
