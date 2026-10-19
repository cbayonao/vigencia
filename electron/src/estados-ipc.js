// Canales de Estados: leer listados de estado (PDF, Excel, Word, HTML) a
// tabla y exportarla. La lectura vive en compartido/estados.js y las
// posiciones del PDF salen del mismo conversor (itemsDePdf).
import fs from "node:fs";
import path from "node:path";
import {
  COLUMNAS_EXPORTAR, columnasConDatos, csvDeFilas, estadoAMarkdown, filasParaExportar, leerEstado, leerPorLineas, leerTabla,
} from "../compartido/estados.js";
import { extensionDe, quitarEncabezado } from "../compartido/convertir.js";
import { convertirDatos, itemsDePdf, tablasDeDatos } from "./convertir/convertidores.js";
import { libroDeHojas } from "./excel.js";
import { guardarTemporal } from "./pdftools-ipc.js";

export const EXTENSIONES_ESTADO = ["pdf", "xlsx", "xls", "ods", "csv", "docx", "html", "htm"];
const MAX_BYTES = 60 * 1024 * 1024;

// Un archivo: { ok, tipo: pdf | tabla | texto, meta, filas, notas, avisos, aviso }
export async function leerArchivoEstado(ruta, { datosDir = "" } = {}) {
  const nombre = path.basename(String(ruta || ""));
  const ext = extensionDe(nombre);
  if (!EXTENSIONES_ESTADO.includes(ext)) return { ok: false, error: "Use un estado en PDF, Excel, CSV, Word o HTML." };
  let datos;
  try {
    const st = fs.statSync(ruta);
    if (!st.isFile()) return { ok: false, error: "Ese archivo no está." };
    if (st.size > MAX_BYTES) return { ok: false, error: "Ese archivo es demasiado grande para un estado." };
    datos = fs.readFileSync(ruta);
  } catch {
    return { ok: false, error: "No pude leer el archivo." };
  }
  const base = { ok: true, ruta, nombre };
  if (ext === "pdf") {
    const { paginas, aviso } = await itemsDePdf(datos, { datosDir });
    const conItems = paginas.filter((p) => p.items.length);
    // OCR sin cajas: queda el texto, línea por línea.
    if (!conItems.length) {
      const texto = paginas.map((p) => p.texto).join("\n");
      if (!texto.trim()) return { ok: false, error: aviso || "Ese PDF no tiene texto. Instale el OCR en Modelos de IA para leer estados escaneados." };
      const r = leerPorLineas(texto);
      return { ...base, tipo: "texto", meta: { paginas: paginas.length }, filas: numerar(r.filas), columnas: columnasConDatos(r.filas), notas: r.notas, avisos: ["El PDF es escaneado y el OCR no dio posiciones: las columnas no se separaron."], aviso };
    }
    const r = leerEstado(paginas);
    const ocr = paginas.some((p) => p.ocr);
    return { ...base, tipo: ocr ? "ocr" : "pdf", ...r, aviso, avisos: [...r.avisos, ...(ocr ? ["Parte del PDF se leyó con OCR."] : [])] };
  }
  const tablas = (await tablasDeDatos(datos, nombre)) || [];
  const leidas = tablas.map((t) => leerTabla(t)).filter((r) => r?.filas.length);
  if (leidas.length) {
    const meta = Object.assign({}, ...leidas.map((r) => r.meta));
    const filas = numerar(leidas.flatMap((r) => r.filas));
    return { ...base, tipo: "tabla", meta, filas, columnas: columnasConDatos(filas), notas: leidas.flatMap((r) => r.notas), avisos: [] };
  }
  // Sin tabla con títulos: el texto del conversor, línea por línea.
  const c = await convertirDatos(datos, nombre, { datosDir });
  const r = leerPorLineas(quitarEncabezado(c.markdown).replace(/^[#|>\s-]+/gm, ""));
  if (!r.filas.length) return { ok: false, error: "No encontré registros de un estado en ese archivo: ni títulos de columnas ni radicados." };
  return { ...base, tipo: "texto", meta: {}, filas: numerar(r.filas), columnas: columnasConDatos(r.filas), notas: r.notas, avisos: ["No encontré los títulos de las columnas: se leyó línea por línea."] };
}

function numerar(filas) {
  return filas.map((f, i) => ({ ...f, id: i + 1 }));
}

function nombreSugerido(lotes, ext) {
  const m = lotes[0]?.meta || {};
  const partes = ["estado", m.estado, (m.fecha || "").split("/").reverse().join("-")].filter(Boolean);
  return `${lotes.length > 1 ? "estados" : partes.join("-")}.${ext}`;
}

export function registrarEstados({ ipcMain, dialog, ventana, mensajeHumano, datosDir }) {
  ipcMain.handle("estados-elegir", async () => {
    try {
      const r = await dialog.showOpenDialog(ventana(), {
        title: "Elegir estados",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Estados (PDF, Excel, Word, HTML)", extensions: EXTENSIONES_ESTADO }],
      });
      return { ok: true, rutas: r.canceled ? [] : r.filePaths };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("estados-leer", async (_e, dato) => {
    try {
      return await leerArchivoEstado(String(dato?.ruta || ""), { datosDir: datosDir() });
    } catch (error) {
      return { ok: false, error: error?.codigo === "clave" ? "Ese PDF tiene contraseña. Ábralo primero en Desbloquear." : mensajeHumano(error) };
    }
  });

  // lotes: [{ nombre, meta, filas }] como los muestra la ventana (ya editados).
  ipcMain.handle("estados-exportar", async (_e, dato) => {
    try {
      const lotes = Array.isArray(dato?.lotes) ? dato.lotes : [];
      const filas = filasParaExportar(lotes);
      if (!filas.length) return { ok: false, error: "No hay filas para exportar." };
      const csv = dato?.formato === "csv";
      const ext = csv ? "csv" : "xls";
      const elegido = await dialog.showSaveDialog(ventana(), {
        title: csv ? "Exportar a CSV" : "Exportar a Excel",
        defaultPath: nombreSugerido(lotes, ext),
        filters: [csv ? { name: "CSV", extensions: ["csv"] } : { name: "Excel", extensions: ["xls"] }],
      });
      if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
      let ruta = elegido.filePath;
      if (!ruta.toLowerCase().endsWith(`.${ext}`)) ruta += `.${ext}`;
      const contenido = csv ? csvDeFilas(COLUMNAS_EXPORTAR, filas) : libroDeHojas([{ nombre: "Estado", columnas: COLUMNAS_EXPORTAR, filas }]);
      fs.writeFileSync(ruta, contenido, "utf8");
      return { ok: true, ruta, filas: filas.length };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  // Para Usar con la IA: la tabla en Markdown, en la carpeta temporal.
  ipcMain.handle("estados-markdown", (_e, dato) => {
    try {
      const lote = dato?.lote || {};
      const base = path.basename(String(lote.nombre || "estado")).replace(/\.[^.]+$/, "");
      const ruta = guardarTemporal(Buffer.from(estadoAMarkdown(lote), "utf8"), `${base}-tabla.md`);
      return { ok: true, ruta };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
}
