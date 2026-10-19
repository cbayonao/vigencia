// Canales IPC de Herramientas PDF. Los diálogos de abrir/guardar son del
// sistema; los bytes nunca salen del computador.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NIVELES_COMPRIMIR, borrarFirma, camposPdf, comprimirPdf, guardarActa, guardarFirma, leerFirma, listarFirmas, rellenarPdf, verificarPdf } from "./pdftools.js";
import { protegerPdf } from "./pdfproteger.js";
import { desbloquearPdf } from "./pdfdescifrar.js";
import { textoDePdfCompleto } from "./pdftexto.js";
import { revisarRuta } from "./fuentes.js";
import { parsearRangos } from "../compartido/pdftools.js";
import { firmarPdf, infoPdf, rotarPdf, separarPdf, unirPdfs } from "./pdftools.js";

const FILTRO_PDF = [{ name: "PDF", extensions: ["pdf"] }];

function aRutas(valor) {
  return (Array.isArray(valor) ? valor : []).map(String).filter(Boolean).slice(0, 50);
}

// Copias temporales (un PDF ya desbloqueado que el usuario no guardó pero
// quiere llevar al contexto). Viven en la carpeta temporal del sistema y se
// borran a las 24 horas o al cerrar la app.
export function carpetaTemporalPdf(base = os.tmpdir()) {
  return path.join(base, "vigencia-pdf");
}

export function guardarTemporal(bytes, nombre, base = os.tmpdir()) {
  const dir = path.join(carpetaTemporalPdf(base), crypto.randomBytes(8).toString("hex"));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const limpio = String(nombre || "documento.pdf").replace(/[\\/:*?"<>|]+/g, " ").trim() || "documento.pdf";
  const ruta = path.join(dir, limpio.toLowerCase().endsWith(".pdf") ? limpio : `${limpio}.pdf`);
  fs.writeFileSync(ruta, bytes, { mode: 0o600 });
  return ruta;
}

export function limpiarTemporales({ base = os.tmpdir(), edadMs = 24 * 3600 * 1000, ahora = Date.now() } = {}) {
  const raiz = carpetaTemporalPdf(base);
  let borradas = 0;
  let entradas = [];
  try {
    entradas = fs.readdirSync(raiz);
  } catch {
    return 0;
  }
  for (const e of entradas) {
    const ruta = path.join(raiz, e);
    try {
      if (edadMs <= 0 || ahora - fs.statSync(ruta).mtimeMs >= edadMs) {
        fs.rmSync(ruta, { recursive: true, force: true });
        borradas++;
      }
    } catch {
      /* ya no está */
    }
  }
  return borradas;
}

// Texto para Comparar: el mismo lector de Convertir (pdfjs, fuentes CID y
// OCR si está instalado), con el lector simple de respaldo.
export async function textoParaComparar(ruta, { datosDir = "" } = {}) {
  let datos;
  try {
    datos = fs.readFileSync(ruta);
  } catch {
    return { ok: false, error: "No pude leer un PDF." };
  }
  const t = await textoDePdfCompleto(datos, { datosDir });
  if (!t.ok) return { ok: false, error: t.codigo === "clave" || /contraseña/i.test(t.error || "") ? "Uno tiene contraseña: desbloquéelo primero." : t.error };
  return { ok: true, texto: t.texto || "" };
}

export function registrarPdftools({ ipcMain, dialog, ventana, mensajeHumano, datosDir = () => "", convertirDatos = null, db = null }) {
  limpiarTemporales();
  const requireDb = () => {
    const base = typeof db === "function" ? db() : db;
    if (!base) throw new Error("La base no está lista.");
    return base;
  };
  const guardarFirmaDb = (dato) => guardarFirma(requireDb(), { nombre: dato?.nombre, png: dato?.png });

  ipcMain.handle("pdf-elegir", async (_e, dato) => {
    try {
      const r = await dialog.showOpenDialog(ventana(), {
        title: "Elegir PDF",
        properties: dato?.varios ? ["openFile", "multiSelections"] : ["openFile"],
        filters: FILTRO_PDF,
      });
      return { ok: true, rutas: r.canceled ? [] : r.filePaths };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-info", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      return { ok: true, nombre: path.basename(ruta), ...(await infoPdf(ruta)) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  async function guardarComo(titulo, sugerido, bytes) {
    const r = await dialog.showSaveDialog(ventana(), {
      title: titulo,
      defaultPath: sugerido,
      filters: FILTRO_PDF,
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelado: true };
    let ruta = r.filePath;
    if (!ruta.toLowerCase().endsWith(".pdf")) ruta += ".pdf";
    fs.writeFileSync(ruta, bytes);
    return { ok: true, ruta };
  }

  ipcMain.handle("pdf-unir", async (_e, dato) => {
    try {
      const rutas = aRutas(dato?.rutas);
      if (rutas.length < 2) return { ok: false, error: "Elija al menos 2 PDF para unir." };
      const bytes = await unirPdfs(rutas);
      return await guardarComo("Guardar el PDF unido", "unidos.pdf", bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-separar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const total = (await infoPdf(ruta)).paginas;
      const { indices, error } = parsearRangos(dato?.rangos, total);
      if (error) return { ok: false, error };
      const bytes = await separarPdf(ruta, indices);
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar las páginas elegidas", `${base}-paginas.pdf`, bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-rotar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const total = (await infoPdf(ruta)).paginas;
      const texto = String(dato?.rangos || "").trim();
      let indices = null;
      if (texto) {
        const r = parsearRangos(texto, total);
        if (r.error) return { ok: false, error: r.error };
        indices = r.indices;
      }
      const bytes = await rotarPdf(ruta, indices, dato?.angulo);
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF girado", `${base}-girado.pdf`, bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-firmar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const total = (await infoPdf(ruta)).paginas;
      const texto = String(dato?.paginas || "").trim().toLowerCase();
      let paginas = null;
      if (texto === "todas") {
        paginas = Array.from({ length: total }, (_, i) => i);
      } else if (texto) {
        const r = parsearRangos(texto, total);
        if (r.error) return { ok: false, error: r.error };
        paginas = r.indices;
      }
      const caja = dato?.caja ? {
        pagina: Math.min(total, Math.max(1, Number(dato.caja.pagina) || 1)),
        x: Number(dato.caja.x) || 0,
        y: Number(dato.caja.y) || 0,
        ancho: Math.min(400, Math.max(40, Number(dato.caja.ancho) || Number(dato?.ancho) || 150)),
      } : null;
      const r = await firmarPdf(ruta, dato?.firma, {
        paginas,
        posicion: dato?.posicion,
        ancho: Number(dato?.ancho) || 150,
        caja,
        firmante: { nombre: dato?.firmante, documento: dato?.documento },
      });
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      const g = await guardarComo("Guardar el PDF firmado", `${base}-firmado.pdf`, r.bytes);
      if (!g.ok) return g;
      try {
        const db = requireDb();
        guardarActa(db, {
          codigo: r.codigo, fecha: r.fecha, firmante: String(dato?.firmante || "").slice(0, 120),
          documento: String(dato?.documento || "").slice(0, 40), hashContenido: r.hashContenido,
          hashFinal: r.hashFinal, paginas: r.paginas, pdfNombre: path.basename(g.ruta),
        });
      } catch {
        /* el acta en la base es respaldo: el PDF ya trae la constancia */
      }
      return { ...g, codigo: r.codigo, paginas: r.paginas };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  // Bytes del PDF para dibujar la página en la ventana (el visor pdfjs
  // corre en el renderer; aquí solo se leen del disco).
  ipcMain.handle("pdf-archivo", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      if (fs.statSync(ruta).size > 100 * 1024 * 1024) return { ok: false, error: "Ese PDF pesa más de 100 MB." };
      const info = await infoPdf(ruta);
      return { ok: true, nombre: path.basename(ruta), base64: fs.readFileSync(ruta).toString("base64"), ...info };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-verificar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      let db = null;
      try {
        db = requireDb();
      } catch {
        db = null;
      }
      return { ok: true, ...(await verificarPdf(ruta, db)) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("firmas-listar", async () => {
    try {
      return { ok: true, firmas: listarFirmas(requireDb()) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("firma-leer", async (_e, dato) => {
    try {
      const f = leerFirma(requireDb(), dato?.id);
      return { ok: true, firma: f };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("firma-guardar", async (_e, dato) => {
    try {
      return { ok: true, ...(await guardarFirmaDb(dato)) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("firma-borrar", async (_e, dato) => {
    try {
      borrarFirma(requireDb(), dato?.id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-comprimir", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const antes = fs.statSync(ruta).size;
      const r = await comprimirPdf(ruta, dato?.nivel);
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      const g = await guardarComo("Guardar el PDF comprimido", `${base}-comprimido.pdf`, r.bytes);
      if (!g.ok) return g;
      return { ...g, tocadas: r.tocadas, intactas: r.intactas, nivel: r.nivel, antes, despues: r.bytes.length };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-proteger", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const clave = String(dato?.clave || "");
      if (clave.length < 1) return { ok: false, error: "Escriba una contraseña." };
      const bytes = await protegerPdf(ruta, { usuario: clave, duenio: String(dato?.duenio || "") });
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF protegido", `${base}-protegido.pdf`, bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-desbloquear", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const bytes = await desbloquearPdf(ruta, String(dato?.clave || ""));
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      // La copia sin contraseña queda también en un temporal: así se puede
      // llevar al contexto aunque el usuario no guarde una copia.
      const nombre = `${base}-abierto.pdf`;
      const temporal = guardarTemporal(bytes, nombre);
      return { ...(await guardarComo("Guardar el PDF sin contraseña", nombre, bytes)), temporal, nombre };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-campos", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      return { ok: true, nombre: path.basename(ruta), ...(await camposPdf(ruta)) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-rellenar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const bytes = await rellenarPdf(ruta, dato?.valores || {}, { aplanar: dato?.aplanar !== false });
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF diligenciado", `${base}-diligenciado.pdf`, bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-comparar", async (_e, dato) => {
    try {
      const a = String(dato?.rutaA || "");
      const b = String(dato?.rutaB || "");
      if (!a || !b) return { ok: false, error: "Elija los dos PDF." };
      if (a === b) return { ok: false, error: "Son el mismo archivo dos veces." };
      const leidos = [];
      for (const ruta of [a, b]) {
        const t = await textoParaComparar(ruta, { datosDir: datosDir() });
        if (!t.ok) return t;
        leidos.push(t.texto);
      }
      return { ok: true, textoA: leidos[0].slice(0, 300000), textoB: leidos[1].slice(0, 300000) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  // Llevar un PDF (elegido, resultado de una herramienta o copia temporal
  // ya desbloqueada) al conversor: queda en Convertir con su Markdown y, si
  // hay proyecto, en el contexto del proyecto. Mismo camino que Convertir.
  ipcMain.handle("pdf-a-proyecto", async (_e, dato) => {
    try {
      if (!convertirDatos) return { ok: false, error: "El conversor todavía no está listo." };
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      if (path.extname(ruta).toLowerCase() !== ".pdf") return { ok: false, error: "Eso no es un PDF." };
      const problema = revisarRuta(ruta);
      if (problema) return { ok: false, error: problema };
      const nombre = String(dato?.nombre || "").trim().slice(0, 120) || path.basename(ruta);
      const r = await convertirDatos({
        datos: fs.readFileSync(ruta),
        nombre: nombre.toLowerCase().endsWith(".pdf") ? nombre : `${nombre}.pdf`,
        meta: { herramienta: "pdf" },
        proyectoId: Number(dato?.proyectoId) || null,
        forzarOcr: Boolean(dato?.forzarOcr),
      });
      if (r.error || !r.archivo) return { ok: false, error: r.error || "No pude convertirlo.", codigo: r.codigo || "" };
      return { ok: true, archivo: r.archivo, cache: Boolean(r.cache), proyectoId: Number(dato?.proyectoId) || null };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
}
