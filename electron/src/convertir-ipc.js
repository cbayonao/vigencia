// Canales IPC del conversor a Markdown. La conversión corre en un
// utilityProcess (src/convertir/proceso.js), uno a la vez, con progreso y
// cancelar. Caché por hash: el mismo archivo no se convierte dos veces.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSIONES, encabezadoYaml, esConvertible } from "../compartido/convertir.js";
import {
  agregarAProyecto, archivosDelProyecto, convertirConCache, guardarAgentes, guardarEdicion, incluirEnContexto, leerAgentes,
  leerArchivo, leerMarkdown, limpiarCache, listarArchivos, quitarDeProyecto, renombrarArchivo, borrarArchivo, PLANTILLA_AGENTS,
} from "./conversiones.js";
import { piezaDeArchivo } from "./fuentes.js";
import { estadoOcr, instalarOcr, quitarOcr } from "./convertir/ocr.js";
import { descargarJuris } from "./juris.js";
import { enviosDelProyecto, historialBloque, prepararBloque, prepararVuelta, proponerBloque, resolverBloque } from "./documentos.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const HERRAMIENTAS_RUTAS = new Set(["convertir", "documentos", "biblioteca", "pdf"]);

export function crearCola({ utilityProcess, datosDir, alProgreso }) {
  let hijo = null;
  const pendientes = [];
  let actual = null;
  let siguienteId = 1;

  function arrancar() {
    if (hijo) return hijo;
    hijo = utilityProcess.fork(path.join(aqui, "convertir", "proceso.js"), [], { serviceName: "Vigencia conversor", stdio: "ignore" });
    hijo.on("message", (m) => {
      if (!actual || m.id !== actual.id) return;
      if (m.tipo === "progreso") alProgreso?.({ id: actual.id, archivoId: actual.archivoId, nombre: actual.nombre, ...m });
      if (m.tipo === "listo" || m.tipo === "error") {
        const t = actual;
        actual = null;
        t.resolver(m);
        bombear();
      }
    });
    hijo.on("exit", () => {
      hijo = null;
      if (actual) {
        const t = actual;
        actual = null;
        t.resolver({ tipo: "error", mensaje: "El conversor se cerró. Intente otra vez." });
      }
      bombear();
    });
    return hijo;
  }

  function bombear() {
    if (actual || !pendientes.length) return;
    actual = pendientes.shift();
    alProgreso?.({ id: actual.id, archivoId: actual.archivoId, nombre: actual.nombre, fase: "leyendo" });
    arrancar().postMessage({ tipo: "convertir", id: actual.id, ruta: actual.ruta, nombre: actual.nombre, datosDir: datosDir(), opciones: actual.opciones });
  }

  return {
    poner({ archivoId, ruta, nombre, opciones }) {
      const id = siguienteId++;
      const promesa = new Promise((resolver) => pendientes.push({ id, archivoId, ruta, nombre, opciones, resolver }));
      alProgreso?.({ id, archivoId, nombre, fase: "en cola" });
      bombear();
      return { id, promesa };
    },
    cancelar(id) {
      const i = pendientes.findIndex((t) => t.id === id);
      if (i >= 0) {
        const [t] = pendientes.splice(i, 1);
        t.resolver({ tipo: "error", codigo: "cancelado", mensaje: "Conversión cancelada." });
        return true;
      }
      if (actual?.id === id && hijo) hijo.postMessage({ tipo: "cancelar", id });
      return Boolean(actual?.id === id);
    },
    cerrar() {
      try {
        hijo?.kill();
      } catch {
        /* ya cerrado */
      }
    },
  };
}

export function registrarConvertir({ ipcMain, dialog, utilityProcess, db, datosDir, ventana, responder, mensajeHumano }) {
  const base = () => db();
  const enviar = (canal, dato) => {
    try {
      ventana()?.webContents.send(canal, dato);
    } catch {
      /* ventana cerrada */
    }
  };
  const cola = crearCola({ utilityProcess, datosDir, alProgreso: (p) => enviar("convertir-progreso", p) });

  // Convierte unos bytes ya leídos (archivo del usuario o PDF de la
  // relatoría) y devuelve la fila de archivo lista.
  async function convertirDatos({ datos, nombre, origen = "usuario", meta = {}, encabezado = {}, proyectoId = null, forzarOcr = false }) {
    return convertirConCache(base(), datosDir(), { datos, nombre, origen, meta, encabezado, proyectoId, forzarOcr }, {
      ejecutar: async (tarea) => {
        const { id, promesa } = cola.poner(tarea);
        return { id, ...(await promesa) };
      },
      alProgreso: (p) => enviar("convertir-progreso", p),
    });
  }

  ipcMain.handle("convertir-inicio", () => responder(() => ({
    archivos: listarArchivos(base()),
    extensiones: Object.keys(EXTENSIONES),
    ocr: estadoOcr(datosDir()),
  })));
  ipcMain.handle("convertir-elegir", async () => {
    const r = await dialog.showOpenDialog(ventana(), {
      title: "Elegir archivos para convertir",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Documentos", extensions: Object.keys(EXTENSIONES) }],
    });
    return { ok: true, rutas: r.canceled ? [] : r.filePaths };
  });
  ipcMain.handle("convertir-rutas", async (_e, dato) => {
    const rutas = (Array.isArray(dato?.rutas) ? dato.rutas : []).map(String).slice(0, 200);
    const resultados = [];
    for (const ruta of rutas) {
      const nombre = path.basename(ruta);
      try {
        if (!esConvertible(nombre)) {
          resultados.push({ nombre, error: "Ese tipo de archivo todavía no se puede convertir." });
          continue;
        }
        const st = fs.statSync(ruta);
        if (st.size > 300 * 1024 * 1024) {
          resultados.push({ nombre, error: "El archivo pesa más de 300 MB." });
          continue;
        }
        const herramienta = HERRAMIENTAS_RUTAS.has(dato?.herramienta) ? dato.herramienta : "convertir";
        resultados.push({ nombre, ...(await convertirDatos({ datos: fs.readFileSync(ruta), nombre, meta: { herramienta }, proyectoId: Number(dato?.proyectoId) || null, forzarOcr: Boolean(dato?.forzarOcr) })) });
      } catch (error) {
        resultados.push({ nombre, error: mensajeHumano(error) });
      }
    }
    return { ok: true, resultados };
  });
  ipcMain.handle("convertir-reconvertir", async (_e, dato) => {
    try {
      const a = leerArchivo(base(), dato?.id);
      const { original } = leerMarkdown(base(), datosDir(), a.id);
      if (!original) return { ok: false, error: "No está la copia del original. Conviértalo otra vez desde el archivo." };
      return { ok: true, ...(await convertirDatos({ datos: fs.readFileSync(original), nombre: a.nombre, origen: a.origen, meta: { herramienta: "convertir" }, forzarOcr: true })) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  ipcMain.handle("convertir-cancelar", (_e, dato) => responder(() => ({ cancelado: cola.cancelar(Number(dato?.id)) })));
  ipcMain.handle("convertir-leer", (_e, dato) => responder(() => leerMarkdown(base(), datosDir(), dato?.id)));
  ipcMain.handle("convertir-renombrar", (_e, dato) => responder(() => ({ archivo: renombrarArchivo(base(), dato?.id, dato?.nombre) })));
  ipcMain.handle("convertir-borrar", (_e, dato) => responder(() => borrarArchivo(base(), datosDir(), dato?.id)));
  ipcMain.handle("convertir-guardar-edicion", (_e, dato) => responder(() => guardarEdicion(base(), datosDir(), dato?.id, dato?.markdown)));
  ipcMain.handle("convertir-guardar-como", async (_e, dato) => {
    try {
      const { archivo, markdown } = leerMarkdown(base(), datosDir(), dato?.id);
      const r = await dialog.showSaveDialog(ventana(), {
        title: "Guardar Markdown",
        defaultPath: `${archivo.nombre.replace(/\.[^.]+$/, "")}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, cancelado: true };
      fs.writeFileSync(r.filePath, markdown);
      return { ok: true, ruta: r.filePath };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  // Una sola fuente por archivo: si ya estaba en la biblioteca, se devuelve
  // la misma. La fuente queda ligada al archivo y usa sus trozos con página.
  ipcMain.handle("convertir-a-biblioteca", (_e, dato) => responder(() => piezaDeArchivo(base(), datosDir(), dato?.id)));
  ipcMain.handle("convertir-limpiar-cache", (_e) => responder(() => limpiarCache(base(), datosDir())));
  ipcMain.handle("convertir-ocr-estado", () => responder(() => ({ ocr: estadoOcr(datosDir()) })));
  ipcMain.handle("convertir-ocr-instalar", async () => {
    try {
      const ocr = await instalarOcr(datosDir(), { onProgreso: (p) => enviar("convertir-ocr-progreso", p) });
      return { ok: true, ocr };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  ipcMain.handle("convertir-ocr-quitar", () => responder(() => ({ ocr: quitarOcr(datosDir()) })));

  // Proyecto: archivos, AGENTS.md, Solo local y Revisar envío.
  ipcMain.handle("proyecto-archivos", (_e, dato) => responder(() => ({ archivos: archivosDelProyecto(base(), dato?.proyectoId) })));
  ipcMain.handle("proyecto-archivo-agregar", (_e, dato) => responder(() => ({ archivos: agregarAProyecto(base(), dato?.proyectoId, dato?.archivoId) })));
  ipcMain.handle("proyecto-archivo-quitar", (_e, dato) => responder(() => ({ archivos: quitarDeProyecto(base(), dato?.proyectoId, dato?.archivoId) })));
  ipcMain.handle("proyecto-archivo-incluir", (_e, dato) => responder(() => ({ archivos: incluirEnContexto(base(), dato?.proyectoId, dato?.archivoId, dato?.incluido) })));
  ipcMain.handle("proyecto-agentes-leer", (_e, dato) => responder(() => {
    const texto = leerAgentes(datosDir(), dato?.proyectoId);
    return { texto, plantilla: PLANTILLA_AGENTS, existe: Boolean(texto) };
  }));
  ipcMain.handle("proyecto-agentes-guardar", (_e, dato) => responder(() => ({ texto: guardarAgentes(datosDir(), dato?.proyectoId, dato?.texto) })));
  ipcMain.handle("proyecto-envios", (_e, dato) => responder(() => ({ envios: enviosDelProyecto(base(), dato?.proyectoId) })));
  ipcMain.handle("documentos-revisar-envio", (_e, dato) => responder(() => {
    const previa = prepararVuelta({
      db: base(), datosDir: datosDir(), proyectoId: dato?.id, mensaje: dato?.mensaje, modeloId: dato?.modelo,
      pasaje: dato?.pasaje || "", documento: dato?.documento ?? null,
    });
    return { informe: previa.informe, texto: previa.encargo, soloLocal: previa.proyecto.solo_local };
  }));

  // Edición por bloque: revisar, proponer, aceptar o rechazar, historial.
  ipcMain.handle("bloque-revisar", (_e, d) => responder(() => {
    const r = prepararBloque({ db: base(), datosDir: datosDir(), proyectoId: d?.id, bloqueId: d?.bloque, mensaje: d?.mensaje, modeloId: d?.modelo });
    return { informe: r.informe, texto: r.encargo, nube: r.previa.elegido.origen === "nube" };
  }));
  ipcMain.handle("bloque-proponer", async (_e, d) => {
    try {
      return { ok: true, ...(await proponerBloque({ db: base(), datosDir: datosDir(), proyectoId: d?.id, bloqueId: d?.bloque, mensaje: d?.mensaje, modeloId: d?.modelo, confirmado: String(d?.confirmado || "") })) };
    } catch (error) {
      return { ok: false, error: error?.message || "No pude pedir el cambio." };
    }
  });
  ipcMain.handle("bloque-resolver", (_e, d) => responder(() => resolverBloque(base(), Number(d?.cambio), Boolean(d?.aceptar))));
  ipcMain.handle("bloque-historial", (_e, id) => responder(() => ({ cambios: historialBloque(base(), String(id || "")) })));

  // Jurisprudencia: bajar el documento, convertirlo y dejarlo listo.
  ipcMain.handle("juris-convertir", async (_e, dato) => {
    try {
      const s = dato?.sentencia || {};
      const documentos = await descargarJuris(s);
      const encabezado = {
        titulo: s.titulo || s.providencia || s.numero || "",
        corporacion: s.corporacion || { ccc: "Corte Constitucional", ce: "Consejo de Estado", csj: "Corte Suprema de Justicia" }[s.fuente] || "",
        providencia: s.providencia || s.numero || "",
        fecha: s.fecha || "",
        ponente: s.ponente || "",
        fuente: s.url || "",
      };
      const salida = [];
      for (const d of documentos) {
        salida.push(await convertirDatos({ datos: d.datos, nombre: d.nombre, origen: "jurisprudencia", meta: { ...encabezado, herramienta: "jurisprudencia" }, encabezado, proyectoId: dato?.proyectoId || null }));
      }
      return { ok: true, resultados: salida };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  return { cola, convertirDatos, encabezadoYaml };
}
