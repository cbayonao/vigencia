// Canales IPC del módulo Documentos. main.js los registra con su base, su
// ventana y su forma de responder.
import fs from "node:fs";
import path from "node:path";
import { CLASES_FUENTE, TIPOS_DOCUMENTO, claseDeNombre, diferencias } from "../compartido/documentos.js";
import { EXTENSIONES } from "../compartido/convertir.js";
import { tituloLista } from "../compartido/logica.js";
import { listarProcesos } from "./db.js";
import { borrarPieza, buscarFuentes, etiquetasUsadas, guardarPieza, leerPieza } from "./biblioteca.js";
import {
  actualizarProyecto, borrarPerfil, borrarProyecto, conversar, crearProyecto, duplicarProyecto, elegirFuentes,
  citasDeVersion, escritoDeVersion, guardarEdicionDocumento, guardarPerfil, guardarVersion, leerProyecto, leerVersion, listarPerfiles, listarProyectos,
  pendientesDeVersion, prepararRevision, revisarCitas,
  modeloDelProyecto, restaurarVersion, borrarVersion,
} from "./documentos.js";
import { listarModelos } from "./ia.js";
import { docxDeEscrito, odtDeEscrito } from "./docx.js";
import { importarABiblioteca, ligarArchivo, mismoTextoQueArchivo, piezaDelArchivo, revisarRuta, textoDeArchivo } from "./fuentes.js";
import { htmlDocumento } from "./memorial.js";
import { pdfDesdeHtml } from "./pdf.js";

function nombreArchivo(valor, extension) {
  const base = String(valor || "Documento").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Documento";
  return `${base}.${extension}`;
}

// convertirDatos llega de registrarConvertir (la cola del conversor): toda
// fuente que viene de un archivo pasa por ahí, con caché, OCR y progreso.
export function registrarDocumentos({ ipcMain, dialog, db, datosDir, ventana, responder, mensajeHumano, convertirDatos }) {
  const base = () => db();
  ipcMain.handle("documentos-inicio", () => responder(() => ({
    tipos: TIPOS_DOCUMENTO,
    clases: CLASES_FUENTE,
    perfiles: listarPerfiles(base()),
    proyectos: listarProyectos(base()),
    archivados: listarProyectos(base(), { archivados: true }),
    modelos: listarModelos(datosDir()),
    etiquetas: etiquetasUsadas(base()),
    expedientes: listarProcesos(base()).map((p) => ({ id: Number(p.id_proceso), radicado: p.radicado, titulo: tituloLista(p) })),
  })));
  ipcMain.handle("documentos-proyecto", (_e, dato) => responder(() => {
    const leido = leerProyecto(base(), dato?.id);
    return { ...leido, modelo: modeloDelProyecto(datosDir(), leido.perfil, dato?.modelo) };
  }));
  ipcMain.handle("documentos-crear", (_e, dato) => responder(() => ({ proyecto: crearProyecto(base(), dato || {}) })));
  ipcMain.handle("documentos-actualizar", (_e, dato) => responder(() => ({ proyecto: actualizarProyecto(base(), dato?.id, dato?.cambios || {}) })));
  ipcMain.handle("documentos-duplicar", (_e, dato) => responder(() => ({ proyecto: duplicarProyecto(base(), dato?.id) })));
  ipcMain.handle("documentos-borrar", (_e, dato) => responder(() => {
    borrarProyecto(base(), dato?.id);
    return {};
  }));
  ipcMain.handle("documentos-fuentes", (_e, dato) => responder(() => {
    elegirFuentes(base(), dato?.id, dato?.fuentes);
    return {};
  }));
  ipcMain.handle("documentos-version", (_e, dato) => responder(() => ({ version: leerVersion(base(), dato?.id) })));
  ipcMain.handle("documentos-citas", (_e, dato) => responder(() => ({
    citas: citasDeVersion(base(), dato?.id),
    pendientes: pendientesDeVersion(base(), dato?.id),
  })));
  ipcMain.handle("documentos-revisar-citas", (_e, dato) => responder(() => {
    const previa = prepararRevision({ db: base(), datosDir: datosDir(), proyectoId: dato?.id, documento: dato?.documento ?? null });
    return { informe: previa.informe, texto: previa.encargo, soloLocal: Boolean(previa.proyecto?.solo_local) };
  }));
  ipcMain.handle("documentos-revisor", async (_e, dato) => {
    try {
      return {
        ok: true,
        ...(await revisarCitas({
          db: base(),
          datosDir: datosDir(),
          proyectoId: dato?.id,
          versionId: dato?.version,
          documento: dato?.documento ?? null,
          confirmado: String(dato?.confirmado || ""),
        })),
      };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  ipcMain.handle("documentos-diferencias", (_e, dato) => responder(() => {
    const a = dato?.antes ? leerVersion(base(), dato.antes) : null;
    const b = leerVersion(base(), dato?.despues);
    return { diferencias: diferencias(a?.cuerpo || "", b.cuerpo), antes: a?.numero || 0, despues: b.numero };
  }));
  ipcMain.handle("documentos-restaurar", (_e, dato) => responder(() => ({ version: restaurarVersion(base(), dato?.id) })));
  ipcMain.handle("documentos-version-borrar", (_e, dato) => responder(() => {
    borrarVersion(base(), dato?.id);
    return {};
  }));
  ipcMain.handle("documentos-guardar-texto", (_e, dato) => responder(() => {
    const r = guardarEdicionDocumento(base(), dato?.id, dato?.cuerpo, Array.isArray(dato?.ids) ? dato.ids.map((x) => (x ? String(x) : null)) : []);
    return { version: r.version, cambiados: r.cambiados };
  }));
  ipcMain.handle("documentos-conversar", async (evento, dato) => {
    try {
      const resultado = await conversar({
        db: base(),
        datosDir: datosDir(),
        proyectoId: dato?.id,
        mensaje: dato?.mensaje,
        modeloId: dato?.modelo,
        pasaje: dato?.pasaje || "",
        documento: dato?.documento ?? null,
        confirmado: String(dato?.confirmado || ""),
        onProgreso: (avance) => {
          try {
            evento.sender.send("documentos-progreso", avance);
          } catch {
            /* la ventana se cerró */
          }
        },
      });
      return { ok: true, ...resultado };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  ipcMain.handle("documentos-perfil-guardar", (_e, dato) => responder(() => ({ perfil: guardarPerfil(base(), dato || {}) })));
  ipcMain.handle("documentos-perfil-borrar", (_e, dato) => responder(() => {
    borrarPerfil(base(), dato?.id);
    return {};
  }));
  ipcMain.handle("documentos-fuentes-buscar", (_e, dato) => responder(() => ({
    fuentes: buscarFuentes(base(), dato || {}),
    etiquetas: etiquetasUsadas(base()),
  })));
  ipcMain.handle("documentos-fuente-leer", (_e, dato) => responder(() => ({ fuente: leerPieza(base(), dato?.id) })));
  ipcMain.handle("documentos-fuente-guardar", (_e, dato) => responder(() => {
    const { archivoId, ...resto } = dato || {};
    let fuente = guardarPieza(base(), { ...resto, clase: resto.clase || "nota", tipo: undefined, archivoId: undefined });
    // Importada y guardada sin cambios: queda ligada al archivo convertido.
    if (!resto.id && archivoId && mismoTextoQueArchivo(base(), datosDir(), archivoId, fuente.texto)) fuente = ligarArchivo(base(), fuente.id, archivoId);
    return { fuente };
  }));
  ipcMain.handle("documentos-fuente-borrar", (_e, dato) => responder(() => {
    borrarPieza(base(), dato?.id);
    return {};
  }));
  ipcMain.handle("documentos-fuente-importar", async () => {
    try {
      const elegido = await dialog.showOpenDialog(ventana(), {
        title: "Importar una fuente",
        properties: ["openFile"],
        filters: [{ name: "PDF, imágenes, Word, Excel, HTML o texto", extensions: Object.keys(EXTENSIONES) }],
      });
      if (elegido.canceled || !elegido.filePaths[0]) return { ok: false, cancelado: true };
      const ruta = elegido.filePaths[0];
      const archivo = path.basename(ruta);
      const problema = revisarRuta(ruta);
      if (problema) return { ok: false, error: problema };
      const r = await convertirDatos({ datos: fs.readFileSync(ruta), nombre: archivo, meta: { herramienta: "biblioteca" } });
      if (r.error || !r.archivo) return { ok: false, error: r.error || "No pude leer ese archivo." };
      const existente = piezaDelArchivo(base(), r.archivo.id);
      if (existente) return { ok: true, existente: existente.id, nombre: existente.nombre };
      const texto = textoDeArchivo(base(), datosDir(), r.archivo.id);
      if (!texto) return { ok: false, error: r.archivo.aviso || "Ese archivo quedó sin texto." };
      const nombre = archivo.replace(/\.[^.]+$/, "");
      return { ok: true, nombre, texto, archivo, archivoId: r.archivo.id, aviso: r.archivo.aviso || "", clase: claseDeNombre(nombre) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  // Arrastrar y soltar: recibe rutas del renderer (File.path) y guarda cada
  // archivo como fuente de la biblioteca. No asocia al proyecto: el renderer
  // marca los ids devueltos y el usuario pulsa Usar las marcadas.
  ipcMain.handle("documentos-fuentes-importar-rutas", async (_e, dato) => {
    try {
      const rutas = Array.isArray(dato?.rutas) ? dato.rutas.slice(0, 20) : [];
      if (!rutas.length) return { ok: true, fuentes: [], errores: [] };
      const r = await importarABiblioteca({ db: base(), datosDir: datosDir(), rutas, convertirDatos, mensajeHumano });
      return { ok: true, ...r };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  async function guardarComo(titulo, nombre, extension, bytes) {
    const elegido = await dialog.showSaveDialog(ventana(), {
      title: titulo,
      defaultPath: nombreArchivo(nombre, extension),
      filters: [{ name: { pdf: "PDF", odt: "OpenDocument" }[extension] || "Word", extensions: [extension] }],
    });
    if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
    let ruta = elegido.filePath;
    if (!ruta.toLowerCase().endsWith(`.${extension}`)) ruta += `.${extension}`;
    fs.writeFileSync(ruta, bytes);
    return { ok: true, ruta };
  }
  ipcMain.handle("documentos-exportar", async (_e, dato) => {
    try {
      const version = leerVersion(base(), dato?.version);
      const escrito = escritoDeVersion(version);
      const pie = dato?.pie !== false;
      if (dato?.formato === "pdf") {
        const pdf = await pdfDesdeHtml(htmlDocumento(escrito, { pie }), ventana());
        return await guardarComo("Descargar el documento en PDF", escrito.asunto, "pdf", pdf);
      }
      if (dato?.formato === "odt") return await guardarComo("Guardar el documento para LibreOffice", escrito.asunto, "odt", odtDeEscrito(escrito, { pie }));
      return await guardarComo("Guardar el documento en Word", escrito.asunto, "docx", docxDeEscrito(escrito, { pie, titulo: true }));
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
}
